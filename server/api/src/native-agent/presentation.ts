/** Read-only user projection. Raw messages, approval hashes and receipts remain authoritative. */
type Row = Record<string, any>;
export type PresentationSnapshot = {
  session: Row;
  runs: Row[];
  messages: Row[];
  steps: Row[];
  plans: Row[];
  approvals: Row[];
  usage: Row[];
  sources: Row[];
};
export const taskStates: Record<string, string> = {
  pending: "排队中",
  planning: "正在整理思路",
  running: "正在处理",
  awaiting_approval: "等待你的确认",
  completed: "已完成",
  paused: "已暂停",
  failed: "未完成",
  cancelled: "已取消",
  awaiting_manual_review: "需要核查",
  unknown: "需要核查",
  submitting: "正在处理",
  awaiting_approval_step: "等待确认",
};
const actions: Record<string, string> = {
  get_project_context: "检查项目",
  get_canvas_state: "检查画布",
  search_knowledge: "查找资料",
  read_knowledge: "阅读资料",
  list_canvas_nodes: "查看画布节点",
  list_knowledge_relations: "查看资料关联",
  create_canvas_node: "创建节点",
  connect_canvas_nodes: "建立连接",
  update_canvas_node: "更新文本节点",
  create_knowledge_document: "保存知识文档",
  suggest_knowledge_relation: "整理关联建议",
  apply_knowledge_relation: "关联知识文档",
  get_job_status: "核查任务结果",
};
export function runControl({
  context,
  pending_calls,
  sources,
  payload_hash,
  ...run
}: Row) {
  return run;
}
export function safeTaskError(code?: string | null) {
  if (!code) return "";
  if (code === "AGENT_ADVICE_READ_ONLY")
    return "当前是建议模式，只会分析。若要创建或修改，请切换执行模式，并重新确认计划。";
  if (code === "AGENT_BUDGET_CHANGED")
    return "平台预算配置发生了变化。请重新查看当前预算，再确认是否继续。";
  if (
    /MODEL_UNAVAILABLE|MODEL_UNVERIFIED|POLICY_DISABLED|AGENT_DISABLED|NATIVE_AGENT_UNAVAILABLE/.test(
      code,
    )
  )
    return "当前模型或助手暂不可用。任务记录已保留，不会自动切换到其他收费模型。";
  if (/CONFLICT|REVISION|APPROVAL_STALE/.test(code))
    return "画布或文档发生了新的修改。为避免覆盖现有内容，这次操作已暂停。请查看差异后重新确认计划。";
  if (/TOKEN|CONTEXT|ROUND|TOOL_LIMIT|TIME_LIMIT|BUDGET|COST_LIMIT/.test(code))
    return "本次任务已达到批准的执行或费用上限，已保留完成的步骤。你可以查看结果，明确批准新预算后继续。";
  if (/CREDIT|BALANCE/.test(code))
    return "当前积分余额不足，尚未发起新的模型调用。请检查余额或调整任务预算。";
  if (
    /BILLING|SUBMISSION_UNKNOWN|METER_UNKNOWN|RECEIPT|UNCONFIRMED|QUOTE_EXCEEDED/.test(
      code,
    )
  )
    return "上次请求的结果或费用仍需核查。请先核查原请求，暂时不要重新提交。";
  if (/FORBIDDEN|PERMISSION|NOT_ENABLED|UNAUTHENTICATED|USER|SOURCE/.test(code))
    return "当前账号或资料权限已变化，暂时无法继续。请检查登录状态及项目、资料访问权限。";
  if (/NOT_FOUND/.test(code))
    return "所需资料或操作记录已无法访问。请重新选择可用资料。";
  return "这次操作未能完成，已保留任务记录。请重新查询状态；如果仍无法继续，可以联系管理员核查。";
}
// This detects SYSTEM protocol content; it never edits arbitrary UUIDs or user-authored text.
const protocolFields = [
  "plannedNodeId",
  "plannedEdgeId",
  "expectedCanvasRevision",
  "expectedRevision",
  "proposalOnly",
  "operationId",
  "toolCallId",
  "approvalId",
  "contentHash",
  "CAS_CONFLICT",
  "create_canvas_node",
  "connect_canvas_nodes",
  "knowledge.output",
  "text.input",
  "runId",
  "stepId",
  "documentId",
  "revision",
  "pinned",
];
function naturalText(text: string, prompt: string, internalIds: Set<string>) {
  // Withhold the entire assistant message; never destructively rewrite a user's technical input.
  if (
    /<(?:think|analysis)>|reasoning_content|\bsk-[a-z0-9_-]{16,}|Bearer\s+[a-z0-9._-]{16,}/i.test(
      text,
    )
  )
    return null;
  if (
    (
      text.match(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      ) ?? []
    ).some((id) => !prompt.includes(id))
  )
    return null;
  if (
    [...internalIds].some(
      (id) => id.length > 12 && text.includes(id) && !prompt.includes(id),
    )
  )
    return null;
  if (
    protocolFields.some(
      (k) =>
        text.toLowerCase().includes(k.toLowerCase()) &&
        !prompt.toLowerCase().includes(k.toLowerCase()),
    )
  )
    return null;
  return text;
}
export function userPresentation(
  raw: PresentationSnapshot,
  nodeTitles: { id: string; title: string }[] = [],
) {
  const ids = new Set<string>();
  const collect = (value: unknown, key = "") => {
    if (Array.isArray(value)) {
      for (const item of value) collect(item, key);
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) collect(v, k);
      return;
    }
    if (
      typeof value === "string" &&
      /(?:id|ids|hash)$/i.test(key) &&
      value.length > 12
    )
      ids.add(value);
  };
  collect({
    runs: raw.runs,
    steps: raw.steps,
    plans: raw.plans,
    approvals: raw.approvals,
    sources: raw.sources,
  });
  for (const x of [
    ...raw.runs,
    ...raw.steps,
    ...raw.plans,
    ...raw.approvals,
    ...raw.sources,
  ])
    for (const key of [
      "id",
      "operation_id",
      "payload_hash",
      "contentHash",
      "documentId",
      "revision",
      "pinned",
      "tool_call_id",
    ])
      if (typeof x[key] === "string") ids.add(x[key]);
  const names = new Map<string, string>(nodeTitles.map((n) => [n.id, n.title]));
  for (const s of raw.sources) names.set(s.documentId, s.title);
  for (const p of raw.plans)
    for (const n of [
      ...(p.expected_outputs?.nodes ?? []),
      ...(p.outputs?.nodes ?? []),
    ]) {
      names.set(n.id, n.title);
      ids.add(n.id);
    }
  for (const s of raw.steps)
    if (s.input?.documentId && s.output?.title)
      names.set(s.input.documentId, s.output.title);
  for (const p of raw.plans)
    for (const s of p.steps ?? [])
      if (s.toolName === "create_canvas_node")
        names.set(
          s.stepId,
          s.input?.title ??
            names.get(s.input?.reference?.documentId) ??
            "知识资料",
        );
  const title = (id: unknown, fallback: string) =>
    names.get(String(id)) ?? fallback;
  const proposal = (step: Row) => {
    const p = step.input ?? step.parameters ?? {},
      tool = step.toolName ?? step.tool;
    if (tool === "create_canvas_node")
      return {
        title:
          p.type === "knowledge:document"
            ? `关联《${title(p.reference?.documentId, "所选知识资料")}》`
            : `创建《${p.title || "文本创作"}》节点`,
        description:
          p.type === "knowledge:document"
            ? p.reference?.mode === "pinned"
              ? Number.isInteger(p.reference?.revision)
                ? `使用资料版本 ${p.reference.revision}（固定版本）。`
                : "使用已确认的固定资料版本"
              : "使用资料的最新授权版本"
            : (p.content ?? ""),
      };
    if (tool === "connect_canvas_nodes")
      return {
        title: `将《${title(p.fromNodeId, "来源节点")}》连接到《${title(p.toNodeId, "目标节点")}》`,
        description: "将来源资料作为目标节点的创作输入",
      };
    if (tool === "create_knowledge_document")
      return {
        title: `创建知识文档《${p.title ?? "新文档"}》`,
        description: p.markdown ?? "",
      };
    if (tool === "apply_knowledge_relation")
      return {
        title: `在《${title(p.sourceId, "来源文档")}》中关联《${title(p.targetId, "目标文档")}》`,
        description: "向来源文档加入确认的双向链接，不改写其他正文。",
      };
    if (tool === "update_canvas_node")
      return {
        title: `更新《${title(p.nodeId, "文本节点")}》`,
        description: [
          p.title ? `标题：${p.title}` : "",
          p.content ? `正文：${p.content}` : "",
        ]
          .filter(Boolean)
          .concat(
            p.position
              ? [`位置：横向 ${p.position.x}，纵向 ${p.position.y}`]
              : [],
          )
          .join("\n"),
      };
    return {
      title: actions[tool] ?? "处理已授权内容",
      description: p.title ?? "",
    };
  };
  const tasks = raw.runs.map((run) => {
    const plan = raw.plans.filter((p) => p.run_id === run.id).at(-1),
      steps = raw.steps.filter((s) => s.run_id === run.id),
      persisted =
        plan?.status === "completed" &&
        Number.isInteger(plan.outputs?.revision) &&
        Array.isArray(plan.outputs?.nodes) &&
        Array.isArray(plan.outputs?.edges);
    const outputs = persisted ? plan.outputs : null,
      nodes: Row[] = outputs?.nodes ?? [],
      edges: Row[] = outputs?.edges ?? [];
    const knowledge = nodes.filter(
        (n) => n.type === "knowledge:document",
      ).length,
      text = nodes.filter((n) => n.type === "text").length;
    const knowledgeIds = new Set(
      nodes.filter((n) => n.type === "knowledge:document").map((n) => n.id),
    );
    const textIds = new Set(
      nodes.filter((n) => n.type === "text").map((n) => n.id),
    );
    const sourceInputs = edges.filter(
      (e) => knowledgeIds.has(e.fromNodeId) && textIds.has(e.toNodeId),
    );
    const connectedSources = new Set(sourceInputs.map((e) => e.fromNodeId))
      .size;
    const targets = [...new Set(sourceInputs.map((e) => e.toNodeId))];
    const targetName =
      targets.length === 1
        ? nodes.find((n) => n.id === targets[0])?.title
        : null;
    const summary = persisted
      ? nodes.length || edges.length
        ? run.status === "cancelled"
          ? "任务已停止，停止前完成的创建结果仍已保存。"
          : connectedSources > 0
            ? `已经帮你搭建好了。${connectedSources} 份资料已连接到${targetName ? `《${targetName}》` : "创作节点"}，本次创建结果也已保存。`
            : `已创建 ${nodes.length} 个节点和 ${edges.length} 条连接，本次创建结果已保存。`
        : "已完成确认的修改，内容已保存。"
      : run.status === "completed"
        ? plan
          ? "这次任务已有历史记录，但保存结果暂时无法完整还原。请查看执行详情或联系管理员核查。"
          : "本次交流已完成。"
        : run.status === "awaiting_approval"
          ? "方案已准备好，确认后才会执行。"
          : (taskStates[run.status] ?? "正在处理任务");
    return {
      runId: run.id,
      status: run.status,
      statusLabel: taskStates[run.status] ?? "正在处理",
      displayTitle: plan?.steps?.length ? "整理创作流程" : "创作交流",
      summary,
      safeErrorMessage: safeTaskError(run.error_code),
      plan: plan
        ? {
            title: "准备执行的方案",
            consequence: plan.steps.some((s: Row) =>
              [
                "create_knowledge_document",
                "apply_knowledge_relation",
              ].includes(s.toolName),
            )
              ? "确认后保存所列知识文档变更。"
              : "确认后保存所列画布变更。",
            items: plan.steps
              .filter((s: Row) => !s.dedupeOf)
              .map((s: Row) => ({ key: s.stepId, ...proposal(s) })),
            nodeCount: plan.steps.filter(
              (s: Row) => !s.dedupeOf && s.toolName === "create_canvas_node",
            ).length,
            edgeCount: plan.steps.filter(
              (s: Row) => !s.dedupeOf && s.toolName === "connect_canvas_nodes",
            ).length,
          }
        : null,
      progressItems: steps
        .filter((s) => s.kind === "tool")
        .map((s) => ({
          key: s.id,
          title:
            s.tool_name === "read_knowledge"
              ? `阅读《${title(s.input?.documentId, "授权资料")}》`
              : (actions[s.tool_name] ?? "处理任务"),
          status: s.status,
          statusLabel:
            s.status === "awaiting_approval"
              ? "等待计划执行"
              : (taskStates[s.status] ?? "等待处理"),
        })),
      result: outputs
        ? {
            saved: true,
            updatedNodes: (plan?.steps ?? [])
              .filter(
                (s: Row) => !s.dedupeOf && s.toolName === "update_canvas_node",
              )
              .map((s: Row) => ({
                id: s.input.nodeId,
                title: title(s.input.nodeId, "文本节点"),
              })),
            nodes: nodes.map((n) => ({
              id: n.id,
              title: n.title,
              type: n.type,
            })),
            knowledgeCount: knowledge,
            textCount: text,
            edgeCount: edges.length,
            revision: outputs.revision ?? null,
          }
        : null,
      technicalTraceRef: run.id,
    };
  });
  const messages: Row[] = [];
  for (const message of raw.messages) {
    if (message.role === "user") {
      messages.push(message);
      continue;
    }
    const run = raw.runs.find((r) => r.id === message.run_id),
      plan = raw.plans.find((p) => p.run_id === message.run_id),
      step = raw.steps.find((s) => s.id === message.item_id);
    if (plan?.steps?.length || message.item_id?.startsWith("plan:")) continue;
    if (
      step?.kind === "model" &&
      raw.steps.some((s) => s.run_id === message.run_id && s.kind === "tool")
    ) {
      // Only the final natural answer is chat; intermediate tool/planning commentary stays in the task card.
      const last = raw.messages
        .filter((m) => m.run_id === message.run_id && m.role === "assistant")
        .at(-1);
      if (last?.item_id !== message.item_id || run?.status !== "completed")
        continue;
    }
    const prompt = raw.messages
      .filter((m) => m.run_id === message.run_id && m.role === "user")
      .map((m) => m.content)
      .join("\n");
    const content = naturalText(message.content, prompt, ids);
    messages.push({
      ...message,
      content:
        content ??
        "这段历史回复包含内部执行信息。请展开任务详情查看实际进度；管理员可以核查原始追踪。",
    });
  }
  return { version: 1 as const, messages, tasks };
}
export function userEvent(e: Row): Row {
  if (e.type === "canvas.saved")
    return {
      ...e,
      data: {
        revision: e.data.revision,
        nodeIds: e.data.nodeIds ?? [],
        edgeIds: e.data.edgeIds ?? [],
      },
    };
  // Never forward raw streaming text, tool arguments or errors, including legacy delta events.
  return { ...e, type: "presentation.updated", data: {} };
}
export function redactTrace(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactTrace);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /api.?key|private.?key|authorization|password|secret|cookie|credential|access.?token|refresh.?token|^token$/i.test(
          k,
        )
          ? "[已脱敏]"
          : redactTrace(v),
      ]),
    );
  if (typeof value === "string")
    return value.replace(/Bearer\s+\S+|sk-[a-zA-Z0-9_-]+/gi, "[已脱敏]");
  return value;
}
