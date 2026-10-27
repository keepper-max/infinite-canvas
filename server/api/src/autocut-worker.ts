import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { readConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { applyMigrations } from "./db/migrate.js";
import { S3ObjectStorage } from "./object-storage.js";
import { StorageQuotaService } from "./storage-quota-service.js";
import { ModelGateway } from "./model-gateway.js";
import { JobService } from "./job-service.js";
import { CreditService } from "./credit-service.js";
import { BillingService } from "./billing-service.js";
import { createQueue } from "./queue.js";
import { AutoCutService } from "./autocut/service.js";
import {
  ManagedAutoCutModel,
  readAutoCutModelConfig,
} from "./autocut/model.js";
import { createAutoCutQueue, AUTOCUT_QUEUE } from "./autocut/queue.js";
import { AutoCutExecutor } from "./autocut/executor.js";
import { configuredAsr } from "./autocut/asr.js";
import { AUTOCUT_LIMITS } from "./autocut/contract.js";
import { recoverAutoCutTasks } from "./autocut/maintenance.js";
const config = readConfig(),
  modelConfig = readAutoCutModelConfig();
if (!modelConfig)
  throw new Error("AutoCut must be explicitly enabled and configured");
const { pool } = createDatabase(config.databaseUrl);
await applyMigrations(pool);
const storage = new S3ObjectStorage(config.objectStorage);
await storage.ensureReady();
const queue = createAutoCutQueue(config.jobs.redisUrl),
  jobsQueue = createQueue(config.jobs);
const credits = new CreditService(pool, config.operations.adminEmails);
const quota = new StorageQuotaService(
  pool,
  config.assetStorageQuotaBytes,
  config.operations.adminEmails,
);
const jobs = new JobService(
  pool,
  jobsQueue.port,
  new ModelGateway(pool),
  config.jobs,
  jobsQueue.publish,
  credits,
  new BillingService(pool, config.provider, credits, config.pinhaozhan),
  quota,
);
const service = new AutoCutService(pool, queue.port, true);
const asr = configuredAsr();
const executor = new AutoCutExecutor(
  pool,
  service,
  storage,
  new ManagedAutoCutModel(pool, jobs, modelConfig),
  config.jobs.ffmpegPath,
  modelConfig.analysisVersion,
  quota,
  asr,
);
const connection = new Redis(config.jobs.redisUrl, {
  maxRetriesPerRequest: null,
});
await queue.queue.setGlobalConcurrency(AUTOCUT_LIMITS.concurrency);
const worker = new Worker<{ taskId: string }>(
  AUTOCUT_QUEUE,
  (job) => executor.execute(job.data.taskId),
  { connection, concurrency: AUTOCUT_LIMITS.concurrency, maxStalledCount: 0 },
);
worker.on("error", () => console.error("[autocut] queue unavailable"));
worker.on("failed", (job) => {
  if (job)
    void pool
      .query(
        "update autocut_tasks set status='failed',error_code='AUTOCUT_WORKER_INTERRUPTED',error_message='Worker中断，请手动重试；原模型请求会复用',finished_at=now() where id=$1 and status in ('queued','running')",
        [job.data.taskId],
      )
      .catch(() => undefined);
});
// Recover the DB/queue handoff gap. Never re-execute a running task after a process crash.
let pumping = false;
const pump = async () => {
  if (pumping) return;
  pumping = true;
  try {
    await recoverAutoCutTasks(pool, executor.tempRoot);
    for (const row of (
      await pool.query(
        "select id from autocut_tasks where status='queued' and cancel_requested=false",
      )
    ).rows)
      await queue.port.add(row.id);
    await pool.query(
      "update autocut_tasks set status='cancelled',finished_at=now() where status='queued' and cancel_requested=true",
    );
  } finally {
    pumping = false;
  }
};
await pump();
const timer = setInterval(() => void pump().catch(() => undefined), 5000);
console.log(
  "[autocut] CPU worker ready; one task, two FFmpeg threads, no paid automatic retries",
);
async function close() {
  clearInterval(timer);
  await worker.close();
  await asr?.close();
  await connection.quit();
  await queue.close();
  await jobsQueue.queue.close();
  await jobsQueue.transferQueue.close();
  await jobsQueue.connection.quit();
  await pool.end();
}
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
