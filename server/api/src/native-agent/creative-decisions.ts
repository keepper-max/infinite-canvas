import { z } from "zod";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import type { KnowledgeService } from "../knowledge-service.js";
import { DomainError } from "../domain.js";
import { guardActor } from "./guard.js";
import { validateAgentSources } from "./sources.js";
export const CREATIVE_DECISION_PREFIX = "<!-- shoushou-creative-decisions:";
export const CREATIVE_DECISION_MARKER =
  "<!-- shoushou-creative-decisions:v1 -->\n";
const marker = CREATIVE_DECISION_MARKER;
const stableId = (s: string) => {
  const h = createHash("sha256").update(s).digest("hex");
  return (
    h.slice(0, 8) +
    "-" +
    h.slice(8, 12) +
    "-5" +
    h.slice(13, 16) +
    "-a" +
    h.slice(17, 20) +
    "-" +
    h.slice(20, 32)
  );
};
const source = z
  .object({
    runId: z.string().uuid(),
    sessionId: z.string().uuid(),
    runRevision: z.number().int(),
    userItemId: z.string(),
    evidence: z.string(),
    sources: z.array(z.any()),
  })
  .strict();
const record = z
  .object({
    version: z.literal(1),
    actorId: z.string().uuid(),
    projectId: z.string().uuid(),
    enabled: z.boolean(),
    lastOperation: z
      .object({ id: z.string().uuid(), requestHash: z.string() })
      .optional(),
    decisions: z.array(
      z.object({
        id: z.string().uuid(),
        text: z.string().trim().min(1),
        source,
        editedByUser: z.boolean(),
      }),
    ),
  })
  .strict();
const change = z
  .object({
    operationId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    action: z.enum(["enable", "disable", "save", "remove"]),
    id: z.string().uuid().optional(),
    text: z.string().trim().min(1).optional(),
    runId: z.string().uuid().optional(),
    runRevision: z.number().int().optional(),
    evidence: z.string().optional(),
  })
  .strict();
