import { volcengineArkAmount } from "./volcengine-ark-pricing.js";

type PricingInput = Parameters<typeof volcengineArkAmount>[0];

/** Wangsu catalog prices are USD per million tokens for both Image 2.5 variants. */
export function wangsuAmount(input: PricingInput): string | null {
  if (input.capability === "video" && input.upstreamModel === "doubao-seedance-2-5-260628") {
    const tokens = count(input.usage.completion_tokens ?? input.usage.total_tokens);
    return input.usage.billable === false || tokens !== null ? volcengineArkAmount(input) : null;
  }
  if (input.capability !== "image" || !["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"].includes(input.upstreamModel)) return null;
  if (input.usage.billable === false) return "0";
  const details = record(input.usage.input_tokens_details);
  const text = count(details.text_tokens), image = count(details.image_tokens);
  const output = count(input.usage.output_tokens), totalInput = count(input.usage.input_tokens);
  // Cache subtype attribution has not been verified on this gateway; never guess a discount.
  if (text === null || image === null || output === null || output < 1 || totalInput === null || text + image !== totalInput) return null;
  if (details.cached_tokens !== undefined && count(details.cached_tokens) !== 0) return null;
  const outputDetails = record(input.usage.output_tokens_details);
  if (outputDetails.text_tokens !== undefined && count(outputDetails.text_tokens) !== 0) return null;
  if (outputDetails.image_tokens !== undefined && count(outputDetails.image_tokens) !== output) return null;
  const scaled = BigInt(text) * 5n + BigInt(image) * 8n + BigInt(output) * 30n;
  const fraction = (scaled % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${scaled / 1_000_000n}${fraction ? "." + fraction : ""}`;
}

function count(value: unknown) {
  if (!["string", "number"].includes(typeof value) || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
