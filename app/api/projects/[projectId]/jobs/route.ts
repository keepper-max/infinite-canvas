import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { canvasNodes, generationJobs } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getMockQueue } from "@/lib/queue";
import { getProjectForUser } from "@/lib/project-access";
import { recordJobEvent } from "@/lib/job-events";

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
  if (!await getProjectForUser(projectId, user.id)) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const body = await request.json().catch(() => null) as { nodeId?: string; mode?: string; prompt?: string; input?: unknown; parameters?: unknown } | null;
  if (!body?.nodeId) return NextResponse.json({ error: "缺少节点 ID" }, { status: 400 });
  const [node] = await db.select().from(canvasNodes).where(and(eq(canvasNodes.id, body.nodeId), eq(canvasNodes.projectId, projectId))).limit(1);
  if (!node) return NextResponse.json({ error: "节点不存在" }, { status: 404 });
  const active = await db.select().from(generationJobs).where(and(eq(generationJobs.projectId, projectId), eq(generationJobs.nodeId, body.nodeId), inArray(generationJobs.status, ["pending", "running"]))).orderBy(desc(generationJobs.createdAt)).limit(1);
  if (active[0]) return NextResponse.json({ job: active[0], duplicate: true });
  const [job] = await db.insert(generationJobs).values({ projectId, nodeId: body.nodeId, provider: "mock", modelId: node.nodeType === "video" ? "mock-seedance-2.5" : "mock-image-pipeline", mode: body.mode ?? "edit", prompt: body.prompt ?? String((node.data as { description?: string })?.description ?? ""), input: body.input ?? { node }, parameters: body.parameters ?? {} }).returning();
  await recordJobEvent({ jobId: job.id, projectId, status: "pending", progress: 0, message: "任务已排队" });
  await getMockQueue().add("mock-generation", { jobId: job.id, projectId, nodeId: body.nodeId }, { jobId: job.id, removeOnComplete: 100, removeOnFail: 100 });
  return NextResponse.json({ job }, { status: 201 });
}
