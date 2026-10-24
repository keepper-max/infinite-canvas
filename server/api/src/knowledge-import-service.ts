import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { DomainError } from "./domain.js";
import { KnowledgeService } from "./knowledge-service.js";
import type { ObjectStorage } from "./object-storage.js";
import type { Conversion } from "./knowledge-import-sandbox.js";
import { isStorageQuotaUnlimited } from "./storage-quota-service.js";
const digest = (body: Uint8Array | string) =>
  createHash("sha256").update(body).digest("hex");
const fail = (
  code: string,
  message: string,
  status: 400 | 403 | 404 | 409 | 422 | 503 = 422,
): never => {
  throw new DomainError(code, message, status);
};
const mime: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
};
export class KnowledgeImportService {
  constructor(
    readonly knowledge: KnowledgeService,
    readonly storage: ObjectStorage,
    readonly enqueue: (id: string) => Promise<unknown>,
    readonly maxStorageBytes: number,
    readonly assertAvailable: () => Promise<void> = async () => {},
    readonly adminEmails: string[] = [],
  ) {}
  private async unlimited(tx: any, user: string) {
    const actor = (
      await tx.execute(sql`select is_admin,email from users where id=${user}`)
    ).rows[0];
    return (
      actor &&
      isStorageQuotaUnlimited(actor.is_admin, actor.email, this.adminEmails)
    );
  }
  async list(user: string, space: string) {
    return this.knowledge.run(
      user,
      space,
      false,
      async (tx) =>
        (
          await tx.execute(
            sql`select id,filename,state,error,document_id,created_at from knowledge_imports where space_id=${space} and actor_id=${user} and state not in ('cleaned','cleaning') order by (state in ('uploading','queued','parsing','awaiting_confirmation')) desc,created_at desc limit 30`,
          )
        ).rows,
    );
  }
  async operation(user: string, space: string, operationId: string) {
    const id = await this.knowledge.run(
      user,
      space,
      false,
      async (tx) =>
        (
          await tx.execute(
            sql`select id from knowledge_imports where actor_id=${user} and space_id=${space} and operation_id=${operationId}`,
          )
        ).rows[0]?.id,
    );
    if (!id)
      fail("KNOWLEDGE_IMPORT_OPERATION_NOT_FOUND", "上传操作尚未持久化", 404);
    return this.get(user, space, id as string);
  }
  async get(user: string, space: string, id: string) {
    return this.knowledge.run(user, space, false, async (tx) => {
      const r = (
        await tx.execute(
          sql`select * from knowledge_imports where id=${id} and space_id=${space} and (actor_id=${user} or state='completed')`,
        )
      ).rows[0] as any;
      if (!r)
        return fail(
          "KNOWLEDGE_IMPORT_NOT_FOUND",
          "导入任务不存在或无权访问",
          404,
        );
      const duplicate = (
        await tx.execute(
          sql`select document_id from knowledge_imports where space_id=${space} and sha256=${r.sha256} and state='completed' and id<>${id} limit 1`,
        )
      ).rows[0];
      const { storage_key, assets, ...view } = r;
      return {
        ...view,
        duplicateDocumentId: duplicate?.document_id ?? null,
        attachments: assets.map((a: any) => ({
          id: a.id,
          mimeType: a.mimeType,
        })),
      };
    });
  }
  async upload(
    user: string,
    space: string,
    operationId: string,
    filename: string,
    body: Uint8Array,
    folderId: string | null,
  ) {
    if (process.env.KNOWLEDGE_IMPORT_WRITES_ENABLED === "false")
      fail(
        "KNOWLEDGE_IMPORT_READ_ONLY",
        "资料导入已暂停，已有文档和原件仍可读取",
        503,
      );
    await this.assertAvailable();
    const extension = filename.split(".").pop()?.toLowerCase() || "";
    if (!mime[extension])
      fail(
        "KNOWLEDGE_IMPORT_TYPE",
        "暂不支持该格式，请选择 DOCX、文字型 PDF、TXT、MD 或 MARKDOWN",
      );
    if (!body.length || body.length > 10 * 1024 * 1024)
      fail("KNOWLEDGE_IMPORT_SIZE", "文件为空或超过10MiB试运行上限", 422);
    const sha = digest(body),
      payload = digest(JSON.stringify([filename, sha, folderId]));
    const id = await this.knowledge.run(user, space, true, async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${"storage-quota:" + user},0))`,
      );
      const old = (
        await tx.execute(
          sql`select * from knowledge_imports where actor_id=${user} and operation_id=${operationId}`,
        )
      ).rows[0];
      if (old) {
        if (old.payload_hash !== payload || old.space_id !== space)
          fail(
            "KNOWLEDGE_OPERATION_MISMATCH",
            "同一操作ID不能用于不同文件",
            409,
          );
        return old.id as string;
      }
      const q = (
        await tx.execute(
          sql`select count(*)::int n from knowledge_imports where actor_id=${user} and state in ('uploading','queued','parsing','awaiting_confirmation')`,
        )
      ).rows[0];
      if (Number(q.n) >= 3)
        fail(
          "KNOWLEDGE_IMPORT_QUOTA",
          "已有3个未完成导入，请先确认或取消",
          409,
        );
      const used = (
        await tx.execute(
          sql`select (coalesce((select sum(i.bytes+coalesce((select sum((a->>'bytes')::bigint) from jsonb_array_elements(i.assets) a),0)) from knowledge_imports i where actor_id=${user} and state<>'cleaned'),0)+coalesce((select sum(bytes+coalesce(thumbnail_bytes,0)) from asset_versions where created_by=${user}),0)+coalesce((select sum(bytes) from user_storage_reservations where user_id=${user} and expires_at>now()),0))::bigint n`,
        )
      ).rows[0];
      if (
        !(await this.unlimited(tx, user)) &&
        Number(used.n) + body.length > this.maxStorageBytes
      )
        fail("KNOWLEDGE_IMPORT_QUOTA", "原件存储配额不足", 409);
      if (
        folderId &&
        !(
          await tx.execute(
            sql`select id from knowledge_folders where id=${folderId} and space_id=${space} and deleted_at is null`,
          )
        ).rows.length
      )
        fail("KNOWLEDGE_FOLDER_INVALID", "保存目录无效");
      const id = randomUUID();
      await tx.execute(
        sql`insert into knowledge_imports(id,space_id,actor_id,operation_id,payload_hash,filename,extension,mime_type,sha256,bytes,storage_key,folder_id,state) values(${id},${space},${user},${operationId},${payload},${filename},${extension},${mime[extension]},${sha},${body.length},${"knowledge-imports/" + id + "/original"},${folderId},'uploading')`,
      );
      return id;
    });
    // No network upload while holding database locks. Retry resumes the same immutable key.
    const task = await this.get(user, space, id);
    if (task.state === "uploading") {
      await this.storage.put(
        "knowledge-imports/" + id + "/original",
        body,
        mime[extension],
        sha,
      );
      await this.knowledge.run(user, space, true, async (tx) => {
        await tx.execute(
          sql`update knowledge_imports set state='queued',updated_at=now() where id=${id} and state='uploading'`,
        );
      });
    }
    await this.enqueue(id);
    return this.get(user, space, id);
  }
  async change(
    user: string,
    space: string,
    id: string,
    action: "cancel" | "retry",
  ) {
    if (action === "retry") {
      if (process.env.KNOWLEDGE_IMPORT_WRITES_ENABLED === "false")
        fail(
          "KNOWLEDGE_IMPORT_READ_ONLY",
          "资料导入已暂停，已有文档和原件仍可读取",
          503,
        );
      await this.assertAvailable();
    }
    await this.knowledge.run(user, space, true, async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${"storage-quota:" + user},0))`,
      );
      const row = (
        await tx.execute(
          sql`select * from knowledge_imports where id=${id} and actor_id=${user} and space_id=${space} for update`,
        )
      ).rows[0];
      if (!row) fail("KNOWLEDGE_IMPORT_NOT_FOUND", "导入任务不存在", 404);
      if (
        action === "cancel" &&
        [
          "uploading",
          "queued",
          "parsing",
          "failed",
          "awaiting_confirmation",
        ].includes(row.state as string)
      )
        await tx.execute(
          sql`update knowledge_imports set state='cancelled',updated_at=now() where id=${id}`,
        );
      else if (action === "retry" && row.state === "failed") {
        const n = (
          await tx.execute(
            sql`select count(*)::int n from knowledge_imports where actor_id=${user} and state in ('uploading','queued','parsing','awaiting_confirmation')`,
          )
        ).rows[0];
        if (Number(n.n) >= 3)
          fail(
            "KNOWLEDGE_IMPORT_QUOTA",
            "已有3个未完成导入，请先确认或取消",
            409,
          );
        await tx.execute(
          sql`update knowledge_imports set state='queued',error=null,updated_at=now() where id=${id}`,
        );
      } else fail("KNOWLEDGE_IMPORT_STATE", "当前状态不能执行此操作", 409);
    });
    if (action === "retry") await this.enqueue(id);
    return this.get(user, space, id);
  }
  async original(user: string, space: string, id: string, assetId?: string) {
    const task = await this.get(user, space, id);
    if (["cleaned", "cleaning"].includes(task.state))
      fail("KNOWLEDGE_IMPORT_EXPIRED", "暂存原件已过保留期", 404);
    const stream = await this.storage.openDownload(
      "knowledge-imports/" +
        id +
        "/" +
        (assetId ? "asset-" + assetId : "original"),
    );
    return { stream, filename: assetId ? "image" : task.filename };
  }
  async sources(user: string, space: string, document: string) {
    await this.knowledge.read(user, space, document);
    return this.knowledge.run(
      user,
      space,
      false,
      async (tx) =>
        (
          await tx.execute(
            sql`select id,filename,sha256,bytes,converter,document_revision,created_at from knowledge_imports where space_id=${space} and document_id=${document} and state='completed' order by created_at desc`,
          )
        ).rows,
    );
  }
  async reparse(user: string, space: string, id: string, operationId: string) {
    const original = await this.get(user, space, id);
    if (original.state !== "completed" || !original.document_id)
      fail("KNOWLEDGE_IMPORT_STATE", "只能重新解析已保存文档的原件", 409);
    const doc = await this.knowledge.read(user, space, original.document_id);
    const bytes = await this.storage.get(
      "knowledge-imports/" + id + "/original",
    );
    if (
      digest(bytes) !== original.sha256 ||
      bytes.length !== Number(original.bytes)
    )
      fail("KNOWLEDGE_IMPORT_INTEGRITY", "原件完整性校验失败，已停止重新解析");
    const task = await this.upload(
      user,
      space,
      operationId,
      original.filename,
      bytes,
      doc.folderId,
    );
    await this.knowledge.run(user, space, true, async (tx) => {
      await tx.execute(
        sql`update knowledge_imports set reparse_document_id=${doc.id},expected_revision=${doc.revision} where id=${task.id} and reparse_document_id is null and state<>'completed'`,
      );
    });
    return this.get(user, space, task.id);
  }
  async process(
    id: string,
    convert: (body: Uint8Array, extension: string) => Promise<Conversion>,
  ) {
    // Queue redelivery uses a per-task advisory lock on a dedicated connection through tx.
    const row = (
      await this.knowledge.db.execute(
        sql`select * from knowledge_imports where id=${id}`,
      )
    ).rows[0] as any;
    if (!row || !["queued", "parsing"].includes(row.state)) return;
    try {
      await this.knowledge.run(row.actor_id, row.space_id, true, async (tx) => {
        await tx.execute(
          sql`update knowledge_imports set state='parsing',updated_at=now() where id=${id} and state in ('queued','parsing')`,
        );
      });
      const queueWaitMs = Math.max(
        0,
        Date.now() - new Date(row.updated_at).getTime(),
      );
      const data = await this.storage.get(row.storage_key);
      if (digest(data) !== row.sha256 || data.length !== Number(row.bytes))
        throw new Error("原件完整性校验失败");
      const result = await convert(data, row.extension);
      const assetIds = new Set<string>();
      for (const asset of result.assets) {
        if (
          typeof asset.id !== "string" ||
          !/^\d+$/.test(asset.id) ||
          assetIds.has(asset.id) ||
          typeof asset.body !== "string" ||
          !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
            asset.mimeType,
          )
        )
          throw new Error("转换附件协议无效");
        assetIds.add(asset.id);
      }
      const assetMeta = result.assets.map(({ body, ...a }) => ({
        ...a,
        bytes: Buffer.byteLength(body, "base64"),
      }));
      const staging = await this.knowledge.run(
        row.actor_id,
        row.space_id,
        true,
        async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${"storage-quota:" + row.actor_id},0))`,
          );
          const used = (
            await tx.execute(
              sql`select (coalesce((select sum(i.bytes+coalesce((select sum((a->>'bytes')::bigint) from jsonb_array_elements(i.assets) a),0)) from knowledge_imports i where actor_id=${row.actor_id} and state<>'cleaned'),0)+coalesce((select sum(bytes+coalesce(thumbnail_bytes,0)) from asset_versions where created_by=${row.actor_id}),0)+coalesce((select sum(bytes) from user_storage_reservations where user_id=${row.actor_id} and expires_at>now()),0))::bigint n`,
            )
          ).rows[0];
          if (
            !(await this.unlimited(tx, row.actor_id)) &&
            Number(used.n) -
              (row.assets as { bytes?: number }[]).reduce(
                (n, a) => n + Number(a.bytes || 0),
                0,
              ) +
              assetMeta.reduce((n, a) => n + a.bytes, 0) >
              this.maxStorageBytes
          )
            fail("KNOWLEDGE_IMPORT_QUOTA", "转换附件超出存储配额");
          return (
            await tx.execute(
              sql`update knowledge_imports set assets=${JSON.stringify(assetMeta)}::jsonb where id=${id} and state='parsing' returning id`,
            )
          ).rows.length;
        },
      );
      if (!staging) return;
      for (const asset of result.assets) {
        const data = Buffer.from(asset.body, "base64");
        await this.storage.put(
          "knowledge-imports/" + id + "/asset-" + asset.id,
          data,
          asset.mimeType,
          digest(data),
        );
        result.markdown = result.markdown
          .split("import-asset:" + asset.id)
          .join(
            `/api/knowledge/${row.space_id}/imports/${id}/assets/${asset.id}`,
          );
      }
      await this.knowledge.run(row.actor_id, row.space_id, true, async (tx) => {
        await tx.execute(
          sql`update knowledge_imports set state='awaiting_confirmation',markdown=${result.markdown},converter=${result.converter},warnings=${JSON.stringify(result.warnings)}::jsonb,pages=${JSON.stringify(result.pages)}::jsonb,metrics=${JSON.stringify({ ...result.metrics, queueWaitMs })}::jsonb,updated_at=now() where id=${id} and state='parsing'`,
        );
      });
    } catch (e) {
      await this.knowledge.db.execute(
        sql`update knowledge_imports set state='failed',error=${(e as Error).message},updated_at=now() where id=${id} and state in ('queued','parsing')`,
      );
    }
  }
  async cleanup() {
    // Claim first; confirmations cannot reference a failed/cancelled task. Retain the audit row.
    const expired = (
      await this.knowledge.db.execute(
        sql`update knowledge_imports set state='cleaning' where state in ('failed','cancelled','cleaning') and updated_at<now()-interval '7 days' and document_id is null returning id,assets`,
      )
    ).rows;
    for (const row of expired) {
      await this.storage.delete("knowledge-imports/" + row.id + "/original");
      for (const asset of row.assets as { id: string }[])
        await this.storage.delete(
          "knowledge-imports/" + row.id + "/asset-" + asset.id,
        );
      await this.knowledge.db.execute(
        sql`update knowledge_imports set state='cleaned',markdown=null,updated_at=now() where id=${row.id} and state='cleaning' and document_id is null`,
      );
    }
    return expired.length;
  }
}
