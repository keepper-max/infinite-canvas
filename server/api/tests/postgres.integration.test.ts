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
        const suffix = crypto.randomUUID();
        const firstEmail = `db-a-${suffix}@example.com`;
        const secondEmail = `db-b-${suffix}@example.com`;
        const first = await register(firstApp, firstEmail);
        const second = await register(firstApp, secondEmail);

        const count = await pool.query<{ count: string }>("select count(*)::text as count from projects where owner_id = (select id from users where email = $1)", [firstEmail]);
        assert.equal(count.rows[0]?.count, "1");
        const defaults = await pool.query<{ count: string }>("select count(*)::text as count from projects where owner_id = (select id from users where email = $1) and is_default = true", [firstEmail]);
        assert.equal(defaults.rows[0]?.count, "1");

        const restartedApp = createApp(new PostgresPlatformRepository(db), config);
        assert.equal((await restartedApp.request("/api/auth/me", { headers: { cookie: first.cookie } })).status, 200);
        assert.equal((await restartedApp.request(`/api/projects/${second.workspaceId}`, { headers: { cookie: first.cookie } })).status, 403);
        assert.equal((await restartedApp.request(`/api/projects/${first.workspaceId}`, { headers: { cookie: first.cookie } })).status, 200);

        const initialWrite = canvasWrite(0, "初始故事");
        const saved = await putCanvas(restartedApp, first.workspaceId, first.cookie, initialWrite);
        assert.equal(saved.response.status, 200);
        assert.equal(saved.body.data.canvas.revision, 1);
        assert.equal((await restartedApp.request(`/api/projects/${first.workspaceId}/canvas`, { headers: { cookie: second.cookie } })).status, 403);

        const stale = await putCanvas(restartedApp, first.workspaceId, first.cookie, initialWrite);
        assert.equal(stale.response.status, 409);
        assert.equal(stale.body.error.details.currentRevision, 1);

        const secondVersion = await putCanvas(restartedApp, first.workspaceId, first.cookie, canvasWrite(1, "第二版故事"));
        assert.equal(secondVersion.body.data.canvas.revision, 2);
        const snapshots = await restartedApp.request(`/api/projects/${first.workspaceId}/canvas/snapshots`, { headers: { cookie: first.cookie } });
        assert.deepEqual(((await snapshots.json()) as any).data.snapshots.map((item: any) => item.version), [2, 1]);
        const restored = await restartedApp.request(`/api/projects/${first.workspaceId}/canvas/snapshots/1/restore`, { method: "POST", headers: { cookie: first.cookie, "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 2 }) });
        const restoredBody = await restored.json() as any;
        assert.equal(restoredBody.data.canvas.revision, 3);
        assert.equal(restoredBody.data.canvas.nodes[0].title, "初始故事");

        const migrationProject = await register(restartedApp, `db-migration-${suffix}@example.com`);
        const migrationBody = { migrationKey: `indexeddb-${suffix}`, ...canvasWrite(0, "迁移故事"), nodes: [{ ...canvasWrite(0, "迁移故事").nodes[0], metadata: { apiKey: "do-not-store", storageKey: "image:pending" } }] };
        const migrated = await postJson(restartedApp, `/api/projects/${migrationProject.workspaceId}/canvas/migrations/indexeddb`, migrationProject.cookie, migrationBody);
        assert.equal(migrated.body.data.canvas.nodes[0].metadata.apiKey, undefined);
        assert.deepEqual(migrated.body.data.report.pendingResourceRefs, ["image:pending"]);
        const repeated = await postJson(restartedApp, `/api/projects/${migrationProject.workspaceId}/canvas/migrations/indexeddb`, migrationProject.cookie, migrationBody);
        assert.equal(repeated.body.data.alreadyMigrated, true);
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

function canvasWrite(expectedRevision: number, title: string) {
    return {
        expectedRevision,
        contractVersion: 1,
        nodes: [{ id: "story", type: "text", title, position: { x: 40, y: 80 }, width: 320, height: 180, metadata: {} }],
        edges: [],
        viewport: { x: 12, y: 24, k: 1.25 },
        settings: { backgroundMode: "dots", showImageInfo: true },
    };
}

async function putCanvas(app: ReturnType<typeof createApp>, projectId: string, cookie: string, body: unknown) {
    const response = await app.request(`/api/projects/${projectId}/canvas`, { method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
    return { response, body: await response.json() as any };
}

async function postJson(app: ReturnType<typeof createApp>, path: string, cookie: string, body: unknown) {
    const response = await app.request(path, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
    return { response, body: await response.json() as any };
}
