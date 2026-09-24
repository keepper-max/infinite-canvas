import { createHash } from "node:crypto";
import { AlipaySdk } from "alipay-sdk";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import type { PaymentConfig } from "./config.js";
import type { CreditService } from "./credit-service.js";
import { DomainError } from "./domain.js";
import type { PaymentOrderInput } from "./operations-contract.js";

export type AlipayClientPort = Pick<AlipaySdk, "pageExecute" | "exec" | "checkNotifySignV2">;

export class PaymentService {
  private readonly alipay?: AlipayClientPort;

  constructor(
    private readonly pool: Pool,
    private readonly credits: CreditService,
    private readonly config: PaymentConfig,
    client?: AlipayClientPort,
  ) {
    if (this.configured())
      this.alipay =
        client ||
        new AlipaySdk({
          appId: config.appId,
          privateKey: config.privateKey,
          alipayPublicKey: config.alipayPublicKey,
          signType: "RSA2",
          keyType: "PKCS8",
          camelcase: false,
          gateway: "https://openapi.alipay.com/gateway.do",
        });
  }

  enabled() {
    return Boolean(
      this.config.enabled &&
        this.config.complianceApproved &&
        this.config.provider === "alipay" &&
        this.alipay &&
        this.config.orderTimeoutMinutes,
    );
  }

  configured() {
    return Boolean(
      this.config.appId &&
        this.config.privateKey &&
        this.config.alipayPublicKey &&
        this.config.sellerId &&
        this.config.publicBaseUrl,
    );
  }

  async createOrder(userId: string, input: PaymentOrderInput) {
    this.assertEnabled();
    const timeoutMinutes = this.config.orderTimeoutMinutes!;
    const expiresAt = new Date(Date.now() + timeoutMinutes * 60_000);
    const order = await transaction(this.pool, async (client) => {
      const plan = (
        await client.query(
          `select id,name,credits,price_cents,currency from billing_plans
           where id=$1 and enabled=true and metadata->>'paymentProvider'='alipay' for share`,
          [input.planId],
        )
      ).rows[0];
      if (
        !plan ||
        plan.currency !== "CNY" ||
        Number(plan.price_cents) <= 0 ||
        BigInt(String(plan.credits)) <= 0n
      )
        throw new DomainError("PAYMENT_PLAN_INVALID", "充值套餐不可用", 400);
      const inserted = await client.query(
        `insert into payment_orders(
           user_id,plan_id,amount_cents,credits,currency,provider,status,idempotency_key,expires_at,metadata
         ) values($1,$2,$3,$4,'CNY','alipay','pending',$5,$6,$7)
         on conflict(user_id,idempotency_key) do nothing returning *`,
        [
          userId,
          plan.id,
          Number(plan.price_cents),
          String(plan.credits),
          input.idempotencyKey,
          expiresAt,
          JSON.stringify({ planName: plan.name }),
        ],
      );
      const existing = inserted.rows[0] || (
        await client.query(
          "select * from payment_orders where user_id=$1 and idempotency_key=$2 for update",
          [userId, input.idempotencyKey],
        )
      ).rows[0];
      if (!existing || String(existing.plan_id) !== input.planId)
        throw new DomainError(
          "PAYMENT_IDEMPOTENCY_CONFLICT",
          "该支付请求已用于其他充值套餐",
          409,
        );
      return existing;
    });
    if (order.status !== "pending") return { order: serializeOrder(order) };
    const paymentUrl = this.alipay!.pageExecute(
      "alipay.trade.page.pay",
      "GET",
      {
        notifyUrl: `${this.config.publicBaseUrl}/api/payments/notify`,
        returnUrl: `${this.config.publicBaseUrl}/credits?order=${order.id}`,
        bizContent: {
          out_trade_no: String(order.id),
          total_amount: centsText(order.amount_cents),
          subject: "守守画布积分",
          product_code: "FAST_INSTANT_TRADE_PAY",
          time_expire: alipayDate(order.expires_at),
        },
      },
    );
    const destination = new URL(paymentUrl);
    if (
      destination.protocol !== "https:" ||
      destination.hostname !== "openapi.alipay.com"
    )
      throw new DomainError("PAYMENT_URL_INVALID", "支付宝支付地址异常", 502);
    return { order: serializeOrder(order), paymentUrl };
  }

  async listOrders(userId: string) {
    const result = await this.pool.query(
      `select * from payment_orders where user_id=$1 and provider='alipay'
       order by created_at desc limit 50`,
      [userId],
    );
    return result.rows.map(serializeOrder);
  }

  async listAdminOrders() {
    const result = await this.pool.query(
      `select po.*,u.email from payment_orders po join users u on u.id=po.user_id
       where po.provider='alipay' order by po.created_at desc limit 200`,
    );
    return result.rows.map((row) => ({ ...serializeOrder(row), userEmail: row.email }));
  }

