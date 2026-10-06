import { NextResponse } from "next/server";
import { normalizeAccount, type VerificationChannel } from "@/lib/account-identifiers";
import { createSession } from "@/lib/auth";
import { InviteError, validateInviteCode } from "@/lib/invite-service";
import { findUserByAccount, registerUser, UserError } from "@/lib/user-service";
import { VerificationCodeService, VerificationError } from "@/lib/verification-code";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { channel?: VerificationChannel; account?: string; code?: string; inviteCode?: string } | null;
    if (!body?.account || !body.code || !["sms", "email"].includes(body.channel ?? ""))
      return NextResponse.json({ error: "请填写账号和验证码" }, { status: 400 });
    const channel = body.channel as VerificationChannel;
    const account = normalizeAccount(channel, body.account);
    if (await findUserByAccount(channel, account))
      return NextResponse.json({ error: channel === "sms" ? "该手机号已注册" : "该邮箱已注册" }, { status: 409 });
    await validateInviteCode(body.inviteCode);
    await new VerificationCodeService().verify({ channel, scene: "register", account, code: body.code });
    const user = await registerUser({ channel, account, inviteCode: body.inviteCode });
    await createSession(user.id);
    return NextResponse.json({ user: { id: user.id, email: user.email, phone: user.phone } });
  } catch (error) {
    if (error instanceof VerificationError || error instanceof UserError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof InviteError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof Error && (error.message === "手机号格式不正确" || error.message === "邮箱格式不正确"))
      return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[auth] code registration failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "系统繁忙，请稍后重试" }, { status: 500 });
  }
}
