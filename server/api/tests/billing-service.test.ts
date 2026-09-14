import assert from "node:assert/strict";
import test from "node:test";

import { BillingService } from "../src/billing-service.js";

const config = {
  baseUrl: "https://example.invalid",
  apiKey: "test-only",
  catalogUrl: "https://example.invalid/models",
};

test("billing reconciliation stores official usage fields and decimal amounts as strings", async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const job = {
    id: "job-1",
    project_id: "project-1",
    created_by: "user-1",
    provider: "token360",
    model_id: "video.seedance-2-5",
    capability: "video",
    billing_trace_id: "job-1",
    billing_meter_usage: {},
    billing_attempt_count: 1,
  };
  const pool = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (sql.includes("returning *")) return { rows: [job], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      code: 200,
      data: {
        id: "job-1",
        request_id: "job-1",
        amount_base: "0.28400000",
        amount_final: "0.28400000",
        total_amount: "0.28400000",
        voucher_amount: "0.10000000",
        wallet_amount: "0.18400000",
        price: "0.07100000",
        bill_record_status: "1",
        billed: true,
        currency: "usd",
        usage: {
          total_tokens: "4000",
          completion_tokens: "4000",
          output_tokens: "4000",
          seconds: 4,
          requested_seconds: 4,
          video_count: 1,
          sample_count: 1,
        },
      },
    });
  try {
    const result = await new BillingService(pool as never, config).reconcileJob(
      "job-1",
      true,
    );
    assert.deepEqual(result, { status: "settled", requestId: "job-1" });
    const insert = calls.find(({ sql }) =>
      sql.includes("insert into generation_usage"),
    );
    assert.ok(insert?.values);
    assert.equal(insert.values[7], "1");
    assert.equal(insert.values[13], 4000);
    assert.equal(insert.values[16], "4");
    assert.equal(insert.values[20], "0.28400000");
    assert.equal(insert.values[24], "USD");
    assert.equal(insert.values[25], "job-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("billing 404 schedules the documented first 30 second retry", async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const pool = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (sql.includes("returning *"))
        return {
          rows: [
            {
              id: "job-2",
              provider: "token360",
              billing_trace_id: "job-2",
              billing_started_at: new Date(),
              billing_attempt_count: 1,
            },
          ],
          rowCount: 1,
        };
      return { rows: [], rowCount: 1 };
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 404 });
  try {
    const result = await new BillingService(pool as never, config).reconcileJob(
      "job-2",
      true,
    );
    assert.deepEqual(result, { status: "pending", retryAfterSeconds: 30 });
    assert.equal(calls.at(-1)?.values?.[1], 30);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("billing reconciliation stops after 24 hours without a bill", async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const pool = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (sql.includes("returning *"))
        return {
          rows: [
            {
              id: "job-3",
              provider: "token360",
              billing_trace_id: "job-3",
              billing_started_at: new Date(Date.now() - 25 * 60 * 60 * 1_000),
              billing_attempt_count: 9,
            },
          ],
          rowCount: 1,
        };
      return { rows: [], rowCount: 1 };
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 404 });
  try {
    const result = await new BillingService(pool as never, config).reconcileJob(
      "job-3",
      true,
    );
    assert.deepEqual(result, { status: "not_billed" });
    assert.match(calls.at(-1)?.sql || "", /billing_status='not_billed'/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("settled mismatch records are excluded from automatic reconciliation", async () => {
  let dueSql = "";
  const pool = {
    async query(sql: string) {
      dueSql = sql;
      return { rows: [], rowCount: 0 };
    },
  };
  const count = await new BillingService(pool as never, config).runDue();
  assert.equal(count, 0);
  assert.match(
    dueSql,
    /billing_status='mismatch' and billing_next_check_at is not null/,
  );
});

test("terminal meter usage cannot overwrite the initial submission trace", async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const pool = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      return { rows: [], rowCount: 1 };
    },
  };
  const service = new BillingService(pool as never, config);
  await service.recordTrace("job-4", "provider-trace-4", {
    requested_seconds: 6,
  });
  await service.recordMeterUsage("job-4", { seconds: 6 });
  assert.equal(calls[0]?.values?.[1], "provider-trace-4");
  assert.doesNotMatch(calls[1]?.sql || "", /billing_trace_id/);
  assert.deepEqual(calls[1]?.values, ["job-4", JSON.stringify({ seconds: 6 })]);
});