  async syncOrder(orderId: string, userId?: string) {
    this.assertEnabled();
    const params: unknown[] = [orderId];
    const scoped = userId ? " and user_id=$2" : "";
    if (userId) params.push(userId);
    const order = (
      await this.pool.query(
        `select * from payment_orders where id=$1 and provider='alipay'${scoped}`,
        params,
      )
    ).rows[0];
    if (!order) throw new DomainError("PAYMENT_ORDER_NOT_FOUND", "支付订单不存在", 404);
    if (["paid", "closed"].includes(String(order.status))) return serializeOrder(order);
    const result = asRecord(
      await this.alipay!.exec(
        "alipay.trade.query",
        { bizContent: { out_trade_no: orderId } },
        { validateSign: true },
      ),
    );
    if (String(result.code || "") !== "10000") {
      await this.markSyncFailure(orderId, result);
      if (expired(order.expires_at))
        return this.closeOrder(order);
      return serializeOrder(await this.order(orderId));
    }
    if (String(result.out_trade_no || "") !== orderId)
      throw new DomainError("PAYMENT_QUERY_MISMATCH", "支付宝订单号校验失败", 502);
    const status = String(result.trade_status || "");
    if (["TRADE_SUCCESS", "TRADE_FINISHED"].includes(status)) {
      const applied = await this.applyPaid(
        orderId,
        String(result.trade_no || ""),
        String(result.total_amount || ""),
      );
      if (!applied)
        await this.pool.query(
          `update payment_orders set last_synced_at=now(),failure_code='PAYMENT_AMOUNT_MISMATCH',
           failure_message='支付宝返回金额与订单金额不一致',updated_at=now() where id=$1`,
          [orderId],
        );
    } else if (status === "TRADE_CLOSED") {
      await this.pool.query(
        `update payment_orders set status='closed',closed_at=coalesce(closed_at,now()),
         last_synced_at=now(),failure_code=null,failure_message=null,updated_at=now() where id=$1`,
        [orderId],
      );
    } else if (expired(order.expires_at)) {
      return this.closeOrder(order);
    } else {
      await this.pool.query(
        `update payment_orders set last_synced_at=now(),failure_code=null,
         failure_message=null,updated_at=now() where id=$1`,
        [orderId],
      );
    }
    return serializeOrder(await this.order(orderId));
  }

  async receiveNotify(fields: Record<string, string>) {
    this.assertEnabled();
    const payloadSha256 = hashFields(fields);
    if (!this.alipay!.checkNotifySignV2(fields)) {
      await this.recordReceipt(`invalid:${payloadSha256}`, payloadSha256, false, "rejected");
      return false;
    }
    const eventId = fields.notify_id || fields.trade_no || payloadSha256;
    if (
      fields.app_id !== this.config.appId ||
      fields.seller_id !== this.config.sellerId ||
      !["TRADE_SUCCESS", "TRADE_FINISHED"].includes(fields.trade_status || "") ||
      !fields.out_trade_no ||
      !fields.trade_no ||
      !fields.total_amount
    ) {
      await this.recordReceipt(eventId, payloadSha256, true, "rejected");
      return false;
    }
    return this.applyPaid(
      fields.out_trade_no,
      fields.trade_no,
      fields.total_amount,
      { eventId, payloadSha256 },
    );
  }

  private async applyPaid(
    orderId: string,
    providerOrderId: string,
    totalAmount: string,
    receipt?: { eventId: string; payloadSha256: string },
  ) {
    if (!providerOrderId || !/^\d+(?:\.\d{1,2})?$/.test(totalAmount)) return false;
    return transaction(this.pool, async (client) => {
      if (receipt) {
        const inserted = await client.query(
          `insert into payment_callback_receipts(provider,event_id,payload_sha256,signature_valid,status)
           values('alipay',$1,$2,true,'received') on conflict(provider,event_id) do nothing returning id`,
          [receipt.eventId, receipt.payloadSha256],
        );
        if (!inserted.rowCount) {
          const prior = (
            await client.query(
              "select payload_sha256,status from payment_callback_receipts where provider='alipay' and event_id=$1",
              [receipt.eventId],
            )
          ).rows[0];
          return prior?.payload_sha256 === receipt.payloadSha256 && prior?.status === "processed";
        }
      }
      const order = (
        await client.query(
          "select * from payment_orders where id=$1 and provider='alipay' for update",
          [orderId],
        )
      ).rows[0];
      if (!order || centsValue(totalAmount) !== Number(order.amount_cents)) {
        if (order)
          await client.query(
            `update payment_orders set last_synced_at=now(),failure_code='PAYMENT_AMOUNT_MISMATCH',
             failure_message='支付宝返回金额与订单金额不一致',updated_at=now() where id=$1`,
            [orderId],
          );
        if (receipt)
          await client.query(
            "update payment_callback_receipts set status='rejected' where provider='alipay' and event_id=$1",
            [receipt.eventId],
          );
        return false;
      }
      if (order.status === "paid") {
        const same = String(order.provider_order_id) === providerOrderId;
        if (receipt)
          await client.query(
            "update payment_callback_receipts set status=$2 where provider='alipay' and event_id=$1",
            [receipt.eventId, same ? "processed" : "rejected"],
          );
        return same;
      }
      await this.credits.creditPurchase(client, {
        userId: String(order.user_id),
        orderId,
        credits: BigInt(String(order.credits)),
        amountCents: Number(order.amount_cents),
        currency: "CNY",
        providerOrderId,
      });
      await client.query(
        `update payment_orders set status='paid',provider_order_id=$2,paid_at=coalesce(paid_at,now()),
         last_synced_at=now(),failure_code=null,failure_message=null,updated_at=now() where id=$1`,
        [orderId, providerOrderId],
      );
      if (receipt)
        await client.query(
          "update payment_callback_receipts set status='processed' where provider='alipay' and event_id=$1",
          [receipt.eventId],
        );
      return true;
    });
  }

