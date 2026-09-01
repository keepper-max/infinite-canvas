import { getCurrentUser } from "@/lib/auth";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { phone?: string; purpose?: string };
  if (!body.phone || !/^1\d{10}$/.test(body.phone)) return Response.json({ error: "请输入有效手机号" }, { status: 400 });
  return Response.json({ status: "not_configured", provider: process.env.SMS_PROVIDER ?? "unconfigured", purpose: body.purpose ?? "login", message: "短信接口已预留，配置短信服务商后启用" }, { status: 501 });
}
