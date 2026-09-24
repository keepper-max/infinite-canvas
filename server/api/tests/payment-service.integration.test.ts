import assert from "node:assert/strict";
import test from "node:test";

import { CreditService } from "../src/credit-service.js";
import { createDatabase } from "../src/db/client.js";
import { applyMigrations } from "../src/db/migrate.js";
import { PaymentService, type AlipayClientPort } from "../src/payment-service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("Alipay order creation and settlement credit exactly once", { skip: !databaseUrl }, async () => {
  const { pool } = createDatabase(databaseUrl!);
  try {
    await applyMigrations(pool);
    const suffix = crypto.randomUUID();
    const user = await pool.query<{ id: string }>(
      "insert into users(email,password_hash) values($1,'test') returning id",
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
        publicBaseUrl: "https://example.com",
        appId: "test-app",
        privateKey: "test-private-key",
        alipayPublicKey: "test-public-key",
        sellerId: "test-seller",
        orderTimeoutMinutes: 30,
      },
      client,
    );

    const idempotencyKey = crypto.randomUUID();
    const first = await payments.createOrder(userId, { planId: "alipay-starter", idempotencyKey });
    const repeated = await payments.createOrder(userId, { planId: "alipay-starter", idempotencyKey });
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
      total_amount: "10.00",
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
      return { code: "10000", msg: "Success", out_trade_no: orderId, trade_no: "2026092400000001", trade_status: "TRADE_SUCCESS", total_amount: "10.00" };
    }) as AlipayClientPort["exec"],
    checkNotifySignV2: (() => true) as AlipayClientPort["checkNotifySignV2"],
  };
}
