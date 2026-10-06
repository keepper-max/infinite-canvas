import { NextResponse } from "next/server";
import { normalizeAccount, type VerificationChannel, type VerificationScene } from "@/lib/account-identifiers";
import { smtpEmailService } from "@/lib/email-service";
import { getRequestIp } from "@/lib/request-ip";
import { aliyunSmsService } from "@/lib/sms-service";
import { findUserByAccount } from "@/lib/user-service";
import { VerificationCodeService, VerificationError } from "@/lib/verification-code";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { channel?: VerificationChannel; account?: string; scene?: VerificationScene } | null;
    if (!body?.account || !["sms", "email"].includes(body.channel ?? "") || !["register", "login"].includes(body.scene ?? ""))
      return NextResponse.json({ error: "请求参数不正确" }, { status: 400 });
    const channel = body.channel as VerificationChannel;
    const scene = body.scene as VerificationScene;
    const account = normalizeAccount(channel, body.account);
    const existing = await findUserByAccount(channel, account);
    if (scene === "register" && existing)
      return NextResponse.json({ error: channel === "sms" ? "该手机号已注册" : "该邮箱已注册" }, { status: 409 });
    if (scene === "login" && (!existing || existing.status !== "active"))
      return NextResponse.json({ error: existing?.status === "disabled" ? "账号已被禁用" : "账号不存在，请先注册" }, { status: existing ? 403 : 404 });

    await new VerificationCodeService().send({
      channel,
      scene,
      account,
      ip: getRequestIp(request),
      deliver: (code) => channel === "sms"
        ? aliyunSmsService.sendVerificationCode(account, code)
        : smtpEmailService.sendVerificationCode(account, code),
    });
    return NextResponse.json({ ok: true, message: "验证码已发送", retryAfter: 60 });
  } catch (error) {
    if (error instanceof VerificationError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof Error && (error.message === "手机号格式不正确" || error.message === "邮箱格式不正确"))
      return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[auth] verification send failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "系统繁忙，请稍后重试" }, { status: 500 });
  }
}
