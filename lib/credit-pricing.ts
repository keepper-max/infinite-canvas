import Decimal from "decimal.js";

export function currentFxRate() {
  const raw = process.env.USD_CNY_RATE;
  if (!raw) return null;
  try {
    const rate = new Decimal(raw);
    return rate.isFinite() && rate.gt(0) ? rate : null;
  } catch { return null; }
}

export function billedCredits(amount: string, currency: string, usdCny: Decimal | null) {
  const cost = new Decimal(amount);
  if (!cost.isFinite() || cost.lt(0)) throw new Error("账单金额无效");
  const rate = currency.toUpperCase() === "CNY" ? new Decimal(1)
    : currency.toUpperCase() === "USD" ? usdCny : null;
  if (!rate) throw new Error("账单币种或汇率未配置");
  const points = cost.mul(rate).mul(120).ceil();
  if (!points.isInteger() || points.gt(2147483647)) throw new Error("账单金额超出积分范围");
  return { points: points.toNumber(), rate: rate.toFixed(8) };
}
