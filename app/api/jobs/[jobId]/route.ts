import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { generationJobs } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProjectForUser } from "@/lib/project-access";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const user = await getCurrentUser(); const { jobId } = await context.params;
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1);
  if (!job || !await getProjectForUser(job.projectId, user.id)) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  return NextResponse.json({ job });
}
