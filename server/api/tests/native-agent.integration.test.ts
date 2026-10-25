import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createDatabase } from "../src/db/client.js";
import { PostgresPlatformRepository } from "../src/repository.js";
import { KnowledgeService } from "../src/knowledge-service.js";
import { ModelGateway } from "../src/model-gateway.js";
import { NativeAgentService } from "../src/native-agent/service.js";
import { CompatibleAgentModel } from "../src/native-agent/model.js";
import { AgentCanvasService } from "../src/native-agent/canvas-service.js";
import { compactContext } from "../src/native-agent/context.js";
import { createApp } from "../src/app.js";
import { hashSessionToken } from "../src/auth.js";
import type { ApiConfig } from "../src/config.js";
import type { ToolCall } from "../src/native-agent/contracts.js";
import { startFixture } from "../scripts/native-agent-fixture.mjs";
const url = process.env.P25_TEST_DATABASE_URL;
test(
  "P25 real PostgreSQL business transactions and SDK protocol safety",
  { skip: !url, timeout: 180000 },
  async (t) => {
    assert.ok(["postgres://p25@127.0.0.1:55485/p25_isolated","postgres://p25@127.0.0.1:55485/p251_isolated","postgres://p25@127.0.0.1:55485/r2_isolated","postgres://p25@127.0.0.1:55485/r21_regression_isolated"].includes(url!));
    process.env.NATIVE_AGENT_ENABLED = "true";
    process.env.NATIVE_AGENT_DEFAULT_ENABLED = "true";
    process.env.KNOWLEDGE_DEFAULT_ENABLED = "true";
    process.env.NATIVE_AGENT_FIXTURE_URL = "http://127.0.0.1:3296/v1";
    const fixture = startFixture(3296),
      { db, pool } = createDatabase(url!),
      repo = new PostgresPlatformRepository(db),
      knowledge = new KnowledgeService(db),
      gateway = new ModelGateway(pool),
      driver = new CompatibleAgentModel(gateway),
      service = new NativeAgentService(knowledge, pool, driver, async () => {}),
      canvas = new AgentCanvasService(knowledge);
    const checks: string[] = [];
    const check = async (name: string, fn: () => Promise<unknown>) =>
      t.test(name, async () => {
        await fn();
        checks.push(name);
      });
    const owner = await repo.createUserWithWorkspace(
        `p25-${randomUUID()}@example.test`,
        "synthetic",
      ),
      actorId = owner.user.id,
      projectId = owner.workspace.projectId;
    const session = async (mode: "execute" | "advice" = "execute") =>
      service.createSession(actorId, {
        projectId,
        title: "协议和安全测试",
        mode,
        operationId: randomUUID(),
      });
    const newRun = async (
      prompt: string,
      mode: "execute" | "advice" = "execute",
    ) => {
      const s = await session(mode);
      const run = await service.start(actorId, s.id, {
        operationId: randomUUID(),
        prompt,
        modelId: "native-agent-fixture",
        mode,
        budgetCents: 0,
      });
      // These cases exercise pending P2.5 rows; new continuous plans have a dedicated suite.
      await pool.query("update native_agent_runs set plan_protocol=0,budget_limits=null where id=$1",[run.id]);
      return run;
    };
    const syntheticRun = async () => {
      const r = await newRun("事务测试");
      await pool.query(
        "update native_agent_runs set status='running',phase='tools' where id=$1",
        [r.id],
      );
      return { actorId, projectId, runId: r.id };
    };
    const call = (rev: number, content = "test"): ToolCall => ({
      toolCallId: randomUUID(),
      toolName: "create_canvas_node",
      input: {
        type: "text",
        title: "事务节点",
        content,
        position: { x: 1, y: 2 },
        expectedCanvasRevision: rev,
      },
      stepId: randomUUID(),
      operationId: randomUUID(),
    });
    const current = async () => {
      const c = await repo.getCanvasForUser(projectId, actorId);
      assert.ok(c);
      return c;
    };
    try {
      await pool.query("insert into model_catalog(id,display_name,capability,upstream_model,provider_id,enabled,healthy,catalog_metadata) values('native-agent-fixture','隔离协议替身','text','fixture-tool-model','token360',true,true,'{}') on conflict(id) do update set enabled=true,healthy=true");
      await pool.query("insert into model_capabilities(model_id,modes,accepted_parameters,required_parameters_by_mode,limits,parameter_map) values('native-agent-fixture','[\"chat\"]','[]','{}','{}','{}') on conflict(model_id) do nothing");
      await check(
        "default-off grants require existing admin policy, retain project isolation and produce audit",
        async () => {
          const other = await repo.createUserWithWorkspace(
            `p25-grant-${randomUUID()}@example.test`,
            "synthetic",
          );
          process.env.NATIVE_AGENT_DEFAULT_ENABLED = "false";
          try {
            await assert.rejects(service.feature(other.user.id), {
              code: "NATIVE_AGENT_NOT_ENABLED",
            });
            await assert.rejects(
              service.grant(actorId, other.user.id, true, "not admin"),
              { code: "ADMIN_FORBIDDEN" },
            );
            await pool.query("update users set is_admin=true where id=$1", [
              actorId,
            ]);
            await service.grant(actorId, other.user.id, true, "isolated allow");
            assert.equal((await service.feature(other.user.id)).enabled, true);
            await assert.rejects(service.sessions(other.user.id, projectId), {
              code: "PROJECT_FORBIDDEN",
            });
            await service.grant(
              actorId,
              other.user.id,
              false,
              "isolated revoke",
            );
            await assert.rejects(service.feature(other.user.id), {
              code: "NATIVE_AGENT_NOT_ENABLED",
            });
            const audits = await pool.query(
              "select count(*)::int n from admin_audit_logs where action='feature.native_agent.grant' and target_id=$1",
              [other.user.id],
            );
            assert.equal(audits.rows[0].n, 2);
            await knowledge.featureGrant(
              actorId,
              other.user.id,
              true,
              "knowledge original policy",
            );
          } finally {
            process.env.NATIVE_AGENT_DEFAULT_ENABLED = "true";
            await pool.query("update users set is_admin=false where id=$1", [
              actorId,
            ]);
          }
        },
      );
      await check(
        "session/run idempotency, mismatched payload and one-unfinished DB constraint",
        async () => {
          const op = randomUUID(),
            s = await service.createSession(actorId, {
              projectId,
              title: "同一会话",
              mode: "execute",
              operationId: op,
            });
          assert.equal(
            (
              await service.createSession(actorId, {
                projectId,
                title: "同一会话",
                mode: "execute",
                operationId: op,
              })
            ).id,
            s.id,
          );
          await assert.rejects(
            service.createSession(actorId, {
              projectId,
              title: "其他标题",
              mode: "execute",
              operationId: op,
            }),
            { code: "AGENT_OPERATION_MISMATCH" },
          );
          const p = {
            operationId: randomUUID(),
            prompt: "测试纯文本",
            modelId: "native-agent-fixture",
            mode: "execute",
            budgetCents: 0,
          };
          const results = await Promise.all([
            service.start(actorId, s.id, p),
            service.start(actorId, s.id, p),
          ]);
          assert.equal(results[0].id, results[1].id);
          await assert.rejects(
            service.start(actorId, s.id, { ...p, prompt: "new" }),
            { code: "AGENT_OPERATION_MISMATCH" },
          );
          await assert.rejects(newRun("second concurrent"), {
            code: "AGENT_RUN_ACTIVE",
          });
          await service.cancel(actorId, results[0].id);
        },
      );
      await check(
        "ordinary model JSON is never executed as a tool",
        async () => {
          const before = await current(),
            r = await newRun("测试纯文本");
          await service.drive(r.id);
          const after = await current();
          assert.equal(after.revision, before.revision);
          const snap = await service.snapshot(actorId, r.session_id);
          assert.equal(snap.runs[0].status, "completed");
          assert.equal(snap.steps.filter((x) => x.kind === "tool").length, 0);
          assert.match(snap.messages[1].content, /只是文本/);
        },
      );
      await check(
        "unknown tools and invalid arguments never enter business calls",
        async () => {
          for (const prompt of ["测试未知工具", "测试无效参数"]) {
            const r = await newRun(prompt),
              before = await current();
            await service.drive(r.id);
            const snap = await service.snapshot(actorId, r.session_id);
            assert.equal(snap.runs[0].status, "failed");
            assert.equal((await current()).revision, before.revision);
          }
        },
      );
      await check(
        "same CAS operation replay returns original persisted IDs, payload mismatch rejected",
        async () => {
          const actor = await syntheticRun(),
            c = await current(),
            op = randomUUID(),
            calls = [call(c.revision)];
          const first = await canvas.apply(actor, op, calls),
            again = await canvas.apply(actor, op, calls);
          assert.equal(first.revision, c.revision + 1);
          assert.equal(again.replayed, true);
          assert.deepEqual(first.nodeIds, again.nodeIds);
          await assert.rejects(
            canvas.apply(actor, op, [
              {
                ...calls[0],
                input: { ...(calls[0].input as object), content: "different" },
              },
            ]),
            { code: "CANVAS_OPERATION_MISMATCH" },
          );
          await service.cancel(actorId, actor.runId);
        },
      );
      await check(
        "two concurrent MCP-style Agent writes on one old revision commit exactly one",
        async () => {
          const actor = await syntheticRun(),
            c = await current();
          const results = await Promise.allSettled([
            canvas.apply(actor, randomUUID(), [call(c.revision, "a")]),
            canvas.apply(actor, randomUUID(), [call(c.revision, "b")]),
          ]);
          assert.equal(
            results.filter((r) => r.status === "fulfilled").length,
            1,
          );
          assert.equal(
            (
              results.find(
                (r) => r.status === "rejected",
              ) as PromiseRejectedResult
            ).reason.code,
            "CANVAS_REVISION_CONFLICT",
          );
          assert.equal((await current()).nodes.length, c.nodes.length + 1);
          await service.cancel(actorId, actor.runId);
        },
      );
      await check(
        "Web save versus Agent CAS cannot silently overwrite",
        async () => {
          const actor = await syntheticRun(),
            c = await current(),
            text = {
              id: randomUUID(),
              type: "text",
              title: "web",
              position: { x: 0, y: 0 },
              width: 300,
              height: 200,
              definitionId: "builtin.text",
              definitionVersion: 1,
              workflowKind: "text",
              locked: false,
              metadata: { content: "web" },
            };
          const results = await Promise.allSettled([
            repo.saveCanvasForUser(projectId, actorId, {
              ...c,
              nodes: [...c.nodes, text],
              expectedRevision: c.revision,
            }),
            canvas.apply(actor, randomUUID(), [call(c.revision)]),
          ]);
          assert.equal(
            results.filter((r) => r.status === "fulfilled").length,
            1,
          );
          assert.equal((await current()).revision, c.revision + 1);
          await service.cancel(actorId, actor.runId);
        },
      );
      await check(
        "atomic transaction rejects later invalid port and preserves whole prior graph",
        async () => {
          const actor = await syntheticRun(),
            c = await current(),
            create = call(c.revision),
            bad: ToolCall = {
              toolCallId: randomUUID(),
              toolName: "connect_canvas_nodes",
              operationId: randomUUID(),
              stepId: randomUUID(),
              input: {
                fromNodeId: create.stepId,
                toNodeId: c.nodes[0].id,
                sourcePortId: "knowledge.output",
                targetPortId: "text.input",
                expectedCanvasRevision: c.revision,
              },
            };
          await assert.rejects(
            canvas.apply(actor, randomUUID(), [create, bad]),
            { code: "AGENT_CANVAS_INVALID" },
          );
          const after = await current();
          assert.deepEqual(after.nodes, c.nodes);
          assert.equal(after.revision, c.revision);
          await service.cancel(actorId, actor.runId);
        },
      );
      await check(
        "DB fault at receipt insertion rolls back nodes, snapshots and revision",
        async () => {
          const actor = await syntheticRun(),
            c = await current(),
            op = randomUUID();
          await pool.query(
            `create function p25_fail_receipt() returns trigger language plpgsql as $$ begin if NEW.operation_id='${op}'::uuid then raise exception 'isolated injected rollback'; end if; return NEW; end $$`,
          );
          await pool.query(
            "create trigger p25_fail_receipt before insert on canvas_operations for each row execute function p25_fail_receipt()",
          );
          try {
            await assert.rejects(canvas.apply(actor, op, [call(c.revision)]));
            assert.equal((await current()).revision, c.revision);
            assert.deepEqual((await current()).nodes, c.nodes);
          } finally {
            await pool.query(
              "drop trigger p25_fail_receipt on canvas_operations",
            );
            await pool.query("drop function p25_fail_receipt()");
            await service.cancel(actorId, actor.runId);
          }
        },
      );
      await check(
        "cancelled run cannot write and preserves committed results",
        async () => {
          const actor = await syntheticRun(),
            c = await current();
          await service.cancel(actorId, actor.runId);
          await assert.rejects(
            canvas.apply(actor, randomUUID(), [call(c.revision)]),
            { code: "AGENT_WRITE_STOPPED" },
          );
          assert.equal((await current()).revision, c.revision);
        },
      );
      await check(
        "feature revocation, disabled user and removed project membership deny next tool transaction",
        async () => {
          const actor = await syntheticRun(),
            c = await current();
          await pool.query(
            "insert into user_feature_grants(user_id,feature,enabled,updated_by,reason) values($1,'native_agent',false,$1,'isolated revoke')",
            [actorId],
          );
          await assert.rejects(
            canvas.apply(actor, randomUUID(), [call(c.revision)]),
            { code: "NATIVE_AGENT_NOT_ENABLED" },
          );
          await pool.query(
            "update user_feature_grants set enabled=true where user_id=$1 and feature='native_agent'",
            [actorId],
          );
          await pool.query(
            "update users set account_status='disabled' where id=$1",
            [actorId],
          );
          await assert.rejects(
            canvas.apply(actor, randomUUID(), [call(c.revision)]),
            { code: "UNAUTHENTICATED" },
          );
          await pool.query(
            "update users set account_status='active' where id=$1",
            [actorId],
          );
          await pool.query(
            "update project_members set role='viewer' where project_id=$1 and user_id=$2",
            [projectId, actorId],
          );
          try {
            await assert.rejects(
              canvas.apply(actor, randomUUID(), [call(c.revision)]),
              { code: "PROJECT_READ_ONLY" },
            );
          } finally {
            await pool.query(
              "update project_members set role='owner' where project_id=$1 and user_id=$2",
              [projectId, actorId],
            );
            await service.cancel(actorId, actor.runId);
          }
        },
      );
      await check(
        "worker recovery with a model in submitting state does not resubmit",
        async () => {
          const r = await newRun("uncertain model"),
            step = randomUUID();
          await pool.query(
            "insert into native_agent_steps(id,run_id,ordinal,kind,operation_id,status,input_hash) values($1,$2,1,'model',$1,'submitting','synthetic')",
            [step, r.id],
          );
          await service.drive(r.id);
          const snap = await service.snapshot(actorId, r.session_id);
          assert.equal(snap.runs[0].status, "awaiting_manual_review");
          assert.equal(snap.runs[0].rounds, 0);
          await service.cancel(actorId, r.id);
        },
      );
      await check(
        "loop and large-context budgets halt without changing canvas",
        async () => {
          assert.throws(
            () =>
              compactContext([
                { role: "user", content: "超长文档".repeat(4000) },
              ]),
            { code: "AGENT_CONTEXT_LIMIT" },
          );
          const r = await newRun("测试无限循环");
          await pool.query(
            "update native_agent_runs set rounds=16 where id=$1",
            [r.id],
          );
          await service.drive(r.id);
          const snap = await service.snapshot(actorId, r.session_id);
          assert.equal(snap.runs[0].status, "failed");
          assert.equal(snap.runs[0].error_code, "AGENT_RUN_LIMIT");
        },
      );
      await check(
        "paid routes and browser keys are never enabled by arbitrary model IDs",
        async () => {
          await assert.rejects(
            driver.run(
              "fake-paid-model",
              [{ role: "user", content: "test" }],
              new AbortController().signal,
              async () => {},
            ),
            { code: "AGENT_PAID_ROUTE_UNAVAILABLE" },
          );
          const token = randomUUID();
          await repo.createSession(
            actorId,
            hashSessionToken(token),
            new Date(Date.now() + 60000),
          );
          const app = createApp(
            repo,
            {
              cookieName: "p25",
              cookieSecure: false,
              trustedOrigins: [],
            } as unknown as ApiConfig,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            knowledge,
            undefined,
            service,
          );
          const r = await app.request("/api/native-agent/status", {
            headers: { cookie: "p25=" + token },
          });
          assert.equal(r.status, 200);
          assert.ok(!JSON.stringify(await r.json()).includes("apiKey"));
        },
      );
      await check(
        "actual model context overrun preserves usage and stops before any tool",
        async () => {
          const r = await newRun("实际用量超限");
          const before = await current();
          const overrun = new NativeAgentService(
            knowledge,
            pool,
            {
              models: () => driver.models(),
              run: async () => ({
                text: "",
                messages: [],
                calls: [
                  {
                    toolCallId: randomUUID(),
                    toolName: "get_canvas_state",
                    input: {},
                  },
                ],
                inputTokens: 12001,
                outputTokens: 1,
                meterStatus: "substitute",
              }),
            },
            async () => undefined,
          );
          await overrun.drive(r.id);
          const snapshot = await overrun.snapshot(actorId, r.session_id);
          assert.equal(snapshot.runs[0].error_code, "AGENT_CONTEXT_LIMIT");
          assert.equal(Number(snapshot.runs[0].input_tokens), 12001);
          assert.equal(
            snapshot.steps.filter(
              (s) => s.kind === "tool" && s.status === "completed",
            ).length,
            0,
          );
          assert.equal((await current()).revision, before.revision);
          assert.equal(
            (
              await pool.query(
                "select count(*)::int n from native_agent_usage where run_id=$1",
                [r.id],
              )
            ).rows[0].n,
            1,
          );
        },
      );
      await check(
        "approval hash protection, replay, revision and cancellation retain original decisions",
        async () => {
          for (const decision of ["approve", "revise", "cancel"] as const) {
            const r = await newRun("审批状态验证");
            await pool.query(
              "update native_agent_runs set status='awaiting_approval',active_started_at=null where id=$1",
              [r.id],
            );
            const id = randomUUID();
            await pool.query(
              "insert into native_agent_approvals(id,run_id,actor_id,payload_hash,calls,preview) values($1,$2,$3,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','[]','[]')",
              [id, r.id, actorId],
            );
            const input = {
              operationId: randomUUID(),
              expectedRevision: 1,
              payloadHash:
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              decision,
              ...(decision === "revise"
                ? { instruction: "先只分析，不写入" }
                : {}),
            };
            await assert.rejects(
              service.decide(actorId, id, {
                ...input,
                payloadHash:
                  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              }),
              { code: "AGENT_APPROVAL_STALE" },
            );
            const first = await service.decide(actorId, id, input);
            assert.deepEqual(await service.decide(actorId, id, input), first);
            await assert.rejects(
              service.decide(actorId, id, {
                ...input,
                operationId: randomUUID(),
              }),
              { code: "AGENT_OPERATION_MISMATCH" },
            );
            await service.cancel(actorId, r.id);
          }
        },
      );
      await check(
        "approved knowledge relation uses Markdown CAS and operation receipt without altering existing text",
        async () => {
          const actor = await syntheticRun();
          const space = await knowledge.createSpace(
            actorId,
            "project",
            projectId,
            randomUUID(),
          );
          const create = async (title: string, markdown: string) =>
            knowledge.write(actorId, space.id, {
              operationId: randomUUID(),
              action: "document.create",
              payload: { title, markdown, folderId: null },
            }) as Promise<any>;
          const source = await create(
            "Agent关联来源",
            "# 原始标题\n\n保留正文 `[[不是引用]]`。",
          );
          const target = await create("Agent关联目标", "# 目标");
          const c: ToolCall = {
            toolCallId: randomUUID(),
            toolName: "apply_knowledge_relation",
            input: {
              spaceId: space.id,
              sourceId: source.id,
              targetId: target.id,
              expectedRevision: source.revision,
            },
            stepId: randomUUID(),
            operationId: randomUUID(),
          };
          const result = await (service as any).runTool(actor, c, c.input);
          assert.ok(result.markdown.startsWith(source.markdown));
          assert.match(result.markdown, /\[\[Agent关联目标/);
          const replay = await (service as any).runTool(actor, c, c.input);
          assert.equal(result.revision, replay.revision);
          await assert.rejects(
            (service as any).runTool(
              actor,
              { ...c, operationId: randomUUID() },
              c.input,
            ),
            { code: "KNOWLEDGE_REVISION_CONFLICT" },
          );
          await service.cancel(actorId, actor.runId);
        },
      );
      await writeFile(
        (process.env.AGENT_TEST_ARTIFACT_ROOT ?? "H:/CodexStorage/shoushou-p251")+"/artifacts/legacy-reliability-check.json",
        JSON.stringify({ checks, passed: checks.length }, null, 2),
      );
    } finally {
      fixture.close();
      await pool.end();
    }
  },
);
