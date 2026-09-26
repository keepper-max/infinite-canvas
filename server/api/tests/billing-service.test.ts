import assert from "node:assert/strict";
import test from "node:test";

import { BillingService, runningHubOriginalAmount } from "../src/billing-service.js";

const config = {
  baseUrl: "https://example.invalid",
  apiKey: "test-only",
  catalogUrl: "https://example.invalid/models",
};
const billingRuleSnapshot = {
  ruleId: "00000000-0000-4000-8000-000000000271",
  ruleKey: "runninghub-seedance-2-5",
  version: 1,
  provider: "runninghub",
  modelPattern: "seedance-2.5",
  matchType: "contains",
  discountRate: "0.8",
  priority: 100,
  capturedAt: "2026-09-25T00:00:00.000Z",
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
  globalThis.fetch = async (input) => {
    assert.match(String(input), /\/v1\/billing\/requests\/job-1$/);
    return Response.json({
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
  };
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

test("billing response without a finalized amount remains pending", async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const pool = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (sql.includes("returning *"))
        return {
          rows: [
            {
              id: "job-incomplete",
              provider: "token360",
              billing_trace_id: "job-incomplete",
              billing_started_at: new Date(),
              billing_attempt_count: 1,
              billing_meter_usage: {},
            },
          ],
          rowCount: 1,
        };
      return { rows: [], rowCount: 1 };
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      data: {
        request_id: "job-incomplete",
        billed: false,
        status: "in_progress",
        usage: { total_tokens: 139 },
      },
    });
  try {
    const result = await new BillingService(pool as never, config).reconcileJob(
      "job-incomplete",
      true,
    );
    assert.deepEqual(result, { status: "pending", retryAfterSeconds: 30 });
    assert.equal(
      calls.some(({ sql }) => sql.includes("insert into generation_usage")),
      false,
    );
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

test("RunningHub terminal usage is settled directly without Token360 reconciliation", async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const job = {
    id: "job-rh-1",
    project_id: "project-1",
    created_by: "user-1",
    provider: "runninghub",
    provider_job_id: "rh-task-1",
    model_id: "runninghub.video.seedance-2-5",
    capability: "video",
    billing_status: "pending",
    billing_rule_snapshot: billingRuleSnapshot,
    parameters: { duration: "5" },
    billing_meter_usage: {
      provider_request_id: "rh-task-1",
      third_party_consume_money: "3.398",
      completion_tokens: "38830",
      total_tokens: "38830",
      billing_seconds: "4",
      currency: "USD",
    },
  };
  const pool = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (sql.startsWith("select * from generation_jobs"))
        return { rows: [job], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
  const result = await new BillingService(
    pool as never,
    config,
  ).finalizeProviderUsage("job-rh-1");
  assert.deepEqual(result, {
    status: "settled",
    requestId: "runninghub:rh-task-1",
  });
  const insert = calls.find(({ sql }) =>
    sql.includes("insert into generation_usage"),
  );
  assert.ok(insert?.values);
  assert.equal(insert.values[3], "runninghub:rh-task-1");
  assert.equal(insert.values[7], true);
  assert.equal(insert.values[9], 38830);
  assert.equal(insert.values[10], 38830);
  assert.equal(insert.values[12], "4");
  assert.equal(insert.values[13], "5");
  assert.equal(insert.values[14], "3.398");
  assert.equal(insert.values[15], "4.2475");
  assert.equal(insert.values[16], "CNY");
  assert.equal(insert.values[17], "rh-task-1");
  assert.deepEqual(JSON.parse(String(insert.values[18])), {
    ...job.billing_meter_usage,
    provider_paid_amount: "3.398",
    original_amount: "4.2475",
    billing_discount_rate: "0.8",
    billing_amount_source: "versioned_rule_snapshot",
    billing_rule_snapshot: billingRuleSnapshot,
  });
  assert.match(calls.at(-1)?.sql || "", /billing_status='settled'/);
});

test("RunningHub Seedance 2.5 restores the original 80%-discount price exactly", () => {
  assert.equal(
    runningHubOriginalAmount(
      billingRuleSnapshot,
      "11.419",
    ),
    "14.27375",
  );
  assert.equal(
    runningHubOriginalAmount({}, "11.419"),
    "11.419",
  );
  assert.equal(runningHubOriginalAmount(billingRuleSnapshot, null), null);
  assert.equal(runningHubOriginalAmount({ ...billingRuleSnapshot, discountRate: "0.75" }, "10"), "13.33333333");
});

test("billing rule resolution normalizes model separators and snapshots the selected version", async () => {
  const pool = {
    async query() {
      return {
        rows: [{
          id: billingRuleSnapshot.ruleId,
          rule_key: billingRuleSnapshot.ruleKey,
          version: 2,
          provider: "runninghub",
          model_pattern: "seedance-2.5",
          match_type: "contains",
          discount_rate: "0.75",
          priority: 100,
        }],
      };
    },
  };
  const snapshot = await new BillingService(pool as never, config).resolveRuleSnapshot(
    "runninghub",
    "runninghub.video.bytedance_seedance-2-5",
  );
  assert.equal(snapshot?.version, 2);
  assert.equal(snapshot?.discountRate, "0.75");
  assert.equal(snapshot?.ruleKey, billingRuleSnapshot.ruleKey);
});

test("RunningHub global usage keeps a region-specific billing identity", async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const pool = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (sql.startsWith("select * from generation_jobs"))
        return {
          rows: [
            {
              id: "job-rh-global-1",
              project_id: "project-1",
              created_by: "user-1",
              provider: "runninghub_global",
              provider_job_id: "rh-task-1",
              model_id: "runninghub_global.image.gpt-image-2-5",
              capability: "image",
              billing_status: "pending",
              parameters: {},
              billing_meter_usage: {
                provider_request_id: "rh-task-1",
                total_tokens: "1234",
              },
            },
          ],
          rowCount: 1,
        };
      return { rows: [], rowCount: 1 };
    },
  };
  const result = await new BillingService(
    pool as never,
    config,
  ).finalizeProviderUsage("job-rh-global-1");
  assert.deepEqual(result, {
    status: "settled",
    requestId: "runninghub_global:rh-task-1",
  });
  const insert = calls.find(({ sql }) =>
    sql.includes("insert into generation_usage"),
  );
  assert.equal(insert?.values?.[3], "runninghub_global:rh-task-1");
});

