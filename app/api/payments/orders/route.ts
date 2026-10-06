import { desc, eq } from "drizzle-orm";
import { paymentOrders } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  const orders = await db.select({
    id: paymentOrders.id, amountCents: paymentOrders.amountCents,
    credits: paymentOrders.credits, status: paymentOrders.status,
    createdAt: paymentOrders.createdAt, paidAt: paymentOrders.paidAt,
  }).from(paymentOrders).where(eq(paymentOrders.userId, user.id))
    .orderBy(desc(paymentOrders.createdAt)).limit(20);
  return Response.json({ orders }, { headers: { "Cache-Control": "no-store" } });
}
