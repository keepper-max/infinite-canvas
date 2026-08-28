import { Queue } from "bullmq";
import { getRedis } from "@/lib/redis";

const globalForQueue = globalThis as unknown as { mockQueue?: Queue };
export function getMockQueue() {
  const queue = globalForQueue.mockQueue ?? new Queue("mock-generation", { connection: getRedis() });
  if (process.env.NODE_ENV !== "production") globalForQueue.mockQueue = queue;
  return queue;
}
