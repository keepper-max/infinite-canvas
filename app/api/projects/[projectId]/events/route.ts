import { desc, eq } from "drizzle-orm";
import { jobEvents } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { duplicateRedis } from "@/lib/redis";
import { getProjectForUser } from "@/lib/project-access";

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser(); const { projectId } = await context.params;
  if (!user || !await getProjectForUser(projectId, user.id)) return new Response("未授权", { status: 401 });
  const subscriber = duplicateRedis();
  await subscriber.subscribe(`jingjie:project:${projectId}`);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const recent = await db.select().from(jobEvents).where(eq(jobEvents.projectId, projectId)).orderBy(desc(jobEvents.createdAt)).limit(20);
      controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(recent.reverse())}\n\n`));
      const onMessage = (_channel: string, message: string) => controller.enqueue(encoder.encode(`event: job\ndata: ${message}\n\n`));
      subscriber.on("message", onMessage);
      const heartbeat = setInterval(() => controller.enqueue(encoder.encode(": heartbeat\n\n")), 15000);
      _request.signal.addEventListener("abort", () => { clearInterval(heartbeat); subscriber.off("message", onMessage); subscriber.disconnect(); controller.close(); });
    },
    cancel() { subscriber.disconnect(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
