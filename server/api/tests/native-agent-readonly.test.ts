import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { serve } from "@hono/node-server";
import { createDatabase } from "../src/db/client.js";
import { PostgresPlatformRepository } from "../src/repository.js";
import { KnowledgeService } from "../src/knowledge-service.js";
import { NativeAgentService } from "../src/native-agent/service.js";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { hashSessionToken } from "../src/auth.js";
import { parseConversationDecision, restrictReadOnlyDecision, conversationTools, conversationSystem } from "../src/native-agent/conversation-policy.js";
import type { AgentModelDriver, ModelReply } from "../src/native-agent/model.js";

const prompt = "请只读调用 get_canvas_state，告诉我当前画布节点数与连线数；不要创建或改动任何内容。";
const decision = (text: string, intent = "action") => ({
  intent, actionTarget: "canvas", evidence: text, resolvedRequest: text,
  summary: { discussion: "", proposals: [], confirmed: [], rejected: [], openQuestions: [] },
});

test("production action misclassification is narrowed to read without rewriting the original verdict", () => {
  const original = decision(prompt), raw = JSON.stringify(original);
  const effective = restrictReadOnlyDecision(original as any, prompt);
  assert.equal(effective.intent, "read");
  assert.equal(effective.actionTarget, "unspecified");
  assert.equal(JSON.stringify(original), raw);
  assert.equal(parseConversationDecision(raw, prompt, []).intent, "read");
  assert.ok(!conversationTools(effective, "execute")!.includes("create_canvas_node"));
  assert.match(conversationSystem("response", effective), /取得结果后直接回答/);
});

test("semantic read intent accepts ordinary queries without requiring a fixed Chinese phrase", () => {
  for (const text of ["统计当前节点数量", "How many nodes are on this canvas?"]) {
    const effective = parseConversationDecision(JSON.stringify(decision(text, "read")), text, []);
    assert.equal(effective.intent, "read");
    assert.equal(effective.actionTarget, "unspecified");
    assert.ok(conversationTools(effective, "execute")!.includes("get_canvas_state"));
  }
});

for (const text of [
  "创建一个标题为“只读”的文本节点",
  "先读取画布，再创建一个节点",
  "请只读查看画布，然后创建一个节点",
  "请只读查看，然后创建一个节点；不要修改现有文档。",
  "请只读查询，再新增节点；不要修改任何现有内容。",
  "请只读分析，再创建节点；不要修改任何文档。",
  "请创建节点，正文是“不要创建或改动任何内容”",
  "文档说：请只读查询，不要修改内容。现在将它写入画布。",
  "不是只读，请按方案执行写入",
]) test(`read-only words in quotes or mixed write goals do not suppress writes: ${text}`, () => {
  assert.equal(parseConversationDecision(JSON.stringify(decision(text)), text, []).intent, "action");
});

test("read-only normalization never bypasses current-turn evidence validation", () => {
  assert.throws(() => parseConversationDecision(JSON.stringify({ ...decision(prompt), evidence: "编造的授权" }), prompt, []), { code: "AGENT_CONVERSATION_INVALID" });
});

