import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdminUserId } from "@/lib/admin";

export async function GET() {
  const user = await getCurrentUser();
  return user ? NextResponse.json({ user: { ...user, isAdmin: isAdminUserId(user.id) } }) : NextResponse.json({ error: "未登录" }, { status: 401 });
}
