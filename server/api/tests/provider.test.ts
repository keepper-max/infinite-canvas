import assert from "node:assert/strict";
import test from "node:test";

import type { CompiledGenerationRequest } from "../src/model-gateway.js";
import { ProviderError, Token360Provider } from "../src/provider.js";

test("provider reports request timeout separately from connection failures", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const error = new Error("request timed out");
    error.name = "TimeoutError";
    throw error;
  };
  try {
    const provider = new Token360Provider(
      {
        baseUrl: "https://example.invalid",
        apiKey: "test-only",
        catalogUrl: "https://example.invalid/models",
      },
      1_000,
    );
    await assert.rejects(
      provider.create({
        modelId: "text.gpt-5-5",
        upstreamModel: "gpt-5.5",
        providerId: "token360",
        capability: "text",
        mode: "chat",
        prompt: "test",
        parameters: {},
        references: [],
        upstreamParameters: {},
      }),
      (error: unknown) =>
        error instanceof ProviderError &&
        error.code === "PROVIDER_TIMEOUT" &&
        error.message === "模型响应超时，请稍后重试" &&
        error.retryable,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider leaves requests unbounded when submit timeout is disabled", async () => {
  const originalFetch = globalThis.fetch;
  let receivedSignal: AbortSignal | null | undefined;
  globalThis.fetch = async (_input, init) => {
    receivedSignal = init?.signal;
    return Response.json({ data: [{ b64_json: "AA==" }] });
  };
  try {
    const provider = new Token360Provider(
      {
        baseUrl: "https://example.invalid",
        apiKey: "test-only",
        catalogUrl: "https://example.invalid/models",
      },
      0,
    );
    await provider.create({
      modelId: "image.test",
      upstreamModel: "image-test",
      providerId: "token360",
      capability: "image",
      mode: "t2i",
      prompt: "test",
      parameters: {},
      references: [],
      upstreamParameters: {},
    });
    assert.equal(receivedSignal, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider keeps manual cancellation active when submit timeout is disabled", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let receivedSignal: AbortSignal | null | undefined;
  globalThis.fetch = async (_input, init) => {
    receivedSignal = init?.signal;
    return Response.json({ data: [{ b64_json: "AA==" }] });
  };
  try {
    const provider = new Token360Provider(
      {
        baseUrl: "https://example.invalid",
        apiKey: "test-only",
        catalogUrl: "https://example.invalid/models",
      },
      0,
    );
    await provider.create(
      {
        modelId: "image.test",
        upstreamModel: "image-test",
        providerId: "token360",
        capability: "image",
        mode: "t2i",
        prompt: "test",
        parameters: {},
        references: [],
        upstreamParameters: {},
      },
      controller.signal,
    );
    assert.equal(receivedSignal, controller.signal);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider sends local job id as trace headers and preserves upstream trace", async () => {
  const originalFetch = globalThis.fetch;
  let headers: HeadersInit | undefined;
  globalThis.fetch = async (_input, init) => {
    headers = init?.headers;
    return Response.json(
      { data: [{ b64_json: "AA==" }], usage: { generated_images: 1 } },
      { headers: { "X-Trace-ID": "upstream-trace-1" } },
    );
  };
  try {
    const provider = new Token360Provider(
      {
        baseUrl: "https://example.invalid",
        apiKey: "test-only",
        catalogUrl: "https://example.invalid/models",
      },
      0,
    );
    const result = await provider.create(
      {
        modelId: "image.test",
        upstreamModel: "image-test",
        providerId: "token360",
        capability: "image",
        mode: "t2i",
        prompt: "test",
        parameters: {},
        references: [],
        upstreamParameters: {},
      },
      "local-job-1",
    );
    assert.equal(new Headers(headers).get("X-Trace-ID"), "local-job-1");
    assert.equal(new Headers(headers).get("X-Request-ID"), "local-job-1");
    assert.equal(result.billingTraceId, "upstream-trace-1");
    assert.deepEqual(result.usage, { generated_images: 1 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider preserves the billing trace from a rejected initial response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(
      { error: { message: "invalid input" } },
      { status: 400, headers: { "x-trace-id": "provider-rejected-trace" } },
    );
  try {
    const provider = new Token360Provider(
      {
        baseUrl: "https://example.invalid",
        apiKey: "test-only",
        catalogUrl: "https://example.invalid/models",
      },
      0,
    );
    await assert.rejects(
      () =>
        provider.create(
          {
            capability: "text",
            upstreamModel: "gpt-test",
            prompt: "test",
            upstreamParameters: {},
          } as never,
          "local-job-id",
        ),
      (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(
          error.safeDetails.billingTraceId,
          "provider-rejected-trace",
        );
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("video provider emits documented frame and multimodal reference shapes", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    bodies.push(
      JSON.parse(String(init?.body || "{}")) as Record<string, unknown>,
    );
    return Response.json({ id: `job-${bodies.length}`, status: "queued" });
  };
  try {
    const provider = new Token360Provider(
      {
        baseUrl: "https://example.invalid",
        apiKey: "test-only",
        catalogUrl: "https://example.invalid/models",
      },
      1_000,
    );
    await provider.create(
      request("flf2v", {
        duration: 5,
        aspect_ratio: "16:9",
        firstFrame: { dataUrl: "data:image/png;base64,AA==" },
        lastFrame: { url: "https://example.invalid/last.png" },
      }),
    );
    await provider.create(
      request("multiref", {
        references: [
          {
            role: "identity_reference",
            dataUrl: "data:image/png;base64,AA==",
            mimeType: "image/png",
          },
          {
            role: "audio_reference",
            url: "https://example.invalid/ref.mp3",
            mimeType: "audio/mpeg",
          },
        ],
      }),
    );
    assert.deepEqual(bodies[0]?.frame_images, [
      {
        type: "image_url",
        frame_type: "first_frame",
        image_url: { url: "data:image/png;base64,AA==" },
      },
      {
        type: "image_url",
        frame_type: "last_frame",
        image_url: { url: "https://example.invalid/last.png" },
      },
    ]);
    assert.equal(bodies[0]?.aspect_ratio, "16:9");
    assert.equal(bodies[0]?.omni_reference_task_type, undefined);
    assert.deepEqual(bodies[1]?.input_references, [
      {
        type: "image_url",
        image_url: { url: "data:image/png;base64,AA==" },
        role: "reference",
      },
      {
        type: "audio_url",
        audio_url: { url: "https://example.invalid/ref.mp3" },
        role: "reference",
      },
    ]);
    assert.equal(bodies[1]?.omni_reference_task_type, undefined);
    await provider.create(
      request("multiref", {
        references: [],
        omni_reference_task_type: "reference",
      }),
    );
    assert.equal(bodies[2]?.omni_reference_task_type, "reference");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("completed video without inline URL downloads canonical content endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    return url.includes("format=binary")
      ? new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "video/mp4" },
        })
      : Response.json({ id: "video-1", status: "completed" });
  };
  try {
    const provider = new Token360Provider(
      {
        baseUrl: "https://example.invalid",
        apiKey: "test-only",
        catalogUrl: "https://example.invalid/models",
      },
      1_000,
    );
    const result = await provider.get("video-1");
    assert.equal(result.artifacts?.[0]?.bytes?.byteLength, 3);
    assert.match(
      urls[1] || "",
      /\/v1\/videos\/video-1\/content\?format=binary$/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("video provider explains generated-audio copyright rejection", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      id: "video-1",
      status: "failed",
      error: {
        message:
          "The request was rejected because the generated audio may violate copyright restrictions.",
      },
    });
  try {
    const provider = new Token360Provider(
      {
        baseUrl: "https://example.invalid",
        apiKey: "test-only",
        catalogUrl: "https://example.invalid/models",
      },
      1_000,
    );
    await assert.rejects(
      provider.get("video-1"),
      (error: unknown) =>
        error instanceof ProviderError &&
        error.code === "PROVIDER_REJECTED" &&
        error.message === "生成音频可能涉及版权限制，请关闭生成音频后重试",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("video provider explains visual copyright rejection", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      id: "video-2",
      status: "failed",
      error: {
        message:
          "The request was rejected because the generated video may violate copyright restrictions.",
      },
    });
  try {
    const provider = new Token360Provider(
      {
        baseUrl: "https://example.invalid",
        apiKey: "test-only",
        catalogUrl: "https://example.invalid/models",
      },
      1_000,
    );
    await assert.rejects(
      provider.get("video-2"),
      (error: unknown) =>
        error instanceof ProviderError &&
        error.code === "PROVIDER_REJECTED" &&
        error.message ===
          "当前请求可能涉及版权限制，请更换受保护的角色、品牌或参考素材后重试",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("video provider returns a sanitized concrete upstream failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      id: "video-3",
      status: "failed",
      error: {
        message:
          "image data 1 failed: Image exceeds the maximum allowed total pixels. Current dimensions: 6336x9504 = 60217344 pixels. Maximum allowed: 36000000 pixels. https://private.invalid sk-secret",
      },
    });
  try {
    const provider = new Token360Provider(
      {
        baseUrl: "https://example.invalid",
        apiKey: "test-only",
        catalogUrl: "https://example.invalid/models",
      },
      1_000,
    );
    await assert.rejects(
      provider.get("video-3"),
      (error: unknown) =>
        error instanceof ProviderError &&
        error.code === "PROVIDER_REJECTED" &&
        error.message.includes("Current dimensions: 6336x9504") &&
        error.message.includes("[URL]") &&
        error.message.includes("[REDACTED]") &&
        !error.message.includes("private.invalid") &&
        !error.message.includes("sk-secret"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function request(
  mode: CompiledGenerationRequest["mode"],
  upstreamParameters: Record<string, unknown>,
): CompiledGenerationRequest {
  return {
    modelId: "video.seedance-2-5",
    upstreamModel: "seedance-2.5",
    providerId: "token360",
    capability: "video",
    mode,
    prompt: "test",
    parameters: {},
    references: [],
    upstreamParameters,
  };
}
