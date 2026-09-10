import { UnrecoverableError, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";

import { readConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { applyMigrations } from "./db/migrate.js";
import { JobExecutor } from "./job-service.js";
import { ModelGateway } from "./model-gateway.js";
import { S3ObjectStorage } from "./object-storage.js";
import { ProviderError, Token360Provider } from "./provider.js";
import {
  CompositionCancelledError,
  CompositionExecutor,
} from "./composition-service.js";

const config = readConfig();
const { pool } = createDatabase(config.databaseUrl);
await applyMigrations(pool);
const storage = new S3ObjectStorage(config.objectStorage);
await storage.ensureReady();
const gateway = new ModelGateway(pool);
await gateway
  .refreshCatalog(config.provider.catalogUrl)
  .catch((error) =>
    console.warn(
      "[generation-worker] model catalog refresh skipped:",
      error instanceof Error ? error.message : "unknown error",
    ),
  );
const provider = new Token360Provider(
  config.provider,
  config.jobs.submitTimeoutMs,
);
const connection = new Redis(config.jobs.redisUrl, {
  maxRetriesPerRequest: null,
});
const executor = new JobExecutor(
  pool,
  gateway,
  provider,
  storage,
  config.jobs,
  (projectId) => connection.publish(`job-events:${projectId}`, "changed"),
);
const compositionExecutor = new CompositionExecutor(
  pool,
  storage,
  config.jobs,
  (projectId) =>
    connection.publish(`composition-events:${projectId}`, "changed"),
);

const worker = new Worker<{ jobId: string }>(
  config.jobs.queueName,
  async (job: Job<{ jobId: string }>, token?: string) => {
    const controller = new AbortController();
    const onClosing = () => controller.abort(new Error("Worker shutting down"));
    worker.once("closing", onClosing);
    try {
      return await executor.execute(
        job.data.jobId,
        job.attemptsMade + 1,
        controller.signal,
      );
    } catch (error) {
      if (error instanceof ProviderError && !error.retryable) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    } finally {
      worker.off("closing", onClosing);
      void token;
    }
  },
  {
    connection,
    concurrency: config.jobs.workerConcurrency,
    lockDuration: 120_000,
  },
);

worker.on("failed", (job, error) => {
  if (job)
    void executor.markAttemptFailed(
      job.data.jobId,
      error?.name === "UnrecoverableError" ||
        job.attemptsMade >= (job.opts.attempts || config.jobs.maxAttempts),
    );
});
worker.on("error", (error) =>
  console.error("[generation-worker]", error.name, error.message),
);
console.log(
  `[generation-worker] ready (concurrency=${config.jobs.workerConcurrency})`,
);

const compositionWorker = new Worker<{ jobId: string }>(
  config.jobs.compositionQueueName,
  async (job: Job<{ jobId: string }>) => {
    try {
      return await compositionExecutor.execute(
        job.data.jobId,
        job.attemptsMade + 1,
      );
    } catch (error) {
      if (error instanceof CompositionCancelledError) return;
      throw error;
    }
  },
  {
    connection,
    concurrency: config.jobs.compositionWorkerConcurrency,
    lockDuration: 300_000,
  },
);
compositionWorker.on("failed", (job, error) => {
  if (job)
    void compositionExecutor.markFailed(
      job.data.jobId,
      job.attemptsMade >= (job.opts.attempts || config.jobs.maxAttempts),
      error,
    );
});
compositionWorker.on("error", (error) =>
  console.error("[composition-worker]", error.name, error.message),
);
console.log(
  `[composition-worker] ready (concurrency=${config.jobs.compositionWorkerConcurrency})`,
);

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await worker.close(false);
  await compositionWorker.close(false);
  await connection.quit();
  await pool.end();
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
