import assert from "node:assert/strict";
import test from "node:test";

import { generationJobAttempts, JobExecutor } from "../src/job-service.js";
import { recoverInterruptedProviderJobs } from "../src/job-recovery.js";

test("generation jobs do not retry automatically", () => {
  assert.equal(generationJobAttempts(), 1);
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
