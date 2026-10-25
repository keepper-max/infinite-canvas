import { isConversationOnly } from "./conversation-intent.js";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import type { KnowledgeService } from "../knowledge-service.js";
import { DomainError } from "../domain.js";
import { AgentCanvasService } from "./canvas-service.js";
import { guardWrite, type AgentTx } from "./guard.js";
import type { AgentActor, ToolCall } from "./contracts.js";
type Row = Record<string, any>;
export type PlanStep = ToolCall & { dependencies: string[]; dedupeOf?: string };
const canvasTools = new Set([
  "create_canvas_node",
  "connect_canvas_nodes",
  "update_canvas_node",
]);
const actor = (r: Row): AgentActor => ({
  actorId: r.actor_id,
  projectId: r.project_id,
  runId: r.id,
});
const rows = async (tx: AgentTx, q: ReturnType<typeof sql>) =>
  (await tx.execute(q)).rows as Row[];
const canonicalHash = async (tx: AgentTx, value: unknown) =>
  String(
    (
      await tx.execute(
        sql`select encode(sha256(convert_to(${JSON.stringify(value)}::jsonb::text,'UTF8')),'hex') hash`,
      )
    ).rows[0].hash,
  );
const effective = (steps: PlanStep[]) =>
  steps.filter((s) => !s.dedupeOf).map(({ dependencies, dedupeOf, ...c }) => c);
