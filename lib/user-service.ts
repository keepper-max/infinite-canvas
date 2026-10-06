import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { creditAccounts, inviteCodeRedemptions, inviteCodes, users } from "@/db/schema";
import { db } from "@/lib/db";
import type { VerificationChannel } from "@/lib/account-identifiers";
import { InviteError, normalizeInviteCode } from "@/lib/invite-service";

export class UserError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export async function findUserByAccount(channel: VerificationChannel, account: string) {
  const condition = channel === "sms" ? eq(users.phone, account) : sql`lower(${users.email}) = ${account}`;
  const [user] = await db.select().from(users).where(condition).limit(1);
  return user ?? null;
}

export async function registerUser(input: {
  channel: VerificationChannel;
  account: string;
  inviteCode?: string | null;
  passwordHash?: string | null;
  verified?: boolean;
}) {
  const code = normalizeInviteCode(input.inviteCode);
  try {
    return await db.transaction(async (tx) => {
      let invite: typeof inviteCodes.$inferSelect | null = null;
      if (code) {
        const [locked] = await tx.select().from(inviteCodes).where(and(
          sql`upper(${inviteCodes.code}) = ${code}`,
          eq(inviteCodes.enabled, true),
          or(isNull(inviteCodes.expiresAt), gt(inviteCodes.expiresAt, new Date())),
        )).for("update").limit(1);
        if (!locked) throw new InviteError("邀请码不存在或已失效");
        if (locked.maxUses !== null && locked.useCount >= locked.maxUses) throw new InviteError("邀请码使用次数已达到上限");
        invite = locked;
      } else if (process.env.REGISTRATION_INVITE_REQUIRED === "true") {
        throw new InviteError("请输入邀请码");
      }

      const [user] = await tx.insert(users).values({
        phone: input.channel === "sms" ? input.account : null,
        phoneVerified: input.channel === "sms" && input.verified !== false,
        email: input.channel === "email" ? input.account : null,
        emailVerified: input.channel === "email" && input.verified !== false,
        passwordHash: input.passwordHash ?? null,
        inviteCode: code,
        sourceType: invite?.sourceType ?? "direct",
        schoolId: invite?.schoolId ?? null,
        channelId: invite?.channelId ?? null,
      }).returning();
      await tx.insert(creditAccounts).values({ userId: user.id, balance: 1000 });
      if (invite) {
        await tx.insert(inviteCodeRedemptions).values({ inviteCodeId: invite.id, userId: user.id });
        await tx.update(inviteCodes).set({ useCount: sql`${inviteCodes.useCount} + 1` }).where(eq(inviteCodes.id, invite.id));
      }
      return user;
    });
  } catch (error) {
    if (error instanceof InviteError) throw new UserError(400, error.message);
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      throw new UserError(409, input.channel === "sms" ? "该手机号已注册" : "该邮箱已注册");
    }
    throw error;
  }
}

export async function markUserLoggedIn(userId: string) {
  await db.update(users).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(users.id, userId));
}
