import { desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { creditAccounts, projects, users } from "@/db/schema";
import { maskEmail, maskPhone } from "@/lib/account-identifiers";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "无权访问" }, { status: 403 });
  const reveal = new URL(request.url).searchParams.get("reveal") === "1";
  const rows = await db.select({
    id: users.id,
    phone: users.phone,
    phoneVerified: users.phoneVerified,
    email: users.email,
    emailVerified: users.emailVerified,
    sourceType: users.sourceType,
    inviteCode: users.inviteCode,
    schoolId: users.schoolId,
    channelId: users.channelId,
    status: users.status,
    createdAt: users.createdAt,
    lastLoginAt: users.lastLoginAt,
    credits: creditAccounts.balance,
    projectCount: sql<number>`count(${projects.id})::int`,
  }).from(users)
    .leftJoin(creditAccounts, eq(creditAccounts.userId, users.id))
    .leftJoin(projects, eq(projects.ownerId, users.id))
    .groupBy(users.id, creditAccounts.balance)
    .orderBy(desc(users.createdAt))
    .limit(500);
  return NextResponse.json({ users: rows.map((user) => ({
    ...user,
    phone: reveal ? user.phone : maskPhone(user.phone),
    email: reveal ? user.email : maskEmail(user.email),
  })) });
}
