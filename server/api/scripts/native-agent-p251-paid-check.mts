import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createDatabase } from "../src/db/client.js";
import { AGENT_LIMITS } from "../src/native-agent/limits.js";
const root = "H:/CodexStorage/shoushou-p251",
  f = JSON.parse(
    await readFile(
      "H:/CodexStorage/shoushou-p25/private/paid-fixture.json",
      "utf8",
    ),
  );
const { pool } = createDatabase("postgres://p25@127.0.0.1:55485/p251_isolated");
const meter = (
  await pool.query(
    "select coalesce(sum(case when m.status='settled' then m.settled_cents else greatest(m.quote_cents,j.credits_reserved) end),0)::int cents from native_agent_model_jobs m join generation_jobs j on j.id=m.job_id where m.actor_id=$1",
    [f.ownerId],
  )
).rows[0];
await pool.end();
const remaining = 100 - meter.cents;
assert.ok(remaining > 0);
console.log(
  "EXISTING_AUTHORIZATION_CENTS",
  JSON.stringify({ cap: 100, usedOrHeld: meter.cents, remaining }),
);
const api = async (path: string, body?: unknown) => {
  const response = await fetch("http://127.0.0.1:3196" + path, {
    method: body ? "POST" : "GET",
    headers: {
      cookie: "p251_session" + "=" + f.token,
      ...(body
        ? {
            "content-type": "application/json",
            origin: "http://127.0.0.1:3196",
          }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = (await response.json()) as any;
  assert.ok(response.ok, JSON.stringify(result));
  return result.data;
};
const created = await api("/api/projects", {
    name: "雾港 · 一次确认连续计划",
    description: "P251 isolated acceptance",
  }),
  projectId = created.project.projectId;
const space = await api("/api/knowledge/spaces", {
  kind: "project",
  projectId,
  operationId: randomUUID(),
});
const docs = [];
for (const [title, markdown] of [
  ["雾港世界观", "# 雾港\n海雾封锁的港城，旧灯塔保存航道秘密。"],
  ["林岚人物设定", "# 林岚\n冷静的调查员，寻找失踪的父亲。[[雾港世界观]]"],
  ["周可人物设定", "# 周可\n幽默的灯塔维修师，与[[林岚人物设定]]共同调查。"],
])
  docs.push(
    await api("/api/knowledge/" + space.id + "/actions", {
      operationId: randomUUID(),
      action: "document.create",
      payload: { title, markdown, folderId: null },
    }),
  );
const session = await api("/api/native-agent/sessions", {
  projectId,
  title: "一次目标、一次确认",
  mode: "execute",
  operationId: randomUUID(),
});
const request = {
  operationId: randomUUID(),
  prompt:
    "请实际读取当前项目《雾港世界观》《林岚人物设定》《周可人物设定》三篇不同文档正文，创建3个固定版本知识引用节点和1个第一集剧本创作文本节点；用3条 knowledge.output 到 text.input 连线构成完整漫剧创作流程。请一次提出包含全部节点和连线的完整计划，统一确认后保存。不要修改知识原文，不调用付费媒体。输出简洁。",
  mode: "execute",
  modelId: "catalog.text.qwen3.5-flash",
  budgetCents: remaining,
};
const run = await api(
  "/api/native-agent/sessions/" + session.id + "/runs",
  request,
);
assert.equal(
  (await api("/api/native-agent/sessions/" + session.id + "/runs", request)).id,
  run.id,
);
await writeFile(
  root + "/artifacts/real-continuous-current.json",
  JSON.stringify({
    runId: run.id,
    sessionId: session.id,
    projectId,
    spaceId: space.id,
    operationId: request.operationId,
  }),
);
let approvals = 0,
  snapshot: any,
  roundsBeforeApproval = 0;
const approved = new Set<string>(),
  deadline = Date.now() + AGENT_LIMITS.activeMs;
while (Date.now() < deadline) {
  snapshot = await api("/api/native-agent/sessions/" + session.id);
  const current = snapshot.runs.find((r: any) => r.id === run.id);
  if (
    [
      "completed",
      "failed",
      "cancelled",
      "paused",
      "awaiting_manual_review",
    ].includes(current.status)
  )
    break;
  const approval = snapshot.approvals.find((a: any) => a.status === "pending");
  if (approval && !approved.has(approval.id)) {
    const before = (await api("/api/projects/" + projectId + "/canvas")).canvas;
    assert.equal(before.nodes.length, 0);
    assert.equal(before.edges.length, 0);
    assert.equal(
      approval.preview.filter((p: any) => p.tool === "create_canvas_node")
        .length,
      4,
    );
    assert.equal(
      approval.preview.filter((p: any) => p.tool === "connect_canvas_nodes")
        .length,
      3,
    );
    assert.equal(
      snapshot.plans.at(-1).steps.filter((s: any) => !s.dedupeOf).length,
      7,
    );
    roundsBeforeApproval = current.rounds;
    const decision = {
      operationId: randomUUID(),
      expectedRevision: approval.revision,
      payloadHash: approval.payload_hash,
      decision: "approve",
    };
    await Promise.all([
      api("/api/native-agent/approvals/" + approval.id, decision),
      api("/api/native-agent/approvals/" + approval.id, decision),
    ]);
    approvals++;
    approved.add(approval.id);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
const canvas = (await api("/api/projects/" + projectId + "/canvas")).canvas,
  current = snapshot.runs.find((r: any) => r.id === run.id);
const result = {
  actualSupplier: true,
  oneUserPrompt: true,
  authorizationCents: 100,
  budgetCents: remaining,
  priorUsedOrHeldCents: meter.cents,
  approvals,
  roundsBeforeApproval,
  rounds: current.rounds,
  status: current.status,
  errorCode: current.error_code,
  error: current.error_message,
  projectId,
  sessionId: session.id,
  runId: run.id,
  revision: canvas.revision,
  nodeCount: canvas.nodes.length,
  edgeCount: canvas.edges.length,
  plans: snapshot.plans,
  usage: snapshot.usage,
  sourceCount: new Set(
    snapshot.sources
      .filter((s: any) => s.runId === run.id)
      .map((s: any) => s.documentId),
  ).size,
};
await writeFile(
  root + "/artifacts/real-continuous-check.json",
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    status: result.status,
    errorCode: result.errorCode,
    approvals,
    nodeCount: result.nodeCount,
    edgeCount: result.edgeCount,
    rounds: result.rounds,
  }),
);
assert.equal(result.status, "completed");
assert.equal(approvals, 1);
assert.equal(canvas.nodes.length, 4);
assert.equal(canvas.edges.length, 3);
assert.equal(canvas.revision, 1);
assert.equal(current.rounds, roundsBeforeApproval);
assert.equal(result.sourceCount, 3);
for (const doc of docs) {
  const actual = await api(
    "/api/knowledge/" + space.id + "/documents/" + doc.id,
  );
  assert.equal(actual.markdown, doc.markdown);
}
