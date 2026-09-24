import assert from "node:assert/strict";
import test from "node:test";

import { CreditService } from "../src/credit-service.js";
import { createDatabase } from "../src/db/client.js";
import { applyMigrations } from "../src/db/migrate.js";
import { PaymentService, type AlipayClientPort } from "../src/payment-service.js";
import { OperationsService } from "../src/operations-service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("Alipay order creation and settlement credit exactly once", { skip: !databaseUrl }, async () => {
  const { pool } = createDatabase(databaseUrl!);
  try {
    await applyMigrations(pool);
    const suffix = crypto.randomUUID();
    const user = await pool.query<{ id: string }>(
      "insert into users(email,password_hash,is_admin) values($1,'test',true) returning id",
      [`payment-${suffix}@example.com`],
    );
    const userId = user.rows[0]!.id;
    const client = fakeAlipay();
    const payments = new PaymentService(
      pool,
      new CreditService(pool),
      {
        provider: "alipay",
        enabled: true,
        complianceApproved: true,
        adminOnly: false,
        publicBaseUrl: "https://example.com",
        appId: "test-app",
        privateKey: "test-private-key",
        alipayPublicKey: "test-public-key",
        sellerId: "test-seller",
        orderTimeoutMinutes: 10,
      },
      client,
    );

    const idempotencyKey = crypto.randomUUID();
    const first = await payments.createOrder(userId, false, { planId: "alipay-package-990", idempotencyKey });
    const repeated = await payments.createOrder(userId, false, { planId: "alipay-package-990", idempotencyKey });
    assert.equal(first.order.id, repeated.order.id);
    assert.match(first.paymentUrl!, /^https:\/\/openapi\.alipay\.com\//);

    const paid = await payments.syncOrder(first.order.id, userId);
    assert.equal(paid.status, "paid");
    assert.equal((await new CreditService(pool).account(userId)).account.balance, "1000");

    const fields = {
      notify_id: `notify-${suffix}`,
      app_id: "test-app",
      seller_id: "test-seller",
      trade_status: "TRADE_SUCCESS",
      out_trade_no: first.order.id,
      trade_no: "2026092400000001",
      total_amount: "9.90",
      sign: "accepted-by-fake",
      sign_type: "RSA2",
    };
    assert.equal(await payments.receiveNotify(fields), true);
    assert.equal(await payments.receiveNotify(fields), true);
    const state = await pool.query<{ balance: string; entries: string }>(
      `select balance::text,
       (select count(*)::text from credit_ledger where idempotency_key=$2) entries
       from credit_accounts where user_id=$1`,
      [userId, `payment:${first.order.id}`],
    );
    assert.deepEqual(state.rows[0], { balance: "1000", entries: "1" });

    await assert.rejects(
      payments.createOrder(userId, false, { planId: "alipay-acceptance", idempotencyKey: crypto.randomUUID() }),
      (error: unknown) => error instanceof Error && error.message === "充值套餐不可用",
    );
    await assert.rejects(
      payments.createOrder(userId, true, { planId: "alipay-acceptance", idempotencyKey: crypto.randomUUID() }),
      (error: unknown) => error instanceof Error && error.message === "充值套餐不可用",
    );

    const operations = new OperationsService(pool, { adminEmails: [] });
    const initialPlans = await operations.adminPaymentPlans(userId) as Array<{ id: string; enabled: boolean }>;
    assert.equal(initialPlans.some((plan) => plan.id === "alipay-acceptance"), false);
    const nonAdmin = await pool.query<{ id: string }>(
      "insert into users(email,password_hash) values($1,'test') returning id",
      [`payment-viewer-${suffix}@example.com`],
    );
    await assert.rejects(
      operations.adminPaymentPlans(nonAdmin.rows[0]!.id),
      (error: unknown) => error instanceof Error && error.message === "需要管理员权限",
    );
    await assert.rejects(
      operations.updateAdminPaymentPlan(userId, "alipay-acceptance", {
        name: "支付验收订单",
        credits: 1,
        priceCents: 1,
        enabled: true,
      }, `locked-${suffix}`),
      (error: unknown) => error instanceof Error && error.message === "验收套餐已锁定，不能修改",
    );
    const draft = await operations.createAdminPaymentPlan(userId, {
      name: "测试套餐",
      credits: 2500,
      priceCents: 1990,
      enabled: false,
    }, `create-${suffix}`) as { id: string; enabled: boolean };
    assert.equal(draft.enabled, false);
    const published = await operations.updateAdminPaymentPlan(userId, draft.id, {
      name: "测试套餐",
      credits: 2500,
      priceCents: 1990,
      enabled: true,
    }, `publish-${suffix}`) as { id: string; enabled: boolean };
    assert.equal(published.enabled, true);
    const auditCount = await pool.query<{ count: string }>(
      "select count(*)::text count from admin_audit_logs where target_id=$1 and action like 'payment.plan.%'",
      [draft.id],
    );
    assert.equal(auditCount.rows[0]?.count, "2");
    await operations.updateAdminPaymentPlan(userId, "alipay-package-990", {
      name: "1000 积分套餐（调整后）",
      credits: 1100,
      priceCents: 1090,
      enabled: true,
    }, `reprice-${suffix}`);
    const snapshot = await pool.query<{ amount_cents: number; credits: string }>(
      "select amount_cents,credits::text from payment_orders where id=$1",
      [first.order.id],
    );
    assert.deepEqual(snapshot.rows[0], { amount_cents: 990, credits: "1000" });

    const adminOnlyPayments = new PaymentService(
      pool,
      new CreditService(pool),
      {
        provider: "alipay",
        enabled: true,
        complianceApproved: true,
        adminOnly: true,
        publicBaseUrl: "https://example.com",
        appId: "test-app",
        privateKey: "test-private-key",
        alipayPublicKey: "test-public-key",
        sellerId: "test-seller",
        orderTimeoutMinutes: 10,
      },
      client,
    );
    await assert.rejects(
      adminOnlyPayments.createOrder(userId, false, {
        planId: "alipay-package-990",
        idempotencyKey: crypto.randomUUID(),
      }),
      (error: unknown) => error instanceof Error && error.message === "支付宝充值正在验收中",
    );

    assert.equal(await payments.receiveNotify({ ...fields, notify_id: `wrong-${suffix}`, app_id: "other" }), false);
  } finally {
    await pool.end();
  }
});

function fakeAlipay(): AlipayClientPort {
  return {
    pageExecute: ((_method: string, _httpMethod: string, params: Record<string, unknown>) => {
      const query = new URLSearchParams({ method: "alipay.trade.page.pay", payload: JSON.stringify(params.bizContent) });
      return `https://openapi.alipay.com/gateway.do?${query}`;
    }) as AlipayClientPort["pageExecute"],
    exec: (async (_method: string, params?: Record<string, unknown>) => {
      const orderId = String((params?.bizContent as Record<string, unknown>)?.out_trade_no || "");
      return { code: "10000", msg: "Success", out_trade_no: orderId, trade_no: "2026092400000001", trade_status: "TRADE_SUCCESS", total_amount: "9.90" };
    }) as AlipayClientPort["exec"],
    checkNotifySignV2: (() => true) as AlipayClientPort["checkNotifySignV2"],
  };
}
