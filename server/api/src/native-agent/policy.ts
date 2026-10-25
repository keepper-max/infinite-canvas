import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Pool } from "pg";
import type { ProviderConfig } from "../config.js";
import type { KnowledgeService } from "../knowledge-service.js";
import type { ModelGateway } from "../model-gateway.js";
import { DomainError } from "../domain.js";
import { AGENT_LIMITS } from "./limits.js";
import { nativeModelRoute } from "./model-job-policy.js";
import { registry, currentCanvasProbeSchema } from "./tools.js";
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (
  code: string,
  message: string,
  status: 403 | 409 | 422 = 409,
): never => {
  throw new DomainError(code, message, status);
};
const limit = z
  .object({
    rounds: z.number().int().min(1).max(16),
    tools: z.number().int().min(1).max(32),
    totalTokens: z.number().int().min(1).max(64000),
    contextTokens: z.literal(12000),
    outputTokens: z.literal(2000),
    activeMs: z.number().int().min(1).max(900000),
    perUser: z.literal(1),
    concurrency: z.number().int().min(1).max(2),
    modelMs: z.literal(60000),
    toolMs: z.literal(30000),
    failures: z.literal(1),
  })
  .strict();
export const agentPolicyInput = z
  .object({
    expectedVersion: z.number().int().positive(),
    operationId: z.string().uuid(),
    reason: z.string().trim().min(1),
    enabled: z.boolean(),
    defaultModelId: z.string().nullable(),
    allowedModelIds: z
      .array(z.string())
      .refine((a) => new Set(a).size === a.length),
    userModelSelectionEnabled: z.boolean(),
    maxBudgetCents: z.number().int().nonnegative().safe(),
    knowledgeReasoningEnabled: z.boolean(),
    limits: limit,
  })
  .strict();
