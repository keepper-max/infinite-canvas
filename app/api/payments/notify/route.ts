import { eq } from "drizzle-orm";
import { paymentOrders } from "@/db/schema";
import { alipaySdk, paymentReady } from "@/lib/alipay";
import { addCreditsLocked } from "@/lib/credit-account";
import { db } from "@/lib/db";

function cents(value: string | undefined) {
  if (!value || !/^\d+\.\d{2}$/.test(value)) return null;
  const [yuan, fen] = value.split(".");
  const amount = Number(yuan) * 100 + Number(fen);
  return Number.isSafeInteger(amount) ? amount : null;
}

export async function POST(request: Request) {
  if (!paymentReady()) return new Response("failure", { status: 503 });
  const form = await request.formData().catch(() => null);
  if (!form) return new Response("failure", { status: 400 });
  const fields = Object.fromEntries([...form].map(([key, value]) => [key, String(value)]));
  if (!alipaySdk().checkNotifySignV2(fields) ||
      fields.app_id !== process.env.ALIPAY_APP_ID ||
      fields.seller_id !== process.env.ALIPAY_SELLER_ID ||
      !["TRADE_SUCCESS", "TRADE_FINISHED"].includes(fields.trade_status) ||
      !fields.trade_no || !fields.out_trade_no) return new Response("failure", { status: 400 });

  const result = await db.transaction(async (tx) => {
    const [order] = await tx.select().from(paymentOrders).where(eq(paymentOrders.id, fields.out_trade_no)).for("update").limit(1);
    if (!order || cents(fields.total_amount) !== order.amountCents) return false;
    if (order.status === "paid") return order.alipayTradeNo === fields.trade_no;
    if (order.status !== "pending") return false;
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    await addCreditsLocked(tx, {
      userId: order.userId, amount: order.credits, sourceType: "alipay", sourceId: order.id,
      paymentOrderId: order.id, reason: "支付宝充值", expiresAt,
    });
    await tx.update(paymentOrders).set({ status: "paid", paidAt: new Date(), alipayTradeNo: fields.trade_no })
      .where(eq(paymentOrders.id, order.id));
    return true;
  }).catch(() => false);
  return new Response(result ? "success" : "failure", { status: result ? 200 : 400 });
}
