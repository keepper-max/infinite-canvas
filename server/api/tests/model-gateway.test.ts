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
    "bitrateMode",
    "outputFormat",
    "omniReferenceTaskType",
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
  parameter_map: {
    aspectRatio: "ratio",
    bitrateMode: "bitrate_mode",
    outputFormat: "output_format",
    omniReferenceTaskType: "omni_reference_task_type",
  },
};

function gateway(row = definition) {
  return new ModelGateway({
    query: async () => ({ rows: [row], rowCount: 1 }),
  } as unknown as Pool);
}

test("catalog profiles expose each supported generation family without mixing speech recognition into TTS", () => {
  assert.deepEqual(
    catalogModelProfile({
      modelType: "LLM",
      supported_parameters: ["reasoning_effort"],
    })?.modes,
    ["chat"],
  );
  assert.deepEqual(
    catalogModelProfile({
      modelType: "IMAGE_GENERATION",
      modelInputTypes: ["TEXT", "IMAGE"],
      supported_parameters: ["n", "size", "images"],
    })?.modes,
    ["t2i", "i2i"],
  );
  assert.deepEqual(
    catalogModelProfile({
      modelType: "VIDEO_GENERATION",
      modelInputTypes: ["TEXT", "IMAGE"],
      supported_parameters: ["duration", "frame_images", "input_references"],
    })?.modes,
    ["t2v", "i2v", "flf2v", "multiref"],
  );
  assert.deepEqual(
    catalogModelProfile({
      modelType: "AUDIO_TEXT_TO_SPEECH",
      supported_parameters: ["voice", "audio_format"],
    })?.modes,
    ["tts"],
  );
  assert.equal(
    catalogModelProfile({ modelType: "AUDIO_SPEECH_TO_TEXT" }),
    null,
  );
});

test("video catalog profiles preserve model-specific options and request mappings", () => {
  const profile = catalogModelProfile({
    modelType: "VIDEO_GENERATION",
    modelInputTypes: ["text", "image", "video", "audio"],
    supported_parameters: [
      "duration",
      "resolution",
      "aspect_ratio",
      "bitrate_mode",
      "output_format",
      "frame_images",
      "input_references",
    ],
    normalizedApiParameterSchema: {
      fields: [
        {
          name: "duration",
          type: "integer",
          playground_visible: true,
          request_role: "model_parameter",
          enum: [-1, 5, 10],
        },
        {
          name: "resolution",
          type: "string",
          playground_visible: true,
          request_role: "model_parameter",
          enum: ["720p", "1080p"],
        },
        {
          name: "aspect_ratio",
          type: "string",
          playground_visible: true,
          request_role: "model_parameter",
          enum: ["adaptive", "16:9"],
        },
        {
          name: "bitrate_mode",
          type: "string",
          playground_visible: true,
          request_role: "model_parameter",
          enum: ["standard", "high"],
        },
        {
          name: "output_format",
          type: "string",
          playground_visible: true,
          request_role: "model_parameter",
          enum: ["mp4", "mov"],
        },
        {
          name: "input_references",
          reference_images: { max_items: 30 },
          reference_videos: { max_items: 10 },
          reference_audios: { max_items: 10 },
        },
      ],
    },
  });
  assert.deepEqual(profile?.limits, {
    maxImages: 30,
    maxVideos: 10,
    maxAudios: 10,
    maxPromptChars: 20_000,
    durations: [-1, 5, 10],
    resolutions: ["720p", "1080p"],
    aspectRatios: ["adaptive", "16:9"],
    parameterSchema: [
      { key: "duration", type: "integer", options: [-1, 5, 10] },
      { key: "resolution", type: "string", options: ["720p", "1080p"] },
      { key: "aspectRatio", type: "string", options: ["adaptive", "16:9"] },
      { key: "bitrateMode", type: "string", options: ["standard", "high"] },
      { key: "outputFormat", type: "string", options: ["mp4", "mov"] },
    ],
  });
  assert.ok(profile?.acceptedParameters.includes("bitrateMode"));
  assert.equal(profile?.parameterMap.outputFormat, "output_format");
});

test("video modes follow frame and multimodal reference limits", () => {
  const singleFrame = catalogModelProfile({
    modelType: "VIDEO_GENERATION",
    supported_parameters: ["frame_images", "input_references"],
    normalizedApiParameterSchema: {
      fields: [
        { name: "frame_images", max_items: 1 },
        {
          name: "input_references",
          reference_images: { max_items: 0 },
          reference_videos: { max_items: 0 },
          reference_audios: { max_items: 0 },
        },
      ],
    },
  });
  assert.deepEqual(singleFrame?.modes, ["t2v", "i2v"]);

  const firstLastAndReferences = catalogModelProfile({
    modelType: "VIDEO_GENERATION",
    supported_parameters: ["frame_images", "input_references"],
    normalizedApiParameterSchema: {
      fields: [
        { name: "frame_images", max_items: 2 },
        {
          name: "input_references",
          reference_images: { max_items: 3 },
          reference_videos: { max_items: 1 },
          reference_audios: { max_items: 0 },
        },
      ],
    },
  });
  assert.deepEqual(firstLastAndReferences?.modes, [
    "t2v",
    "i2v",
    "flf2v",
    "multiref",
  ]);
});