export type AgentPolicy = {
  version: number;
  enabled: boolean;
  defaultModelId: string | null;
  allowedModelIds: string[];
  userModelSelectionEnabled: boolean;
  maxBudgetCents: number;
  knowledgeReasoningEnabled: boolean;
  limits: typeof AGENT_LIMITS;
};
/** Reuses platform settings, catalog, auth and audit; contains no provider credentials. */
export class NativeAgentPolicyService {
  constructor(
    readonly knowledge: KnowledgeService,
    readonly pool: Pool,
    private gateway: ModelGateway,
    private providers: Record<string, ProviderConfig | undefined>,
    private adminEmails: string[] = [],
  ) {}
  async get(): Promise<AgentPolicy> {
    const r = await this.pool.query(
      "select value from platform_settings where key='native_agent_policy'",
    );
    if (!r.rows.length)
      fail("AGENT_POLICY_UNAVAILABLE", "Agent服务端策略尚未初始化");
    return r.rows[0].value;
  }
  async requireAdmin(actor: string) {
    const r = await this.pool.query(
      "select id from users where id=$1 and account_status='active' and (is_admin=true or lower(email)=any($2::text[]))",
      [actor, this.adminEmails],
    );
    if (!r.rowCount) fail("ADMIN_FORBIDDEN", "需要管理员权限", 403);
  }
  async candidate(modelId: string) {
    const route = nativeModelRoute(modelId),
      provider = this.providers[route.providerId];
    if (!provider?.apiKey)
      fail("AGENT_PROVIDER_UNCONFIGURED", "供应商凭据未配置，不能标记可用");
    const compiled = await this.gateway.compile({
      modelId,
      capability: "text",
      mode: "chat",
      prompt: "Agent工具能力核验",
    });
    if (
      compiled.providerId !== route.providerId ||
      compiled.upstreamModel !== route.upstreamModel
    )
      fail("AGENT_MODEL_BINDING_INVALID", "模型目录与已核验适配器不一致");
    const definitionHash = hash({
      route,
      protocol: 1,
      currentCanvasProbeSchema: z.toJSONSchema(currentCanvasProbeSchema),
      schemas: Object.fromEntries(
        Object.entries(registry).map(([id, t]) => [
          id,
          z.toJSONSchema(t.inputSchema),
        ]),
      ),
      contextTokens: AGENT_LIMITS.contextTokens,
      outputTokens: AGENT_LIMITS.outputTokens,
    });
    const declared = Number(
      (
        await this.pool.query(
          "select catalog_metadata->>'llm_context_length' as capacity from model_catalog where id=$1",
          [modelId],
        )
      ).rows[0]?.capacity,
    );
    return {
      route,
      definitionHash,
      credentialHash: hash({
        provider: route.providerId,
        baseUrl: provider!.baseUrl,
        keyFingerprint: hash(provider!.apiKey),
      }),
      contextLimit:
        Number.isSafeInteger(declared) && declared > 0 ? declared : null,
    };
  }
  async verified(modelId: string) {
    const candidate = await this.candidate(modelId);
    const result = await this.pool.query(
      "select id,run_id,capabilities,finished_at from native_agent_model_verifications where model_id=$1 and status='passed' and definition_hash=$2 and credential_hash=$3 order by created_at desc limit 1",
      [modelId, candidate.definitionHash, candidate.credentialHash],
    );
    if (!result.rowCount)
      fail(
        "AGENT_MODEL_UNVERIFIED",
        "该模型尚未通过当前配置的真实工具调用与费用核验",
      );
    return { ...candidate, verification: result.rows[0] };
  }
  async publicModels() {
    const settings = await this.get(),
      models = [];
    for (const id of settings.userModelSelectionEnabled
      ? settings.allowedModelIds
      : settings.defaultModelId
        ? [settings.defaultModelId]
        : []) {
      try {
        const verified = await this.verified(id);
        models.push({
          id,
          name: verified.route.name,
          substitute: false,
          capabilities: {
            toolCalling: true,
            structuredParameters: true,
            streamingToolCalls: true,
            contextCapacityTokens: verified.contextLimit,
            runtimeContextLimitTokens: AGENT_LIMITS.contextTokens,
            verificationId: verified.verification.id,
          },
        });
      } catch {
        /* Disabled, stale or unconfigured routes remain unavailable. */
      }
    }
    return models;
  }
  async selection(modelId: string, budgetCents: number, probe = false) {
    const settings = await this.get();
    if (!settings.enabled) fail("AGENT_DISABLED", "管理员已暂停新Agent执行");
    if (budgetCents > settings.maxBudgetCents)
      fail("AGENT_COST_LIMIT", "运行预算超过平台上限");
    if (probe) await this.candidate(modelId);
    else {
      if (
        !settings.allowedModelIds.includes(modelId) ||
        (!settings.userModelSelectionEnabled &&
          modelId !== settings.defaultModelId)
      )
        fail("AGENT_MODEL_FORBIDDEN", "所选模型不在管理员开放范围", 403);
      await this.verified(modelId);
    }
    return settings;
  }
  async assertRun(run: any) {
    const settings = await this.get();
    if (!settings.enabled)
      fail("AGENT_DISABLED", "Agent已紧急暂停，已保存结果和历史保留");
    if (run.purpose === "model_probe") {
      const verification = await this.pool.query(
        "select 1 from native_agent_model_verifications where run_id=$1 and model_id=$2 and status='pending'",
        [run.id, run.model_id],
      );
      if (!verification.rowCount)
        fail("AGENT_PROBE_INVALID", "模型核验任务身份不一致");
      await this.requireAdmin(run.actor_id);
      await this.candidate(run.model_id);
    } else {
      if (!settings.allowedModelIds.includes(run.model_id))
        fail(
          "AGENT_MODEL_FORBIDDEN",
          "该模型已从执行范围移除，任务暂停且不切换模型",
          403,
        );
      await this.verified(run.model_id);
    }
    return settings;
  }
  async save(actor: string, raw: unknown) {
    await this.requireAdmin(actor);
    const p = agentPolicyInput.parse(raw);
    if (p.defaultModelId && !p.allowedModelIds.includes(p.defaultModelId))
      fail("AGENT_POLICY_INVALID", "默认模型必须属于开放列表");
    if (p.allowedModelIds.length && !p.defaultModelId)
      fail("AGENT_POLICY_INVALID", "开放模型时必须设置默认模型");
    if (p.enabled) for (const id of p.allowedModelIds) await this.verified(id);
    return this.knowledge.db.transaction(async (tx) => {
      const old = (
        await tx.execute(
          sql`select value from platform_settings where key='native_agent_policy' for update`,
        )
      ).rows[0].value as AgentPolicy;
      const prior = (
        await tx.execute(
          sql`select metadata from admin_audit_logs where actor_user_id=${actor} and action='native_agent.policy.update' and metadata->>'operationId'=${p.operationId}`,
        )
      ).rows[0];
      const digest = hash(p);
      if (prior) {
        if ((prior.metadata as any).payloadHash !== digest)
          fail("AGENT_OPERATION_MISMATCH", "配置操作ID已用于不同内容");
        return (prior.metadata as any).result;
      }
      if (old.version !== p.expectedVersion)
        fail("AGENT_POLICY_CONFLICT", "配置已变化，请重新读取");
      const { expectedVersion, operationId, reason, ...value } = p;
      const result = { ...value, version: old.version + 1 };
      await tx.execute(
        sql`update platform_settings set value=${JSON.stringify(result)}::jsonb,updated_by=${actor},updated_at=now() where key='native_agent_policy'`,
      );
      await tx.execute(
        sql`insert into admin_audit_logs(actor_user_id,action,target_type,target_id,metadata) values(${actor},'native_agent.policy.update','platform_setting','native_agent_policy',${JSON.stringify({ operationId, reason, payloadHash: digest, before: old, result })}::jsonb)`,
      );
      return result;
    });
  }
  async finishProbe(runId: string) {
    const r = (
      await this.pool.query(
        "select r.*,v.definition_hash,v.credential_hash from native_agent_runs r join native_agent_model_verifications v on v.run_id=r.id where r.id=$1 and v.status='pending'",
        [runId],
      )
    ).rows[0];
    if (
      !r ||
      ![
        "completed",
        "failed",
        "paused",
        "cancelled",
        "awaiting_manual_review",
      ].includes(r.status)
    )
      return;
    let status = "failed",
      reason = r.error_code ?? "MODEL_PROTOCOL_NOT_PROVEN",
      metrics: any = {};
    try {
      const c = await this.candidate(r.model_id),
        tools = await this.pool.query(
          "select count(*)::int n from native_agent_steps where run_id=$1 and kind='tool' and tool_name='get_canvas_state' and status='completed'",
          [runId],
        ),
        usage = await this.pool.query(
          "select count(*)::int calls,count(*) filter(where m.status='settled' and g.credit_status in ('charged','free') and g.cost_cny is not null)::int settled,coalesce(sum(g.cost_cny),0)::text supplier_cny,coalesce(sum(g.credit_points),0)::text charged_points from native_agent_model_jobs m left join generation_usage g on g.job_id=m.job_id where m.run_id=$1",
          [runId],
        );
      metrics = {
        ...usage.rows[0],
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        errorCode: r.error_code,
      };
      if (
        r.status === "completed" &&
        tools.rows[0].n > 0 &&
        usage.rows[0].calls > 0 &&
        usage.rows[0].calls === usage.rows[0].settled &&
        c.definitionHash === r.definition_hash &&
        c.credentialHash === r.credential_hash
      ) {
        status = "passed";
        reason = "ACTUAL_TOOL_CALL_AND_BILLING_VERIFIED";
      }
    } catch (e) {
      reason = e instanceof DomainError ? e.code : "MODEL_VERIFICATION_FAILED";
    }
    await this.knowledge.db.transaction(async (tx) => {
      await tx.execute(
        sql`update native_agent_model_verifications set status=${status},capabilities=${JSON.stringify({ toolCalling: status === "passed", objectSchema: status === "passed", runtimeContextLimitTokens: AGENT_LIMITS.contextTokens, reason })}::jsonb,metrics=${JSON.stringify(metrics)}::jsonb,finished_at=now() where run_id=${runId} and status='pending'`,
      );
      await tx.execute(
        sql`insert into admin_audit_logs(actor_user_id,action,target_type,target_id,metadata) values(${r.actor_id},'native_agent.model.verify','native_agent_run',${runId},${JSON.stringify({ modelId: r.model_id, status, reason })}::jsonb)`,
      );
    });
  }
  async admin(actor: string) {
    await this.requireAdmin(actor);
    const settings = await this.get(),
      catalog = (
        await this.pool.query(
          "select c.id,c.display_name,c.provider_id,c.enabled,c.healthy,c.catalog_metadata->>'llm_context_length' as context_limit_tokens,p.limits from model_catalog c join model_capabilities p on p.model_id=c.id where c.capability='text' order by c.display_name",
        )
      ).rows,
      models = [];
    for (const item of catalog) {
      let verified = false,
        reason = "",
        verification: any = null,
        supported = false,
        configured = false;
      try {
        const route = nativeModelRoute(item.id);
        supported = true;
        configured = !!this.providers[route.providerId]?.apiKey;
        const v = await this.verified(item.id);
        verified = true;
        verification = v.verification;
      } catch (e) {
        reason = e instanceof DomainError ? e.message : "模型尚未可用";
      }
      models.push({
        ...item,
        supported,
        credentialConfigured: configured,
        verified,
        verification,
        reason,
        agentEnabled: settings.allowedModelIds.includes(item.id),
      });
    }
    const usage = (
      await this.pool.query(
        "select r.model_id,count(distinct r.id)::int runs,count(distinct r.id) filter(where r.status in ('failed','paused','awaiting_manual_review'))::int failures,coalesce(sum(u.input_tokens),0)::text input_tokens,coalesce(sum(u.output_tokens),0)::text output_tokens,coalesce(sum(g.cost_cny),0)::text supplier_cny,coalesce(sum(g.credit_points),0)::text charged_points from native_agent_runs r left join native_agent_usage u on u.run_id=r.id left join generation_usage g on g.job_id=u.job_id group by r.model_id",
      )
    ).rows;
    const runs = (
      await this.pool.query(
        "select id,session_id,operation_id,project_id,actor_id,model_id,status,purpose,revision,rounds,input_tokens,output_tokens,budget_cents,spent_cents,reserved_cents,error_code,created_at from native_agent_runs order by created_at desc limit 50",
      )
    ).rows;
    const verifications = (
      await this.pool.query(
        "select id,run_id,model_id,status,capabilities,metrics,created_by,created_at,finished_at from native_agent_model_verifications order by created_at desc limit 50",
      )
    ).rows;
    return {
      settings,
      models,
      usage,
      runs,
      verifications,
      hardLimits: AGENT_LIMITS,
    };
  }
}
