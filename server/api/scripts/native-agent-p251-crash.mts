import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createDatabase } from "../src/db/client.js";
import { PostgresPlatformRepository } from "../src/repository.js";
import { KnowledgeService } from "../src/knowledge-service.js";
import { ModelGateway } from "../src/model-gateway.js";
import { NativeAgentService } from "../src/native-agent/service.js";
import { CompatibleAgentModel } from "../src/native-agent/model.js";
const url = "postgres://p25@127.0.0.1:55485/p251_isolated";
process.env.NATIVE_AGENT_ENABLED = "true";
process.env.NATIVE_AGENT_DEFAULT_ENABLED = "true";
process.env.KNOWLEDGE_DEFAULT_ENABLED = "true";
process.env.NATIVE_AGENT_FIXTURE_URL = "http://127.0.0.1:3298/v1";
const { db, pool } = createDatabase(url),
  repo = new PostgresPlatformRepository(db),
  knowledge = new KnowledgeService(db),
  gateway = new ModelGateway(pool),
  service = new NativeAgentService(
    knowledge,
    pool,
    new CompatibleAgentModel(gateway),
    async () => {},
  );
const setup = async () => {
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
      prompt: "根据雾港世界观、林岚和周可创建第一集漫剧工作流",
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

const sleep = (n: number) => new Promise((r) => setTimeout(r, n));
let child: ReturnType<typeof spawn> | undefined,
  gate = await pool.connect(),
  logs = "";
const start = () => {
  child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/native-agent-p251-lab.mts", "--worker"],
    {
      cwd: "H:/CodexStorage/infinite-canvas-auth-upgrade/server/api",
      windowsHide: true,
      env: { ...process.env, P25_USE_PAID_MODEL: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.on("data", (b) => {
    logs = (logs + b.toString()).slice(-3000);
  });
  child.stderr?.on("data", (b) => {
    logs = (logs + b.toString()).slice(-3000);
  });
};
try {
  const f = await setup();
  await service.drive(f.run.id);
  const s: any = await f.snapshot(),
    a = s.approvals.at(-1);
  assert.equal(s.plans[0].expected_outputs.nodes.length, 4);
  await service.decide(f.actor, a.id, {
    operationId: randomUUID(),
    expectedRevision: a.revision,
    payloadHash: a.payload_hash,
    decision: "approve",
  });
  await gate.query("select pg_advisory_lock(87654321)");
  await pool.query(
    `create function p251_crash_gate() returns trigger language plpgsql as $$ begin if new.run_id='${f.run.id}'::uuid and new.status='completed' then perform pg_advisory_xact_lock(87654321); end if;return new;end $$`,
  );
  await pool.query(
    "create trigger p251_crash_gate before update on native_agent_plans for each row execute function p251_crash_gate()",
  );
  start();
  let blocked = false;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const c = await repo.getCanvasForUser(f.project, f.actor),
      waiting = await pool.query(
        "select count(*)::int n from pg_locks where locktype='advisory' and objid=87654321 and not granted",
      );
    if (c!.revision === 1 && waiting.rows[0].n > 0) {
      blocked = true;
      break;
    }
    await sleep(250);
  }
  assert.ok(
    blocked,
    "worker did not reach committed-CAS / pending receipt gate: " + logs,
  );
  const killedPid = child!.pid;
  child!.kill("SIGKILL");
  await new Promise((r) => child!.once("exit", r));
  child = undefined;
  assert.equal((await repo.getCanvasForUser(f.project, f.actor))!.revision, 1);
  assert.equal(((await f.snapshot()) as any).plans[0].status, "executing");
  await gate.query("select pg_advisory_unlock(87654321)");
  await pool.query("drop trigger p251_crash_gate on native_agent_plans");
  await pool.query("drop function p251_crash_gate()");
  start();
  let done: any;
  const recoveryDeadline = Date.now() + 120000;
  while (Date.now() < recoveryDeadline) {
    done = await f.snapshot();
    if (done.runs[0].status === "completed") break;
    await sleep(500);
  }
  assert.equal(done.runs[0].status, "completed", logs);
  const c = await repo.getCanvasForUser(f.project, f.actor);
  assert.equal(c!.revision, 1);
  assert.equal(c!.nodes.length, 4);
  assert.equal(c!.edges.length, 3);
  assert.equal(done.runs[0].rounds, s.runs[0].rounds);
  const receipts = await pool.query(
    "select count(*)::int n from canvas_operations where operation_id=$1",
    [a.id],
  );
  assert.equal(receipts.rows[0].n, 1);
  await writeFile(
    "H:/CodexStorage/shoushou-p251/artifacts/worker-crash.json",
    JSON.stringify(
      {
        projectId: f.project,
        runId: f.run.id,
        killedOwnWorkerPid: killedPid,
        status: done.runs[0].status,
        revision: c!.revision,
        nodeCount: c!.nodes.length,
        edgeCount: c!.edges.length,
        receipts: 1,
        newModelCallsAfterApproval: 0,
        crashBoundary:
          "CAS committed, plan materialization transaction blocked and rolled back",
      },
      null,
      2,
    ),
  );
  console.log("WORKER_CRASH_PASS", f.project);
} finally {
  child?.kill("SIGKILL");
  await gate.query("select pg_advisory_unlock(87654321)").catch(() => {});
  gate.release();
  await pool
    .query("drop trigger if exists p251_crash_gate on native_agent_plans")
    .catch(() => {});
  await pool.query("drop function if exists p251_crash_gate()").catch(() => {});
  await pool.end();
}
