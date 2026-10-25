import { validateAgentSources } from "./sources.js";
import { KnowledgeService } from "../knowledge-service.js";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { ModelMessage } from "ai";
import { DomainError } from "../domain.js";
import { guardActor, type AgentTx } from "./guard.js";
import type { AgentActor } from "./contracts.js";
export const PAID_AGENT_UPSTREAM = "doubao-seed-2-1-lite-260915";
// Official full 1024k input window at CNY0.8/M + hard 2000 output at CNY2.7/M.
// Include the platform 1.2 markup and point rounding in the user RMB budget.
// Reserve the full model window, not a different model's tokenizer estimate.
export const PAID_AGENT_QUOTE_CENTS = 100;
export function nativeModelRoute(modelId: string) {
  if (modelId === "volcengine_ark.text." + PAID_AGENT_UPSTREAM)
    return {
      modelId,
      providerId: "volcengine_ark",
      upstreamModel: PAID_AGENT_UPSTREAM,
      quoteCents: PAID_AGENT_QUOTE_CENTS,
      name: "豆包 Seed 2.1 Lite",
    };
  if (modelId === "catalog.text.qwen3.5-flash")
    return {
      modelId,
      providerId: "token360",
      upstreamModel: "qwen3.5-flash",
      quoteCents: 12,
      name: "Qwen3.5 Flash",
    };
  if (modelId === "catalog.text.gpt-4.1-mini")
    return {
      modelId,
      providerId: "token360",
      upstreamModel: "gpt-4.1-mini",
      quoteCents: 12,
      name: "GPT-4.1 Mini",
    };
  throw new DomainError(
    "AGENT_MODEL_UNAVAILABLE",
    "此模型尚未核验工具调用与费用边界",
    409,
  );
}
export const nativeModelHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export type NativeModelJobInput = {
  actor: AgentActor;
  stepId: string;
  messages: ModelMessage[];
  mode: "advice" | "execute";
  payloadHash: string;
  quoteCents: number;
  modelId: string;
};
export async function bindNativeModelJob(
  client: PoolClient,
  jobId: string,
  input: NativeModelJobInput,
) {
  await guardActor(
    drizzle(client) as unknown as AgentTx,
    input.actor,
    input.mode === "execute",
  );
  await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
    "native-agent-write:" + input.actor.runId,
  ]);
  const run = (
    await client.query(
      "select * from native_agent_runs where id=$1 and actor_id=$2 and project_id=$3 for update",
      [input.actor.runId, input.actor.actorId, input.actor.projectId],
    )
  ).rows[0];
  const step = (
    await client.query(
      "select id from native_agent_steps where id=$1 and run_id=$2 and kind='model' and status='submitting'",
      [input.stepId, input.actor.runId],
    )
  ).rows[0];
  if (!run || !step || run.cancel_requested || run.status !== "planning")
    throw new DomainError(
      "AGENT_MODEL_STOPPED",
      "任务已取消或模型步骤不处于可提交状态",
      409,
    );
  await validateAgentSources(new KnowledgeService(drizzle(client) as any), run);
  const policy = (
    await client.query(
      "select value from platform_settings where key='native_agent_policy' for share",
    )
  ).rows[0]?.value;
  const budget = Math.min(
    Number(run.budget_cents),
    Number(policy?.maxBudgetCents ?? run.budget_cents),
  );
  if (
    input.quoteCents !== nativeModelRoute(input.modelId).quoteCents ||
    Number(run.spent_cents) + Number(run.reserved_cents) + input.quoteCents >
      budget
  )
    throw new DomainError(
      "AGENT_COST_LIMIT",
      "剩余人民币预算不足以覆盖本轮模型最大费用；未调用供应商",
      409,
    );
  await client.query(
    "insert into native_agent_model_jobs(step_id,job_id,run_id,actor_id,payload_hash,quote_cents) values($1,$2,$3,$4,$5,$6)",
    [
      input.stepId,
      jobId,
      input.actor.runId,
      input.actor.actorId,
      input.payloadHash,
      input.quoteCents,
    ],
  );
  await client.query(
    "update native_agent_runs set reserved_cents=reserved_cents+$2 where id=$1",
    [input.actor.runId, input.quoteCents],
  );
}

export async function assertNativeJobVisible(
  client: Pick<PoolClient, "query">,
  jobId: string,
  actorId: string,
) {
  const record = (
    await client.query(
      "select r.* from native_agent_model_jobs j join native_agent_runs r on r.id=j.run_id where j.job_id=$1",
      [jobId],
    )
  ).rows[0];
  if (!record || record.actor_id !== actorId)
    throw new DomainError("JOB_NOT_FOUND", "任务不存在或不属于当前用户", 404);
  const db = drizzle(client as PoolClient);
  await guardActor(db as unknown as AgentTx, {
    actorId,
    projectId: record.project_id,
  });
  await validateAgentSources(new KnowledgeService(db as any), {
    actor_id: actorId,
    project_id: record.project_id,
    sources: record.sources,
  });
}
