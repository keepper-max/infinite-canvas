import assert from "node:assert/strict";
import test from "node:test";

import { createDatabase } from "../src/db/client.js";
import { applyMigrations } from "../src/db/migrate.js";
import { OperationsService } from "../src/operations-service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("admin jobs and usage retain email and expose phone-only accounts", { skip: !databaseUrl }, async () => {
  const { pool } = createDatabase(databaseUrl!);
  try {
    await applyMigrations(pool);
    const suffix = crypto.randomUUID();
    const admin = await pool.query<{ id: string }>(
      "insert into users(email,password_hash,is_admin) values($1,'test',true) returning id",
      [`account-display-admin-${suffix}@example.com`],
    );
    const operations = new OperationsService(pool, { adminEmails: [] });
    for (const email of [null, `account-display-${suffix}@example.com`]) {
      // Synthetic test data only; no verification message is sent.
      const phone = email ? null : `+86${Date.now().toString().slice(-11)}`;
      const user = await pool.query<{ id: string }>(
        "insert into users(email,phone,password_hash) values($1,$2,'test') returning id", [email, phone],
      );
      const userId = user.rows[0]!.id;
      const project = await pool.query<{ id: string }>(
        "insert into projects(owner_id,name) values($1,'Account display') returning id", [userId],
      );
      const job = await pool.query<{ id: string }>(
        `insert into generation_jobs(project_id,created_by,provider,model_id,mode,capability,status)
         values($1,$2,'runninghub','video.test','t2v','video','completed') returning id`, [project.rows[0]!.id, userId],
      );
      await pool.query(
        `insert into generation_usage(job_id,project_id,user_id,billing_request_id,provider,model_id,capability,status,billed,total_amount,currency)
         values($1,$2,$3,$4,'runninghub','video.test','video','settled',true,0,'CNY')`,
        [job.rows[0]!.id, project.rows[0]!.id, userId, `account-display-${job.rows[0]!.id}`],
      );
      const query = { page: 1, pageSize: 20, userId };
      for (const result of [await operations.adminJobs(admin.rows[0]!.id, query), await operations.adminUsage(admin.rows[0]!.id, query)]) {
        const items = result.items as Array<{ userId: string; userEmail: string | null; userPhone: string | null }>;
        assert.equal(items.length, 1);
        assert.equal(items[0]!.userId, userId);
        assert.equal(items[0]!.userEmail, email);
        assert.equal(items[0]!.userPhone, phone);
      }
    }
  } finally {
    await pool.end();
  }
});
