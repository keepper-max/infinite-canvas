import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { generationJobs } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getMockQueue } from "@/lib/queue";
import { getProjectForUser } from "@/lib/project-access";
import { recordJobEvent } from "@/lib/job-events";
import { Token360VideoProvider } from "@/lib/provider";

export async function POST(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const user = await getCurrentUser(); const { jobId } = await context.params;
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1);
  if (!job || !await getProjectForUser(job.projectId, user.id)) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  if (!["pending", "running"].includes(job.status)) return NextResponse.json({ job });
  if (job.provider === "token360") {
    const remoteId = (job.parameters as { remoteId?: string })?.remoteId;
    if (remoteId && process.env.TOKEN360_API_KEY)
      await new Token360VideoProvider().cancelJob({ provider: "token360", remoteId }).catch(() => undefined);
  }
  await getMockQueue().remove(jobId);
  const [updated] = await db.update(generationJobs).set({ status: "failed", errorReason: "用户取消", updatedAt: new Date() }).where(eq(generationJobs.id, jobId)).returning();
  await recordJobEvent({ jobId, projectId: job.projectId, status: "failed", progress: job.progress, message: "任务已取消" });
  return NextResponse.json({ job: updated });
}
