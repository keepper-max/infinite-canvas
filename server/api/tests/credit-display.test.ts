import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCreditPoints,
  formatCreditSummary,
  formatCreditCharge,
  summarizeCreditCalls,
} from "../../../web/src/lib/credit-display.js";

test("User billing displays authoritative already-marked-up ledger points without another multiplier", () => {
  assert.equal(formatCreditCharge("120", "charged"), "120 积分");
  assert.equal(
    summarizeCreditCalls(
      Array.from({ length: 5 }, () => ({
        credit_points: "1",
        credit_status: "charged",
      })),
    ),
    "已扣 5 积分",
  );
  assert.equal(
    formatCreditPoints("9007199254740993123"),
    "9,007,199,254,740,993,123 积分",
  );
});
test("Unknown bills stay pending and unpaid points are never reported as deducted", () => {
  for (const value of [
    null,
    undefined,
    "",
    -1,
    1.2,
    Number.NaN,
    Number.MAX_SAFE_INTEGER + 1,
    "1.2",
    "-2",
  ])
    assert.equal(formatCreditCharge(value, "charged"), "待结算");
  assert.equal(formatCreditCharge("0", "pending"), "待结算");
  assert.equal(formatCreditCharge("0", "free"), "0 积分");
  assert.equal(formatCreditCharge("5", "payment_required"), "待支付 5 积分");
  assert.equal(
    summarizeCreditCalls([
      { credit_points: "2", credit_status: "charged" },
      { credit_points: "7", credit_status: "payment_required" },
      { credit_points: null, credit_status: "pending_rate" },
      { credit_points: "0", credit_status: "free" },
    ]),
    "已扣 2 积分 · 待支付 7 积分 · 1 笔待结算",
  );
  assert.equal(formatCreditSummary(undefined), "待结算");
  assert.equal(formatCreditSummary("5", 2), "5 积分（另有 2 笔待结算）");
  assert.equal(summarizeCreditCalls([]), "已扣 0 积分");
  assert.equal(summarizeCreditCalls([{credit_points:"0",credit_status:"payment_required"}]),"已扣 0 积分 · 待支付 0 积分");
});
