import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createDatabase } from "../src/db/client.js";
import { PostgresPlatformRepository } from "../src/repository.js";
import { KnowledgeService } from "../src/knowledge-service.js";
import { ModelGateway } from "../src/model-gateway.js";
import { JobService, JobExecutor } from "../src/job-service.js";
import { CreditService } from "../src/credit-service.js";
import { BillingService } from "../src/billing-service.js";
import { S3ObjectStorage } from "../src/object-storage.js";
import { readConfig } from "../src/config.js";
import { NativeAgentService } from "../src/native-agent/service.js";
import { PaidAgentModel } from "../src/native-agent/paid-model.js";
import { PAID_AGENT_UPSTREAM } from "../src/native-agent/model-job-policy.js";
import { DomainError } from "../src/domain.js";
import { startFixture } from "../scripts/native-agent-fixture.mjs";
const url = process.env.P25_TEST_DATABASE_URL;
test(
  "native model bridge uses real JobService/Executor and credits with HTTP vendor substitute",
  { skip: !url, timeout: 120000 },
  async () => {
    assert.ok(["postgres://p25@127.0.0.1:55485/p25_isolated","postgres://p25@127.0.0.1:55485/p251_isolated","postgres://p25@127.0.0.1:55485/r2_isolated","postgres://p25@127.0.0.1:55485/r21_regression_isolated"].includes(url!));
    process.env.NATIVE_AGENT_ENABLED = "true";
    process.env.NATIVE_AGENT_DEFAULT_ENABLED = "true";
    process.env.NATIVE_AGENT_PAID_ENABLED = "true";
    process.env.KNOWLEDGE_DEFAULT_ENABLED = "true";
    const { db, pool } = createDatabase(url!),
      repo = new PostgresPlatformRepository(db),
      gateway = new ModelGateway(pool),
      knowledge = new KnowledgeService(db),
      fixture = startFixture(3297);
    let submissions = 0;
    fixture.on("request", (req) => {
      if (req.url === "/v1/chat/completions") submissions++;
    });
    const config = readConfig({
      DATABASE_URL: url!,
      REDIS_URL: "redis://127.0.0.1:56385",
      OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:59000",
      OBJECT_STORAGE_BUCKET: "unused",
      OBJECT_STORAGE_ACCESS_KEY_ID: "synthetic",
      OBJECT_STORAGE_SECRET_ACCESS_KEY: "synthetic",
    });
    const owner = await repo.createUserWithWorkspace(
        "p25-billing-" + randomUUID() + "@example.test",
        "synthetic",
      ),
      other = await repo.createUserWithWorkspace(
        "p25-billing-other-" + randomUUID() + "@example.test",
        "synthetic",
      );
    const actorId = owner.user.id,
      projectId = owner.workspace.projectId,
      credits = new CreditService(pool),
      billing = new BillingService(pool, config.provider, credits),
      storage = new S3ObjectStorage(config.objectStorage);
    const jobs = new JobService(
      pool,
      {
        add: async () => {
          throw new Error(
            "native model must not enqueue on normal generation queue",
          );
        },
        remove: async () => false,
      },
      gateway,
      config.jobs,
      async () => undefined,
      credits,
      billing,
    );
    const paid = new PaidAgentModel(
      pool,
      gateway,
      jobs,
      credits,
      billing,
      storage,
      config.jobs,
      {
        baseUrl: "http://127.0.0.1:3297/v1",
        apiKey: "synthetic",
        catalogUrl: "",
      },
    );
    const service = new NativeAgentService(
        knowledge,
        pool,
        paid,
        async () => undefined,
        jobs,
      ),
      modelId = "volcengine_ark.text." + PAID_AGENT_UPSTREAM;
    const start = async (budgetCents: number, prompt = "测试纯文本") => {
      const session = await service.createSession(actorId, {
        projectId,
        mode: "advice",
        title: "费用隔离验收",
        operationId: randomUUID(),
      });
      const run = await service.start(actorId, session.id, {
        operationId: randomUUID(),
        prompt,
        modelId,
        mode: "advice",
        budgetCents,
      });
      // These cases exercise pending P2.5 rows; new continuous plans have a dedicated suite.
      await pool.query("update native_agent_runs set plan_protocol=0,budget_limits=null where id=$1",[run.id]);
      return run;
    };
    const checks: string[] = [];
    try {
      await gateway.refreshVolcengineArkCatalog();
      await pool.query("update users set is_admin=true where id=$1", [actorId]);
      await credits.grant(
        actorId,
        actorId,
        {
          credits: 1000,
          source: "promotion",
          note: "P25 synthetic ledger only",
          idempotencyKey: randomUUID(),
        },
        randomUUID(),
      );
      const r = await start(100);
      await service.drive(r.id);
      const snapshot = await service.snapshot(actorId, r.session_id);
      assert.equal(snapshot.runs[0].status, "completed");
      assert.equal(submissions, 1);
      const usage = (
        await pool.query("select * from native_agent_usage where run_id=$1", [
          r.id,
        ])
      ).rows[0];
      assert.ok(usage.job_id);
      assert.equal(Number(usage.supplier_cents), 1);
      const run = (
        await pool.query("select * from native_agent_runs where id=$1", [r.id])
      ).rows[0];
      assert.equal(run.spent_cents, 1);
      assert.equal(run.reserved_cents, 0);
      checks.push(
        "SDK protocol + actual JobService/Executor + actual billing/credit ledger, supplier is HTTP substitute",
      );
      const replayExecution = {
        actor: { actorId, projectId, runId: r.id },
        stepId: usage.step_id,
        mode: "advice" as const,
        budgetCents: 100,
      };
      const replay = await Promise.all([
        paid.run(
          modelId,
          [{ role: "user", content: "测试纯文本" }],
          new AbortController().signal,
          async () => undefined,
          replayExecution,
        ),
        paid.run(
          modelId,
          [{ role: "user", content: "测试纯文本" }],
          new AbortController().signal,
          async () => undefined,
          replayExecution,
        ),
      ]);
      assert.equal(replay[0].jobId, usage.job_id);
      assert.equal(replay[1].jobId, usage.job_id);
      assert.equal(submissions, 1);
      checks.push(
        "concurrent replay and lost response use one job, one vendor submission, one billing usage",
      );
      await assert.rejects(
        jobs.retry(usage.job_id, actorId, { retryOperationId: randomUUID() }),
        { code: "AGENT_RETRY_RESTRICTED" },
      );
      await pool.query(
        "insert into project_members(project_id,user_id,role) values($1,$2,'editor')",
        [projectId, other.user.id],
      );
      await assert.rejects(jobs.get(usage.job_id, other.user.id), {
        code: "JOB_NOT_FOUND",
      });
      await assert.rejects(jobs.cancel(usage.job_id, other.user.id), {
        code: "JOB_NOT_FOUND",
      });
      assert.equal(
        (await jobs.list(projectId, other.user.id)).some(
          (j) => j.id === usage.job_id,
        ),
        false,
      );
      checks.push(
        "private native inference output hidden from ordinary project members and ordinary retry",
      );
      const low = await start(1);
      await service.drive(low.id);
      const lowSnapshot = await service.snapshot(actorId, low.session_id);
      assert.equal(lowSnapshot.runs[0].error_code, "AGENT_COST_LIMIT");
      assert.equal(submissions, 1);
      assert.equal(
        (
          await pool.query(
            "select count(*)::int n from native_agent_model_jobs where run_id=$1",
            [low.id],
          )
        ).rows[0].n,
        0,
      );
      checks.push(
        "insufficient run budget rolls back job and credit reservation before vendor submission",
      );
      await assert.rejects(
        paid.run(
          modelId,
          [{ role: "user", content: "changed" }],
          new AbortController().signal,
          async () => undefined,
          replayExecution,
        ),
        { code: "IDEMPOTENCY_CONFLICT" },
      );
      assert.equal(submissions, 1);
      const preflight = await start(100, "测试官方分词超限");
      await service.drive(preflight.id);
      const preflightSnapshot = await service.snapshot(
        actorId,
        preflight.session_id,
      );
      assert.equal(
        preflightSnapshot.runs[0].error_code,
        "AGENT_PREFLIGHT_FAILED",
      );
      assert.equal(submissions, 1);
      assert.equal(
        (
          await pool.query(
            "select reserved_cents from native_agent_runs where id=$1",
            [preflight.id],
          )
        ).rows[0].reserved_cents,
        0,
      );
      checks.push(
        "official tokenizer preflight failure is known non-submission and releases both reservations",
      );
      const balance = await credits.account(actorId);
      assert.equal(String(balance.account.reserved), "0");
      const unknown = await start(100, "测试提交状态不明");
      await service.drive(unknown.id);
      const uncertain = await service.snapshot(actorId, unknown.session_id);
      assert.equal(uncertain.runs[0].status, "awaiting_manual_review");
      assert.equal(submissions, 2);
      const binding = (
        await pool.query(
          "select * from native_agent_model_jobs where run_id=$1",
          [unknown.id],
        )
      ).rows[0];
      assert.equal(binding.status, "unknown");
      await service.drive(unknown.id);
      assert.equal(submissions, 2);
      checks.push(
        "unknown supplier outcome retains original job and reservations with no automatic resubmission",
      );
      await service.cancel(actorId, unknown.id);

      const rounding = await start(100, "测试纯文本预算取整");
      await service.drive(rounding.id);
      const rounded = (
        await pool.query(
          "select r.spent_cents,u.supplier_cents,g.credit_points::int charged_points from native_agent_runs r join native_agent_usage u on u.run_id=r.id join generation_usage g on g.job_id=u.job_id where r.id=$1",
          [rounding.id],
        )
      ).rows[0];
      assert.equal(rounded.spent_cents, rounded.charged_points);
      assert.ok(rounded.spent_cents > rounded.supplier_cents);
      checks.push(
        "RMB run budget includes platform markup and point rounding; original supplier cost remains separate",
      );

      // Simulate a response lost after JobExecutor persisted/settled the result but before runtime materialization.
      let loseReceipt = true;
      const recovery = new NativeAgentService(
        knowledge,
        pool,
        {
          models: () => paid.models(),
          inspectReceipt: async () => { throw new Error("Local durable recovery must not depend on supplier network"); },
          run: async (...args) => {
            const reply = await paid.run(...args);
            if (loseReceipt) {
              loseReceipt = false;
              throw new DomainError(
                "AGENT_BILLING_UNCONFIRMED",
                "Injected lost runtime receipt",
                409,
              );
            }
            return reply;
          },
        },
        async () => undefined,
        jobs,
      );
      const recovered = await start(100, "测试纯文本");
      const before = submissions;
      await recovery.drive(recovered.id);
      assert.equal(
        (await recovery.snapshot(actorId, recovered.session_id)).runs[0].status,
        "awaiting_manual_review",
      );
      const original = (
        await pool.query(
          "select * from native_agent_model_jobs where run_id=$1",
          [recovered.id],
        )
      ).rows[0];
      assert.equal(original.status, "settled");
      assert.equal(submissions, before + 1);
      await Promise.all([
        recovery.reconcile(actorId, recovered.id),
        recovery.reconcile(actorId, recovered.id),
      ]);
      await Promise.all([
        recovery.drive(recovered.id),
        recovery.drive(recovered.id),
      ]);
      const restored = (await recovery.snapshot(actorId, recovered.session_id))
        .runs[0];
      assert.equal(restored.status, "completed");
      assert.equal(restored.rounds, 1);
      assert.equal(submissions, before + 1);
      assert.equal(
        (
          await pool.query(
            "select count(*)::int n from native_agent_usage where run_id=$1",
            [recovered.id],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await pool.query(
            "select count(*)::int n from native_agent_model_jobs where run_id=$1",
            [recovered.id],
          )
        ).rows[0].n,
        1,
      );
      checks.push(
        "lost persisted receipt + concurrent explicit reconciliation resumes original job once, without a new model round, invoice or vendor submission",
      );

      await writeFile(
        (process.env.AGENT_TEST_ARTIFACT_ROOT ?? "H:/CodexStorage/shoushou-p25")+"/artifacts/model-job-check.json",
        JSON.stringify(
          { checks, submissions, actualSupplier: false, jobId: usage.job_id },
          null,
          2,
        ),
      );
    } finally {
      fixture.close();
      await pool.end();
    }
  },
);
