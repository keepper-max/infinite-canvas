import assert from "node:assert/strict";
import test from "node:test";

import { BillingService } from "../src/billing-service.js";
import { createDatabase } from "../src/db/client.js";
import { applyMigrations } from "../src/db/migrate.js";
import { OperationsService } from "../src/operations-service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("billing rule updates append versions and new snapshots use the latest rule", { skip: !databaseUrl }, async () => {
  const { pool } = createDatabase(databaseUrl!);
  try {
    await applyMigrations(pool);
    const suffix = crypto.randomUUID();
    const admin = await pool.query<{ id: string }>(
      "insert into users(email,password_hash,is_admin) values($1,'test',true) returning id",
      [`billing-rule-${suffix}@example.com`],
    );
    const adminId = admin.rows[0]!.id;
    const operations = new OperationsService(pool, { adminEmails: [] });
    const created = await operations.createAdminBillingRule(adminId, {
      provider: "runninghub",
      modelPattern: `billing-test-${suffix}`,
      matchType: "contains",
      discountRate: "0.8",
      priority: 500,
      enabled: true,
      note: "integration test v1",
    }, `create-${suffix}`) as { ruleKey: string; version: number };
    assert.equal(created.version, 1);

    const updated = await operations.updateAdminBillingRule(adminId, created.ruleKey, {
      provider: "runninghub",
      modelPattern: `billing-test-${suffix}`,
      matchType: "contains",
      discountRate: "0.75",
      priority: 500,
      enabled: true,
      note: "integration test v2",
    }, `update-${suffix}`) as { version: number; discountRate: string };
    assert.equal(updated.version, 2);
    assert.equal(updated.discountRate, "0.75000000");

    const snapshot = await new BillingService(pool, {
      baseUrl: "https://example.invalid",
      apiKey: "test-only",
      catalogUrl: "https://example.invalid/models",
    }).resolveRuleSnapshot("runninghub", `prefix.billing_test_${suffix}.suffix`);
    assert.equal(snapshot?.ruleKey, created.ruleKey);
    assert.equal(snapshot?.version, 2);
    assert.equal(snapshot?.discountRate, "0.75000000");

    const versions = await pool.query<{ count: string }>(
      "select count(*)::text count from provider_billing_rules where rule_key=$1",
      [created.ruleKey],
    );
    assert.equal(versions.rows[0]?.count, "2");
  } finally {
    await pool.end();
  }
});
