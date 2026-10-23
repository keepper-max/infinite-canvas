import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";

import { createApp } from "../src/app.js";
import type { ApiConfig } from "../src/config.js";
import { hashSessionToken } from "../src/auth.js";
import { createDatabase } from "../src/db/client.js";
import { applyMigrations } from "../src/db/migrate.js";
import { PostgresPlatformRepository } from "../src/repository.js";
import { parseCanvasWrite } from "../src/canvas-contract.js";
import { assertProjectAccess } from "../src/project-access.js";

const databaseUrl = process.env.S0_TEST_DATABASE_URL;
const artifacts = process.env.S0_ARTIFACT_DIR;

test("S0 isolated authorization, real MCP and transaction proposal", { skip: !databaseUrl || !artifacts }, async (t) => {
    // Refuse accidental execution against any normal development/production database.
    const target = new URL(databaseUrl!);
    assert.equal(target.hostname, "127.0.0.1");
    assert.ok((target.port === "55440" && target.pathname === "/s0_isolated") || (target.port === "55441" && target.pathname === "/s03_isolated"));
    const { pool, db } = createDatabase(databaseUrl!);
    const repository = new PostgresPlatformRepository(db);
    const require = createRequire(import.meta.url);
    const { createMcpAccess } = require(resolve(artifacts!, "mcp-access.cjs"));
    const sdkRequire = createRequire(process.env.S0_MCP_SOURCE_PACKAGE!);
    const { Client } = sdkRequire("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = sdkRequire("@modelcontextprotocol/sdk/client/stdio.js");
    try {
        assert.equal((await pool.query("select current_database() as name")).rows[0].name, target.pathname.slice(1));
        await applyMigrations(pool, resolve(import.meta.dirname, "../db/migrations"));
        const suffix = randomUUID();
        const owner = await repository.createUserWithWorkspace(`owner-${suffix}@example.test`, "unusable-test-hash");
        const other = await repository.createUserWithWorkspace(`other-${suffix}@example.test`, "unusable-test-hash");
        const admin = await repository.createUserWithWorkspace(`admin-${suffix}@example.test`, "unusable-test-hash");
        await pool.query("update users set is_admin=true where id=$1", [admin.user.id]);
        let projectId = owner.workspace.projectId;
        const token = randomUUID();
        await repository.createSession(owner.user.id, hashSessionToken(token), new Date(Date.now() + 3600000));
        const config = { cookieName: "s0_session", cookieSecure: false, sessionDays: 1, trustedOrigins: [], databaseUrl } as ApiConfig;
        const app = createApp(repository, config);
        const cookie = `s0_session=${token}`;
        const env = { SHOUSHOU_MCP_USER_ID: owner.user.id };
        const access = createMcpAccess(pool, env);
        const editMember = async (role: string) => pool.query(
            "insert into project_members(project_id,user_id,role) values ($1,$2,$3) on conflict(project_id,user_id) do update set role=excluded.role",
            [projectId, other.user.id, role],
        );
        const asOther = createMcpAccess(pool, { SHOUSHOU_MCP_USER_ID: other.user.id });

        await t.test("same formal role guard; next call observes role change and removal", async () => {
            for (const role of ["owner", "admin", "editor", "viewer", "unexpected-role"]) {
                await editMember(role);
                assert.equal((await asOther.requireProject(projectId)).role, role);
                if (["owner", "admin", "editor"].includes(role)) {
                    assert.equal((await asOther.requireProject(projectId, true)).role, role);
                    assert.equal(await assertProjectAccess(pool, projectId, other.user.id, "edit"), role);
                } else {
                    await assert.rejects(asOther.requireProject(projectId, true), { code: "PROJECT_READ_ONLY" });
                    await assert.rejects(assertProjectAccess(pool, projectId, other.user.id, "edit"), { code: "PROJECT_READ_ONLY" });
                }
            }
            await pool.query("delete from project_members where project_id=$1 and user_id=$2", [projectId, other.user.id]);
            await assert.rejects(asOther.requireProject(projectId), { code: "PROJECT_FORBIDDEN" });
        });
        await t.test("disabled account invalidates operator and existing HTTP session", async () => {
            await access.requireProject(projectId, true);
            assert.equal((await app.request(`/api/projects/${projectId}`, { headers: { cookie } })).status, 200);
            await pool.query("update users set account_status='disabled' where id=$1", [owner.user.id]);
            await assert.rejects(access.requireProject(projectId), { code: "UNAUTHENTICATED" });
            await assert.rejects(access.listProjects(), { code: "UNAUTHENTICATED" });
            assert.equal((await app.request(`/api/projects/${projectId}`, { headers: { cookie } })).status, 401);
            await pool.query("update users set account_status='active' where id=$1", [owner.user.id]);
        });
        await t.test("operator has no admin bypass; allowlist only narrows membership", async () => {
            await assert.rejects(createMcpAccess(pool, {}).getMcpUserId(), { code: "UNAUTHENTICATED" });
            await assert.rejects(createMcpAccess(pool, { SHOUSHOU_MCP_USER_ID: admin.user.id }).requireProject(projectId), { code: "PROJECT_FORBIDDEN" });
            await assert.rejects(createMcpAccess(pool, { SHOUSHOU_MCP_USER_ID: other.user.id, SHOUSHOU_MCP_PROJECT_IDS: projectId }).requireProject(projectId), { code: "PROJECT_FORBIDDEN" });
            env.SHOUSHOU_MCP_PROJECT_IDS = other.workspace.projectId;
            await assert.rejects(access.requireProject(projectId), /白名单/);
            assert.equal((await access.listProjects()).length, 0);
            env.SHOUSHOU_MCP_PROJECT_IDS = projectId;
            assert.equal((await access.listProjects()).length, 1);
            delete env.SHOUSHOU_MCP_PROJECT_IDS;
            await assert.rejects(createMcpAccess(pool, { SHOUSHOU_MCP_USER_ID: owner.user.id, SHOUSHOU_MCP_ACCOUNT: other.user.email }).getMcpUserId(), { code: "UNAUTHENTICATED" });
        });
        await t.test("deleted project denied by MCP and HTTP discovery/access", async () => {
            await pool.query("update projects set deleted_at=now() where id=$1", [projectId]);
            await assert.rejects(access.requireProject(projectId), { code: "PROJECT_FORBIDDEN" });
            assert.ok(!(await access.listProjects()).some((p: any) => p.id === projectId));
            assert.equal((await app.request(`/api/projects/${projectId}`, { headers: { cookie } })).status, 403);
            await pool.query("update projects set deleted_at=null where id=$1", [projectId]);
        });

        const node = (title: string) => ({ id: randomUUID(), type: "text", title, position: { x: 0, y: 0 }, width: 300, height: 200, metadata: {} });
        const write = (revision: number, nodes: any[]) => parseCanvasWrite({ expectedRevision: revision, nodes, edges: [], viewport: { x: 0, y: 0, k: 1 } }).write;
        await t.test("real MCP retains legacy schemas and refuses retired direct writes", async () => {
            const client = new Client({ name: "s0-isolated-test", version: "1.0.0" });
            const transport = new StdioClientTransport({ command: process.execPath, args: [process.env.S0_MCP_TEST_BUNDLE || resolve(artifacts!, "mcp-candidate.cjs")], cwd: artifacts!, stderr: "pipe", env: {
                PATH: process.env.PATH!, SystemRoot: process.env.SystemRoot!, TEMP: process.env.TEMP!, TMP: process.env.TMP!,
                NODE_ENV: "test", DATABASE_URL: databaseUrl!, SHOUSHOU_MCP_USER_ID: owner.user.id,
                S3_ENDPOINT: "http://127.0.0.1:1", S3_BUCKET: "s0-unused", S3_ACCESS_KEY_ID: "s0-unused", S3_SECRET_ACCESS_KEY: "s0-unused",
            } });
            try {
                await client.connect(transport);
                const tools = (await client.listTools()).tools;
                assert.equal(tools.length, 13);
                const storyboard = tools.find((tool: any) => tool.name === "create_vibe_storyboard");
                assert.ok(!storyboard.inputSchema.properties.operationId);
                assert.ok((await client.callTool({ name: "get_project_context", arguments: { projectId: other.workspace.projectId, userId: other.user.id } })).isError);
                const before = await repository.getCanvasForUser(projectId, owner.user.id);
                const input = { projectId, title: "S0隔离复现", summary: "合成测试", aspectRatio: "9:16", scenes: [{ title: "测试", narration: "合成旁白", visual: "几何图形", durationSeconds: 5 }] };
                const first = await client.callTool({ name: "create_vibe_storyboard", arguments: input });
                assert.equal(first.structuredContent.code, "LEGACY_CANVAS_WRITE_DISABLED");
                const second = await client.callTool({ name: "create_vibe_storyboard", arguments: input });
                assert.equal(second.structuredContent.code, "LEGACY_CANVAS_WRITE_DISABLED");
                const after = await repository.getCanvasForUser(projectId, owner.user.id);
                assert.equal(after!.revision, before!.revision);
                assert.equal((await pool.query("select count(*)::int as n from canvas_nodes where project_id=$1", [projectId])).rows[0].n, 0);
                await pool.query("update project_members set role='unexpected-role' where project_id=$1 and user_id=$2", [projectId, owner.user.id]);
                assert.ok((await client.callTool({ name: "create_vibe_storyboard", arguments: input })).isError);
                await pool.query("update project_members set role='owner' where project_id=$1 and user_id=$2", [projectId, owner.user.id]);
                // Historical raw-state reproduction now lives in canvas-operations.integration;
                // the candidate keeps the old schemas but never executes their direct SQL.
                const saved = await repository.saveCanvasForUser(projectId, owner.user.id, write(before!.revision, [node("网页草稿")]));
                assert.equal(saved.revision, before!.revision + 1);
                await pool.query("update users set account_status='disabled' where id=$1", [owner.user.id]);
                assert.ok((await client.callTool({ name: "get_project_context", arguments: { projectId } })).isError);
                await pool.query("update users set account_status='active' where id=$1", [owner.user.id]);
                await pool.query("update projects set deleted_at=now() where id=$1", [projectId]);
                assert.ok((await client.callTool({ name: "get_project_context", arguments: { projectId } })).isError);
                await pool.query("update projects set deleted_at=null where id=$1", [projectId]);
            } finally { await client.close(); }
        });

        projectId = (await repository.createProjectForUser(owner.user.id, { name: "S0事务实验", description: "独立合成数据" })).projectId;

        await t.test("formal revision CAS serializes two browser writers and snapshots agree", async () => {
            const current = (await repository.getCanvasForUser(projectId, owner.user.id))!;
            const results = await Promise.allSettled([
                repository.saveCanvasForUser(projectId, owner.user.id, write(current.revision, [node("并发A")])),
                repository.saveCanvasForUser(projectId, owner.user.id, write(current.revision, [node("并发B")])),
            ]);
            assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
            const failure = results.find(r => r.status === "rejected") as PromiseRejectedResult;
            assert.equal(failure.reason.code, "CANVAS_REVISION_CONFLICT");
            const latest = (await repository.getCanvasForUser(projectId, owner.user.id))!;
            const snapshot = (await pool.query("select nodes from canvas_snapshots where project_id=$1 and version=$2", [projectId, latest.revision])).rows[0];
            assert.deepEqual(snapshot.nodes, latest.nodes);
        });

        // EXPERIMENT ONLY: no exported API/tool, production migration or parameter change.
        // Use the real repository under a savepoint in the outer transaction, so its
        // CAS/nodes/edges/asset links/snapshot and the receipt commit or roll back together.
        await pool.query(`create table if not exists s0_canvas_operations (
            project_id uuid not null, actor_id uuid not null, operation_id uuid not null,
            payload_hash text not null, result jsonb not null,
            primary key(project_id,actor_id,operation_id))`);
        const atomicAppend = async (operationId: string, expectedRevision: number, title: string, fault = false) => db.transaction(async tx => {
            const digest = createHash("sha256").update(JSON.stringify({ expectedRevision, title })).digest("hex");
            // Lock authorization rows until commit; changes take effect after this authorized call.
            const active = await tx.execute(sql`select id from users where id=${owner.user.id} and account_status='active' for share`);
            assert.equal(active.rows.length, 1, "actor disabled");
            // Match the existing save path's canvas-before-project update order.
            // A shared project lock before the CAS would deadlock on lock upgrade.
            await tx.execute(sql`select id from canvases where project_id=${projectId} for update`);
            await tx.execute(sql`select id from projects where id=${projectId} and deleted_at is null for share`);
            await tx.execute(sql`select user_id from project_members where project_id=${projectId} and user_id=${owner.user.id} for share`);
            await assertProjectAccess(pool, projectId, owner.user.id, "edit");
            await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${projectId}:${owner.user.id}:${operationId}`},0))`);
            const receipt = await tx.execute(sql`select * from s0_canvas_operations where project_id=${projectId} and actor_id=${owner.user.id} and operation_id=${operationId}`);
            if (receipt.rows[0]) {
                assert.equal(receipt.rows[0].payload_hash, digest, "operation payload mismatch");
                return receipt.rows[0].result as any;
            }
            const scoped = new PostgresPlatformRepository(tx as unknown as typeof db);
            const current = (await scoped.getCanvasForUser(projectId, owner.user.id))!;
            const added = node(title);
            const previous = current.nodes.at(-1);
            const merged = parseCanvasWrite({
                expectedRevision, contractVersion: current.contractVersion,
                viewport: current.viewport, settings: current.settings, nodes: [...current.nodes, added],
                edges: [...current.edges, ...(previous ? [{ id: randomUUID(), fromNodeId: previous.id, toNodeId: added.id }] : [])],
            }).write;
            const result = await scoped.saveCanvasForUser(projectId, owner.user.id, merged);
            if (fault) throw new Error("injected failure after save before receipt");
            await tx.execute(sql`insert into s0_canvas_operations values (${projectId},${owner.user.id},${operationId},${digest},${JSON.stringify(result)}::jsonb)`);
            return result;
        });
        await t.test("proposal: lost response/concurrent retries return one receipt, mismatched replay denied", async () => {
            const current = (await repository.getCanvasForUser(projectId, owner.user.id))!;
            const operationId = randomUUID();
            const attempts = await Promise.allSettled([atomicAppend(operationId, current.revision, "MCP追加"), atomicAppend(operationId, current.revision, "MCP追加")]);
            for (const attempt of attempts) assert.equal(attempt.status, "fulfilled", attempt.status === "rejected" ? String(attempt.reason) : undefined);
            const [a, b] = attempts.map(attempt => (attempt as PromiseFulfilledResult<any>).value);
            assert.deepEqual(a, b);
            assert.equal(a.revision, current.revision + 1);
            assert.deepEqual(await atomicAppend(operationId, current.revision, "MCP追加"), a);
            assert.equal((await repository.getCanvasForUser(projectId, owner.user.id))!.nodes.length, current.nodes.length + 1);
            assert.equal((await repository.getCanvasForUser(projectId, owner.user.id))!.edges.length, current.edges.length + 1);
            const snapshot = (await pool.query("select nodes,edges from canvas_snapshots where project_id=$1 and version=$2", [projectId, a.revision])).rows[0];
            assert.deepEqual(snapshot.nodes, a.nodes);
            assert.deepEqual(snapshot.edges, a.edges);
            await assert.rejects(atomicAppend(operationId, current.revision, "篡改重放"), /payload mismatch/);
            await assert.rejects(repository.saveCanvasForUser(projectId, owner.user.id, write(current.revision, [node("旧网页")])), { code: "CANVAS_REVISION_CONFLICT" });
            await pool.query("update users set account_status='disabled' where id=$1", [owner.user.id]);
            await assert.rejects(atomicAppend(operationId, current.revision, "MCP追加"), /actor disabled/);
            await pool.query("update users set account_status='active' where id=$1", [owner.user.id]);
        });
        await t.test("proposal: failed outer transaction has no half nodes, revision, snapshot or receipt", async () => {
            const current = (await repository.getCanvasForUser(projectId, owner.user.id))!;
            const operationId = randomUUID();
            const beforeSnapshots = (await pool.query("select count(*)::int n from canvas_snapshots where project_id=$1", [projectId])).rows[0].n;
            await assert.rejects(atomicAppend(operationId, current.revision, "回滚追加", true), /injected failure/);
            assert.deepEqual(await repository.getCanvasForUser(projectId, owner.user.id), current);
            assert.equal((await pool.query("select count(*)::int n from canvas_snapshots where project_id=$1", [projectId])).rows[0].n, beforeSnapshots);
            assert.equal((await pool.query("select count(*)::int n from s0_canvas_operations where operation_id=$1", [operationId])).rows[0].n, 0);
        });
        await t.test("proposal: competing operation IDs have one CAS winner and no loser receipt", async () => {
            const current = (await repository.getCanvasForUser(projectId, owner.user.id))!;
            const ids = [randomUUID(), randomUUID()];
            const results = await Promise.allSettled(ids.map((id, i) => atomicAppend(id, current.revision, `竞争${i}`)));
            assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
            assert.equal((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason.code, "CANVAS_REVISION_CONFLICT");
            assert.equal((await pool.query("select count(*)::int n from s0_canvas_operations where operation_id=any($1::uuid[])", [ids])).rows[0].n, 1);
        });
    } finally { await pool.end(); }
});
