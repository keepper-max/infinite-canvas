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
import { discoveredKnowledgeTools, assertDiscoveredKnowledgeReference } from "../src/native-agent/tools.js";
import { toolFailureRecoveryMessage } from "../src/native-agent/conversation-policy.js";
import { safeTaskError } from "../src/native-agent/presentation.js";
import type { AgentModelDriver, ModelReply } from "../src/native-agent/model.js";

const nil = "00000000-0000-0000-0000-000000000000";
test("knowledge discovery withholds reads until an authoritative document is known", () => {
  const spaceId = randomUUID(), documentId = randomUUID();
  assert.ok(discoveredKnowledgeTools(undefined, []).includes("search_knowledge"));
  assert.ok(!discoveredKnowledgeTools(undefined, [{ spaceId }]).includes("read_knowledge"));
  assert.ok(!discoveredKnowledgeTools(undefined, [{ spaceId, documentId: nil }]).includes("read_knowledge"));
  assert.deepEqual(discoveredKnowledgeTools([], [{ spaceId, documentId }]), []);
  assert.ok(discoveredKnowledgeTools(["read_knowledge"], [{ spaceId, documentId }]).includes("read_knowledge"));
  assert.doesNotThrow(() => assertDiscoveredKnowledgeReference("read_knowledge", { spaceId, documentId }, [{ spaceId, documentId }]));
  for (const input of [{ spaceId, documentId: nil }, { spaceId, documentId: randomUUID() }, { spaceId: randomUUID(), documentId }])
    assert.throws(() => assertDiscoveredKnowledgeReference("read_knowledge", input, [{ spaceId, documentId }]), { code: "AGENT_KNOWLEDGE_REFERENCE_UNVERIFIED" });
  assert.match(safeTaskError("AGENT_KNOWLEDGE_REFERENCE_UNVERIFIED"), /搜索/);
  assert.match(toolFailureRecoveryMessage("KNOWLEDGE_NOT_FOUND")!, /禁止使用全零/);
});

