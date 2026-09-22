import assert from "node:assert/strict";
import test from "node:test";

import { createDatabase } from "../src/db/client.js";
import { applyMigrations } from "../src/db/migrate.js";
import { OperationsService } from "../src/operations-service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("legacy RunningHub amounts display as CNY without relabeling unknown Token360 bills", { skip: !databaseUrl }, async () => {
  const { pool } = createDatabase(databaseUrl!);
  try {
    await applyMigrations(pool);
    const suffix = crypto.randomUUID();
    const { rows: [user] } = await pool.query<{ id: string }>(
      "insert into users(email,password_hash,is_admin) values($1,'test',true) returning id",
      [`usage-admin-${suffix}@example.com`],
    );
    const { rows: [project] } = await pool.query<{ id: string }>(
      "insert into projects(owner_id,name) values($1,'Usage test') returning id",
      [user!.id],
    );
    for (const [provider, currency, amount] of [
      ["runninghub", null, "22.838"],
      ["runninghub_global", "UNKNOWN", "0.278"],
      ["token360", null, "0"],
    ] as const) {
      const { rows: [job] } = await pool.query<{ id: string }>(
        `insert into generation_jobs(project_id,created_by,provider,model_id,mode,capability,status)
         values($1,$2,$3,'video.test','t2v','video','completed') returning id`,
        [project!.id, user!.id, provider],
      );
      await pool.query(
        `insert into generation_usage(job_id,project_id,user_id,billing_request_id,provider,model_id,capability,status,billed,total_amount,currency)
         values($1,$2,$3,$4,$5,'video.test','video','settled',true,$6,$7)`,
        [job!.id, project!.id, user!.id, `bill-${job!.id}`, provider, amount, currency],
      );
    }

    const operations = new OperationsService(pool, { adminEmails: [] });
    const usage = await operations.adminUsage(user!.id, { page: 1, pageSize: 20, userId: user!.id }) as {
      items: Array<{ provider: string; currency: string }>;
      summary: Array<{ currency: string; totalAmount: string }>;
      breakdowns: Record<string, Array<{ currency: string }>>;
    };
    assert.equal(usage.items.find((item) => item.provider === "runninghub")?.currency, "CNY");
    assert.equal(usage.items.find((item) => item.provider === "runninghub_global")?.currency, "CNY");
    assert.equal(usage.items.find((item) => item.provider === "token360")?.currency, "UNKNOWN");
    assert.equal(usage.summary.find((item) => item.currency === "CNY")?.totalAmount, "23.11600000");
    assert.equal(usage.summary.find((item) => item.currency === "UNKNOWN")?.totalAmount, "0.00000000");
    assert.ok(usage.breakdowns.model.some((item) => item.currency === "CNY"));

    const detail = await operations.adminUser(user!.id, user!.id) as {
      user: { usageAmounts: Record<string, string> };
    };
    assert.equal(detail.user.usageAmounts.CNY, "23.11600000");
    assert.equal(detail.user.usageAmounts.UNKNOWN, "0.00000000");
  } finally {
    await pool.end();
  }
});
