import { eq } from "drizzle-orm";
import { paymentOrders } from "@/db/schema";
import { alipaySdk, paymentPlans, paymentReady } from "@/lib/alipay";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  if (!paymentReady()) return Response.json({ error: "支付宝充值尚未开放" }, { status: 503 });
  const body = await request.json().catch(() => null) as { planId?: string; acceptedAgreement?: boolean } | null;
  const plan = body?.planId && Object.hasOwn(paymentPlans, body.planId)
    ? paymentPlans[body.planId as keyof typeof paymentPlans] : null;
  if (!plan || body?.acceptedAgreement !== true) return Response.json({ error: "请选择充值金额并同意服务协议" }, { status: 400 });
  const [order] = await db.insert(paymentOrders).values({ userId: user.id, ...plan }).returning({ id: paymentOrders.id });
  try {
    const base = process.env.PUBLIC_BASE_URL!.replace(/\/+$/, "");
    const paymentUrl = alipaySdk().pageExecute("alipay.trade.page.pay", "GET", {
      notifyUrl: `${base}/api/payments/notify`,
      returnUrl: `${base}/?view=credits&order=${order.id}`,
      bizContent: {
        out_trade_no: order.id,
        total_amount: (plan.amountCents / 100).toFixed(2),
        subject: "镜界工坊积分",
        product_code: "FAST_INSTANT_TRADE_PAY",
      },
    });
    return Response.json({ orderId: order.id, paymentUrl }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await db.update(paymentOrders).set({ status: "failed" }).where(eq(paymentOrders.id, order.id));
    return Response.json({ error: "支付订单创建失败" }, { status: 502 });
  }
}
