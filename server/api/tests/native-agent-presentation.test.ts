import { isConversationOnly } from "../src/native-agent/conversation-intent.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  userPresentation,
  userEvent,
  redactTrace,
  safeTaskError,
  runControl,
} from "../src/native-agent/presentation.js";
const doc = "d75f113b-496c-46c6-aa56-6b392b6b1381",
  node = "ca2c9125-60bb-4733-9ea3-791df334a8db",
  op = "cdb6e3cc-8627-457b-bf67-9653243aed08";
const fixture = () => ({
  session: { id: "session" },
  runs: [{ id: "run", status: "completed", mode: "execute" }],
  messages: [
    {
      run_id: "run",
      turn_id: "run",
      item_id: "u",
      role: "user",
      content: "根据资料建立剧本流程",
    },
    {
      run_id: "run",
      turn_id: "run",
      item_id: "model",
      role: "assistant",
      content: `3个pinned知识节点 plannedNodeId=${node} operationId=${op}`,
    },
  ],
  steps: [
    { id: "model", run_id: "run", kind: "model" },
    {
      id: node,
      run_id: "run",
      kind: "tool",
      tool_name: "create_canvas_node",
      status: "completed",
      operation_id: op,
      input: {
        type: "knowledge:document",
        reference: { documentId: doc, mode: "pinned" },
      },
    },
  ],
  sources: [
    {
      runId: "run",
      documentId: doc,
      title: "世界观",
      contentHash: "source-hash-1234567890",
    },
  ],
  plans: [
    {
      id: "plan",
      run_id: "run",
      status: "completed",
      steps: [
        {
          stepId: node,
          toolName: "create_canvas_node",
          input: {
            type: "knowledge:document",
            reference: { documentId: doc, mode: "pinned" },
          },
        },
      ],
      outputs: {
        nodes: [{ id: node, type: "knowledge:document", title: "世界观" }],
        edges: [{ id: "edge" }],
        revision: 6,
      },
    },
  ],
  approvals: [],
  usage: [],
});
test("completed result uses receipt not model prose; original raw structure and hashes unchanged", () => {
  const raw = fixture(),
    before = JSON.stringify(raw),
    p = userPresentation(raw);
  assert.equal(JSON.stringify(raw), before);
  assert.equal(p.messages.length, 1);
  assert.equal(p.tasks[0].result?.knowledgeCount, 1);
  assert.equal(p.tasks[0].result?.edgeCount, 1);
  assert.equal(p.tasks[0].result?.saved, true);
  assert.ok(
    !JSON.stringify(
      p.tasks.map(
        ({ technicalTraceRef, runId, result, plan, progressItems, ...t }) => t,
      ),
    ).includes(op),
  );
  assert.match(p.tasks[0].summary, /已保存/);
  assert.match(p.tasks[0].plan!.items[0].title, /世界观/);
});
test("proposal, paused and failed tasks never claim persisted success", () => {
  for (const status of ["draft", "awaiting_approval", "executing"]) {
    const raw = fixture();
    raw.plans[0].status = status;
    raw.runs[0].status = "paused";
    assert.equal(userPresentation(raw).tasks[0].result, null);
  }
});
test("known internal identifiers in legacy prose get a neutral whole-message view, never destructive string replacement", () => {
  const raw = fixture();
  raw.plans = [];
  raw.steps = raw.steps.slice(0, 1);
  raw.messages[1].content = `结果 ["${op}"]`;
  raw.runs[0].operation_id = op;
  const p = userPresentation(raw);
  assert.match(p.messages[1].content, /历史回复/);
  assert.match(raw.messages[1].content, /结果/);
});
test("user authored operationId and requested technical explanation remain intact", () => {
  const raw = fixture();
  raw.plans = [];
  raw.steps = raw.steps.slice(0, 1);
  raw.messages[0].content = `帮我分析这段 operationId ${op}`;
  raw.messages[1].content = `operationId ${op} 是你给出的操作标识。`;
  assert.equal(
    userPresentation(raw).messages[1].content,
    raw.messages[1].content,
  );
  assert.equal(
    userPresentation(raw).messages[0].content,
    raw.messages[0].content,
  );
});
test("ordinary greeting and grounded discussion retain natural final answer", () => {
  const raw = fixture();
  raw.plans = [];
  raw.steps = raw.steps.slice(0, 1);
  raw.messages[0].content = "你好，你能帮我做什么？";
  raw.messages[1].content =
    "我可以帮你梳理设定、讨论剧本，或者在你确认后搭建创作流程。";
  assert.equal(
    userPresentation(raw).messages[1].content,
    raw.messages[1].content,
  );
});
test("raw deltas never flash through public events; required canvas sync metadata survives", () => {
  const raw = {
    id: 1,
    run_id: "run",
    type: "message.delta",
    data: { delta: `plannedNodeId=${node}` },
  };
  assert.deepEqual(userEvent(raw).data, {});
  assert.equal(raw.data.delta, `plannedNodeId=${node}`);
  assert.deepEqual(
    userEvent({
      ...raw,
      type: "canvas.saved",
      data: { revision: 7, nodeIds: [node], edgeIds: [], secret: "hidden" },
    }).data,
    { revision: 7, nodeIds: [node], edgeIds: [] },
  );
});
test("trace redacts secret fields/tokens; technical IDs remain available to authorized debugger", () => {
  const p = redactTrace({
    operationId: op,
    apiKey: "sensitive",
    headers: { Authorization: "Bearer bad" },
    nested: [{ cookie: "bad", text: "sk-test123" }],
  }) as any;
  assert.equal(p.operationId, op);
  assert.equal(p.apiKey, "[已脱敏]");
  assert.ok(!JSON.stringify(p).includes("Bearer bad"));
  assert.ok(!JSON.stringify(p).includes("sk-test123"));
});
test("errors preserve conflicts, payment uncertainty and permission consequences in plain language", () => {
  assert.match(safeTaskError("CANVAS_REVISION_CONFLICT"), /避免覆盖/);
  assert.match(safeTaskError("AGENT_BILLING_UNCONFIRMED"), /费用/);
  assert.match(safeTaskError("AGENT_TOKEN_LIMIT"), /预算/);
  assert.match(safeTaskError("FORBIDDEN"), /权限/);
});

