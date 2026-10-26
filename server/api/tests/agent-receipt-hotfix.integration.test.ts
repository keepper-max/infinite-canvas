import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { createDatabase } from "../src/db/client.js";
import { PostgresPlatformRepository } from "../src/repository.js";
import { KnowledgeService } from "../src/knowledge-service.js";
import { ModelGateway } from "../src/model-gateway.js";
import { JobService } from "../src/job-service.js";
import { CreditService } from "../src/credit-service.js";
import { BillingService } from "../src/billing-service.js";
import { PaidAgentModel } from "../src/native-agent/paid-model.js";
import { CompatibleAgentModel } from "../src/native-agent/model.js";
import { NativeAgentService } from "../src/native-agent/service.js";
import { readConfig } from "../src/config.js";
import { createApp } from "../src/app.js";
import { hashSessionToken } from "../src/auth.js";
const url = process.env.P251_TEST_DATABASE_URL;
test(
  "real PostgreSQL + HTTP interrupted stream preserves identity and never resubmits during reconciliation",
  { skip: !url, timeout: 120000 },
  async () => {
    assert.equal(url, "postgres://p25@127.0.0.1:55485/r21_regression_isolated");
    Object.assign(process.env, {
      NATIVE_AGENT_ENABLED: "true",
      NATIVE_AGENT_DEFAULT_ENABLED: "true",
      NATIVE_AGENT_PAID_ENABLED: "true",
      KNOWLEDGE_DEFAULT_ENABLED: "true",
    });
    const { db, pool } = createDatabase(url!),
      repo = new PostgresPlatformRepository(db),
      gateway = new ModelGateway(pool),
      knowledge = new KnowledgeService(db);
    const trace = "synthetic-" + randomUUID();
    let submissions = 0,
      reads = 0,
      queued = 0,
      unavailable = false;
    let ledgerGate: Promise<void> | undefined;
    const supplier = createServer(async (req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/pricing") {
        res.end(
          JSON.stringify({
            success: true,
            group_ratio: { default: 1 },
            data: [
              {
                model_name: "deepseek-v4.1-flash",
                quota_type: 0,
                model_ratio: 0.01,
                completion_ratio: 2,
                enable_groups: ["default"],
              },
            ],
          }),
        );
        return;
      }
      if (req.url === "/api/log/token") {
        reads++;
        await ledgerGate;
        if (unavailable) {
          res.writeHead(503).end();
          return;
        }
        res.end(
          JSON.stringify({
            success: true,
            data: [
              {
                request_id: trace,
                type: 2,
                model_name: "deepseek-v4.1-flash",
                quota: 3,
                prompt_tokens: 100,
                completion_tokens: 10,
              },
            ],
          }),
        );
        return;
      }
      if (req.url === "/v1/chat/completions" && req.method === "POST") {
        submissions++;
        for await (const _ of req) {
        }
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "x-oneapi-request-id": trace,
        });
        res.flushHeaders();
        res.write(
          "data: " +
            JSON.stringify({
              id: "synthetic-stream",
              object: "chat.completion.chunk",
              created: 1,
              model: "synthetic",
              choices: [
                {
                  index: 0,
                  delta: { content: "部分内容" },
                  finish_reason: null,
                },
              ],
            }) +
            "\n\n",
        );
        setTimeout(() => res.destroy(), 100);
        return;
      }
      res.writeHead(404).end();
    });
    supplier.listen(0, "127.0.0.1");
    await once(supplier, "listening");
    const provider = {
      baseUrl: "http://127.0.0.1:" + (supplier.address() as any).port,
      apiKey: "synthetic-only",
      catalogUrl: "",
    };
    const config = readConfig({
      DATABASE_URL: url!,
      REDIS_URL: "redis://127.0.0.1:56385",
      OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:59082",
      OBJECT_STORAGE_BUCKET: "unused",
      OBJECT_STORAGE_ACCESS_KEY_ID: "synthetic",
      OBJECT_STORAGE_SECRET_ACCESS_KEY: "synthetic",
      SESSION_COOKIE_NAME: "hotfix_session",
      TRUSTED_ORIGINS: "http://127.0.0.1:5230",
    });
    const credits = new CreditService(pool),
      billing = new BillingService(pool, provider, credits, provider);
    const jobs = new JobService(
      pool,
      {
        add: async () => {
          throw Error("no normal queue");
        },
        remove: async () => false,
      },
      gateway,
      config.jobs,
      async () => {},
      credits,
      billing,
    );
    class TestPaid extends PaidAgentModel {
      override async models() {
        return [
          {
            id: "pinhaozhan.text.deepseek-v4.1-flash",
            name: "Local fixture",
            substitute: true,
          },
        ];
      }
    }
    const paid = new TestPaid(
      pool,
      gateway,
      jobs,
      credits,
      billing,
      {} as any,
      config.jobs,
      provider,
      undefined,
      undefined,
      provider,
    );
    const originalPricing = (
      await pool.query(
        "select value from platform_settings where key='credit_pricing'",
      )
    ).rows[0].value;
    await pool.query(
      "update platform_settings set value=jsonb_set(value,'{usdCnyRate}','7.3'::jsonb) where key='credit_pricing'",
    );
    const service = new NativeAgentService(
      knowledge,
      pool,
      new CompatibleAgentModel(gateway, paid),
      async () => {
        queued++;
      },
      jobs,
    );
    try {
      const owner = await repo.createUserWithWorkspace(
          "hotfix-" + randomUUID() + "@example.test",
          "synthetic",
        ),
        actorId = owner.user.id,
        projectId = owner.workspace.projectId;
      await gateway.refreshPinhaozhanCatalog();
      await pool.query("update users set is_admin=true where id=$1", [actorId]);
      await credits.grant(
        actorId,
        actorId,
        {
          credits: 1000,
          source: "promotion",
          note: "synthetic isolated test",
          idempotencyKey: randomUUID(),
        },
        randomUUID(),
      );
      const session = await service.createSession(actorId, {
        projectId,
        title: "回执隔离验收",
        mode: "advice",
        operationId: randomUUID(),
      });
      const run = await service.start(actorId, session.id, {
        operationId: randomUUID(),
        modelId: "pinhaozhan.text.deepseek-v4.1-flash",
        mode: "advice",
        budgetCents: 100,
        prompt: "只读隔离测试",
      });
      await pool.query(
        "update native_agent_runs set plan_protocol=0,budget_limits=null where id=$1",
        [run.id],
      );
      await service.drive(run.id);
      const state = (
        await pool.query(
          "select j.*,s.input step_input from generation_jobs j join native_agent_model_jobs m on m.job_id=j.id join native_agent_steps s on s.id=m.step_id where m.run_id=$1",
          [run.id],
        )
      ).rows[0];
      console.log(
        JSON.stringify({
          submissions,
          reads,
          code: state.provider_error_code,
          message: state.user_error_message,
          detail: state.provider_error_sanitized,
          transport: state.step_input.transport,
        }),
      );
      assert.equal(state.billing_trace_id, trace);
      assert.equal(state.provider_submission_state, "unknown");
      assert.ok(state.step_input.transport.response_headers_received);
      assert.equal(state.step_input.providerStream.termination, "read_error");
      assert.ok(["UND_ERR_SOCKET", "ECONNRESET", "EPIPE"].includes(state.step_input.providerStream.readErrorCode));
      assert.ok(state.step_input.providerStream.bytes > 0);
      assert.equal(state.step_input.providerStream.doneSeen, false);
      assert.equal(state.step_input.providerStream.jsonErrors, 0);
      assert.equal(
        state.step_input.transport.failedPhase,
        "response_headers_received",
      );
      assert.equal(submissions, 1);
      assert.equal(
        (await service.snapshot(actorId, session.id)).runs[0].status,
        "awaiting_manual_review",
      );
      const before = await credits.account(actorId),
        queueBefore = queued;
      const results = await Promise.all([
        service.reconcile(actorId, run.id),
        service.reconcile(actorId, run.id),
      ]);
      assert.ok(
        results.every(
          (r) =>
            r.status === "awaiting_manual_review" &&
            r.message?.includes("已查到原请求扣费账单"),
        ),
      );
      assert.equal(queued, queueBefore);
      assert.equal(submissions, 1);
      assert.deepEqual(await credits.account(actorId), before);
      assert.equal(
        (
          await pool.query(
            "select count(*)::int n from generation_usage where job_id=$1",
            [state.id],
          )
        ).rows[0].n,
        0,
      );
      const other = await repo.createUserWithWorkspace(
          "hotfix-other-" + randomUUID() + "@example.test",
          "synthetic",
        ),
        readBefore = reads;
      await assert.rejects(service.reconcile(other.user.id, run.id));
      assert.equal(reads, readBefore);
      await pool.query(
        "insert into user_feature_grants(user_id,feature,enabled,updated_by,reason) values($1,'native_agent',false,$1,'isolated revoke') on conflict(user_id,feature) do update set enabled=false",
        [actorId],
      );
      await assert.rejects(service.reconcile(actorId, run.id), {
        code: "NATIVE_AGENT_NOT_ENABLED",
      });
      assert.equal(reads, readBefore);
      await pool.query(
        "update user_feature_grants set enabled=true where user_id=$1 and feature='native_agent'",
        [actorId],
      );
      unavailable = true;
      await assert.rejects(service.reconcile(actorId, run.id), {
        code: "AGENT_PROVIDER_UNAVAILABLE",
      });
      unavailable = false;
      const token = randomUUID();
      await repo.createSession(
        actorId,
        hashSessionToken(token),
        new Date(Date.now() + 60000),
      );
      const app = createApp(
        repo,
        config,
        undefined,
        jobs,
        gateway,
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
      const response = await app.request(
        "/api/native-agent/runs/" + run.id + "/reconcile",
        {
          method: "POST",
          headers: {
            cookie: "hotfix_session=" + token,
            origin: "http://127.0.0.1:5230",
          },
        },
      );
      assert.equal(response.status, 200);
      assert.match(
        (await response.json()).data.message,
        /已查到原请求扣费账单/,
      );
      assert.equal(
        (
          await app.request("/api/native-agent/runs/" + run.id + "/reconcile", {
            method: "POST",
          })
        ).status,
        401,
      );
      assert.equal(submissions, 1);
      assert.equal(queued, queueBefore);
      if (process.env.HOTFIX_BROWSER === "1") {
        const { verifyReceiptBrowser } =
          await import("../scripts/agent-receipt-browser.mjs");
        await verifyReceiptBrowser(app, {
          token,
          projectId,
          setUnavailable: (value: boolean) => {
            unavailable = value;
          },
          setReceiptGate: (value: Promise<void> | undefined) => { ledgerGate = value; },
          verifyEnded: async () => {
            const ended = (await pool.query("select status,reserved_cents from native_agent_runs where id=$1", [run.id])).rows[0];
            assert.equal(ended.status, "cancelled");
            assert.equal(ended.reserved_cents, 12);
            assert.deepEqual(await credits.account(actorId), before);
            assert.equal((await pool.query("select count(*)::int n from generation_usage where job_id=$1", [state.id])).rows[0].n, 0);
          },
          submissions: () => submissions,
        });
      }
      console.log(
        "PASS: interrupted HTTP stream, durable trace, concurrent inspections, no extra invoice/charge/queue/submission, ownership/revocation, supplier 503, authenticated API",
      );
    } finally {
      await pool.query(
        "update platform_settings set value=$1::jsonb where key='credit_pricing'",
        [JSON.stringify(originalPricing)],
      );
      supplier.closeAllConnections();
      await new Promise<void>((r) => supplier.close(() => r()));
      await pool.end();
    }
  },
);
