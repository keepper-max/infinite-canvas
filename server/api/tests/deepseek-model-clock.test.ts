import test from "node:test";
import assert from "node:assert/strict";
import {
  modelClock,
  modelTiming,
  DEEPSEEK_AGENT_MODEL,
} from "../src/native-agent/model-clock.js";
test("DeepSeek approved budget is 60s preflight + 60s inference; other routes unchanged", () => {
  assert.deepEqual(modelTiming(DEEPSEEK_AGENT_MODEL, 60000), {
    version: 1,
    preflightMs: 60000,
    inferenceMs: 60000,
    maxRoundMs: 120000,
  });
  assert.deepEqual(modelTiming("another-model", 60000), {
    version: 1,
    preflightMs: 0,
    inferenceMs: 60000,
    maxRoundMs: 60000,
  });
  assert.equal(
    modelTiming(DEEPSEEK_AGENT_MODEL, 30000).maxRoundMs,
    60000,
    "admin tightening is respected",
  );
  assert.equal(
    modelTiming(DEEPSEEK_AGENT_MODEL, 120000).maxRoundMs,
    120000,
    "DS approval cannot be expanded by unrelated model settings",
  );
});
test("slow preflight does not consume inference budget, and duplicate callbacks cannot extend it", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const c = new AbortController(),
    clock = modelClock(c, modelTiming(DEEPSEEK_AGENT_MODEL, 60000), 901000);
  t.mock.timers.tick(44000);
  clock.beginInference();
  t.mock.timers.tick(16000);
  assert.equal(c.signal.aborted, false, "old overall 60s would abort here");
  clock.beginInference();
  t.mock.timers.tick(43999);
  assert.equal(c.signal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(c.signal.aborted, true);
  clock.stop();
});
test("preflight never gets more than 60s or submits after timeout", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const c = new AbortController(),
    clock = modelClock(c, modelTiming(DEEPSEEK_AGENT_MODEL, 60000), 901000);
  t.mock.timers.tick(60000);
  assert.equal(c.signal.aborted, true);
  assert.throws(() => clock.beginInference());
  clock.stop();
});
test("Run deadline still wins after stage transition; cancellation cannot be revived", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const c = new AbortController(),
    clock = modelClock(c, modelTiming(DEEPSEEK_AGENT_MODEL, 60000), 71000);
  t.mock.timers.tick(44000);
  clock.beginInference();
  t.mock.timers.tick(26000);
  assert.equal(c.signal.aborted, true);
  assert.throws(() => clock.beginInference());
  clock.stop();
  const cancelled = new AbortController(),
    other = modelClock(
      cancelled,
      modelTiming(DEEPSEEK_AGENT_MODEL, 60000),
      901000,
    );
  cancelled.abort();
  assert.throws(() => other.beginInference());
  other.stop();
});
test("non-DeepSeek clock and expired Run keep original fail-stop behavior", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const c = new AbortController(),
    clock = modelClock(c, modelTiming("another-model", 60000), 901000);
  t.mock.timers.tick(44000);
  clock.beginInference();
  t.mock.timers.tick(16000);
  assert.equal(c.signal.aborted, true);
  clock.stop();
  const expired = new AbortController(),
    old = modelClock(expired, modelTiming(DEEPSEEK_AGENT_MODEL, 60000), 999);
  assert.equal(expired.signal.aborted, true);
  old.stop();
});

test("a delayed event loop cannot revive an expired preflight timer", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const c = new AbortController(),
    clock = modelClock(c, modelTiming(DEEPSEEK_AGENT_MODEL, 60000), 901000);
  t.mock.timers.setTime(61001);
  assert.throws(() => clock.beginInference());
  assert.equal(c.signal.aborted, true);
  clock.stop();
});

test("preflight warning does not imply earlier successful model rounds were free",async()=>{const {safeTaskError}=await import("../src/native-agent/presentation.js");const text=safeTaskError("AGENT_PREFLIGHT_FAILED");assert.ok(text.includes("这轮未提交"));assert.ok(text.includes("此前已完成的模型调用仍按实际用量计积分"));assert.ok(!text.includes("选择其他可用模型"));});
