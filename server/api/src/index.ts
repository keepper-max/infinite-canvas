import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { applyMigrations } from "./db/migrate.js";
import { PostgresPlatformRepository } from "./repository.js";

const config = readConfig();
const { db, pool } = createDatabase(config.databaseUrl);

await applyMigrations(pool);
const app = createApp(new PostgresPlatformRepository(db), config);

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`[platform-api] listening on ${info.port}`);
});

async function shutdown() {
    server.close();
    await pool.end();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
