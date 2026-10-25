import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { AGENT_LIMITS } from "./limits.js";
import type { NativeAgentService } from "./service.js";
export const NATIVE_AGENT_QUEUE = "native-agent-v1";
export function createNativeAgentQueue(redisUrl: string) {
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  const queue = new Queue(NATIVE_AGENT_QUEUE, { connection });
  return {
    queue,
    connection,
    enqueue: async (runId: string) =>
      queue.add(
        "run",
        { runId },
        {
          jobId: runId,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        },
      ),
    close: async () => {
      await queue.close();
      await connection.quit();
    },
  };
}
export async function startNativeAgentWorker(
  service: NativeAgentService,
  redisUrl: string,
) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(NATIVE_AGENT_QUEUE, { connection });
  let concurrency =
    (await service.policy?.get())?.limits.concurrency ??
    AGENT_LIMITS.concurrency;
  await queue.setGlobalConcurrency(concurrency);
  const worker = new Worker(
    NATIVE_AGENT_QUEUE,
    async (job) => service.drive(job.data.runId),
    { connection, concurrency: AGENT_LIMITS.concurrency },
  );
  await worker.waitUntilReady();
  worker.on("error", () =>
    console.warn(
      "[native-agent] worker connection unavailable; no automatic model retry",
    ),
  );
  const recovery = setInterval(
    () =>
      void (async () => {
        const configured =
          (await service.policy?.get())?.limits.concurrency ??
          AGENT_LIMITS.concurrency;
        if (configured !== concurrency) {
          await queue.setGlobalConcurrency(configured);
          concurrency = configured;
        }
        await service.recoverPending();
      })().catch(() =>
        console.warn("[native-agent] pending queue recovery deferred"),
      ),
    1000,
  );
  await service.recoverPending();
  return {
    worker,
    close: async () => {
      clearInterval(recovery);
      await worker.close();
      await queue.close();
      await connection.quit();
    },
  };
}
