import IORedis from "ioredis";

const globalForRedis = globalThis as unknown as { redis?: IORedis };
export function getRedis() {
  const redis = globalForRedis.redis ?? new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
  redis.on("error", () => undefined);
  if (process.env.NODE_ENV !== "production") globalForRedis.redis = redis;
  return redis;
}

export function duplicateRedis() { const duplicate = getRedis().duplicate(); duplicate.on("error", () => undefined); return duplicate; }
