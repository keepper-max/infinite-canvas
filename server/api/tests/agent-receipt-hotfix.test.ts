import test from "node:test";
import assert from "node:assert/strict";
import { streamSink } from "../src/native-agent/stream-sink.js";
import { BillingService } from "../src/billing-service.js";

test("stream persistence coalesces busy writes without timers or losing/order-changing text", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writes: string[] = [];
  const sink = streamSink(async (text) => {
    writes.push(text);
    await gate;
  });
  for (let i = 0; i < 216; i++) sink.push(String(i) + ",");
  assert.equal(writes.length, 1);
  release();
  await sink.flush();
  assert.equal(
    writes.join(""),
    Array.from({ length: 216 }, (_, i) => i + ",").join(""),
  );
  assert.equal(writes.length, 2);
  sink.push("中文尾段");
  await sink.flush();
  assert.equal(writes.join("").endsWith("中文尾段"), true);
});

test("persistence rejection is observed by flush and cannot report success", async () => {
  const error = new Error("synthetic database failure");
  const sink = streamSink(async () => {
    throw error;
  });
  sink.push("partial");
  await assert.rejects(sink.flush(), error);
  assert.throws(() => sink.push("next"), error);
});

const config = {
  baseUrl: "https://example.invalid",
  apiKey: "synthetic-only",
  catalogUrl: "",
};
test("receipt inspection queries only the read-only ledger, never settles or guesses an unbound charge", async () => {
  const original = globalThis.fetch;
  const job: Record<string, unknown> = {
    id: "job",
    provider: "pinhaozhan",
    billing_trace_id: "job",
    billing_meter_usage: {},
    billing_status: "manual_review",
  };
  const queries: string[] = [];
  const service = new BillingService(
    {
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [job] };
      },
    } as any,
    config,
    {
      settleUsage: () => {
        throw Error("must not settle");
      },
    } as any,
    config,
  );
  let calls = 0;
  try {
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(String(url), "https://example.invalid/api/log/token");
      assert.equal(init?.method, undefined);
      assert.equal(init?.redirect, "error");
      return Response.json({
        success: true,
        data: [
          {
            request_id: "exact",
            type: 2,
            model_name: "deepseek-v4.1-flash",
            quota: 68,
            prompt_tokens: 7992,
            completion_tokens: 486,
          },
        ],
      });
    };
    const signal = new AbortController().signal;
    assert.match(
      (await service.inspectPinhaozhanReceipt("job", signal)).message,
      /无法可靠关联/,
    );
    job.billing_trace_id = "exact";
    assert.match(
      (await service.inspectPinhaozhanReceipt("job", signal)).message,
      /7992.*486.*结果或结算/,
    );
    job.billing_meter_usage = { prompt_tokens: 7993, completion_tokens: 486 };
    await assert.rejects(service.inspectPinhaozhanReceipt("job", signal), {
      code: "AGENT_BILLING_UNCONFIRMED",
    });
    assert.equal(calls, 3);
    assert.ok(queries.every((sql) => sql.startsWith("select ")));
  } finally {
    globalThis.fetch = original;
  }
});
