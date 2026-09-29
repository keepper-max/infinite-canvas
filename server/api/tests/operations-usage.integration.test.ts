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

test("admin natural-day reports use Asia/Shanghai boundaries", { skip: !databaseUrl }, async () => {
  const { pool } = createDatabase(databaseUrl!);
  try {
    await applyMigrations(pool);
    const suffix = crypto.randomUUID();
    const { rows: [user] } = await pool.query<{ id: string }>(
      `insert into users(email,password_hash,is_admin,created_at)
       values($1,'test',true,'2031-01-01T16:01:00Z') returning id`,
      [`timezone-admin-${suffix}@example.com`],
    );
    const { rows: [project] } = await pool.query<{ id: string }>(
      "insert into projects(owner_id,name) values($1,'Timezone test') returning id",
      [user!.id],
    );
    const jobIds: string[] = [];
    for (const createdAt of ["2031-01-01T15:59:00Z", "2031-01-01T16:01:00Z"]) {
      const { rows: [job] } = await pool.query<{ id: string }>(
        `insert into generation_jobs(project_id,created_by,provider,model_id,mode,capability,status,created_at,finished_at)
         values($1,$2,'runninghub','image.timezone-test','t2i','image','completed',$3,$3::timestamptz+interval '10 seconds') returning id`,
        [project!.id, user!.id, createdAt],
      );
      jobIds.push(job!.id);
      await pool.query(
        `insert into generation_usage(job_id,project_id,user_id,billing_request_id,provider,model_id,capability,status,billed,total_amount,currency,reconciled_at)
         values($1,$2,$3,$4,'runninghub','image.timezone-test','image','settled',true,1,'CNY',$5)`,
        [job!.id, project!.id, user!.id, `bill-${job!.id}`, createdAt],
      );
    }

    const operations = new OperationsService(pool, { adminEmails: [] });
    const januaryFirst = await operations.adminJobs(user!.id, {
      page: 1, pageSize: 20, userId: user!.id, createdFrom: "2031-01-01", createdTo: "2031-01-01",
    }) as { items: Array<{ id: string }> };
    const januarySecond = await operations.adminJobs(user!.id, {
      page: 1, pageSize: 20, userId: user!.id, createdFrom: "2031-01-02", createdTo: "2031-01-02",
    }) as { items: Array<{ id: string }> };
    assert.deepEqual(januaryFirst.items.map((item) => item.id), [jobIds[0]]);
    assert.deepEqual(januarySecond.items.map((item) => item.id), [jobIds[1]]);

    const users = await operations.adminUsers(user!.id, {
      page: 1, pageSize: 20, createdFrom: "2031-01-02", createdTo: "2031-01-02",
    }) as { items: Array<{ id: string }> };
    assert.ok(users.items.some((item) => item.id === user!.id));

    const overview = await operations.adminOverview(user!.id, {
      dateFrom: "2031-01-02", dateTo: "2031-01-02",
    }) as {
      jobActivity: { jobsInRange: number };
      usageRange: Array<{ currency: string; totalAmount: string }>;
      trends: Array<{ day: string; jobs: number }>;
    };
    assert.ok(overview.jobActivity.jobsInRange >= 1);
    assert.ok(Number(overview.usageRange.find((item) => item.currency === "CNY")?.totalAmount) >= 1);
    assert.equal(overview.trends.length, 1);
    assert.equal(overview.trends[0]?.day, "2031-01-02");
    assert.ok((overview.trends[0]?.jobs || 0) >= 1);
  } finally {
    await pool.end();
  }
});
