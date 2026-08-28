import { strict as assert } from "node:assert";
import { test } from "node:test";
import { assertTransition, canTransition } from "@/lib/job-state";

test("任务状态只允许沿生命周期前进或失败重试", () => {
  assert.equal(canTransition("pending", "running"), true);
  assert.equal(canTransition("running", "completed"), true);
  assert.equal(canTransition("failed", "pending"), true);
  assert.equal(canTransition("completed", "running"), false);
  assert.throws(() => assertTransition("completed", "pending"));
});