  private async closeOrder(order: QueryResultRow) {
    const result = asRecord(
      await this.alipay!.exec(
        "alipay.trade.close",
        { bizContent: { out_trade_no: String(order.id) } },
        { validateSign: true },
      ),
    );
    const missing = String(result.sub_code || "") === "ACQ.TRADE_NOT_EXIST";
    if (String(result.code || "") === "10000" || missing)
      await this.pool.query(
        `update payment_orders set status='closed',closed_at=coalesce(closed_at,now()),
         last_synced_at=now(),failure_code=null,failure_message=null,updated_at=now() where id=$1 and status<>'paid'`,
        [order.id],
      );
    else await this.markSyncFailure(String(order.id), result);
    return serializeOrder(await this.order(String(order.id)));
  }

  private async markSyncFailure(orderId: string, result: Record<string, unknown>) {
    await this.pool.query(
      `update payment_orders set last_synced_at=now(),failure_code=$2,
       failure_message=$3,updated_at=now() where id=$1`,
      [
        orderId,
        safeText(result.sub_code || result.code, 100),
        safeText(result.sub_msg || result.msg || "支付宝订单暂不可查询", 300),
      ],
    );
  }

  private async recordReceipt(
    eventId: string,
    payloadSha256: string,
    signatureValid: boolean,
    status: string,
  ) {
    await this.pool.query(
      `insert into payment_callback_receipts(provider,event_id,payload_sha256,signature_valid,status)
       values('alipay',$1,$2,$3,$4) on conflict(provider,event_id) do nothing`,
      [eventId, payloadSha256, signatureValid, status],
    );
  }

  private async order(orderId: string) {
    const order = (
      await this.pool.query("select * from payment_orders where id=$1", [orderId])
    ).rows[0];
    if (!order) throw new DomainError("PAYMENT_ORDER_NOT_FOUND", "支付订单不存在", 404);
    return order;
  }

  private assertEnabled() {
    if (!this.enabled())
      throw new DomainError("PAYMENTS_DISABLED", "支付宝充值尚未开放", 503);
  }
}

async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await action(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function serializeOrder(row: QueryResultRow) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    planId: row.plan_id ? String(row.plan_id) : undefined,
    amountCents: Number(row.amount_cents),
    credits: String(row.credits),
    currency: String(row.currency),
    provider: String(row.provider),
    status: String(row.status),
    failureCode: row.failure_code ? String(row.failure_code) : undefined,
    failureMessage: row.failure_message ? String(row.failure_message) : undefined,
    paidAt: iso(row.paid_at),
    expiresAt: iso(row.expires_at),
    closedAt: iso(row.closed_at),
    lastSyncedAt: iso(row.last_synced_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function hashFields(fields: Record<string, string>) {
  return createHash("sha256")
    .update(
      Object.keys(fields)
        .sort()
        .map((key) => `${key}=${fields[key]}`)
        .join("&"),
    )
    .digest("hex");
}

function centsValue(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [yuan, fraction = ""] = value.split(".");
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

function centsText(value: unknown) {
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents <= 0)
    throw new DomainError("PAYMENT_AMOUNT_INVALID", "充值金额无效", 500);
  return (cents / 100).toFixed(2);
}

function alipayDate(value: unknown) {
  const date = new Date(String(value));
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
  return parts.replace("T", " ");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function safeText(value: unknown, max: number) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").slice(0, max);
}

function expired(value: unknown) {
  if (!value) return false;
  const timestamp = new Date(String(value)).getTime();
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function iso(value: unknown) {
  if (!value) return undefined;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
