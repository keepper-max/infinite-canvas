import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { creditAccounts, users } from "@/db/schema";
import { createSession, hashPassword } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    email?: string;
    password?: string;
  } | null;
  const email = body?.email?.trim().toLowerCase();
  if (
    !email ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    !body?.password ||
    body.password.length < 6
  )
    return NextResponse.json(
      { error: "请输入有效邮箱和至少 6 位密码" },
      { status: 400 },
    );
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing[0])
    return NextResponse.json({ error: "邮箱已注册" }, { status: 409 });
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword(body.password) })
    .returning({ id: users.id, email: users.email });
  await db.insert(creditAccounts).values({ userId: user.id, balance: 1000 });
  await createSession(user.id);
  return NextResponse.json({ user });
}
