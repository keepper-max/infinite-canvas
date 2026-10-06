import { and, desc, eq, isNull } from "drizzle-orm";
import { activationCodes } from "@/db/schema";
import { generateActivationCode, hashActivationCode, isActivationAdmin } from "@/lib/activation-codes";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

async function admin() {
  const user = await getCurrentUser();
  return user && isActivationAdmin(user.id) ? user : null;
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  try { return new URL(origin).host === request.headers.get("host"); }
  catch { return false; }
}

export async function GET() {
  if (!await admin()) return Response.json({ error: "无权限" }, { status: 403 });
  const codes = await db.select({
    id: activationCodes.id,
    codeHint: activationCodes.codeHint,
    credits: activationCodes.credits,
    expiresAt: activationCodes.expiresAt,
    redeemedAt: activationCodes.redeemedAt,
    revokedAt: activationCodes.revokedAt,
    createdAt: activationCodes.createdAt,
  }).from(activationCodes).orderBy(desc(activationCodes.createdAt)).limit(50);
  return Response.json({ codes }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "请求来源无效" }, { status: 403 });
  const user = await admin();
  if (!user) return Response.json({ error: "无权限" }, { status: 403 });
  const body = await request.json().catch(() => null) as { credits?: unknown; validDays?: unknown } | null;
  const credits = body?.credits;
  const validDays = body?.validDays;
  if (!Number.isSafeInteger(credits) || !Number.isSafeInteger(validDays) ||
      (credits as number) < 1 || (credits as number) > 10000 ||
      (validDays as number) < 1 || (validDays as number) > 90) {
    return Response.json({ error: "赠送积分需为 1–10000，有效天数需为 1–90" }, { status: 400 });
  }

  const code = generateActivationCode();
  const expiresAt = new Date(Date.now() + (validDays as number) * 24 * 60 * 60 * 1000);
  const [record] = await db.insert(activationCodes).values({
    codeHash: hashActivationCode(code),
    codeHint: code.slice(-4),
    credits: credits as number,
    expiresAt,
    createdBy: user.id,
  }).returning({ id: activationCodes.id });
  // 明文只在这次响应中提供，数据库与列表均不保存或回显。
  return Response.json({ id: record.id, code, credits, expiresAt }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "请求来源无效" }, { status: 403 });
  const user = await admin();
  if (!user) return Response.json({ error: "无权限" }, { status: 403 });
  const body = await request.json().catch(() => null) as { id?: unknown } | null;
  if (typeof body?.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id)) {
    return Response.json({ error: "激活码 ID 无效" }, { status: 400 });
  }
  const [revoked] = await db.update(activationCodes).set({ revokedAt: new Date(), revokedBy: user.id })
    .where(and(eq(activationCodes.id, body.id), isNull(activationCodes.redeemedAt), isNull(activationCodes.revokedAt)))
    .returning({ id: activationCodes.id });
  if (!revoked) return Response.json({ error: "激活码不存在或已使用" }, { status: 409 });
  return Response.json({ id: revoked.id, revoked: true });
}
