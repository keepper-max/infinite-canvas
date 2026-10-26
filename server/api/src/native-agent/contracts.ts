import { z } from "zod";
import { AGENT_LIMITS } from "./limits.js";
export const uuid = z.string().uuid();
export const mode = z.enum(["advice", "execute"]);
export const sessionInput = z
  .object({
    operationId: uuid,
    projectId: uuid,
    title: z.string().trim().min(1),
    mode,
  })
  .strict();
export const runInput = z
  .object({
    operationId: uuid,
    prompt: z.string().trim().min(1).max(AGENT_LIMITS.contextTokens),
    modelId: z.string().min(1),
    mode,
    budgetCents: z.number().int().nonnegative().default(0),
    conversationVersion: z.literal(1).optional(),
    interaction: z.literal("auto").optional(),
  })
  .strict()
  .refine(p => !p.interaction || (p.conversationVersion === 1 && p.mode === "advice"), {
    message: "自动交互须从只读意图识别开始",
  });
export const decisionInput = z
  .object({
    operationId: uuid,
    expectedRevision: z.number().int().positive(),
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
    decision: z.enum(["approve", "revise", "cancel"]),
    instruction: z.string().max(AGENT_LIMITS.contextTokens).optional(),
  })
  .strict();
export type ToolCall = {
  toolCallId: string;
  toolName: string;
  input: unknown;
  stepId: string;
  operationId: string;
};
export type AgentActor = { actorId: string; projectId: string; runId: string };
export const terminal = ["completed", "failed", "cancelled"];
