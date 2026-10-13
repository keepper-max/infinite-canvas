import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Redis from "ioredis";
import { AuthRateLimiter } from "../src/auth-rate-limit.js";

const redisUrl = process.env.TEST_AUTH_REDIS_URL;
test("real Redis enforces auth account windows, concurrency reservations and three-hour IP cooldown", { skip: !redisUrl }, async () => {
  assert(["127.0.0.1", "localhost", "[::1]"].includes(new URL(redisUrl!).hostname), "Use an isolated local test Redis, never production");
  const redis = new Redis(redisUrl!, { maxRetriesPerRequest: 1 });
  const limiter = new AuthRateLimiter(redis);
  const ownedKeys = new Set<string>();
  const prefix = `test-${randomUUID()}`;
  const reserve = async (kind: "password" | "code" | "send", account: string, ip: string) => {
    const attempt = await limiter.reserve(kind, `${prefix}:${account}`, `${prefix}:${ip}`);
    attempt.keys.forEach((key) => ownedKeys.add(key));
    return attempt;
  };
  try {
    const first = await reserve("password", "a", "a");
    await limiter.finish(first, false);
    assert.equal(await redis.zcard(first.keys[0]), 0);
    for (let i = 0; i < 5; i++) await limiter.finish(await reserve("password", "a", "a"), true);
    await assert.rejects(reserve("password", "a", "a"), { code: "AUTH_RATE_LIMITED" });
    // Moving scores out of the rolling window must make the account usable again.
    for (const member of await redis.zrange(first.keys[0], 0, -1)) await redis.zadd(first.keys[0], Date.now() - 300001, member);
    await limiter.finish(await reserve("password", "a", "a"), false);
    const pending = await Promise.all(Array.from({ length: 10 }, (_, i) => reserve("password", `parallel-${i}`, "parallel")));
    await limiter.finish(pending[0], true);
    assert.equal(await redis.exists(pending[0].keys[2]), 0, "pending successful requests are not ten real failures");
    await Promise.all(pending.slice(1).map((attempt) => limiter.finish(attempt, false)));
    let blockedKey = "";
    for (let i = 0; i < 10; i++) {
      const attempt = await reserve(i % 2 ? "password" : "code", `failure-${i}`, "shared");
      await limiter.finish(attempt, true);
      blockedKey = attempt.keys[2];
    }
    assert((await redis.ttl(blockedKey)) > 10790);
    await assert.rejects(reserve("send", "fresh", "shared"), (error: any) => error.code === "AUTH_RATE_LIMITED" && error.details.retryAfterSeconds > 10790);
    for (let i = 0; i < 5; i++) await limiter.finish(await reserve("send", "sending", "other"), true);
    await assert.rejects(reserve("send", "sending", "other"), { code: "AUTH_RATE_LIMITED" });
  } finally {
    if (ownedKeys.size) await redis.del(...ownedKeys);
    await redis.quit();
  }
});
