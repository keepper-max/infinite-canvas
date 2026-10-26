import type { ProviderConfig } from "./config.js";
import { DomainError } from "./domain.js";
import { createPinhaozhanTransport } from "./pinhaozhan-transport.js";
import { AGENT_LIMITS } from "./native-agent/limits.js";
/** Fixed provider guidance: passed through the SDK's trusted system entry. */
export const PINHAOZHAN_SYSTEM_SUFFIX = '\n工具协议要求：function.arguments的JSON必须直接符合对应工具的parameters schema；除非schema明确声明，不能再套parameters、arguments、input或工具名称等外层。空对象schema对应的arguments必须是{}，不能写成{"parameters":{}}。保留所有服务端身份、权限、预算和审批要求；不得添加schema未声明的字段。';

const transport = createPinhaozhanTransport();
export function pinhaozhanFetch(input: Parameters<typeof fetch>[0], init?: RequestInit) {
  return fetch(input, { ...init, dispatcher: transport.agent } as RequestInit);
}

const fail = (code: string, message: string): never => { throw new DomainError(code, message, 409); };
export const PINHAOZHAN_MODEL = "deepseek-v4.1-flash";
/** No credentials in URLs, redirects, error messages or persisted receipts. */
export async function pinhaozhanJson(config: ProviderConfig, path: string, authenticated: boolean, signal?: AbortSignal) {
  const base = new URL(config.baseUrl);
  if (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname))
    fail("AGENT_PROVIDER_INVALID", "供应商接口必须使用HTTPS");
  if (base.username || base.password || base.search || base.hash || base.pathname !== "/")
    fail("AGENT_PROVIDER_INVALID", "供应商地址必须为不含凭据的站点根地址");
  try {
    const response = await fetch(new URL(path, base), {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0", ...(authenticated ? { Authorization: "Bearer " + config.apiKey } : {}) },
      redirect: "error", signal: signal ?? AbortSignal.timeout(AGENT_LIMITS.modelMs), dispatcher: transport.readonly,
    } as RequestInit);
    if (!response.ok) fail("AGENT_PROVIDER_UNAVAILABLE", `供应商只读接口返回HTTP ${response.status}`);
    return await response.json() as Record<string, any>;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    return fail("AGENT_PROVIDER_UNAVAILABLE", "供应商只读接口连接失败，备用地址尝试后仍不可用；未提交新的推理请求");
  }
}

/** Fresh independent read checks overlap; neither one can authorize a paid submission alone. */
export async function pinhaozhanPreflight(
  config: ProviderConfig,
  price: { fx: number; quotePoints: number; contextTokens: number; outputTokens: number },
  signal: AbortSignal,
  checkpoint: (phase: string) => Promise<void>,
) {
  const cancelled = new AbortController();
  const scoped = AbortSignal.any([signal, cancelled.signal]);
  let failedCheck: string | undefined;
  const check = async (name: string, path: string, authenticated: boolean) => {
    await checkpoint(name + "_started");
    try {
      const result = await pinhaozhanJson(config, path, authenticated, scoped);
      if (name === "pricing") pinhaozhanPrice(result, price.fx, price.quotePoints, price.contextTokens, price.outputTokens);
      else if (result.success !== true || !Array.isArray(result.data))
        fail("AGENT_BILLING_UNCONFIRMED", "供应商账单接口不可用，未提交推理");
      await checkpoint(name + "_completed");
    } catch (error) {
      failedCheck ??= name;
      await checkpoint(name + (scoped.aborted ? "_cancelled" : "_failed"));
      throw error;
    }
  };
  const checks = [check("pricing", "/api/pricing", false), check("ledger", "/api/log/token", true)];
  try {
    await Promise.all(checks);
    scoped.throwIfAborted();
    await checkpoint("preflight_completed");
  } catch (error) {
    cancelled.abort();
    await Promise.allSettled(checks);
    // A cancelled sibling must not replace the actual failing endpoint in diagnostics.
    await checkpoint(failedCheck ? "preflight_failed_" + failedCheck : "preflight_cancelled");
    throw error;
  }
}

export function pinhaozhanPrice(payload: Record<string, any>, fx: number, quotePoints: number, contextTokens: number, outputTokens: number) {
  const rows = Array.isArray(payload.data) ? payload.data.filter((x: any) => x.model_name === PINHAOZHAN_MODEL) : [];
  const row = rows[0];
  const groups = Object.values(payload.group_ratio || {});
  if (payload.success !== true || rows.length !== 1 || row.quota_type !== 0 || !Number.isFinite(row.model_ratio) || row.model_ratio <= 0 ||
      !Number.isFinite(row.completion_ratio) || row.completion_ratio <= 0 || !Array.isArray(row.enable_groups) || row.enable_groups.length !== 1 || row.enable_groups[0] !== "default" ||
      !groups.length || groups.some(v => typeof v !== "number" || !Number.isFinite(v) || v <= 0) || !Number.isFinite(fx) || fx <= 0 || !Number.isFinite(quotePoints) || quotePoints <= 0)
    fail("AGENT_PRICE_UNVERIFIED", "供应商价格或分组无法核验，未提交推理请求");
  const maxGroup = Math.max(...groups as number[]);
  // New API defines 500,000 quota units per USD. Use the full admitted context,
  // no cache discounts, platform's existing 1.2 markup and 100 points/CNY.
  const maximumPoints = Math.ceil((contextTokens + outputTokens * row.completion_ratio) * row.model_ratio * maxGroup / 500000 * fx * 120);
  if (maximumPoints > quotePoints) fail("AGENT_PRICE_CHANGED", "模型价格超出本轮积分预留，未提交推理请求");
  return { modelRatio: row.model_ratio, completionRatio: row.completion_ratio, maximumPoints };
}

export function pinhaozhanReceipt(payload: Record<string, any>, requestId: string, prompt: unknown, completion: unknown) {
  if (payload.success !== true || !Array.isArray(payload.data) || !requestId)
    return fail("AGENT_BILLING_UNCONFIRMED", "供应商账单不可核验，保留预留并停止后续调用");
  const rows = payload.data.filter((r: any) => r.request_id === requestId);
  const row = rows[0];
  if (rows.length !== 1 || row.type !== 2 || row.model_name !== PINHAOZHAN_MODEL ||
      !Number.isSafeInteger(row.quota) || row.quota < 0 || !Number.isSafeInteger(prompt) || !Number.isSafeInteger(completion) ||
      row.prompt_tokens !== prompt || row.completion_tokens !== completion)
    return fail("AGENT_BILLING_UNCONFIRMED", "供应商账单身份、用量或金额不一致，保留预留并停止后续调用");
  return { requestId, quota: row.quota, amountUsd: (row.quota / 500000).toFixed(6), promptTokens: row.prompt_tokens, completionTokens: row.completion_tokens };
}
