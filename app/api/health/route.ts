import { pool } from "@/lib/db";
import { getRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks = { postgres: false, redis: false };
  try { await pool.query("select 1"); checks.postgres = true; } catch { /* 服务未启动时返回可诊断状态 */ }
  try { await getRedis().ping(); checks.redis = true; } catch { /* 服务未启动时返回可诊断状态 */ }
  const ok = checks.postgres && checks.redis;
  return Response.json({ ok, service: "jingjie-studio", provider: "mock", checks }, { status: ok ? 200 : 503 });
}
