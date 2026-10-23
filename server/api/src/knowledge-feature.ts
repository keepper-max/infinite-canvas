import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import type { PlatformDatabase } from "./db/client.js";
import { DomainError } from "./domain.js";
type Tx = Parameters<Parameters<PlatformDatabase["transaction"]>[0]>[0];
const denied = () =>
  new DomainError(
    "KNOWLEDGE_NOT_ENABLED",
    "此账号尚未开放知识功能，请联系管理员申请测试授权",
    403,
  );
export function assertKnowledgeGenerationEnabled(sources: unknown) {
  if (Array.isArray(sources) && sources.length && process.env.KNOWLEDGE_GENERATION_ENABLED !== "true" && (process.env.NODE_ENV === "production" || process.env.KNOWLEDGE_GENERATION_ENABLED === "false"))
    throw new DomainError("KNOWLEDGE_GENERATION_RESTRICTED", "知识参与模型生成尚未开放；知识编辑、图谱和画布引用仍可使用", 403);
}
export async function hasKnowledgeFeature(tx: Tx, userId: string, lock = true) {
  const r = await tx.execute(
    sql`select id from users where id=${userId} and account_status='active' ${lock ? sql`for share` : sql``}`,
  );
  if (!r.rows.length) return false;
  const grant = await tx.execute(sql`select enabled from user_feature_grants where user_id=${userId} and feature='knowledge' ${lock ? sql`for share` : sql``}`);
  return grant.rows.length ? grant.rows[0].enabled === true : process.env.KNOWLEDGE_DEFAULT_ENABLED === "true";
}
export async function requireKnowledgeFeature(tx: Tx, userId: string) {
  if (!(await hasKnowledgeFeature(tx, userId))) throw denied();
}
export async function requireKnowledgeFeaturePg(
  db: Pick<Pool, "query">,
  userId: string,
) {
  const r = await db.query(
    "select id from users where id=$1 and account_status='active' for share",
    [userId],
  );
  if (!r.rows.length) throw denied();
  const grant = await db.query("select enabled from user_feature_grants where user_id=$1 and feature='knowledge' for share", [userId]);
  if (!(grant.rows.length ? grant.rows[0].enabled === true : process.env.KNOWLEDGE_DEFAULT_ENABLED === "true")) throw denied();
}
