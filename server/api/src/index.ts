import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { PostgresAssetService } from "./asset-service.js";
import { readConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { applyMigrations } from "./db/migrate.js";
import { PostgresPlatformRepository } from "./repository.js";
import { S3ObjectStorage } from "./object-storage.js";

const config = readConfig();
const { db, pool } = createDatabase(config.databaseUrl);

await applyMigrations(pool);
const objectStorage = new S3ObjectStorage(config.objectStorage);
await objectStorage.ensureReady();
const app = createApp(new PostgresPlatformRepository(db), config, new PostgresAssetService(db, objectStorage));

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`[platform-api] listening on ${info.port}`);
});

async function shutdown() {
    server.close();
    await pool.end();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
