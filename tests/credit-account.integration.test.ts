import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

test("充值和激活码共用余额，账单重复执行只扣一次", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { db, pool } = await import("../lib/db");
  const { users, projects, generationJobs } = await import("../db/schema");
  const { addCreditsLocked, deductJobCredits, getAvailableCredits } = await import("../lib/credit-account");
  try {
    const [user] = await db.insert(users).values({ email: `${randomUUID()}@example.test`, passwordHash: "test" }).returning();
    const [project] = await db.insert(projects).values({ ownerId: user.id, name: "积分测试" }).returning();
    const [job] = await db.insert(generationJobs).values({ projectId: project.id, nodeId: "test", provider: "token360", modelId: "test" }).returning();
    const alipayId = randomUUID();
    const codeId = randomUUID();
    const paid = await db.transaction((tx) => addCreditsLocked(tx, { userId: user.id, amount: 1000, sourceType: "alipay", sourceId: alipayId, reason: "测试充值" }));
    assert.equal(paid.balance, 2000);
    const duplicate = await db.transaction((tx) => addCreditsLocked(tx, { userId: user.id, amount: 1000, sourceType: "alipay", sourceId: alipayId, reason: "重复通知" }));
    assert.equal(duplicate.added, false);
    await db.transaction((tx) => addCreditsLocked(tx, { userId: user.id, amount: 500, sourceType: "activation", sourceId: codeId, reason: "测试兑换" }));
    assert.equal(await getAvailableCredits(user.id), 2500);
    assert.equal(await deductJobCredits(user.id, job.id, 1200), true);
    assert.equal(await deductJobCredits(user.id, job.id, 1200), false);
    assert.equal(await getAvailableCredits(user.id), 1300);
  } finally { await pool.end(); }
});
