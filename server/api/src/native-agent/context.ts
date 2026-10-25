import type { ModelMessage } from "ai";
import { DomainError } from "../domain.js";
import { AGENT_LIMITS } from "./limits.js";
import { AGENT_SYSTEM, AGENT_PLANNING_SYSTEM } from "./model.js";
import { registry } from "./tools.js";
import { z } from "zod";
import { getEncoding } from "js-tiktoken";
const tokenizer = getEncoding("o200k_base");
// Explicit tokenizer profile for the isolated compatible adapter. A paid adapter must verify its own profile.
// Include schemas and reserve the approved output allowance for protocol framing/output, rather than chars/4.
export const contextCost = (messages: ModelMessage[], toolNames?: string[]) => {
  const text = JSON.stringify({
    system: AGENT_SYSTEM + AGENT_PLANNING_SYSTEM,
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
