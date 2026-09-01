import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { modelConfigs } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProjectForUser } from "@/lib/project-access";
import { runChatModel } from "@/lib/model-runner";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; modelId: string }> },
) {
  const { projectId, modelId } = await context.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!(await getProjectForUser(projectId, user.id)))
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const [config] = await db
    .select()
    .from(modelConfigs)
    .where(eq(modelConfigs.id, modelId))
    .limit(1);
  if (!config || config.projectId !== projectId)
    return NextResponse.json({ error: "模型配置不存在" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { prompt?: string };
  if (!body.prompt?.trim())
    return NextResponse.json({ error: "测试提示词不能为空" }, { status: 400 });
  try {
    return NextResponse.json({
      result: await runChatModel(config, body.prompt.slice(0, 10000)),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "模型请求失败" },
      { status: 502 },
    );
  }
}
