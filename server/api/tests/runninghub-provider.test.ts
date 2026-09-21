import assert from "node:assert/strict";
import test from "node:test";

import {
  runningHubDisplayName,
  runningHubModelProfile,
} from "../src/model-gateway.js";
import { RunningHubProvider } from "../src/runninghub-provider.js";

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
  } finally {
    globalThis.fetch = originalFetch;
  }
});
