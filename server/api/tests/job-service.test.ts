import assert from "node:assert/strict";
import test from "node:test";

import {
  downloadBytes,
  generationJobAttempts,
  JobExecutor,
  JobService,
} from "../src/job-service.js";
import { createJobSchema } from "../src/job-contract.js";
import type { GenerationInput } from "../src/model-gateway.js";
import {
  isStalledQueueJobError,
  recoverInterruptedProviderJobs,
} from "../src/job-recovery.js";

test("generation jobs do not retry automatically", () => {
  assert.equal(generationJobAttempts(), 1);
});

test("only BullMQ stalled failures trigger result recovery", () => {
  assert.equal(
    isStalledQueueJobError(
      new Error("job stalled more than allowable limit"),
    ),
    true,
  );
  assert.equal(isStalledQueueJobError(new Error("provider rejected")), false);
});

test("artifact download reconnects after sixty seconds without ending the job", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (_input, init) => {
    requests += 1;
    if (requests > 1) return new Response(new Uint8Array([1, 2, 3]));
    return new Response(
      new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener(
            "abort",
            () => controller.error(init.signal?.reason),
            { once: true },
          );
        },
      }),
    );
  };
  try {
    const result = await downloadBytes(
      "https://example.invalid/video.mp4",
      undefined,
      10,
      0,
    );
    assert.deepEqual([...result], [1, 2, 3]);
    assert.equal(requests, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("job ID and billing trace use distinct SQL parameters", async () => {
  let insertSql = "";
  let insertValues: unknown[] = [];
  const jobRow = {
    id: "",
    project_id: "project-1",
    node_key: null,
    model_id: "gpt-5.5",
    capability: "text",
    mode: "chat",
    status: "pending",
    progress: 0,
    max_attempts: 1,
  };
  const client = {
    async query(sql: string, values?: unknown[]) {
      if (sql.includes("from project_members"))
        return { rows: [{ role: "owner" }], rowCount: 1 };
      if (sql.startsWith("select * from generation_jobs"))
        return { rows: [], rowCount: 0 };
      if (sql.startsWith("insert into generation_jobs")) {
        insertSql = sql;
        insertValues = values || [];
        jobRow.id = String(insertValues[0]);
        return { rows: [jobRow], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const pool = {
    async query(sql: string) {
      if (sql.includes("from project_members"))
        return { rows: [{ role: "owner" }], rowCount: 1 };
      if (sql.startsWith("select * from generation_jobs"))
        return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    },
    async connect() {
      return client;
    },
  };
  const service = new JobService(
    pool as never,
    { async add() {}, async remove() { return true; } },
    {
      async compile(input: GenerationInput) {
        return {
          ...input,
          providerId: "token360",
          upstreamModel: "gpt-5.5",
          upstreamParameters: {},
        };
      },
    } as never,
    {} as never,
  );

  await service.create("project-1", "user-1", {
    modelId: "gpt-5.5",
    capability: "text",
    mode: "chat",
    prompt: "test",
    parameters: {},
    nodeRevision: 0,
    idempotencyKey: "billing-trace-parameter-test",
  });

  assert.match(insertSql, /now\(\),\$17,\$18,'pending'/);
  assert.equal(insertValues.length, 18);
  assert.equal(insertValues[17], insertValues[0]);
});

test("virtual portrait references are resolved from the current project only", async () => {
  const pool = {
    async query(sql: string, values?: unknown[]) {
      assert.match(sql, /virtual_portraits/);
      assert.deepEqual(values, ["11111111-1111-4111-8111-111111111111", "project-1"]);
      return { rows: [{ provider_asset_id: "ta_portrait_1" }] };
    },
  };
  const executor = new JobExecutor(pool as never, {} as never, {} as never, {} as never, {} as never);
  const resolver = executor as unknown as { resolveAssetReferences(input: GenerationInput, projectId: string): Promise<GenerationInput> };
  const resolved = await resolver.resolveAssetReferences(
    {
      modelId: "video.seedance-2-0",
      capability: "video",
      mode: "i2v",
      prompt: "test",
      references: [{ role: "first_frame", virtualPortraitId: "11111111-1111-4111-8111-111111111111" }],
    },
    "project-1",
  );
  assert.equal(resolved.references?.[0]?.url, "asset://ta_portrait_1");
});

test("managed job input accepts project portrait IDs but rejects direct asset URLs", () => {
  const input = {
    modelId: "video.seedance-2-0",
    capability: "video",
    mode: "i2v",
    prompt: "test",
    parameters: {},
    nodeRevision: 0,
    idempotencyKey: "portrait-test-key",
  } as const;
  assert.equal(
    createJobSchema.safeParse({ ...input, references: [{ role: "first_frame", virtualPortraitId: "11111111-1111-4111-8111-111111111111" }] }).success,
    true,
  );
  assert.equal(
    createJobSchema.safeParse({ ...input, references: [{ role: "first_frame", url: "asset://ta_forged" }] }).success,
    false,
  );
});

test("interrupted provider jobs resume existing results without a new submission", async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const pool = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (sql.includes("from generation_jobs"))
        return {
          rows: [
            {
              id: "job-1",
              project_id: "project-1",
              node_key: "node-1",
              progress: 98,
            },
          ],
          rowCount: 1,
        };
      if (sql.includes("from job_artifacts"))
        return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    },
  };
  let removed = false;
  const queued: Array<{ name: string; data: { jobId: string } }> = [];
  const recovered = await recoverInterruptedProviderJobs(
    pool as never,
    {
      async getJob() {
        return {
          async getState() {
            return "failed";
          },
          async remove() {
            removed = true;
          },
        };
      },
      async add(name, data) {
        queued.push({ name, data });
      },
    },
    1,
  );

  assert.deepEqual(recovered, ["job-1"]);
  assert.equal(removed, true);
  assert.deepEqual(queued, [
    { name: "generation", data: { jobId: "job-1" } },
  ]);
  assert.equal(
    calls.some(({ sql }) => sql.includes("status='retrying'")),
    true,
  );
});

test("active provider jobs are not queued twice during recovery", async () => {
  const pool = {
    async query(sql: string) {
      if (sql.includes("from generation_jobs"))
        return {
          rows: [
            {
              id: "job-2",
              project_id: "project-1",
              node_key: "node-2",
              progress: 50,
            },
          ],
          rowCount: 1,
        };
      return { rows: [], rowCount: 0 };
    },
  };
  let added = false;
  const recovered = await recoverInterruptedProviderJobs(
    pool as never,
    {
      async getJob() {
        return {
          async getState() {
            return "active";
          },
          async remove() {
            throw new Error("must not remove an active job");
          },
        };
      },
      async add() {
        added = true;
      },
    },
    1,
  );

  assert.deepEqual(recovered, []);
  assert.equal(added, false);
});

test("resuming a provider job does not depend on the current model catalog", async () => {
  const row = {
    id: "job-3",
    project_id: "project-1",
    node_key: "node-3",
    provider_job_id: "video-existing",
    status: "retrying",
    progress: 98,
    input_snapshot: {},
  };
  const pool = {
    async query(sql: string) {
      if (sql.includes("select * from generation_jobs"))
        return { rows: [row], rowCount: 1 };
      if (sql.includes("select status from generation_jobs"))
        return { rows: [{ status: "running" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
  let compiled = false;
  let resumed = false;
  const executor = new JobExecutor(
    pool as never,
    {
      async compile() {
        compiled = true;
        throw new Error("model catalog must not be consulted");
      },
    } as never,
    {
      async get(providerJobId: string) {
        resumed = providerJobId === "video-existing";
        return {
          providerJobId,
          status: "completed",
          progress: 100,
          artifacts: [],
        };
      },
    } as never,
    {} as never,
    { videoPollIntervalMs: 1 } as never,
  );

  await executor.execute("job-3", 1);

  assert.equal(compiled, false);
  assert.equal(resumed, true);
});
