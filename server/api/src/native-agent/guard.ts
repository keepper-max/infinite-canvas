import { sql } from "drizzle-orm";
import type { PlatformDatabase } from "../db/client.js";
import { DomainError } from "../domain.js";
import { hasProjectAccess, hasProjectEditAccess } from "../repository.js";
import { requireNativeAgentFeature } from "./feature.js";
import type { AgentActor } from "./contracts.js";
export type AgentTx = Parameters<
  Parameters<PlatformDatabase["transaction"]>[0]
>[0];
export async function guardActor(
  tx: AgentTx,
  actor: Pick<AgentActor, "actorId" | "projectId">,
  write = false,
) {
  await requireNativeAgentFeature(tx, actor.actorId);
  if (write) {
    const policy = (
      await tx.execute(
        sql`select value from platform_settings where key='native_agent_policy' for share`,
      )
    ).rows[0]?.value as any;
    if (policy?.enabled === false)
      throw new DomainError(
        "AGENT_DISABLED",
        "Agent写入已暂停，已保存数据和读取保留",
        403,
      );
  }
  await tx.execute(
    sql`select p.id from projects p join project_members m on m.project_id=p.id where p.id=${actor.projectId} and m.user_id=${actor.actorId} and p.deleted_at is null for share of p,m`,
  );
  if (
    !(await (write ? hasProjectEditAccess : hasProjectAccess)(
      tx,
      actor.projectId,
      actor.actorId,
    ))
  )
    throw new DomainError("PROJECT_FORBIDDEN", "项目不存在或权限已撤销", 403);
}
// Cancellation and committed business writes serialize on this lock. No claim of rollback after commit.
export async function guardWrite(tx: AgentTx, actor: AgentActor) {
  await guardActor(tx, actor, true);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${"native-agent-write:" + actor.runId},0))`,
  );
  const r = await tx.execute(
    sql`select id from native_agent_runs where id=${actor.runId} and actor_id=${actor.actorId} and project_id=${actor.projectId} and status='running' and not cancel_requested`,
  );
  if (!r.rows.length)
    throw new DomainError(
      "AGENT_WRITE_STOPPED",
      "任务已取消或不处于已批准执行状态",
      409,
    );
}
