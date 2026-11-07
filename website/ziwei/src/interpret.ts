import { chartKnowledge, KNOWLEDGE_VERSION } from "./knowledge";
import { ziweiContext, ziweiReady, type ZiweiState } from "./input";

export const INTERPRET_ENDPOINT = "/api/website/ziwei/interpret";
export const INTERPRET_SYSTEM = "你是紫微斗数传统文化学习助手。仅依据提供的结构化命盘和规则证据解读，区分命盘事实、传统解释与不确定推测。格局标签不是人生结论；必须同时呈现成立条件、加分条件与破格条件。关系主题结合命宫、夫妻宫、福德宫；只有单人资料，不生成双人合盘评分。不要编造星曜、出处或课程引文，不作确定性的人生、疾病、灾祸、投资或婚姻预测。用简体中文给出概览、证据、可供自我观察的问题与限制。";

export function interpretationData(state: ZiweiState) {
  const context = ziweiContext(state);
  if (!context || !ziweiReady(state)) throw new Error("请先生成与当前资料一致的命盘");
  const chart = JSON.parse(context.slice(context.indexOf("{"))) as Record<string, unknown>;
  return { chart, knowledge: chartKnowledge(state.result!.chart) };
}
export function buildInterpretationMessages(state: ZiweiState) {
  return [
    { role: "system" as const, content: INTERPRET_SYSTEM },
    { role: "user" as const, content: "请为以下单人命盘提供传统文化学习解读。\n" + JSON.stringify(interpretationData(state)) },
  ];
}
export function interpretationPrompt(state: ZiweiState) {
  return buildInterpretationMessages(state).map(message => message.content).join("\n\n");
}
export type InterpretRequest = {
  schemaVersion: 1;
  requestId: string;
  chartFingerprint: string;
  knowledgeVersion: string;
  chart: Record<string, unknown>;
};
export type InterpretResponse = { schemaVersion: 1; requestId: string; chartFingerprint: string; text: string; model?: string; remainingCalls?: number };
export async function createInterpretRequest(state: ZiweiState): Promise<InterpretRequest> {
  const { chart } = interpretationData(state);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(chart)));
  return { schemaVersion: 1, requestId: crypto.randomUUID(), chartFingerprint: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""), knowledgeVersion: KNOWLEDGE_VERSION, chart };
}
// Provider-neutral same-origin contract, ready for a server-side DeepSeek adapter.
// No model key, provider base URL, raw birth details or arbitrary system prompt is sent by this client.
export async function requestInterpretation(request: InterpretRequest, options: { signal?: AbortSignal; fetcher?: typeof fetch } = {}): Promise<InterpretResponse> {
  const response = await (options.fetcher || fetch)(INTERPRET_ENDPOINT, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: options.signal });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || "AI 解读暂不可用，请稍后重试");
  const data = payload?.data;
  if (data?.schemaVersion !== 1 || data.requestId !== request.requestId || data.chartFingerprint !== request.chartFingerprint || typeof data.text !== "string" || !data.text.trim()) throw new Error("解读结果与当前请求不匹配，请重新提交");
  return data;
}
