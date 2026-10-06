import { readFile } from "node:fs/promises";
import { Client } from "pg";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://studio:studio@localhost:5432/jingjie";
const migration = `${await readFile(new URL("../db/migrations/0000_backend_loop.sql", import.meta.url), "utf8")}\n${await readFile(new URL("../db/migrations/0001_scope_canvas_nodes.sql", import.meta.url), "utf8")}\n${await readFile(new URL("../db/migrations/0002_assets.sql", import.meta.url), "utf8")}\n${await readFile(new URL("../db/migrations/0003_platform_capabilities.sql", import.meta.url), "utf8")}\n${await readFile(new URL("../db/migrations/0004_canvas_extensions.sql", import.meta.url), "utf8")}\n${await readFile(new URL("../db/migrations/0005_credits.sql", import.meta.url), "utf8")}\n${await readFile(new URL("../db/migrations/0006_activation_codes.sql", import.meta.url), "utf8")}\n${await readFile(new URL("../db/migrations/0007_wallet_live.sql", import.meta.url), "utf8")}\n${await readFile(new URL("../db/migrations/0008_account_credentials.sql", import.meta.url), "utf8")}`;
let lastError;
for (let attempt = 1; attempt <= 30; attempt += 1) {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    await client.query(migration);
    await client.end();
    console.log("[jingjie-db] schema ready");
    process.exit(0);
  } catch (error) {
    lastError = error;
    await client.end().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
console.error("[jingjie-db] unable to initialize schema", lastError);
process.exit(1);
