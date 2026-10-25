import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const root = "H:/CodexStorage/shoushou-p25",
  f = JSON.parse(await readFile(root + "/private/fixture-v2.json", "utf8")),
  base = "http://127.0.0.1:3195";
async function request(path: string, body?: unknown, token = f.token) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      cookie: "p25_session=" + token,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const p = await r.json();
  return { status: r.status, data: p.data, error: p.error };
}
const checks: string[] = [];
const s = await request("/api/native-agent/sessions", {
  projectId: f.projectId,
  mode: "execute",
  title: "雾港完整验收",
  operationId: randomUUID(),
});
assert.equal(s.status, 200, JSON.stringify(s));
const input = {
  operationId: randomUUID(),
  prompt: "根据这三篇资料，帮我搭建第一集AI漫剧的创作流程。",
  modelId: "native-agent-fixture",
  mode: "execute",
  budgetCents: 0,
};
const start = await request(
  `/api/native-agent/sessions/${s.data.id}/runs`,
  input,
);
assert.equal(start.status, 200, JSON.stringify(start));
const replay = await request(
  `/api/native-agent/sessions/${s.data.id}/runs`,
  input,
);
assert.equal(replay.data.id, start.data.id);
checks.push("同operationId相同请求返回同一Run");
const mismatch = await request(`/api/native-agent/sessions/${s.data.id}/runs`, {
  ...input,
  prompt: "不同任务",
});
assert.equal(mismatch.status, 409);
checks.push("同operationId不同参数409");
let approvals = 0,
  snapshot: any;
for (let i = 0; i < 90; i++) {
  const result = await request(`/api/native-agent/sessions/${s.data.id}`);
  assert.equal(result.status, 200, JSON.stringify(result));
  snapshot = result.data;
  const r = snapshot.runs.at(-1);
  console.log(
    JSON.stringify({
      status: r.status,
      rounds: r.rounds,
      tools: r.tool_count,
      error: r.error_code,
    }),
  );
  if (["failed", "awaiting_manual_review", "cancelled"].includes(r.status))
    throw new Error(JSON.stringify({ run: r, steps: snapshot.steps }));
  const a = snapshot.approvals.find((a: any) => a.status === "pending");
  if (a) {
    const p = {
      operationId: randomUUID(),
      expectedRevision: a.revision,
      payloadHash: a.payload_hash,
      decision: "approve",
    };
    const decision = await request(`/api/native-agent/approvals/${a.id}`, p);
    assert.equal(decision.status, 200, JSON.stringify(decision));
    const same = await request(`/api/native-agent/approvals/${a.id}`, p);
    assert.equal(same.status, 200, JSON.stringify(same));
    approvals++;
  }
  if (r.status === "completed") break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.equal(snapshot.runs.at(-1).status, "completed");
assert.equal(approvals, 2);
checks.push(
  "实际SDK streaming Tool Calling→知识搜索读取→两批审批→画布CAS持久化",
);
const canvas = await request(`/api/projects/${f.projectId}/canvas`);
assert.equal(canvas.status, 200, JSON.stringify(canvas));
const c = canvas.data.canvas ?? canvas.data;
assert.equal(
  c.nodes.filter((n: any) => n.type === "knowledge:document").length,
  3,
);
assert.equal(c.nodes.filter((n: any) => n.type === "text").length, 1);
assert.equal(c.edges.length, 3);
for (const e of c.edges) {
  assert.equal(e.sourcePortId, "knowledge.output");
  assert.equal(e.targetPortId, "text.input");
  assert.equal(e.resourceType, "text");
}
assert.equal(
  new Set(
    c.nodes
      .filter((n: any) => n.type === "knowledge:document")
      .map((n: any) => n.metadata.knowledgeReference.documentId),
  ).size,
  3,
);
checks.push("刷新读取保留3知识节点+1文本节点+3条正确端口连线");
const unauthorized = await request(
  `/api/native-agent/sessions/${s.data.id}`,
  undefined,
  f.otherToken,
);
assert.equal(unauthorized.status, 404);
checks.push("跨用户会话读取404");
const noauth = await request("/api/native-agent/status", undefined, "invalid");
assert.equal(noauth.status, 401);
checks.push("未登录请求401");
const again = await request(`/api/native-agent/sessions/${s.data.id}`);
assert.equal(again.data.messages.length, snapshot.messages.length);
checks.push("历史快照不重复物化消息");
await writeFile(
  root + "/artifacts/api-check.json",
  JSON.stringify(
    {
      checks,
      sessionId: s.data.id,
      runId: start.data.id,
      revision: c.revision,
      nodeIds: c.nodes.map((n: any) => n.id),
      edgeIds: c.edges.map((e: any) => e.id),
      approvals,
      finalStatus: snapshot.runs.at(-1).status,
    },
    null,
    2,
  ),
);
console.log("PASS", checks.length, "checks");
