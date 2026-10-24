import { Queue } from "bullmq";
import { DomainError } from "./domain.js";
export function importConnection(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: Number(u.pathname.slice(1) || 0),
    maxRetriesPerRequest: null,
    ...(u.protocol === "rediss:" ? { tls: {} } : {}),
  };
}
export function createImportQueue(url: string) {
  const queue = new Queue("knowledge-imports", {
    connection: importConnection(url),
  });
  return {
    queue,
    assertReady: async () => {
      if (
        !(await (
          await queue.backend.client
        ).get("knowledge-imports:runner-ready"))
      )
        throw new DomainError(
          "KNOWLEDGE_IMPORT_UNAVAILABLE",
          "隔离转换器当前不可用，请稍后重试；现有文档和原件仍可读取",
          503,
        );
    },
    enqueue: async (id: string) =>
      queue.add(
        "convert",
        { id },
        { jobId: id, removeOnComplete: true, removeOnFail: true },
      ),
  };
}
