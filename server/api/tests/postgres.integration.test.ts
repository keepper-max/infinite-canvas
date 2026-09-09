import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../src/app.js";
import type { ApiConfig } from "../src/config.js";
import { createDatabase } from "../src/db/client.js";
import { applyMigrations } from "../src/db/migrate.js";
import { PostgresPlatformRepository } from "../src/repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("PostgreSQL persists sessions, default workspace, and project isolation", { skip: !databaseUrl }, async () => {
    const { db, pool } = createDatabase(databaseUrl!);
    try {
        await applyMigrations(pool);
        const repository = new PostgresPlatformRepository(db);
        const config: ApiConfig = { port: 3002, databaseUrl: databaseUrl!, cookieName: "integration_session", cookieSecure: false, sessionDays: 14, trustedOrigins: [] };
        const firstApp = createApp(repository, config);
        const first = await register(firstApp, "db-a@example.com");
        const second = await register(firstApp, "db-b@example.com");

        const count = await pool.query<{ count: string }>("select count(*)::text as count from projects where owner_id = (select id from users where email = $1)", ["db-a@example.com"]);
        assert.equal(count.rows[0]?.count, "1");
        const defaults = await pool.query<{ count: string }>("select count(*)::text as count from projects where owner_id = (select id from users where email = $1) and is_default = true", ["db-a@example.com"]);
        assert.equal(defaults.rows[0]?.count, "1");

        const restartedApp = createApp(new PostgresPlatformRepository(db), config);
        assert.equal((await restartedApp.request("/api/auth/me", { headers: { cookie: first.cookie } })).status, 200);
        assert.equal((await restartedApp.request(`/api/projects/${second.workspaceId}`, { headers: { cookie: first.cookie } })).status, 403);
        assert.equal((await restartedApp.request(`/api/projects/${first.workspaceId}`, { headers: { cookie: first.cookie } })).status, 200);
    } finally {
        await pool.end();
    }
});

async function register(app: ReturnType<typeof createApp>, email: string) {
    const response = await app.request("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "integration-password" }),
    });
    assert.equal(response.status, 201);
    const body = await response.json() as { data: { workspace: { projectId: string } } };
    const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(cookie);
    return { cookie, workspaceId: body.data.workspace.projectId };
}
