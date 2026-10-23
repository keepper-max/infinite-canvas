import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../src/db/client.js";
import { applyMigrations } from "../src/db/migrate.js";
import { PostgresPlatformRepository } from "../src/repository.js";
import { KnowledgeService } from "../src/knowledge-service.js";
import { assertKnowledgeGenerationEnabled, requireKnowledgeFeaturePg } from "../src/knowledge-feature.js";
import { JobExecutor } from "../src/job-service.js";

test("live release policy, incompatible history and missing media guards on PostgreSQL", { skip: !process.env.R1F_TEST_DATABASE_URL }, async t => {
    const url = new URL(process.env.R1F_TEST_DATABASE_URL!);
    assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "55451"); assert.equal(url.pathname, "/p2_isolated");
    const { db, pool } = createDatabase(url.href), repo = new PostgresPlatformRepository(db), knowledge = new KnowledgeService(db);
    const previous = process.env.KNOWLEDGE_DEFAULT_ENABLED;
    try {
        await t.test("production knowledge generation remains restricted before fees are accepted", () => {
            const nodeEnv = process.env.NODE_ENV, flag = process.env.KNOWLEDGE_GENERATION_ENABLED;
            try { process.env.NODE_ENV = "production"; delete process.env.KNOWLEDGE_GENERATION_ENABLED;
                assert.throws(() => assertKnowledgeGenerationEnabled([{}]), { code: "KNOWLEDGE_GENERATION_RESTRICTED" });
                assertKnowledgeGenerationEnabled([]);
                process.env.KNOWLEDGE_GENERATION_ENABLED = "true"; assertKnowledgeGenerationEnabled([{}]);
            } finally { if (nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = nodeEnv; if (flag === undefined) delete process.env.KNOWLEDGE_GENERATION_ENABLED; else process.env.KNOWLEDGE_GENERATION_ENABLED = flag; }
        });
        await applyMigrations(pool);
        const admin = await repo.createUserWithWorkspace(`live-admin-${randomUUID()}@example.test`, "synthetic");
        const user = await repo.createUserWithWorkspace(`live-user-${randomUUID()}@example.test`, "synthetic");
        await pool.query("update users set is_admin=true where id=$1", [admin.user.id]);
        await t.test("default off; all-account default on includes new users; explicit revocation and disabled accounts still deny", async () => {
            process.env.KNOWLEDGE_DEFAULT_ENABLED = "false";
            assert.equal((await knowledge.featureStatus(user.user.id)).enabled, false);
            process.env.KNOWLEDGE_DEFAULT_ENABLED = "true";
            assert.equal((await knowledge.featureStatus(user.user.id)).enabled, true);
            await requireKnowledgeFeaturePg(pool, user.user.id);
            await knowledge.featureGrant(admin.user.id, user.user.id, false, "isolated revocation");
            assert.equal((await knowledge.featureStatus(user.user.id)).enabled, false);
            await assert.rejects(requireKnowledgeFeaturePg(pool, user.user.id), { code: "KNOWLEDGE_NOT_ENABLED" });
            await knowledge.featureGrant(admin.user.id, user.user.id, true, "isolated enable");
            await pool.query("update users set account_status='disabled' where id=$1", [user.user.id]);
            assert.equal((await knowledge.featureStatus(user.user.id)).enabled, false);
            await assert.rejects(requireKnowledgeFeaturePg(pool, user.user.id), { code: "KNOWLEDGE_NOT_ENABLED" });
            await pool.query("update users set account_status='active' where id=$1", [user.user.id]);
            assert.equal(await repo.getCanvasForUser(admin.workspace.projectId, user.user.id), null);
        });
        await t.test("old snapshot is explicitly incompatible, immutable and denied; new snapshot restore is forward-only", async () => {
            const project = (await repo.createProjectForUser(user.user.id, { name: "isolated history" })).projectId;
            const nodes = ["a", "b"].map(id => ({ id, type: "scene", position: { x: 0, y: 0 }, data: { description: "original" } }));
            const edges = [{ id: "old", source: "a", target: "b", data: {}, label: "reference" }];
            await pool.query("insert into canvas_snapshots(project_id,version,nodes,edges) values($1,1,$2,$3)", [project, JSON.stringify(nodes), JSON.stringify(edges)]);
            const plan = await repo.inspectCanvasForRepair(project, user.user.id);
            await repo.repairCanvasForUser(project, user.user.id, { operationId: randomUUID(), expectedCanvasRevision: 0, expectedStateHash: plan.hash, reason: "isolated repair" });
            const snapshots = await repo.listCanvasSnapshots(project, user.user.id);
            assert.equal(snapshots!.find(s => s.version === 1)!.restorable, false);
            assert.equal(snapshots!.find(s => s.version === 1)!.restoreReason, "历史版本不兼容，暂不可恢复");
            assert.equal(snapshots!.find(s => s.version === 2)!.restorable, true);
            await assert.rejects(repo.restoreCanvasSnapshot(project, user.user.id, 1, 2), { code: "CANVAS_SNAPSHOT_INCOMPATIBLE" });
            assert.equal((await repo.getCanvasForUser(project, user.user.id))!.revision, 2);
            assert.equal((await repo.restoreCanvasSnapshot(project, user.user.id, 2, 2)).revision, 3);
            assert.deepEqual((await pool.query("select nodes,edges from canvas_snapshots where project_id=$1 and version=1", [project])).rows[0], { nodes, edges });
        });
        await t.test("missing referenced object fails Worker reference resolution before provider dispatch", async () => {
            const asset = randomUUID(), version = randomUUID();
            await pool.query("insert into assets(id,project_id,kind,name,created_by) values($1,$2,'video','missing',$3)", [asset, user.workspace.projectId, user.user.id]);
            await pool.query("insert into asset_versions(id,asset_id,version,storage_key,mime_type,bytes,sha256,source,created_by) values($1,$2,1,'missing/object.mp4','video/mp4',8,$3,'upload',$4)", [version, asset, "a".repeat(64), user.user.id]);
            let signs = 0;
            const resolver = (JobExecutor.prototype as any).resolveAssetReferences;
            await assert.rejects(resolver.call({ pool, storage: { stat: async () => null, createDownloadUrl: async () => { signs++; return "never"; } } }, { references: [{ assetVersionId: version }] }, user.workspace.projectId, "token360"), { code: "OBJECT_NOT_FOUND" });
            assert.equal(signs, 0);
        });
    } finally { if (previous === undefined) delete process.env.KNOWLEDGE_DEFAULT_ENABLED; else process.env.KNOWLEDGE_DEFAULT_ENABLED = previous; await pool.end(); }
});