export class CreativeDecisionService {
  constructor(
    private knowledge: KnowledgeService,
    private pool: Pool,
  ) {}
  private authorize(actorId: string, projectId: string) {
    return this.knowledge.db.transaction((tx) =>
      guardActor(tx, { actorId, projectId }),
    );
  }
  private async document(actorId: string, projectId: string) {
    await this.authorize(actorId, projectId);
    const candidates = (
      await this.pool.query(
        "select d.id,d.space_id,d.markdown from knowledge_documents d join knowledge_spaces s on s.id=d.space_id where s.kind='personal' and s.owner_user_id=$1 and d.deleted_at is null and left(d.markdown,$2)=$3 order by d.created_at",
        [actorId, CREATIVE_DECISION_PREFIX.length, CREATIVE_DECISION_PREFIX],
      )
    ).rows;
    for (const d of candidates) {
      if (!d.markdown.startsWith(marker))
        throw new DomainError(
          "AGENT_DECISION_FORMAT",
          "创作决定版本无法识别，原记录已保留",
          409,
        );
      let raw: any;
      try {
        raw = JSON.parse(d.markdown.slice(marker.length));
      } catch {
        throw new DomainError(
          "AGENT_DECISION_FORMAT",
          "创作决策格式损坏，原文已保留，不能自动覆盖",
          409,
        );
      }
      if (raw.projectId !== projectId) continue;
      const parsed = record.safeParse(raw);
      if (!parsed.success || parsed.data.actorId !== actorId)
        throw new DomainError(
          "AGENT_DECISION_FORMAT",
          "创作决策版本或归属无法核验，原文已保留",
          409,
        );
      return {
        doc: await this.knowledge.read(actorId, d.space_id, d.id),
        value: parsed.data,
      };
    }
    return null;
  }
  async list(actorId: string, projectId: string) {
    const existing = await this.document(actorId, projectId);
    if (!existing) return { enabled: false, revision: 0, decisions: [] };
    const decisions = [];
    for (const d of existing.value.decisions) {
      try {
        const run = (
          await this.pool.query(
            "select * from native_agent_runs where id=$1 and actor_id=$2 and project_id=$3",
            [d.source.runId, actorId, projectId],
          )
        ).rows[0];
        if (!run) throw Error();
        await validateAgentSources(this.knowledge, {
          actor_id: actorId,
          project_id: projectId,
          sources: d.source.sources,
        });
        await validateAgentSources(this.knowledge, run);
        decisions.push({ ...d, available: true });
      } catch {
        decisions.push({
          id: d.id,
          text: "来源已不可访问，此决定不再用于模型上下文",
          available: false,
        });
      }
    }
    return {
      enabled: existing.value.enabled,
      revision: existing.doc.revision,
      decisions,
    };
  }
  async context(actorId: string, projectId: string) {
    const value = await this.list(actorId, projectId).catch(
      (error: unknown) => {
        if (
          error instanceof DomainError &&
          error.code === "KNOWLEDGE_NOT_ENABLED"
        )
          return { enabled: false, revision: 0, decisions: [] };
        throw error;
      },
    );
    return value.enabled
      ? value.decisions
          .filter((d) => d.available)
          .map((d: any) => ({
            text: d.text,
            source: d.source,
            confirmedByUser: true,
            decisionRevision: value.revision,
          }))
      : [];
  }
  async write(actorId: string, projectId: string, raw: unknown) {
    const p = change.parse(raw);
    await this.authorize(actorId, projectId);
    const requestHash = createHash("sha256")
      .update(JSON.stringify(p))
      .digest("hex");
    const replay = (
      await this.pool.query(
        "select receipt from knowledge_operations where actor_id=$1 and operation_id=$2",
        [actorId, p.operationId],
      )
    ).rows[0]?.receipt;
    if (replay) {
      let original: any;
      try {
        original = record.parse(
          JSON.parse(replay.markdown.slice(marker.length)),
        );
      } catch {
        throw new DomainError(
          "AGENT_DECISION_OPERATION_MISMATCH",
          "该操作标识不属于创作决定",
          409,
        );
      }
      if (
        original.actorId !== actorId ||
        original.projectId !== projectId ||
        original.lastOperation?.requestHash !== requestHash
      )
        throw new DomainError(
          "AGENT_DECISION_OPERATION_MISMATCH",
          "同一操作标识不能保存不同创作决定",
          409,
        );
      return {
        persisted: true,
        replayed: true,
        revision: replay.revision,
        enabled: original.enabled,
      };
    }
    let existing = await this.document(actorId, projectId);
    if (!existing) {
      if (p.expectedRevision !== 0)
        throw new DomainError(
          "AGENT_DECISION_CONFLICT",
          "创作决定已变化，请重新读取",
          409,
        );
      const space = await this.knowledge.createSpace(
        actorId,
        "personal",
        null,
        stableId("decision-space:" + actorId),
      );
      const value = {
        version: 1 as const,
        actorId,
        projectId,
        enabled: false,
        decisions: [],
      };
      const created = await this.knowledge.write(
        actorId,
        space.id,
        {
          operationId: stableId("decisions:" + actorId + ":" + projectId),
          action: "document.create",
          payload: {
            title: "创作决定（仅本人）",
            markdown: marker + JSON.stringify(value),
            folderId: null,
          },
        },
        (tx) => guardActor(tx, { actorId, projectId }),
      );
      existing = { doc: created as any, value };
    }
    // Existing operation receipts are consulted before revision checks by KnowledgeService.
    const value = structuredClone(existing.value) as z.infer<typeof record>;
    value.lastOperation = { id: p.operationId, requestHash };
    if (p.action === "enable") value.enabled = true;
    if (p.action === "disable") value.enabled = false;
    if (p.action === "remove")
      value.decisions = value.decisions.filter((d) => d.id !== p.id);
    if (p.action === "save") {
      if (!p.text)
        throw new DomainError(
          "AGENT_DECISION_INVALID",
          "请明确输入要保存的创作决定",
          422,
        );
      if (
        /(?:sk-[a-z0-9]{16,}|(?:api[_-]?key|password|密码)\s*[:=]\s*\S+)/i.test(
          p.text + "\n" + (p.evidence ?? ""),
        )
      )
        throw new DomainError(
          "AGENT_DECISION_SENSITIVE",
          "不能将凭据写入创作决定，请删除敏感内容",
          422,
        );
      const old = value.decisions.find((d) => d.id === p.id);
      if (old) {
        old.text = p.text;
        old.editedByUser = true;
      } else {
        const run = (
          await this.pool.query(
            "select * from native_agent_runs where id=$1 and actor_id=$2 and project_id=$3",
            [p.runId, actorId, projectId],
          )
        ).rows[0];
        if (
          !run ||
          run.status !== "completed" ||
          run.revision !== p.runRevision
        )
          throw new DomainError(
            "AGENT_DECISION_CONFLICT",
            "请从当前已完成对话确认决定来源",
            409,
          );
        await validateAgentSources(this.knowledge, run);
        const message = (
          await this.pool.query(
            "select item_id,content from native_agent_messages where run_id=$1 and role='user'",
            [run.id],
          )
        ).rows.find((m) => p.evidence && m.content.includes(p.evidence));
        if (!message)
          throw new DomainError(
            "AGENT_DECISION_EVIDENCE",
            "请选择用户原话作为确认依据，模型建议不会自动记忆",
            422,
          );
        value.decisions.push({
          id: p.id ?? p.operationId,
          text: p.text,
          source: {
            runId: run.id,
            sessionId: run.session_id,
            runRevision: run.revision,
            userItemId: message.item_id,
            evidence: p.evidence!,
            sources: run.sources,
          },
          editedByUser: true,
        });
      }
    }
    const expected = p.expectedRevision === 0 ? 1 : p.expectedRevision;
    const saved = await this.knowledge.write(
      actorId,
      existing.doc.spaceId,
      {
        operationId: p.operationId,
        action: "document.save",
        payload: {
          id: existing.doc.id,
          expectedRevision: expected,
          title: existing.doc.title,
          markdown: marker + JSON.stringify(value),
          folderId: null,
        },
      },
      async (tx) => {
        await guardActor(tx, { actorId, projectId });
      },
    );
    return {
      persisted: true,
      revision: saved.revision,
      enabled: value.enabled,
    };
  }
}
