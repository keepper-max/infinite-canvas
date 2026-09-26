import assert from "node:assert/strict";
import test from "node:test";

import {
  publicModelDisplayName,
  runningHubCatalogItems,
  runningHubDisplayName,
  runningHubGlobalCatalogItems,
  runningHubGlobalTextCatalogItems,
  runningHubModelProfile,
} from "../src/model-gateway.js";
import {
  runningHubLlmUsage,
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

test("RunningHub China catalog excludes GPT models that require the global channel", () => {
  const models = runningHubCatalogItems([
    {
      endpoint: "rhart-image-g-2-official/text-to-image",
      display_name: "GPT Image 2",
    },
    {
      endpoint: "bytedance/seedream-4.5/text-to-image",
      display_name: "Seedream 4.5",
    },
  ]);
  assert.equal(
    models.some((item) => String(item.endpoint).includes("rhart-image-g")),
    false,
  );
  assert.equal(
    models.some((item) => String(item.endpoint).includes("seedream-4.5")),
    true,
  );
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

test("RunningHub global LLM catalog imports all OpenAI GPT chat models", () => {
  const models = runningHubGlobalTextCatalogItems({
    data: [
      {
        id: "openai/gpt-5.6-sol",
        capabilities: { chat: true, reasoning: true, vision: true },
        context_length: 1_050_000,
        pricing: {
          input: { amount: 0.004 },
          output: { amount: 0.02 },
          priceVersion: "gpt56-test",
        },
      },
      { id: "openai/gpt-image-2.5", capabilities: { chat: false } },
      { id: "anthropic/claude-test", capabilities: { chat: true } },
    ],
  });
  assert.equal(models.length, 1);
  assert.equal(models[0]?.endpoint, "openai/gpt-5.6-sol");
  assert.equal(models[0]?.display_name, "GPT 5.6 Sol");
  const profile = runningHubModelProfile(models[0]!);
  assert.deepEqual(profile?.modes, ["chat"]);
  assert.ok(profile?.acceptedParameters.includes("reasoningEffort"));
  assert.equal(profile?.parameterMap.reasoningEffort, "reasoning_effort");
});

test("RunningHub global LLM submits chat completions and prices actual token usage in USD", async () => {
  const originalFetch = globalThis.fetch;
  let submitted: Record<string, unknown> | undefined;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://llm.runninghub.ai/v1/chat/completions");
    submitted = JSON.parse(String(init?.body));
    return Response.json({
      id: "chatcmpl-rh-1",
      choices: [{ message: { content: "完成" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
    });
  };
  try {
    const metadata = {
      llm_pricing: {
        input: { amount: 0.002, discountAmount: 0.001 },
        output: { amount: 0.006, discountAmount: 0.003 },
        priceVersion: "gpt56-test",
      },
    };
    const provider = new RunningHubProvider(
      {
        baseUrl: "https://www.runninghub.ai/openapi/v2",
        llmBaseUrl: "https://llm.runninghub.ai/v1",
        apiKey: "test-only-global",
        catalogUrl: "https://llm.runninghub.ai/v1/models",
      },
      0,
    );
    const result = await provider.create({
      modelId: "runninghub_global.text.openai-gpt-5-6-sol",
      upstreamModel: "openai/gpt-5.6-sol",
      providerId: "runninghub_global",
      capability: "text",
      mode: "chat",
      prompt: "整理这一段文字",
      parameters: {},
      upstreamParameters: {
        max_tokens: 4096,
        reasoning_effort: "xhigh",
      },
      references: [],
      providerMetadata: metadata,
    });
    assert.equal(result.status, "completed");
    assert.equal(result.billingTraceId, "chatcmpl-rh-1");
    assert.equal(result.artifacts?.[0]?.text, "完成");
    assert.deepEqual(submitted, {
      model: "openai/gpt-5.6-sol",
      messages: [{ role: "user", content: "整理这一段文字" }],
      max_tokens: 4096,
      reasoning_effort: "high",
    });
    assert.deepEqual(result.usage, {
      provider_request_id: "chatcmpl-rh-1",
      prompt_tokens: 1000,
      completion_tokens: 500,
      total_tokens: 1500,
      consume_money: "0.0025",
      currency: "USD",
      price_version: "gpt56-test",
      billing_amount_source: "catalog_token_pricing",
    });
    assert.deepEqual(
      runningHubLlmUsage(
        { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
        {},
      ),
      { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("public model names hide supplier branding without changing model families", () => {
  assert.equal(
    publicModelDisplayName("RH Seedance2.0/文生视频"),
    "Seedance2.0/文生视频",
  );
  assert.equal(
    publicModelDisplayName("[RunningHub] GPT Image 2.5"),
    "GPT Image 2.5",
  );
  assert.equal(
    publicModelDisplayName("海马云 · 即梦图片 4.6"),
    "即梦图片 4.6",
  );
  assert.equal(
    publicModelDisplayName("Token360 - Seedance 2.5"),
    "Seedance 2.5",
  );
  assert.equal(publicModelDisplayName("Qwen Image 2.5"), "Qwen Image 2.5");
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
