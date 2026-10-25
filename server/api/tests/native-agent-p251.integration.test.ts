import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createDatabase } from "../src/db/client.js";
import { PostgresPlatformRepository } from "../src/repository.js";
import { KnowledgeService } from "../src/knowledge-service.js";
import { ModelGateway } from "../src/model-gateway.js";
import { NativeAgentService } from "../src/native-agent/service.js";
import { CompatibleAgentModel } from "../src/native-agent/model.js";
import { startFixture } from "../scripts/native-agent-fixture.mjs";
const url = process.env.P251_TEST_DATABASE_URL;
test(
  "P251 durable full-plan approval, conflict and explicit budget recovery",
  { skip: !url, timeout: 180000 },
  async (t) => {
    assert.ok(["postgres://p25@127.0.0.1:55485/p251_isolated","postgres://p25@127.0.0.1:55485/r2_isolated"].includes(url!));
    process.env.NATIVE_AGENT_ENABLED = "true";
    process.env.NATIVE_AGENT_DEFAULT_ENABLED = "true";
    process.env.KNOWLEDGE_DEFAULT_ENABLED = "true";
    process.env.NATIVE_AGENT_FIXTURE_URL = "http://127.0.0.1:3299/v1";
    const fixture = startFixture(3299),
      { db, pool } = createDatabase(url!),
      repo = new PostgresPlatformRepository(db),
      knowledge = new KnowledgeService(db),
      gateway = new ModelGateway(pool),
      service = new NativeAgentService(
        knowledge,
        pool,
        new CompatibleAgentModel(gateway),
        async () => {},
      ),
      checks: string[] = [];
    const setup = async (
      prompt = "根据雾港世界观、林岚和周可创建第一集漫剧工作流",
    ) => {
      const owner = await repo.createUserWithWorkspace(
          "p251-" + randomUUID() + "@example.test",
          "synthetic",
        ),
        actor = owner.user.id,
        project = owner.workspace.projectId,
        space = await knowledge.createSpace(
          actor,
          "project",
          project,
          randomUUID(),
        );
      for (const [title, markdown] of [
        ["雾港世界观", "# 雾港\n海雾封锁港城"],
        ["林岚人物设定", "# 林岚\n调查员 [[雾港世界观]]"],
        ["周可人物设定", "# 周可\n维修师 [[林岚人物设定]]"],
      ])
        await knowledge.write(actor, space.id, {
          operationId: randomUUID(),
          action: "document.create",
          payload: { title, markdown, folderId: null },
        });
      const session = await service.createSession(actor, {
          projectId: project,
          title: "P251 test",
          mode: "execute",
          operationId: randomUUID(),
        }),
        run = await service.start(actor, session.id, {
          operationId: randomUUID(),
          prompt,
          mode: "execute",
          modelId: "native-agent-fixture",
          budgetCents: 0,
        });
      return {
        actor,
        project,
        space,
        session,
        run,
        snapshot: () => service.snapshot(actor, session.id),
      };
    };
    const approve = async (f: any) => {
      const s = await f.snapshot(),
        a = s.approvals.at(-1);
      assert.ok(a);
      const p = {
        operationId: randomUUID(),
        expectedRevision: a.revision,
        payloadHash: a.payload_hash,
        decision: "approve",
      };
      await Promise.all([
        service.decide(f.actor, a.id, p),
        service.decide(f.actor, a.id, p),
      ]);
      return a;
    };
    const check = async (name: string, fn: () => Promise<void>) =>
      t.test(name, async () => {
        await fn();
        checks.push(name);
      });
    try {
      await pool.query("insert into model_catalog(id,display_name,capability,upstream_model,provider_id,enabled,healthy,catalog_metadata) values('native-agent-fixture','隔离协议替身','text','fixture-tool-model','token360',true,true,'{}') on conflict(id) do update set enabled=true,healthy=true");
      await pool.query("insert into model_capabilities(model_id,modes,accepted_parameters,required_parameters_by_mode,limits,parameter_map) values('native-agent-fixture','[\"chat\"]','[]','{}','{}','{}') on conflict(model_id) do nothing");
      await check(
        "one prompt and one approval atomically persist complete 4 nodes/3 edges with no further model call",
        async () => {
          const f = await setup();
          await service.drive(f.run.id);
          const s: any = await f.snapshot();
          assert.equal(s.runs[0].status, "awaiting_approval");
          assert.equal(s.plans[0].expected_outputs.nodes.length, 4);
          assert.equal(s.plans[0].expected_outputs.edges.length, 3);
          assert.equal(
            (await repo.getCanvasForUser(f.project, f.actor))!.nodes.length,
            0,
          );
          const rounds = s.runs[0].rounds;
          await approve(f);
          await service.drive(f.run.id);
          await service.drive(f.run.id);
          const done: any = await f.snapshot(),
            c = await repo.getCanvasForUser(f.project, f.actor);
          assert.equal(done.runs[0].status, "completed");
          assert.equal(done.runs[0].rounds, rounds);
          assert.equal(done.approvals.length, 1);
          assert.equal(c!.nodes.length, 4);
          assert.equal(c!.edges.length, 3);
          assert.equal(c!.revision, 1);
          const originalDocs=await pool.query('select revision from knowledge_documents where space_id=$1',[f.space.id]);
          assert.equal(originalDocs.rowCount,3);assert.ok(originalDocs.rows.every(x=>x.revision===1));
          assert.ok(c!.nodes.filter(n=>n.type==='knowledge:document').every(n=>n.metadata?.knowledgeReference&&!n.metadata?.content));
          assert.equal(
            new Set(done.sources.map((x: any) => x.documentId)).size,
            3,
          );
        },
      );
      await check(
        "tampered persisted scope is rejected before any canvas write",
        async () => {
          const f = await setup();
          await service.drive(f.run.id);
          await approve(f);
          await pool.query(
            "update native_agent_plans set goal=goal||' tampered' where run_id=$1",
            [f.run.id],
          );
          await service.drive(f.run.id);
          const s: any = await f.snapshot();
          assert.equal(s.runs[0].status, "paused");
          assert.equal(s.runs[0].error_code, "AGENT_APPROVAL_MISMATCH");
          assert.equal(
            (await repo.getCanvasForUser(f.project, f.actor))!.revision,
            0,
          );
          await service.cancel(f.actor, f.run.id);
        },
      );
      await check(
        "concurrent Web save stops approved plan without overwriting and explicit continuation is idempotent",
        async () => {
          const f = await setup();
          await service.drive(f.run.id);
          await approve(f);
          const c: any = await repo.getCanvasForUser(f.project, f.actor);
          await repo.saveCanvasForUser(f.project, f.actor, {
            ...c,
            expectedRevision: c.revision,
            nodes: c.nodes,
            edges: c.edges,
            viewport: c.viewport,
            settings: c.settings,
          });
          await service.drive(f.run.id);
          const s: any = await f.snapshot(),
            r = s.runs[0];
          assert.equal(r.status, "paused");
          assert.equal(
            (await repo.getCanvasForUser(f.project, f.actor))!.revision,
            1,
          );
          assert.equal(
            (await repo.getCanvasForUser(f.project, f.actor))!.nodes.length,
            0,
          );
          const feature: any = await service.feature(f.actor),
            p = {
              operationId: randomUUID(),
              expectedRevision: r.revision,
              modelId: "native-agent-fixture",
              additionalBudgetCents: 0,
              limitsHash: feature.limitsHash,
            };
          await assert.rejects(
            service.resume(f.actor, r.id, { ...p, limitsHash: "0".repeat(64) }),
            { code: "AGENT_BUDGET_CHANGED" },
          );
          const result = await service.resume(f.actor, r.id, p);
          assert.deepEqual(await service.resume(f.actor, r.id, p), result);
          await assert.rejects(
            service.resume(f.actor, r.id, { ...p, additionalBudgetCents: 1 }),
            { code: "AGENT_OPERATION_MISMATCH" },
          );
          const after: any = await f.snapshot();
          assert.equal(after.runs[0].rounds, r.rounds);
          assert.equal(
            after.runs[0].budget_limits.rounds,
            r.budget_limits.rounds + feature.limits.rounds,
          );
          assert.equal(after.plans[0].status, "revised");
          await service.cancel(f.actor, r.id);
        },
      );
      await check(
        "budget exhaustion pauses without automatic expansion or repeated model calls",
        async () => {
          const f = await setup();
          await pool.query(
            "update native_agent_runs set budget_limits=jsonb_set(budget_limits,'{rounds}','1') where id=$1",
            [f.run.id],
          );
          await service.drive(f.run.id);
          const s: any = await f.snapshot();
          assert.equal(s.runs[0].status, "paused");
          assert.equal(s.runs[0].rounds, 1);
          await service.drive(f.run.id);
          assert.equal(((await f.snapshot()) as any).runs[0].rounds, 1);
          assert.equal(
            (await repo.getCanvasForUser(f.project, f.actor))!.revision,
            0,
          );
          await service.cancel(f.actor, f.run.id);
        },
      );
      await check(
        "permission revocation after approval cannot create any node",
        async () => {
          const f = await setup();
          await service.drive(f.run.id);
          await approve(f);
          await pool.query(
            "update users set account_status='disabled',disabled_at=now() where id=$1",
            [f.actor],
          );
          await service.drive(f.run.id);
          const c = await pool.query(
            "select revision from canvases where project_id=$1",
            [f.project],
          );
          assert.equal(c.rows[0].revision, 0);
          await pool.query(
            "update users set account_status='active',disabled_at=null where id=$1",
            [f.actor],
          );
          await service.cancel(f.actor, f.run.id);
        },
      );
      await check(
        "persisted step replay and canonical parameter deduplication preserve one business node",
        async () => {
          const f = await setup();
          await pool.query(
            "update native_agent_runs set status='running',phase='tools' where id=$1",
            [f.run.id],
          );
          const r = (
            await pool.query("select * from native_agent_runs where id=$1", [
              f.run.id,
            ])
          ).rows[0];
          const input = {
            type: "text",
            title: "dedupe",
            content: "body",
            position: { x: 5, y: 7 },
            expectedCanvasRevision: 0,
          };
          const first = {
            toolCallId: randomUUID(),
            stepId: randomUUID(),
            operationId: randomUUID(),
            toolName: "create_canvas_node",
            input,
          };
          const seed = async (c: any) =>
            pool.query(
              "insert into native_agent_steps(id,run_id,ordinal,kind,tool_name,tool_call_id,operation_id,status,input,input_hash) values($1,$2,(select coalesce(max(ordinal),0)+1 from native_agent_steps where run_id=$2),'tool',$3,$4,$5,'pending',$6::jsonb,'synthetic')",
              [
                c.stepId,
                f.run.id,
                c.toolName,
                c.toolCallId,
                c.operationId,
                JSON.stringify(c.input),
              ],
            );
          await seed(first);
          const plans = (service as any).plans;
          const initial = await plans.stage(r, [first]);
          const before = await plans.latest(r.id);
          assert.deepEqual(await plans.stage(r, [first]), initial);
          assert.equal((await plans.latest(r.id)).revision, before.revision);
          const second = {
            ...first,
            toolCallId: randomUUID(),
            stepId: randomUUID(),
            operationId: randomUUID(),
            input: {
              expectedCanvasRevision: 0,
              position: { y: 7, x: 5 },
              content: "body",
              title: "dedupe",
              type: "text",
            },
          };
          await seed(second);
          const duplicate = await plans.stage(r, [second]);
          assert.equal(
            duplicate[second.toolCallId].plannedNodeId,
            first.stepId,
          );
          assert.equal(
            (await plans.latest(r.id)).steps.filter((x: any) => !x.dedupeOf)
              .length,
            1,
          );
          await plans.reviewOrSeal(r);
          await plans.reviewOrSeal(r);
          await approve(f);
          await service.drive(r.id);
          const c = await repo.getCanvasForUser(f.project, f.actor);
          assert.equal(c!.nodes.length, 1);
          assert.equal(c!.nodes[0].id, first.stepId);
          assert.equal(c!.revision, 1);
        },
      );
      await check(
        "text-only plan cannot claim execution complete after one bounded internal review",
        async () => {
          const f = await setup("测试纯文本");
          await service.drive(f.run.id);
          const s: any = await f.snapshot();
          assert.equal(s.runs[0].status, "paused");
          assert.equal(s.runs[0].error_code, "AGENT_NO_EXECUTABLE_PLAN");
          assert.equal(s.runs[0].rounds, 2);
          assert.equal(s.approvals.length, 0);
          assert.equal(
            (await repo.getCanvasForUser(f.project, f.actor))!.revision,
            0,
          );
          await service.cancel(f.actor, f.run.id);
        },
      );
      await check(
        "invalid tool arguments retain actual metering and raw response for inspection without executing",
        async () => {
          const f = await setup("测试无效参数");
          await service.drive(f.run.id);
          const s: any = await f.snapshot();
          assert.equal(s.runs[0].status, "paused");
          assert.equal(s.runs[0].rounds, 1);
          assert.equal(s.runs[0].error_code, "AGENT_INVALID_TOOL_ARGUMENTS");
          assert.equal(s.usage.length, 1);
          assert.ok(s.runs[0].input_tokens > 0);
          const response = await pool.query(
            "select output from native_agent_steps where run_id=$1 and kind='model'",
            [f.run.id],
          );
          assert.equal(
            response.rows[0].output.calls[0].toolName,
            "search_knowledge",
          );
          assert.equal(
            (await repo.getCanvasForUser(f.project, f.actor))!.revision,
            0,
          );
          await service.cancel(f.actor, f.run.id);
        },
      );
      await writeFile(
        (process.env.AGENT_TEST_ARTIFACT_ROOT ?? "H:/CodexStorage/shoushou-p251")+"/artifacts/plan-integration.json",
        JSON.stringify(
          { checks, passed: checks.length, actualSupplier: false },
          null,
          2,
        ),
      );
    } finally {
      fixture.close();
      await pool.end();
    }
  },
);
