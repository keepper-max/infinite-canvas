import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { AutoCutQueue } from "./service.js";
export const AUTOCUT_QUEUE = "autocut-jobs";
export function createAutoCutQueue(redisUrl: string, queueName = AUTOCUT_QUEUE) {
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  const queue = new Queue<{ taskId: string }>(queueName, { connection });
  const port: AutoCutQueue = {
    async add(taskId) {
      await queue.add(
        "autocut",
        { taskId },
        {
          jobId: taskId,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    },
    async remove(id) {
      const job = await queue.getJob(id);
      if (!job || (await job.isActive())) return false;
      await job.remove();
      return true;
    },
  };
  return {
    queue,
    connection,
    port,
    async close() {
      await queue.close();
      await connection.quit();
    },
  };
}
