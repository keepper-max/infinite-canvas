import { NextResponse } from "next/server";
import { createSession, verifyPassword } from "@/lib/auth";
import { normalizeEmail } from "@/lib/account-identifiers";
import { findUserByAccount, markUserLoggedIn } from "@/lib/user-service";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { email?: string; password?: string } | null;
  let email = "";
  try { email = normalizeEmail(body?.email ?? ""); } catch { /* handled below */ }
  if (!email || !body?.password) return NextResponse.json({ error: "请输入邮箱和密码" }, { status: 400 });
  const user = await findUserByAccount("email", email);
  if (!user || !user.passwordHash || !(await verifyPassword(user.passwordHash, body.password))) return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });
  if (user.status !== "active") return NextResponse.json({ error: "账号已被禁用" }, { status: 403 });
  await markUserLoggedIn(user.id);
  await createSession(user.id);
  return NextResponse.json({ user: { id: user.id, email: user.email, phone: user.phone } });
}
