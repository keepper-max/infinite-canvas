import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { projectMembers, projects } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const rows = await db.select({ id: projects.id, title: projects.name, description: projects.description, updatedAt: projects.updatedAt }).from(projects).innerJoin(projectMembers, eq(projectMembers.projectId, projects.id)).where(eq(projectMembers.userId, user.id)).orderBy(desc(projects.updatedAt));
  return NextResponse.json({ projects: rows });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = await request.json().catch(() => null) as { name?: string; description?: string } | null;
  const name = body?.name?.trim();
  if (!name) return NextResponse.json({ error: "项目名称不能为空" }, { status: 400 });
  const project = await db.transaction(async (tx) => {
    const [created] = await tx.insert(projects).values({ ownerId: user.id, name, description: body?.description ?? "" }).returning({ id: projects.id, title: projects.name, description: projects.description, updatedAt: projects.updatedAt });
    await tx.insert(projectMembers).values({ projectId: created.id, userId: user.id, role: "owner" });
    return created;
  });
  return NextResponse.json({ project }, { status: 201 });
}
