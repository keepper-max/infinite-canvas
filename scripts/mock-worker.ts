import { Worker, type Job } from "bullmq";
import { and, eq } from "drizzle-orm";
import { canvasNodes, generationJobs, jobArtifacts } from "@/db/schema";
import { db } from "@/lib/db";
import { recordJobEvent } from "@/lib/job-events";
import { getRedis } from "@/lib/redis";

type MockPayload = { jobId: string; projectId: string; nodeId: string };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function update(jobId: string, projectId: string, status: string, progress: number, message: string) {
  const [updated] = await db.update(generationJobs).set({ status, progress, updatedAt: new Date() }).where(eq(generationJobs.id, jobId)).returning();
  if (updated) await recordJobEvent({ jobId, projectId, status, progress, message });
  return updated;
}

async function processJob(job: Job<MockPayload>) {
  const { jobId, projectId, nodeId } = job.data;
  const [existing] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1);
  if (!existing || existing.status === "failed") return;
  await update(jobId, projectId, "running", 5, "Mock Worker 已开始执行");
  for (const progress of [25, 50, 75]) {
    await wait(450);
    const [current] = await db.select({ status: generationJobs.status }).from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1);
    if (!current || current.status === "failed") return;
    await job.updateProgress(progress);
    await update(jobId, projectId, "running", progress, `Mock 阶段 ${progress}%`);
  }
  await wait(450);
  const [current] = await db.select({ status: generationJobs.status }).from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1);
  if (!current || current.status === "failed") return;
  await db.insert(jobArtifacts).values({ jobId, uri: "/demo/mock-video.svg", mimeType: "image/svg+xml", metadata: { nodeId, mock: true } });
  await db.update(canvasNodes).set({ status: "completed", data: { output: "mock-video.svg · 可预览" }, updatedAt: new Date() }).where(and(eq(canvasNodes.id, nodeId), eq(canvasNodes.projectId, projectId)));
  await update(jobId, projectId, "completed", 100, "Mock 任务已完成");
}

const redis = getRedis();
const worker = new Worker<MockPayload>("mock-generation", processJob, { connection: redis, concurrency: 2 });
worker.on("completed", (job) => console.log(`[jingjie-worker] completed ${job.id}`));
worker.on("failed", async (job, error) => { if (job) { console.error(`[jingjie-worker] failed ${job.id}`, error); await db.update(generationJobs).set({ status: "failed", errorReason: error.message, updatedAt: new Date() }).where(eq(generationJobs.id, job.data.jobId)); await recordJobEvent({ jobId: job.data.jobId, projectId: job.data.projectId, status: "failed", progress: 0, message: error.message }); } });
console.log("[jingjie-worker] BullMQ Mock Worker ready");

const shutdown = async () => { await worker.close(); await redis.quit(); process.exit(0); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
