import { createDatabase } from "./client.js";
import { applyMigrations } from "./migrate.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const { pool } = createDatabase(databaseUrl);

try {
    await applyMigrations(pool);
    console.log("[platform-api] database schema ready");
} finally {
    await pool.end();
}
