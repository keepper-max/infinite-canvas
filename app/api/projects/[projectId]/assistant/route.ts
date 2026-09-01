import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project-access";
import { desc, eq } from "drizzle-orm";
import { modelConfigs } from "@/db/schema";
import { db } from "@/lib/db";
import { runChatModel } from "@/lib/model-runner";
import { buildSeedancePrompt } from "@/lib/seedance-skill";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const user = await getCurrentUser();
  const { projectId } = await context.params;
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!(await getProjectForUser(projectId, user.id)))
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as {
    prompt?: string;
    node?: { label?: string; description?: string };
    upstream?: string[];
  };
  const nodeLabel = body.node?.label ?? "当前节点";
  const prompt = body.prompt?.trim() || "请优化这个节点的生产提示词";
  const contextText = (body.upstream ?? []).slice(0, 6).join("；");
  const [config] = await db
    .select()
    .from(modelConfigs)
    .where(eq(modelConfigs.projectId, projectId))
    .orderBy(desc(modelConfigs.updatedAt))
    .limit(1);
  const fullPrompt = `你是 AI 漫剧导演助手。\n${buildSeedancePrompt({ nodeLabel, prompt, upstream: contextText ? [contextText] : [] })}`;
  if (config) {
    try {
      const result = await runChatModel(config, fullPrompt);
      if (result.configured)
        return NextResponse.json({
          provider: config.name,
          answer: result.text,
          suggestions: [],
          mode: "remote",
        });
    } catch {
      /* 外部模型失败时安全回退 Mock */
    }
  }
  return NextResponse.json({
    provider: process.env.ASSISTANT_PROVIDER ?? "mock",
    answer: `围绕「${nodeLabel}」：${prompt}。保持角色身份、场景空间和镜头连续性。${contextText ? `上游参考：${contextText}。` : ""}`,
    suggestions: [
      "补充主体动作与时长",
      "明确镜头运动和景别",
      "锁定角色服装与光线连续性",
    ],
    mode: "mock",
  });
}
