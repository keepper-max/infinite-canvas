import { and, asc, eq, gt, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { creditAccounts, creditLedger, creditLotDebits, creditLots } from "@/db/schema";

type CreditTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockAccount(tx: CreditTx, userId: string) {
  await tx.insert(creditAccounts).values({ userId, balance: 1000 }).onConflictDoNothing();
  const [account] = await tx.select().from(creditAccounts)
    .where(eq(creditAccounts.userId, userId)).for("update").limit(1);
  await tx.insert(creditLots).values({
    userId, sourceType: "legacy", sourceId: userId,
    creditsTotal: Math.max(0, account.balance), creditsRemaining: Math.max(0, account.balance),
  }).onConflictDoNothing();

  const expired = await tx.select().from(creditLots).where(and(
    eq(creditLots.userId, userId), isNotNull(creditLots.expiresAt),
    lte(creditLots.expiresAt, new Date()), gt(creditLots.creditsRemaining, 0),
  )).for("update");
  const expiredCredits = expired.reduce((sum, lot) => sum + lot.creditsRemaining, 0);
  if (expiredCredits) {
    for (const lot of expired) await tx.update(creditLots).set({ creditsRemaining: 0 }).where(eq(creditLots.id, lot.id));
    await tx.update(creditAccounts).set({ balance: sql`${creditAccounts.balance} - ${expiredCredits}`, updatedAt: new Date() })
      .where(eq(creditAccounts.userId, userId));
    await tx.insert(creditLedger).values({ userId, amount: -expiredCredits, reason: "付费积分到期" });
  }
  return account.balance - expiredCredits;
}

export async function getAvailableCredits(userId: string) {
  return db.transaction((tx) => lockAccount(tx, userId));
}

export async function addCreditsLocked(tx: CreditTx, input: {
  userId: string; amount: number; sourceType: "activation" | "alipay"; sourceId: string;
  reason: string; activationCodeId?: string; paymentOrderId?: string; expiresAt?: Date;
}) {
  const balance = await lockAccount(tx, input.userId);
  const remaining = Math.max(0, input.amount + Math.min(balance, 0));
  if (balance + input.amount > 2147483647) throw new Error("积分余额已达上限");
  const [lot] = await tx.insert(creditLots).values({
    userId: input.userId, sourceType: input.sourceType, sourceId: input.sourceId,
    creditsTotal: input.amount, creditsRemaining: remaining, expiresAt: input.expiresAt,
  }).onConflictDoNothing().returning({ id: creditLots.id });
  if (!lot) return { balance, added: false };
  const [account] = await tx.update(creditAccounts).set({
    balance: sql`${creditAccounts.balance} + ${input.amount}`, updatedAt: new Date(),
  }).where(eq(creditAccounts.userId, input.userId)).returning({ balance: creditAccounts.balance });
  await tx.insert(creditLedger).values({
    userId: input.userId, amount: input.amount, reason: input.reason,
    activationCodeId: input.activationCodeId, paymentOrderId: input.paymentOrderId,
  });
  return { balance: account.balance, added: true };
}

export async function deductJobCredits(userId: string, jobId: string, points: number) {
  if (!Number.isSafeInteger(points) || points <= 0) throw new Error("扣分数无效");
  return db.transaction(async (tx) => {
    await lockAccount(tx, userId);
    const [ledger] = await tx.insert(creditLedger).values({
      userId, amount: -points, reason: "供应商生成消耗", jobId,
    }).onConflictDoNothing().returning({ id: creditLedger.id });
    if (!ledger) return false;
    await tx.update(creditAccounts).set({
      balance: sql`${creditAccounts.balance} - ${points}`, updatedAt: new Date(),
    }).where(eq(creditAccounts.userId, userId));

    let outstanding = points;
    const lots = await tx.select().from(creditLots).where(and(
      eq(creditLots.userId, userId), gt(creditLots.creditsRemaining, 0),
    )).orderBy(sql`${creditLots.expiresAt} asc nulls last`, asc(creditLots.createdAt)).for("update");
    for (const lot of lots) {
      if (!outstanding) break;
      const take = Math.min(outstanding, lot.creditsRemaining);
      await tx.update(creditLots).set({ creditsRemaining: lot.creditsRemaining - take }).where(eq(creditLots.id, lot.id));
      await tx.insert(creditLotDebits).values({ ledgerId: ledger.id, lotId: lot.id, credits: take });
      outstanding -= take;
    }
    return true;
  });
}
