import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";

import { DomainError } from "../src/domain.js";
import { ModelGateway } from "../src/model-gateway.js";

const definition = {
  id: "video.seedance-2-5",
  display_name: "Seedance 2.5",
  capability: "video",
  upstream_model: "seedance-2.5",
  provider_id: "token360",
  modes: ["t2v", "i2v", "flf2v", "multiref"],
  accepted_parameters: [
    "duration",
    "resolution",
    "aspectRatio",
    "firstFrame",
    "lastFrame",
    "references",
  ],
  required_parameters_by_mode: {
    i2v: ["firstFrame"],
    flf2v: ["firstFrame", "lastFrame"],
    multiref: ["references"],
  },
  limits: {
    maxPromptChars: 2_000,
    durations: [5, 10],
    resolutions: ["480p", "720p", "1080p"],
    aspectRatios: ["16:9"],
  },
  parameter_map: { aspectRatio: "ratio" },
};

function gateway(row = definition) {
  return new ModelGateway({
    query: async () => ({ rows: [row], rowCount: 1 }),
  } as unknown as Pool);
}

test("T2V strips reference-only fields and maps accepted parameters", async () => {
  const compiled = await gateway().compile({
    modelId: definition.id,
    capability: "video",
    mode: "t2v",
    prompt: "云层移动",
    parameters: {
      duration: 5,
      aspectRatio: "16:9",
      omni_reference_task_type: "reference",
      firstFrame: "unsafe",
    },
    references: [{ role: "first_frame", url: "https://example.com/frame.png" }],
  });
  assert.deepEqual(compiled.upstreamParameters, { duration: 5, ratio: "16:9" });
});

test("FLF2V binds first and last frame by role instead of upload order", async () => {
  const first = { role: "first_frame", url: "https://example.com/first.png" };
  const last = { role: "last_frame", url: "https://example.com/last.png" };
  const compiled = await gateway().compile({
    modelId: definition.id,
    capability: "video",
    mode: "flf2v",
    prompt: "人物转身",
    references: [last, first],
  });
  assert.equal(
    (compiled.upstreamParameters.firstFrame as typeof first).url,
    first.url,
  );
  assert.equal(
    (compiled.upstreamParameters.lastFrame as typeof last).url,
    last.url,
  );
  assert.equal(compiled.upstreamParameters.references, undefined);
});

test("mode requirements fail locally before provider submission", async () => {
  await assert.rejects(
    () =>
      gateway().compile({
        modelId: definition.id,
        capability: "video",
        mode: "flf2v",
        prompt: "人物转身",
        references: [],
      }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "INVALID_MODEL_PARAMETER",
  );
});

test("model parameter ranges fail locally before provider submission", async () => {
  await assert.rejects(
    () =>
      gateway().compile({
        modelId: definition.id,
        capability: "video",
        mode: "t2v",
        prompt: "人物转身",
        parameters: { duration: 7, resolution: "4k", aspectRatio: "2:1" },
      }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "INVALID_MODEL_PARAMETER",
  );
});
