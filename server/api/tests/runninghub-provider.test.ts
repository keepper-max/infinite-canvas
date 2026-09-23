import assert from "node:assert/strict";
import test from "node:test";

import {
  runningHubCatalogItems,
  runningHubDisplayName,
  runningHubGlobalCatalogItems,
  runningHubModelProfile,
} from "../src/model-gateway.js";
import {
  RunningHubProvider,
  runningHubUsage,
} from "../src/runninghub-provider.js";

test("RunningHub supplements Seedance 2.5 standard endpoints until the public registry catches up", () => {
  const models = runningHubCatalogItems([]);
  const text = models.find(
    (item) => item.endpoint === "bytedance/seedance-2.5-token/text-to-video",
  );
  const image = models.find(
    (item) => item.endpoint === "bytedance/seedance-2.5-token/image-to-video",
  );
  const multimodal = models.find(
    (item) => item.endpoint === "bytedance/seedance-2.5-token/multimodal-video",
  );
  assert.deepEqual(runningHubModelProfile(text!)?.modes, ["t2v"]);
  assert.deepEqual(runningHubModelProfile(image!)?.modes, ["i2v", "flf2v"]);
  const multimodalProfile = runningHubModelProfile(multimodal!);
  assert.deepEqual(multimodalProfile?.modes, ["t2v", "multiref"]);
  assert.deepEqual(multimodalProfile?.requiredParametersByMode.multiref, [
    "references",
  ]);
  assert.equal(multimodalProfile?.limits.maxImages, 30);
  assert.equal(multimodalProfile?.limits.maxVideos, 10);
  assert.equal(multimodalProfile?.limits.maxAudios, 10);
});

test("RunningHub global catalog exposes GPT Image 2.5 text and reference modes", () => {
  const models = runningHubGlobalCatalogItems();
  assert.equal(models.length, 2);
  const text = models.find((item) =>
    String(item.endpoint).endsWith("sunburst/text-to-image"),
  );
  const image = models.find((item) =>
    String(item.endpoint).endsWith("sunburst/edit"),
  );
  assert.deepEqual(runningHubModelProfile(text!)?.modes, ["t2i"]);
  const profile = runningHubModelProfile(image!);
  assert.deepEqual(profile?.modes, ["i2i"]);
  assert.deepEqual(profile?.requiredParametersByMode, {
    i2i: ["references"],
  });
  assert.equal(profile?.limits.maxImages, 16);
  assert.equal(
    image?.catalog_identity_endpoint,
    "rhart-image-g-2.5-official-token/sunburst/image-to-image",
  );
});

test("RunningHub terminal usage normalizes actual cost, tokens and billing seconds", () => {
  assert.deepEqual(
    runningHubUsage(
      {
        data: {
          taskId: "rh-task-usage",
          usage: {
            thirdPartyConsumeMoney: "3.398",
            consumeCoins: null,
            taskCostTime: "0",
            tokenUsage: {
              usage: {
                completion_tokens: "38830",
                total_tokens: "38830",
              },
            },
            billingSeconds: "4",
          },
        },
      },
      "rh-task-usage",
    ),
    {
      provider_request_id: "rh-task-usage",
      third_party_consume_money: "3.398",
      task_cost_time: "0",
      billing_seconds: "4",
      completion_tokens: "38830",
      total_tokens: "38830",
    },
  );
});

test("RunningHub registry maps exact endpoint parameters into canvas capabilities", () => {
  const profile = runningHubModelProfile({
    endpoint: "vendor/model/image-to-video",
    output_type: "video",
    params: [
      { fieldKey: "imageUrl", type: "IMAGE", required: true },
      { fieldKey: "prompt", type: "STRING", required: false, maxLength: 2500 },
      {
        fieldKey: "duration",
        type: "LIST",
        required: true,
        defaultValue: "5",
        options: [{ value: "5" }, { value: "10" }],
      },
    ],
  });
  assert.deepEqual(profile?.modes, ["i2v"]);
  assert.deepEqual(profile?.requiredParametersByMode, { i2v: ["firstFrame"] });
  assert.deepEqual(profile?.limits.durations, ["5", "10"]);
  assert.equal(profile?.parameterMap.duration, "duration");
});