test("catalog-defined scalar video parameters map and validate generically", async () => {
  const profile = catalogModelProfile({
    modelType: "VIDEO_GENERATION",
    supported_parameters: ["duration", "movement_amplitude", "prompt_extend"],
    normalizedApiParameterSchema: {
      fields: [
        {
          name: "duration",
          type: "integer",
          playground_visible: true,
          request_role: "model_parameter",
          enum: [5],
        },
        {
          name: "movement_amplitude",
          type: "string",
          playground_visible: true,
          request_role: "model_parameter",
          enum: ["small", "large"],
        },
        {
          name: "prompt_extend",
          type: "boolean",
          playground_visible: true,
          request_role: "model_parameter",
          default: true,
        },
      ],
    },
  });
  assert.ok(profile);
  const row = {
    ...definition,
    modes: profile.modes,
    accepted_parameters: profile.acceptedParameters,
    required_parameters_by_mode: profile.requiredParametersByMode,
    limits: profile.limits,
    parameter_map: profile.parameterMap,
  };
  const compiled = await gateway(row).compile({
    modelId: definition.id,
    capability: "video",
    mode: "t2v",
    prompt: "人物缓慢转身",
    parameters: { duration: 5, movementAmplitude: "large", promptExtend: true },
  });
  assert.deepEqual(compiled.upstreamParameters, {
    duration: 5,
    movement_amplitude: "large",
    prompt_extend: true,
  });
  await assert.rejects(
    () =>
      gateway(row).compile({
        modelId: definition.id,
        capability: "video",
        mode: "t2v",
        prompt: "人物缓慢转身",
        parameters: { duration: 5, movementAmplitude: "invalid" },
      }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "INVALID_MODEL_PARAMETER",
  );
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
      omniReferenceTaskType: "reference",
      firstFrame: "unsafe",
    },
    references: [{ role: "first_frame", url: "https://example.com/frame.png" }],
  });
  assert.deepEqual(compiled.upstreamParameters, { duration: 5, ratio: "16:9" });
});

test("Seedance video extension forces adaptive ratio without changing motion references", async () => {
  const extension = await gateway().compile({
    modelId: definition.id,
    capability: "video",
    mode: "multiref",
    prompt: "延续上一镜头",
    parameters: { aspectRatio: "9:16" },
    references: [
      {
        role: "video_input",
        url: "https://example.com/source.mp4",
        mimeType: "video/mp4",
      },
    ],
  });
  assert.equal(extension.upstreamParameters.ratio, "adaptive");

  const motionReference = await gateway().compile({
    modelId: definition.id,
    capability: "video",
    mode: "multiref",
    prompt: "参考镜头运动",
    parameters: { aspectRatio: "16:9" },
    references: [
      {
        role: "motion_reference",
        url: "https://example.com/motion.mp4",
        mimeType: "video/mp4",
      },
    ],
  });
  assert.equal(motionReference.upstreamParameters.ratio, "16:9");
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

test("multiref enforces explicit zero limits without rejecting frame modes", async () => {
  const row = {
    ...definition,
    limits: { ...definition.limits, maxImages: 3, maxVideos: 1, maxAudios: 0 },
  };
  await assert.rejects(
    () =>
      gateway(row).compile({
        modelId: definition.id,
        capability: "video",
        mode: "multiref",
        prompt: "人物转身",
        references: [
          {
            role: "audio_reference",
            url: "https://example.com/reference.mp3",
            mimeType: "audio/mpeg",
          },
        ],
      }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "INVALID_MODEL_PARAMETER",
  );
  await assert.doesNotReject(() =>
    gateway({ ...row, limits: { ...row.limits, maxImages: 0 } }).compile({
      modelId: definition.id,
      capability: "video",
      mode: "i2v",
      prompt: "人物转身",
      references: [
        {
          role: "first_frame",
          url: "https://example.com/first.png",
          mimeType: "image/png",
        },
      ],
    }),
  );
});

test("video quality and format parameters map to provider field names", async () => {
  const compiled = await gateway().compile({
    modelId: definition.id,
    capability: "video",
    mode: "t2v",
    prompt: "人物转身",
    parameters: { bitrateMode: "high", outputFormat: "mp4" },
  });
  assert.deepEqual(compiled.upstreamParameters, {
    bitrate_mode: "high",
    output_format: "mp4",
  });
});
