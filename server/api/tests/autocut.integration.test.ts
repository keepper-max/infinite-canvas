import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../src/db/client.js";
import { applyMigrations } from "../src/db/migrate.js";
import { AutoCutService } from "../src/autocut/service.js";
import { ManagedAutoCutModel } from "../src/autocut/model.js";
import { fixture } from "./fixtures/autocut.js";
import { JobService } from "../src/job-service.js";
import { CreditService } from "../src/credit-service.js";
import { BillingService } from "../src/billing-service.js";
import { readConfig } from "../src/config.js";
import { recoverAutoCutTasks } from "../src/autocut/maintenance.js";
import { AutoCutExecutor } from "../src/autocut/executor.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
test(
  "AutoCut PostgreSQL: ownership, persistence, version conflicts, concurrency, retries and budget gate",
  { skip: !databaseUrl },
  async () => {
    const { pool } = createDatabase(databaseUrl!);
    try {
      await applyMigrations(pool);
      const actor = randomUUID(),
        other = randomUUID(),
        workspace = randomUUID();
      await pool.query(
        "insert into users(id,email,is_admin) values($1,$2,true),($3,$4,false)",
        [
          actor,
          `autocut-${actor}@example.test`,
          other,
          `autocut-${other}@example.test`,
        ],
      );
      await pool.query(
        "insert into projects(id,owner_id,name) values($1,$2,'AutoCut test')",
        [workspace, actor],
      );
      await pool.query(
        "insert into project_members(project_id,user_id,role) values($1,$2,'owner'),($1,$3,'editor')",
        [workspace, actor, other],
      );
      const { asset, info, t } = fixture();
      await pool.query(
        "insert into assets(id,project_id,kind,name,created_by) values($1,$2,'video','input.mp4',$3)",
        [asset.assetId, workspace, actor],
      );
      await pool.query(
        "insert into asset_versions(id,asset_id,version,storage_key,mime_type,bytes,sha256,source,created_by) values($1,$2,1,$3,'video/mp4',1,$4,'upload',$5)",
        [
          asset.id,
          asset.assetId,
          `test-source-${asset.id}`,
          "0".repeat(64),
          actor,
        ],
      );
      const queue = {
        add: async (_: string) => undefined,
        remove: async (_: string) => true,
      };
      const service = new AutoCutService(pool, queue, true);
      const project = await service.create(workspace, actor, {
        name: "自动剪辑",
        assetVersionIds: [asset.id],
      });
      await assert.rejects(
        service.start(project.id, actor, {
          operationId: randomUUID(),
          expectedRevision: null,
          kind: "edit",
          scope: "subtitles",
          mode: "auto",
          prompt: "只改字幕",
          targetDurationMs: 3000,
          aspectRatio: "16:9",
          budgetCents: 100,
          confirmed: true,
        }),
        /先生成/,
      );
      assert.equal(
        (
          await pool.query(
            "select count(*)::int n from autocut_tasks where project_id=$1",
            [project.id],
          )
        ).rows[0].n,
        0,
      );
      await assert.rejects(service.get(project.id, other), /不存在或无权/);
      await assert.rejects(
        service.create(workspace, actor, {
          name: "错误引用",
          assetVersionIds: [randomUUID()],
        }),
        /素材不可用/,
      );
      await pool.query(
        "insert into autocut_analyses(asset_version_id,analyzer_version,document) values($1,'test-v1',$2)",
        [asset.id, info],
      );
      t.project_id = project.id;
      const saved = await service.save(project.id, actor, null, t);
      assert.notEqual(saved.revision_id, t.revision_id);
      assert.equal(
        (await service.get(project.id, actor)).timeline.revision_id,
        saved.revision_id,
      );
      await assert.rejects(
        service.save(project.id, actor, null, t),
        /刷新后重试/,
      );
      const input = {
        operationId: randomUUID(),
        expectedRevision: saved.revision_id,
        kind: "render",
        mode: "auto",
        prompt: "",
        targetDurationMs: 3000,
        aspectRatio: "16:9",
        budgetCents: 0,
        confirmed: true,
      };
      await assert.rejects(service.start(project.id, actor, { ...input, operationId: randomUUID(), budgetCents: 1001 }), /预算最高/);
      const spare = await Promise.all([0,1,2].map(n => service.create(workspace, actor, {name:`admission-${n}`,assetVersionIds:[asset.id]})));
      const submit = { ...input, expectedRevision:null, kind:"edit" };
      const results = await Promise.allSettled(spare.map(p => service.start(p.id, actor, {...submit,operationId:randomUUID()})));
      assert.equal(results.filter(r => r.status==="fulfilled").length,2);
      assert.equal(results.filter(r => r.status==="rejected").length,1);
      const queued = results.flatMap(r => r.status==="fulfilled"?[r.value]:[]);
      const first = queued[0];
      assert.equal((await service.start(first.project_id,actor,{...submit,operationId:first.operation_id})).id,first.id);
      const priorSetting = (await pool.query("select value from platform_settings where key='autocut_admission'")).rows[0];
      try {
        await pool.query("insert into platform_settings(key,value) values('autocut_admission',$1) on conflict(key) do update set value=excluded.value",[{accepting:false}]);
        assert.equal(await service.acceptingTasks(),false);
        for (const q of queued) await service.cancel(q.project_id,q.id,actor);
        await assert.rejects(service.retry(first.project_id,first.id,actor),/暂停接收/);
        await assert.rejects(service.start(project.id,actor,{...input,operationId:randomUUID()}),/暂停接收/);
      } finally {
        await pool.query("insert into platform_settings(key,value) values('autocut_admission',$1) on conflict(key) do update set value=excluded.value",[priorSetting?.value || {accepting:true}]);
      }
      const load = [];
      for (let n=0;n<20;n++) {
        const p=await service.create(workspace,other,{name:`queue-load-${n}`,assetVersionIds:[asset.id]});
        const q=(await pool.query("insert into autocut_tasks(project_id,actor_id,operation_id,fingerprint,input,budget_cents) values($1,$2,$3,'fixture','{}',0) returning id",[p.id,other,randomUUID()])).rows[0];
        load.push({project:p.id,id:q.id});
      }
      await assert.rejects(service.start(project.id,actor,{...input,operationId:randomUUID()}),/待处理任务/);
      for (const q of load) await service.cancel(q.project,q.id,other);
      const task = await service.start(project.id, actor, input);
      assert.equal(task.input.plannerVersion, 3);
      assert.equal((await service.start(project.id, actor, input)).id, task.id);
      await assert.rejects(
        service.start(project.id, actor, { ...input, prompt: "changed" }),
        /操作编号/,
      );
      await assert.rejects(
        service.start(project.id, actor, {
          ...input,
          operationId: randomUUID(),
        }),
        /运行中的任务/,
      );
      await assert.rejects(
        service.save(project.id, actor, saved.revision_id, saved),
        /先停止/,
      );
      await service.cancel(project.id, task.id, actor);
      assert.equal(
        (await service.get(project.id, actor)).tasks[0].status,
        "cancelled",
      );
      await service.retry(project.id, task.id, actor);
      await pool.query(
        "update autocut_tasks set status='running' where id=$1",
        [task.id],
      );
      let called = false;
      const model = new ManagedAutoCutModel(
        pool,
        {
          create: async () => {
            called = true;
          },
        } as any,
        {
          modelId: "test",
          quoteCents: 12,
          maxOutputTokens: 2000,
          analysisVersion: "test-v1",
        },
      );
      await assert.rejects(
        model.complete(
          task.id,
          "test-call",
          "test",
          [],
          AbortSignal.timeout(1000),
        ),
        /预算不足/,
      );
      assert.equal(called, false);
      assert.equal(
        (
          await pool.query(
            "select count(*)::int as n from autocut_model_calls where task_id=$1",
            [task.id],
          )
        ).rows[0].n,
        0,
      );
      const lock = await pool.connect();
      await lock.query("select pg_advisory_lock(hashtextextended($1,0))", [
        `autocut:${task.id}`,
      ]);
      await recoverAutoCutTasks(
        pool,
        `H:/CodexStorage/autocut/poc/nonexistent-${randomUUID()}`,
      );
      assert.equal(
        (
          await pool.query("select status from autocut_tasks where id=$1", [
            task.id,
          ])
        ).rows[0].status,
        "running",
      );
      await lock.query("select pg_advisory_unlock(hashtextextended($1,0))", [
        `autocut:${task.id}`,
      ]);
      lock.release();
      await recoverAutoCutTasks(
        pool,
        `H:/CodexStorage/autocut/poc/nonexistent-${randomUUID()}`,
      );
      assert.equal(
        (
          await pool.query("select status from autocut_tasks where id=$1", [
            task.id,
          ])
        ).rows[0].status,
        "failed",
      );
      await pool.query("update autocut_tasks set status='failed' where id=$1", [
        task.id,
      ]);
      const restored = await service.restore(
        project.id,
        actor,
        saved.revision_id,
        saved.revision_id,
      );
      assert.notEqual(restored.revision_id, saved.revision_id);
      const config = readConfig({
        DATABASE_URL: databaseUrl!,
        OBJECT_STORAGE_ENDPOINT: "http://unused.test",
        OBJECT_STORAGE_BUCKET: "test",
        OBJECT_STORAGE_ACCESS_KEY_ID: randomUUID(),
        OBJECT_STORAGE_SECRET_ACCESS_KEY: randomUUID(),
      });
      const credits = new CreditService(pool);
      await credits.grant(
        actor,
        actor,
        {
          credits: 100,
          source: "promotion",
          note: "Isolated reservation test",
          idempotencyKey: randomUUID(),
        },
        randomUUID(),
      );
      const jobs = new JobService(
        pool,
        { add: async () => {}, remove: async () => true },
        {
          compile: async (input: unknown) => ({
            ...(input as object),
            providerId: "token360",
            upstreamModel: "fixture-text",
            upstreamParameters: {},
          }),
        } as any,
        config.jobs,
        undefined,
        credits,
        new BillingService(pool, config.provider, credits),
      );
      const jobInput = {
        modelId: "fixture-text",
        capability: "text" as const,
        mode: "chat" as const,
        nodeRevision: 0,
        prompt: "reservation test, no model execution",
        parameters: {},
        references: [],
        idempotencyKey: randomUUID(),
        trace: { workflowKind: "autocut" },
      };
      const held = await jobs.create(
        workspace,
        actor,
        jobInput,
        undefined,
        undefined,
        undefined,
        25,
      );
      assert.equal(held.creditsReserved, "25");
      const legacy = await jobs.create(workspace, actor, {
        ...jobInput,
        trace: undefined,
        idempotencyKey: randomUUID(),
      });
      assert.equal(legacy.creditsReserved, "1");
      await assert.rejects(
        jobs.create(
          workspace,
          actor,
          { ...jobInput, idempotencyKey: randomUUID() },
          undefined,
          undefined,
          undefined,
          1000,
        ),
        /积分余额不足/,
      );
      const oldProtocol = await service.start(project.id, actor, {
        ...input,
        operationId: randomUUID(),
        expectedRevision: restored.revision_id,
        kind: "edit",
        budgetCents: 100,
      });
      await pool.query(
        "update autocut_tasks set input=jsonb_set(input,'{plannerVersion}','2'::jsonb) where id=$1",
        [oldProtocol.id],
      );
      let downloaded = false,
        invoked = false;
      const executor = new AutoCutExecutor(
        pool,
        service,
        {
          openDownload: async () => {
            downloaded = true;
            throw Error("must not download");
          },
        } as any,
        {
          complete: async () => {
            invoked = true;
            throw Error("must not charge");
          },
        },
        "unused",
        "test-v1",
        {} as any,
      );
      await executor.execute(oldProtocol.id);
      assert.equal(
        (
          await pool.query("select error_code from autocut_tasks where id=$1", [
            oldProtocol.id,
          ])
        ).rows[0].error_code,
        "AUTOCUT_PLANNER_VERSION_CHANGED",
      );
      assert.equal(downloaded, false);
      assert.equal(invoked, false);
      assert.equal(
        (
          await pool.query(
            "select count(*)::int n from autocut_model_calls where task_id=$1",
            [oldProtocol.id],
          )
        ).rows[0].n,
        0,
      );
      await service.archive(project.id, actor);
      assert.ok(
        !(await service.list(workspace, actor)).some(
          (p) => p.id === project.id,
        ),
      );
      assert.equal(
        (
          await pool.query(
            "select count(*)::int n from asset_links where metadata->>'autocutProjectId'=$1",
            [project.id],
          )
        ).rows[0].n,
        0,
      );
      await pool.query(
        "update project_members set role='viewer' where project_id=$1 and user_id=$2",
        [workspace, actor],
      );
      await assert.rejects(
        service.save(project.id, actor, restored.revision_id, restored),
        /查看权限/,
      );
      await pool.query("update projects set deleted_at=now() where id=$1", [
        workspace,
      ]);
      await assert.rejects(service.get(project.id, actor), /无权访问/);
    } finally {
      await pool.end();
    }
  },
);
