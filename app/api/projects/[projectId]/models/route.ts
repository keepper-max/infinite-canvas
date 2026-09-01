import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { modelConfigs } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProjectForUser } from "@/lib/project-access";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!(await getProjectForUser(projectId, user.id)))
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const configs = await db
    .select()
    .from(modelConfigs)
    .where(eq(modelConfigs.projectId, projectId))
    .orderBy(desc(modelConfigs.updatedAt));
  return NextResponse.json({ configs });
}
export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const project = await getProjectForUser(projectId, user.id);
  if (!project)
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  if (project.ownerId !== user.id)
    return NextResponse.json(
      { error: "只有项目所有者可以配置模型" },
      { status: 403 },
    );
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    baseUrl?: string;
    model?: string;
    script?: string;
    apiKeyEnv?: string;
  };
  if (!body.name?.trim() || !body.baseUrl?.trim() || !body.model?.trim())
    return NextResponse.json(
      { error: "名称、Base URL 和模型不能为空" },
      { status: 400 },
    );
  const [config] = await db
    .insert(modelConfigs)
    .values({
      projectId,
      name: body.name.trim().slice(0, 100),
      baseUrl: body.baseUrl.trim().slice(0, 500),
      model: body.model.trim().slice(0, 160),
      script: body.script?.slice(0, 20000) ?? "",
      apiKeyEnv: body.apiKeyEnv?.trim().slice(0, 100) ?? "",
    })
    .returning();
  return NextResponse.json({ config }, { status: 201 });
}
