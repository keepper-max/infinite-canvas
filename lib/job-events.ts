import { jobEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { getRedis } from "@/lib/redis";

export async function recordJobEvent(input: { jobId: string; projectId: string; status: string; progress: number; message: string }) {
  const [event] = await db.insert(jobEvents).values(input).returning();
  await getRedis().publish(`jingjie:project:${input.projectId}`, JSON.stringify({ type: "job", event }));
  return event;
}
