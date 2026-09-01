import { getCurrentUser } from "@/lib/auth";
import { integrationStatuses } from "@/lib/external-services";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  return Response.json({ integrations: integrationStatuses() });
}
