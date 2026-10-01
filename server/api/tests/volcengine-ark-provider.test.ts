import assert from "node:assert/strict";
import test from "node:test";

import {
  runningHubModelProfile,
  volcengineArkCatalogItems,
} from "../src/model-gateway.js";
import { volcengineArkAmount } from "../src/volcengine-ark-pricing.js";
import { VolcengineArkProvider } from "../src/volcengine-ark-provider.js";

test("火山方舟目录仅包含已选文字、图片和视频模型", () => {
  const models = volcengineArkCatalogItems();
  assert.equal(models.length, 9);
  assert.deepEqual(
    Array.from(new Set(models.map((item) => item.output_type))).sort(),
    ["image", "text", "video"],
  );
  assert.equal(
    models.some((item) => /embedding|3d/i.test(String(item.endpoint))),
    false,
  );
  const video = models.find((item) => item.output_type === "video");
  assert.deepEqual(runningHubModelProfile(video!)?.modes, [
    "t2v",
    "i2v",
    "flf2v",
    "multiref",
  ]);
});

test("火山方舟文字费用区分普通输入、缓存输入和输出", () => {
  assert.equal(
    volcengineArkAmount({
      upstreamModel: "doubao-seed-2-1-pro-260915",
      capability: "text",
      usage: {
        prompt_tokens: 1_000,
        completion_tokens: 500,
        prompt_tokens_details: { cached_tokens: 200 },
      },
    }),
    "0.02004",
  );
  assert.equal(
    volcengineArkAmount({
      upstreamModel: "deepseek-v4-1-flash-260910",
      capability: "text",
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 },
      createdAt: "2026-10-03T02:00:00.000Z",
    }),
    "5",
  );
});

test("火山方舟图片和视频费用使用官方刊例档位", () => {
  assert.equal(
    volcengineArkAmount({
      upstreamModel: "doubao-seedream-5-0-pro-260628",
      capability: "image",
      usage: { generated_images: 2, input_images: 3 },
      parameters: { size: "2048x2048" },
    }),
    "1.24",
  );
  assert.equal(
    volcengineArkAmount({
      upstreamModel: "doubao-seedance-2-5-260628",
      capability: "video",
      usage: { completion_tokens: 100_000 },
      parameters: { resolution: "1080p" },
      inputSnapshot: {
        references: [{ mimeType: "video/mp4", role: "reference" }],
      },
    }),
    "4.6",
  );
});

test("火山方舟文字请求走官方兼容接口并保留用量", async () => {
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> | undefined;
  globalThis.fetch = async (input, init) => {
    assert.equal(
      String(input),
      "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    );
    body = JSON.parse(String(init?.body));
    return Response.json({
      id: "chatcmpl-ark-test",
      choices: [{ message: { content: "完成" } }],
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
    });
  };
  try {
    const provider = new VolcengineArkProvider(
      {
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        apiKey: "test-only",
        catalogUrl: "https://ark.cn-beijing.volces.com/api/v3/models",
      },
      0,
    );
    const result = await provider.create({
      modelId: "volcengine_ark.text.doubao-seed-2-1-pro-260915",
      upstreamModel: "doubao-seed-2-1-pro-260915",
      providerId: "volcengine_ark",
      capability: "text",
      mode: "chat",
      prompt: "整理这段文字",
      parameters: {},
      upstreamParameters: { max_tokens: 4096 },
    });
    assert.equal(body?.model, "doubao-seed-2-1-pro-260915");
    assert.equal(result.artifacts?.[0]?.text, "完成");
    assert.equal(result.usage?.total_tokens, 16);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
