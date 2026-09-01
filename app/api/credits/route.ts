import { getCurrentUser } from "@/lib/auth";
import { creditAccounts, creditLedger } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  await db
    .insert(creditAccounts)
    .values({ userId: user.id, balance: 1000 })
    .onConflictDoNothing();
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
    provider: process.env.CREDITS_PROVIDER ?? "mock",
    mock: true,
    message: "积分账本已启用，Mock 任务不扣费",
  });
}
