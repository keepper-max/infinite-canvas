import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../src/db/client.js";
import { applyMigrations } from "../src/db/migrate.js";
import { OperationsService } from "../src/operations-service.js";
import { decimalProductCeil } from "../src/credit-service.js";

test(
  "Usage displays sum the per-call marked-up ledger points, exclude unpaid bills, and preserve supplier records",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const { pool } = createDatabase(process.env.TEST_DATABASE_URL!);
    try {
      await applyMigrations(pool);
      const id = randomUUID(),
        email = `points-${id}@example.test`;
      await pool.query(
        "insert into users(id,email,is_admin) values($1,$2,true)",
        [id, email],
      );
      const project = (
        await pool.query(
          "insert into projects(owner_id,name) values($1,'Point display QA') returning id",
          [id],
        )
      ).rows[0].id;
      const records = [
        ...Array.from({ length: 5 }, () => ({
          amount: "0.0005",
          currency: "CNY",
          rate: "1",
          status: "charged",
          points: decimalProductCeil(["0.0005", "1", "120"]).toString(),
        })),
        {
          amount: "1",
          currency: "USD",
          rate: "6.8",
          status: "charged",
          points: "816",
        },
        {
          amount: "0.1",
          currency: "CNY",
          rate: "1",
          status: "payment_required",
          points: "12",
        },
        {
          amount: "0",
          currency: "CNY",
          rate: "1",
          status: "free",
          points: "0",
        },
        {
          amount: "0",
          currency: "UNKNOWN",
          rate: null,
          status: "pending_currency",
          points: null,
        },
      ];
      for (const [i, bill] of records.entries()) {
        const job = (
          await pool.query(
            "insert into generation_jobs(project_id,created_by,provider,model_id,mode,capability,status) values($1,$2,'token360','text.points-qa','chat','text','completed') returning id",
            [project, id],
          )
        ).rows[0].id;
        await pool.query(
          "insert into generation_usage(job_id,project_id,user_id,billing_request_id,provider,model_id,capability,status,billed,total_amount,currency,exchange_rate,markup,points_per_cny,credit_status,credit_points) values($1,$2,$3,$4,'token360','text.points-qa','text','settled',true,$5,$6,$7,1.2,100,$8,$9)",
          [
            job,
            project,
            id,
            `points-${id}-${i}`,
            bill.amount,
            bill.currency,
            bill.rate,
            bill.status,
            bill.points,
          ],
        );
      }
      const original = (
        await pool.query(
          "select job_id,total_amount,currency,credit_status,credit_points from generation_usage where user_id=$1 order by job_id",
          [id],
        )
      ).rows;
      const ops = new OperationsService(pool, { adminEmails: [] }),
        usage = (await ops.adminUsage(id, {
          page: 1,
          pageSize: 20,
          userId: id,
        })) as any;
      assert.equal(
        usage.summary.find((s: any) => s.currency === "CNY").creditPoints,
        "5",
      );
      assert.equal(
        usage.summary.find((s: any) => s.currency === "CNY").pendingCreditCalls,
        1,
      );
      assert.equal(
        usage.summary.find((s: any) => s.currency === "USD").creditPoints,
        "816",
      );
      assert.equal(
        usage.summary.find((s: any) => s.currency === "UNKNOWN")
          .pendingCreditCalls,
        1,
      );
      const cny = usage.breakdowns.model.find((s: any) => s.currency === "CNY");
      assert.equal(cny.creditPoints, "5");
      assert.equal(cny.pendingCreditCalls, 1);
      const detail = (await ops.adminUser(id, id)) as any;
      assert.equal(detail.user.consumedPoints, "821");
      assert.equal(detail.user.pendingCreditCalls, 2);
      const users = (await ops.adminUsers(id, {
        page: 1,
        pageSize: 20,
        q: email,
      })) as any;
      assert.equal(users.items[0].consumedPoints, "821");
      assert.deepEqual(
        (
          await pool.query(
            "select job_id,total_amount,currency,credit_status,credit_points from generation_usage where user_id=$1 order by job_id",
            [id],
          )
        ).rows,
        original,
      );
    } finally {
      await pool.end();
    }
  },
);
