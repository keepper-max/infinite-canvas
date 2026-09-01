import { getCurrentUser } from "@/lib/auth";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { planId?: string };
  if (!body.planId) return Response.json({ error: "缺少 planId" }, { status: 400 });
  return Response.json({ status: "not_configured", provider: process.env.PAYMENT_PROVIDER ?? "unconfigured", planId: body.planId, message: "支付接口已预留，配置支付服务商后启用" }, { status: 501 });
}
