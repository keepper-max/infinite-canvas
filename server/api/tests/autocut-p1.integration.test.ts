import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID as uid } from "node:crypto";
import { createDatabase } from "../src/db/client.js";
import { applyMigrations } from "../src/db/migrate.js";
import { AutoCutService } from "../src/autocut/service.js";
import { upgradeTimeline } from "../src/autocut/p1/runtime.js";
import { fixture } from "./fixtures/autocut.js";

test(
  "P1 isolated PostgreSQL: feature gate, immutable ownership, CAS save, restore and task idempotency",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    assert.ok(
      ["127.0.0.1", "localhost"].includes(url.hostname) &&
        url.pathname === "/autocut_qa",
      "P1 DB tests only run against explicitly named local QA database",
    );
    const { pool } = createDatabase(url.toString()),
      oldFlag = process.env.AUTOCUT_P1_ENABLED;
    try {
      await applyMigrations(pool);
      const actor = uid(),
        other = uid(),
        workspace = uid();
      await pool.query(
        "insert into users(id,email,is_admin) values($1,$2,true),($3,$4,false)",
        [actor, `p1-${actor}@example.test`, other, `p1-${other}@example.test`],
      );
      await pool.query(
        "insert into projects(id,owner_id,name) values($1,$2,'P1 isolated QA')",
        [workspace, actor],
      );
      await pool.query(
        "insert into project_members(project_id,user_id,role) values($1,$2,'owner'),($1,$3,'editor')",
        [workspace, actor, other],
      );
      const f = fixture();
      await pool.query(
        "insert into assets(id,project_id,kind,name,created_by) values($1,$2,'video','synthetic-qa.mp4',$3)",
        [f.asset.assetId, workspace, actor],
      );
      await pool.query(
        "insert into asset_versions(id,asset_id,version,storage_key,mime_type,bytes,sha256,source,created_by) values($1,$2,1,$3,'video/mp4',1,$4,'upload',$5)",
        [
          f.asset.id,
          f.asset.assetId,
          `qa/${f.asset.id}`,
          "0".repeat(64),
          actor,
        ],
      );
      await pool.query(
        "insert into autocut_analyses(asset_version_id,analyzer_version,document) values($1,'p1-test',$2)",
        [f.asset.id, f.info],
      );
      let added = 0;
      const service = new AutoCutService(
          pool,
          {
            add: async () => {
              added++;
            },
            remove: async () => true,
          },
          true,
        ),
        p = await service.create(workspace, actor, {
          name: "P1 test",
          assetVersionIds: [f.asset.id],
        });
      f.t.project_id = p.id;
      const v1 = await service.save(p.id, actor, null, f.t),
        v2 = upgradeTimeline(v1, () => true);
      delete process.env.AUTOCUT_P1_ENABLED;
      await assert.rejects(
        service.saveP1(p.id, actor, v1.revision_id, v2),
        /未启用/,
      );
      process.env.AUTOCUT_P1_ENABLED = "true";
      await assert.rejects(
        service.saveP1(p.id, other, v1.revision_id, v2),
        /无权/,
      );
      const saved = await service.saveP1(p.id, actor, v1.revision_id, v2);
      assert.notEqual(saved.revision_id, v1.revision_id);
      await assert.rejects(
        service.saveP1(p.id, actor, v1.revision_id, v2),
        /刷新/,
      );
      await assert.rejects(
        service.addP1Assets(p.id, actor, saved.revision_id, [uid()]),
        /素材不可用/,
      );
      const input = {
        operationId: uid(),
        expectedRevision: saved.revision_id,
        kind: "render",
        prompt: "",
        mode: "custom",
        targetDurationMs: 2000,
        aspectRatio: "16:9",
        budgetCents: 0,
        confirmed: false,
        p1: { version: 1 },
      };
      const first = await service.start(p.id, actor, input),
        again = await service.start(p.id, actor, input);
      assert.equal(first.id, again.id);
      assert.equal(added, 1);
      await assert.rejects(
        service.start(p.id, actor, { ...input, prompt: "changed" }),
        /操作编号/,
      );
      await assert.rejects(
        service.saveP1(p.id, actor, saved.revision_id, saved),
        /停止当前任务/,
      );
      await service.cancel(p.id, first.id, actor);
      const restored = await service.restore(
        p.id,
        actor,
        saved.revision_id,
        v1.revision_id,
      );
      assert.equal(restored.schema_version, 1);
      const count = (
        await pool.query(
          "select count(*)::int n from autocut_revisions where project_id=$1",
          [p.id],
        )
      ).rows[0].n;
      assert.equal(count, 3);
      assert.equal(
        (
          await pool.query(
            "select count(*)::int n from autocut_model_calls c join autocut_tasks t on t.id=c.task_id where t.project_id=$1",
            [p.id],
          )
        ).rows[0].n,
        0,
      );
    } finally {
      if (oldFlag === undefined) delete process.env.AUTOCUT_P1_ENABLED;
      else process.env.AUTOCUT_P1_ENABLED = oldFlag;
      await pool.end();
    }
  },
);
