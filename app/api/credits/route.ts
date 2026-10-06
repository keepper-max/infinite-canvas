import { getCurrentUser } from "@/lib/auth";
import { creditAccounts, creditLedger } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { isActivationAdmin } from "@/lib/activation-codes";
import { getAvailableCredits } from "@/lib/credit-account";
import { paymentReady } from "@/lib/alipay";
import { currentFxRate } from "@/lib/credit-pricing";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  await getAvailableCredits(user.id);
  const [account] = await db
    .select()
    .from(creditAccounts)
    .where(eq(creditAccounts.userId, user.id))
    .limit(1);
  const ledger = await db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.userId, user.id))
    .orderBy(desc(creditLedger.createdAt))
    .limit(50);
  return Response.json({
    balance: account?.balance ?? 0,
    ledger,
    paymentEnabled: paymentReady(),
    operatorName: paymentReady() ? process.env.SERVICE_OPERATOR_NAME : null,
    supportEmail: paymentReady() ? process.env.SERVICE_SUPPORT_EMAIL : null,
    usdCnyRate: currentFxRate()?.toString() ?? null,
    message: "真实供应商任务按实际账单扣分；Mock 任务不扣分",
    isCodeAdmin: isActivationAdmin(user.id),
  }, { headers: { "Cache-Control": "no-store" } });
}
