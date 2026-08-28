import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { projects } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProjectForUser } from "@/lib/project-access";

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser(); const { projectId } = await context.params;
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const project = await getProjectForUser(projectId, user.id);
  return project ? NextResponse.json({ project }) : NextResponse.json({ error: "项目不存在" }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser(); const { projectId } = await context.params;
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!await getProjectForUser(projectId, user.id)) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const body = await request.json().catch(() => null) as { name?: string; description?: string } | null;
  const [project] = await db.update(projects).set({ ...(body?.name ? { name: body.name.trim() } : {}), ...(body?.description !== undefined ? { description: body.description } : {}), updatedAt: new Date() }).where(eq(projects.id, projectId)).returning({ id: projects.id, title: projects.name, description: projects.description, updatedAt: projects.updatedAt });
  return NextResponse.json({ project });
}

export async function DELETE(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser(); const { projectId } = await context.params;
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const project = await getProjectForUser(projectId, user.id);
  if (!project || project.ownerId !== user.id) return NextResponse.json({ error: "项目不存在或无权删除" }, { status: 404 });
  await db.delete(projects).where(eq(projects.id, projectId));
  return NextResponse.json({ ok: true });
}
