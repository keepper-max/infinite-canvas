import { validateAgentSources } from "./sources.js";
import type { NativeAgentPolicyService } from "./policy.js";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Pool } from "pg";
import type { ModelMessage } from "ai";
import { DomainError } from "../domain.js";
import type { KnowledgeService } from "../knowledge-service.js";
import type { JobService } from "../job-service.js";
import { grantUserFeature } from "../feature-grants.js";
import { guardActor, guardWrite, type AgentTx } from "./guard.js";
import { AgentPlanService } from "./plan-service.js";
import { AgentCanvasService } from "./canvas-service.js";
import {
  sessionInput,
  runInput,
  decisionInput,
  terminal,
  type AgentActor,
  type ToolCall,
} from "./contracts.js";
import {
  registry,
  parseTool,
  readBusinessTool,
  type ToolName,
} from "./tools.js";
import type { AgentModelDriver } from "./model.js";
import { compactContext, contextCost } from "./context.js";
import {
  AGENT_LIMITS,
  limitsFor,
  AGENT_PROTOCOL_VERSION,
  AGENT_MESSAGE_SCHEMA_VERSION,
} from "./limits.js";
type Row = Record<string, any>;
const hash = (p: unknown) =>
  createHash("sha256").update(JSON.stringify(p)).digest("hex");
const rows = async (tx: AgentTx, q: ReturnType<typeof sql>) =>
  (await tx.execute(q)).rows as Row[];
const fail = (
  code: string,
  message: string,
  status: 403 | 404 | 409 | 422 = 409,
): never => {
  throw new DomainError(code, message, status);
};
const publicError = (e: unknown) =>
  e instanceof DomainError
    ? { code: e.code, message: e.message }
    : {
        code: "AGENT_EXECUTION_UNCONFIRMED",
        message: "操作结果尚未确认，请查询原任务；不会自动重试模型或写操作",
      };
