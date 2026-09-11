import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";

import { DomainError } from "../src/domain.js";
import { createJobSchema } from "../src/job-contract.js";
import { catalogModelProfile, ModelGateway } from "../src/model-gateway.js";

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

test("catalog profiles expose each supported generation family without mixing speech recognition into TTS", () => {
  assert.deepEqual(
    catalogModelProfile({ modelType: "LLM", supported_parameters: ["reasoning_effort"] })?.modes,
    ["chat"],
  );
  assert.deepEqual(
    catalogModelProfile({ modelType: "IMAGE_GENERATION", modelInputTypes: ["TEXT", "IMAGE"], supported_parameters: ["n", "size", "images"] })?.modes,
    ["t2i", "i2i"],
  );
  assert.deepEqual(
    catalogModelProfile({ modelType: "VIDEO_GENERATION", modelInputTypes: ["TEXT", "IMAGE"], supported_parameters: ["duration", "frame_images", "input_references"] })?.modes,
    ["t2v", "i2v", "flf2v", "multiref"],
  );
  assert.deepEqual(
    catalogModelProfile({ modelType: "AUDIO_TEXT_TO_SPEECH", supported_parameters: ["voice", "audio_format"] })?.modes,
    ["tts"],
  );
  assert.equal(catalogModelProfile({ modelType: "AUDIO_SPEECH_TO_TEXT" }), null);
});

test("drama jobs preserve a strict trace without forwarding it as a model parameter", () => {
  const input = createJobSchema.parse({
    nodeId: "drama:seedance-skill-1",
    modelId: "text.gpt-5-5",
    capability: "text",
    mode: "chat",
    prompt: "编译当前镜头",
    parameters: {},
    references: [],
    idempotencyKey: "skill-node:abcd1234",
    trace: {
      workflowKind: "skill.seedance",
      skillId: "seedance-20-drama",
      skillVersion: "6.7.0",
      inputHash: "0123abcd",
      inputSnapshot: { shotId: "S001" },
      userModified: false,
    },
  });
  assert.equal(input.trace?.workflowKind, "skill.seedance");
  assert.equal(input.trace?.inputSnapshot?.shotId, "S001");
  assert.throws(() =>
    createJobSchema.parse({
      ...input,
      trace: { ...input.trace, apiKey: "must-not-pass" },
    }),
  );
});

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
