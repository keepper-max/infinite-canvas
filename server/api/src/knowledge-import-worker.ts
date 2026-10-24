import { Worker } from "bullmq";
import { sql } from "drizzle-orm";
import { readConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { KnowledgeService } from "./knowledge-service.js";
import { S3ObjectStorage } from "./object-storage.js";
import { KnowledgeImportService } from "./knowledge-import-service.js";
import {
  createImportQueue,
  importConnection,
} from "./knowledge-import-queue.js";
import { sandboxConvert } from "./knowledge-import-sandbox.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
if (process.env.KNOWLEDGE_IMPORT_ENABLED !== "true")
  throw new Error("Import worker explicitly disabled");
const image = process.env.KNOWLEDGE_CONVERTER_IMAGE || "";
if (!/^sha256:[a-f0-9]{64}$/.test(image))
  throw new Error("Pinned converter image required");
const config = readConfig(),
  { db, pool } = createDatabase(config.databaseUrl),
  storage = new S3ObjectStorage(config.objectStorage),
  q = createImportQueue(config.jobs.redisUrl);
const service = new KnowledgeImportService(
  new KnowledgeService(db),
  storage,
  q.enqueue,
  config.assetStorageQuotaBytes,
);
await sandboxConvert(Buffer.from("sandbox readiness"), "txt", image);
const ready = async () => {
  try {
    await promisify(execFile)("docker", ["image", "inspect", image], {
      windowsHide: true,
    });
    await (
      await q.queue.backend.client
    ).set("knowledge-imports:runner-ready", image, { EX: 30 });
  } catch {
    await (await q.queue.backend.client).del("knowledge-imports:runner-ready");
    throw new Error("Pinned converter image is unavailable");
  }
};
await ready();
const heartbeat = setInterval(
  () =>
    void ready().catch(() => console.error("Import runner heartbeat failed")),
  10_000,
);
await q.queue.setGlobalConcurrency(1);
// SQL staging is the durable outbox: enqueue failures and runner restarts are recoverable.
const recover = async () => {
  for (const row of (
    await db.execute(
      sql`select id from knowledge_imports where state in ('queued','parsing') order by created_at`,
    )
  ).rows)
    await q.enqueue(row.id as string);
  await service.cleanup();
};
await recover();
const timer = setInterval(
  () =>
    void recover().catch(() => console.error("Import queue recovery failed")),
  10_000,
);
const worker = new Worker(
  "knowledge-imports",
  (job) =>
    service.process(job.data.id, (body, ext) =>
      sandboxConvert(body, ext, image),
    ),
  { connection: importConnection(config.jobs.redisUrl), concurrency: 1 },
);
worker.on("error", () => console.error("Import worker connection failure"));
async function stop() {
  clearInterval(timer);
  clearInterval(heartbeat);
  await worker.close();
  await (await q.queue.backend.client).del("knowledge-imports:runner-ready");
  await q.queue.close();
  await pool.end();
}
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
