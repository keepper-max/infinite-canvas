import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { projectMembers, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProjectForUser } from "@/lib/project-access";

async function access(projectId: string) {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  const project = await getProjectForUser(projectId, user.id);
  if (!project) return { response: NextResponse.json({ error: "项目不存在" }, { status: 404 }) };
  return { user, project };
}

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params; const checked = await access(projectId); if (checked.response) return checked.response;
  const members = await db.select({ userId: users.id, email: users.email, role: projectMembers.role }).from(projectMembers).innerJoin(users, eq(users.id, projectMembers.userId)).where(eq(projectMembers.projectId, projectId)).orderBy(asc(users.email));
  return NextResponse.json({ members });
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params; const checked = await access(projectId); if (checked.response) return checked.response;
  if (checked.project.ownerId !== checked.user.id) return NextResponse.json({ error: "只有项目所有者可以添加成员" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { email?: string; role?: string };
  const email = body.email?.trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "请输入有效邮箱" }, { status: 400 });
  const [member] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, email)).limit(1);
  if (!member) return NextResponse.json({ error: "该用户尚未注册" }, { status: 404 });
  await db.insert(projectMembers).values({ projectId, userId: member.id, role: body.role === "viewer" ? "viewer" : "editor" }).onConflictDoNothing();
  return NextResponse.json({ member: { userId: member.id, email: member.email, role: body.role === "viewer" ? "viewer" : "editor" } }, { status: 201 });
}
