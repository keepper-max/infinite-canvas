import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createDatabase } from "../src/db/client.js";
import { applyMigrations } from "../src/db/migrate.js";
import { PostgresPlatformRepository } from "../src/repository.js";
import { KnowledgeService } from "../src/knowledge-service.js";
import { KnowledgeCanvasService } from "../src/knowledge-canvas-service.js";
import { knowledgeAcknowledgement } from "../src/canvas-write-capability.js";
import { JobService, JobExecutor } from "../src/job-service.js";
import { ModelGateway } from "../src/model-gateway.js";
import { CreditService } from "../src/credit-service.js";
import { BillingService } from "../src/billing-service.js";
import { createApp } from "../src/app.js";
import { hashSessionToken } from "../src/auth.js";
import type { ApiConfig, JobConfig } from "../src/config.js";
import type { GenerationProvider } from "../src/provider.js";
const url = process.env.R1F_TEST_DATABASE_URL;
test("R1-F real PostgreSQL/HTTP release guards", { skip: !url }, async (t) => {
  const parsed = new URL(url!);
  assert.equal(parsed.hostname, "127.0.0.1");
  assert.equal(parsed.port, "55451");
  assert.equal(parsed.pathname, "/p2_isolated");
  const { db, pool } = createDatabase(url!),
    repo = new PostgresPlatformRepository(db),
    knowledge = new KnowledgeService(db),
    canvas = new KnowledgeCanvasService(knowledge),
    gateway = new ModelGateway(pool),
    queue: string[] = [],
    checks: string[] = [];
  const credits = new CreditService(pool, []),
    jobConfig = {
      maxAttempts: 1,
      submitTimeoutMs: 0,
      videoPollIntervalMs: 10,
      maxRuntimeMs: 0,
    } as JobConfig;
  const jobs = new JobService(
    pool,
    {
      add: async (id) => {
        queue.push(id);
      },
      remove: async () => true,
    },
    gateway,
    jobConfig,
    undefined,
    credits,
  );
  const run = (name: string, fn: () => Promise<void>) =>
    t.test(name, async () => {
      await fn();
      checks.push(name);
    });
  try {
    await applyMigrations(pool);
    await applyMigrations(pool);
    const admin = await repo.createUserWithWorkspace(
        `r1f-admin-${randomUUID()}@example.test`,
        "synthetic",
      ),
      owner = await repo.createUserWithWorkspace(
        `r1f-owner-${randomUUID()}@example.test`,
        "synthetic",
      ),
      other = await repo.createUserWithWorkspace(
        `r1f-other-${randomUUID()}@example.test`,
        "synthetic",
      );
    await pool.query("update users set is_admin=true where id=$1", [
      admin.user.id,
    ]);
    const tokens = new Map<string, string>();
    for (const u of [admin, owner, other]) {
      const token = randomUUID();
      tokens.set(u.user.id, token);
      await repo.createSession(
        u.user.id,
        hashSessionToken(token),
        new Date(Date.now() + 3600000),
      );
    }
    const app = createApp(
      repo,
      {
        cookieName: "r1f_test",
        cookieSecure: false,
        trustedOrigins: [],
        databaseUrl: url,
      } as ApiConfig,
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
    );
    const request = (
      path: string,
      body?: unknown,
      user = owner.user.id,
      method = body === undefined ? "GET" : "POST",
    ) =>
      app.request(path, {
        method,
        headers: {
          cookie: `r1f_test=${tokens.get(user)}`,
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const data = async (r: Response) => {
      assert.ok(r.ok, `${r.status} ${await r.clone().text()}`);
      return (await r.json()).data as any;
    };
    const grant = async (user: string, enabled: boolean) =>
      data(
        await request(
          "/api/admin/features/knowledge/users/" + user,
          { enabled, reason: "R1-F isolated acceptance" },
          admin.user.id,
          "PUT",
        ),
      );
    const project = (
      await repo.createProjectForUser(owner.user.id, { name: "R1-F保护验证" })
    ).projectId;
    let space: string, doc: any, referenceId: string;
    const knowledgeOperationId = randomUUID();
    await run(
      "feature defaults off; admin APIs audited and grants never expand project membership",
      async () => {
        assert.equal(
          (await data(await request("/api/features/knowledge"))).enabled,
          false,
        );
        assert.equal((await request("/api/knowledge/spaces")).status, 403);
        assert.equal(
          (
            await request(
              "/api/admin/features/knowledge/users/" + owner.user.id,
              { enabled: true, reason: "spoof" },
              other.user.id,
              "PUT",
            )
          ).status,
          403,
        );
        await grant(owner.user.id, true);
        await grant(other.user.id, true);
        space = (
          await data(
            await request("/api/knowledge/spaces", {
              kind: "project",
              projectId: project,
              operationId: randomUUID(),
            }),
          )
        ).id;
        doc = await data(
          await request(`/api/knowledge/${space}/actions`, {
            operationId: randomUUID(),
            action: "document.create",
            payload: {
              title: "人物林岚",
              markdown:
                "---\nrole: 人物\n---\n\n[[雾港]]\n> [!NOTE] 保真\n附件 ![[photo.png]]",
              folderId: null,
            },
          }),
        );
        assert.equal(
          (
            await request(
              `/api/knowledge/${space}/documents/${doc.id}`,
              undefined,
              other.user.id,
            )
          ).status,
          404,
        );
        assert.ok(
          Number(
            (
              await pool.query(
                "select count(*)::int n from admin_audit_logs where action='feature.knowledge.grant' and actor_user_id=$1",
                [admin.user.id],
              )
            ).rows[0].n,
          ) >= 2,
        );
      },
    );
    await run(
      "server issued actor/revision capability rejects forged versions and silent knowledge omission",
      async () => {
        const receipt = await canvas.add(project, owner.user.id, {
          operationId: knowledgeOperationId,
          expectedCanvasRevision: 0,
          reference: { spaceId: space, documentId: doc.id, mode: "latest" },
          position: { x: 30, y: 40 },
        });
        referenceId = receipt.result.createdNodeId as string;
        const before = (await repo.getCanvasForUser(project, owner.user.id))!;
        const body = {
          expectedRevision: before.revision,
          nodes: [],
          edges: [],
          viewport: before.viewport,
          settings: before.settings,
        };
        assert.equal(
          (
            await request(
              `/api/projects/${project}/canvas`,
              body,
              owner.user.id,
              "PUT",
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await request(
              `/api/projects/${project}/canvas`,
              { ...body, clientVersion: "999" },
              owner.user.id,
              "PUT",
            )
          ).status,
          422,
        );
        const proof = await repo.issueCanvasWriteCapability(
          project,
          owner.user.id,
          before.revision,
          knowledgeAcknowledgement(before.nodes),
        );
        assert.equal(
          (
            await request(
              `/api/projects/${project}/canvas`,
              {
                ...body,
                writeCapability: {
                  token: proof.token,
                  deletedKnowledgeNodeIds: [],
                },
              },
              owner.user.id,
              "PUT",
            )
          ).status,
          409,
        );
        assert.equal(
          (await repo.getCanvasForUser(project, owner.user.id))!.revision,
          before.revision,
        );
        const written = await data(
          await request(
            `/api/projects/${project}/canvas`,
            {
              ...body,
              nodes: before.nodes,
              writeCapability: {
                token: proof.token,
                deletedKnowledgeNodeIds: [],
              },
            },
            owner.user.id,
            "PUT",
          ),
        );
        assert.ok(written.canvas.nodes.some((n: any) => n.id === referenceId));
        const prior = written.canvas;
        const fresh = await repo.issueCanvasWriteCapability(
          project,
          owner.user.id,
          prior.revision,
          knowledgeAcknowledgement(prior.nodes),
        );
        const raced = await Promise.all([
          request(
            `/api/projects/${project}/canvas`,
            {
              ...body,
              expectedRevision: prior.revision,
              nodes: prior.nodes,
              writeCapability: {
                token: fresh.token,
                deletedKnowledgeNodeIds: [],
              },
            },
            owner.user.id,
            "PUT",
          ),
          request(
            `/api/projects/${project}/canvas`,
            { ...body, expectedRevision: prior.revision },
            owner.user.id,
            "PUT",
          ),
        ]);
        assert.equal(raced.filter((r) => r.status === 200).length, 1);
        assert.equal(raced.filter((r) => r.status === 409).length, 1);
      },
    );
    await run(
      "revocation blocks service/search/graph/read/generation and redacts canvas; normal read remains",
      async () => {
        await grant(owner.user.id, false);
        for (const path of [
          "/api/knowledge/spaces",
          `/api/knowledge/${space}/documents?q=林岚`,
          `/api/knowledge/${space}/graph`,
          `/api/knowledge/${space}/documents/${doc.id}`,
        ])
          assert.equal((await request(path)).status, 403);
        await assert.rejects(
          () => knowledge.read(owner.user.id, space, doc.id),
          (e: any) => e.code === "KNOWLEDGE_NOT_ENABLED",
        );
        await assert.rejects(
          () => canvas.receipt(project, owner.user.id, knowledgeOperationId),
          (e: any) => e.code === "KNOWLEDGE_NOT_ENABLED",
        );
        await assert.rejects(
          () =>
            canvas.add(project, owner.user.id, {
              operationId: knowledgeOperationId,
              expectedCanvasRevision: 0,
              reference: { spaceId: space, documentId: doc.id, mode: "latest" },
              position: { x: 30, y: 40 },
            }),
          (e: any) => e.code === "KNOWLEDGE_NOT_ENABLED",
        );
        const read = await data(
          await request(`/api/projects/${project}/canvas`),
        );
        const node = read.canvas.nodes.find((n: any) => n.id === referenceId);
        assert.ok(node.metadata.knowledgeUnavailable);
        assert.ok(!node.metadata.knowledgeReference);
        assert.equal(
          (
            await request("/api/knowledge/reference-summary", {
              projectId: project,
              reference: { spaceId: space, documentId: doc.id, mode: "latest" },
            })
          ).status,
          403,
        );
        await grant(owner.user.id, true);
        assert.equal(
          (await knowledge.read(owner.user.id, space, doc.id)).markdown,
          doc.markdown,
        );
      },
    );
    await pool.query(
      "insert into model_catalog(id,display_name,capability,upstream_model,provider_id,enabled,healthy) values('r1f-text','R1-F synthetic only','text','fake','token360',true,true) on conflict(id) do nothing",
    );
    await pool.query(
      "insert into model_capabilities(model_id,modes,limits) values('r1f-text','[\"chat\"]','{\"maxPromptChars\":120000}') on conflict(model_id) do nothing",
    );
    await credits.grant(
      admin.user.id,
      owner.user.id,
      {
        credits: 100000,
        source: "promotion",
        note: "isolated synthetic credits",
        idempotencyKey: randomUUID(),
      },
      randomUUID(),
    );
    const create = () =>
      jobs.create(project, owner.user.id, {
        modelId: "r1f-text",
        mode: "chat",
        capability: "text",
        prompt: "R1-F synthetic retry",
        parameters: {},
        references: [],
        idempotencyKey: randomUUID(),
      } as any);
    let original: any,
      retry: any,
      operationId = randomUUID();
    await run(
      "concurrent retry and lost response replay share one receipt/job/reservation; changed parameters rejected",
      async () => {
        original = await create();
        await pool.query(
          "update generation_jobs set status='failed',retryable=true where id=$1",
          [original.id],
        );
        const results = await Promise.all(
          Array.from({ length: 5 }, () =>
            request(`/api/jobs/${original.id}/retry`, {
              retryOperationId: operationId,
            }),
          ),
        );
        const saved = await Promise.all(results.map(data));
        assert.equal(new Set(saved.map((r) => r.job.id)).size, 1);
        retry = saved[0].job;
        assert.equal(retry.retryOperationId, operationId);
        const recovered = await data(
          await request(
            `/api/jobs/${original.id}/retry-operations/${operationId}`,
          ),
        );
        assert.equal(recovered.job.id, retry.id);
        assert.equal(
          Number(
            (
              await pool.query(
                "select count(*)::int n from generation_jobs where retry_of_job_id=$1",
                [original.id],
              )
            ).rows[0].n,
          ),
          1,
        );
        assert.equal(
          Number(
            (
              await pool.query(
                "select count(*)::int n from job_retry_operations where actor_id=$1 and operation_id=$2",
                [owner.user.id, operationId],
              )
            ).rows[0].n,
          ),
          1,
        );
        assert.equal(
          (
            await request(`/api/jobs/${original.id}/retry`, {
              retryOperationId: operationId,
              expectedInputFingerprint: "0".repeat(64),
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await request(`/api/jobs/${original.id}/retry`, {
              retryOperationId: randomUUID(),
            })
          ).status,
          409,
        );
      },
    );
    await run(
      "explicit second operation and old body-less callers remain safe and distinguish attempts",
      async () => {
        await pool.query(
          "update generation_jobs set status='failed',retryable=true where id=$1",
          [retry.id],
        );
        const next = await data(
          await request(`/api/jobs/${original.id}/retry`, {
            retryOperationId: randomUUID(),
          }),
        );
        assert.notEqual(next.job.id, retry.id);
        assert.equal(next.job.retryOfJobId, original.id);
        assert.equal(Number(next.job.attemptCount), 0);
        const legacy = await create();
        await pool.query(
          "update generation_jobs set status='failed',retryable=true where id=$1",
          [legacy.id],
        );
        const a = await jobs.retry(legacy.id, owner.user.id),
          b = await jobs.retry(legacy.id, owner.user.id);
        assert.equal(a!.id, b!.id);
      },
    );
    await run(
      "receipt insert fault rolls back job, reservation and audit in real PostgreSQL",
      async () => {
        const source = await create();
        await pool.query(
          "update generation_jobs set status='failed',retryable=true where id=$1",
          [source.id],
        );
        const op = randomUUID(),
          suffix = randomUUID().replaceAll("-", ""),
          fn = `r1f_fault_${suffix}`;
        const before = (await credits.account(owner.user.id)).account;
        await pool.query(
          `create function ${fn}() returns trigger language plpgsql as $$ begin if NEW.operation_id='${op}' then raise exception 'R1F injected receipt failure'; end if; return NEW; end $$`,
        );
        await pool.query(
          `create trigger ${fn} before insert on job_retry_operations for each row execute function ${fn}()`,
        );
        try {
          assert.equal(
            (
              await request(`/api/jobs/${source.id}/retry`, {
                retryOperationId: op,
              })
            ).status,
            500,
          );
          assert.equal(
            (
              await pool.query(
                "select count(*)::int n from generation_jobs where retry_of_job_id=$1",
                [source.id],
              )
            ).rows[0].n,
            0,
          );
          assert.equal(
            (
              await pool.query(
                "select count(*)::int n from job_retry_operations where actor_id=$1 and operation_id=$2",
                [owner.user.id, op],
              )
            ).rows[0].n,
            0,
          );
          const after = (await credits.account(owner.user.id)).account;
          assert.equal(after.reserved, before.reserved);
          assert.equal(after.balance, before.balance);
        } finally {
          await pool.query(`drop trigger ${fn} on job_retry_operations`);
          await pool.query(`drop function ${fn}()`);
        }
        const recovered = await data(
          await request(`/api/jobs/${source.id}/retry`, {
            retryOperationId: op,
          }),
        );
        assert.ok(recovered.job.id);
      },
    );
    await run(
      "retry result uses one verifiable CNY usage record and one charge under concurrent settlement",
      async () => {
        await pool.query(
          "update generation_jobs set status='completed',provider_submission_state='resolved',billing_status='settled' where id=$1",
          [retry.id],
        );
        await pool.query(
          `insert into generation_usage(job_id,project_id,user_id,billing_request_id,provider,model_id,capability,status,billed,total_amount,currency,credit_status)
   values($1,$2,$3,$4,'token360','r1f-text','text','succeeded',true,'0.01','CNY','pending')`,
          [retry.id, project, owner.user.id, "synthetic-" + randomUUID()],
        );
        const settled = await Promise.all(
          Array.from({ length: 5 }, () => credits.settleUsage(retry.id)),
        );
        assert.ok(settled.every((s) => s.status === "charged"));
        assert.equal(
          (
            await pool.query(
              "select count(*)::int n from credit_ledger where idempotency_key=$1",
              [`generation:${retry.id}`],
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await pool.query(
              "select count(*)::int n from generation_usage where job_id=$1",
              [retry.id],
            )
          ).rows[0].n,
          1,
        );
        const replay = await data(
          await request(`/api/jobs/${original.id}/retry`, {
            retryOperationId: operationId,
          }),
        );
        assert.equal(replay.job.id, retry.id);
      },
    );
    await run(
      "uncertain supplier dispatch never re-submits across executor restart or releases unverified credit as free",
      async () => {
        const parent = await create();
        await pool.query(
          "update generation_jobs set status='failed',retryable=true where id=$1",
          [parent.id],
        );
        const intermediate = (await jobs.retry(parent.id, owner.user.id, {
          retryOperationId: randomUUID(),
        }))!;
        await pool.query(
          "update generation_jobs set status='failed',retryable=true where id=$1",
          [intermediate.id],
        );
        const task = (await jobs.retry(intermediate.id, owner.user.id, {
          retryOperationId: randomUUID(),
        }))!;
        let submitted = 0;
        const provider: GenerationProvider = {
          create: async () => {
            submitted++;
            throw new Error("synthetic response lost after accept");
          },
          get: async () => {
            throw Error("not expected");
          },
          cancel: async () => {},
          fetchVideoContent: async () => {
            throw Error("not expected");
          },
        };
        const billing = new BillingService(
          pool,
          {
            baseUrl: "http://127.0.0.1:1",
            apiKey: "synthetic",
            catalogUrl: "",
          },
          credits,
        );
        const execute = () =>
          new JobExecutor(
            pool,
            gateway,
            provider,
            {} as any,
            jobConfig,
            undefined,
            billing,
            undefined,
            undefined,
            credits,
          );
        await assert.rejects(() => execute().execute(task.id, 1));
        await execute().markAttemptFailed(task.id, true);
        const first = (
          await pool.query("select * from generation_jobs where id=$1", [
            task.id,
          ])
        ).rows[0];
        assert.equal(first.provider_submission_state, "unknown");
        assert.equal(first.billing_status, "manual_review");
        await execute().execute(task.id, 2);
        assert.equal(submitted, 1);
        assert.equal(
          (
            await request(`/api/jobs/${task.id}/retry`, {
              retryOperationId: randomUUID(),
            })
          ).status,
          409,
        );
        assert.equal(
          (await billing.finalizeProviderUsage(task.id)).status,
          "manual_review",
        );
        assert.equal(
          (
            await request(`/api/jobs/${parent.id}/retry`, {
              retryOperationId: randomUUID(),
            })
          ).status,
          409,
        );
      },
    );
    await run(
      "legacy attempted job is quarantined rather than inferred free",
      async () => {
        const legacy = await create();
        await pool.query(
          "update generation_jobs set status='failed',attempt_count=1,provider_submission_state='legacy',retryable=true where id=$1",
          [legacy.id],
        );
        const billing = new BillingService(
          pool,
          {
            baseUrl: "http://127.0.0.1:1",
            apiKey: "synthetic",
            catalogUrl: "",
          },
          credits,
        );
        assert.equal(
          (await billing.finalizeProviderUsage(legacy.id)).status,
          "manual_review",
        );
        assert.equal(
          (
            await request(`/api/jobs/${legacy.id}/retry`, {
              retryOperationId: randomUUID(),
            })
          ).status,
          409,
        );
      },
    );
    await run(
      "explicit deletion requires acknowledgement and keeps document plus old canvas snapshots",
      async () => {
        const current = (await repo.getCanvasForUser(project, owner.user.id))!,
          proof = await repo.issueCanvasWriteCapability(
            project,
            owner.user.id,
            current.revision,
            knowledgeAcknowledgement(current.nodes),
          );
        await repo.saveCanvasForUser(project, owner.user.id, {
          expectedRevision: current.revision,
          nodes: [],
          edges: [],
          viewport: current.viewport,
          settings: current.settings,
          writeCapability: {
            token: proof.token,
            deletedKnowledgeNodeIds: [referenceId],
          },
        });
        assert.equal(
          (await knowledge.read(owner.user.id, space, doc.id)).markdown,
          doc.markdown,
        );
        const old = await pool.query(
          "select count(*)::int n from canvas_snapshots where project_id=$1 and nodes @> $2::jsonb",
          [project, JSON.stringify([{ id: referenceId }])],
        );
        assert.ok(old.rows[0].n > 0);
      },
    );
    if (process.env.R1F_ARTIFACT_DIR)
      await writeFile(
        process.env.R1F_ARTIFACT_DIR + "/release-guards-results.json",
        JSON.stringify(
          { checks, realPostgres: true, realHttp: true, paidProviderCalls: 0 },
          null,
          2,
        ),
      );
  } finally {
    await pool.end();
  }
});