/** Durable proposals only. Business persistence remains exclusively in the existing CAS service. */
export class AgentPlanService {
  constructor(
    private knowledge: KnowledgeService,
    private pool: Pool,
    private canvas: AgentCanvasService,
    private emit: (
      tx: AgentTx,
      r: Row,
      type: string,
      data: unknown,
      item?: string,
    ) => Promise<void>,
    private executeBusiness: (
      actor: AgentActor,
      call: ToolCall,
      input: any,
    ) => Promise<any>,
  ) {}
  async latest(runId: string) {
    return (
      await this.pool.query(
        "select * from native_agent_plans where run_id=$1 order by created_at desc,id desc limit 1",
        [runId],
      )
    ).rows[0] as Row | undefined;
  }
  async stage(r: Row, calls: ToolCall[]) {
    return this.knowledge.db.transaction(async (tx) => {
      await guardWrite(tx, actor(r));
      let [plan] = await rows(
        tx,
        sql`select * from native_agent_plans where run_id=${r.id} and status='draft' for update`,
      );
      if (!plan) {
        const [version] = await rows(
          tx,
          sql`select coalesce(max(revision),0)+1 n from native_agent_plans where run_id=${r.id}`,
        );
        [plan] = await rows(
          tx,
          sql`insert into native_agent_plans(run_id,revision,goal) values(${r.id},${Number(version.n)},${r.prompt}) returning *`,
        );
      }
      const steps: PlanStep[] = [...plan.steps],
        results: Record<string, any> = {};
      let changed = false;
      const byPayload = new Map<string, PlanStep>();
      for (const step of steps)
        if (!step.dedupeOf)
          byPayload.set(
            step.toolName + ":" + (await canonicalHash(tx, step.input)),
            step,
          );
      for (const c of calls) {
        const repeated = steps.find((s) => s.stepId === c.stepId);
        if (repeated) {
          if (
            (await canonicalHash(tx, repeated.input)) !==
              (await canonicalHash(tx, c.input)) ||
            repeated.toolName !== c.toolName
          )
            throw new DomainError(
              "AGENT_OPERATION_MISMATCH",
              "已持久化计划步骤参数不一致",
              409,
            );
          const [saved] = await rows(
            tx,
            sql`select output from native_agent_steps where id=${c.stepId}`,
          );
          results[c.toolCallId] = saved.output;
          continue;
        }
        changed = true;
        const inputKey = c.toolName + ":" + (await canonicalHash(tx, c.input)),
          previous = byPayload.get(inputKey);
        const p = c.input as any;
        const dependencies = steps
          .filter(
            (s) =>
              s.toolName === "create_canvas_node" &&
              [p.fromNodeId, p.toNodeId, p.nodeId].includes(s.stepId),
          )
          .map((s) => s.stepId);
        steps.push({
          ...c,
          dependencies,
          ...(previous ? { dedupeOf: previous.stepId } : {}),
        });
        if (!previous) byPayload.set(inputKey, steps.at(-1)!);
        results[c.toolCallId] = {
          proposalOnly: true,
          persisted: false,
          planId: plan.id,
          planStepId: previous?.stepId ?? c.stepId,
          operationId: previous?.operationId ?? c.operationId,
          ...(c.toolName === "create_canvas_node"
            ? {
                plannedNodeId: previous?.stepId ?? c.stepId,
                nodeType: p.type,
                ...(p.reference?.documentId
                  ? { documentId: p.reference.documentId }
                  : {}),
                ...(p.title !== undefined ? { title: p.title } : {}),
                revision: p.expectedCanvasRevision,
              }
            : {}),
          ...(c.toolName === "connect_canvas_nodes"
            ? { plannedEdgeId: previous?.stepId ?? c.stepId }
            : {}),
          message:
            "仅加入完整计划，尚未创建。用plannedNodeId规划连线；继续补齐整个用户目标，最后统一审批。",
        };
        await tx.execute(
          sql`update native_agent_steps set status='awaiting_approval',output=${JSON.stringify(results[c.toolCallId])}::jsonb where id=${c.stepId}`,
        );
        await this.emit(
          tx,
          r,
          "plan.step_proposed",
          { planId: plan.id, stepId: c.stepId, tool: c.toolName },
          c.stepId,
        );
      }
      if (changed)
        await tx.execute(
          sql`update native_agent_plans set steps=${JSON.stringify(steps)}::jsonb,revision=revision+1,reviewed_revision=null,updated_at=now() where id=${plan.id}`,
        );
      return results;
    });
  }
  async reviewOrSeal(r: Row) {
    const plan = await this.latest(r.id);
    if (!plan || !plan.steps.length) {
      if (r.conversation?.intent && r.conversation.intent !== "action")
        return false;
      if (!r.conversation && isConversationOnly(r.prompt)) return false;
      if (r.goal_reviewed)
        throw new DomainError(
          "AGENT_NO_EXECUTABLE_PLAN",
          "模型只返回了文字说明，未提交可执行计划；没有业务写入，请调整任务或显式批准续跑",
          422,
        );
      await this.knowledge.db.transaction(async (tx) => {
        await guardWrite(tx, actor(r));
        const last = [...(r.context ?? [])]
          .reverse()
          .find((message: any) => message.role === "assistant");
        const priorText =
          typeof last?.content === "string"
            ? last.content
            : Array.isArray(last?.content)
              ? last.content
                  .filter((part: any) => part.type === "text")
                  .map((part: any) => part.text)
                  .join("\n")
              : "";
        const review = {
          role: "user",
          content: `平台完成性核对（不增加授权）：原目标为「${r.prompt}」。当前数据库没有持久化写入提案。先区分用户意图：问候、聊天、点评、分析不需要写入，直接自然回答，不要强行生成计划。仅当原目标明确要求创建或修改业务内容时，文字列表不能被审批或执行。你的上一条说明：${priorText}。仅在确需写入时，请使用实际注册写工具提出完成原目标所需操作，继续用plannedNodeId补齐依赖和连接，然后由平台统一请求审批。不要用自然语言再次索取确认，不要声称已创建。来源版本：${JSON.stringify(r.sources ?? [])}。如果无法形成有效提案，请明确原因，平台会暂停而非标记执行完成。`,
        };
        await tx.execute(
          sql`update native_agent_runs set goal_reviewed=true,context=context||${JSON.stringify([review])}::jsonb,phase='model',revision=revision+1 where id=${r.id}`,
        );
        await this.emit(tx, r, "plan.review_required", {
          reason: "no_executable_proposal",
        });
      });
      return true;
    }
    if (plan.status !== "draft") return false;
    if (plan.reviewed_revision !== plan.revision) {
      await this.knowledge.db.transaction(async (tx) => {
        await guardWrite(tx, actor(r));
        await tx.execute(
          sql`update native_agent_plans set reviewed_revision=revision where id=${plan.id} and revision=${plan.revision}`,
        );
        const message = {
          role: "user",
          content: `平台计划完整性核对（不是额外授权）：原目标为「${r.prompt}」。目前只是提案，未执行业务写入。计划详情：${JSON.stringify(plan.steps.map((s: PlanStep) => ({ stepId: s.stepId, tool: s.toolName, parameters: s.input, dependencies: s.dependencies, dedupeOf: s.dedupeOf })))}。请核对已提案步骤能否完整实现目标，工作流应包含所需有效连线；如有遗漏继续通过工具补齐，使用已返回的plannedNodeId，不要重复创建相同提案；完整时简洁总结，平台将只请求一次整计划确认。`,
        };
        await tx.execute(
          sql`update native_agent_runs set context=context||${JSON.stringify([message])}::jsonb,phase='model',revision=revision+1 where id=${r.id}`,
        );
      });
      return true;
    }
    const calls = effective(plan.steps);
    const isCanvas = calls.every((c) => canvasTools.has(c.toolName));
    if (
      !isCanvas &&
      (calls.length !== 1 ||
        !["create_knowledge_document", "apply_knowledge_relation"].includes(
          calls[0].toolName,
        ))
    )
      throw new DomainError(
        "AGENT_PLAN_SPLIT_REQUIRED",
        "跨知识与画布的混合写入需拆分独立计划，尚未执行任何写入",
        422,
      );
    if (!isCanvas) {
      const p = calls[0].input as any;
      const spaces = await this.knowledge.spaces(r.actor_id);
      if (
        !spaces.some(
          (s) =>
            s.id === p.spaceId &&
            (s.kind === "personal" || s.project_id === r.project_id),
        )
      )
        throw new DomainError(
          "AGENT_SPACE_FORBIDDEN",
          "知识写入仅限本人个人空间及当前项目空间",
          403,
        );
      await this.knowledge.run(
        r.actor_id,
        p.spaceId,
        true,
        async () => undefined,
      );
      if (calls[0].toolName === "apply_knowledge_relation") {
        const preview = await this.knowledge.previewLink(
          r.actor_id,
          p.spaceId,
          p.sourceId,
          p.targetId,
          "add",
        );
        if (
          preview.requiresEditor ||
          preview.expectedRevision !== p.expectedRevision
        )
          throw new DomainError(
            "KNOWLEDGE_REVISION_CONFLICT",
            "知识关联需要重新定位或版本已变化",
            409,
          );
      }
    }
    const mutation = isCanvas
      ? await this.canvas.preview(actor(r), calls)
      : { nodes: [], edges: [] };
    const nodes = (mutation.nodes as any[])
      .filter((n) =>
        calls.some(
          (c) => c.toolName === "create_canvas_node" && c.stepId === n.id,
        ),
      )
      .map((n) => ({ id: n.id, title: n.title, type: n.type }));
    const edges = (mutation.edges as any[])
      .filter((e) =>
        calls.some(
          (c) => c.toolName === "connect_canvas_nodes" && c.stepId === e.id,
        ),
      )
      .map((e) => ({
        id: e.id,
        fromNodeId: e.fromNodeId,
        toNodeId: e.toNodeId,
      }));
    const scope = {
      kind: isCanvas ? "canvas" : "knowledge",
      expectedCanvasRevision: (calls[0].input as any).expectedCanvasRevision,
      expectedTools: calls.map((c) => c.toolName),
      nodeIds: nodes.map((n) => n.id),
      edgeIds: edges.map((e) => e.id),
      budgetCents: r.budget_cents,
      additionalModelCallsAfterApproval: 0,
      sources: r.sources,
    };
    const outputs = { nodes, edges };
    const digest = await this.knowledge.db.transaction((tx) =>
      canonicalHash(tx, {
        planId: plan.id,
        revision: plan.revision,
        goal: plan.goal,
        steps: plan.steps,
        scope,
        outputs,
      }),
    );
    await this.knowledge.db.transaction(async (tx) => {
      await guardWrite(tx, actor(r));
      const [current] = await rows(
        tx,
        sql`select * from native_agent_plans where id=${plan.id} for update`,
      );
      if (current.revision !== plan.revision || current.status !== "draft")
        throw new DomainError(
          "AGENT_APPROVAL_STALE",
          "计划已变化，请重新核对",
          409,
        );
      const approvalId = randomUUID();
      const preview = calls.map((c) => ({
        tool: c.toolName,
        operationId: c.operationId,
        parameters: c.input,
        summary:
          c.toolName === "create_canvas_node"
            ? `创建${nodes.find((n) => n.id === c.stepId)?.type === "text" ? "文本" : "知识"}节点「${nodes.find((n) => n.id === c.stepId)?.title ?? ""}」`
            : c.toolName === "connect_canvas_nodes"
              ? `${nodes.find((n) => n.id === (c.input as any).fromNodeId)?.title ?? (c.input as any).fromNodeId} → ${nodes.find((n) => n.id === (c.input as any).toNodeId)?.title ?? (c.input as any).toNodeId}`
              : "更新允许的文本字段",
      }));
      await tx.execute(
        sql`insert into native_agent_approvals(id,run_id,actor_id,payload_hash,calls,preview,revision) values(${approvalId},${r.id},${r.actor_id},${digest},${JSON.stringify(calls)}::jsonb,${JSON.stringify(preview)}::jsonb,${plan.revision})`,
      );
      await tx.execute(
        sql`update native_agent_plans set status='awaiting_approval',approval_id=${approvalId},payload_hash=${digest},approval_scope=${JSON.stringify(scope)}::jsonb,expected_outputs=${JSON.stringify(outputs)}::jsonb,updated_at=now() where id=${plan.id}`,
      );
      await tx.execute(
        sql`update native_agent_runs set pending_calls=${JSON.stringify(calls)}::jsonb,status='awaiting_approval',elapsed_ms=elapsed_ms+case when active_started_at is null then 0 else greatest(0,floor(extract(epoch from (clock_timestamp()-active_started_at))*1000))::bigint end,active_started_at=null,revision=revision+1 where id=${r.id}`,
      );
      await this.emit(tx, r, "approval.required", {
        planId: plan.id,
        revision: plan.revision,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        tools: calls.map((c) => c.toolName),
      });
    });
    return true;
  }
  async execute(r: Row) {
    const plan = await this.latest(r.id);
    if (!plan || !["approved", "executing"].includes(plan.status))
      throw new DomainError(
        "AGENT_APPROVAL_MISMATCH",
        "没有已批准的完整计划",
        409,
      );
    const calls = effective(plan.steps);
    const digest = await this.knowledge.db.transaction((tx) =>
      canonicalHash(tx, {
        planId: plan.id,
        revision: plan.revision,
        goal: plan.goal,
        steps: plan.steps,
        scope: plan.approval_scope,
        outputs: plan.expected_outputs,
      }),
    );
    const approval = (
      await this.pool.query(
        "select * from native_agent_approvals where id=$1 and status='approved'",
        [plan.approval_id],
      )
    ).rows[0];
    if (
      !approval ||
      approval.payload_hash !== digest ||
      plan.payload_hash !== digest ||
      (await this.knowledge.db.transaction((tx) =>
        canonicalHash(tx, approval.calls),
      )) !==
        (await this.knowledge.db.transaction((tx) => canonicalHash(tx, calls)))
    )
      throw new DomainError(
        "AGENT_APPROVAL_MISMATCH",
        "执行范围与已审批计划不一致",
        409,
      );
    await this.knowledge.db.transaction(async (tx) => {
      await guardWrite(tx, actor(r));
      await tx.execute(
        sql`update native_agent_plans set status='executing',updated_at=now() where id=${plan.id}`,
      );
    });
    let receipt: any;
    if (plan.approval_scope.kind === "knowledge") {
      const c = calls[0],
        result = await this.executeBusiness(actor(r), c, c.input);
      receipt = {
        revision: result.revision,
        operationId: c.operationId,
        result: { calls: { [c.toolCallId]: result } },
        knowledge: result,
      };
    } else receipt = await this.canvas.apply(actor(r), plan.approval_id, calls);
    await this.finish(r, plan, receipt);
  }
  async reconcile(r: Row) {
    const plan = await this.latest(r.id);
    if (
      !plan ||
      plan.status !== "executing" ||
      plan.approval_scope.kind !== "canvas"
    )
      return false;
    const receipt =
      await this.canvas.repository.getCanvasOperationReceiptForUser(
        r.project_id,
        r.actor_id,
        plan.approval_id,
      );
    await this.finish(r, plan, receipt);
    return true;
  }
  private async finish(r: Row, plan: Row, receipt: any) {
    const outputs = {
      ...plan.expected_outputs,
      revision: receipt.revision,
      operationId: receipt.operationId,
      replayed: receipt.replayed,
    };
    await this.knowledge.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${"native-agent-write:" + r.id},0))`,
      );
      const [current] = await rows(
        tx,
        sql`select status from native_agent_plans where id=${plan.id} for update`,
      );
      if (current.status === "completed") return;
      for (const c of plan.steps as PlanStep[]) {
        const original = c.dedupeOf
          ? (plan.steps as PlanStep[]).find((s) => s.stepId === c.dedupeOf)!
          : c;
        const result = {
          ...receipt.result.calls[original.toolCallId],
          revision: receipt.revision,
          operationId: receipt.operationId,
          persisted: true,
        };
        await tx.execute(
          sql`update native_agent_steps set status='completed',output=${JSON.stringify(result)}::jsonb,finished_at=now() where id=${c.stepId}`,
        );
        await this.emit(
          tx,
          r,
          "tool.completed",
          { tool: c.toolName, stepId: c.stepId },
          c.stepId,
        );
      }
      await tx.execute(
        sql`update native_agent_plans set status='completed',outputs=${JSON.stringify(outputs)}::jsonb,updated_at=now() where id=${plan.id}`,
      );
      await tx.execute(
        sql`update native_agent_approvals set status='completed' where id=${plan.approval_id}`,
      );
      await tx.execute(
        sql`update native_agent_runs set status=case when cancel_requested then 'cancelled' else 'completed' end,phase='plan_finished',pending_calls='[]',finished_at=now(),revision=revision+1 where id=${r.id}`,
      );
      const message = receipt.knowledge
        ? `知识文档「${receipt.knowledge.title}」已实际保存，revision=${receipt.revision}。`
        : `已根据服务器实际保存回执创建${outputs.nodes.length}个节点、${outputs.edges.length}条连接，画布 revision=${receipt.revision}。${outputs.nodes.map((n: any) => n.title).join("、")}。`;
      await tx.execute(
        sql`insert into native_agent_messages(session_id,run_id,turn_id,item_id,role,content) values(${r.session_id},${r.id},${r.id},${"plan:" + plan.id + ":result"},'assistant',${message}) on conflict(run_id,item_id) do nothing`,
      );
      if (!receipt.knowledge)
        await this.emit(tx, r, "canvas.saved", {
          ...outputs,
          nodeIds: outputs.nodes.map((n: any) => n.id),
          edgeIds: outputs.edges.map((e: any) => e.id),
        });
      const [actual] = await rows(
        tx,
        sql`select status from native_agent_runs where id=${r.id}`,
      );
      await this.emit(
        tx,
        r,
        actual.status === "cancelled" ? "run.cancelled" : "run.completed",
        { status: actual.status, planId: plan.id, revision: receipt.revision },
      );
    });
  }
}
