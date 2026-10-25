import { createHash } from "node:crypto";
import type { ModelMessage } from "ai";
import { DomainError } from "../domain.js";
import { AGENT_LIMITS } from "./limits.js";
import {
  AGENT_SYSTEM,
  AGENT_PLANNING_SYSTEM,
  agentSystem,
  type ModelExecution,
} from "./model.js";
import { registry } from "./tools.js";
import { z } from "zod";
import { getEncoding } from "js-tiktoken";
const tokenizer = getEncoding("o200k_base");
// Explicit tokenizer profile for the isolated compatible adapter. A paid adapter must verify its own profile.
// Include schemas and reserve the approved output allowance for protocol framing/output, rather than chars/4.
export const contextCost = (
  messages: ModelMessage[],
  toolNames?: string[],
  execution?: Partial<ModelExecution>,
  trustedSystemSuffix = "",
) => {
  const text = JSON.stringify({
    system: (execution
      ? agentSystem(execution)
      : AGENT_SYSTEM + AGENT_PLANNING_SYSTEM) + trustedSystemSuffix,
    messages,
    tools: Object.fromEntries(
      Object.entries(registry)
        .filter(([key]) => !toolNames || toolNames.includes(key))
        .map(([k, t]) => [
          k,
          { description: t.description, schema: z.toJSONSchema(t.inputSchema) },
        ]),
    ),
  });
  // Bounded tokenizer chunks avoid pathological quadratic work on long whitespace-free imported text.
  // Special-token-looking document text is data, never tokenizer control syntax.
  return (
    (text.match(/.{1,256}/gsu) ?? []).reduce(
      (sum, chunk) => sum + tokenizer.encode(chunk, [], []).length,
      0,
    ) + AGENT_LIMITS.outputTokens
  );
};
export function compactContext(messages: ModelMessage[], toolNames?: string[]) {
  let next = structuredClone(messages);
  // Drop complete older turns only, never an assistant call without its tool result.
  while (contextCost(next, toolNames) > AGENT_LIMITS.contextTokens) {
    const boundary = next.findIndex((m, i) => i > 0 && m.role === "user");
    if (boundary < 1)
      throw new DomainError(
        "AGENT_CONTEXT_LIMIT",
        "当前轮资料超过12k上下文安全预算，请缩小任务或读取更短片段；原会话未裁剪",
        422,
      );
    next = next.slice(boundary);
  }
  return next;
}

/** Ephemeral authorized context is never appended to stored conversation history. */
export function assembleConversationContext(
  messages: ModelMessage[],
  prefix: ModelMessage[],
  toolNames: string[] | undefined,
  execution: Partial<ModelExecution>,
) {
  let working = structuredClone(messages);
  while (
    contextCost([...prefix, ...working], toolNames, execution) >
    AGENT_LIMITS.contextTokens
  ) {
    const boundary = working.findIndex((m, i) => i > 0 && m.role === "user");
    if (boundary < 1)
      throw new DomainError(
        "AGENT_CONTEXT_LIMIT",
        "当前资料与讨论摘要超过已批准上下文，原记录已保留，请缩小本轮问题",
        422,
      );
    working = working.slice(boundary);
  }
  return { working, messages: [...prefix, ...working] };
}

/** Exact JSON bytes survive jsonb object-key normalization for original paid-job hashes. */
export function saveConversationModelInput(
  messages: ModelMessage[],
  working: ModelMessage[],
  toolNames: string[] | undefined,
  execution: Partial<ModelExecution>,
) {
  const conversationSnapshot = JSON.stringify({
    version: 1,
    messages,
    working,
    toolNames: toolNames ?? null,
    execution,
  });
  return {
    conversationSnapshot,
    conversationSnapshotHash: createHash("sha256")
      .update(conversationSnapshot)
      .digest("hex"),
  };
}
export function restoreConversationModelInput(input: Record<string, unknown>) {
  const text = input.conversationSnapshot;
  if (
    typeof text !== "string" ||
    createHash("sha256").update(text).digest("hex") !==
      input.conversationSnapshotHash
  )
    throw new DomainError(
      "AGENT_CONVERSATION_REPLAY_INVALID",
      "原步骤上下文无法核验，保留原回执，未重发供应商调用",
      409,
    );
  let value: any;
  try {
    value = JSON.parse(text);
  } catch {
    throw new DomainError(
      "AGENT_CONVERSATION_REPLAY_INVALID",
      "原步骤上下文损坏，未重发供应商调用",
      409,
    );
  }
  if (
    value.version !== 1 ||
    !Array.isArray(value.messages) ||
    !Array.isArray(value.working) ||
    !value.execution ||
    !(value.toolNames === null || Array.isArray(value.toolNames))
  )
    throw new DomainError(
      "AGENT_CONVERSATION_REPLAY_INVALID",
      "原步骤上下文版本无法识别，未重发供应商调用",
      409,
    );
  return {
    messages: value.messages as ModelMessage[],
    working: value.working as ModelMessage[],
    toolNames:
      value.toolNames === null ? undefined : (value.toolNames as string[]),
    execution: value.execution as Partial<ModelExecution>,
  };
}
