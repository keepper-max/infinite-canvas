import { NextResponse } from "next/server";
import { normalizeAccount, type VerificationChannel } from "@/lib/account-identifiers";
import { createSession } from "@/lib/auth";
import { findUserByAccount, markUserLoggedIn } from "@/lib/user-service";
import { VerificationCodeService, VerificationError } from "@/lib/verification-code";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { channel?: VerificationChannel; account?: string; code?: string } | null;
    if (!body?.account || !body.code || !["sms", "email"].includes(body.channel ?? ""))
      return NextResponse.json({ error: "请填写账号和验证码" }, { status: 400 });
    const channel = body.channel as VerificationChannel;
    const account = normalizeAccount(channel, body.account);
    const user = await findUserByAccount(channel, account);
    if (!user) return NextResponse.json({ error: "账号不存在，请先注册" }, { status: 404 });
    if (user.status !== "active") return NextResponse.json({ error: "账号已被禁用" }, { status: 403 });
    await new VerificationCodeService().verify({ channel, scene: "login", account, code: body.code });
    await markUserLoggedIn(user.id);
    await createSession(user.id);
    return NextResponse.json({ user: { id: user.id, email: user.email, phone: user.phone } });
  } catch (error) {
    if (error instanceof VerificationError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof Error && (error.message === "手机号格式不正确" || error.message === "邮箱格式不正确"))
      return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[auth] code login failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "系统繁忙，请稍后重试" }, { status: 500 });
  }
}
