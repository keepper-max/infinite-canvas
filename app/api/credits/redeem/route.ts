import { and, eq, gt, isNull } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { activationCodes } from "@/db/schema";
import { hashActivationCode, isValidActivationCode } from "@/lib/activation-codes";
import { addCreditsLocked } from "@/lib/credit-account";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const body = await request.json().catch(() => null) as { code?: unknown } | null;
  if (typeof body?.code !== "string" || !isValidActivationCode(body.code)) {
    return Response.json({ error: "激活码无效或已过期" }, { status: 400 });
  }

  const result = await db.transaction(async (tx) => {
    // 条件更新只允许一个并发请求领取；余额和流水与领取状态同事务提交。
    const [claimed] = await tx.update(activationCodes)
      .set({ redeemedBy: user.id, redeemedAt: new Date() })
      .where(and(
        eq(activationCodes.codeHash, hashActivationCode(body.code as string)),
        isNull(activationCodes.redeemedAt),
        isNull(activationCodes.revokedAt),
        gt(activationCodes.expiresAt, new Date()),
      ))
      .returning({ id: activationCodes.id, credits: activationCodes.credits });
    if (!claimed) return null;

    const credited = await addCreditsLocked(tx, {
      userId: user.id,
      amount: claimed.credits,
      reason: "免费激活码赠送",
      sourceType: "activation",
      sourceId: claimed.id,
      activationCodeId: claimed.id,
    });
    if (!credited.added) throw new Error("激活码重复入账");
    return { added: claimed.credits, balance: credited.balance };
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === "积分余额已达上限") return "limit" as const;
    throw error;
  });

  if (result === "limit") return Response.json({ error: "积分余额已达上限" }, { status: 409 });
  if (!result) return Response.json({ error: "激活码无效或已过期" }, { status: 400 });
  return Response.json(result);
}