export class NativeAgentService {
  readonly canvas: AgentCanvasService;
  readonly plans: AgentPlanService;
  constructor(
    readonly knowledge: KnowledgeService,
    readonly pool: Pool,
    private driver: AgentModelDriver,
    private enqueue: (id: string) => Promise<unknown>,
    private jobs?: Pick<JobService, "get">,
    private adminEmails: string[] = [],
    readonly policy?: NativeAgentPolicyService,
  ) {
    this.canvas = new AgentCanvasService(knowledge);
    this.plans = new AgentPlanService(
      knowledge,
      pool,
      this.canvas,
      (tx, r, type, data, item) => this.event(tx, r, type, data, item),
      (actor, c, p) => this.runTool(actor, c, p),
    );
  }
  grant(actor: string, target: string, enabled: boolean, reason: string) {
    return grantUserFeature(
      this.knowledge.db,
      this.adminEmails,
      actor,
      target,
      "native_agent",
      enabled,
      reason,
    );
  }
  private transaction<T>(fn: (tx: AgentTx) => Promise<T>) {
    return this.knowledge.db.transaction(fn);
  }
  private async accountActive(tx: AgentTx, id: string) {
    const [r] = await rows(
      tx,
      sql`update native_agent_runs set elapsed_ms=elapsed_ms+case when active_started_at is null then 0 else greatest(0,floor(extract(epoch from (clock_timestamp()-active_started_at))*1000))::bigint end,active_started_at=null where id=${id} returning elapsed_ms`,
    );
    return Number(r?.elapsed_ms ?? 0);
  }
  async feature(actorId: string) {
    await this.transaction((tx) => guardActorFeature(tx, actorId));
    const settings = await this.policy?.get(),
      limits = settings?.limits ?? AGENT_LIMITS;
    return {
      enabled: settings?.enabled ?? true,
      defaultModelId: settings?.defaultModelId ?? null,
      userModelSelectionEnabled: settings?.userModelSelectionEnabled ?? true,
      maxBudgetCents: settings?.maxBudgetCents ?? null,
      policyVersion: settings?.version ?? null,
      protocolVersion: AGENT_PROTOCOL_VERSION,
      messageSchemaVersion: AGENT_MESSAGE_SCHEMA_VERSION,
      limits,
      limitsHash: hash(settings ?? AGENT_LIMITS),
      models: await this.driver.models(),
      registeredTools: Object.keys(registry),
      knowledgePaidGenerationEnabled:
        process.env.KNOWLEDGE_GENERATION_ENABLED === "true",
    };
  }
  async sessions(actorId: string, projectId: string) {
    return this.transaction(async (tx) => {
      await guardActor(tx, { actorId, projectId });
      return rows(
        tx,
        sql`select * from native_agent_sessions where actor_id=${actorId} and project_id=${projectId} order by updated_at desc`,
      );
    });
  }
  async createSession(actorId: string, raw: unknown) {
    const p = sessionInput.parse(raw);
    return this.transaction(async (tx) => {
      await guardActor(tx, { actorId, projectId: p.projectId });
      await tx.execute(
        sql`insert into native_agent_sessions(actor_id,project_id,operation_id,title,mode) values(${actorId},${p.projectId},${p.operationId},${p.title},${p.mode}) on conflict(actor_id,operation_id) do nothing`,
      );
      const [s] = await rows(
        tx,
        sql`select * from native_agent_sessions where actor_id=${actorId} and operation_id=${p.operationId}`,
      );
      if (
        s.project_id !== p.projectId ||
        s.title !== p.title ||
        s.mode !== p.mode
      )
        fail("AGENT_OPERATION_MISMATCH", "同一操作ID不能创建不同会话");
      return s;
    });
  }
  private async session(
    tx: AgentTx,
    actorId: string,
    id: string,
    write = false,
  ) {
    const [s] = await rows(
      tx,
      sql`select * from native_agent_sessions where id=${id} and actor_id=${actorId}`,
    );
    if (!s) fail("AGENT_SESSION_NOT_FOUND", "会话不存在", 404);
    await guardActor(tx, { actorId, projectId: s.project_id }, write);
    if (
      s.protocol_version !== AGENT_PROTOCOL_VERSION ||
      s.message_schema_version !== AGENT_MESSAGE_SCHEMA_VERSION
    )
      fail("AGENT_VERSION_UNSUPPORTED", "会话协议版本不兼容，原记录已保留");
    return s;
  }
  private async run(tx: AgentTx, actorId: string, id: string) {
    const [r] = await rows(
      tx,
      sql`select * from native_agent_runs where id=${id} and actor_id=${actorId}`,
    );
    if (!r) fail("AGENT_RUN_NOT_FOUND", "任务不存在", 404);
    await this.session(tx, actorId, r.session_id);
    return r;
  }
  async startProbe(actorId: string, raw: unknown) {
    if (!this.policy) fail("AGENT_POLICY_UNAVAILABLE", "模型验证管理未配置");
    const p = z
      .object({
        projectId: z.string().uuid(),
        modelId: z.string(),
        operationId: z.string().uuid(),
        budgetCents: z.number().int().positive(),
      })
      .strict()
      .parse(raw);
    await this.policy!.requireAdmin(actorId);
    const session = await this.createSession(actorId, {
      projectId: p.projectId,
      operationId: p.operationId,
      mode: "advice",
      title: "Agent模型实际工具与费用验证",
    });
    return this.start(
      actorId,
      session.id,
      {
        operationId: p.operationId,
        mode: "advice",
        modelId: p.modelId,
        budgetCents: p.budgetCents,
        prompt:
          "这是一次只读工具能力验证。请实际调用一次get_canvas_state工具（参数为{}），收到工具结果后只回答检查完成。不要创建或修改任何内容。",
      },
      true,
    );
  }
  async start(
    actorId: string,
    sessionId: string,
    raw: unknown,
    internalProbe = false,
  ) {
    const p = runInput.parse(raw);
    if (internalProbe) await this.policy!.requireAdmin(actorId);
    const probe = internalProbe
      ? await this.policy!.candidate(p.modelId)
      : null;
    let r: Row;
    try {
      r = await this.transaction(async (tx) => {
        const s = await this.session(
          tx,
          actorId,
          sessionId,
          p.mode === "execute",
        );
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${"native-agent-start:" + actorId},0))`,
        );
        const digest = hash({ sessionId, ...p });
        const [old] = await rows(
          tx,
          sql`select * from native_agent_runs where actor_id=${actorId} and operation_id=${p.operationId}`,
        );
        if (old) {
          if (old.payload_hash !== digest)
            fail("AGENT_OPERATION_MISMATCH", "operationId已用于不同任务");
          return old;
        }
        const [lockedSession] = await rows(
          tx,
          sql`select closed_at from native_agent_sessions where id=${sessionId} for update`,
        );
        if (lockedSession.closed_at) fail("AGENT_SESSION_CLOSED", "会话已结束");
        const settings = await this.policy?.selection(
          p.modelId,
          p.budgetCents,
          internalProbe,
        );
        if (
          !internalProbe &&
          !(await this.driver.models()).some((m) => m.id === p.modelId)
        )
          fail(
            "AGENT_MODEL_UNAVAILABLE",
            "该模型尚未验证工具调用及计费能力",
            422,
          );
        const [busy] = await rows(
          tx,
          sql`select id from native_agent_runs where actor_id=${actorId} and status not in ('completed','failed','cancelled')`,
        );
        if (busy)
          fail(
            "AGENT_RUN_ACTIVE",
            "请先完成或取消当前任务（包括等待审批和人工核查的任务）",
          );
        const history = await rows(
          tx,
          sql`select context,sources from native_agent_runs where session_id=${sessionId} and status='completed' order by created_at desc limit 1`,
        );
        const context: ModelMessage[] = [
          ...(history[0]?.context ?? []),
          { role: "user", content: p.prompt },
        ];
        const [value] = await rows(
          tx,
          sql`insert into native_agent_runs(session_id,actor_id,project_id,operation_id,payload_hash,prompt,model_id,mode,budget_cents,context,sources,plan_protocol,budget_limits) values(${sessionId},${actorId},${s.project_id},${p.operationId},${digest},${p.prompt},${p.modelId},${p.mode},${p.budgetCents},${JSON.stringify(context)}::jsonb,${JSON.stringify(history[0]?.sources ?? [])}::jsonb,1,${JSON.stringify(AGENT_LIMITS)}::jsonb) returning *`,
        );
        if (settings) {
          await tx.execute(
            sql`update native_agent_runs set budget_limits=${JSON.stringify(settings.limits)}::jsonb,policy_snapshot=${JSON.stringify(settings)}::jsonb,purpose=${internalProbe ? "model_probe" : "user"} where id=${value.id}`,
          );
          Object.assign(value, {
            budget_limits: settings.limits,
            policy_snapshot: settings,
            purpose: internalProbe ? "model_probe" : "user",
          });
        }
        if (probe)
          await tx.execute(
            sql`insert into native_agent_model_verifications(run_id,model_id,status,definition_hash,credential_hash,created_by) values(${value.id},${p.modelId},'pending',${probe.definitionHash},${probe.credentialHash},${actorId})`,
          );
        await tx.execute(
          sql`insert into native_agent_messages(session_id,run_id,turn_id,item_id,role,content) values(${sessionId},${value.id},${value.id},'user','user',${p.prompt})`,
        );
        await tx.execute(
          sql`update native_agent_sessions set updated_at=now() where id=${sessionId}`,
        );
        await this.event(tx, value, "run.started", { status: "pending" });
        return value;
      });
    } catch (e) {
      if ((e as any)?.cause?.code === "23505")
        fail("AGENT_RUN_ACTIVE", "已有未结束任务");
      throw e;
    }
    // DB is the durable outbox. Queue outages do not lose accepted runs; worker reconciles pending rows.
    await this.enqueue(r.id).catch(() => undefined);
    return r;
  }
  private actor(r: Row): AgentActor {
    return { actorId: r.actor_id, projectId: r.project_id, runId: r.id };
  }
  private async event(
    tx: AgentTx,
    r: Row,
    type: string,
    data: unknown,
    itemId = "run",
  ) {
    await tx.execute(
      sql`insert into native_agent_events(session_id,run_id,turn_id,item_id,type,data) values(${r.session_id},${r.id},${r.id},${itemId},${type},${JSON.stringify(data)}::jsonb)`,
    );
  }
  async snapshot(actorId: string, sessionId: string) {
    const value = await this.transaction(async (tx) => {
      await this.session(tx, actorId, sessionId);
      // One SQL statement supplies one MVCC snapshot. Repeatable-read + auth FOR SHARE
      // can raise 40001 while a concurrent canvas save updates the project row.
      const [record] = await rows(
        tx,
        sql`select jsonb_build_object(
        'session',(select to_jsonb(s) from native_agent_sessions s where s.id=${sessionId}),
        'runs',coalesce((select jsonb_agg(r order by r.created_at) from native_agent_runs r where r.session_id=${sessionId}),'[]'::jsonb),
        'messages',coalesce((select jsonb_agg(m order by m.created_at,m.id) from native_agent_messages m where m.session_id=${sessionId}),'[]'::jsonb),
        'steps',coalesce((select jsonb_agg(st order by r.created_at,st.ordinal) from (select id,run_id,ordinal,kind,tool_name,operation_id,status,case when kind='tool' then input else '{}'::jsonb end input,case when kind='tool' then output else null end output,error_code,error_message,started_at,finished_at from native_agent_steps) st join native_agent_runs r on r.id=st.run_id where r.session_id=${sessionId}),'[]'::jsonb),
        'plans',coalesce((select jsonb_agg(p order by p.created_at) from native_agent_plans p join native_agent_runs r on r.id=p.run_id where r.session_id=${sessionId}),'[]'::jsonb),
        'usage',coalesce((select jsonb_agg(u order by u.created_at) from native_agent_usage u join native_agent_runs r on r.id=u.run_id where r.session_id=${sessionId}),'[]'::jsonb),
        'approvals',coalesce((select jsonb_agg(a order by a.created_at) from native_agent_approvals a join native_agent_runs r on r.id=a.run_id where r.session_id=${sessionId}),'[]'::jsonb)
      ) as value`,
      );
      return record.value as {
        session: Row;
        runs: Row[];
        messages: Row[];
        steps: Row[];
        approvals: Row[];
        plans: Row[];
        usage: Row[];
      };
    });
    for (const r of value.runs) await this.validateSources(r);
    return {
      session: value.session,
      runs: value.runs.map(
        ({ context, sources, pending_calls, prompt, payload_hash, ...r }) => r,
      ),
      messages: value.messages,
      steps: value.steps,
      approvals: value.approvals,
      plans: value.plans,
      usage: value.usage,
      sources: value.runs.flatMap((r) =>
        (r.sources ?? [])
          .filter((s: any) => s.documentId)
          .map((s: any) => ({ ...s, runId: r.id })),
      ),
    };
  }
  async events(actorId: string, runId: string, after: number) {
    const r = await this.transaction((tx) => this.run(tx, actorId, runId));
    await this.validateSources(r);
    return (
      await this.pool.query(
        "select * from native_agent_events where run_id=$1 and id>$2 order by id",
        [runId, after],
      )
    ).rows;
  }
  async cancel(actorId: string, id: string) {
    return this.transaction(async (tx) => {
      const r = await this.run(tx, actorId, id);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${"native-agent-write:" + id},0))`,
      );
      await this.accountActive(tx, id);
      await tx.execute(
        sql`update native_agent_runs set cancel_requested=true,status='cancelled',revision=revision+1,finished_at=now(),updated_at=now() where id=${id} and status not in ('completed','failed','cancelled')`,
      );
      await tx.execute(
        sql`update native_agent_approvals set status='cancelled',decided_at=now() where run_id=${id} and status='pending'`,
      );
      await tx.execute(
        sql`update native_agent_plans set status='cancelled',updated_at=now() where run_id=${id} and status in ('draft','awaiting_approval','approved')`,
      );
      await tx.execute(
        sql`update native_agent_steps set status='cancelled' where run_id=${id} and kind='tool' and status in ('pending','awaiting_approval')`,
      );
      const [actual] = await rows(
        tx,
        sql`select status from native_agent_runs where id=${id}`,
      );
      await this.event(
        tx,
        r,
        actual.status === "cancelled"
          ? "run.cancelled"
          : "run.cancellation_ignored",
        {
          committedStepsPreserved: true,
        },
      );
      return { id, status: actual.status, committedStepsPreserved: true };
    });
  }
  async close(actorId: string, sessionId: string) {
    return this.transaction(async (tx) => {
      await this.session(tx, actorId, sessionId);
      await tx.execute(
        sql`select id from native_agent_sessions where id=${sessionId} for update`,
      );
      const active = await rows(
        tx,
        sql`select id from native_agent_runs where session_id=${sessionId} and status not in ('completed','failed','cancelled')`,
      );
      if (active.length) fail("AGENT_RUN_ACTIVE", "先取消未结束任务");
      await tx.execute(
        sql`update native_agent_sessions set closed_at=now() where id=${sessionId}`,
      );
      return { closed: true };
    });
  }
  async decide(actorId: string, approvalId: string, raw: unknown) {
    const p = decisionInput.parse(raw);
    const result = await this.transaction(async (tx) => {
      let [a] = await rows(
        tx,
        sql`select * from native_agent_approvals where id=${approvalId} and actor_id=${actorId}`,
      );
      if (!a) fail("AGENT_APPROVAL_NOT_FOUND", "审批不存在", 404);
      const r = await this.run(tx, actorId, a.run_id);
      await guardActor(tx, this.actor(r), true);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${"native-agent-write:" + r.id},0))`,
      );
      [a] = await rows(
        tx,
        sql`select * from native_agent_approvals where id=${approvalId} and actor_id=${actorId} for update`,
      );
      const digest = hash(p);
      if (a.decision_operation_id) {
        if (
          a.decision_operation_id !== p.operationId ||
          a.decision_hash !== digest
        )
          fail("AGENT_OPERATION_MISMATCH", "审批已处理，不能以不同内容重放");
        return { runId: r.id, status: a.status };
      }
      if (
        a.status !== "pending" ||
        r.status !== "awaiting_approval" ||
        a.revision !== p.expectedRevision ||
        a.payload_hash !== p.payloadHash
      )
        fail("AGENT_APPROVAL_STALE", "审批内容已变化，请重新检查计划");
      if (p.decision === "revise" && !p.instruction?.trim())
        fail("AGENT_REVISION_REQUIRED", "请填写修改意见", 422);
      const status =
        p.decision === "approve"
          ? "approved"
          : p.decision === "revise"
            ? "revised"
            : "cancelled";
      await tx.execute(
        sql`update native_agent_approvals set status=${status},decision_operation_id=${p.operationId},decision_hash=${digest},decided_at=now() where id=${approvalId}`,
      );
      const [plan] = await rows(
        tx,
        sql`select * from native_agent_plans where approval_id=${approvalId}`,
      );
      if (plan)
        await tx.execute(
          sql`update native_agent_plans set status=${p.decision === "approve" ? "approved" : p.decision === "revise" ? "revised" : "cancelled"},updated_at=now() where id=${plan.id}`,
        );
      if (p.decision === "approve")
        await tx.execute(
          sql`update native_agent_runs set status='running',phase=${plan ? "plan_execute" : "tools"},revision=revision+1,updated_at=now() where id=${r.id}`,
        );
      else if (p.decision === "cancel")
        await tx.execute(
          sql`update native_agent_runs set status='cancelled',cancel_requested=true,finished_at=now(),revision=revision+1 where id=${r.id}`,
        );
      else {
        const ctx: ModelMessage[] = [
          ...r.context,
          ...(!plan
            ? [
                {
                  role: "tool" as const,
                  content: (r.pending_calls as ToolCall[]).map((c) => ({
                    type: "tool-result" as const,
                    toolCallId: c.toolCallId,
                    toolName: c.toolName,
                    output: {
                      type: "json" as const,
                      value: {
                        notExecuted: true,
                        userRevision: p.instruction!,
                      },
                    },
                  })),
                },
              ]
            : []),
          { role: "user", content: p.instruction! },
        ];
        await tx.execute(
          sql`update native_agent_steps set status='cancelled' where run_id=${r.id} and status='awaiting_approval'`,
        );
        await tx.execute(
          sql`update native_agent_runs set status='planning',phase='model',pending_calls='[]',context=${JSON.stringify(ctx)}::jsonb,revision=revision+1 where id=${r.id}`,
        );
      }
      await this.event(tx, r, "approval.decided", { approvalId, status });
      return { runId: r.id, status };
    });
    if (result.status !== "cancelled")
      await this.enqueue(result.runId).catch(() => undefined);
    return result;
  }
  private async validateSources(r: Row) {
    return validateAgentSources(this.knowledge, {
      actor_id: r.actor_id,
      project_id: r.project_id,
      sources: r.sources,
    });
  }
  async reconcile(actorId: string, runId: string) {
    const candidate = await this.transaction((tx) =>
      this.run(tx, actorId, runId),
    );
    await this.validateSources(candidate);
    if (
      candidate.status === "awaiting_manual_review" &&
      (await this.plans.reconcile(candidate))
    )
      return { runId, status: "completed" };

    const result = await this.transaction(async (tx) => {
      const r = await this.run(tx, actorId, runId);
      await guardActor(tx, this.actor(r), r.mode === "execute");
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${"native-agent-start:" + actorId},0))`,
      );
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${"native-agent-write:" + runId},0))`,
      );
      const [current] = await rows(
        tx,
        sql`select * from native_agent_runs where id=${runId} for update`,
      );
      if (current.status === "completed" || current.phase === "receipt")
        return { runId, status: current.status };
      if (
        current.cancel_requested ||
        !["failed", "awaiting_manual_review"].includes(current.status)
      )
        fail("AGENT_RECEIPT_NOT_READY", "当前任务不处于待核查状态");
      const [job] = await rows(
        tx,
        sql`select s.id step_id,j.id job_id from native_agent_model_jobs m join native_agent_steps s on s.id=m.step_id join generation_jobs j on j.id=m.job_id where m.run_id=${runId} and s.status in ('unknown','failed','submitting') and j.provider_submission_state='resolved' and j.billing_status='settled' and j.credit_delivery_status='released' and exists(select 1 from job_artifacts a where a.job_id=j.id and a.mime_type='application/vnd.shoushou.agent-turn+json') order by s.ordinal desc limit 1`,
      );
      if (!job)
        fail(
          "AGENT_RECEIPT_NOT_READY",
          "原供应商结果或费用尚未核验，不发起新的模型请求",
        );
      const [other] = await rows(
        tx,
        sql`select id from native_agent_runs where actor_id=${actorId} and id<>${runId} and status not in ('completed','failed','cancelled')`,
      );
      if (other) fail("AGENT_RUN_ACTIVE", "请先完成或取消其他任务");
      await tx.execute(
        sql`update native_agent_runs set status='planning',phase='receipt',error_code=null,error_message=null,finished_at=null,revision=revision+1,updated_at=now() where id=${runId}`,
      );
      await this.event(tx, r, "run.receipt_reconcile", {
        jobId: job.job_id,
        stepId: job.step_id,
      });
      return { runId, status: "planning" };
    });
    if (result.status !== "completed")
      await this.enqueue(runId).catch(() => undefined);
    return result;
  }
  async resume(actorId: string, runId: string, raw: unknown) {
    const readable = await this.transaction((tx) =>
      this.run(tx, actorId, runId),
    );
    await this.validateSources(readable);
    const p = z
      .object({
        operationId: z.string().uuid(),
        expectedRevision: z.number().int().positive(),
        modelId: z.string().min(1),
        additionalBudgetCents: z.number().int().nonnegative(),
        limitsHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .parse(raw);
    const result = await this.transaction(async (tx) => {
      const r = await this.run(tx, actorId, runId);
      await guardActor(tx, this.actor(r), r.mode === "execute");
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${"native-agent-start:" + actorId},0))`,
      );
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${"native-agent-write:" + runId},0))`,
      );
      const digest = hash({ runId, ...p });
      const [old] = await rows(
        tx,
        sql`select * from native_agent_run_controls where operation_id=${p.operationId}`,
      );
      if (old) {
        if (old.actor_id !== actorId || old.payload_hash !== digest)
          fail("AGENT_OPERATION_MISMATCH", "续跑operationId已用于不同操作");
        return old.result;
      }
      const policySettings = await this.policy?.get();
      if (p.limitsHash !== hash(policySettings ?? AGENT_LIMITS))
        fail("AGENT_BUDGET_CHANGED", "服务端预算配置已变化，请重新查看后确认");
      const [current] = await rows(
        tx,
        sql`select * from native_agent_runs where id=${runId} for update`,
      );
      if (
        current.status !== "paused" ||
        current.cancel_requested ||
        current.revision !== p.expectedRevision
      )
        fail("AGENT_RESUME_NOT_READY", "任务不在可续跑状态或版本已变化");
      const [unknown] = await rows(
        tx,
        sql`select j.id from native_agent_model_jobs m join generation_jobs j on j.id=m.job_id where m.run_id=${runId} and j.provider_submission_state in ('unknown','submitting') limit 1`,
      );
      if (unknown)
        fail(
          "AGENT_SUBMISSION_UNKNOWN",
          "原付费请求提交状态不明，请先核查，禁止换模型盲目重试",
        );
      if (!(await this.driver.models()).some((m) => m.id === p.modelId))
        fail("AGENT_MODEL_UNAVAILABLE", "选择的模型没有已核验工具能力", 422);
      const [other] = await rows(
        tx,
        sql`select id from native_agent_runs where actor_id=${actorId} and id<>${runId} and status not in ('completed','failed','cancelled')`,
      );
      if (other) fail("AGENT_RUN_ACTIVE", "存在其他未结束任务");
      await this.policy?.selection(
        p.modelId,
        Number(current.budget_cents) + p.additionalBudgetCents,
        false,
      );
      const segment = policySettings?.limits ?? AGENT_LIMITS;
      const previous = limitsFor(current),
        limits = {
          ...previous,
          rounds: previous.rounds + segment.rounds,
          tools: previous.tools + segment.tools,
          totalTokens: previous.totalTokens + segment.totalTokens,
          activeMs: previous.activeMs + segment.activeMs,
        };
      let context = current.context,
        phase = current.phase;
      if (phase === "tools") {
        const unanswered = (current.pending_calls ?? []) as ToolCall[];
        if (unanswered.length)
          context = [
            ...context,
            {
              role: "tool",
              content: unanswered.map((c) => ({
                type: "tool-result",
                toolCallId: c.toolCallId,
                toolName: c.toolName,
                output: {
                  type: "json",
                  value: { notExecuted: true, reason: current.error_code },
                },
              })),
            },
            {
              role: "user",
              content:
                "平台停止了超限或失败批次，未执行其中操作。保留既有计划，缩小片段和参数后重新提出剩余操作，不得声称先前批次已成功。",
            },
          ];
        phase = "model";
      }
      if (phase === "plan_execute") {
        await tx.execute(
          sql`update native_agent_plans set status='revised',updated_at=now() where run_id=${runId} and status in ('approved','executing')`,
        );
        await tx.execute(
          sql`update native_agent_approvals set status='revised' where run_id=${runId} and status='approved'`,
        );
        await tx.execute(
          sql`update native_agent_steps set status='cancelled' where run_id=${runId} and kind='tool' and status in ('pending','awaiting_approval','failed')`,
        );
        context = [
          ...context,
          {
            role: "user",
            content:
              "平台检测到写入未完成，原计划审批不再有效。请先读取最新画布，保留已有节点，按原目标重新提出剩余操作完整计划，必须再次审批，不得覆盖他人的修改。",
          },
        ];
        phase = "model";
      }
      const output = {
        runId,
        status: "planning",
        approvedAdditionalLimits: segment,
        additionalBudgetCents: p.additionalBudgetCents,
      };
      await tx.execute(
        sql`update native_agent_runs set status='planning',phase=${phase},model_id=${p.modelId},budget_limits=${JSON.stringify(limits)}::jsonb,budget_cents=budget_cents+${p.additionalBudgetCents},consecutive_failures=0,error_code=null,error_message=null,finished_at=null,pending_calls='[]',context=${JSON.stringify(context)}::jsonb,revision=revision+1,updated_at=now() where id=${runId}`,
      );
      await tx.execute(
        sql`insert into native_agent_run_controls(operation_id,run_id,actor_id,payload_hash,result) values(${p.operationId},${runId},${actorId},${digest},${JSON.stringify(output)}::jsonb)`,
      );
      await this.event(tx, current, "run.resumed", output);
      return output;
    });
    await this.enqueue(runId).catch(() => undefined);
    return result;
  }
  async recoverPending() {
    const r = await this.pool.query(
      "select id from native_agent_runs where status in ('pending','planning','running') order by created_at",
    );
    for (const x of r.rows) await this.enqueue(x.id).catch(() => undefined);
  }
  async drive(runId: string) {
    const lock = await this.pool.connect();
    const acquired = (
      await lock.query(
        "select pg_try_advisory_lock(hashtextextended($1,0)) ok",
        ["native-agent-worker:" + runId],
      )
    ).rows[0].ok;
    if (!acquired) {
      lock.release();
      return;
    }
    try {
      while (true) {
        let r = (
          await this.pool.query("select * from native_agent_runs where id=$1", [
            runId,
          ])
        ).rows[0] as Row | undefined;
        if (
          !r ||
          terminal.includes(r.status) ||
          ["awaiting_approval", "awaiting_manual_review", "paused"].includes(
            r.status,
          )
        )
          return;
        const limits = limitsFor(r);
        if (r.active_started_at)
          r.elapsed_ms = await this.transaction((tx) =>
            this.accountActive(tx, runId),
          );
        const started = Date.now();
        const clock = await this.pool.query(
          "update native_agent_runs set active_started_at=clock_timestamp() where id=$1 and not cancel_requested and status in ('pending','planning','running') returning active_started_at",
          [runId],
        );
        if (!clock.rows.length) return;
        r.active_started_at = clock.rows[0].active_started_at;
        try {
          await this.transaction((tx) =>
            guardActor(tx, this.actor(r!), r!.mode === "execute"),
          );
          const executionPolicy = await this.policy?.assertRun(r);
          await this.validateSources(r);
          if (
            r.elapsed_ms >= limits.activeMs ||
            (r.phase === "model" && r.rounds >= limits.rounds) ||
            r.tool_count > limits.tools
          )
            fail(
              "AGENT_RUN_LIMIT",
              "任务达到已批准的时间、模型轮次或工具预算",
              422,
            );
          if (
            Number(r.input_tokens) + Number(r.output_tokens) >
            limits.totalTokens
          )
            fail(
              "AGENT_TOKEN_LIMIT",
              "实际用量已超过Token预算，停止后续工具与模型调用",
              422,
            );
          const uncertain = (
            await this.pool.query(
              "select id from native_agent_steps where run_id=$1 and kind='model' and status='submitting'",
              [runId],
            )
          ).rows[0];
          if (uncertain && r.phase !== "receipt")
            fail(
              "AGENT_SUBMISSION_UNKNOWN",
              "上次模型请求结果不明，保留原操作ID并等待人工核查",
            );
          if (r.phase === "plan_execute") {
            await this.withToolTimeout(() => this.plans.execute(r!), true, r);
            continue;
          }
          if (r.phase === "model" || r.phase === "receipt") {
            const plan =
              r.plan_protocol === 1 ? await this.plans.latest(r.id) : null;
            const toolNames =
              r.purpose === "model_probe"
                ? ["get_canvas_state"]
                : plan?.steps?.some(
                      (s: any) => s.toolName === "create_canvas_node",
                    )
                  ? [
                      "create_canvas_node",
                      "connect_canvas_nodes",
                      "update_canvas_node",
                      "get_canvas_state",
                      "list_canvas_nodes",
                      "read_knowledge",
                    ]
                  : undefined;
            const context = compactContext(
                r.context as ModelMessage[],
                toolNames,
              ),
              estimate = contextCost(context, toolNames);
            if (
              Number(r.input_tokens) + Number(r.output_tokens) + estimate >
              limits.totalTokens
            )
              fail(
                "AGENT_TOKEN_LIMIT",
                "累计Token预算不足，已停止后续模型调用",
                422,
              );
            const original =
              r.phase === "receipt"
                ? (
                    await this.pool.query(
                      "select s.id from native_agent_steps s join native_agent_model_jobs m on m.step_id=s.id join generation_jobs j on j.id=m.job_id where s.run_id=$1 and s.kind='model' and s.status in ('unknown','failed','submitting') and j.provider_submission_state='resolved' and j.billing_status='settled' and j.credit_delivery_status='released' order by s.ordinal desc limit 1",
                      [runId],
                    )
                  ).rows[0]
                : null;
            if (r.phase === "receipt" && !original)
              fail(
                "AGENT_RECEIPT_NOT_READY",
                "原请求回执尚未核验，未重新调用模型",
              );
            const stepId = original?.id ?? randomUUID();
            await this.transaction(async (tx) => {
              await guardActor(tx, this.actor(r!), r!.mode === "execute");
              if (!original)
                await tx.execute(
                  sql`insert into native_agent_steps(id,run_id,ordinal,kind,operation_id,status,input,input_hash,started_at) values(${stepId},${runId},(select coalesce(max(ordinal),0)+1 from native_agent_steps where run_id=${runId}),'model',${stepId},'submitting',${JSON.stringify({ modelId: r!.model_id, admissionPolicyVersion: r!.policy_snapshot?.version ?? null, executionPolicyVersion: executionPolicy?.version ?? null, contextHash: hash(context), contextEstimate: estimate })}::jsonb,${hash(context)},now())`,
                );
              await tx.execute(
                sql`update native_agent_runs set status='planning',rounds=rounds+${original ? 0 : 1},updated_at=now() where id=${runId} and not cancel_requested`,
              );
              await this.event(
                tx,
                r!,
                original ? "model.receipt_reconciled" : "model.started",
                { stepId, round: r!.rounds + (original ? 0 : 1) },
                stepId,
              );
            });
            const controller = new AbortController(),
              timeout = setTimeout(
                () => controller.abort(),
                Math.max(
                  1,
                  Math.min(
                    limits.modelMs,
                    limits.activeMs - r.elapsed_ms - (Date.now() - started),
                  ),
                ),
              );
            const cancelPoll = setInterval(() => {
              void this.pool
                .query(
                  "select cancel_requested from native_agent_runs where id=$1",
                  [runId],
                )
                .then((v) => {
                  if (v.rows[0]?.cancel_requested) controller.abort();
                })
                .catch(() => controller.abort());
            }, 1000);
            let reply;
            try {
              reply = await this.driver.run(
                r.model_id,
                context,
                controller.signal,
                async (delta) => {
                  await this.transaction(async (tx) => {
                    await this.event(
                      tx,
                      r!,
                      "message.delta",
                      { delta },
                      stepId,
                    );
                  });
                },
                {
                  actor: this.actor(r),
                  stepId,
                  mode: r.mode,
                  budgetCents: r.budget_cents,
                  planning:
                    r.plan_protocol === 1 && r.mode === "execute"
                      ? true
                      : undefined,
                  toolNames,
                },
              );
            } finally {
              clearTimeout(timeout);
              clearInterval(cancelPoll);
            }
            await this.transaction(async (tx) => {
              const recorded = await rows(
                tx,
                sql`insert into native_agent_usage(run_id,step_id,model_id,input_tokens,output_tokens,meter_status,job_id,supplier_cents) values(${runId},${stepId},${r!.model_id},${reply.inputTokens},${reply.outputTokens},${reply.meterStatus},${reply.jobId ?? null},${reply.supplierCents ?? 0}) on conflict(step_id) do nothing returning id`,
              );
              await tx.execute(
                sql`update native_agent_steps set input_tokens=${reply.inputTokens},output_tokens=${reply.outputTokens},provider_request_id=${reply.requestId ?? null},output=${JSON.stringify({ text: reply.text, calls: reply.calls })}::jsonb where id=${stepId}`,
              );
              if (recorded.length)
                await tx.execute(
                  sql`update native_agent_runs set input_tokens=input_tokens+${reply.inputTokens},output_tokens=output_tokens+${reply.outputTokens} where id=${runId}`,
                );
            });
            // SDK validates actual tool calls; validate again against the server registry before persisting/executing.
            const calls: ToolCall[] = reply.calls.map((c) => ({
              ...c,
              input: parseTool(c.toolName, c.input),
              stepId: randomUUID(),
              operationId: randomUUID(),
            }));
            if (new Set(calls.map((c) => c.toolCallId)).size !== calls.length)
              fail("AGENT_DUPLICATE_CALL", "模型返回重复工具调用ID", 422);
            if (r.tool_count + calls.length > limits.tools)
              fail(
                "AGENT_TOOL_LIMIT",
                "工具调用数超过批准上限，未执行本批次",
                422,
              );
            await this.transaction(async (tx) => {
              await tx.execute(
                sql`update native_agent_steps set status='completed',output=${JSON.stringify({ text: reply.text, calls })}::jsonb,input_tokens=${reply.inputTokens},output_tokens=${reply.outputTokens},provider_request_id=${reply.requestId ?? null},finished_at=now() where id=${stepId}`,
              );
              if (reply.text)
                await tx.execute(
                  sql`insert into native_agent_messages(session_id,run_id,turn_id,item_id,role,content) values(${r!.session_id},${runId},${runId},${stepId},'assistant',${reply.text}) on conflict(run_id,item_id) do nothing`,
                );
              for (const c of calls)
                await tx.execute(
                  sql`insert into native_agent_steps(id,run_id,ordinal,kind,tool_name,tool_call_id,operation_id,status,input,input_hash) values(${c.stepId},${runId},(select coalesce(max(ordinal),0)+1 from native_agent_steps where run_id=${runId}),'tool',${c.toolName},${c.toolCallId},${c.operationId},'pending',${JSON.stringify(c.input)}::jsonb,${hash(c.input)})`,
                );
              const ctx = [...context, ...reply.messages];
              await tx.execute(
                sql`update native_agent_runs set context=${JSON.stringify(ctx)}::jsonb,pending_calls=${JSON.stringify(calls)}::jsonb,tool_count=tool_count+${calls.length},phase='tools',status=case when cancel_requested then 'cancelled' else 'running' end,revision=revision+1,updated_at=now() where id=${runId}`,
              );
              await this.event(
                tx,
                r!,
                "model.completed",
                { stepId, toolCount: calls.length },
                stepId,
              );
            });
          } else await this.executeTools(r);
        } catch (e) {
          const error = publicError(e);
          const unknown = [
            "AGENT_SUBMISSION_UNKNOWN",
            "AGENT_EXECUTION_UNCONFIRMED",
            "AGENT_METER_UNKNOWN",
            "AGENT_BILLING_UNCONFIRMED",
            "AGENT_MODEL_RECEIPT_INVALID",
            "AGENT_QUOTE_EXCEEDED",
          ].includes(error.code);
          await this.transaction(async (tx) => {
            await tx.execute(
              sql`update native_agent_runs set status=${unknown ? "awaiting_manual_review" : r!.plan_protocol === 1 ? "paused" : "failed"},consecutive_failures=consecutive_failures+1,error_code=${error.code},error_message=${error.message},finished_at=${unknown ? sql`null` : sql`now()`},revision=revision+1,updated_at=now() where id=${runId} and not cancel_requested`,
            );
            await tx.execute(
              sql`update native_agent_steps set status=${unknown ? "unknown" : "failed"},error_code=${error.code},error_message=${error.message},finished_at=now() where run_id=${runId} and (status in ('pending','submitting','running') or (${r!.plan_protocol !== 1} and status='awaiting_approval'))`,
            );
            await this.event(tx, r!, "run.error", error);
          });
          return;
        } finally {
          await this.transaction((tx) => this.accountActive(tx, runId));
        }
      }
    } finally {
      await this.policy?.finishProbe(runId).catch(() => undefined);
      await lock
        .query("select pg_advisory_unlock(hashtextextended($1,0))", [
          "native-agent-worker:" + runId,
        ])
        .catch(() => undefined);
      lock.release();
    }
  }
  private async executeTools(r: Row) {
    const round = (
      await this.pool.query(
        "select input_tokens,output_tokens from native_agent_steps where run_id=$1 and kind='model' and status='completed' order by ordinal desc limit 1",
        [r.id],
      )
    ).rows[0];
    if (
      round &&
      Number(round.input_tokens) + Number(round.output_tokens) >
        AGENT_LIMITS.contextTokens
    )
      fail(
        "AGENT_CONTEXT_LIMIT",
        "模型实际单轮用量超过12k，费用及原结果已保留，未执行本轮工具",
        422,
      );
    const actor = this.actor(r),
      calls = r.pending_calls as ToolCall[];
    if (!calls.length) {
      if (
        r.plan_protocol === 1 &&
        r.mode === "execute" &&
        (await this.plans.reviewOrSeal(r))
      )
        return;
      await this.transaction(async (tx) => {
        await guardActor(tx, actor);
        await tx.execute(
          sql`update native_agent_runs set status='completed',finished_at=now(),revision=revision+1 where id=${r.id} and not cancel_requested`,
        );
        await this.event(tx, r, "run.completed", { status: "completed" });
      });
      return;
    }
    const writes = calls.filter(
      (c) => registry[c.toolName as ToolName].requiresApproval,
    );
    if (writes.length && r.mode === "advice")
      fail(
        "AGENT_ADVICE_READ_ONLY",
        "建议模式不执行业务写入，请切换执行模式后重新制定计划",
        403,
      );
    const continuous = r.plan_protocol === 1 && r.mode === "execute";
    const staged =
      continuous && writes.length ? await this.plans.stage(r, writes) : {};
    if (writes.length && !continuous) {
      const [approval] = (
        await this.pool.query(
          "select * from native_agent_approvals where run_id=$1 and calls=$2::jsonb and status in ('pending','approved') order by created_at desc limit 1",
          [r.id, JSON.stringify(calls)],
        )
      ).rows;
      if (!approval) {
        const preview = await Promise.all(
          writes.map(async (c) => {
            const p = c.input as any;
            const source =
              p.reference &&
              r.sources.find(
                (s: any) =>
                  s.documentId === p.reference.documentId &&
                  s.spaceId === p.reference.spaceId,
              );
            const summary =
              c.toolName === "create_canvas_node"
                ? p.type === "knowledge:document"
                  ? `引用「${source?.title ?? "知识文档"}」· ${p.reference.mode === "pinned" ? "固定 r" + p.reference.revision : "最新版本"}`
                  : `创建文本节点「${p.title}」`
                : c.toolName === "connect_canvas_nodes"
                  ? `${p.sourcePortId} → ${p.targetPortId}`
                  : c.toolName === "create_knowledge_document"
                    ? `新建知识文档「${p.title}」`
                    : "更新文本节点配置";
            if (c.toolName === "apply_knowledge_relation") {
              const link = await this.knowledge.previewLink(
                actor.actorId,
                p.spaceId,
                p.sourceId,
                p.targetId,
                "add",
              );
              if (link.requiresEditor)
                fail(
                  "KNOWLEDGE_LINK_REQUIRES_EDITOR",
                  "此处无法安全自动插入链接，请打开原文定位编辑",
                  422,
                );
              if (link.expectedRevision !== p.expectedRevision)
                fail(
                  "KNOWLEDGE_REVISION_CONFLICT",
                  "关联来源已变化，请重新读取并制定计划",
                );
              return {
                tool: c.toolName,
                summary: `「${link.sourceTitle}」→「${link.targetTitle}」`,
                operationId: c.operationId,
                parameters: {
                  ...(c.input as object),
                  markdownAppend: link.markdown.slice(
                    link.beforeMarkdown.length,
                  ),
                },
              };
            }
            return {
              tool: c.toolName,
              summary,
              operationId: c.operationId,
              parameters: c.input,
            };
          }),
        );
        await this.transaction(async (tx) => {
          await guardActor(tx, actor, true);
          await tx.execute(
            sql`insert into native_agent_approvals(run_id,actor_id,payload_hash,calls,preview) values(${r.id},${r.actor_id},${hash(calls)},${JSON.stringify(calls)}::jsonb,${JSON.stringify(preview)}::jsonb)`,
          );
          await tx.execute(
            sql`update native_agent_steps set status='awaiting_approval' where run_id=${r.id} and status='pending'`,
          );
          await this.accountActive(tx, r.id);
          await tx.execute(
            sql`update native_agent_runs set status='awaiting_approval',revision=revision+1 where id=${r.id} and not cancel_requested`,
          );
          await this.event(tx, r, "approval.required", {
            tools: writes.map((c) => c.toolName),
          });
        });
        return;
      }
      if (approval.status !== "approved") return;
      if (approval.payload_hash !== hash(calls))
        fail("AGENT_APPROVAL_MISMATCH", "待执行参数与批准计划不一致");
      // Heterogeneous knowledge/canvas writes are rejected before any side effect, rather than claiming cross-service atomicity.
      if (
        writes.some((c) =>
          ["create_knowledge_document", "apply_knowledge_relation"].includes(
            c.toolName,
          ),
        ) &&
        writes.length !== 1
      )
        fail(
          "AGENT_PLAN_SPLIT_REQUIRED",
          "知识文档创建必须作为独立审批步骤执行，其他写操作尚未执行",
          422,
        );
    }
    const results: Record<string, any> = { ...staged };
    const canvasCalls = (continuous ? [] : writes).filter((c) =>
      [
        "create_canvas_node",
        "connect_canvas_nodes",
        "update_canvas_node",
      ].includes(c.toolName),
    );
    if (canvasCalls.length) {
      const approval = (
        await this.pool.query(
          "select id from native_agent_approvals where run_id=$1 and status='approved' and payload_hash=$2",
          [r.id, hash(calls)],
        )
      ).rows[0];
      const receipt = await this.withToolTimeout(
        () => this.canvas.apply(actor, approval.id, canvasCalls),
        true,
        r,
      );
      for (const c of canvasCalls)
        results[c.toolCallId] = {
          ...(receipt.result.calls as any)[c.toolCallId],
          revision: receipt.revision,
          operationId: receipt.operationId,
          replayed: receipt.replayed,
        };
      await this.transaction((tx) =>
        this.event(tx, r, "canvas.saved", {
          revision: receipt.revision,
          nodeIds: receipt.result.createdNodeIds,
          operationId: receipt.operationId,
        }),
      );
    }
    for (const c of calls) {
      if (results[c.toolCallId]) continue;
      await this.transaction(async (tx) => {
        await guardActor(
          tx,
          actor,
          registry[c.toolName as ToolName].requiresApproval,
        );
        const state = await rows(
          tx,
          sql`select cancel_requested from native_agent_runs where id=${r.id}`,
        );
        if (state[0]?.cancel_requested) fail("AGENT_CANCELLED", "任务已取消");
      });
      const done = (
        await this.pool.query(
          "select output from native_agent_steps where id=$1 and status='completed'",
          [c.stepId],
        )
      ).rows[0];
      if (done) {
        results[c.toolCallId] = done.output;
        continue;
      }
      const p = parseTool(c.toolName, c.input) as any;
      await this.transaction((tx) =>
        this.event(
          tx,
          r,
          "tool.started",
          { tool: c.toolName, stepId: c.stepId },
          c.stepId,
        ),
      );
      const value = registry[c.toolName as ToolName].outputSchema.parse(
        JSON.parse(
          JSON.stringify(
            await this.withToolTimeout(
              () => this.runTool(actor, c, p),
              registry[c.toolName as ToolName].requiresApproval,
              r,
            ),
          ),
        ),
      );
      results[c.toolCallId] = value;
      // Search excerpts and relation suggestions are knowledge too. Recheck every contributing space on later model calls.
      if (
        p.spaceId &&
        !r.sources.some((s: any) => s.spaceId === p.spaceId && !s.documentId)
      )
        r.sources.push({ spaceId: p.spaceId });
      const documentSources =
        c.toolName === "search_knowledge"
          ? (value as any).items.map((d: any) => ({
              title: d.title,
              spaceId: d.spaceId,
              documentId: d.id,
              revision: d.revision,
              contentHash: d.contentHash,
            }))
          : c.toolName === "read_knowledge"
            ? [value]
            : [
                  "create_knowledge_document",
                  "apply_knowledge_relation",
                ].includes(c.toolName)
              ? [
                  {
                    ...(value as object),
                    spaceId: p.spaceId,
                    documentId: (value as any).id,
                  },
                ]
              : [];
      for (const raw of documentSources) {
        const source = z
          .object({
            title: z.string(),
            spaceId: z.string().uuid(),
            documentId: z.string().uuid(),
            revision: z.number().int().positive(),
            contentHash: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .parse(raw);
        if (
          !r.sources.some(
            (s: any) =>
              s.documentId === source.documentId &&
              s.spaceId === source.spaceId &&
              s.revision === source.revision,
          )
        )
          r.sources.push({
            ...source,
            ...(c.toolName === "read_knowledge"
              ? { ranges: [(value as any).range] }
              : {}),
          });
        else if (c.toolName === "read_knowledge") {
          const existing = r.sources.find(
            (s: any) =>
              s.documentId === source.documentId &&
              s.revision === source.revision &&
              s.spaceId === source.spaceId,
          );
          existing.ranges ??= [];
          if (
            !existing.ranges.some(
              (range: any) =>
                range.start === (value as any).range.start &&
                range.end === (value as any).range.end,
            )
          )
            existing.ranges.push((value as any).range);
        }
      }
      await this.transaction(async (tx) => {
        await tx.execute(
          sql`update native_agent_steps set status='completed',output=${JSON.stringify(value)}::jsonb,finished_at=now() where id=${c.stepId}`,
        );
        await tx.execute(
          sql`update native_agent_runs set sources=${JSON.stringify(r.sources)}::jsonb where id=${r.id}`,
        );
        await this.event(
          tx,
          r,
          "tool.completed",
          { tool: c.toolName, stepId: c.stepId },
          c.stepId,
        );
      });
    }
    const content = calls.map((c) => ({
      type: "tool-result",
      toolCallId: c.toolCallId,
      toolName: c.toolName,
      output: { type: "json", value: results[c.toolCallId] },
    }));
    await this.transaction(async (tx) => {
      for (const c of calls)
        if (!(continuous && registry[c.toolName as ToolName].requiresApproval))
          await tx.execute(
            sql`update native_agent_steps set status='completed',output=${JSON.stringify(results[c.toolCallId])}::jsonb,finished_at=coalesce(finished_at,now()) where id=${c.stepId}`,
          );
      await tx.execute(
        sql`update native_agent_runs set context=${JSON.stringify([...r.context, { role: "tool", content }])}::jsonb,pending_calls='[]',phase='model',revision=revision+1,updated_at=now() where id=${r.id}`,
      );
      await tx.execute(
        sql`update native_agent_approvals set status='completed' where run_id=${r.id} and status='approved'`,
      );
    });
  }
  private async runTool(actor: AgentActor, c: ToolCall, p: any): Promise<any> {
    if (p.spaceId) {
      const spaces = await this.knowledge.spaces(actor.actorId);
      if (
        !spaces.some(
          (s) =>
            s.id === p.spaceId &&
            (s.kind === "personal" || s.project_id === actor.projectId),
        )
      )
        fail(
          "AGENT_SPACE_FORBIDDEN",
          "只能访问本人的个人知识和当前项目知识空间",
          403,
        );
    }
    if (c.toolName === "create_knowledge_document") {
      const { spaceId, ...payload } = p;
      return this.knowledge.write(
        actor.actorId,
        spaceId,
        { operationId: c.operationId, action: "document.create", payload },
        (tx) => guardWrite(tx, actor),
      );
    }
    if (c.toolName === "apply_knowledge_relation")
      return this.knowledge.write(
        actor.actorId,
        p.spaceId,
        {
          operationId: c.operationId,
          action: "document.linkAdd",
          payload: {
            id: p.sourceId,
            targetId: p.targetId,
            expectedRevision: p.expectedRevision,
          },
        },
        (tx) => guardWrite(tx, actor),
      );
    if (c.toolName === "get_project_context") {
      const canvas = await this.canvas.state(actor),
        project = await this.canvas.repository.getProjectForUser(
          actor.projectId,
          actor.actorId,
        ),
        spaces = await this.knowledge.spaces(actor.actorId);
      return {
        project,
        revision: canvas.revision,
        nodeCount: canvas.nodes.length,
        edgeCount: canvas.edges.length,
        spaces: spaces.filter(
          (s) => s.kind === "personal" || s.project_id === actor.projectId,
        ),
        nodeTypes: [
          {
            type: "text",
            input: "text.input",
            output: "text.output",
            resourceType: "text",
          },
          {
            type: "knowledge:document",
            output: "knowledge.output",
            resourceType: "text",
          },
        ],
        mode: "server-authorized",
      };
    }
    if (c.toolName === "get_canvas_state") {
      if (p.operationId)
        return this.canvas.repository.getCanvasOperationReceiptForUser(
          actor.projectId,
          actor.actorId,
          p.operationId,
        );
      const canvas = await this.canvas.state(actor);
      const plan = await this.plans.latest(actor.runId);
      return {
        plannedNodes:
          plan?.status === "draft"
            ? plan.steps
                .filter(
                  (s: any) =>
                    s.toolName === "create_canvas_node" && !s.dedupeOf,
                )
                .map((s: any) => ({
                  id: s.stepId,
                  ...s.input,
                  persisted: false,
                }))
            : [],
        revision: canvas.revision,
        nodeIds: canvas.nodes.map((n) => n.id),
        edgeIds: canvas.edges.map((e) => e.id),
      };
    }
    if (c.toolName === "list_canvas_nodes") {
      const canvas = await this.canvas.state(actor),
        nodes = canvas.nodes.slice(
          (p.page - 1) * p.pageSize,
          p.page * p.pageSize,
        );
      return {
        revision: canvas.revision,
        total: canvas.nodes.length,
        nodes: nodes.map(({ id, type, title, position }) => ({
          id,
          type,
          title,
          position,
        })),
        edges: canvas.edges.filter((e) =>
          nodes.some((n) => n.id === e.fromNodeId || n.id === e.toNodeId),
        ),
      };
    }
    return readBusinessTool(this.knowledge, this.jobs, actor, c.toolName, p);
  }
  private async withToolTimeout<T>(
    start: () => Promise<T>,
    write: boolean,
    r: Row,
  ): Promise<T> {
    const remaining =
      limitsFor(r).activeMs -
      Number(r.elapsed_ms) -
      (Date.now() - new Date(r.active_started_at).getTime());
    if (remaining <= 0)
      fail("AGENT_RUN_LIMIT", "任务有效执行时间已达15分钟", 422);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        start(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new DomainError(
                  write ? "AGENT_EXECUTION_UNCONFIRMED" : "AGENT_TOOL_TIMEOUT",
                  write
                    ? "写入超时，原operationId已保留，请查询回执；不会盲目重试"
                    : "读取工具超时，已停止本轮",
                  409,
                ),
              ),
            Math.min(limitsFor(r).toolMs, remaining),
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
import { requireNativeAgentFeature as guardActorFeature } from "./feature.js";
