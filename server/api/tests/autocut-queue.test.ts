import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { createAutoCutQueue } from "../src/autocut/queue.js";
test(
  "AutoCut real Redis: queued cancellation, global concurrency across workers and no automatic retry",
  { skip: !process.env.TEST_AUTOCUT_REDIS_URL, timeout: 20000 },
  async () => {
    const queueName = `autocut-test-${randomUUID()}`;
    const url = process.env.TEST_AUTOCUT_REDIS_URL!,
      q = createAutoCutQueue(url, queueName),
      connection = new Redis(url, { maxRetriesPerRequest: null });
    const cancelled = randomUUID(),
      fail = randomUUID(),
      first = randomUUID(),
      second = randomUUID();
    let active = 0,
      peak = 0,
      failures = 0,
      completed = 0;
    await q.queue.waitUntilReady();
    await q.queue.setGlobalConcurrency(1);
    await q.port.add(cancelled);
    assert.equal(await q.port.remove(cancelled), true);
    const execute = async (job: { data: { taskId: string } }) => {
      assert.notEqual(job.data.taskId, cancelled);
      active++;
      peak = Math.max(peak, active);
      try {
        await delay(150);
        if (job.data.taskId === fail) {
          failures++;
          throw new Error("expected isolated test failure");
        }
        completed++;
      } finally {
        active--;
      }
    };
    const a = new Worker(queueName, execute, {
      connection,
      concurrency: 1,
      maxStalledCount: 0,
    });
    const b = new Worker(queueName, execute, {
      connection,
      concurrency: 1,
      maxStalledCount: 0,
    });
    try {
      await Promise.all([a.waitUntilReady(), b.waitUntilReady()]);
      for (const id of [first, second, fail]) await q.port.add(id);
      for (let i = 0; i < 100 && completed + failures < 3; i++)
        await delay(100);
      assert.equal(completed, 2);
      assert.equal(failures, 1);
      assert.equal(peak, 1);
      await delay(300);
      assert.equal(failures, 1);
    } finally {
      await Promise.all([a.close(), b.close()]);
      await q.close();
      await connection.quit();
    }
  },
);
