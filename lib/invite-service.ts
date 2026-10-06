import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { inviteCodes } from "@/db/schema";
import { db } from "@/lib/db";

export class InviteError extends Error {}

function normalizeInviteCode(value?: string | null) {
  return value?.trim().toUpperCase() || null;
}

export async function validateInviteCode(value?: string | null) {
  const code = normalizeInviteCode(value);
  if (!code) {
    if (process.env.REGISTRATION_INVITE_REQUIRED === "true") throw new InviteError("请输入邀请码");
    return null;
  }
  const [invite] = await db.select().from(inviteCodes).where(and(
    sql`upper(${inviteCodes.code}) = ${code}`,
    eq(inviteCodes.enabled, true),
    or(isNull(inviteCodes.expiresAt), gt(inviteCodes.expiresAt, new Date())),
  )).limit(1);
  if (!invite) throw new InviteError("邀请码不存在或已失效");
  if (invite.maxUses !== null && invite.useCount >= invite.maxUses) throw new InviteError("邀请码使用次数已达到上限");
  return invite;
}

export { normalizeInviteCode };
