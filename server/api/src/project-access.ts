import type { Pool, PoolClient } from "pg";

import { DomainError } from "./domain.js";

export const canEditProjectRole = (role: unknown) => ['owner', 'admin', 'editor'].includes(String(role));

export type ProjectAccessMode = "read" | "edit";

// Operator identity is configuration, never a userId supplied by a tool request.
// Requery on every call so disabling an account takes effect without a restart.
export async function resolveActiveUser(
  executor: Pick<Pool, "query"> | PoolClient,
  identity: { userId?: string; account?: string },
): Promise<string> {
  const userId = identity.userId?.trim() || null;
  const account = identity.account?.trim() || null;
  if (!userId && !account)
    throw new DomainError("UNAUTHENTICATED", "未配置 MCP 平台身份", 401);
  const result = await executor.query(
    `select id::text as id from users where account_status='active'
     and ($1::text is null or id::text=$1)
     and ($2::text is null or email=$2 or phone=$2) limit 1`,
    [userId, account],
  );
  if (!result.rows[0])
    throw new DomainError("UNAUTHENTICATED", "MCP 平台身份不存在、配置不一致或已停用", 401);
  return result.rows[0].id;
}

export async function assertProjectAccess(
  executor: Pick<Pool, "query"> | PoolClient,
  projectId: string,
  userId: string,
  mode: ProjectAccessMode = "read",
) {
  const result = await executor.query(
    `select m.role from project_members m
     join projects p on p.id=m.project_id
     where m.project_id=$1 and m.user_id=$2 and p.deleted_at is null`,
    [projectId, userId],
  );
  const role = result.rows[0]?.role as string | undefined;
  if (!role) throw new DomainError("PROJECT_FORBIDDEN", "无权访问该项目", 403);
  if (mode === "edit" && !canEditProjectRole(role))
    throw new DomainError("PROJECT_READ_ONLY", "当前成员只有查看权限", 403);
  return role;
}
