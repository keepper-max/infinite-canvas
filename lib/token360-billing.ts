import { eq } from "drizzle-orm";
import { generationJobs, projects } from "@/db/schema";
import { billedCredits, currentFxRate } from "@/lib/credit-pricing";
import { deductJobCredits } from "@/lib/credit-account";
import { db } from "@/lib/db";
import { getMockQueue } from "@/lib/queue";

const delays = [30000, 120000, 300000, 900000, 3600000];

export async function enqueueBilling(jobId: string, delay = 30000) {
  await getMockQueue().add("settle-usage", { jobId }, {
    jobId: `billing:${jobId}:${Date.now()}`,
    delay, removeOnComplete: 100, removeOnFail: 100,
  });
}

export async function settleToken360Bill(jobId: string) {
  const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1);
  if (!job || job.provider !== "token360" || job.billingStatus === "settled" || job.billingStatus === "failed") return;
  if (!job.billingTraceId) {
    await db.update(generationJobs).set({ billingStatus: "failed" }).where(eq(generationJobs.id, jobId));
    return;
  }
  const key = process.env.TOKEN360_API_KEY;
  if (!key) throw new Error("供应商账单密钥未配置");
  const base = (process.env.ASSISTANT_BASE_URL ?? "https://api.token360.ai/v1").replace(/\/+$/, "");
  const response = await fetch(`${base}/billing/requests/${encodeURIComponent(job.billingTraceId)}`, {
    headers: { Authorization: `Bearer ${key}` }, cache: "no-store",
  });
  const raw = await response.json().catch(() => null) as {
    data?: { billed?: boolean; amount_final?: string | number; total_amount?: string | number; currency?: string };
  } | null;
  const bill = raw?.data;
  if (response.status === 404 || (response.ok && !bill?.billed)) {
    const attempts = job.billingAttempts + 1;
    if (Date.now() - job.createdAt.getTime() >= 86400000) {
      await db.update(generationJobs).set({ billingStatus: "failed", billingAttempts: attempts }).where(eq(generationJobs.id, jobId));
    } else {
      await db.update(generationJobs).set({ billingStatus: "pending", billingAttempts: attempts }).where(eq(generationJobs.id, jobId));
      await enqueueBilling(jobId, delays[Math.min(attempts, delays.length - 1)]);
    }
    return;
  }
  if (!response.ok || !bill) throw new Error(`供应商账单查询失败（${response.status}）`);
  const amount = bill.amount_final ?? bill.total_amount;
  if (amount === undefined || !bill.currency) throw new Error("供应商账单缺少金额或币种");
  const { points, rate } = billedCredits(String(amount), bill.currency, currentFxRate());
  const [project] = await db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, job.projectId)).limit(1);
  if (!project) throw new Error("账单所属项目不存在");
  if (points > 0) await deductJobCredits(project.ownerId, job.id, points);
  await db.update(generationJobs).set({
    billingStatus: "settled", billedAmount: String(amount), billedCurrency: bill.currency.toUpperCase(),
    billedFxRate: rate, billedPoints: points, updatedAt: new Date(),
  }).where(eq(generationJobs.id, job.id));
}