const url = process.env.P251_TEST_DATABASE_URL;
for (const scenario of ["misclassified-read", "viewer-read", "semantic-read", "read-write-rejected", "write-no-plan", "write-proposal", "legacy-resume"] as const) {
  test(`real PostgreSQL + authenticated HTTP read-only lifecycle: ${scenario}`, { skip: !url, timeout: 60000 }, async () => {
    assert.ok([
      "postgres://p25@127.0.0.1:55485/r21_regression_isolated",
      "postgres://p25@127.0.0.1:55486/agent_readonly_isolated",
    ].includes(url!), "Only the explicit isolated test databases are allowed");
    Object.assign(process.env, { NATIVE_AGENT_ENABLED: "true", NATIVE_AGENT_DEFAULT_ENABLED: "true", KNOWLEDGE_DEFAULT_ENABLED: "true" });
    const { db, pool } = createDatabase(url!), repo = new PostgresPlatformRepository(db), knowledge = new KnowledgeService(db);
    const writing = scenario.startsWith("write-");
    const text = writing ? "创建一个标题为“只读”的文本节点" : scenario === "semantic-read" ? "统计当前画布节点数和连线数" : prompt;
    let modelCalls = 0, toolRequested = false;
    const driver: AgentModelDriver = {
      models: async () => [{ id: "native-agent-fixture", name: "只读隔离替身", substitute: true }],
      run: async (_id, _messages, _signal, _emit, execution) => {
        modelCalls++;
        let replyText = "当前画布有0个节点、0条连线；没有修改内容。", calls: ModelReply["calls"] = [];
        if (execution?.conversationStage === "intent") replyText = JSON.stringify(decision(text, scenario === "semantic-read" ? "read" : "action"));
        else {
          if (!writing) {
            assert.equal(execution?.planning, undefined);
            assert.ok(!execution?.toolNames?.includes("create_canvas_node"));
            assert.equal(execution?.mode, "advice");
          }
          if (!toolRequested && scenario !== "write-no-plan") {
            toolRequested = true;
            const write = writing || scenario === "read-write-rejected";
            calls = [{ toolCallId: randomUUID(), toolName: write ? "create_canvas_node" : "get_canvas_state", input: write ? { type: "text", title: "只读", content: "审批后才允许保存", position: { x: 0, y: 0 }, expectedCanvasRevision: 0 } : {} }];
            replyText = "";
          }
        }
        return { text: replyText, calls, messages: [{ role: "assistant", content: calls.length ? calls.map(c => ({ type: "tool-call" as const, ...c })) : replyText }], inputTokens: 100, outputTokens: 20, meterStatus: "substitute" };
      },
    };
    const service = new NativeAgentService(knowledge, pool, driver, async () => {});
    const config = readConfig({ DATABASE_URL: url!, SESSION_COOKIE_NAME: "readonly_session", TRUSTED_ORIGINS: "http://127.0.0.1", OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:59082", OBJECT_STORAGE_BUCKET: "unused", OBJECT_STORAGE_ACCESS_KEY_ID: "synthetic", OBJECT_STORAGE_SECRET_ACCESS_KEY: "synthetic" });
    const app = createApp(repo, config, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, knowledge, undefined, service);
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const token = randomUUID();
    let sessionCreated = false;
    let originalPolicy: unknown;
    try {
      const u = await repo.createUserWithWorkspace("readonly-" + randomUUID() + "@example.test", "synthetic");
      const actor = u.user.id, project = u.workspace.projectId;
      if (writing || scenario === "legacy-resume") {
        originalPolicy = (await pool.query("select value from platform_settings where key='native_agent_policy'")).rows[0]?.value;
        if (originalPolicy) await pool.query("update platform_settings set value=jsonb_set(value,'{enabled}','true'::jsonb) where key='native_agent_policy'");
      }
      await repo.createSession(actor, hashSessionToken(token), new Date(Date.now() + 60000));
      sessionCreated = true;
      if (scenario === "viewer-read") await pool.query("update project_members set role='viewer' where user_id=$1 and project_id=$2", [actor, project]);
      const request = async (path: string, payload?: unknown) => {
        const response = await fetch(base + "/api/native-agent" + path, { method: payload ? "POST" : "GET", headers: { cookie: "readonly_session=" + token, origin: "http://127.0.0.1", "content-type": "application/json" }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
        const body = await response.json() as any;
        assert.equal(response.status, 200, JSON.stringify(body));
        return body.data;
      };
      assert.equal((await fetch(base + "/api/native-agent/active-run")).status, 401);
      const session = await request("/sessions", { projectId: project, title: "只读回归", mode: "advice", operationId: randomUUID() });
      const payload = { operationId: randomUUID(), prompt: text, mode: "advice", modelId: "native-agent-fixture", budgetCents: 0, conversationVersion: 1, interaction: "auto" };
      const run = await request(`/sessions/${session.id}/runs`, payload);
      assert.equal((await request(`/sessions/${session.id}/runs`, payload)).id, run.id);
      await service.drive(run.id);
      await service.drive(run.id);
      let persisted = (await pool.query("select * from native_agent_runs where id=$1", [run.id])).rows[0];
      let snapshot: any = await service.snapshot(actor, session.id);
      assert.equal((await repo.getCanvasForUser(project, actor))!.nodes.length, 0);
      assert.equal(persisted.spent_cents, 0);
      if (scenario === "write-no-plan") {
        assert.equal(persisted.status, "paused");
        assert.equal(persisted.error_code, "AGENT_NO_EXECUTABLE_PLAN");
        assert.equal(modelCalls, 3);
      } else if (scenario === "write-proposal") {
        assert.equal(persisted.status, "awaiting_approval");
        const approval = snapshot.approvals.find((a: any) => a.status === "pending");
        assert.ok(approval);
        await request(`/approvals/${approval.id}`, { operationId: randomUUID(), expectedRevision: approval.revision, payloadHash: approval.payload_hash, decision: "approve" });
        const before = modelCalls;
        await service.drive(run.id);
        assert.equal((await repo.getCanvasForUser(project, actor))!.nodes.length, 1);
        assert.equal(modelCalls, before, "approved writes do not need more model calls");
      } else if (scenario === "read-write-rejected") {
        assert.equal(persisted.status, "paused");
        assert.equal(persisted.error_code, "AGENT_TOOL_SCOPE_MISMATCH");
        assert.equal(modelCalls, 2);
        assert.equal(snapshot.plans.length, 0);
      } else {
        assert.equal(persisted.status, "completed");
        assert.equal(persisted.error_code, null);
        assert.equal(persisted.mode, "advice");
        assert.equal(persisted.goal_reviewed, false);
        assert.equal(modelCalls, 3, "classify, read tool request, answer; no extra planning round");
        assert.equal(snapshot.steps.filter((s: any) => s.kind === "tool").length, 1);
        assert.equal(snapshot.plans.length, 0);
        assert.equal(snapshot.approvals.length, 0);
        assert.equal((await request(`/sessions/${session.id}/presentation`)).presentation.tasks[0].status, "completed");
        assert.equal(await request("/active-run"), null);
      }
      if (scenario === "legacy-resume") {
        const classifier = (await pool.query("select * from native_agent_steps where run_id=$1 and input->>'conversationStage'='intent'", [run.id])).rows[0];
        const legacyOutput = { ...classifier.output, conversation: decision(text) };
        await pool.query("update native_agent_steps set output=$2::jsonb where id=$1", [classifier.id, JSON.stringify(legacyOutput)]);
        await pool.query("update native_agent_runs set mode='execute',status='paused',phase='tools',goal_reviewed=true,error_code='AGENT_NO_EXECUTABLE_PLAN',revision=revision+1 where id=$1", [run.id]);
        const archived = JSON.stringify((await pool.query("select input,output from native_agent_steps where run_id=$1 order by ordinal", [run.id])).rows);
        persisted = (await pool.query("select * from native_agent_runs where id=$1", [run.id])).rows[0];
        const feature = await request("/status"), before = modelCalls;
        await request(`/runs/${run.id}/resume`, { operationId: randomUUID(), expectedRevision: persisted.revision, modelId: "native-agent-fixture", additionalBudgetCents: 0, limitsHash: feature.limitsHash });
        await service.drive(run.id);
        snapshot = await service.snapshot(actor, session.id);
        assert.equal(snapshot.runs[0].status, "completed");
        assert.equal(modelCalls, before, "legacy read-only answer seals without paid inference");
        assert.equal(JSON.stringify((await pool.query("select input,output from native_agent_steps where run_id=$1 order by ordinal", [run.id])).rows), archived);
        assert.equal(snapshot.plans.length, 0);
        assert.equal(snapshot.approvals.length, 0);
        const last = (await pool.query("select id,output from native_agent_steps where run_id=$1 and kind='model' order by ordinal desc limit 1", [run.id])).rows[0];
        for (const unsafe of ["pending-call", "missing-answer", "has-approval"]) {
          await pool.query("update native_agent_steps set output=$2::jsonb where id=$1", [last.id, JSON.stringify(unsafe === "missing-answer" ? { ...last.output, text: "" } : last.output)]);
          if (unsafe === "has-approval") await pool.query("insert into native_agent_approvals(run_id,actor_id,payload_hash,calls,preview,revision,status) values($1,$2,$3,'[]','[]',1,'pending')", [run.id, actor, "f".repeat(64)]);
          const pending = unsafe === "pending-call" ? [{ toolCallId: randomUUID(), toolName: "get_canvas_state", input: {}, stepId: randomUUID(), operationId: randomUUID() }] : [];
          await pool.query("update native_agent_runs set status='paused',phase='tools',cancel_requested=false,error_code='AGENT_NO_EXECUTABLE_PLAN',pending_calls=$2::jsonb,revision=revision+1 where id=$1", [run.id, JSON.stringify(pending)]);
          const current = (await pool.query("select revision from native_agent_runs where id=$1", [run.id])).rows[0];
          await request(`/runs/${run.id}/resume`, { operationId: randomUUID(), expectedRevision: current.revision, modelId: "native-agent-fixture", additionalBudgetCents: 0, limitsHash: feature.limitsHash });
          assert.equal((await pool.query("select phase from native_agent_runs where id=$1", [run.id])).rows[0].phase, "model", unsafe + " must not seal an incomplete or approved operation");
          assert.equal(modelCalls, before);
        }
        await pool.query("update native_agent_steps set output=$2::jsonb where id=$1", [last.id, JSON.stringify(last.output)]);
        await request(`/runs/${run.id}/cancel`, {});
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      try {
        if (sessionCreated) await repo.deleteSession(hashSessionToken(token));
        if (originalPolicy) await pool.query("update platform_settings set value=$1::jsonb where key='native_agent_policy'", [JSON.stringify(originalPolicy)]);
      }
      finally { await pool.end(); }
    }
  });
}
