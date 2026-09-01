import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { projectPlugins } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProjectForUser } from "@/lib/project-access";

const builtins = [
  {
    slug: "character-sheet",
    name: "角色三视图节点",
    config: { nodeType: "character" },
  },
  {
    slug: "seedance-shot",
    name: "Seedance 镜头节点",
    config: { nodeType: "video" },
  },
  {
    slug: "prompt-polish",
    name: "提示词优化节点",
    config: { nodeType: "style_polish" },
  },
];

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!(await getProjectForUser(projectId, user.id)))
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const rows = await db
    .select()
    .from(projectPlugins)
    .where(eq(projectPlugins.projectId, projectId))
    .orderBy(desc(projectPlugins.createdAt));
  return NextResponse.json({ builtins, plugins: rows });
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
      { error: "只有项目所有者可以安装插件" },
      { status: 403 },
    );
  const body = (await request.json().catch(() => ({}))) as {
    slug?: string;
    name?: string;
    config?: unknown;
  };
  if (!body.slug || !body.name)
    return NextResponse.json({ error: "缺少插件标识或名称" }, { status: 400 });
  const [plugin] = await db
    .insert(projectPlugins)
    .values({
      projectId,
      slug: body.slug.slice(0, 80),
      name: body.name.slice(0, 120),
      config: body.config && typeof body.config === "object" ? body.config : {},
    })
    .onConflictDoUpdate({
      target: [projectPlugins.projectId, projectPlugins.slug],
      set: {
        name: body.name.slice(0, 120),
        config:
          body.config && typeof body.config === "object" ? body.config : {},
      },
    })
    .returning();
  return NextResponse.json({ plugin }, { status: 201 });
}

export async function PATCH(
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
      { error: "只有项目所有者可以修改插件" },
      { status: 403 },
    );
  const body = (await request.json().catch(() => ({}))) as {
    pluginId?: string;
    enabled?: boolean;
  };
  if (!body.pluginId)
    return NextResponse.json({ error: "pluginId 缺失" }, { status: 400 });
  const [plugin] = await db
    .update(projectPlugins)
    .set({ enabled: body.enabled === false ? 0 : 1 })
    .where(eq(projectPlugins.id, body.pluginId))
    .returning();
  if (!plugin)
    return NextResponse.json({ error: "插件不存在" }, { status: 404 });
  return NextResponse.json({ plugin });
}
