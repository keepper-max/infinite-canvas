import assert from "node:assert/strict";
import test from "node:test";
import { readConfig } from "../src/config.js";

const env = {
  DATABASE_URL: "postgres://test.invalid/test",
  OBJECT_STORAGE_ENDPOINT: "http://storage.invalid",
  OBJECT_STORAGE_BUCKET: "test",
  OBJECT_STORAGE_ACCESS_KEY_ID: "test-only",
  OBJECT_STORAGE_SECRET_ACCESS_KEY: "test-only",
};

test("generation defaults to 50 without changing transfer or composition", () => {
  const config = readConfig(env);
  assert.equal(config.jobs.workerConcurrency, 50);
  assert.equal(config.jobs.transferWorkerConcurrency, 4);
  assert.equal(config.jobs.compositionWorkerConcurrency, 1);
});

test("generation concurrency accepts 1 through 50 and rejects invalid values", () => {
  for (const n of [1, 2, 32, 50]) assert.equal(readConfig({ ...env, WORKER_CONCURRENCY: String(n) }).jobs.workerConcurrency, n);
  for (const n of ["0", "51", "-1", "1.5", "NaN"]) assert.throws(() => readConfig({ ...env, WORKER_CONCURRENCY: n }), /WORKER_CONCURRENCY/);
});
