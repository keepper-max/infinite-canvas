import { UnrecoverableError, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";

import { readConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { applyMigrations } from "./db/migrate.js";
import { JobExecutor } from "./job-service.js";
import { ModelGateway } from "./model-gateway.js";
import { S3ObjectStorage } from "./object-storage.js";
import {
  ProviderError,
  Token360Provider,
  type GenerationProvider,
} from "./provider.js";
import { RunningHubProvider } from "./runninghub-provider.js";
import { ProviderRouter } from "./provider-router.js";
import {
  isStalledQueueJobError,
  recoverInterruptedProviderJobs,
} from "./job-recovery.js";
import { createQueue } from "./queue.js";
import {
  CompositionCancelledError,
  CompositionExecutor,
} from "./composition-service.js";
import { BillingService } from "./billing-service.js";
import { CreditService } from "./credit-service.js";
import { PostgresAssetService } from "./asset-service.js";

const config = readConfig();
const { db, pool } = createDatabase(config.databaseUrl);
await applyMigrations(pool);
const storage = new S3ObjectStorage(config.objectStorage);
await storage.ensureReady();
const assetService = new PostgresAssetService(db, storage, pool);
const gateway = new ModelGateway(pool);
await gateway
  .refreshCatalog(config.provider.catalogUrl)
  .catch((error) =>
    console.warn(
      "[generation-worker] model catalog refresh skipped:",
      error instanceof Error ? error.message : "unknown error",
    ),
  );
await gateway
  .refreshRunningHubCatalog(config.runningHub.catalogUrl)
  .catch((error) =>
    console.warn(
      "[generation-worker] RunningHub catalog refresh skipped:",
      error instanceof Error ? error.message : "unknown error",
    ),
  );
await gateway.refreshRunningHubGlobalCatalog();
const provider = new ProviderRouter(
  new Map<string, GenerationProvider>([
    [
      "token360",
      new Token360Provider(config.provider, config.jobs.submitTimeoutMs),
    ],
    [
      "runninghub",
      new RunningHubProvider(config.runningHub, config.jobs.submitTimeoutMs),
    ],
    [
      "runninghub_global",
      new RunningHubProvider(
        config.runningHubGlobal,
        config.jobs.submitTimeoutMs,
      ),
    ],
  ]),
);
const credits = new CreditService(pool);
const billing = new BillingService(pool, config.provider, credits);
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
  billing,
  undefined,
);
const recoveryQueue = createQueue(config.jobs);
const transferPort = recoveryQueue.transferPort;
const transferExecutor = new JobExecutor(
  pool,
  gateway,
  provider,
  storage,
  config.jobs,
  (projectId) => connection.publish(`job-events:${projectId}`, "changed"),
  billing,
  transferPort,
);
const recoveredJobs = await recoverInterruptedProviderJobs(
  pool,
  recoveryQueue.queue,
  1,
  recoveryQueue.transferQueue,
);
if (recoveredJobs.length)
  console.log(
    `[generation-worker] recovering ${recoveredJobs.length} interrupted provider result(s)`,
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
  async (job: Job<{ jobId: string }>) => {
    try {
      return await transferExecutor.execute(
        job.data.jobId,
        job.attemptsMade + 1,
      );
    } catch (error) {
      await executor.markAttemptFailed(
        job.data.jobId,
        job.attemptsMade + 1 >= (job.opts.attempts || config.jobs.maxAttempts),
      );
      if (error instanceof ProviderError && !error.retryable) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  },
  {
    connection,
    concurrency: config.jobs.workerConcurrency,
    lockDuration: 120_000,
  },
);

const transferWorker = new Worker<{ jobId: string }>(
  config.jobs.transferQueueName,
  async (job: Job<{ jobId: string }>) =>
    transferExecutor.executeTransfer(job.data.jobId),
  {
    connection,
    concurrency: config.jobs.transferWorkerConcurrency,
    lockDuration: 120_000,
  },
);
transferWorker.on("failed", (job, error) => {
  if (!job) return;
  const final = job.attemptsMade >= (job.opts.attempts || 5);
  if (final) void transferExecutor.markAttemptFailed(job.data.jobId, true);
  console.error(
    "[transfer-worker]",
    job.data.jobId,
    error instanceof Error ? error.message : "unknown error",
  );
});
transferWorker.on("error", (error) =>
  console.error("[transfer-worker]", error.name, error.message),
);
console.log(
  `[transfer-worker] ready (concurrency=${config.jobs.transferWorkerConcurrency})`,
);

worker.on("failed", (job, error) => {
  if (!job) return;
  if (isStalledQueueJobError(error)) {
    void recoverInterruptedProviderJobs(
      pool,
      recoveryQueue.queue,
      1,
      recoveryQueue.transferQueue,
    )
      .then((recovered) => {
        if (!recovered.includes(job.data.jobId))
          return executor.markAttemptFailed(job.data.jobId, true);
      })
      .catch(async (recoveryError) => {
        console.error(
          "[generation-worker] stalled job recovery failed:",
          recoveryError instanceof Error
            ? recoveryError.message
            : "unknown error",
        );
        await executor.markAttemptFailed(job.data.jobId, true);
      });
    return;
  }
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
void billing
  .runDue()
  .catch((error) =>
    console.error(
      "[billing-worker]",
      error instanceof Error ? error.message : "unknown error",
    ),
  );
const billingTimer = setInterval(() => {
  void billing
    .runDue()
    .catch((error) =>
      console.error(
        "[billing-worker]",
        error instanceof Error ? error.message : "unknown error",
      ),
    );
}, 30_000);

let assetCleanupRunning = false;
async function cleanExpiredAssets() {
  if (assetCleanupRunning) return;
  assetCleanupRunning = true;
  try {
    const queued = await assetService.purgeExpired(
      config.assetTrashRetentionDays,
    );
    if (queued)
      console.log(`[asset-cleanup] queued ${queued} expired asset(s)`);
  } catch (error) {
    console.error(
      "[asset-cleanup]",
      error instanceof Error ? error.message : "unknown error",
    );
  } finally {
    assetCleanupRunning = false;
  }
}
void cleanExpiredAssets();
const assetCleanupTimer = setInterval(() => void cleanExpiredAssets(), 3_600_000);

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
  clearInterval(billingTimer);
  clearInterval(assetCleanupTimer);
  await worker.close(false);
  await transferWorker.close(false);
  await compositionWorker.close(false);
  await recoveryQueue.queue.close();
  await recoveryQueue.transferQueue.close();
  await recoveryQueue.connection.quit();
  await connection.quit();
  await pool.end();
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
