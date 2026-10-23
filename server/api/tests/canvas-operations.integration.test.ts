import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import { mkdir, writeFile, readFile, readdir, copyFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { createDatabase } from "../src/db/client.js";
import { applyMigrations } from "../src/db/migrate.js";
import { PostgresPlatformRepository } from "../src/repository.js";
import { VibeCanvasService } from "../src/vibe-canvas-service.js";
import { createApp } from "../src/app.js";
import { hashSessionToken } from "../src/auth.js";
import type { ApiConfig } from "../src/config.js";
import { parseCanvasWrite } from "../src/canvas-contract.js";

const url = process.env.S03_TEST_DATABASE_URL;
const artifacts = process.env.S03_ARTIFACT_DIR;

test("S0-3 real PostgreSQL canvas transaction, compatibility and MCP cutover", { skip: !url || !artifacts }, async t => {
  const target = new URL(url!);
  assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55441"); assert.equal(target.pathname, "/s03_isolated");
  const { db, pool } = createDatabase(url!);
  const repo = new PostgresPlatformRepository(db), service = new VibeCanvasService(pool);
  const migrations = resolve(import.meta.dirname, "../db/migrations");
  const checks: string[] = [];
  const failures: string[] = [];
  const run = async (name: string, callback: () => Promise<void>) => t.test(name, async () => {
    try { await callback(); checks.push(name); } catch (error) { failures.push(name); throw error; }
  });
  try {
    assert.equal((await pool.query("select current_database() as name")).rows[0].name, "s03_isolated");
    await applyMigrations(pool, migrations);
    const owner = await repo.createUserWithWorkspace(`s03-owner-${randomUUID()}@example.test`, "unusable-test-hash");
    const editor = await repo.createUserWithWorkspace(`s03-editor-${randomUUID()}@example.test`, "unusable-test-hash");
    const project = async () => (await repo.createProjectForUser(owner.user.id, { name: "S03合成项目", description: "隔离验证" })).projectId;
    const request = (revision = 0, operationId = randomUUID()) => ({ operationId, expectedCanvasRevision: revision, title: "测试分镜", summary: "可持久化正文", aspectRatio: "9:16" as const,
      scenes: [{ title: "场景", narration: "中文旁白", visual: "几何场景", durationSeconds: 5 }] });
    const video = (storyboardId: string, revision: number) => ({ operationId: randomUUID(), expectedCanvasRevision: revision, storyboardId, title: "合成成片", sha256: "a".repeat(64), bytes: 16, mimeType: "video/mp4" as const });
    const state = async (id: string) => {
      const counts: Record<string, number> = {};
      for (const table of ["canvas_nodes", "canvas_edges", "canvas_snapshots", "canvas_operations", "assets", "asset_links", "canvas_repair_archives"])
        counts[table] = (await pool.query(`select count(*)::int n from ${table} where project_id=$1`, [id])).rows[0].n;
      counts.asset_versions = (await pool.query("select count(*)::int n from asset_versions v join assets a on a.id=v.asset_id where a.project_id=$1", [id])).rows[0].n;
      return { canvas: await repo.getCanvasForUser(id, owner.user.id), counts,
        audits: (await pool.query("select count(*)::int n from admin_audit_logs where target_id=(select id::text from canvases where project_id=$1)", [id])).rows[0].n };
    };
    const token = randomUUID();
    await repo.createSession(owner.user.id, hashSessionToken(token), new Date(Date.now() + 3600000));
    const app = createApp(repo, { cookieName: "s03_session", cookieSecure: false, trustedOrigins: [], databaseUrl: url } as unknown as ApiConfig);
    const webSave = (id: string, expectedRevision: number) => app.request(`/api/projects/${id}/canvas`, {
      method: "PUT", headers: { cookie: `s03_session=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision, nodes: [{ id: randomUUID(), type: "text", title: "网页", position: { x: 1, y: 2 }, width: 300, height: 200 }], edges: [], viewport: { x: 0, y: 0, k: 1 } }),
    });
    await run("committed receipt carries actual revision, canonical graph and audit", async () => {
      const id = await project(), result = await service.createStoryboard(id, owner.user.id, request());
      assert.equal(result.revision, 1); assert.equal(result.replayed, false); assert.equal(result.nodeIds.length, 3);
      const saved = (await state(id));
      assert.equal(saved.counts.canvas_operations, 1); assert.equal(saved.audits, 2);
      assert.equal(saved.canvas!.nodes[0].metadata.content, "可持久化正文");
      const snapshot = (await pool.query("select nodes,edges,viewport,settings from canvas_snapshots where project_id=$1 and version=1", [id])).rows[0];
      assert.deepEqual(snapshot.nodes, saved.canvas!.nodes); assert.deepEqual(snapshot.edges, saved.canvas!.edges);
    });
    await run("same operation concurrent retry creates one graph; payload mismatch rejects", async () => {
      const id = await project(), input = request();
      const [a, b] = await Promise.all([service.createStoryboard(id, owner.user.id, input), service.createStoryboard(id, owner.user.id, input)]);
      assert.equal(Number(a.replayed) + Number(b.replayed), 1); assert.equal(a.revision, b.revision); assert.deepEqual(a.nodeIds, b.nodeIds);
      const before = await state(id);
      await assert.rejects(service.createStoryboard(id, owner.user.id, { ...input, title: "不同内容" }), { code: "CANVAS_OPERATION_MISMATCH" });
      assert.deepEqual(await state(id), before);
    });
    await run("JSONB canonical hash ignores object key order and replays before stale revision", async () => {
      const id = await project(), operationId = randomUUID(); let calls = 0;
      const mutate = async (current: any) => { calls++; return { ...current, result: { marker: "canonical" } }; };
      await repo.applyCanvasOperationForUser(id, owner.user.id, { operationId, expectedCanvasRevision: 0, kind: "vibe.storyboard.create", payload: { a: 1, b: 2 } }, mutate);
      assert.equal((await repo.applyCanvasOperationForUser(id, owner.user.id, { operationId, expectedCanvasRevision: 0, kind: "vibe.storyboard.create", payload: { b: 2, a: 1 } }, mutate)).replayed, true);
      assert.equal(calls, 1);
    });
    await run("different MCP operation IDs at same old revision have one CAS winner", async () => {
      const id = await project();
      const results = await Promise.allSettled([service.createStoryboard(id, owner.user.id, request()), service.createStoryboard(id, owner.user.id, request())]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      const failure = (results.find(r => r.status === "rejected") as PromiseRejectedResult).reason;
      assert.equal(failure.code, "CANVAS_REVISION_CONFLICT"); assert.equal(failure.details.currentRevision, 1);
      assert.equal((await state(id)).counts.canvas_operations, 1);
    });
    await run("Web HTTP save races MCP; loser cannot overwrite winner", async () => {
      for (let i = 0; i < 3; i++) {
        const id = await project();
        const [web, mcp] = await Promise.all([webSave(id, 0), service.createStoryboard(id, owner.user.id, request()).then(value => ({ value, error: undefined }), error => ({ error, value: undefined }))]);
        assert.equal(Number(web.status === 200) + Number(Boolean(mcp.value)), 1);
        if (mcp.error) assert.equal(mcp.error.code, "CANVAS_REVISION_CONFLICT");
        else { assert.equal(web.status, 409); assert.equal((await web.json()).error.details.currentRevision, 1); }
        assert.equal((await state(id)).counts.canvas_snapshots, 1);
      }
    });
    await run("actual connection loss after COMMIT replays the durable receipt", async () => {
      const id = await project(), input = request();
      const server = createServer(async (_req, res) => { await service.createStoryboard(id, owner.user.id, input); res.destroy(); });
      server.listen(0, "127.0.0.1"); await once(server, "listening");
      try {
        const address = server.address() as { port: number };
        await assert.rejects(fetch(`http://127.0.0.1:${address.port}/lost-receipt`, { method: "POST" }));
        const before = await state(id), replay = await service.createStoryboard(id, owner.user.id, input);
        assert.equal(replay.replayed, true); assert.deepEqual(await state(id), before);
      } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
    });
    await run("revoked member, unknown role, deleted project and disabled user cannot replay", async () => {
      const id = await project();
      await pool.query("insert into project_members(project_id,user_id,role) values ($1,$2,'editor')", [id, editor.user.id]);
      const input = request(); await service.createStoryboard(id, editor.user.id, input);
      await pool.query("update project_members set role='unexpected' where project_id=$1 and user_id=$2", [id, editor.user.id]);
      await assert.rejects(service.createStoryboard(id, editor.user.id, input), { code: "PROJECT_READ_ONLY" });
      await pool.query("delete from project_members where project_id=$1 and user_id=$2", [id, editor.user.id]);
      await assert.rejects(service.createStoryboard(id, editor.user.id, input), { code: "PROJECT_FORBIDDEN" });
      const own = request(1); await service.createStoryboard(id, owner.user.id, own);
      await pool.query("update projects set deleted_at=now() where id=$1", [id]);
      await assert.rejects(service.createStoryboard(id, owner.user.id, own), { code: "PROJECT_FORBIDDEN" });
      await pool.query("update users set account_status='disabled' where id=$1", [owner.user.id]);
      await assert.rejects(service.createStoryboard(id, owner.user.id, own), { code: "UNAUTHENTICATED" });
      await pool.query("update users set account_status='active' where id=$1", [owner.user.id]);
    });
    await run("permission revocation waits for authorized transaction then blocks next call", async () => {
      const id = await project();
      await pool.query("insert into project_members(project_id,user_id,role) values ($1,$2,'editor')", [id, editor.user.id]);
      let entered!: () => void, release!: () => void;
      const enteredPromise = new Promise<void>(r => entered = r), gate = new Promise<void>(r => release = r);
      const operationId = randomUUID();
      const write = repo.applyCanvasOperationForUser(id, editor.user.id, { operationId, expectedCanvasRevision: 0, kind: "vibe.storyboard.create", payload: {} }, async current => { entered(); await gate; return { ...current, result: {} }; });
      await enteredPromise;
      const revoke = pool.query("delete from project_members where project_id=$1 and user_id=$2", [id, editor.user.id]);
      release(); await write; await revoke;
      await assert.rejects(service.createStoryboard(id, editor.user.id, request(1)), { code: "PROJECT_FORBIDDEN" });
    });
    await run("maintenance gate freezes both Web and MCP while receipt/state reads remain available", async () => {
      const id = await project(), input = request();
      const receipt = await service.createStoryboard(id, owner.user.id, input), before = await state(id);
      const previous = process.env.CANVAS_WRITE_MODE;
      try {
        process.env.CANVAS_WRITE_MODE = "read-only";
        await assert.rejects(service.createStoryboard(id, owner.user.id, request(1)), { code: "CANVAS_WRITES_DISABLED" });
        assert.equal((await webSave(id, 1)).status, 503);
        assert.deepEqual(await repo.getCanvasOperationReceiptForUser(id, owner.user.id, input.operationId), receipt);
        assert.deepEqual(await state(id), before);
        process.env.CANVAS_WRITE_MODE = "repair-only";
        assert.equal((await webSave(id, 1)).status, 503);
        const plan = await repo.inspectCanvasForRepair(id, owner.user.id);
        const repaired = await repo.repairCanvasForUser(id, owner.user.id, { operationId: randomUUID(), expectedCanvasRevision: 1, expectedStateHash: plan.hash, reason: "维护窗口显式操作" });
        assert.equal(repaired.revision, 2);
      } finally { if (previous === undefined) delete process.env.CANVAS_WRITE_MODE; else process.env.CANVAS_WRITE_MODE = previous; }
    });
    for (const table of ["canvas_nodes", "canvas_edges", "canvas_snapshots", "admin_audit_logs", "canvas_operations"]) {
      await run(`SQL failure at ${table} rolls back graph, revision, snapshot, audits and receipt`, async () => {
        const id = await project(), before = await state(id);
        await pool.query("create or replace function s03_fail_insert() returns trigger language plpgsql as $$ begin raise exception 'S03 injected SQL failure'; end $$");
        await pool.query(`create trigger s03_fault before insert on ${table} for each row execute function s03_fail_insert()`);
        try { await assert.rejects(service.createStoryboard(id, owner.user.id, request())); assert.deepEqual(await state(id), before); }
        finally { await pool.query(`drop trigger s03_fault on ${table}`); }
      });
    }
    await run("video asset, version, link, graph and receipt are one database transaction", async () => {
      const id = await project(), created = await service.createStoryboard(id, owner.user.id, request());
      const input = video(String(created.result.storyboardId), 1); let uploads = 0;
      const result = await service.importVideo(id, owner.user.id, input, async () => { uploads++; });
      assert.equal(result.revision, 2);
      const saved = await state(id);
      assert.equal(saved.counts.assets, 1); assert.equal(saved.counts.asset_versions, 1); assert.equal(saved.counts.asset_links, 1);
      assert.equal((await service.importVideo(id, owner.user.id, input, async () => { uploads++; })).replayed, true);
      assert.equal(uploads, 1);
      assert.match(saved.canvas!.nodes.find(n => n.id === result.result.outputNodeId)!.metadata.content as string, /\/api\/media\/asset-versions\//);
    });
    await run("failure after upload preserves staged object but rolls back all database asset state", async () => {
      const id = await project(), created = await service.createStoryboard(id, owner.user.id, request()), before = await state(id);
      await pool.query("create trigger s03_fault before insert on canvas_operations for each row execute function s03_fail_insert()");
      let staged = 0;
      try { await assert.rejects(service.importVideo(id, owner.user.id, video(String(created.result.storyboardId), 1), async () => { staged++; })); assert.equal(staged, 1); assert.deepEqual(await state(id), before); }
      finally { await pool.query("drop trigger s03_fault on canvas_operations"); }
    });
    await run("existing image/video/audio nodes, ports, asset references and view settings survive MCP append", async () => {
      const id = await project(), nodes: any[] = [];
      for (const kind of ["image", "video", "audio"]) {
        const assetId = randomUUID(), versionId = randomUUID(), nodeId = randomUUID(), storageKey = `projects/${id}/${kind}`;
        await pool.query("insert into assets(id,project_id,kind,name,created_by) values ($1,$2,$3,$3,$4)", [assetId, id, kind, owner.user.id]);
        await pool.query("insert into asset_versions(id,asset_id,version,storage_key,mime_type,bytes,sha256,source,created_by) values ($1,$2,1,$3,$4,16,$5,'upload',$6)", [versionId, assetId, storageKey, { image: "image/png", video: "video/mp4", audio: "audio/mpeg" }[kind], "b".repeat(64), owner.user.id]);
        nodes.push({ id: nodeId, type: kind, title: kind, position: { x: nodes.length * 400, y: 0 }, width: 320, height: 240,
          metadata: { assetId, assetVersionId: versionId, storageKey, content: `/api/media/asset-versions/${versionId}`, prompt: "保持创作参数", modelId: "existing-model" } });
      }
      const { write } = parseCanvasWrite({ expectedRevision: 0, nodes, edges: [
        { id: randomUUID(), fromNodeId: nodes[0].id, toNodeId: nodes[1].id, sourcePortId: "image.output", targetPortId: "video.firstFrame", resourceType: "image", role: "first_frame", order: 0 },
        { id: randomUUID(), fromNodeId: nodes[2].id, toNodeId: nodes[1].id, sourcePortId: "audio.output", targetPortId: "video.audio", resourceType: "audio", role: "audio_input", order: 1 },
      ], viewport: { x: 28, y: -18, k: 1.25 }, settings: { backgroundMode: "dots", showImageInfo: true } });
      await repo.saveCanvasForUser(id, owner.user.id, write);
      const before = (await repo.getCanvasForUser(id, owner.user.id))!;
      await service.createStoryboard(id, owner.user.id, request(1));
      const after = (await repo.getCanvasForUser(id, owner.user.id))!;
      assert.deepEqual(after.nodes.slice(0, 3), before.nodes); assert.deepEqual(after.edges.slice(0, 2), before.edges);
      assert.deepEqual(after.viewport, before.viewport); assert.deepEqual(after.settings, before.settings);
      assert.equal((await state(id)).counts.asset_versions, 3);
      assert.equal((await pool.query("select count(distinct asset_version_id)::int n from asset_links where project_id=$1", [id])).rows[0].n, 3);
    });

    const legacy = async (missing = false) => {
      const id = await project(), storyboardId = randomUUID();
      const nodes = ["one", "two"].map(suffix => ({ id: `legacy-${randomUUID()}-${suffix}`, type: "scene", position: { x: 0, y: 0 }, data: { label: "重复候选", description: "保留两份正文", source: "codex-vibe", storyboardId } }));
      for (const node of nodes) await pool.query("insert into canvas_nodes(id,project_id,node_type,label,position,data) values ($1,$2,'scene','重复候选',$3::jsonb,$4::jsonb)", [node.id, id, JSON.stringify(node.position), JSON.stringify(node.data)]);
      await pool.query("insert into canvas_snapshots(project_id,version,nodes,edges) values ($1,7,$2::jsonb,'[]')", [id, JSON.stringify(nodes)]);
      if (missing) await pool.query("delete from canvases where project_id=$1", [id]);
      return { id, nodes };
    };
    for (const missing of [false, true]) await run(`legacy revision/snapshot repair preserves raw history and duplicates (canvas missing=${missing})`, async () => {
      const { id, nodes } = await legacy(missing), plan = await repo.inspectCanvasForRepair(id, owner.user.id);
      assert.ok(plan.reasons.includes("SNAPSHOT_AHEAD")); assert.equal(plan.duplicateCandidates.length, 1);
      await assert.rejects(service.createStoryboard(id, owner.user.id, request()), { code: missing ? "CANVAS_NOT_INITIALIZED" : "CANVAS_REPAIR_REQUIRED" });
      const history = (await pool.query("select * from canvas_snapshots where project_id=$1", [id])).rows;
      const input = { operationId: randomUUID(), expectedCanvasRevision: 0, expectedStateHash: plan.hash, reason: "用户确认的隔离修复" };
      const repaired = await repo.repairCanvasForUser(id, owner.user.id, input);
      assert.equal(repaired.revision, 8); assert.equal(repaired.result.duplicatesRemoved, 0);
      assert.deepEqual((await pool.query("select * from canvas_snapshots where project_id=$1 and version=7", [id])).rows, history);
      const archive = (await pool.query("select before_state from canvas_repair_archives where project_id=$1", [id])).rows[0].before_state;
      assert.equal(archive.nodes.length, 2); assert.deepEqual(archive.snapshots[0].nodes, nodes);
      assert.equal((await repo.getCanvasForUser(id, owner.user.id))!.nodes.length, 2);
      assert.equal((await repo.repairCanvasForUser(id, owner.user.id, input)).replayed, true);
      const restored = await repo.restoreCanvasSnapshot(id, owner.user.id, 7, 8);
      assert.equal(restored.revision, 9); assert.equal(restored.nodes[0].metadata.content, "保留两份正文");
      assert.equal((await repo.inspectCanvasForRepair(id, owner.user.id)).reasons.length, 0);
      const rollback = await repo.restoreCanvasRepairArchiveForUser(id, owner.user.id, { operationId: randomUUID(), expectedCanvasRevision: 9,
        archiveId: String(repaired.result.archiveId), reason: "用户确认向前回滚归档内容" });
      assert.equal(rollback.revision, 10); assert.equal((await repo.getCanvasForUser(id, owner.user.id))!.nodes.length, 2);
      assert.equal((await pool.query("select count(*)::int n from canvas_snapshots where project_id=$1", [id])).rows[0].n, 4);
    });
    await run("stale repair plan and malformed old graph cannot overwrite original rows", async () => {
      const { id } = await legacy(), plan = await repo.inspectCanvasForRepair(id, owner.user.id);
      await pool.query("update canvas_nodes set data=data||'{\"newField\":true}'::jsonb where project_id=$1", [id]);
      await assert.rejects(repo.repairCanvasForUser(id, owner.user.id, { operationId: randomUUID(), expectedCanvasRevision: 0, expectedStateHash: plan.hash, reason: "stale" }), { code: "CANVAS_REPAIR_PLAN_STALE" });
      await pool.query("update canvas_nodes set position='null'::jsonb where project_id=$1", [id]);
      const fresh = await repo.inspectCanvasForRepair(id, owner.user.id), before = await state(id);
      await assert.rejects(repo.repairCanvasForUser(id, owner.user.id, { operationId: randomUUID(), expectedCanvasRevision: 0, expectedStateHash: fresh.hash, reason: "malformed" }));
      assert.deepEqual(await state(id), before);
    });
    await run("repair archive insert failure rolls back initialization and revision jump", async () => {
      const { id } = await legacy(), plan = await repo.inspectCanvasForRepair(id, owner.user.id), before = await state(id);
      await pool.query("create trigger s03_fault before insert on canvas_repair_archives for each row execute function s03_fail_insert()");
      try { await assert.rejects(repo.repairCanvasForUser(id, owner.user.id, { operationId: randomUUID(), expectedCanvasRevision: 0, expectedStateHash: plan.hash, reason: "fault" })); assert.deepEqual(await state(id), before); }
      finally { await pool.query("drop trigger s03_fault on canvas_repair_archives"); }
    });
    await run("legacy material links retain their roles through repair and forward rollback", async () => {
      const { id, nodes } = await legacy(), assetId = randomUUID(), versionId = randomUUID();
      await pool.query("insert into assets(id,project_id,kind,name,created_by) values ($1,$2,'image','旧图片',$3)", [assetId, id, owner.user.id]);
      await pool.query("insert into asset_versions(id,asset_id,version,storage_key,mime_type,bytes,sha256,source,created_by) values ($1,$2,1,$3,'image/png',16,$4,'upload',$5)", [versionId, assetId, `projects/${id}/legacy.png`, "c".repeat(64), owner.user.id]);
      await pool.query("insert into asset_links(project_id,asset_version_id,node_id,role) values ($1,$2,$3,'first_frame')", [id, versionId, nodes[0].id]);
      const plan = await repo.inspectCanvasForRepair(id, owner.user.id);
      const result = await repo.repairCanvasForUser(id, owner.user.id, { operationId: randomUUID(), expectedCanvasRevision: 0, expectedStateHash: plan.hash, reason: "保留旧引用" });
      assert.equal((await pool.query("select count(*)::int n from asset_links where project_id=$1 and role='first_frame' and asset_version_id=$2", [id, versionId])).rows[0].n, 1);
      await repo.restoreCanvasRepairArchiveForUser(id, owner.user.id, { operationId: randomUUID(), expectedCanvasRevision: 8, archiveId: String(result.result.archiveId), reason: "向前回滚" });
      assert.equal((await pool.query("select count(*)::int n from asset_links where project_id=$1 and role='first_frame' and asset_version_id=$2", [id, versionId])).rows[0].n, 1);
    });
    await run("real CLI read-only plan, confirmed isolated apply, replay and forward rollback", async () => {
      const { id } = await legacy(), before = await state(id);
      const loader = pathToFileURL(resolve(import.meta.dirname, "../node_modules/tsx/dist/loader.mjs")).href;
      const invoke = async (args: string[]) => JSON.parse((await promisify(execFile)(process.execPath,
        ["--import", loader, resolve(import.meta.dirname, "../scripts/canvas-repair.ts"), "--database-url-env", "S03_TEST_DATABASE_URL", ...args],
        { env: { PATH: process.env.PATH!, SystemRoot: process.env.SystemRoot!, TEMP: process.env.TEMP!, TMP: process.env.TMP!, S03_TEST_DATABASE_URL: url!, SHOUSHOU_MCP_USER_ID: owner.user.id }, windowsHide: true })).stdout);
      const filename = resolve(artifacts!, `repair-plan-${randomUUID()}.json`);
      await invoke(["--project-id", id, "--output", filename]);
      assert.deepEqual(await state(id), before);
      const plan = JSON.parse(await readFile(filename, "utf8")); plan.reason = "隔离操作者确认修复";
      await writeFile(filename, JSON.stringify(plan));
      const repaired = await invoke(["--apply", filename]); assert.equal(repaired.revision, 8);
      assert.equal((await invoke(["--apply", filename])).replayed, true);
      const rollback = resolve(artifacts!, `rollback-plan-${randomUUID()}.json`);
      await invoke(["--project-id", id, "--archive-id", repaired.result.archiveId, "--output", rollback]);
      const rollbackPlan = JSON.parse(await readFile(rollback, "utf8")); rollbackPlan.reason = "隔离操作者确认向前回滚";
      await writeFile(rollback, JSON.stringify(rollbackPlan));
      assert.equal((await invoke(["--apply", rollback])).revision, 9);
    });
    await run("CLI sanitizes setup errors and rejects non-isolated apply before connecting", async () => {
      const loader = pathToFileURL(resolve(import.meta.dirname, "../node_modules/tsx/dist/loader.mjs")).href;
      const marker = "synthetic-sensitive-value";
      for (const [connection, expected] of [[marker, "ERR_INVALID_URL"], [`postgres://test:${marker}@127.0.0.1:1/not_the_test_db`, "CANVAS_REPAIR_LOCAL_ONLY"]]) {
        try {
          await promisify(execFile)(process.execPath, ["--import", loader, resolve(import.meta.dirname, "../scripts/canvas-repair.ts"), "--database-url-env", "S03_BAD_DATABASE_URL", "--apply", "no-such-plan.json"],
            { env: { PATH: process.env.PATH!, SystemRoot: process.env.SystemRoot!, TEMP: process.env.TEMP!, TMP: process.env.TMP!, S03_BAD_DATABASE_URL: connection }, windowsHide: true });
          assert.fail("unsafe setup unexpectedly succeeded");
        } catch (error: any) {
          assert.equal(error.code, 1);
          assert.ok(String(error.stderr).includes(expected));
          assert.ok(!String(error.stderr).includes(marker));
        }
      }
    });
    await run("incremental 0045 migration preserves an existing 0044 database byte values", async () => {
      const name = `s03_upgrade_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      await pool.query(`create database ${name}`);
      const upgradeUrl = new URL(url!); upgradeUrl.pathname = `/${name}`;
      const upgrade = new Pool({ connectionString: upgradeUrl.href });
      const upgradeDatabase = createDatabase(upgradeUrl.href);
      const stage = resolve(artifacts!, "pre-0045-migrations"); await mkdir(stage, { recursive: true });
      try {
        for (const file of (await readdir(migrations)).filter(f => /^\d+.*\.sql$/.test(f) && f < "0045")) await copyFile(resolve(migrations, file), resolve(stage, file));
        await applyMigrations(upgrade, stage);
        const legacyOwner = await new PostgresPlatformRepository(upgradeDatabase.db).createUserWithWorkspace(`s03-upgrade-${randomUUID()}@example.test`, "unusable-test-hash");
        const id = legacyOwner.workspace.projectId;
        await upgrade.query("insert into canvas_nodes(id,project_id,node_type,label,position,data) values ('old',$1,'scene','旧节点','{\"x\":0,\"y\":0}','{\"description\":\"必须保留\"}')", [id]);
        await upgrade.query("insert into canvas_snapshots(project_id,version,nodes,edges) values ($1,7,'[{\"id\":\"old\",\"data\":{\"description\":\"必须保留\"}}]','[]')", [id]);
        const existing = async () => Promise.all(["canvases", "canvas_nodes", "canvas_snapshots"].map(table => upgrade.query(`select to_jsonb(t) as data from ${table} t where project_id=$1`, [id]).then(result => result.rows)));
        const before = await existing();
        await applyMigrations(upgrade, migrations); await applyMigrations(upgrade, migrations);
        assert.deepEqual(await existing(), before);
        assert.equal((await upgrade.query("select count(*)::int n from canvas_operations")).rows[0].n, 0);
      } finally { await upgradeDatabase.pool.end(); await upgrade.end(); }
    });

    await run("real stdio v2 schemas, structured conflict, legacy gate and maintenance reads", async () => {
      const require = createRequire(process.env.S03_MCP_SOURCE_PACKAGE!);
      const { Client } = require("@modelcontextprotocol/sdk/client/index.js"), { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
      const policy = require(resolve(artifacts!, "mcp-write-policy.cjs"));
      assert.throws(() => policy.assertLegacyPreviewDisabled("vibe-preview")); policy.assertLegacyPreviewDisabled("other-model");
      const id = await project();
      const connect = async (mode: string, extraEnv: Record<string, string> = {}) => {
        const client = new Client({ name: "s03-isolated", version: "1.0.0" });
        const transport = new StdioClientTransport({ command: process.execPath, args: [resolve(artifacts!, "mcp-v2.cjs")], cwd: artifacts!, stderr: "pipe", env: {
          PATH: process.env.PATH!, SystemRoot: process.env.SystemRoot!, TEMP: process.env.TEMP!, TMP: process.env.TMP!, NODE_ENV: "test", DATABASE_URL: url!,
          SHOUSHOU_MCP_USER_ID: owner.user.id, SHOUSHOU_MCP_CANVAS_WRITE_PROTOCOL: mode,
          ...extraEnv,
        } });
        await client.connect(transport); return client;
      };
      let puts = 0;
      const storage = createServer(async (req, res) => {
        if (req.method === "PUT") { for await (const _chunk of req) { /* consume upload, never log signed headers */ } puts++; }
        res.writeHead(200, { ETag: '"s03-etag"' }); res.end();
      });
      storage.listen(0, "127.0.0.1"); await once(storage, "listening");
      const client = await connect("v2", { S3_ENDPOINT: `http://127.0.0.1:${(storage.address() as { port: number }).port}`, S3_BUCKET: "s03-test",
        S3_ACCESS_KEY: "s03-synthetic", S3_SECRET_KEY: "s03-synthetic", SHOUSHOU_MCP_IMPORT_ROOTS: artifacts! });
      try {
        const tools = (await client.listTools()).tools;
        assert.equal(tools.length, 13);
        for (const name of ["create_vibe_storyboard_v2", "import_rendered_video_v2"]) {
          const schema = tools.find((tool: any) => tool.name === name).inputSchema;
          assert.ok(schema.required.includes("operationId")); assert.ok(schema.required.includes("expectedCanvasRevision"));
        }
        const input = { projectId: id, ...request() }, result = await client.callTool({ name: "create_vibe_storyboard_v2", arguments: input });
        assert.ok(!result.isError, JSON.stringify(result)); assert.equal(result.structuredContent.revision, 1); assert.equal(result.structuredContent.persisted, true);
        const replay = await client.callTool({ name: "create_vibe_storyboard_v2", arguments: input });
        assert.equal(replay.structuredContent.replayed, true); assert.deepEqual(replay.structuredContent.nodeIds, result.structuredContent.nodeIds);
        const conflict = await client.callTool({ name: "create_vibe_storyboard_v2", arguments: { projectId: id, ...request() } });
        assert.equal(conflict.structuredContent.code, "CANVAS_REVISION_CONFLICT"); assert.equal(conflict.structuredContent.details.currentRevision, 1);
        const before = await state(id);
        for (const [name, args] of [
          ["create_vibe_storyboard", { projectId: id, title: "old", summary: "old", aspectRatio: "9:16", scenes: request().scenes }],
          ["queue_vibe_preview", { projectId: id, storyboardId: result.structuredContent.storyboardId }],
          ["import_rendered_video", { projectId: id, storyboardId: result.structuredContent.storyboardId, filePath: "H:/no-file.mp4", title: "old" }],
        ] as const) assert.equal((await client.callTool({ name, arguments: args })).structuredContent.code, "LEGACY_CANVAS_WRITE_DISABLED");
        assert.deepEqual(await state(id), before);
        const filePath = resolve(artifacts!, `synthetic-${randomUUID()}.mp4`);
        await writeFile(filePath, Buffer.from("0000ftypmp42synthetic"));
        const inputVideo = { projectId: id, operationId: randomUUID(), expectedCanvasRevision: 1, storyboardId: result.structuredContent.storyboardId, title: "stdio成片", filePath };
        const imported = await client.callTool({ name: "import_rendered_video_v2", arguments: inputVideo });
        assert.ok(!imported.isError, JSON.stringify(imported)); assert.equal(imported.structuredContent.revision, 2);
        assert.equal((await client.callTool({ name: "import_rendered_video_v2", arguments: inputVideo })).structuredContent.replayed, true);
        assert.equal(puts, 1); assert.equal((await state(id)).counts.asset_links, 1);
        const status = await client.callTool({ name: "get_vibe_status", arguments: { projectId: id, storyboardId: result.structuredContent.storyboardId } });
        assert.equal(status.structuredContent.nodes.length, 3);
        const peer = await connect("v2");
        try {
          const competing = await Promise.all([client, peer].map(endpoint => endpoint.callTool({ name: "create_vibe_storyboard_v2", arguments: { projectId: id, ...request(2) } })));
          assert.equal(competing.filter(reply => !reply.isError).length, 1);
          assert.equal(competing.find(reply => reply.isError).structuredContent.code, "CANVAS_REVISION_CONFLICT");
          const same = { projectId: id, ...request(3) };
          const retries = await Promise.all([client, peer].map(endpoint => endpoint.callTool({ name: "create_vibe_storyboard_v2", arguments: same })));
          assert.ok(retries.every(reply => !reply.isError));
          assert.equal(Number(retries[0].structuredContent.replayed) + Number(retries[1].structuredContent.replayed), 1);
          assert.deepEqual(retries[0].structuredContent.nodeIds, retries[1].structuredContent.nodeIds);
        } finally { await peer.close(); }
      } finally { await client.close(); storage.closeAllConnections(); await new Promise<void>(r => storage.close(() => r())); }
      const readOnly = await connect("read-only");
      try {
        assert.ok(!(await readOnly.callTool({ name: "get_project_context", arguments: { projectId: id } })).isError);
        const blocked = await readOnly.callTool({ name: "create_vibe_storyboard_v2", arguments: { projectId: id, ...request(1) } });
        assert.equal(blocked.structuredContent.code, "MCP_WRITES_DISABLED");
        const missing = await readOnly.callTool({ name: "get_canvas_operation_receipt", arguments: { projectId: id, operationId: randomUUID() } });
        assert.equal(missing.structuredContent.code, "CANVAS_OPERATION_NOT_FOUND");
      } finally { await readOnly.close(); }
    });
    await writeFile(resolve(artifacts!, "business-results.json"), JSON.stringify({ passed: checks, failures, aborted: t.signal.aborted }, null, 2));
  } finally { await pool.end(); }
});
