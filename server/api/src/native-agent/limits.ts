// Approved defaults; server configuration is explicit and captured on each new Run.
const defaults = {
  rounds: 16,
  tools: 32,
  totalTokens: 64000,
  contextTokens: 12000,
  outputTokens: 2000,
  activeMs: 15 * 60000,
  perUser: 1,
  concurrency: 2,
  modelMs: 60000,
  toolMs: 30000,
  failures: 1,
};
export type AgentLimits = typeof defaults;
const names: Record<keyof AgentLimits, string> = {
  rounds: "ROUNDS",
  tools: "TOOLS",
  totalTokens: "TOTAL_TOKENS",
  contextTokens: "CONTEXT_TOKENS",
  outputTokens: "OUTPUT_TOKENS",
  activeMs: "ACTIVE_MS",
  perUser: "PER_USER",
  concurrency: "CONCURRENCY",
  modelMs: "MODEL_MS",
  toolMs: "TOOL_MS",
  failures: "FAILURES",
};
export function configuredAgentLimits(
  env: NodeJS.ProcessEnv = process.env,
): Readonly<AgentLimits> {
  const result = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof AgentLimits)[]) {
    const raw = env["NATIVE_AGENT_" + names[key]];
    if (raw === undefined) continue;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error("Invalid Native Agent limit: " + names[key]);
    result[key] = value;
  }
  // The DB enforces one unfinished Run per user; configuration cannot weaken it.
  if (result.perUser !== 1 || result.outputTokens >= result.contextTokens)
    throw new Error("Invalid Native Agent user/context limits");
  return Object.freeze(result);
}
export const AGENT_LIMITS = configuredAgentLimits();
export function limitsFor(run: {
  budget_limits?: Partial<AgentLimits> | null;
}): Readonly<AgentLimits> {
  return { ...AGENT_LIMITS, ...run.budget_limits };
}
export const AGENT_PROTOCOL_VERSION = 1;
export const AGENT_MESSAGE_SCHEMA_VERSION = 1;
