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
import { NativeAgentService } from "../src/native-agent/service.js";
import { CompatibleAgentModel } from "../src/native-agent/model.js";
import { readConfig } from "../src/config.js";
import { DEEPSEEK_AGENT_MODEL } from "../src/native-agent/model-clock.js";
const url = process.env.P251_TEST_DATABASE_URL;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
test(
  "real PostgreSQL/HTTP DeepSeek: slow fresh checks overlap; independent inference clock; failures and revocation never submit or charge",
  { skip: !url, timeout: 150000 },
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
      knowledge = new KnowledgeService(db),
      credits = new CreditService(pool);
    type State = {
      name: string;
      posts: number;
      pricingStarted: boolean;
      ledgerStarted: boolean;
      overlap: boolean;
      receipts: any[];
      onPricing?: () => Promise<void>;
    };
    let current: State = {
      name: "setup",
      posts: 0,
      pricingStarted: false,
      ledgerStarted: false,
      overlap: false,
      receipts: [],
    };
    const supplier = createServer(async (req, res) => {
      const s = current;
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/pricing") {
        s.pricingStarted = true;
        await s.onPricing?.();
        await sleep(s.name === "preflight-timeout" ? 6500 : 3000);
        s.overlap = s.ledgerStarted;
        if (res.destroyed) return;
        res.end(
          JSON.stringify(
            s.name === "price-invalid"
              ? { success: false }
              : {
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
                },
          ),
        );
        return;
      }
      if (req.url === "/api/log/token") {
        assert.equal(req.headers.authorization, "Bearer synthetic-only");
        s.ledgerStarted = true;
        await sleep(300);
        if (res.destroyed) return;
        if (s.name === "ledger-forbidden") {
          res.writeHead(403).end();
          return;
        }
        res.end(JSON.stringify({ success: true, data: s.receipts }));
        return;
      }
      if (req.url === "/v1/chat/completions") {
        s.posts++;
        assert.ok(s.overlap, "both fresh checks must finish before POST");
        if (s.name === "inference-timeout") return;
        await sleep(2500);
        if (res.destroyed) return;
        const trace = "synthetic-" + req.headers["x-request-id"];
        s.receipts.push({
          request_id: trace,
          type: 2,
          model_name: "deepseek-v4.1-flash",
          quota: 3,
          prompt_tokens: 100,
          completion_tokens: 10,
        });
        const event = (
          delta: unknown,
          finish_reason: unknown = null,
          usage?: unknown,
        ) =>
          "data: " +
          JSON.stringify({
            id: trace,
            object: "chat.completion.chunk",
            created: 1,
            model: "deepseek-v4.1-flash",
            choices: [{ index: 0, delta, finish_reason }],
            ...(usage ? { usage } : {}),
          }) +
          "\n\n";
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "x-oneapi-request-id": trace,
        });
        res.end(
          event({
            role: "assistant",
            content: "可以先确定影片风格，再细化脚本。",
          }) +
            event({}, "stop", {
              prompt_tokens: 100,
              completion_tokens: 10,
              total_tokens: 110,
            }) +
            "data: [DONE]\n\n",
        );
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
      OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:59082",
      OBJECT_STORAGE_BUCKET: "unused",
      OBJECT_STORAGE_ACCESS_KEY_ID: "synthetic",
      OBJECT_STORAGE_SECRET_ACCESS_KEY: "synthetic",
    });
    const billing = new BillingService(pool, provider, credits, provider),
      jobs = new JobService(
        pool,
        {
          add: async () => {
            throw Error("must not enqueue paid test on normal queue");
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
            id: DEEPSEEK_AGENT_MODEL,
            name: "isolated HTTP supplier",
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
      ),
      service = new NativeAgentService(
        knowledge,
        pool,
        new CompatibleAgentModel(gateway, paid),
        async () => {},
        jobs,
      );
    const pricing = (
      await pool.query(
        "select value from platform_settings where key='credit_pricing'",
      )
    ).rows[0].value;
    const report: any[] = [];
    try {
      await pool.query(
        "update platform_settings set value=jsonb_set(value,'{usdCnyRate}','7.3'::jsonb) where key='credit_pricing'",
      );
      await gateway.refreshPinhaozhanCatalog();
      for (const name of [
        "slow-success",
        "price-invalid",
        "ledger-forbidden",
        "cancel",
        "revoked",
        "preflight-timeout",
        "inference-timeout",
      ]) {
        const u = await repo.createUserWithWorkspace(
            "ds-phase-" + randomUUID() + "@example.test",
            "synthetic",
          ),
          actor = u.user.id,
          project = u.workspace.projectId;
        await pool.query("update users set is_admin=true where id=$1", [actor]);
        await credits.grant(
          actor,
          actor,
          {
            credits: 1000,
            source: "promotion",
            note: "isolated synthetic only",
            idempotencyKey: randomUUID(),
          },
          randomUUID(),
        );
        const session = await service.createSession(actor, {
            projectId: project,
            mode: "advice",
            title: "DeepSeek阶段计时",
            operationId: randomUUID(),
          }),
          payload = {
            operationId: randomUUID(),
            modelId: DEEPSEEK_AGENT_MODEL,
            mode: "advice",
            budgetCents: 100,
            prompt: "只讨论10秒短片创意，不写画布",
          };
        const run = await service.start(actor, session.id, payload);
        await pool.query(
          "update native_agent_runs set plan_protocol=0,budget_limits=budget_limits||'{\"modelMs\":5000}'::jsonb where id=$1",
          [run.id],
        );
        current = {
          name,
          posts: 0,
          pricingStarted: false,
          ledgerStarted: false,
          overlap: false,
          receipts: [],
        };
        if (name === "cancel")
          current.onPricing = () =>
            service.cancel(actor, run.id).then(() => {});
        if (name === "revoked")
          current.onPricing = () =>
            pool
              .query(
                "insert into user_feature_grants(user_id,feature,enabled,updated_by,reason) values($1,'native_agent',false,$1,'isolated revoke') on conflict(user_id,feature) do update set enabled=false",
                [actor],
              )
              .then(() => {});
        const before = await credits.account(actor),
          started = Date.now();
        await service.drive(run.id);
        const elapsedMs = Date.now() - started,
          s = current;
        const state = (
            await pool.query(
              "select r.status,r.spent_cents,r.reserved_cents,r.error_code,s.input from native_agent_runs r join native_agent_steps s on s.run_id=r.id where r.id=$1 and s.kind='model'",
              [run.id],
            )
          ).rows[0],
          job = (
            await pool.query(
              "select j.* from generation_jobs j join native_agent_model_jobs m on m.job_id=j.id where m.run_id=$1",
              [run.id],
            )
          ).rows[0];
        console.log(
          JSON.stringify({
            case: name,
            status: state.status,
            error: state.error_code,
            jobCode: job.user_error_code,
            jobMessage: job.user_error_message,
            transport: state.input.transport,
            posts: s.posts,
          }),
        );
        assert.equal(state.input.transportBudget.preflightMs, 5000);
        assert.equal(state.input.transportBudget.inferenceMs, 5000);
        assert.equal(state.input.transportBudget.maxRoundMs, 10000);
        if (name === "slow-success") {
          assert.equal(state.status, "completed");
          assert.equal(s.posts, 1);
          assert.ok(s.overlap);
          assert.ok(elapsedMs > 5000, "exceeds former combined timer");
          assert.ok(state.input.transport.pricing_completed);
          assert.ok(state.input.transport.ledger_completed);
          assert.ok(state.input.transport.submission_started);
          assert.equal(job.billing_status, "settled");
          assert.equal(state.spent_cents, 1);
          assert.equal(state.reserved_cents, 0);
          assert.equal(
            (await service.start(actor, session.id, payload)).id,
            run.id,
          );
          await service.drive(run.id);
          assert.equal(
            s.posts,
            1,
            "lost response/repeated drive cannot resubmit",
          );
        } else if (name === "inference-timeout") {
          assert.equal(s.posts, 1);
          assert.equal(job.provider_submission_state, "unknown");
          assert.equal(state.status, "awaiting_manual_review");
          assert.equal(state.spent_cents, 0);
          assert.equal(state.reserved_cents, 12);
          await service.drive(run.id);
          assert.equal(s.posts, 1);
        } else {
          if (name === "ledger-forbidden")
            assert.equal(
              state.input.transport.failedPhase,
              "preflight_failed_ledger",
            );
          if (name === "price-invalid")
            assert.equal(
              state.input.transport.failedPhase,
              "preflight_failed_pricing",
            );
          assert.equal(s.posts, 0);
          assert.equal(state.spent_cents, 0);
          assert.equal(state.reserved_cents, 0);
          assert.equal(job.provider_submission_state, "rejected");
          const after = await credits.account(actor);
          const expected = structuredClone(before),
            actual = structuredClone(after);
          delete (expected.account as any).updatedAt;
          delete (actual.account as any).updatedAt;
          assert.deepEqual(actual, expected);
          assert.equal(
            (
              await pool.query(
                "select count(*)::int n from generation_usage where job_id=$1 and (credit_points>0 or cost_cny>0)",
                [job.id],
              )
            ).rows[0].n,
            0,
          );
        }
        report.push({
          case: name,
          elapsedMs,
          submissions: s.posts,
          status: state.status,
          spentPoints: state.spent_cents,
          reservedPoints: state.reserved_cents,
        });
      }
      console.log(
        JSON.stringify({
          realPostgres: true,
          realHttp: true,
          scaledTestStageMs: 5000,
          productionStageMs: 60000,
          cases: report,
          realSupplierCalls: 0,
        }),
      );
    } finally {
      await pool.query(
        "update platform_settings set value=$1::jsonb where key='credit_pricing'",
        [JSON.stringify(pricing)],
      );
      supplier.closeAllConnections();
      await new Promise<void>((r) => supplier.close(() => r()));
      await pool.end();
    }
  },
);