test("RunningHub preserves secondary text inputs and classifies verified audio routes", () => {
  const profile = runningHubModelProfile({
    endpoint: "mureka-ai/mureka-v8/generate-song",
    output_type: "string",
    params: [
      { fieldKey: "lyrics", type: "STRING", required: true, maxLength: 3500 },
      {
        fieldKey: "prompt",
        type: "STRING",
        required: false,
        defaultValue: "流行音乐",
      },
      { fieldKey: "n", type: "INT", required: false, defaultValue: 1 },
    ],
  });
  assert.equal(profile?.capability, "audio");
  assert.deepEqual(profile?.modes, ["tts"]);
  assert.ok(profile?.acceptedParameters.includes("prompt"));
  assert.equal(profile?.parameterMap.prompt, "prompt");
  assert.equal(profile?.limits.maxPromptChars, 3500);
});

test("RunningHub keeps provider enum casing in public parameter schemas", () => {
  const profile = runningHubModelProfile({
    endpoint: "minimax/hailuo-h3-max/text-to-video",
    output_type: "video",
    params: [
      { fieldKey: "prompt", type: "STRING", required: true },
      { fieldKey: "resolution", type: "LIST", options: [{ value: "768P" }] },
    ],
  });
  assert.deepEqual(profile?.limits.resolutions, ["768P"]);
});

