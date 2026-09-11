import assert from "node:assert/strict";
import test from "node:test";

import { automaticAttemptsForCapability } from "../src/job-service.js";

test("synchronous text generation does not retry automatically", () => {
  assert.equal(automaticAttemptsForCapability("text", 3), 1);
  assert.equal(automaticAttemptsForCapability("image", 3), 3);
  assert.equal(automaticAttemptsForCapability("video", 3), 3);
  assert.equal(automaticAttemptsForCapability("audio", 3), 3);
});
