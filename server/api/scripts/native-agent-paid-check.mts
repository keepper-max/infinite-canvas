import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../src/db/client.js";
import { PostgresPlatformRepository } from "../src/repository.js";
import { KnowledgeService } from "../src/knowledge-service.js";
import { CreditService } from "../src/credit-service.js";
import { hashSessionToken } from "../src/auth.js";
import { AGENT_LIMITS } from "../src/native-agent/limits.js";
const root = "H:/CodexStorage/shoushou-p25",
  url = "postgres://p25@127.0.0.1:55485/p25_isolated";
const { db, pool } = createDatabase(url),
  repo = new PostgresPlatformRepository(db),
  knowledge = new KnowledgeService(db),
  credits = new CreditService(pool);
process.env.KNOWLEDGE_DEFAULT_ENABLED = "true";
let fixture: any;
try {
  try {
    fixture = JSON.parse(
      await readFile(root + "/private/paid-fixture.json", "utf8"),
    );
  } catch {
    const owner = await repo.createUserWithWorkspace(
      "p25-real-agent-" + randomUUID() + "@example.test",
      "synthetic",
    );
    fixture = {
      ownerId: owner.user.id,
      projectId: owner.workspace.projectId,
      token: randomUUID(),
    };
    await repo.updateProjectForUser(fixture.projectId, fixture.ownerId, {
      name: "雾港 AI 漫剧 · 真实低价模型隔离验收",
    });
    await pool.query("update users set is_admin=true where id=$1", [
      fixture.ownerId,
    ]);
    await credits.grant(
      fixture.ownerId,
      fixture.ownerId,
      {
        credits: 1000,
        source: "promotion",
        note: "Synthetic isolated ledger; not production balance",
        idempotencyKey: "p25-real-model-local-credits",
      },
      randomUUID(),
    );
    await pool.query("update users set is_admin=false where id=$1", [
      fixture.ownerId,
    ]);
    await repo.createSession(
      fixture.ownerId,
      hashSessionToken(fixture.token),
      new Date(Date.now() + 7 * 86400000),
    );
    const space = await knowledge.createSpace(
      fixture.ownerId,
      "project",
      fixture.projectId,
      randomUUID(),
    );
    fixture.spaceId = space.id;
    fixture.docs = [];
    for (const [title, markdown] of [
      ["雾港世界观", "# 雾港\n海雾封锁的港城，旧灯塔保存航道的秘密。"],
      [
        "林岚人物设定",
        "# 林岚\n冷静的调查员，寻找失踪父亲，怀疑雾港灯塔藏着线索。[[雾港世界观]]",
      ],
      [
        "周可人物设定",
        "# 周可\n幽默的灯塔维修师，与[[林岚人物设定]]一起调查失踪事件。",
      ],
    ])
      fixture.docs.push(
        await knowledge.write(fixture.ownerId, space.id, {
          operationId: randomUUID(),
          action: "document.create",
          payload: { title, markdown, folderId: null },
        }),
      );
    await writeFile(
      root + "/private/paid-fixture.json",
      JSON.stringify(fixture),
    );
  }
  const prior = (
    await pool.query(
      "select coalesce(sum(case when m.status='settled' then m.settled_cents else m.quote_cents end),0)::int cents from native_agent_model_jobs m where m.actor_id=$1",
      [fixture.ownerId],
    )
  ).rows[0].cents;
  const remaining = 100 - Number(prior);
  if (remaining < 10)
    throw new Error(
      "Prior real-test spending or uncertain reservations leave insufficient CNY1 total budget; no new request.",
    );
  const api = async (path: string, body?: unknown) => {
    const r = await fetch("http://127.0.0.1:3195" + path, {
      method: body ? "POST" : "GET",
      headers: {
        cookie: "p25_session=" + fixture.token,
        ...(body
          ? {
              "content-type": "application/json",
              origin: "http://127.0.0.1:3195",
            }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const p = (await r.json()) as any;
    if (!r.ok)
      throw new Error(r.status + " " + p.error?.code + " " + p.error?.message);
    return p.data;
  };
  const rejected = (
    await pool.query(
      "select r.id from native_agent_runs r join native_agent_model_jobs m on m.run_id=r.id join generation_jobs j on j.id=m.job_id where r.actor_id=$1 and r.status='awaiting_manual_review' and m.status='settled' and m.settled_cents=0 and j.provider_submission_state='rejected' and j.billing_status='settled'",
      [fixture.ownerId],
    )
  ).rows;
  for (const previous of rejected)
    await api("/api/native-agent/runs/" + previous.id + "/cancel", {});
  const resumeId = process.env.P25_REAL_RESUME_RUN;
  const previous = resumeId
    ? (
        await pool.query(
          "select * from native_agent_runs where id=$1 and actor_id=$2",
          [resumeId, fixture.ownerId],
        )
      ).rows[0]
    : null;
  if (resumeId && !previous)
    throw new Error("Resume run does not belong to this dedicated test user");
  const session = previous
    ? { id: previous.session_id }
    : process.env.P25_REAL_CONTINUE_SESSION
      ? { id: process.env.P25_REAL_CONTINUE_SESSION }
      : await api("/api/native-agent/sessions", {
          projectId: fixture.projectId,
          title: "真实工具调用 · 雾港",
          mode: "execute",
          operationId: randomUUID(),
        });
  const originalPrompt =
    "请实际调用工具，读取当前项目已有的《雾港世界观》《林岚人物设定》《周可人物设定》三个不同的知识文档。不要新建或修改知识文档。用它们创建3个固定版本 knowledge:document 引用节点，再创建1个text节点，标题为第一集剧本创作，正文结合读到的三份资料给出简短的剧本创作任务。先读取最新canvas revision，然后提交创建计划等待用户审批，获得真实节点ID后，再读取最新revision并提交三个知识节点 knowledge.output 连接到该文本节点 text.input 的计划。必须实际保存4个节点和3条连接；不调用任何付费媒体工具。输出简洁，勿输出长段思考。";
  const prompt =
    process.env.P25_REAL_PROMPT ||
    (process.env.P25_REAL_CONTINUE_SESSION
      ? "继续上一计划。我确认你可以提交写入提案：请先实际调用read_knowledge读取三篇文档正文，再调用create_canvas_node提出创建计划；平台会自动展示审批，不要只用自然语言问我是否确认。审批后继续获取真实节点ID并调用connect_canvas_nodes提出三条连线。仍然只允许3个固定知识引用节点、1个文本节点和3条知识正文输入连线，不允许新建知识文档或付费媒体。"
      : originalPrompt);
  const run =
    previous ||
    (await api("/api/native-agent/sessions/" + session.id + "/runs", {
      operationId: randomUUID(),
      prompt,
      modelId: process.env.P25_REAL_MODEL_ID || "catalog.text.gpt-4.1-mini",
      mode: "execute",
      budgetCents: remaining,
    }));
  if (previous)
    await api("/api/native-agent/runs/" + previous.id + "/reconcile", {});
  await writeFile(
    root + "/artifacts/real-model-current.json",
    JSON.stringify({
      runId: run.id,
      sessionId: session.id,
      projectId: fixture.projectId,
      budgetCents: remaining,
    }),
  );
  const approvals: string[] = [];
  let snapshot: any;
  const deadline = Date.now() + AGENT_LIMITS.activeMs;
  while (Date.now() < deadline) {
    snapshot = await api("/api/native-agent/sessions/" + session.id);
    const r = snapshot.runs.find((r: any) => r.id === run.id);
    if (
      ["completed", "failed", "cancelled", "awaiting_manual_review"].includes(
        r.status,
      )
    )
      break;
    const plan = snapshot.approvals.find((a: any) => a.status === "pending");
    if (plan && !approvals.includes(plan.id)) {
      for (const item of plan.preview) {
        if (!["create_canvas_node", "connect_canvas_nodes"].includes(item.tool))
          throw new Error("Unapproved tool in real model plan: " + item.tool);
        const p = item.parameters;
        if (
          item.tool === "create_canvas_node" &&
          p.type === "knowledge:document" &&
          !fixture.docs.some(
            (d: any) =>
              d.id === p.reference.documentId &&
              p.reference.spaceId === fixture.spaceId,
          )
        )
          throw new Error("Model requested an unrelated knowledge source");
        if (
          item.tool === "create_canvas_node" &&
          !["text", "knowledge:document"].includes(p.type)
        )
          throw new Error("Unexpected node type");
      }
      await api("/api/native-agent/approvals/" + plan.id, {
        operationId: randomUUID(),
        expectedRevision: plan.revision,
        payloadHash: plan.payload_hash,
        decision: "approve",
      });
      approvals.push(plan.id);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const canvas = await repo.getCanvasForUser(
    fixture.projectId,
    fixture.ownerId,
  );
  const usage = (
    await pool.query(
      "select u.step_id,u.job_id,u.input_tokens,u.output_tokens,u.supplier_cents,u.meter_status,g.amount_final::text,g.currency,g.provider_request_id from native_agent_usage u left join generation_usage g on g.job_id=u.job_id where u.run_id=$1 order by u.created_at",
      [run.id],
    )
  ).rows;
  const requests = (
    await pool.query(
      "select s.id,s.input->>'protocolRequestHash' request_hash,s.input->'protocolRequest'->'messages' messages from native_agent_steps s where s.run_id in (select id from native_agent_runs where session_id=$1) and s.kind='model' order by s.created_at",
      [session.id],
    )
  ).rows;
  const sourceEvidence = fixture.docs.map((doc: any) => ({
    documentId: doc.id,
    title: doc.title,
    contentHash: doc.contentHash,
    bodyObserved: requests.some((r: any) =>
      (r.messages || []).some((m: any) => {
        if (m.role !== "tool") return false;
        try {
          const value = JSON.parse(m.content);
          return value.documentId === doc.id && value.markdown === doc.markdown;
        } catch {
          return false;
        }
      }),
    ),
  }));
  const result = {
    runId: run.id,
    sessionId: session.id,
    projectId: fixture.projectId,
    status: snapshot.runs.at(-1).status,
    error: snapshot.runs.at(-1).error_message,
    rounds: snapshot.runs.at(-1).rounds,
    toolCount: snapshot.runs.at(-1).tool_count,
    approvals,
    usage,
    sourceEvidence,
    revision: canvas?.revision,
    nodes: canvas?.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      reference: n.metadata?.knowledgeReference,
    })),
    edges: canvas?.edges,
    actualSupplier: true,
    productionDataChanged: false,
  };
  await writeFile(
    root + "/artifacts/real-model-check.json",
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      status: result.status,
      rounds: result.rounds,
      nodes: result.nodes?.length,
      edges: result.edges?.length,
      approvalCount: approvals.length,
      runId: run.id,
    }),
  );
  if (
    result.status !== "completed" ||
    result.nodes?.length !== 4 ||
    result.edges?.length !== 3 ||
    sourceEvidence.some((e) => !e.bodyObserved)
  )
    throw new Error(
      "Real model acceptance incomplete; inspect sanitized artifact, do not blindly retry.",
    );
} finally {
  await pool.end();
}
