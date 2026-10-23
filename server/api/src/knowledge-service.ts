import { canEditProjectRole } from "./project-access.js";
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type { PlatformDatabase } from "./db/client.js";
import { DomainError } from "./domain.js";
import { knowledgeIndex } from "./knowledge-index.js";
import { appendKnowledgeLink, wikiSourceRanges } from "./knowledge-link-edit.js";
import { knowledgeReferenceSchema, type KnowledgeReference } from "./knowledge-reference.js";
import { requireKnowledgeFeature, hasKnowledgeFeature } from "./knowledge-feature.js";

type Tx = Parameters<Parameters<PlatformDatabase["transaction"]>[0]>[0];
type Row = Record<string, any>;
const rows = async (tx: Tx, q: SQL) => (await tx.execute(q)).rows as Row[];
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const fail = (
  code: string,
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 422 = 409,
  details?: Record<string, unknown>,
): never => {
  throw new DomainError(code, message, status, false, { details });
};
function doc(r: Row) {
  return {
    id: r.id,
    spaceId: r.space_id,
    folderId: r.folder_id,
    title: r.title,
    markdown: r.markdown,
    revision: r.revision,
    contentHash: r.content_hash,
    deletedAt: r.deleted_at,
    updatedAt: r.updated_at,
    createdAt: r.created_at,
  };
}
export type KnowledgeOperation = {
  operationId: string;
  action: string;
  payload: Record<string, unknown>;
};
export class KnowledgeService {
  constructor(readonly db: PlatformDatabase, private readonly adminEmails: string[] = []) {}
  private async transaction<T>(fn: (tx: Tx) => Promise<T>) {
    try {
      return await this.db.transaction(fn);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      const code =
        (error as { cause?: { code?: string }; code?: string }).cause?.code ??
        (error as { code?: string }).code;
      if (code === "23505")
        fail("KNOWLEDGE_NAME_EXISTS", "当前目录已存在同名文件夹");
      throw new DomainError(
        "KNOWLEDGE_STORAGE_UNCONFIRMED",
        "知识操作未确认，请保留原操作ID并查询回执",
        503,
        true,
        { details: { storageCode: code ?? "unknown" } },
      );
    }
  }
  private async actor(tx: Tx, userId: string) {
    if (
      !(
        await rows(
          tx,
          sql`select id from users where id=${userId} and account_status='active' for share`,
        )
      )[0]
    )
      fail("UNAUTHENTICATED", "账号已停用或不存在", 401);
    await requireKnowledgeFeature(tx, userId);
  }
  async featureStatus(userId: string) {
    return this.db.transaction(async tx => ({ enabled: await hasKnowledgeFeature(tx, userId) }));
  }
  async featureGrant(actor: string, target: string, enabled: boolean, reason: string) {
    return this.db.transaction(async tx => {
      const admin = await tx.execute(sql`select id from users where id=${actor} and account_status='active' and (is_admin=true or lower(email) in (select jsonb_array_elements_text(${JSON.stringify(this.adminEmails)}::jsonb))) for share`);
      if (!admin.rows.length) throw new DomainError("ADMIN_FORBIDDEN", "需要管理员权限", 403);
      const current = await tx.execute(sql`select id,account_status from users where id=${target} for update`);
      if (!current.rows.length || (enabled && current.rows[0].account_status !== 'active')) throw new DomainError("USER_NOT_FOUND", "用户不存在或已停用", 404);
      await tx.execute(sql`insert into user_feature_grants(user_id,feature,enabled,updated_by,reason) values(${target},'knowledge',${enabled},${actor},${reason}) on conflict(user_id,feature) do update set enabled=excluded.enabled,updated_by=excluded.updated_by,reason=excluded.reason,updated_at=now()`);
      await tx.execute(sql`insert into admin_audit_logs(actor_user_id,action,target_type,target_id,metadata) values(${actor},'feature.knowledge.grant','user',${target},${JSON.stringify({enabled,reason})}::jsonb)`);
      return { userId: target, enabled };
    });
  }
  private async authorize(
    tx: Tx,
    userId: string,
    spaceId: string,
    write = false,
  ) {
    const s = (
      await rows(tx, sql`select * from knowledge_spaces where id=${spaceId}`)
    )[0];
    if (!s) fail("KNOWLEDGE_NOT_FOUND", "知识空间不存在或无权访问", 404);
    if (s.kind === "personal") {
      if (s.owner_user_id !== userId)
        fail("KNOWLEDGE_NOT_FOUND", "知识空间不存在或无权访问", 404);
    } else {
      const p = (
        await rows(
          tx,
          sql`select id from projects where id=${s.project_id} and deleted_at is null for share`,
        )
      )[0];
      const m =
        p &&
        (
          await rows(
            tx,
            sql`select role from project_members where project_id=${s.project_id} and user_id=${userId} for share`,
          )
        )[0];
      if (!m) fail("KNOWLEDGE_NOT_FOUND", "知识空间不存在或无权访问", 404);
      if (write && !canEditProjectRole(m.role))
        fail("PROJECT_READ_ONLY", "当前成员只有查看权限", 403);
    }
    await tx.execute(
      write
        ? sql`select id from knowledge_spaces where id=${spaceId} for update`
        : sql`select id from knowledge_spaces where id=${spaceId} for share`,
    );
    return s;
  }
  private async operation(
    tx: Tx,
    userId: string,
    spaceId: string,
    op: KnowledgeOperation,
    fn: () => Promise<Row>,
  ) {
    // Actor-operation lock makes IDs stable even across different requested spaces.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${userId + ":" + op.operationId},0))`,
    );
    const payloadHash = (
      await rows(
        tx,
        sql`select encode(sha256(convert_to((${JSON.stringify(op)}::jsonb - 'operationId')::text,'UTF8')),'hex') value`,
      )
    )[0].value;
    const old = (
      await rows(
        tx,
        sql`select * from knowledge_operations where actor_id=${userId} and operation_id=${op.operationId}`,
      )
    )[0];
    if (old) {
      if (old.payload_hash !== payloadHash || old.space_id !== spaceId)
        fail("KNOWLEDGE_OPERATION_MISMATCH", "同一操作ID不能用于不同内容");
      return { ...old.receipt, replayed: true };
    }
    const result = await fn();
    const receipt = {
      ...result,
      operationId: op.operationId,
      persisted: true,
      replayed: false,
    };
    await tx.execute(
      sql`insert into knowledge_operations(actor_id,operation_id,space_id,payload_hash,receipt) values(${userId},${op.operationId},${spaceId},${payloadHash},${JSON.stringify(receipt)}::jsonb)`,
    );
    await tx.execute(
      sql`insert into knowledge_audit(actor_id,space_id,operation_id,action,target_id,revision) values(${userId},${spaceId},${op.operationId},${op.action},${result.id ?? null},${result.revision ?? null})`,
    );
    return receipt;
  }
  async spaces(userId: string) {
    return this.transaction(async (tx) => {
      await this.actor(tx, userId);
      return rows(
        tx,
        sql`select s.*,case when s.kind='personal' then '个人知识库' else p.name end name,case when s.kind='personal' then 'owner' else m.role end role from knowledge_spaces s left join projects p on p.id=s.project_id left join project_members m on m.project_id=p.id and m.user_id=${userId} where (s.kind='personal' and s.owner_user_id=${userId}) or (s.kind='project' and p.deleted_at is null and m.user_id=${userId}) order by s.kind,s.created_at`,
      );
    });
  }
  async createSpace(
    userId: string,
    kind: "personal" | "project",
    projectId: string | null,
    operationId: string,
  ) {
    return this.transaction(async (tx) => {
      await this.actor(tx, userId);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${kind + ":" + (projectId ?? userId)},0))`,
      );
      if (kind === "project") {
        const p = (
          await rows(
            tx,
            sql`select id from projects where id=${projectId} and deleted_at is null for share`,
          )
        )[0];
        const m =
          p &&
          (
            await rows(
              tx,
              sql`select role from project_members where project_id=${projectId} and user_id=${userId} for share`,
            )
          )[0];
        if (!m || !canEditProjectRole(m.role))
          fail("PROJECT_READ_ONLY", "无法创建该项目知识空间", 403);
      }
      let s = (
        await rows(
          tx,
          kind === "personal"
            ? sql`select * from knowledge_spaces where owner_user_id=${userId} and kind='personal'`
            : sql`select * from knowledge_spaces where project_id=${projectId} and kind='project'`,
        )
      )[0];
      if (!s)
        s = (
          await rows(
            tx,
            sql`insert into knowledge_spaces(kind,owner_user_id,project_id) values(${kind},${kind === "personal" ? userId : null},${kind === "project" ? projectId : null}) returning *`,
          )
        )[0];
      return this.operation(
        tx,
        userId,
        s.id,
        { operationId, action: "space.ensure", payload: { kind, projectId } },
        async () => s,
      );
    });
  }
  private async run<T>(
    userId: string,
    spaceId: string,
    write: boolean,
    fn: (tx: Tx) => Promise<T>,
  ) {
    return this.transaction(async (tx) => {
      await this.actor(tx, userId);
      await this.authorize(tx, userId, spaceId, write);
      return fn(tx);
    });
  }
  async list(
    userId: string,
    spaceId: string,
    input: {
      q?: string;
      tag?: string;
      folderId?: string;
      deleted?: boolean;
      page: number;
      pageSize: number;
    },
  ) {
    return this.run(userId, spaceId, false, async (tx) => {
      const q = input.q?.trim() || "",
        tag = input.tag?.trim() || "",
        pattern = "%" + q.replace(/[\\%_]/g, "\\$&") + "%";
      const where = sql`d.space_id=${spaceId} and ${input.deleted ? sql`d.deleted_at is not null` : sql`d.deleted_at is null`} and (${input.folderId ?? null}::uuid is null or d.folder_id=${input.folderId ?? null}::uuid)
    and (${tag}='' or exists(select 1 from knowledge_tags t where t.document_id=d.id and t.tag=${tag}))
    and (${q}='' or d.title ilike ${pattern} or d.markdown ilike ${pattern} or d.search_vector @@ plainto_tsquery('simple',${q}) or exists(select 1 from knowledge_tags t where t.document_id=d.id and t.tag ilike ${pattern}))`;
      const count = (
        await rows(
          tx,
          sql`select count(*)::int total from knowledge_documents d where ${where}`,
        )
      )[0].total;
      const found = await rows(
        tx,
        sql`select d.id,d.space_id,d.folder_id,d.title,d.revision,d.content_hash,d.deleted_at,d.updated_at,d.created_at,substring(d.markdown,1,180) excerpt from knowledge_documents d where ${where} order by (${q}<>'' and d.title ilike ${pattern}) desc,d.updated_at desc,d.id limit ${input.pageSize} offset ${(input.page - 1) * input.pageSize}`,
      );
      return {
        items: found.map((r) => ({ ...doc(r), excerpt: r.excerpt })),
        total: count,
        page: input.page,
        pageSize: input.pageSize,
      };
    });
  }
  async folders(userId: string, spaceId: string) {
    return this.run(userId, spaceId, false, (tx) =>
      rows(
        tx,
        sql`select id,parent_id,name,revision from knowledge_folders where space_id=${spaceId} and deleted_at is null order by name,id`,
      ),
    );
  }
  async tags(userId: string, spaceId: string) {
    return this.run(userId, spaceId, false, (tx) =>
      rows(
        tx,
        sql`select t.tag,count(*)::int count from knowledge_tags t join knowledge_documents d on d.id=t.document_id where d.space_id=${spaceId} and d.deleted_at is null group by t.tag order by t.tag`,
      ),
    );
  }
  private async folder(tx: Tx, spaceId: string, folderId: string | null) {
    if (
      folderId &&
      !(
        await rows(
          tx,
          sql`select id from knowledge_folders where id=${folderId} and space_id=${spaceId} and deleted_at is null`,
        )
      )[0]
    )
      fail("KNOWLEDGE_FOLDER_INVALID", "文件夹不存在或不属于该知识空间", 422);
  }
  async folderWrite(userId: string, spaceId: string, op: KnowledgeOperation) {
    return this.run(userId, spaceId, true, (tx) =>
      this.operation(tx, userId, spaceId, op, async () => {
        const p = { ...op.payload } as any;
        await this.folder(tx, spaceId, p.parentId ?? null);
        if (op.action === "folder.create")
          return (
            await rows(
              tx,
              sql`insert into knowledge_folders(space_id,parent_id,name) values(${spaceId},${p.parentId ?? null},${p.name}) returning *`,
            )
          )[0];
        const f = (
          await rows(
            tx,
            sql`select * from knowledge_folders where id=${p.id} and space_id=${spaceId} and deleted_at is null for update`,
          )
        )[0];
        if (!f) fail("KNOWLEDGE_NOT_FOUND", "文件夹不存在", 404);
        if (f.revision !== p.expectedRevision)
          fail("KNOWLEDGE_REVISION_CONFLICT", "文件夹已被修改");
        if (op.action === "folder.delete") {
          if (
            (
              await rows(
                tx,
                sql`select id from knowledge_folders where parent_id=${p.id} and deleted_at is null union all select id from knowledge_documents where folder_id=${p.id} and deleted_at is null`,
              )
            ).length
          )
            fail("KNOWLEDGE_FOLDER_NOT_EMPTY", "请先移出文档和子文件夹");
          return (
            await rows(
              tx,
              sql`update knowledge_folders set deleted_at=now(),revision=revision+1 where id=${p.id} returning *`,
            )
          )[0];
        }
        let parent = p.parentId ?? null;
        while (parent) {
          if (parent === p.id)
            fail("KNOWLEDGE_FOLDER_CYCLE", "文件夹不能移动到自己或子目录");
          parent = (
            await rows(
              tx,
              sql`select parent_id from knowledge_folders where id=${parent}`,
            )
          )[0]?.parent_id;
        }
        return (
          await rows(
            tx,
            sql`update knowledge_folders set name=${p.name},parent_id=${p.parentId ?? null},revision=revision+1 where id=${p.id} returning *`,
          )
        )[0];
      }),
    );
  }
  private async get(tx: Tx, spaceId: string, id: string) {
    const d = (
      await rows(
        tx,
        sql`select * from knowledge_documents where id=${id} and space_id=${spaceId}`,
      )
    )[0];
    if (!d) fail("KNOWLEDGE_NOT_FOUND", "文档不存在或无权访问", 404);
    return d;
  }
  async read(userId: string, spaceId: string, id: string) {
    return this.run(userId, spaceId, false, async (tx) =>
      doc(await this.get(tx, spaceId, id)),
    );
  }
  /** Shared authorized reference reader. The caller may supply its existing canvas/job transaction. */
  async referenceInTransaction(tx: Tx, userId: string, projectId: string, raw: KnowledgeReference, summaryOnly = false) {
    const reference = knowledgeReferenceSchema.parse(raw);
    await this.actor(tx, userId);
    const space = await this.authorize(tx, userId, reference.spaceId);
    if (space.kind !== "project" || space.project_id !== projectId)
      fail("KNOWLEDGE_PROJECT_COPY_REQUIRED", "请先明确复制为当前项目的独立知识，个人知识不会自动共享", 403);
    const projection = summaryOnly ? sql`title,revision,content_hash,deleted_at,length(markdown) as characters,substring(markdown,1,180) as markdown` : sql`*`;
    const current = (await rows(tx, sql`select ${projection} from knowledge_documents where id=${reference.documentId} and space_id=${reference.spaceId}`))[0];
    if (!current) fail("KNOWLEDGE_NOT_FOUND", "文档不存在或无权读取", 404);
    if (current.deleted_at) fail("KNOWLEDGE_NOT_FOUND", "知识文档已删除或不可引用", 404);
    const value = reference.mode === "pinned" ? (await rows(tx, sql`select ${projection} from knowledge_versions where document_id=${reference.documentId} and revision=${reference.revision} and deleted_at is null`))[0] : current;
    if (!value) fail("KNOWLEDGE_NOT_FOUND", "引用版本不存在或已删除", 404);
    return { reference, title: value.title as string, markdown: value.markdown as string, characters: value.characters ?? (value.markdown as string).length, revision: Number(value.revision), latestRevision: Number(current.revision), contentHash: value.content_hash as string };
  }
  async reference(userId: string, projectId: string, raw: KnowledgeReference) {
    return this.transaction(async tx => {
      const { markdown, ...value } = await this.referenceInTransaction(tx, userId, projectId, raw, true);
      return { ...value, excerpt: markdown };
    });
  }
  async validateJobSources(userId: string, projectId: string, sources: { sourceSpaceId: string; sourceDocumentId: string; sourceRevision: number; contentHash: string }[]) {
    return this.transaction(async tx => {
      await this.actor(tx, userId);
      const member = (await rows(tx, sql`select m.role from project_members m join projects p on p.id=m.project_id where m.project_id=${projectId} and m.user_id=${userId} and p.deleted_at is null for share of p,m`))[0];
      if (!member || !canEditProjectRole(member.role)) fail("PROJECT_FORBIDDEN", "执行前项目权限已撤销或变为只读", 403);
      for (const source of sources) {
        const value = await this.referenceInTransaction(tx, userId, projectId, { spaceId: source.sourceSpaceId, documentId: source.sourceDocumentId, mode: "pinned", revision: source.sourceRevision }, true);
        if (value.contentHash !== source.contentHash) fail("KNOWLEDGE_SOURCE_CHANGED", "知识历史版本校验失败，已停止向模型提交", 409);
      }
    });
  }
  async history(userId: string, spaceId: string, id: string) {
    return this.run(userId, spaceId, false, async (tx) => {
      await this.get(tx, spaceId, id);
      return rows(
        tx,
        sql`select revision,title,content_hash,deleted_at,created_at from knowledge_versions where document_id=${id} order by revision desc`,
      );
    });
  }
  async version(userId: string, spaceId: string, id: string, revision: number) {
    return this.run(userId, spaceId, false, async (tx) => {
      await this.get(tx, spaceId, id);
      const v = (
        await rows(
          tx,
          sql`select * from knowledge_versions where document_id=${id} and revision=${revision}`,
        )
      )[0];
      if (!v) fail("KNOWLEDGE_NOT_FOUND", "版本不存在", 404);
      return v;
    });
  }
  async receipt(userId: string, spaceId: string, operationId: string) {
    return this.run(userId, spaceId, false, async (tx) => {
      const r = (
        await rows(
          tx,
          sql`select receipt from knowledge_operations where actor_id=${userId} and space_id=${spaceId} and operation_id=${operationId}`,
        )
      )[0];
      if (!r)
        fail("KNOWLEDGE_OPERATION_NOT_FOUND", "当前未找到已提交回执", 404);
      return r.receipt;
    });
  }
  private async linkPlan(tx: Tx, spaceId: string, source: Row, targetId: string, action: "add" | "remove") {
    if (source.deleted_at) fail("KNOWLEDGE_DELETED", "来源文档已删除", 409);
    const target = await this.get(tx, spaceId, targetId);
    if (target.deleted_at) fail("KNOWLEDGE_NOT_FOUND", "目标文档已删除或无权访问", 404);
    const links = await rows(tx, sql`select * from knowledge_links where source_id=${source.id} order by ordinal`);
    const matches = links.filter(l => l.target_id === targetId || l.bound_target_id === targetId);
    const ranges = wikiSourceRanges(source.markdown);
    const common = { sourceId: source.id, targetId, sourceTitle: source.title, targetTitle: target.title, expectedRevision: source.revision, beforeMarkdown: source.markdown };
    if (action === "add") {
      if (matches.length) return { ...common, markdown: source.markdown, alreadyLinked: true, requiresEditor: false, occurrences: ranges.filter(r => matches.some(l => l.ordinal === r.ordinal)) };
      const unresolved = links.find(l => l.status === "ambiguous" && l.target_text === target.title && l.candidates.includes(targetId));
      return { ...common, ...(unresolved ? { markdown: source.markdown, ordinal: unresolved.ordinal, existingReference: true } : appendKnowledgeLink(source.markdown, target.title)), requiresEditor: false };
    }
    const occurrences = ranges.filter(r => matches.some(l => l.ordinal === r.ordinal));
    if (matches.length !== 1 || occurrences.length !== 1 || occurrences[0].start === null || occurrences[0].end === null)
      return { ...common, markdown: source.markdown, requiresEditor: true, occurrences };
    const range = occurrences[0];
    return { ...common, markdown: source.markdown.slice(0, range.start!) + source.markdown.slice(range.end!), requiresEditor: false, occurrences, ordinal: range.ordinal };
  }
  async previewLink(userId: string, spaceId: string, sourceId: string, targetId: string, action: "add" | "remove") {
    return this.run(userId, spaceId, false, async tx => this.linkPlan(tx, spaceId, await this.get(tx, spaceId, sourceId), targetId, action));
  }
  async write(userId: string, spaceId: string, op: KnowledgeOperation) {
    return this.run(userId, spaceId, true, (tx) =>
      this.operation(tx, userId, spaceId, op, async () => {
        const p = { ...op.payload } as any;
        let d: Row;
        let linkBinding: { ordinal: number; targetId: string } | undefined;
        let removedLinkOrdinal: number | undefined;
        if (op.action === "document.copyFrom") {
          const target = (await rows(tx, sql`select * from knowledge_spaces where id=${spaceId}`))[0];
          const source = await this.authorize(tx, userId, p.sourceSpaceId);
          if (target.kind !== "project" || source.kind !== "personal")
            fail("KNOWLEDGE_COPY_INVALID", "此入口只将个人知识复制为独立项目文档", 422);
          const original = await this.get(tx, p.sourceSpaceId, p.sourceDocumentId);
          if (original.deleted_at) fail("KNOWLEDGE_NOT_FOUND", "来源文档已删除", 404);
          if (original.revision !== p.sourceRevision) fail("KNOWLEDGE_REVISION_CONFLICT", "来源版本已变化，请重新检查后复制", 409, { currentRevision: original.revision });
          p.title = original.title; p.markdown = original.markdown; p.folderId = null;
        }
        if (
          op.action === "document.create" ||
          op.action === "document.import" || op.action === "document.copyFrom"
        ) {
          await this.folder(tx, spaceId, p.folderId ?? null);
          if (op.action === "document.import") {
            const existing = (
              await rows(
                tx,
                sql`select * from knowledge_documents where space_id=${spaceId} and folder_id is not distinct from ${p.folderId ?? null}::uuid and title=${p.title} and content_hash=${hash(p.markdown)} and deleted_at is null order by created_at,id limit 1`,
              )
            )[0];
            if (existing) return { ...doc(existing), importedExisting: true };
          }
          d = (
            await rows(
              tx,
              sql`insert into knowledge_documents(space_id,folder_id,title,markdown,content_hash,created_by,updated_by) values(${spaceId},${p.folderId ?? null},${p.title},${p.markdown},${hash(p.markdown)},${userId},${userId}) returning *`,
            )
          )[0];
          if (op.action === "document.copyFrom")
            await tx.execute(sql`insert into knowledge_copy_sources(document_id,source_space_id,source_document_id,source_revision,source_hash,copied_by) values(${d.id},${p.sourceSpaceId},${p.sourceDocumentId},${p.sourceRevision},${d.content_hash},${userId})`);
        } else {
          const old = await this.get(tx, spaceId, p.id);
          if (old.revision !== p.expectedRevision)
            fail(
              "KNOWLEDGE_REVISION_CONFLICT",
              "文档已被其他页面修改，请保留草稿后比较版本",
              409,
              { currentRevision: old.revision },
            );
          let title = old.title,
            markdown = old.markdown,
            folderId = old.folder_id,
            deletedAt = old.deleted_at;
          if (op.action === "document.linkAdd" || op.action === "document.linkRemove") {
            const plan = await this.linkPlan(tx, spaceId, old, p.targetId, op.action === "document.linkAdd" ? "add" : "remove");
            if (plan.requiresEditor) fail("KNOWLEDGE_LINK_REQUIRES_EDITOR", "存在多个引用或无法可靠定位，请在源码编辑器中选择具体引用", 422);
            if ("alreadyLinked" in plan && plan.alreadyLinked) return { ...doc(old), alreadyLinked: true };
            markdown = plan.markdown;
            if (op.action === "document.linkAdd") {
              const ordinal = 'ordinal' in plan ? plan.ordinal : undefined;
              if (typeof ordinal !== 'number') fail('KNOWLEDGE_LINK_INVALID', '关联预览缺少有效引用位置', 422);
              linkBinding = { ordinal, targetId: p.targetId };
            } else {
              removedLinkOrdinal = 'occurrences' in plan ? plan.occurrences?.[0]?.ordinal : undefined;
            }
          } else if (op.action === "document.save") {
            if (deletedAt) fail("KNOWLEDGE_DELETED", "文档已删除，请先恢复");
            title = p.title;
            markdown = p.markdown;
            folderId = p.folderId ?? null;
            await this.folder(tx, spaceId, folderId);
          } else if (op.action === "document.resolveLink") {
            if (deletedAt) fail("KNOWLEDGE_DELETED", "文档已删除，请先恢复");
            const link = (
              await rows(
                tx,
                sql`select * from knowledge_links where source_id=${p.id} and ordinal=${p.ordinal}`,
              )
            )[0];
            if (!link || !link.candidates.includes(p.targetId))
              fail("KNOWLEDGE_LINK_INVALID", "该目标不在当前引用候选范围", 422);
            await tx.execute(
              sql`update knowledge_links set target_id=${p.targetId},bound_target_id=${p.targetId},status='resolved' where source_id=${p.id} and ordinal=${p.ordinal}`,
            );
          } else if (op.action === "document.delete") deletedAt = new Date();
          else if (op.action === "document.restore") {
            const v = (
              await rows(
                tx,
                sql`select * from knowledge_versions where document_id=${p.id} and revision=${p.version}`,
              )
            )[0];
            if (!v) fail("KNOWLEDGE_NOT_FOUND", "历史版本不存在", 404);
            title = v.title;
            markdown = v.markdown;
            folderId = v.folder_id;
            deletedAt = null;
            if (
              folderId &&
              !(
                await rows(
                  tx,
                  sql`select id from knowledge_folders where id=${folderId} and deleted_at is null`,
                )
              )[0]
            )
              folderId = null;
          } else fail("KNOWLEDGE_ACTION_INVALID", "不支持的操作", 422);
          d = (
            await rows(
              tx,
              sql`update knowledge_documents set title=${title},markdown=${markdown},folder_id=${folderId},deleted_at=${deletedAt},content_hash=${hash(markdown)},revision=revision+1,updated_by=${userId},updated_at=now() where id=${p.id} returning *`,
            )
          )[0];
        }
        await tx.execute(
          sql`insert into knowledge_versions(document_id,revision,title,markdown,content_hash,folder_id,deleted_at,actor_id) values(${d.id},${d.revision},${d.title},${d.markdown},${d.content_hash},${d.folder_id},${d.deleted_at},${userId})`,
        );
        await tx.execute(
          sql`insert into knowledge_document_names(document_id,space_id,name) values(${d.id},${spaceId},${d.title}) on conflict do nothing`,
        );
        const index = knowledgeIndex(d.markdown);
        await tx.execute(
          sql`delete from knowledge_tags where document_id=${d.id}`,
        );
        for (const tag of index.tags)
          await tx.execute(
            sql`insert into knowledge_tags(document_id,tag) values(${d.id},${tag})`,
          );
        const previous = await rows(
          tx,
          sql`select * from knowledge_links where source_id=${d.id} order by ordinal`,
        );
        await tx.execute(
          sql`delete from knowledge_links where source_id=${d.id}`,
        );
        for (const [ordinal, link] of index.links.entries()) {
          const kept = previous.find(
            (x) => x.ordinal === (removedLinkOrdinal !== undefined && ordinal >= removedLinkOrdinal ? ordinal + 1 : ordinal) && x.target_text === link.target,
          );
          await tx.execute(
            sql`insert into knowledge_links(source_id,ordinal,target_text,display_text,target_id,bound_target_id,status) values(${d.id},${ordinal},${link.target},${link.alias},${kept?.target_id ?? null},${kept?.bound_target_id ?? kept?.target_id ?? null},'missing')`,
          );
        }
        if (linkBinding) await tx.execute(sql`update knowledge_links set bound_target_id=${linkBinding.targetId} where source_id=${d.id} and ordinal=${linkBinding.ordinal}`);
        await this.resolve(tx, spaceId, d.id);
        return doc(d);
      }),
    );
  }
  private async resolve(tx: Tx, spaceId: string, documentId: string) {
    // Existing unique targets preserve identity across renames. Titles remain aliases;
    // source Markdown is never rewritten as part of relationship indexing.
    const affected = sql`l.source_id in(select id from knowledge_documents where space_id=${spaceId}) and (l.source_id=${documentId} or l.bound_target_id=${documentId} or exists(select 1 from knowledge_document_names n where n.document_id=${documentId} and n.name=regexp_replace(split_part(l.target_text,'#',1),'\.md$','','i')))`;
    await tx.execute(
      sql`update knowledge_links l set candidates=coalesce((select array_agg(distinct d.id order by d.id) from knowledge_document_names n join knowledge_documents d on d.id=n.document_id where n.space_id=${spaceId} and d.deleted_at is null and n.name=regexp_replace(split_part(l.target_text,'#',1),'\.md$','','i')),'{}'::uuid[]) where ${affected}`,
    );
    await tx.execute(
      sql`update knowledge_links l set target_id=case when exists(select 1 from knowledge_documents d where d.id=l.bound_target_id and d.space_id=${spaceId} and d.deleted_at is null) then l.bound_target_id when l.bound_target_id is null and cardinality(l.candidates)=1 then l.candidates[1] else null end where ${affected}`,
    );
    await tx.execute(
      sql`update knowledge_links l set bound_target_id=coalesce(bound_target_id,target_id) where ${affected}`,
    );
    await tx.execute(
      sql`update knowledge_links l set status=case when target_id is not null then 'resolved' when cardinality(candidates)>1 then 'ambiguous' else 'missing' end where ${affected}`,
    );
  }
  /** Read-only graph projections. No document, canvas or relation writes. */
  async graph(
    userId: string,
    spaceId: string,
    input: {
      centerId?: string;
      cursor?: string;
      edgeCursor?: string;
      pageSize: number;
      folderId?: string;
      tag?: string;
    },
  ) {
    return this.transaction(async (tx) => {
      await this.actor(tx, userId);
      await this.authorize(tx, userId, spaceId);
      const filter = (alias: string) => {
        const a = sql.raw(alias);
        return sql`${a}.space_id=${spaceId} and ${a}.deleted_at is null
          ${input.folderId ? sql`and ${a}.folder_id=${input.folderId}` : sql``}
          ${input.tag ? sql`and exists(select 1 from knowledge_tags kt where kt.document_id=${a}.id and kt.tag=${input.tag})` : sql``}`;
      };
      const projection = sql`d.id,d.title,d.folder_id as "folderId",
        coalesce((select json_agg(t.tag order by t.tag) from knowledge_tags t where t.document_id=d.id),'[]'::json) tags,
        (select count(*)::int from knowledge_links l join knowledge_documents s on s.id=l.source_id join knowledge_documents t on t.id=l.target_id
          where l.status='resolved' and (l.source_id=d.id or l.target_id=d.id) and s.space_id=${spaceId} and t.space_id=${spaceId} and s.deleted_at is null and t.deleted_at is null) degree,
        (select count(*)::int from knowledge_links l where l.source_id=d.id and l.status<>'resolved') as "unresolvedCount"`;
      const edges = (
        extra: SQL,
      ) => sql`select l.source_id as source,l.target_id as target,count(*)::int as references
        from knowledge_links l join knowledge_documents s on s.id=l.source_id join knowledge_documents t on t.id=l.target_id
        where l.status='resolved' and s.space_id=${spaceId} and t.space_id=${spaceId} and s.deleted_at is null and t.deleted_at is null and ${extra}
        group by l.source_id,l.target_id order by l.source_id,l.target_id`;
      if (input.centerId) {
        const center = (
          await rows(
            tx,
            sql`select ${projection} from knowledge_documents d where d.id=${input.centerId} and d.space_id=${spaceId} and d.deleted_at is null`,
          )
        )[0];
        if (!center) fail("KNOWLEDGE_NOT_FOUND", "文档不存在或已删除", 404);
        const adjacent = sql`with adjacent as (
          select target_id id from knowledge_links where source_id=${input.centerId} and status='resolved'
          union select source_id id from knowledge_links where target_id=${input.centerId} and status='resolved'
        )`;
        const total = Number(
          (
            await rows(
              tx,
              sql`${adjacent} select count(*)::int total from knowledge_documents d join adjacent a on a.id=d.id where ${filter("d")} and d.id<>${input.centerId}`,
            )
          )[0].total,
        );
        const candidates = await rows(
          tx,
          sql`${adjacent} select ${projection} from knowledge_documents d join adjacent a on a.id=d.id where ${filter("d")} and d.id<>${input.centerId} ${input.cursor ? sql`and d.id>${input.cursor}::uuid` : sql``} order by d.id limit ${input.pageSize + 1}`,
        );
        const more = candidates.length > input.pageSize;
        const page = candidates.slice(0, input.pageSize);
        const ids = [center.id, ...page.map((n) => n.id)];
        const links = await rows(
          tx,
          edges(
            sql`l.source_id in (${sql.join(
              ids.map((id) => sql`${id}::uuid`),
              sql`,`,
            )}) and l.target_id in (${sql.join(
              ids.map((id) => sql`${id}::uuid`),
              sql`,`,
            )}) and (l.source_id=${center.id} or l.target_id=${center.id})`,
          ),
        );
        return {
          nodes: [center, ...page],
          edges: links,
          totalNodes: total + 1,
          totalEdges: null,
          nextCursor: more ? page.at(-1)!.id : null,
          nextEdgeCursor: null,
          centerId: center.id,
        };
      }
      const totalNodes = Number(
        (
          await rows(
            tx,
            sql`select count(*)::int total from knowledge_documents d where ${filter("d")}`,
          )
        )[0].total,
      );
      const candidates = await rows(
        tx,
        sql`select ${projection} from knowledge_documents d where ${filter("d")} ${input.cursor ? sql`and d.id>${input.cursor}::uuid` : sql``} order by d.id limit ${input.pageSize + 1}`,
      );
      const page = candidates.slice(0, input.pageSize);
      const edgeParts = input.edgeCursor?.split(":");
      const edgeFilter = sql`${filter("s")} and ${filter("t")}`;
      const edgePage = await rows(
        tx,
        sql`${edges(sql`${edgeFilter} ${edgeParts ? sql`and (l.source_id,l.target_id)>(${edgeParts[0]}::uuid,${edgeParts[1]}::uuid)` : sql``}`)} limit ${input.pageSize + 1}`,
      );
      const totalEdges = Number(
        (
          await rows(
            tx,
            sql`select count(*)::int total from (${edges(edgeFilter)}) e`,
          )
        )[0].total,
      );
      const links = edgePage.slice(0, input.pageSize),
        last = links.at(-1);
      return {
        nodes: page,
        edges: links,
        totalNodes,
        totalEdges,
        nextCursor: candidates.length > input.pageSize ? page.at(-1)!.id : null,
        nextEdgeCursor:
          edgePage.length > input.pageSize
            ? `${last!.source}:${last!.target}`
            : null,
        centerId: null,
      };
    });
  }
  async relations(userId: string, spaceId: string, id: string) {
    return this.run(userId, spaceId, false, async (tx) => {
      const d = await this.get(tx, spaceId, id);
      if (d.deleted_at) return { outgoing: [], backlinks: [] };
      const outgoing = await rows(
        tx,
        sql`select l.*,d.title target_title from knowledge_links l left join knowledge_documents d on d.id=l.target_id where source_id=${id} order by ordinal`,
      );
      for (const link of outgoing) {
        link.choices = link.candidates.length
          ? await rows(
              tx,
              sql`select id,title,folder_id from knowledge_documents where space_id=${spaceId} and deleted_at is null and id in (${sql.join(
                link.candidates.map(
                  (candidate: string) => sql`${candidate}::uuid`,
                ),
                sql`,`,
              )}) order by title,id`,
            )
          : [];
      }
      const backlinks = await rows(
        tx,
        sql`select distinct d.id,d.title,d.folder_id from knowledge_links l join knowledge_documents d on d.id=l.source_id where l.target_id=${id} and d.space_id=${spaceId} and d.deleted_at is null order by d.title,d.id`,
      );
      return { outgoing, backlinks };
    });
  }
}
