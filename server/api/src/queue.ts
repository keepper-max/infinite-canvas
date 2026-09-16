import { Queue } from "bullmq";
import { Redis } from "ioredis";

import type { JobConfig } from "./config.js";
import type { JobQueuePort } from "./job-service.js";
import type { CompositionQueuePort } from "./composition-service.js";

export function createQueue(config: JobConfig) {
  const connection = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  const queue = new Queue<{ jobId: string }>(config.queueName, {
    connection,
    defaultJobOptions: { removeOnComplete: 500, removeOnFail: 2_000 },
  });
  const transferQueue = new Queue<{ jobId: string }>(config.transferQueueName, {
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
      const transferJob = await transferQueue.getJob(jobId);
      let removed = false;
      if (job && !(await job.isActive())) {
        await job.remove();
        removed = true;
      }
      if (transferJob && !(await transferJob.isActive())) {
        await transferJob.remove();
        removed = true;
      }
      return removed;
    },
  };
  const transferPort = {
    async add(jobId: string) {
      await transferQueue.add(
        "transfer",
        { jobId },
        {
          jobId,
          attempts: 5,
          backoff: { type: "exponential" as const, delay: 2_000 },
        },
      );
    },
  };
  return {
    queue,
    transferQueue,
    connection,
    port,
    transferPort,
    publish: (projectId: string) =>
      connection.publish(`job-events:${projectId}`, "changed"),
  };
}

export function createCompositionQueue(config: JobConfig) {
  const connection = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  const queue = new Queue<{ jobId: string }>(config.compositionQueueName, {
    connection,
    defaultJobOptions: { removeOnComplete: 200, removeOnFail: 1_000 },
  });
  const port: CompositionQueuePort = {
    async add(jobId, attempts) {
      await queue.add(
        "composition",
        { jobId },
        { jobId, attempts, backoff: { type: "exponential", delay: 2_000 } },
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
      connection.publish(`composition-events:${projectId}`, "changed"),
  };
}
