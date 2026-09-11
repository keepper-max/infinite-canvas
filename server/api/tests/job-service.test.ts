import assert from "node:assert/strict";
import test from "node:test";

import { generationJobAttempts } from "../src/job-service.js";

test("generation jobs do not retry automatically", () => {
  assert.equal(generationJobAttempts(), 1);
});