test("RunningHub global LLM usage preserves USD pricing for credit conversion", async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const pool = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (sql.startsWith("select * from generation_jobs"))
        return {
          rows: [
            {
              id: "job-rh-global-text-1",
              project_id: "project-1",
              created_by: "user-1",
              provider: "runninghub_global",
              model_id: "runninghub_global.text.openai-gpt-5-6-sol",
              capability: "text",
              billing_status: "pending",
              parameters: {},
              billing_meter_usage: {
                provider_request_id: "chatcmpl-rh-1",
                prompt_tokens: 1000,
                completion_tokens: 500,
                total_tokens: 1500,
                consume_money: "0.0025",
                currency: "USD",
              },
            },
          ],
          rowCount: 1,
        };
      return { rows: [], rowCount: 1 };
    },
  };
  await new BillingService(pool as never, config).finalizeProviderUsage(
    "job-rh-global-text-1",
  );
  const insert = calls.find(({ sql }) =>
    sql.includes("insert into generation_usage"),
  );
  assert.equal(insert?.values?.[7], true);
  assert.equal(insert?.values?.[14], "0.0025");
  assert.equal(insert?.values?.[15], "0.0025");
  assert.equal(insert?.values?.[16], "USD");
  assert.equal(insert?.values?.[17], "chatcmpl-rh-1");
});
