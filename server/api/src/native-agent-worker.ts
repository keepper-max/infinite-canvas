import { NativeAgentPolicyService } from "./native-agent/policy.js";
import { PaidAgentModel } from "./native-agent/paid-model.js";
import { CreditService } from "./credit-service.js";
import { BillingService } from "./billing-service.js";
import { S3ObjectStorage } from "./object-storage.js";
import { readConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { applyMigrations } from "./db/migrate.js";
import { KnowledgeService } from "./knowledge-service.js";
import { ModelGateway } from "./model-gateway.js";
import { JobService } from "./job-service.js";
import { createQueue } from "./queue.js";
import { NativeAgentService } from "./native-agent/service.js";
import { CompatibleAgentModel } from "./native-agent/model.js";
import {
  createNativeAgentQueue,
  startNativeAgentWorker,
} from "./native-agent/queue.js";
const config = readConfig();
if (process.env.NATIVE_AGENT_ENABLED !== "true")
  throw new Error(
    "Native Agent worker requires explicit NATIVE_AGENT_ENABLED=true",
  );
const { db, pool } = createDatabase(config.databaseUrl);
await applyMigrations(pool);
const queue = createNativeAgentQueue(config.jobs.redisUrl);
const jobQueue = createQueue(config.jobs);
const gateway = new ModelGateway(pool);
const credits = new CreditService(pool, config.operations.adminEmails),
  billing = new BillingService(pool, config.provider, credits, config.pinhaozhan),
  storage = new S3ObjectStorage(config.objectStorage);
const jobs = new JobService(
  pool,
  jobQueue.port,
  gateway,
  config.jobs,
  async () => undefined,
  credits,
  billing,
);
const knowledge = new KnowledgeService(db, config.operations.adminEmails),
  policy = new NativeAgentPolicyService(
    knowledge,
    pool,
    gateway,
    { token360: config.provider, volcengine_ark: config.volcengineArk, pinhaozhan: config.pinhaozhan },
    config.operations.adminEmails,
  );
const service = new NativeAgentService(
  knowledge,
  pool,
  new CompatibleAgentModel(
    gateway,
    new PaidAgentModel(
      pool,
      gateway,
      jobs,
      credits,
      billing,
      storage,
      config.jobs,
      config.volcengineArk,
      config.provider,
      policy,
      config.pinhaozhan,
    ),
  ),
  queue.enqueue,
  jobs,
  config.operations.adminEmails,
  policy,
);
const worker = await startNativeAgentWorker(service, config.jobs.redisUrl);
console.log(
  "[native-agent] worker ready, protocol=1; no automatic model/write retries",
);
async function close() {
  await worker.close();
  await queue.close();
  await jobQueue.queue.close();
  await jobQueue.connection.quit();
  await pool.end();
}
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
