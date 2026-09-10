import type { Pool, PoolClient } from "pg";

import { DomainError } from "./domain.js";

export type ProjectAccessMode = "read" | "edit";

export async function assertProjectAccess(
  executor: Pick<Pool, "query"> | PoolClient,
  projectId: string,
  userId: string,
  mode: ProjectAccessMode = "read",
) {
  const result = await executor.query(
    "select role from project_members where project_id=$1 and user_id=$2",
    [projectId, userId],
  );
  const role = result.rows[0]?.role as string | undefined;
  if (!role) throw new DomainError("PROJECT_FORBIDDEN", "无权访问该项目", 403);
  if (mode === "edit" && !["owner", "admin", "editor"].includes(role))
    throw new DomainError("PROJECT_READ_ONLY", "当前成员只有查看权限", 403);
  return role;
}
