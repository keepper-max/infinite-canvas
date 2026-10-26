import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../src/db/client.js";
import { PostgresPlatformRepository } from "../src/repository.js";
import { KnowledgeService } from "../src/knowledge-service.js";
import { NativeAgentService } from "../src/native-agent/service.js";
import { runInput } from "../src/native-agent/contracts.js";
import type {
  AgentModelDriver,
  ModelReply,
} from "../src/native-agent/model.js";
const url = process.env.P251_TEST_DATABASE_URL;
const summary = {
  discussion: "",
  proposals: [],
  confirmed: [],
  rejected: [],
  openQuestions: [],
};
test("auto interaction requires classifier and read-only admission; legacy payload remains unchanged", () => {
  const p = {
    operationId: randomUUID(),
    prompt: "你好",
    modelId: "fixture",
    mode: "advice",
    conversationVersion: 1,
    interaction: "auto",
  };
  assert.ok(runInput.safeParse(p).success);
  assert.equal(
    runInput.safeParse({ ...p, conversationVersion: undefined }).success,
    false,
  );
  assert.equal(runInput.safeParse({ ...p, mode: "execute" }).success, false);
  assert.equal(
    runInput.parse({ ...p, interaction: undefined }).interaction,
    undefined,
  );
});
for (const scenario of [
  "chat",
  "viewer-chat",
  "chat-write",
  "action",
  "viewer",
  "revoked",
] as const)
  test(
    `real PostgreSQL unified Agent: ${scenario}`,
    { skip: !url, timeout: 60000 },
    async () => {
      assert.equal(
        url,
        "postgres://p25@127.0.0.1:55485/r21_regression_isolated",
      );
      Object.assign(process.env, {
        NATIVE_AGENT_ENABLED: "true",
        NATIVE_AGENT_DEFAULT_ENABLED: "true",
        KNOWLEDGE_DEFAULT_ENABLED: "true",
      });
      const { db, pool } = createDatabase(url!),
        repo = new PostgresPlatformRepository(db);
      const discussion = ["chat", "viewer-chat", "chat-write"].includes(
        scenario,
      );
      let count = 0,
        proposed = false;
      const driver: AgentModelDriver = {
        models: async () => [
          { id: "native-agent-fixture", name: "隔离替身", substitute: true },
        ],
        run: async (_id, _messages, _signal, _emit, e) => {
          count++;
          let text = "",
            calls: ModelReply["calls"] = [];
          if (e?.conversationStage === "intent")
            text = JSON.stringify({
              intent: discussion ? "chat" : "action",
              actionTarget: discussion ? "unspecified" : "canvas",
              evidence: e.currentUserMessage,
              resolvedRequest: e.currentUserMessage,
              summary,
            });
          else if (discussion) {
            assert.equal(e?.mode, "advice");
            assert.ok(!e?.toolNames?.includes("create_canvas_node"));
            text = "你好，我们可以先讨论影片。";
            if (scenario === "chat-write")
              calls = [
                {
                  toolCallId: randomUUID(),
                  toolName: "create_canvas_node",
                  input: {
                    type: "text",
                    title: "越权提案",
                    content: "不应写入",
                    position: { x: 0, y: 0 },
                    expectedCanvasRevision: 0,
                  },
                },
              ];
          } else if (!proposed) {
            assert.equal(e?.mode, "execute");
            assert.ok(e?.planning);
            assert.ok(e?.toolNames?.includes("create_canvas_node"));
            proposed = true;
            calls = [
              {
                toolCallId: randomUUID(),
                toolName: "create_canvas_node",
                input: {
                  type: "text",
                  title: "短片",
                  content: "已讨论的方案",
                  position: { x: 0, y: 0 },
                  expectedCanvasRevision: 0,
                },
              },
            ];
          } else text = "计划已准备，请确认。";
          return {
            text,
            calls,
            messages: [
              {
                role: "assistant",
                content: calls.length
                  ? calls.map((c) => ({ type: "tool-call" as const, ...c }))
                  : text,
              },
            ],
            inputTokens: 100,
            outputTokens: 50,
            meterStatus: "substitute",
          };
        },
      };
      const service = new NativeAgentService(
        new KnowledgeService(db),
        pool,
        driver,
        async () => {},
      );
      try {
        const u = await repo.createUserWithWorkspace(
            "auto-" + randomUUID() + "@example.test",
            "synthetic",
          ),
          actor = u.user.id,
          project = u.workspace.projectId;
        const session = await service.createSession(actor, {
          projectId: project,
          title: "自动交互",
          mode: "advice",
          operationId: randomUUID(),
        });
        if (scenario === "viewer" || scenario === "viewer-chat")
          await pool.query(
            "update project_members set role='viewer' where project_id=$1 and user_id=$2",
            [project, actor],
          );
        const p = {
          operationId: randomUUID(),
          prompt: discussion ? "你好想做一个10秒的片子" : "把方案写入画布",
          mode: "advice",
          modelId: "native-agent-fixture",
          budgetCents: 0,
          conversationVersion: 1,
          interaction: "auto",
        };
        const run = await service.start(actor, session.id, p);
        assert.equal((await service.start(actor, session.id, p)).id, run.id);
        await assert.rejects(
          service.start(actor, session.id, { ...p, interaction: undefined }),
          { code: "AGENT_OPERATION_MISMATCH" },
        );
        if (scenario === "revoked")
          await pool.query(
            "delete from project_members where project_id=$1 and user_id=$2",
            [project, actor],
          );
        await service.drive(run.id);
        const persisted = (
          await pool.query("select * from native_agent_runs where id=$1", [
            run.id,
          ])
        ).rows[0];
        if (scenario === "viewer" || scenario === "revoked") {
          assert.equal(persisted.mode, "advice");
          assert.equal(persisted.error_code, "PROJECT_FORBIDDEN");
          assert.equal(count, scenario === "viewer" ? 1 : 0);
          assert.equal(
            (
              await pool.query(
                "select count(*)::int as n from native_agent_approvals where run_id=$1",
                [run.id],
              )
            ).rows[0].n,
            0,
          );
        } else {
          let snap: any = await service.snapshot(actor, session.id);
          assert.equal(
            (await repo.getCanvasForUser(project, actor))!.nodes.length,
            0,
          );
          if (discussion) {
            assert.equal(persisted.mode, "advice");
            assert.equal(
              persisted.status,
              scenario === "chat-write" ? "paused" : "completed",
            );
            if (scenario === "chat-write")
              assert.equal(persisted.error_code, "AGENT_TOOL_SCOPE_MISMATCH");
            assert.equal(count, 2);
            assert.equal(snap.plans.length, 0);
          } else {
            assert.equal(persisted.mode, "execute");
            assert.equal(persisted.status, "awaiting_approval");
            const a = snap.approvals.find((a: any) => a.status === "pending");
            assert.ok(a);
            await service.decide(actor, a.id, {
              operationId: randomUUID(),
              expectedRevision: a.revision,
              payloadHash: a.payload_hash,
              decision: "approve",
            });
            await service.drive(run.id);
            assert.equal(
              (await repo.getCanvasForUser(project, actor))!.nodes.length,
              1,
            );
            assert.equal(
              (await service.snapshot(actor, session.id)).runs[0].status,
              "completed",
            );
            assert.equal(
              (await service.start(actor, session.id, p)).id,
              run.id,
              "promotion must preserve original retry payload",
            );
          }
        }
      } finally {
        await pool.end();
      }
    },
  );
