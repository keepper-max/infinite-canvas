import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { projectMembers } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProjectForUser } from "@/lib/project-access";

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string; userId: string }> }) {
  const { projectId, userId } = await context.params; const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const project = await getProjectForUser(projectId, user.id); if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  if (project.ownerId !== user.id) return NextResponse.json({ error: "只有项目所有者可以修改成员" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { role?: string };
  const role = body.role === "viewer" ? "viewer" : body.role === "editor" ? "editor" : null;
  if (!role) return NextResponse.json({ error: "角色只能是 editor 或 viewer" }, { status: 400 });
  const [member] = await db.update(projectMembers).set({ role }).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId))).returning();
  if (!member) return NextResponse.json({ error: "成员不存在" }, { status: 404 });
  return NextResponse.json({ member });
}

export async function DELETE(_request: Request, context: { params: Promise<{ projectId: string; userId: string }> }) {
  const { projectId, userId } = await context.params; const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const project = await getProjectForUser(projectId, user.id); if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  if (project.ownerId !== user.id) return NextResponse.json({ error: "只有项目所有者可以移除成员" }, { status: 403 });
  if (userId === user.id) return NextResponse.json({ error: "不能移除项目所有者" }, { status: 400 });
  await db.delete(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
  return NextResponse.json({ ok: true });
}