const url = process.env.P251_TEST_DATABASE_URL;
for (const scenario of ["search-read", "invented-reference", "batch-failure", "source-revoked"] as const)
  test(`real PostgreSQL and HTTP knowledge discovery: ${scenario}`, { skip: !url, timeout: 60000 }, async () => {
    assert.equal(url, "postgres://p25@127.0.0.1:55486/agent_readonly_isolated");
    Object.assign(process.env, { NATIVE_AGENT_ENABLED: "true", NATIVE_AGENT_DEFAULT_ENABLED: "true", KNOWLEDGE_DEFAULT_ENABLED: "true" });
    const { db, pool } = createDatabase(url!), repo = new PostgresPlatformRepository(db), knowledge = new KnowledgeService(db);
    let rounds = 0, spaceId = "", documentId = "";
    const prompt = "请只读查找知识并读取找到的文档；不要创建或改动任何内容。";
    const call = (toolName: string, input: unknown) => ({ toolName, input, toolCallId: randomUUID() });
    const driver: AgentModelDriver = {
      models: async () => [{ id: "discovery-fixture", name: "隔离替身", substitute: true }],
      run: async (_id, _messages, _signal, _emit, execution) => {
        rounds++;
        let text = "已读取实际文档。", calls: ModelReply["calls"] = [];
        if (rounds === 1) text = JSON.stringify({ intent: "read", actionTarget: "unspecified", evidence: prompt, resolvedRequest: prompt, summary: { discussion: "", proposals: [], confirmed: [], rejected: [], openQuestions: [] } });
        else if (rounds === 2) {
          assert.ok(execution?.toolNames?.includes("search_knowledge"));
          assert.ok(!execution?.toolNames?.includes("read_knowledge"));
          calls = scenario === "invented-reference"
            ? [call("read_knowledge", { spaceId, documentId: nil })]
            : [call("search_knowledge", { spaceId, q: "测试资料" })];
        } else if (rounds === 3) {
          assert.ok(execution?.toolNames?.includes("read_knowledge"));
          if (scenario === "source-revoked") await pool.query("update knowledge_documents set deleted_at=now() where id=$1", [documentId]);
          calls = [call("read_knowledge", { spaceId, documentId }), ...(scenario === "batch-failure" ? [call("search_knowledge", { spaceId: randomUUID(), q: "无权访问的空间" }), call("search_knowledge", { spaceId, q: "尚未执行的搜索" })] : [])];
        }
        if (calls.length) text = "";
        return { text, calls, messages: [{ role: "assistant", content: calls.length ? calls.map(c => ({ type: "tool-call" as const, ...c })) : text }], inputTokens: 100, outputTokens: 20, meterStatus: "substitute" };
      },
    };
    const service = new NativeAgentService(knowledge, pool, driver, async () => {});
    const config = readConfig({ DATABASE_URL: url!, SESSION_COOKIE_NAME: "discovery_session", TRUSTED_ORIGINS: "http://127.0.0.1", OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:59082", OBJECT_STORAGE_BUCKET: "unused", OBJECT_STORAGE_ACCESS_KEY_ID: "synthetic", OBJECT_STORAGE_SECRET_ACCESS_KEY: "synthetic" });
    const server = serve({ fetch: createApp(repo, config, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, knowledge, undefined, service).fetch, hostname: "127.0.0.1", port: 0 });
    await once(server, "listening");
    const token = randomUUID();
    try {
      const { user, workspace } = await repo.createUserWithWorkspace("discovery-" + randomUUID() + "@example.test", "synthetic");
      const space = await knowledge.createSpace(user.id, "personal", null, randomUUID());
      spaceId = space.id;
      const doc = await knowledge.write(user.id, spaceId, { operationId: randomUUID(), action: "document.create", payload: { title: "测试资料", markdown: "真实正文，不是授权占位资料。" } });
      documentId = doc.id;
      await repo.createSession(user.id, hashSessionToken(token), new Date(Date.now() + 60000));
      const request = async (path: string, payload?: unknown) => {
        const res = await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/native-agent${path}`, { method: payload ? "POST" : "GET", headers: { cookie: "discovery_session=" + token, origin: "http://127.0.0.1", "content-type": "application/json" }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
        const body = await res.json() as any;
        assert.equal(res.status, 200, JSON.stringify(body));
        return body.data;
      };
      const session = await request("/sessions", { projectId: workspace.projectId, title: "资料发现验收", mode: "advice", operationId: randomUUID() });
      const run = await request(`/sessions/${session.id}/runs`, { operationId: randomUUID(), prompt, mode: "advice", modelId: "discovery-fixture", budgetCents: 0, conversationVersion: 1, interaction: "auto" });
      await service.drive(run.id);
      const persisted = (await pool.query("select * from native_agent_runs where id=$1", [run.id])).rows[0];
      const steps = (await pool.query("select * from native_agent_steps where run_id=$1 order by ordinal", [run.id])).rows;
      assert.equal(persisted.spent_cents, 0);
      if (scenario === "search-read") {
        assert.equal(persisted.status, "completed");
        assert.equal(rounds, 4);
        assert.equal(steps.find(s => s.tool_name === "read_knowledge").output.markdown, "真实正文，不是授权占位资料。");
      } else if (scenario === "invented-reference") {
        assert.equal(persisted.error_code, "AGENT_KNOWLEDGE_REFERENCE_UNVERIFIED");
        assert.equal(steps.filter(s => s.kind === "tool").length, 0, "unknown ID batch must never be staged");
        assert.equal(rounds, 2);
      } else if (scenario === "source-revoked") {
        assert.equal(persisted.error_code, "AGENT_SOURCE_REVOKED");
        assert.equal(steps.find(s => s.tool_name === "read_knowledge").started_at, null);
        assert.equal(rounds, 3);
      } else {
        assert.equal(persisted.error_code, "AGENT_SPACE_FORBIDDEN");
        assert.equal(steps.find(s => s.tool_name === "read_knowledge").status, "completed");
        assert.equal(steps.find(s => s.input?.q === "无权访问的空间").status, "failed");
        const skipped = steps.find(s => s.input?.q === "尚未执行的搜索");
        assert.equal(skipped.status, "cancelled");
        assert.equal(skipped.started_at, null);
        assert.equal(skipped.error_code, "AGENT_BATCH_NOT_EXECUTED");
        const view = await request(`/sessions/${session.id}/presentation`);
        assert.equal(view.presentation.tasks[0].progressItems.find((s: any) => s.key === skipped.id).statusLabel, "未执行（前序步骤失败）");
        assert.equal(rounds, 3);
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
      try { await repo.deleteSession(hashSessionToken(token)); } finally { await pool.end(); }
    }
  });
