import { readConfig } from "../config.js";
import { createDatabase } from "./client.js";
import { applyMigrations } from "./migrate.js";

const config = readConfig();
const { pool } = createDatabase(config.databaseUrl);

try {
    await applyMigrations(pool);
    console.log("[platform-api] database schema ready");
} finally {
    await pool.end();
}
