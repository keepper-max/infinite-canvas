import { sql } from "drizzle-orm";
import type { PlatformDatabase } from "./db/client.js";
import { DomainError } from "./domain.js";
/** Shared admin policy for knowledge and native runtime grants. No project access is granted here. */
export async function grantUserFeature(
  db: PlatformDatabase,
  adminEmails: string[],
  actor: string,
  target: string,
  feature: "knowledge" | "native_agent",
  enabled: boolean,
  reason: string,
) {
  return db.transaction(async (tx) => {
    const admin = await tx.execute(
      sql`select id from users where id=${actor} and account_status='active' and (is_admin=true or lower(email) in (select jsonb_array_elements_text(${JSON.stringify(adminEmails)}::jsonb))) for share`,
    );
    if (!admin.rows.length)
      throw new DomainError("ADMIN_FORBIDDEN", "需要管理员权限", 403);
    const current = await tx.execute(
      sql`select id,account_status from users where id=${target} for update`,
    );
    if (
      !current.rows.length ||
      (enabled && current.rows[0].account_status !== "active")
    )
      throw new DomainError("USER_NOT_FOUND", "用户不存在或已停用", 404);
    await tx.execute(
      sql`insert into user_feature_grants(user_id,feature,enabled,updated_by,reason) values(${target},${feature},${enabled},${actor},${reason}) on conflict(user_id,feature) do update set enabled=excluded.enabled,updated_by=excluded.updated_by,reason=excluded.reason,updated_at=now()`,
    );
    await tx.execute(
      sql`insert into admin_audit_logs(actor_user_id,action,target_type,target_id,metadata) values(${actor},${"feature." + feature + ".grant"},'user',${target},${JSON.stringify({ enabled, reason })}::jsonb)`,
    );
    return { userId: target, enabled };
  });
}
