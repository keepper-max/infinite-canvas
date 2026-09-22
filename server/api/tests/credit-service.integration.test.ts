import assert from "node:assert/strict";
import test from "node:test";

import { CreditService } from "../src/credit-service.js";
import { createDatabase } from "../src/db/client.js";
import { applyMigrations } from "../src/db/migrate.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("activation code is one-time and joins the same credit balance", { skip: !databaseUrl }, async () => {
  const { pool } = createDatabase(databaseUrl!);
  try {
    await applyMigrations(pool);
    const suffix = crypto.randomUUID();
    const admin = await pool.query<{ id: string }>(
      "insert into users(email,password_hash,is_admin) values($1,'test',true) returning id",
      [`activation-admin-${suffix}@example.com`],
    );
    const user = await pool.query<{ id: string }>(
      "insert into users(email,password_hash) values($1,'test') returning id",
      [`activation-user-${suffix}@example.com`],
    );
    const credits = new CreditService(pool);
    const issued = await credits.issueActivationCode(admin.rows[0]!.id, 1200,
      new Date(Date.now() + 86400000).toISOString(), crypto.randomUUID());
    assert.equal(issued.credits, "1200");
    assert.equal((await credits.redeemActivationCode(user.rows[0]!.id, issued.code)).balance, "1200");
    await assert.rejects(() => credits.redeemActivationCode(user.rows[0]!.id, issued.code),
      { code: "ACTIVATION_INVALID" });
    const account = await credits.account(user.rows[0]!.id);
    assert.equal(account.account.balance, "1200");
    assert.equal(account.ledger.length, 1);
  } finally { await pool.end(); }
});

test(
  "credit settlement is idempotent and consumes earliest grants before debt",
  { skip: !databaseUrl },
  async () => {
    const { pool } = createDatabase(databaseUrl!);
    try {
      await applyMigrations(pool);
      const suffix = crypto.randomUUID();
      const user = await pool.query<{ id: string }>(
        "insert into users(email,password_hash,is_admin) values($1,'test',true) returning id",
        [`credits-${suffix}@example.com`],
      );
      const userId = user.rows[0]!.id;
      const project = await pool.query<{ id: string }>(
        "insert into projects(owner_id,name) values($1,'Credit test') returning id",
        [userId],
      );
      const projectId = project.rows[0]!.id;
      const credits = new CreditService(pool);
      const earlierExpiry = new Date(
        Date.now() + 365 * 24 * 60 * 60 * 1_000,
      ).toISOString();
      const laterExpiry = new Date(
        Date.now() + 730 * 24 * 60 * 60 * 1_000,
      ).toISOString();

      await credits.grant(
        userId,
        userId,
        {
          credits: 1_000,
          source: "purchase",
          note: "later expiry",
          expiresAt: laterExpiry,
          idempotencyKey: crypto.randomUUID(),
        },
        crypto.randomUUID(),
      );
      await credits.grant(
        userId,
        userId,
        {
          credits: 1_000,
          source: "promotion",
          note: "earlier expiry",
          expiresAt: earlierExpiry,
          idempotencyKey: crypto.randomUUID(),
        },
        crypto.randomUUID(),
      );

      const firstJobId = await insertBilledJob(pool, {
        projectId,
        userId,
        suffix: `${suffix}-first`,
        amount: "10",
      });
      assert.deepEqual(await credits.settleUsage(firstJobId), {
        status: "charged",
        points: "1200",
        balance: "800",
      });
      assert.deepEqual(await credits.settleUsage(firstJobId), {
        status: "charged",
        points: "1200",
      });

      const firstState = await pool.query<{
        balance: string;
        charges: string;
        allocated: string;
        remaining: string;
      }>(
        `select ca.balance::text,
          (select count(*)::text from credit_ledger where idempotency_key=$2) charges,
          (select coalesce(sum(cla.credits),0)::text from credit_lot_allocations cla
            join credit_ledger cl on cl.id=cla.ledger_id where cl.idempotency_key=$2) allocated,
          (select coalesce(sum(remaining),0)::text from credit_lots where account_id=ca.id) remaining
         from credit_accounts ca where ca.user_id=$1`,
        [userId, `generation:${firstJobId}`],
      );
      assert.deepEqual(firstState.rows[0], {
        balance: "800",
        charges: "1",
        allocated: "1200",
        remaining: "800",
      });
      const allocations = await pool.query<{ credits: string }>(
        `select cla.credits::text from credit_lot_allocations cla
         join credit_ledger cl on cl.id=cla.ledger_id
         join credit_lots lot on lot.id=cla.lot_id
         where cl.idempotency_key=$1 order by lot.expires_at`,
        [`generation:${firstJobId}`],
      );
      assert.deepEqual(allocations.rows, [
        { credits: "1000" },
        { credits: "200" },
      ]);

      const historicalJobId = await insertBilledJob(pool, {
        projectId,
        userId,
        suffix: `${suffix}-historical`,
        amount: "99",
      });
      await pool.query(
        "update generation_usage set credit_status='historical' where job_id=$1",
        [historicalJobId],
      );
      assert.deepEqual(await credits.settleUsage(historicalJobId), {
        status: "historical",
        points: null,
      });

      const secondJobId = await insertBilledJob(pool, {
        projectId,
        userId,
        suffix: `${suffix}-second`,
        amount: "10",
      });
      assert.deepEqual(await credits.settleUsage(secondJobId), {
        status: "charged",
        points: "1200",
        balance: "-400",
      });
      await assert.rejects(() => credits.assertCanCreate(userId), {
        code: "INSUFFICIENT_CREDITS",
      });

      const replenished = await credits.grant(
        userId,
        userId,
        {
          credits: 500,
          source: "compensation",
          note: "cover debt",
          idempotencyKey: crypto.randomUUID(),
        },
        crypto.randomUUID(),
      );
      assert.equal(replenished.account.balance, "100");
      assert.equal(replenished.lot.remaining, "100");
      await credits.assertCanCreate(userId);
      await assert.rejects(
        () =>
          credits.grant(
            userId,
            userId,
            {
              credits: 100,
              source: "promotion",
              note: "expired grant",
              expiresAt: new Date(Date.now() - 1_000).toISOString(),
              idempotencyKey: crypto.randomUUID(),
            },
            crypto.randomUUID(),
          ),
        { code: "CREDIT_EXPIRY_INVALID" },
      );
    } finally {
      await pool.end();
    }
  },
);

async function insertBilledJob(
  pool: ReturnType<typeof createDatabase>["pool"],
  input: { projectId: string; userId: string; suffix: string; amount: string },
) {
  const job = await pool.query<{ id: string }>(
    `insert into generation_jobs(project_id,created_by,provider,model_id,mode,capability,status)
     values($1,$2,'token360','video.seedance-2-5','t2v','video','completed') returning id`,
    [input.projectId, input.userId],
  );
  const jobId = job.rows[0]!.id;
  await pool.query(
    `insert into generation_usage(
      job_id,project_id,user_id,billing_request_id,provider,model_id,capability,status,billed,
      total_amount,currency,credit_status
    ) values($1,$2,$3,$4,'token360','video.seedance-2-5','video','succeeded',true,$5,'CNY','pending')`,
    [
      jobId,
      input.projectId,
      input.userId,
      `bill-${input.suffix}`,
      input.amount,
    ],
  );
  return jobId;
}
