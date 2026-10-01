type PricingInput = {
  upstreamModel: string;
  capability: string;
  usage: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  inputSnapshot?: Record<string, unknown>;
  createdAt?: Date | string;
};

const TEXT_RATES: Record<
  string,
  { input: string; cached: string; output: string }
> = {
  "doubao-seed-2-1-pro-260915": { input: "6", cached: "1.2", output: "30" },
  "doubao-seed-2-1-lite-260915": { input: "0.8", cached: "0.16", output: "2.7" },
  "deepseek-v4-1-flash-260910": { input: "2", cached: "0.04", output: "8" },
  "deepseek-v4-pro-ga-260813": { input: "9", cached: "0.3", output: "27" },
  "glm-5-3-flash-260828": { input: "0.8", cached: "0.23", output: "2.8" },
};

const IMAGE_OUTPUT_RATES: Record<string, string> = {
  "doubao-seedream-4-0-20260415": "0.2",
  "doubao-seedream-5-0-flash-260915": "0.12",
};

export function volcengineArkAmount(input: PricingInput) {
  if (input.usage.billable === false) return "0";
  if (input.capability === "text")
    return textAmount(input.upstreamModel, input.usage, input.createdAt);
  if (input.capability === "image")
    return imageAmount(input.upstreamModel, input.usage, input.parameters || {});
  if (input.capability === "video")
    return videoAmount(
      input.upstreamModel,
      input.usage,
      input.parameters || {},
      input.inputSnapshot || {},
    );
  return null;
}

function textAmount(
  model: string,
  usage: Record<string, unknown>,
  createdAt?: Date | string,
) {
  const rates = model === "deepseek-v4-1-flash-260910" && !isDeepseekPeak(createdAt)
    ? { input: "1", cached: "0.02", output: "4" }
    : TEXT_RATES[model];
  const prompt = integer(usage.prompt_tokens ?? usage.input_tokens);
  const completion = integer(usage.completion_tokens ?? usage.output_tokens);
  if (!rates || prompt === null || completion === null) return null;
  const details = record(usage.prompt_tokens_details);
  const cached = Math.min(prompt, integer(details.cached_tokens ?? usage.cached_tokens) || 0);
  return addAmounts([
    tokenAmount(prompt - cached, rates.input),
    tokenAmount(cached, rates.cached),
    tokenAmount(completion, rates.output),
  ]);
}

function isDeepseekPeak(value?: Date | string) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return true;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const weekday = String(parts.weekday || "");
  const hour = Number(parts.hour);
  return !["Sat", "Sun"].includes(weekday) &&
    ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18));
}

function imageAmount(
  model: string,
  usage: Record<string, unknown>,
  parameters: Record<string, unknown>,
) {
  const count = integer(usage.generated_images);
  if (count === null || count < 1) return null;
  if (model === "doubao-seedream-5-0-pro-260628") {
    const outputRate = isAtMost2610000Pixels(parameters.size) ? "0.3" : "0.6";
    const inputCount = Math.max(0, integer(usage.input_images) || 0);
    return addAmounts([
      multiplyAmount(outputRate, count),
      multiplyAmount("0.02", Math.max(0, inputCount - 1)),
    ]);
  }
  const outputRate = IMAGE_OUTPUT_RATES[model];
  return outputRate ? multiplyAmount(outputRate, count) : null;
}

function videoAmount(
  model: string,
  usage: Record<string, unknown>,
  parameters: Record<string, unknown>,
  inputSnapshot: Record<string, unknown>,
) {
  if (model !== "doubao-seedance-2-5-260628") return null;
  const completionTokens = integer(usage.completion_tokens ?? usage.total_tokens);
  if (completionTokens === null) return null;
  const references = Array.isArray(inputSnapshot.references)
    ? inputSnapshot.references
    : [];
  const includesVideo = references.some((value) =>
    String(record(value).mimeType || "").startsWith("video/"),
  );
  const resolution = String(parameters.resolution || "720p").toLowerCase();
  const rate = resolution === "1080p"
    ? includesVideo
      ? "46"
      : "77"
    : includesVideo
      ? "42"
      : "70";
  return tokenAmount(completionTokens, rate);
}

function isAtMost2610000Pixels(value: unknown) {
  const match = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(String(value || ""));
  return Boolean(match && Number(match[1]) * Number(match[2]) <= 2_610_000);
}

function tokenAmount(tokens: number, ratePerMillion: string) {
  return fromScaled((BigInt(tokens) * scaled(ratePerMillion)) / 1_000_000n);
}

function multiplyAmount(value: string, multiplier: number) {
  return fromScaled(scaled(value) * BigInt(multiplier));
}

function addAmounts(values: string[]) {
  return fromScaled(values.reduce((sum, value) => sum + scaled(value), 0n));
}

function scaled(value: string) {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(`${whole}${fraction.padEnd(8, "0").slice(0, 8)}`);
}

function fromScaled(value: bigint) {
  const digits = value.toString().padStart(9, "0");
  const fraction = digits.slice(-8).replace(/0+$/, "");
  return fraction ? `${digits.slice(0, -8)}.${fraction}` : digits.slice(0, -8);
}

function integer(value: unknown) {
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
