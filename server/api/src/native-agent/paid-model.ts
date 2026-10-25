import { validateAgentSources } from "./sources.js";
import { KnowledgeService } from "../knowledge-service.js";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NativeAgentPolicyService } from "./policy.js";
import type { Pool } from "pg";
import { APICallError, type ModelMessage } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ProviderConfig, JobConfig } from "../config.js";
import { JobService, JobExecutor } from "../job-service.js";
import type { ModelGateway } from "../model-gateway.js";
import type { CreditService } from "../credit-service.js";
import type { BillingService } from "../billing-service.js";
import type { ObjectStorage } from "../object-storage.js";
import {
  readBillingTrace,
  ProviderError,
  type GenerationProvider,
} from "../provider.js";
import { assertKnowledgeGenerationEnabled } from "../knowledge-feature.js";
import { DomainError } from "../domain.js";
import {
  assertNativeJobVisible,
  nativeModelHash,
  PAID_AGENT_UPSTREAM,
  PAID_AGENT_QUOTE_CENTS,
  nativeModelRoute,
} from "./model-job-policy.js";
import {
  executeAgentProtocol,
  type AgentModelDriver,
  type ModelExecution,
  type ModelReply,
} from "./model.js";
import { contextCost } from "./context.js";
import { AGENT_LIMITS, limitsFor } from "./limits.js";
export class PaidAgentModel implements AgentModelDriver {
  constructor(
    private pool: Pool,
    private gateway: ModelGateway,
    private jobs: JobService,
    private credits: CreditService,
    private billing: BillingService,
    private storage: ObjectStorage,
    private config: JobConfig,
    private provider: ProviderConfig,
    private tokenProvider?: ProviderConfig,
    private policy?: NativeAgentPolicyService,
  ) {
    if (process.env.NODE_ENV === "production" && !policy)
      throw new Error("Production native agent requires database policy");
  }
  async models() {
    if (this.policy) {
      if (process.env.NATIVE_AGENT_PAID_ENABLED !== "true") return [];
      return this.policy.publicModels();
    }
    const token = process.env.NATIVE_AGENT_PAID_ROUTE === "token360",
      config = token ? this.tokenProvider : this.provider;
    if (process.env.NATIVE_AGENT_PAID_ENABLED !== "true" || !config?.apiKey)
      return [];
    const id = token
        ? process.env.NATIVE_AGENT_PAID_MODEL_ID || "catalog.text.qwen3.5-flash"
        : "volcengine_ark.text." + PAID_AGENT_UPSTREAM,
      route = nativeModelRoute(id);
    try {
      const model = await this.gateway.compile({
        modelId: id,
        capability: "text",
        mode: "chat",
        prompt: "原生工具模型能力检查",
      });
      if (
        model.providerId !== route.providerId ||
        model.upstreamModel !== route.upstreamModel
      )
        return [];
      return [
        {
          id,
          name: route.name,
          substitute: false,
          capabilities: {
            toolCalling: true,
            structuredParameters: true,
            streamingToolCalls: true,
            contextCapacityTokens: null,
            trialContextTokens: AGENT_LIMITS.contextTokens,
            availability: "catalog_ready_not_live_probed",
          },
        },
      ];
    } catch {
      return [];
    }
  }
  async run(
    modelId: string,
    messages: ModelMessage[],
    signal: AbortSignal,
    emit: (text: string) => Promise<void>,
    execution?: ModelExecution,
  ): Promise<ModelReply> {
    if (!execution)
      throw new DomainError(
        "AGENT_MODEL_BINDING_INVALID",
        "缺少模型步骤身份",
        409,
      );
    const lock = await this.pool.connect();
    try {
      await lock.query("select pg_advisory_lock(hashtextextended($1,0))", [
        "native-agent-model:" + execution.stepId,
      ]);
      return await this.execute(modelId, messages, signal, emit, execution);
    } finally {
      await lock.query("select pg_advisory_unlock(hashtextextended($1,0))", [
        "native-agent-model:" + execution.stepId,
      ]);
      lock.release();
    }
  }
  private async execute(
    modelId: string,
    messages: ModelMessage[],
    signal: AbortSignal,
    emit: (text: string) => Promise<void>,
    execution: ModelExecution,
  ): Promise<ModelReply> {
    const run = (
      await this.pool.query(
        "select * from native_agent_runs where id=$1 and actor_id=$2",
        [execution.actor.runId, execution.actor.actorId],
      )
    ).rows[0];
    if (!run)
      throw new DomainError("AGENT_RUN_NOT_FOUND", "模型运行不存在", 404);
    const settings = await this.policy?.assertRun(run);
    await validateAgentSources(
      new KnowledgeService(drizzle(this.pool) as any),
      run,
    );
    if (
      process.env.NATIVE_AGENT_PAID_ENABLED !== "true" ||
      (!this.policy && !(await this.models()).some((m) => m.id === modelId))
    )
      throw new DomainError(
        "AGENT_MODEL_UNAVAILABLE",
        "付费工具模型尚未启用或未验证",
        409,
      );
    const sourceRun = (
      await this.pool.query(
        "select sources from native_agent_runs where id=$1 and actor_id=$2",
        [execution.actor.runId, execution.actor.actorId],
      )
    ).rows[0];
    if (!(settings?.knowledgeReasoningEnabled === true))
      assertKnowledgeGenerationEnabled(sourceRun?.sources);
    const route = nativeModelRoute(modelId),
      config =
        route.providerId === "token360" ? this.tokenProvider! : this.provider;
    const body = {
      actor: execution.actor,
      stepId: execution.stepId,
      messages,
      mode: execution.mode,
      modelId,
      planning: execution.planning,
      conversationStage: execution.conversationStage,
      conversationDecision: execution.conversationDecision,
      ...(execution.currentUserMessage === undefined ? {} : { currentUserMessage: execution.currentUserMessage }),
      toolNames: execution.toolNames,
      readCurrentCanvasOnly: execution.readCurrentCanvasOnly,
    };
    const payloadHash = nativeModelHash(body);
    const job = await this.jobs.create(
      execution.actor.projectId,
      execution.actor.actorId,
      {
        modelId,
        capability: "text",
        mode: "chat",
        prompt: "原生创作助手：受控工具推理轮",
        parameters: {},
        references: [],
        nodeRevision: 0,
        idempotencyKey: "native-agent:" + execution.stepId,
      },
      undefined,
      undefined,
      { ...body, payloadHash, quoteCents: route.quoteCents },
    );
    const jobId = String(job.id),
      existing = (
        await this.pool.query("select * from generation_jobs where id=$1", [
          jobId,
        ])
      ).rows[0];
    let inferenceDispatched = false,
      billingTrace: string | undefined;
    const sdk = createOpenAICompatible({
      name: "platform-managed",
      baseURL:
        route.providerId === "token360"
          ? config.baseUrl + "/v1"
          : config.baseUrl,
      apiKey: config.apiKey,
      fetch: async (input, init) => {
        const latestRun = (
          await this.pool.query(
            "select * from native_agent_runs where id=$1 and actor_id=$2",
            [execution.actor.runId, execution.actor.actorId],
          )
        ).rows[0];
        if (!latestRun)
          throw new DomainError("AGENT_RUN_NOT_FOUND", "模型运行不存在", 404);
        const currentPolicy = await this.policy?.assertRun(latestRun);
        if (
          currentPolicy &&
          Number(latestRun.spent_cents) + Number(latestRun.reserved_cents) >
            currentPolicy.maxBudgetCents
        )
          throw new DomainError(
            "AGENT_COST_LIMIT",
            "平台当前预算上限不足，未提交供应商",
            409,
          );
        if (!currentPolicy?.knowledgeReasoningEnabled)
          assertKnowledgeGenerationEnabled(latestRun.sources);
        await validateAgentSources(
          new KnowledgeService(drizzle(this.pool) as any),
          latestRun,
        );
        const request = JSON.parse(String(init?.body || "{}"));
        if (route.providerId === "volcengine_ark")
          request.thinking = { type: "disabled" };
        if (route.upstreamModel === "qwen3.5-flash")
          request.enable_thinking = false;
        if (route.upstreamModel === "qwen3.5-flash")
          request.parallel_tool_calls = true;
        request.max_tokens = AGENT_LIMITS.outputTokens;
        let estimate: number | undefined;
        if (route.providerId === "volcengine_ark") {
          const tokenResponse = await fetch(config.baseUrl + "/tokenization", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + config.apiKey,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: route.upstreamModel,
              text: JSON.stringify({
                messages: request.messages,
                tools: request.tools,
              }),
            }),
            signal: init?.signal,
          });
          if (!tokenResponse.ok)
            throw new DomainError(
              "AGENT_TOKENIZER_UNAVAILABLE",
              "模型分词预检失败，未提交推理请求",
              409,
            );
          const tokenData = (await tokenResponse.json()) as {
            data?: { total_tokens?: number }[];
          };
          estimate = tokenData.data?.[0]?.total_tokens;
        } else {
          estimate =
            contextCost(messages, execution.toolNames, execution) -
            AGENT_LIMITS.outputTokens;
          const fx = (await this.credits.pricing()).usdCnyRate;
          if (!fx || Number(fx) > 8.5)
            throw new DomainError(
              "AGENT_PRICE_UNVERIFIED",
              "缺少已核验的人民币结算汇率或超出报价边界，未提交推理请求",
              409,
            );
          const pricing = await fetch(config.catalogUrl, {
            signal: init?.signal,
          });
          if (!pricing.ok)
            throw new DomainError(
              "AGENT_PRICE_UNVERIFIED",
              "供应商价格无法核验，未提交推理请求",
              409,
            );
          const catalog = (await pricing.json()) as any;
          const item = catalog.data?.list?.find(
            (item: any) => item.name === route.upstreamModel,
          );
          const price = item?.displayPricing,
            parts = price?.pricingComponents;
          const qwen = route.upstreamModel === "qwen3.5-flash",
            inputs = qwen
              ? ["uncached_input_tokens", "cache_creation_tokens"]
              : ["input_tokens"],
            maxInput = qwen ? 0.215 : 0.4,
            maxOutput = qwen ? 1.72 : 1.6;
          if (
            price?.currency !== "USD" ||
            price?.fallback !== true ||
            !Array.isArray(parts) ||
            parts.some(
              (p: any) =>
                p.unit !== "1M" ||
                !Number.isFinite(p.rate) ||
                p.rate < 0 ||
                ![...inputs, "cache_read_tokens", "output_tokens"].includes(
                  p.meter,
                ) ||
                p.rate > (p.meter === "output_tokens" ? maxOutput : maxInput),
            ) ||
            !parts.some((p: any) => inputs.includes(p.meter)) ||
            !parts.some((p: any) => p.meter === "output_tokens")
          )
            throw new DomainError(
              "AGENT_PRICE_CHANGED",
              "模型价格超出已核验费用边界，未提交推理请求",
              409,
            );
        }
        if (
          !Number.isSafeInteger(estimate) ||
          Number(estimate) + AGENT_LIMITS.outputTokens >
            AGENT_LIMITS.contextTokens
        )
          throw new DomainError(
            "AGENT_CONTEXT_LIMIT",
            "分词预检超过12k上下文预算，未提交推理请求",
            422,
          );
        const meter = (
          await this.pool.query(
            "select input_tokens,output_tokens,budget_limits from native_agent_runs where id=$1",
            [execution.actor.runId],
          )
        ).rows[0];
        if (
          Number(meter.input_tokens) +
            Number(meter.output_tokens) +
            Number(estimate) +
            AGENT_LIMITS.outputTokens >
          limitsFor(meter).totalTokens
        )
          throw new DomainError(
            "AGENT_TOKEN_LIMIT",
            "累计Token预算不足，未提交推理请求",
            422,
          );
        await this.pool.query(
          "update native_agent_steps set input=input||$2::jsonb where id=$1",
          [
            execution.stepId,
            JSON.stringify({
              officialInputEstimate: estimate,
              protocolRequestHash: nativeModelHash(request),
              protocolRequest: request,
            }),
          ],
        );
        inferenceDispatched = true;
        const headers = new Headers(init?.headers);
        headers.set("X-Trace-ID", jobId);
        headers.set("X-Request-ID", jobId);
        const response = await fetch(input, {
          ...init,
          headers,
          body: JSON.stringify(request),
        });
        billingTrace = readBillingTrace(response, undefined, jobId);
        return response;
      },
    });
    const provider: GenerationProvider = {
      create: async (request, correlationOrSignal, providerSignal) => {
        try {
          if (correlationOrSignal !== jobId)
            throw new DomainError(
              "AGENT_JOB_BINDING_INVALID",
              "推理任务与操作回执不一致",
              409,
            );
          await assertNativeJobVisible(
            this.pool,
            jobId,
            execution.actor.actorId,
          );
          const state = (
            await this.pool.query(
              "select r.cancel_requested,r.status from native_agent_runs r join native_agent_model_jobs j on j.run_id=r.id where j.job_id=$1",
              [jobId],
            )
          ).rows[0];
          if (!state || state.cancel_requested || state.status !== "planning")
            throw new DomainError(
              "AGENT_MODEL_STOPPED",
              "任务已停止，不发起付费请求",
              409,
            );
          if (request.upstreamModel !== route.upstreamModel)
            throw new DomainError(
              "AGENT_MODEL_BINDING_INVALID",
              "模型与费用报价不一致",
              409,
            );
          let reply: ModelReply;
          try {
            reply = await executeAgentProtocol(
              sdk(request.upstreamModel),
              messages,
              providerSignal || signal,
              emit,
              execution,
              "verified",
            );
          } catch (error) {
            if (!inferenceDispatched)
              throw new ProviderError(
                "AGENT_PREFLIGHT_FAILED",
                error instanceof DomainError
                  ? error.message
                  : "推理提交前检查失败",
                false,
                {
                  status: 422,
                  usage: {
                    billable: false,
                    prompt_tokens: 0,
                    completion_tokens: 0,
                  },
                },
              );
            throw error;
          }
          return {
            status: "completed",
            billingTraceId: billingTrace || reply.requestId,
            usage: {
              prompt_tokens: reply.inputTokens,
              completion_tokens: reply.outputTokens,
              total_tokens: reply.inputTokens + reply.outputTokens,
              prompt_tokens_details: {
                cached_tokens: reply.cachedInputTokens ?? 0,
              },
              provider_request_id: reply.requestId,
              currency: "CNY",
            },
            artifacts: [
              {
                kind: "text",
                mimeType: "application/vnd.shoushou.agent-turn+json",
                text: JSON.stringify({
                  protocolVersion: 1,
                  stepId: execution.stepId,
                  payloadHash,
                  reply,
                }),
              },
            ],
          };
        } catch (error) {
          if (!inferenceDispatched)
            throw new ProviderError(
              "AGENT_PREFLIGHT_FAILED",
              error instanceof DomainError
                ? error.message
                : "推理提交前检查失败",
              false,
              {
                status: 422,
                usage: {
                  billable: false,
                  prompt_tokens: 0,
                  completion_tokens: 0,
                },
              },
            );
          if (
            APICallError.isInstance(error) &&
            [400, 401, 403, 404, 422, 429].includes(Number(error.statusCode))
          )
            throw new ProviderError(
              "PROVIDER_REJECTED",
              "供应商拒绝了模型请求，未自动重试",
              false,
              {
                ...safeRejection(error, config.apiKey),
                usage: {
                  billable: false,
                  prompt_tokens: 0,
                  completion_tokens: 0,
                },
              },
            );
          throw error;
        }
      },
      get: async () => {
        throw new DomainError(
          "AGENT_SUBMISSION_UNKNOWN",
          "原生推理不盲目重新提交或轮询未知供应商请求",
          409,
        );
      },
      cancel: async () => {},
      fetchVideoContent: async () => {
        throw new Error("Native model turns never create media");
      },
    };
    const executor = new JobExecutor(
      this.pool,
      this.gateway,
      provider,
      this.storage,
      this.config,
      async () => undefined,
      this.billing,
      undefined,
      undefined,
      this.credits,
      true,
    );
    if (
      existing.provider_submission_state === "not_started" &&
      existing.status === "pending"
    ) {
      try {
        await executor.execute(jobId, 1, signal);
      } catch (error) {
        await executor.markAttemptFailed(jobId, true);
        const state = (
          await this.pool.query(
            "select provider_submission_state from generation_jobs where id=$1",
            [jobId],
          )
        ).rows[0];
        if (state?.provider_submission_state === "unknown")
          await this.pool.query(
            "update native_agent_model_jobs set status='unknown' where job_id=$1 and status='reserved'",
            [jobId],
          );
        await this.settleBudget(jobId).catch(() => undefined);
        if (
          error instanceof ProviderError &&
          [400, 401, 403, 404, 422, 429].includes(
            Number(error.safeDetails.status),
          )
        )
          throw new DomainError(error.code, error.message, 422);
        throw error;
      }
    }
    if (route.providerId === "token360") {
      while (!signal.aborted) {
        const state = (
          await this.pool.query(
            "select billing_status,credit_delivery_status from generation_jobs where id=$1",
            [jobId],
          )
        ).rows[0];
        if (
          state?.billing_status === "settled" &&
          state.credit_delivery_status === "released"
        )
          break;
        await this.billing.reconcileJob(jobId, true);
        const fresh = (
          await this.pool.query(
            "select billing_status from generation_jobs where id=$1",
            [jobId],
          )
        ).rows[0];
        if (fresh?.billing_status === "settled") break;
        if (
          ["manual_review", "unavailable", "failed", "mismatch"].includes(
            fresh?.billing_status,
          )
        )
          break;
        await new Promise<void>((resolve, reject) => {
          const done = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", abort);
            resolve();
          };
          const abort = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", abort);
            reject(signal.reason);
          };
          const timer = setTimeout(done, this.config.videoPollIntervalMs);
          signal.addEventListener("abort", abort, { once: true });
        });
      }
    }
    const delivered = await this.jobs.get(jobId, execution.actor.actorId);
    if (
      !delivered ||
      delivered.creditDeliveryStatus !== "released" ||
      delivered.billingStatus !== "settled"
    )
      throw new DomainError(
        "AGENT_BILLING_UNCONFIRMED",
        "原模型任务或费用尚未核验，已停止后续调用；请查询原任务",
        409,
      );
    const artifact = delivered.artifacts.find(
      (a) => a.mimeType === "application/vnd.shoushou.agent-turn+json",
    ) as { text?: string } | undefined;
    const persisted = JSON.parse(artifact?.text || "null");
    if (
      persisted?.protocolVersion !== 1 ||
      persisted.stepId !== execution.stepId ||
      persisted.payloadHash !== payloadHash
    )
      throw new DomainError(
        "AGENT_MODEL_RECEIPT_INVALID",
        "模型回执身份或内容不一致，未执行工具",
        409,
      );
    const cents = await this.settleBudget(jobId);
    return { ...persisted.reply, jobId, supplierCents: cents };
  }
  private async settleBudget(jobId: string) {
    const client = await this.pool.connect();
    let cents: number, supplierCents: number;
    try {
      await client.query("begin");
      const binding = (
        await client.query(
          "select * from native_agent_model_jobs where job_id=$1 for update",
          [jobId],
        )
      ).rows[0];
      const usage = (
        await client.query(
          "select credit_points::int cents,ceil(cost_cny*100)::int supplier_cents from generation_usage where job_id=$1 and credit_status in ('charged','free') and cost_cny is not null",
          [jobId],
        )
      ).rows[0];
      if (!usage)
        throw new DomainError("AGENT_METER_UNKNOWN", "人民币用量尚未确认", 409);
      cents = Number(usage.cents);
      supplierCents = Number(usage.supplier_cents);
      if (cents > binding.quote_cents)
        throw new DomainError(
          "AGENT_QUOTE_EXCEEDED",
          "实际费用超过保守报价，停止后续调用并保留原账单",
          409,
        );
      if (binding.status !== "settled") {
        await client.query(
          "update native_agent_model_jobs set status='settled',settled_cents=$2,settled_at=now() where job_id=$1",
          [jobId, cents],
        );
        await client.query(
          "update native_agent_runs set reserved_cents=reserved_cents-$2,spent_cents=spent_cents+$3 where id=$1",
          [binding.run_id, binding.quote_cents, cents],
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    return supplierCents!;
  }
}

function safeRejection(error: APICallError, key: string) {
  let value: any;
  try {
    value = JSON.parse(error.responseBody || "{}");
  } catch {
    value = {};
  }
  const raw = String(value.error?.message || value.message || value.msg || "");
  return {
    status: error.statusCode,
    upstreamCode: String(value.error?.code || value.code || "").slice(0, 100),
    upstreamMessage: raw
      .split(key)
      .join("[redacted]")
      .replace(/Bearer\s+\S+|sk-[a-zA-Z0-9_-]+/g, "[redacted]")
      .slice(0, 300),
  };
}