test("RunningHub uses the required semantic text field without dropping the secondary one", async () => {
  const originalFetch = globalThis.fetch;
  let submitted: Record<string, unknown> | undefined;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/mureka-ai/mureka-v8/generate-song")) {
      submitted = JSON.parse(String(init?.body));
      return Response.json({ taskId: "rh-song-task-1" });
    }
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    const provider = new RunningHubProvider(
      {
        baseUrl: "https://www.runninghub.cn/openapi/v2",
        apiKey: "test-only",
        catalogUrl: "",
      },
      0,
    );
    await provider.create({
      modelId: "runninghub.audio.mureka-v8-song",
      upstreamModel: "mureka-ai/mureka-v8/generate-song",
      providerId: "runninghub",
      capability: "audio",
      mode: "tts",
      prompt: "主歌歌词",
      parameters: {},
      upstreamParameters: { prompt: "清澈流行曲风" },
      providerMetadata: {
        params: [
          { fieldKey: "lyrics", type: "STRING", required: true },
          { fieldKey: "prompt", type: "STRING", required: false },
        ],
      },
    });
    assert.deepEqual(submitted, { lyrics: "主歌歌词", prompt: "清澈流行曲风" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RunningHub marketing aliases expose the real model family and route", () => {
  assert.equal(
    runningHubDisplayName({
      display_name: "RH 全能图片PRO-图生图-官方稳定版",
      name_en: "nano-banana-pro/edit-official-stable",
    }),
    "Nano Banana Pro · 图片编辑 · 官方稳定版",
  );
  assert.equal(
    runningHubDisplayName({
      display_name: "RH 全能视频V3.1-fast-图生视频-低价渠道版",
      name_en: "google/veo3.1-fast/image-to-video-channel-low-price",
    }),
    "Veo 3.1 Fast · 图生视频 · 低价渠道版",
  );
  assert.equal(
    runningHubDisplayName({
      display_name: "RH Seedance2.0/文生视频",
      name_en: "Seedance2.0 Text to Video",
    }),
    "RH Seedance2.0/文生视频",
  );
});

test("RunningHub provider uploads media, submits exact endpoint and reads async result", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === "https://assets.example/frame.png")
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      });
    if (url.endsWith("/media/upload/binary"))
      return Response.json({
        code: 0,
        data: { download_url: "https://runninghub.example/upload/frame.png" },
      });
    if (url.endsWith("/vendor/model/image-to-video"))
      return Response.json({ code: 0, data: { taskId: "rh-task-1" } });
    if (url.endsWith("/query"))
      return Response.json({
        code: 0,
        data: {
          status: "SUCCESS",
          results: [{ url: "https://runninghub.example/result/video" }],
          usage: {
            thirdPartyConsumeMoney: "0.25",
            tokenUsage: { usage: { total_tokens: "1200" } },
            billingSeconds: "5",
          },
        },
      });
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    const provider = new RunningHubProvider(
      {
        baseUrl: "https://www.runninghub.cn/openapi/v2",
        apiKey: "test-only",
        catalogUrl: "https://example.invalid/models",
      },
      0,
    );
    const created = await provider.create({
      modelId: "runninghub.video.demo",
      upstreamModel: "vendor/model/image-to-video",
      providerId: "runninghub",
      capability: "video",
      mode: "i2v",
      prompt: "缓慢推进",
      parameters: {},
      upstreamParameters: { duration: "5", firstFrame: { url: "ignored" } },
      references: [
        {
          role: "first_frame",
          url: "https://assets.example/frame.png",
          mimeType: "image/png",
        },
      ],
      providerMetadata: {
        params: [
          { fieldKey: "imageUrl", type: "IMAGE", required: true },
          { fieldKey: "prompt", type: "STRING" },
          { fieldKey: "duration", type: "LIST" },
        ],
      },
    });
    assert.equal(created.providerJobId, "rh-task-1");
    const submit = requests.find((request) =>
      request.url.endsWith("/vendor/model/image-to-video"),
    );
    const body = JSON.parse(String(submit?.init?.body));
    assert.deepEqual(body, {
      duration: "5",
      prompt: "缓慢推进",
      imageUrl: "https://runninghub.example/upload/frame.png",
    });
    assert.equal(
      (submit?.init?.headers as Record<string, string>).Authorization,
      "Bearer test-only",
    );
    const result = await provider.get("rh-task-1", undefined, "video");
    assert.equal(result.status, "completed");
    assert.equal(result.artifacts?.[0]?.kind, "video");
    assert.equal(result.usage?.third_party_consume_money, "0.25");
    assert.equal(result.usage?.total_tokens, "1200");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RunningHub provider submits every image accepted by a multiple-input field", async () => {
  const originalFetch = globalThis.fetch;
  let uploadCount = 0;
  let submitted: Record<string, unknown> | undefined;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://assets.example/reference-"))
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      });
    if (url.endsWith("/media/upload/binary")) {
      uploadCount += 1;
      return Response.json({
        code: 0,
        data: {
          download_url: `https://runninghub.example/upload/reference-${uploadCount}.png`,
        },
      });
    }
    if (url.endsWith("/rhart-image-g-2.5-official-token/sunburst/edit")) {
      submitted = JSON.parse(String(init?.body));
      return Response.json({ taskId: "rh-global-edit-task-1" });
    }
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    const provider = new RunningHubProvider(
      {
        baseUrl: "https://www.runninghub.ai/openapi/v2",
        apiKey: "test-only-global",
        catalogUrl: "",
      },
      0,
    );
    const created = await provider.create({
      modelId: "runninghub_global.image.gpt-image-2-5-edit",
      upstreamModel: "rhart-image-g-2.5-official-token/sunburst/edit",
      providerId: "runninghub_global",
      capability: "image",
      mode: "i2i",
      prompt: "参考角色与表情生成新形象",
      parameters: {},
      upstreamParameters: {},
      references: [
        {
          role: "identity_reference",
          url: "https://assets.example/reference-1.png",
          mimeType: "image/png",
        },
        {
          role: "identity_reference",
          url: "https://assets.example/reference-2.png",
          mimeType: "image/png",
        },
      ],
      providerMetadata: {
        params: [
          { fieldKey: "prompt", type: "STRING", required: true },
          {
            fieldKey: "imageUrls",
            type: "IMAGE",
            required: true,
            multipleInputs: true,
            maxInputNum: 16,
          },
        ],
      },
    });
    assert.equal(created.providerJobId, "rh-global-edit-task-1");
    assert.deepEqual(submitted, {
      prompt: "参考角色与表情生成新形象",
      imageUrls: [
        "https://runninghub.example/upload/reference-1.png",
        "https://runninghub.example/upload/reference-2.png",
      ],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RunningHub global GPT Image converts canvas size into API ratio and resolution", async () => {
  const originalFetch = globalThis.fetch;
  let submitted: Record<string, unknown> | undefined;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (
      url.endsWith("/rhart-image-g-2.5-official-token/sunburst/text-to-image")
    ) {
      submitted = JSON.parse(String(init?.body));
      return Response.json({ taskId: "rh-global-task-1" });
    }
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    const provider = new RunningHubProvider(
      {
        baseUrl: "https://www.runninghub.ai/openapi/v2",
        apiKey: "test-only-global",
        catalogUrl: "",
      },
      0,
    );
    const created = await provider.create({
      modelId: "runninghub_global.image.gpt-image-2-5",
      upstreamModel: "rhart-image-g-2.5-official-token/sunburst/text-to-image",
      providerId: "runninghub_global",
      capability: "image",
      mode: "t2i",
      prompt: "高端产品海报",
      parameters: {},
      upstreamParameters: {
        size: "2688x1152",
        quality: "high",
        background: "transparent",
      },
      providerMetadata: {
        params: [
          { fieldKey: "prompt", type: "STRING", required: true },
          { fieldKey: "size", type: "STRING" },
          { fieldKey: "quality", type: "LIST" },
          { fieldKey: "background", type: "LIST" },
        ],
      },
    });
    assert.equal(created.providerJobId, "rh-global-task-1");
    assert.deepEqual(submitted, {
      prompt: "高端产品海报",
      aspectRatio: "21:9",
      resolution: "2k",
      quality: "high",
      background: "transparent",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
