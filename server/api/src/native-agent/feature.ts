import { sql } from "drizzle-orm";
import type { PlatformDatabase } from "../db/client.js";
import { DomainError } from "../domain.js";
type Tx = Parameters<Parameters<PlatformDatabase["transaction"]>[0]>[0];
export async function requireNativeAgentFeature(
  tx: Tx,
  actorId: string,
  lock = true,
) {
  const actor = await tx.execute(
    sql`select id from users where id=${actorId} and account_status='active' ${lock ? sql`for share` : sql``}`,
  );
  if (!actor.rows.length)
    throw new DomainError("UNAUTHENTICATED", "账号不存在或已停用", 401);
  const grant = await tx.execute(
    sql`select enabled from user_feature_grants where user_id=${actorId} and feature='native_agent' ${lock ? sql`for share` : sql``}`,
  );
  if (
    !(grant.rows.length
      ? grant.rows[0].enabled === true
      : process.env.NATIVE_AGENT_DEFAULT_ENABLED === "true")
  )
    throw new DomainError(
      "NATIVE_AGENT_NOT_ENABLED",
      "当前账号尚未开放原生 Agent",
      403,
    );
  if (process.env.NATIVE_AGENT_ENABLED !== "true")
    throw new DomainError(
      "NATIVE_AGENT_UNAVAILABLE",
      "原生 Agent 当前未启用",
      503,
    );
}