test("conversation completion does not waive explicit write plan checks", () => {
  assert.equal(isConversationOnly("你好，你能帮我做什么？"), true);
  assert.equal(isConversationOnly("你觉得雾港剧本怎么样？"), true);
  assert.equal(isConversationOnly("你好，创建四个节点并连接"), false);
  assert.equal(isConversationOnly("根据资料搭建剧本工作流"), false);
  assert.deepEqual(
    runControl({
      id: "r",
      revision: 2,
      operation_id: "op",
      context: ["private"],
      pending_calls: [{}],
      sources: [],
      payload_hash: "private",
    }),
    { id: "r", revision: 2, operation_id: "op" },
  );
});

test("knowledge and canvas update plans show accurate business consequences and existing node names", () => {
  const raw = fixture();
  raw.plans[0].steps = [
    {
      stepId: "edit",
      toolName: "update_canvas_node",
      input: {
        nodeId: "existing",
        title: "新标题",
        content: "正文",
        position: { x: 3, y: 4 },
      },
    },
  ] as any;
  const p = userPresentation(raw, [{ id: "existing", title: "原剧本" }]);
  assert.match(p.tasks[0].plan!.items[0].title, /原剧本/);
  assert.match(p.tasks[0].plan!.items[0].description, /横向 3/);
  raw.plans[0].steps = [
    {
      stepId: "doc",
      toolName: "create_knowledge_document",
      input: { title: "新文档", markdown: "# 原文不改" },
    },
  ] as any;
  const doc = userPresentation(raw);
  assert.match(doc.tasks[0].plan!.consequence, /知识文档/);
  assert.equal(doc.tasks[0].plan!.items[0].description, "# 原文不改");
});

test("unknown historical receipt shape is neutral, never a fabricated saved result", () => {
  const raw = fixture();
  raw.plans[0].outputs = { unrecognized: true } as any;
  const p = userPresentation(raw);
  assert.equal(p.tasks[0].result, null);
  assert.match(p.tasks[0].summary, /无法完整还原/);
});

test("fixed source version is a user-visible business choice without protocol fields", () => {
  const raw = fixture();
  (raw.plans[0].steps[0].input.reference as any).revision = 3;
  assert.match(
    userPresentation(raw).tasks[0].plan!.items[0].description,
    /资料版本 3/,
  );
  assert.ok(
    !userPresentation(raw).tasks[0].plan!.items[0].description.includes(
      "revision",
    ),
  );
});

test("friendly result sentence derives connected sources and target from actual receipt edges", () => {
  const raw = fixture();
  raw.plans[0].outputs.nodes.push({
    id: "text",
    type: "text",
    title: "第一集剧本",
  });
  raw.plans[0].outputs.edges = [
    { id: "edge", fromNodeId: node, toNodeId: "text" },
  ] as any;
  const p = userPresentation(raw);
  assert.match(p.tasks[0].summary, /1 份资料已连接到《第一集剧本》/);
  raw.plans[0].outputs.edges = [];
  assert.ok(!userPresentation(raw).tasks[0].summary.includes("已连接到"));
});

test("unrequested UUID and reasoning or credential-shaped text never enter safe conversation projection",()=>{for(const text of ["内部编号 8a911b12-d2ec-4ea0-8d13-b5cd5e390833","<think>内部推理</think>回答","密钥 sk-synthetic12345678901234567890"]){const raw=fixture();raw.plans=[];raw.steps=[];raw.messages[1].content=text;const before=JSON.stringify(raw);assert.ok(!userPresentation(raw).messages[1].content.includes(text));assert.equal(JSON.stringify(raw),before);}});
test("an explicitly supplied user UUID stays readable instead of global identifier deletion",()=>{const raw=fixture();raw.plans=[];raw.steps=[];const id="8a911b12-d2ec-4ea0-8d13-b5cd5e390833";raw.messages[0].content="请解释我提供的编号 "+id;raw.messages[1].content="你提供的编号是 "+id;assert.equal(userPresentation(raw).messages[1].content,raw.messages[1].content);});
