import assert from "node:assert/strict";
import test from "node:test";
import Decimal from "decimal.js";
import { billedCredits } from "../lib/credit-pricing";

test("人民币成本上浮 20%，不足一分向上取整", () => {
  assert.deepEqual(billedCredits("10", "CNY", null), { points: 1200, rate: "1.00000000" });
  assert.equal(billedCredits("0.001", "CNY", null).points, 1);
});

test("美元成本先按明确汇率换成人民币", () => {
  assert.deepEqual(billedCredits("1.25", "USD", new Decimal("7.2")), { points: 1080, rate: "7.20000000" });
});

test("缺少汇率、币种或金额异常时拒绝结算", () => {
  assert.throws(() => billedCredits("1", "USD", null));
  assert.throws(() => billedCredits("1", "EUR", new Decimal("7.2")));
  assert.throws(() => billedCredits("-1", "CNY", null));
});
