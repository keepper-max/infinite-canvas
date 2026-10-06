import { NextResponse } from "next/server";
import { createSession, hashPassword } from "@/lib/auth";
import { normalizeEmail } from "@/lib/account-identifiers";
import { findUserByAccount, registerUser, UserError } from "@/lib/user-service";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    email?: string;
    password?: string;
  } | null;
  let email = "";
  try { email = normalizeEmail(body?.email ?? ""); } catch { /* handled below */ }
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
  const existing = await findUserByAccount("email", email);
  if (existing)
    return NextResponse.json({ error: "邮箱已注册" }, { status: 409 });
  try {
    const user = await registerUser({ channel: "email", account: email, passwordHash: await hashPassword(body.password), verified: false });
    await createSession(user.id);
    return NextResponse.json({ user: { id: user.id, email: user.email, phone: user.phone } });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "系统繁忙，请稍后重试" }, { status: 500 });
  }
}
