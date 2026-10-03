import assert from "node:assert/strict";
import test from "node:test";

import { CreditService, decimalProductCeil } from "../src/credit-service.js";

test("credit charge applies 100 points per CNY and 1.2 markup", () => {
  assert.equal(decimalProductCeil(["10", "1", "120"]), BigInt(1200));
});

test("credit charge converts USD and rounds fractional points upward", () => {
  assert.equal(decimalProductCeil(["0.01", "7.2", "120"]), BigInt(9));
  assert.equal(decimalProductCeil(["3.19946585", "7.2", "120"]), BigInt(2765));
});

test("credit charge keeps exact integer boundaries", () => {
  assert.equal(decimalProductCeil(["1.25", "1", "120"]), BigInt(150));
  assert.equal(decimalProductCeil(["0", "7.2", "120"]), BigInt(0));
});

function creditServiceFor(job: Record<string, unknown>) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (sql.includes("select created_by from generation_jobs"))
        return { rows: [{ created_by: job.created_by }], rowCount: 1 };
      if (sql.includes("select * from generation_jobs"))
        return { rows: [job], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const pool = { async connect() { return client; } };
  return { service: new CreditService(pool as never), calls };
}

test("terminal no-charge jobs release their reservation and delivery hold", async () => {
  const { service, calls } = creditServiceFor({ id: "job-failed", created_by: "user-1", status: "failed", credits_reserved: 3000, credits_due: 0, credit_delivery_status: "pending" });
  assert.equal(await service.closeTerminalWithoutCharge("job-failed"), true);
  const accountUpdate = calls.find(({ sql }) => sql.includes("update credit_accounts"));
  assert.deepEqual(accountUpdate?.values, ["user-1", "3000"]);
  assert.equal(calls.some(({ sql }) => sql.includes("credit_delivery_status='released'")), true);
  assert.equal(calls.at(-1)?.sql, "commit");
});

test("non-terminal jobs keep their reservation", async () => {
  const { service, calls } = creditServiceFor({ id: "job-running", created_by: "user-1", status: "running", credits_reserved: 3000, credits_due: 0, credit_delivery_status: "pending" });
  assert.equal(await service.closeTerminalWithoutCharge("job-running"), false);
  assert.equal(calls.some(({ sql }) => sql.includes("update credit_accounts")), false);
  assert.equal(calls.some(({ sql }) => sql.includes("update generation_jobs set")), false);
});
