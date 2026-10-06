import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { assets, canvasNodes, generationJobs } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getMockQueue } from "@/lib/queue";
import { getProjectForUser } from "@/lib/project-access";
import { recordJobEvent } from "@/lib/job-events";
import { Token360VideoProvider } from "@/lib/provider";
import { getAvailableCredits } from "@/lib/credit-account";
import { currentFxRate } from "@/lib/credit-pricing";
import { createProviderAssetUrl } from "@/lib/provider-asset-url";

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser(); const { projectId } = await context.params;
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!await getProjectForUser(projectId, user.id)) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const jobs = await db.select().from(generationJobs).where(eq(generationJobs.projectId, projectId)).orderBy(desc(generationJobs.createdAt));
  return NextResponse.json({ jobs });
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser(); const { projectId } = await context.params;
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const project = await getProjectForUser(projectId, user.id);
  if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  if (project.role === "viewer") return NextResponse.json({ error: "只读成员不能提交生成任务" }, { status: 403 });
  const body = await request.json().catch(() => null) as { nodeId?: string; mode?: string; prompt?: string; input?: unknown; parameters?: unknown } | null;
  if (!body?.nodeId) return NextResponse.json({ error: "缺少节点 ID" }, { status: 400 });
  const [node] = await db.select().from(canvasNodes).where(and(eq(canvasNodes.id, body.nodeId), eq(canvasNodes.projectId, projectId))).limit(1);
  if (!node) return NextResponse.json({ error: "节点不存在" }, { status: 404 });
  const active = await db.select().from(generationJobs).where(and(eq(generationJobs.projectId, projectId), eq(generationJobs.nodeId, body.nodeId), inArray(generationJobs.status, ["pending", "running"]))).orderBy(desc(generationJobs.createdAt)).limit(1);
  if (active[0]) return NextResponse.json({ job: active[0], duplicate: true });
  const isRealVideo = node.nodeType === "video" && Boolean(process.env.TOKEN360_API_KEY) && body.parameters && typeof body.parameters === "object" && (body.parameters as { real?: boolean }).real === true;
  if (isRealVideo) {
    if (!currentFxRate()) return NextResponse.json({ error: "真实供应商生成暂不可用：尚未配置美元结算汇率" }, { status: 503 });
    if (await getAvailableCredits(project.ownerId) <= 0) return NextResponse.json({ error: "项目所有者积分余额不足" }, { status: 402 });
  }
  const provider = isRealVideo ? "token360" : "mock";
  const modelId = isRealVideo ? String((body.parameters as { modelId?: string }).modelId ?? "seedance-2.5") : node.nodeType === "video" ? "mock-seedance-2.5" : "mock-image-pipeline";
  const [job] = await db.insert(generationJobs).values({ projectId, nodeId: body.nodeId, provider, modelId, mode: body.mode ?? "edit", prompt: body.prompt ?? String((node.data as { description?: string })?.description ?? ""), input: body.input ?? { node }, parameters: body.parameters ?? {}, billingStatus: isRealVideo ? "pending" : "not_applicable" }).returning();
  if (isRealVideo) {
    try {
      const rawRefs = Array.isArray((body.input as { references?: unknown })?.references) ? (body.input as { references: Array<{ assetId?: string; role?: string }> }).references : [];
      const refIds = rawRefs.map((ref) => ref.assetId).filter((id): id is string => Boolean(id));
      const refRows = refIds.length ? await db.select().from(assets).where(and(eq(assets.projectId, projectId), inArray(assets.id, refIds))) : [];
      const references = rawRefs.flatMap((ref) => { const asset = refRows.find((row) => row.id === ref.assetId); return asset ? [{ assetId: asset.id, role: ref.role ?? "reference", uri: createProviderAssetUrl(asset.id) }] : []; });
      const params = (body.parameters ?? {}) as { duration?: number; aspectRatio?: string; resolution?: string; generateAudio?: boolean };
      const handle = await new Token360VideoProvider().createJob({ requestId: job.id, projectId, nodeId: body.nodeId, mode: (body.mode ?? "T2V") as "T2V", prompt: job.prompt, references, modelId, duration: Number(params.duration ?? 5), aspectRatio: String(params.aspectRatio ?? "adaptive"), resolution: String(params.resolution ?? "720p"), generateAudio: params.generateAudio ?? false });
      await db.update(generationJobs).set({ parameters: { ...(job.parameters as object), remoteId: handle.remoteId }, billingTraceId: handle.traceId, updatedAt: new Date() }).where(eq(generationJobs.id, job.id));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "供应商任务创建失败";
      await db.update(generationJobs).set({ status: "failed", billingStatus: "failed", errorReason: reason, updatedAt: new Date() }).where(eq(generationJobs.id, job.id));
      return NextResponse.json({ error: reason }, { status: 502 });
    }
  }
  await recordJobEvent({ jobId: job.id, projectId, status: "pending", progress: 0, message: "任务已排队" });
  await getMockQueue().add("mock-generation", { jobId: job.id, projectId, nodeId: body.nodeId }, { jobId: job.id, removeOnComplete: 100, removeOnFail: 100 });
  return NextResponse.json({ job }, { status: 201 });
}
