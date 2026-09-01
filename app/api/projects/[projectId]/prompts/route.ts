import { desc, eq, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { promptTemplates } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProjectForUser } from "@/lib/project-access";

const builtin = [
  {
    id: "builtin-character",
    title: "角色身份锁定",
    category: "角色",
    content: "保持角色脸部、发型、服装与体态一致，禁止改变身份特征。",
  },
  {
    id: "builtin-scene",
    title: "场景空间连续",
    category: "场景",
    content: "明确环境结构、光线方向、材质和可供镜头移动的空间。",
  },
  {
    id: "builtin-video",
    title: "Seedance 镜头动作",
    category: "视频",
    content: "写清主体动作、镜头景别、运镜路径、时长和声音节奏。",
  },
];

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!(await getProjectForUser(projectId, user.id)))
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const query = new URL(request.url).searchParams;
  const category = query.get("category");
  const search = query.get("q")?.toLowerCase();
  const rows = await db
    .select()
    .from(promptTemplates)
    .where(
      or(
        eq(promptTemplates.projectId, projectId),
        isNull(promptTemplates.projectId),
      ),
    )
    .orderBy(desc(promptTemplates.createdAt));
  const all = [...builtin, ...rows].filter(
    (item) =>
      (!category || item.category === category) &&
      (!search ||
        `${item.title} ${item.content}`.toLowerCase().includes(search)),
  );
  return NextResponse.json({
    prompts: all,
    categories: [
      ...new Set([...builtin, ...rows].map((item) => item.category)),
    ],
  });
}
export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!(await getProjectForUser(projectId, user.id)))
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    category?: string;
    content?: string;
  };
  if (!body.title?.trim() || !body.content?.trim())
    return NextResponse.json(
      { error: "标题和提示词不能为空" },
      { status: 400 },
    );
  const [prompt] = await db
    .insert(promptTemplates)
    .values({
      projectId,
      title: body.title.trim().slice(0, 160),
      category: body.category?.trim().slice(0, 40) || "通用",
      content: body.content.trim().slice(0, 20000),
    })
    .returning();
  return NextResponse.json({ prompt }, { status: 201 });
}
export async function DELETE(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!(await getProjectForUser(projectId, user.id)))
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id)
    return NextResponse.json({ error: "缺少提示词 ID" }, { status: 400 });
  await db.delete(promptTemplates).where(eq(promptTemplates.id, id));
  return NextResponse.json({ ok: true });
}
