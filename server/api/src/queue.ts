import { Queue } from "bullmq";
import { Redis } from "ioredis";

import type { JobConfig } from "./config.js";
import type { JobQueuePort } from "./job-service.js";

export function createQueue(config: JobConfig) {
  const connection = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  const queue = new Queue<{ jobId: string }>(config.queueName, {
    connection,
    defaultJobOptions: { removeOnComplete: 500, removeOnFail: 2_000 },
  });
  const port: JobQueuePort = {
    async add(jobId, maxAttempts) {
      await queue.add(
        "generation",
        { jobId },
        {
          jobId,
          attempts: maxAttempts,
          backoff: { type: "exponential", delay: 2_000 },
        },
      );
    },
    async remove(jobId) {
      const job = await queue.getJob(jobId);
      if (!job || (await job.isActive())) return false;
      await job.remove();
      return true;
    },
  };
  return {
    queue,
    connection,
    port,
    publish: (projectId: string) =>
      connection.publish(`job-events:${projectId}`, "changed"),
  };
}
