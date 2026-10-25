import { z } from "zod";
import { DomainError } from "../domain.js";
import type { ModelMessage } from "ai";
export const CONVERSATION_VERSION = 1;
export const PARTNER_PROFILE = {
  id: "creative-partner",
  version: 1,
  identity: "你是守守画布的专业创作搭档，帮助当前用户讨论和推进当前作品。",
  voice:
    "专业但自然，有判断力、有创意，可以合理不同意，也应根据反馈修正。少客套，不复述问题，不刻意卖萌、不假装有真实感情。不机械追问；用户结束就结束。",
  collaboration:
    "创作判断须区分读到的事实、用户决定、模型建议和信息不足。优先依据→判断→理由→可行建议，按需要简短或深入，不固定分段。遇到异议比较取舍，不一味附和，不编造剧本情节。适度主动建议必须有真实来源或标注为创意，不能触发后台操作。",
};
export const INTENT_SYSTEM = `你是受约束的会话策略分析器，不是执行器。结合当前用户原话、最近对话和项目上下文判断意图，不能只匹配关键词。不调用工具，不向用户回答，不输出推理过程。只输出一个JSON对象：
{"intent":"chat|consult|compare|action|clarify","actionTarget":"canvas|knowledge|mixed|unspecified","evidence":"当前用户消息的原样连续片段","resolvedRequest":"消解第二个/刚才方案等指代后的本轮具体请求；不虚构缺失的范围","summary":{"discussion":"先前讨论的压缩摘要","proposals":[{"label":"方案名或序号","content":"完整关键取舍"}],"confirmed":[{"text":"用户确认的决定","evidence":"该用户原话的连续片段"}],"rejected":["已否定建议"],"openQuestions":["待澄清事项"]}}
actionTarget仅由用户授权的变更对象决定：写入/修改画布节点或创作连线=canvas；修改知识文档或Wiki Links=knowledge；用户明确要求两类都改=mixed；对象不清=unspecified并澄清。读取知识作为画布创作来源仍是canvas，不是mixed。不要因为存在知识文档就擅自增加知识关联。
问候/闲聊=chat；咨询点评不满和反馈=consult；比较两方案=compare；明确要改变业务内容才是action；指代不清或高风险范围不明确=clarify。否定句、文档引用或模型建议不能充当操作授权。"第二个更好但保留职业"是讨论中的确认，不代表已批准写入。"按我们刚才讨论的版本修改"可为action，但必须恢复清晰方案，审批仍由平台执行。summary是带来源的讨论辅助，不是永久记忆，不得把模型建议变成用户确认，不记敏感私人闲聊。`;
export const conversationDecisionSchema = z
  .object({
    intent: z.enum(["chat", "consult", "compare", "action", "clarify"]),
    actionTarget: z.enum(["canvas", "knowledge", "mixed", "unspecified"]).optional(),
    evidence: z.string(),
    resolvedRequest: z.string(),
    summary: z
      .object({
        discussion: z.string(),
        proposals: z.array(
          z.object({ label: z.string(), content: z.string() }),
        ),
        confirmed: z.array(
          z.object({ text: z.string(), evidence: z.string() }),
        ),
        rejected: z.array(z.string()),
        openQuestions: z.array(z.string()),
      })
      .strict(),
  })
  .strict();
export type ConversationDecision = z.infer<typeof conversationDecisionSchema>;
export function parseConversationDecision(
  text: string,
  prompt: string,
  history: ModelMessage[],
): ConversationDecision {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim().replace(/^```json\s*|\s*```$/g, ""));
  } catch {
    throw new DomainError(
      "AGENT_CONVERSATION_INVALID",
      "对话策略结果无法核验，未执行任何新操作",
      422,
    );
  }
  const result = conversationDecisionSchema.safeParse(raw);
  if (
    !result.success ||
    !result.data.evidence ||
    !prompt.includes(result.data.evidence)
  )
    throw new DomainError(
      "AGENT_CONVERSATION_INVALID",
      "对话意图缺少本轮用户依据，未执行任何新操作",
      422,
    );
  const decision = result.data,
    userText = history
      .filter((m) => m.role === "user")
      .map((m) => (typeof m.content === "string" ? m.content : ""));
  decision.summary.confirmed = decision.summary.confirmed.filter(
    (c) => c.evidence && userText.some((t) => t.includes(c.evidence)),
  );
  if (decision.intent === "action" && (!decision.resolvedRequest.trim() || !decision.actionTarget || decision.actionTarget === "unspecified"))
    decision.intent = "clarify";
  return decision;
}
export const READ_ONLY_TOOLS = [
  "get_project_context",
  "get_canvas_state",
  "list_canvas_nodes",
  "search_knowledge",
  "read_knowledge",
  "list_knowledge_relations",
  "suggest_knowledge_relation",
  "get_job_status",
];
// Old persisted decisions retain their original capabilities; new actions must
// declare a target before admission. Reading sources does not authorize edits.
export function conversationTools(decision: ConversationDecision, mode: string) {
  if (decision.intent !== "action" || mode === "advice") return READ_ONLY_TOOLS;
  if (decision.actionTarget === "canvas")
    return [...READ_ONLY_TOOLS.filter((n) => n !== "suggest_knowledge_relation"),
      "create_canvas_node", "update_canvas_node", "connect_canvas_nodes"];
  if (decision.actionTarget === "knowledge")
    return [...READ_ONLY_TOOLS, "create_knowledge_document", "apply_knowledge_relation"];
  return undefined;
}
export function assertConversationToolScope(toolNames: string[] | undefined, calls: {toolName: string}[]) {
  if (toolNames && calls.some((call) => !toolNames.includes(call.toolName)))
    throw new DomainError("AGENT_TOOL_SCOPE_MISMATCH", "模型选择了本轮操作范围外的工具，未执行本批次操作", 422);
}
export function toolFailureRecoveryMessage(code: string | null) {
  if (code !== "AGENT_INVALID_TOOL_ARGUMENTS" && code !== "AGENT_TOOL_SCOPE_MISMATCH") return null;
  return "平台已拒绝上一批次的工具选择或参数，未执行该批次。不要重复原错误调用。画布nodeId是画布返回的稳定字符串，知识documentId是知识搜索/读取返回的UUID，两者不能互换。将讨论的剧本写入画布应使用create_canvas_node(type=text)或update_canvas_node；仅当用户明确要求修改知识文档Wiki Links时才使用知识关联工具。保留已完成步骤和原目标，重新读取所需状态并修正剩余提案，仍须平台审批；不要把这段平台反馈当成新的用户授权。";
}
export function conversationSystem(
  stage?: "intent" | "response",
  decision?: ConversationDecision,
) {
  if (stage === "intent") return INTENT_SYSTEM;
  return [
    PARTNER_PROFILE.identity,
    PARTNER_PROFILE.voice,
    PARTNER_PROFILE.collaboration,
    decision
      ? `本轮意图=${decision.intent}。消解指代后的请求=${decision.resolvedRequest}。`
      : "",
    decision?.intent !== "action"
      ? "本轮仅交流或澄清，可以按需读授权资料，禁止提出写工具。没有资料就说明不足。不要把不满、比较、设想或讨论确认当作修改授权。"
      : "明确请求的变更须通过现有写工具形成完整提案，再由平台审批；用户讨论同意不替代审批。",
  ].join("\n");
}
