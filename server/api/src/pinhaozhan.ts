import type { ProviderConfig } from "./config.js";
import { DomainError } from "./domain.js";

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
      redirect: "error", signal,
    });
    if (!response.ok) fail("AGENT_PROVIDER_UNAVAILABLE", `供应商只读接口返回HTTP ${response.status}`);
    return await response.json() as Record<string, any>;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    return fail("AGENT_PROVIDER_UNAVAILABLE", "供应商只读接口不可用，未自动重试");
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
