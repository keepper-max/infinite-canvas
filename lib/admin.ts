import { getCurrentUser } from "@/lib/auth";

function adminIds() {
  return new Set(`${process.env.ADMIN_USER_IDS ?? ""},${process.env.ACTIVATION_ADMIN_USER_IDS ?? ""}`
    .split(",").map((value) => value.trim()).filter(Boolean));
}
export function isAdminUserId(userId: string) {
  return adminIds().has(userId);
}

export async function requireAdmin() {
  const user = await getCurrentUser();
  return user && isAdminUserId(user.id) ? user : null;
}
