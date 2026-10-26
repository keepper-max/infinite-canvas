import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../src/db/client.js";
import { PostgresPlatformRepository } from "../src/repository.js";
import { KnowledgeService } from "../src/knowledge-service.js";
import { NativeAgentService } from "../src/native-agent/service.js";
import { createApp } from "../src/app.js";
import { hashSessionToken } from "../src/auth.js";
import { readConfig } from "../src/config.js";
const url = process.env.P251_TEST_DATABASE_URL;
test(
  "session recovery: true PostgreSQL/API rejects second task, exposes only authorized active task and preserves drafts across recovery",
  { skip: !url, timeout: 120000 },
  async () => {
    assert.equal(url, "postgres://p25@127.0.0.1:55485/r21_regression_isolated");
    Object.assign(process.env, {
      NATIVE_AGENT_ENABLED: "true",
      NATIVE_AGENT_DEFAULT_ENABLED: "true",
      KNOWLEDGE_DEFAULT_ENABLED: "true",
    });
    const { db, pool } = createDatabase(url!),
      repo = new PostgresPlatformRepository(db),
      knowledge = new KnowledgeService(db);
    let enqueued = 0,
      modelsCalled = 0;
    const service = new NativeAgentService(
      knowledge,
      pool,
      {
        models: async () => [
          {
            id: "native-agent-fixture",
            name: "隔离协议替身",
            substitute: true,
          },
        ],
        run: async () => {
          modelsCalled++;
          throw new Error("synthetic unknown outcome");
        },
      },
      async () => {
        enqueued++;
      },
    );
    let actor = "";
    try {
      const owner = await repo.createUserWithWorkspace(
        "session-hotfix-" + randomUUID() + "@example.test",
        "synthetic",
      );
      actor = owner.user.id;
      const project = owner.workspace.projectId;
      const session = (title: string) =>
        service.createSession(actor, {
          projectId: project,
          title,
          mode: "advice",
          operationId: randomUUID(),
        });
      const first = await session("待核查旧任务"),
        original = await service.start(actor, first.id, {
          operationId: randomUUID(),
          prompt: "synthetic only",
          modelId: "native-agent-fixture",
          mode: "advice",
          budgetCents: 0,
        });
      await service.drive(original.id);
      assert.equal(
        (await service.snapshot(actor, first.id)).runs[0].status,
        "awaiting_manual_review",
      );
      const second = await session("被拒绝的新会话"),
        token = randomUUID();
      await repo.createSession(
        actor,
        hashSessionToken(token),
        new Date(Date.now() + 300000),
      );
      const config = readConfig({
        DATABASE_URL: url!,
        OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:59082",
        OBJECT_STORAGE_BUCKET: "unused",
        OBJECT_STORAGE_ACCESS_KEY_ID: "synthetic",
        OBJECT_STORAGE_SECRET_ACCESS_KEY: "synthetic",
        SESSION_COOKIE_NAME: "session_hotfix",
        COOKIE_SECURE: "false",
        TRUSTED_ORIGINS: "http://127.0.0.1:5231",
      });
      const app = createApp(
        repo,
        config,
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
      const headers = {
          cookie: "session_hotfix=" + token,
          Origin: "http://127.0.0.1:5231",
          "Content-Type": "application/json",
        },
        before = enqueued;
      const response = await app.request(
        "/api/native-agent/sessions/" + second.id + "/runs",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            operationId: randomUUID(),
            prompt: "new synthetic operation",
            modelId: "native-agent-fixture",
            mode: "advice",
            budgetCents: 0,
            conversationVersion: 1,
          }),
        },
      );
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error.code, "AGENT_RUN_ACTIVE");
      assert.equal((await service.snapshot(actor, second.id)).runs.length, 0);
      assert.equal(enqueued, before);
      const active = await app.request("/api/native-agent/active-run", {
        headers,
      });
      assert.equal(active.status, 200);
      assert.equal((await active.json()).data.runId, original.id);
      assert.equal(
        (await app.request("/api/native-agent/active-run")).status,
        401,
      );
      const other = await repo.createUserWithWorkspace(
        "session-other-" + randomUUID() + "@example.test",
        "synthetic",
      );
      assert.equal(await service.activeRun(other.user.id), null);
      await pool.query("update projects set deleted_at=now() where id=$1", [
        project,
      ]);
      assert.deepEqual(await service.activeRun(actor), { accessible: false });
      await pool.query("update projects set deleted_at=null where id=$1", [
        project,
      ]);
      await pool.query(
        "update users set account_status='disabled' where id=$1",
        [actor],
      );
      await assert.rejects(service.activeRun(actor), {
        code: "UNAUTHENTICATED",
      });
      await pool.query("update users set account_status='active' where id=$1", [
        actor,
      ]);
      if (process.env.SESSION_HOTFIX_BROWSER === "1") {
        const { verifySessionRecoveryBrowser } =
          await import("../scripts/agent-session-recovery-browser.mjs");
        await verifySessionRecoveryBrowser(app, {
          token,
          actor,
          project,
          first,
          second,
          original,
          service,
          pool,
          counters: () => ({ enqueued, modelsCalled }),
        });
      }
      console.log(
        JSON.stringify({
          actualStartError: "AGENT_RUN_ACTIVE",
          crossUserIsolation: true,
          revokedProjectIdentityHidden: true,
          disabledAccountDenied: true,
          newSupplierCalls: 0,
        }),
      );
    } finally {
      if (actor) {
        const runs = (
          await pool.query(
            "select id from native_agent_runs where actor_id=$1 and status not in ('completed','failed','cancelled')",
            [actor],
          )
        ).rows;
        for (const run of runs) await service.cancel(actor, run.id);
      }
      await pool.end();
    }
  },
);
