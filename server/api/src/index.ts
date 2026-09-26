import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { PostgresAssetService } from "./asset-service.js";
import { readConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { applyMigrations } from "./db/migrate.js";
import { PostgresPlatformRepository } from "./repository.js";
import { S3ObjectStorage } from "./object-storage.js";
import { JobService } from "./job-service.js";
import { ModelGateway } from "./model-gateway.js";
import { createQueue } from "./queue.js";
import { CompositionService } from "./composition-service.js";
import { createCompositionQueue } from "./queue.js";
import { OperationsService } from "./operations-service.js";
import { TextWorkbenchService } from "./text-workbench-service.js";
import {
  Token360VirtualPortraitClient,
  VirtualPortraitService,
} from "./virtual-portrait-service.js";
import { BillingService } from "./billing-service.js";
import { CreditService } from "./credit-service.js";
import { PaymentService } from "./payment-service.js";
import { StorageQuotaService } from "./storage-quota-service.js";
import { EmailVerificationService } from "./email-verification-service.js";

const config = readConfig();
const { db, pool } = createDatabase(config.databaseUrl);

await applyMigrations(pool);
const objectStorage = new S3ObjectStorage(config.objectStorage);
await objectStorage.ensureReady();
const modelGateway = new ModelGateway(pool);
await modelGateway
  .refreshCatalog(config.provider.catalogUrl)
  .catch((error) =>
    console.warn(
      "[platform-api] model catalog refresh skipped:",
      error instanceof Error ? error.message : "unknown error",
    ),
  );
await modelGateway
  .refreshRunningHubCatalog(config.runningHub.catalogUrl)
  .catch((error) =>
    console.warn(
      "[platform-api] RunningHub catalog refresh skipped:",
      error instanceof Error ? error.message : "unknown error",
    ),
  );
await modelGateway.refreshRunningHubGlobalCatalog();
const jobQueue = createQueue(config.jobs);
const creditService = new CreditService(pool, config.operations.adminEmails);
const storageQuota = new StorageQuotaService(
  pool,
  config.assetStorageQuotaBytes,
  config.operations.adminEmails,
);
const billingService = new BillingService(pool, config.provider, creditService);
const jobService = new JobService(
  pool,
  jobQueue.port,
  modelGateway,
  config.jobs,
  jobQueue.publish,
  creditService,
  billingService,
  storageQuota,
);
const compositionQueue = createCompositionQueue(config.jobs);
const compositionService = new CompositionService(
  pool,
  compositionQueue.port,
  config.jobs,
  compositionQueue.publish,
  storageQuota,
);
const paymentService = new PaymentService(pool, creditService, config.payments);
const operationsService = new OperationsService(
  pool,
  config.operations,
  billingService,
  creditService,
  {
    token360: Boolean(config.provider.apiKey),
    runninghub: Boolean(config.runningHub.apiKey),
    runninghub_global: Boolean(config.runningHubGlobal.apiKey),
  },
  paymentService,
);
const textWorkbenchService = new TextWorkbenchService(pool, jobService);
const virtualPortraitService = new VirtualPortraitService(
  pool,
  objectStorage,
  new Token360VirtualPortraitClient(config.provider),
);
const emailVerificationService = config.emailVerification?.enabled
  ? new EmailVerificationService(pool, config.emailVerification)
  : undefined;
const app = createApp(
  new PostgresPlatformRepository(db),
  config,
  new PostgresAssetService(db, objectStorage, pool, storageQuota),
  jobService,
  modelGateway,
  compositionService,
  operationsService,
  textWorkbenchService,
  virtualPortraitService,
  emailVerificationService,
);

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[platform-api] listening on ${info.port}`);
});

async function shutdown() {
  server.close();
  await jobQueue.queue.close();
  await jobQueue.connection.quit();
  await compositionQueue.queue.close();
  await compositionQueue.connection.quit();
  await pool.end();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
