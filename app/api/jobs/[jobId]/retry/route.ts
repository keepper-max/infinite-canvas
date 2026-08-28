import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { generationJobs } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getMockQueue } from "@/lib/queue";
import { getProjectForUser } from "@/lib/project-access";

export async function POST(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const user = await getCurrentUser(); const { jobId } = await context.params;
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1);
  if (!job || !await getProjectForUser(job.projectId, user.id)) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  if (job.status !== "failed") return NextResponse.json({ error: "只有失败任务可重试" }, { status: 409 });
  const [updated] = await db.update(generationJobs).set({ status: "pending", progress: 0, errorReason: null, updatedAt: new Date() }).where(eq(generationJobs.id, jobId)).returning();
  await getMockQueue().add("mock-generation", { jobId, projectId: job.projectId, nodeId: job.nodeId }, { jobId: `${jobId}:retry:${Date.now()}`, removeOnComplete: 100, removeOnFail: 100 });
  return NextResponse.json({ job: updated });
}
