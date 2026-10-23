import { randomBytes, createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { PlatformDatabase } from "./db/client.js";
import type { CanvasWrite } from "./canvas-contract.js";
import { DomainError } from "./domain.js";
import { requireKnowledgeFeature } from "./knowledge-feature.js";
type Tx = Parameters<Parameters<PlatformDatabase["transaction"]>[0]>[0];
export const knowledgeAcknowledgement = (
  nodes: { id: string; type: string; metadata?: Record<string, unknown> }[],
) =>
  nodes
    .filter((n) => n.type === "knowledge:document")
    .map((n) => ({
      id: n.id,
      reference: n.metadata?.knowledgeReference ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const upgrade = () =>
  new DomainError(
    "CANVAS_CLIENT_UPGRADE_REQUIRED",
    "此画布包含知识节点，请刷新或升级客户端后再保存；原文和历史未改变",
    409,
  );
export async function issueWriteCapability(
  tx: Tx,
  actor: string,
  project: string,
  expectedRevision: number,
  ack: unknown,
) {
  await requireKnowledgeFeature(tx, actor);
  const nodes = await tx.execute(
    sql`select id,data from canvas_nodes where project_id=${project} and node_type='knowledge:document' order by id`,
  );
  const actual = nodes.rows.map((n) => ({
    id: n.id,
    reference: (n.data as any)?.metadata?.knowledgeReference ?? null,
  }));
  const equal = await tx.execute(
    sql`select ${JSON.stringify(actual)}::jsonb = ${JSON.stringify(ack)}::jsonb ok`,
  );
  if (!equal.rows[0]?.ok) throw upgrade();
  const token = randomBytes(32).toString("hex");
  await tx.execute(
    sql`insert into canvas_write_capabilities(token_hash,actor_id,project_id,canvas_revision,knowledge_nodes) values(${hash(token)},${actor},${project},${expectedRevision},${JSON.stringify(actual)}::jsonb)`,
  );
  return { token, revision: expectedRevision };
}
export async function validateKnowledgeCanvasWrite(
  tx: Tx,
  actor: string,
  project: string,
  write: CanvasWrite,
  trusted: false | "append" | "restore",
) {
  const current = await tx.execute(
    sql`select id,data from canvas_nodes where project_id=${project} and node_type='knowledge:document'`,
  );
  if (
    !current.rows.length &&
    !write.nodes.some((n) => n.type === "knowledge:document")
  )
    return;
  await requireKnowledgeFeature(tx, actor);
  if (trusted === "append") {
    const before = current.rows.map((n) => ({
      id: n.id,
      reference: (n.data as any)?.metadata?.knowledgeReference ?? null,
    }));
    const match = await tx.execute(
      sql`select ${JSON.stringify(before)}::jsonb <@ ${JSON.stringify(knowledgeAcknowledgement(write.nodes))}::jsonb ok`,
    );
    if (!match.rows[0]?.ok)
      throw new DomainError(
        "CANVAS_KNOWLEDGE_OMISSION",
        "服务端追加操作不得移除或改写已有知识引用",
        409,
      );
    return;
  }
  if (trusted === "restore") return; // Dedicated server-selected history, not arbitrary client graph.
  const proof = write.writeCapability;
  if (!proof) throw upgrade();
  const result = await tx.execute(
    sql`select * from canvas_write_capabilities where token_hash=${hash(proof.token)} and actor_id=${actor} and project_id=${project} and canvas_revision=${write.expectedRevision} and consumed_at is null for update`,
  );
  if (!result.rows.length) throw upgrade();
  const omitted = current.rows
    .map((n) => String(n.id))
    .filter((id) => !write.nodes.some((n) => n.id === id))
    .sort();
  if (
    JSON.stringify(omitted) !==
    JSON.stringify([...new Set(proof.deletedKnowledgeNodeIds)].sort())
  )
    throw new DomainError(
      "CANVAS_KNOWLEDGE_OMISSION",
      "知识节点未被完整保留；请确认明确删除的节点或刷新客户端",
      409,
    );
  await tx.execute(
    sql`update canvas_write_capabilities set consumed_at=now() where token_hash=${hash(proof.token)}`,
  );
}
