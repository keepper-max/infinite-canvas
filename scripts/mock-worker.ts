import { Worker, type Job } from "bullmq";
import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray } from "drizzle-orm";
import { assets, canvasNodes, generationJobs, jobArtifacts } from "@/db/schema";
import { db } from "@/lib/db";
import { recordJobEvent } from "@/lib/job-events";
import { getRedis } from "@/lib/redis";
import { Token360VideoProvider } from "@/lib/provider";
import { storeProviderResult } from "@/lib/provider-result";
import { enqueueBilling, settleToken360Bill } from "@/lib/token360-billing";

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
  if (!existing || existing.status === "failed" || existing.status === "completed") return;
  if (existing.provider === "token360") {
    const remoteId = (existing.parameters as { remoteId?: string })?.remoteId;
    if (!remoteId) throw new Error("供应商任务缺少远程 ID");
    const provider = new Token360VideoProvider();
    await update(jobId, projectId, "running", 10, "供应商视频任务已提交");
    for (let attempt = 0; attempt < 120; attempt++) {
      await wait(5000);
      const current = await db.select({ status: generationJobs.status }).from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1);
      if (!current[0] || current[0].status === "failed") return;
      const remote = await provider.getJob({ provider: "token360", remoteId });
      if (remote.status === "failed") throw new Error(remote.error ?? "供应商视频生成失败");
      if (remote.status === "completed") {
        if (!remote.outputUrl) throw new Error("供应商未返回视频下载地址");
        const assetId = randomUUID();
        const stored = await storeProviderResult({ url: remote.outputUrl, projectId, assetId, mimeType: "video/mp4", name: `${existing.modelId}.mp4` });
        const objectUri = `/api/assets/${assetId}/content`;
        await db.insert(assets).values({ id: assetId, projectId, kind: "video", name: `${existing.modelId}-${jobId}.mp4`, objectKey: stored.objectKey, uri: objectUri, mimeType: stored.mimeType, size: stored.size, version: 1, metadata: { source: "provider", provider: existing.provider, remoteId, sha256: stored.sha256, model: existing.modelId } });
        await db.insert(jobArtifacts).values({ jobId, uri: objectUri, mimeType: stored.mimeType, metadata: { assetId, objectKey: stored.objectKey, provider: existing.provider, remoteId, model: existing.modelId, size: stored.size, sha256: stored.sha256 } });
        await db.update(canvasNodes).set({ status: "completed", data: { output: objectUri, assetId, provider: existing.provider, model: existing.modelId }, updatedAt: new Date() }).where(and(eq(canvasNodes.id, nodeId), eq(canvasNodes.projectId, projectId)));
        await update(jobId, projectId, "completed", 100, "供应商视频已转存到资产库");
        await enqueueBilling(jobId);
        return;
      }
      await update(jobId, projectId, "running", Math.min(95, 10 + Math.floor(attempt * 85 / 120)), "供应商视频生成中");
    }
    throw new Error("供应商视频任务轮询超时");
  }
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
const worker = new Worker<MockPayload>("mock-generation", async (job) => {
  if (job.name === "settle-usage") return settleToken360Bill(job.data.jobId);
  return processJob(job);
}, { connection: redis, concurrency: 2 });
worker.on("completed", (job) => console.log(`[jingjie-worker] completed ${job.id}`));
worker.on("failed", async (job, error) => {
  if (!job) return;
  console.error(`[jingjie-worker] failed ${job.id}`, error);
  if (job.name === "settle-usage") {
    const [record] = await db.select().from(generationJobs).where(eq(generationJobs.id, job.data.jobId)).limit(1);
    if (!record || record.billingStatus === "settled") return;
    const attempts = record.billingAttempts + 1;
    await db.update(generationJobs).set({ billingStatus: Date.now() - record.createdAt.getTime() >= 86400000 ? "failed" : "pending", billingAttempts: attempts }).where(eq(generationJobs.id, record.id));
    if (Date.now() - record.createdAt.getTime() < 86400000) await enqueueBilling(record.id, Math.min(3600000, 30000 * 2 ** Math.min(attempts, 7)));
    return;
  }
  await db.update(generationJobs).set({ status: "failed", errorReason: error.message, updatedAt: new Date() }).where(eq(generationJobs.id, job.data.jobId));
  await recordJobEvent({ jobId: job.data.jobId, projectId: job.data.projectId, status: "failed", progress: 0, message: error.message });
  const [record] = await db.select({ provider: generationJobs.provider, billingTraceId: generationJobs.billingTraceId }).from(generationJobs).where(eq(generationJobs.id, job.data.jobId)).limit(1);
  if (record?.provider === "token360" && record.billingTraceId) await enqueueBilling(job.data.jobId);
});
console.log("[jingjie-worker] BullMQ Mock Worker ready");

// 恢复进程重启前已经进入终态、但尚未同步到账单的任务。
void db.select({ id: generationJobs.id }).from(generationJobs).where(and(
  eq(generationJobs.provider, "token360"), eq(generationJobs.billingStatus, "pending"),
  inArray(generationJobs.status, ["completed", "failed"]),
  gte(generationJobs.createdAt, new Date(Date.now() - 86400000)),
)).then(async (rows) => {
  for (const row of rows) await enqueueBilling(row.id);
}).catch((error) => console.error("[jingjie-worker] billing recovery failed", error));

const shutdown = async () => { await worker.close(); await redis.quit(); process.exit(0); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
