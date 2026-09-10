import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";

const MIGRATION_LOCK_ID = 1_226_914_126;

export async function applyMigrations(pool: Pool, directory = resolve(process.cwd(), "db/migrations")) {
    const files = (await readdir(directory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
    const client = await pool.connect();
    try {
        // API and Worker can boot together on a fresh host. Serialize schema changes on
        // the same PostgreSQL session so both processes never create the same objects.
        await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
        await client.query(`
            create table if not exists platform_schema_migrations (
                name text primary key,
                sha256 text not null,
                applied_at timestamptz not null default now()
            )
        `);
        for (const name of files) {
            const sql = await readFile(resolve(directory, name), "utf8");
            const sha256 = createHash("sha256").update(sql).digest("hex");
            const existing = await client.query<{ sha256: string }>("select sha256 from platform_schema_migrations where name = $1", [name]);
            if (existing.rows[0]) {
                if (existing.rows[0].sha256 !== sha256) throw new Error(`Migration changed after apply: ${name}`);
                continue;
            }
            await client.query("begin");
            try {
                await client.query(sql);
                await client.query("insert into platform_schema_migrations(name, sha256) values ($1, $2)", [name, sha256]);
                await client.query("commit");
            } catch (error) {
                await client.query("rollback");
                throw error;
            }
        }
    } finally {
        await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => undefined);
        client.release();
    }
}
