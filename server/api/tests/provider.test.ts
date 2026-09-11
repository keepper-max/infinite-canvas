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
    assert.equal(bodies[1]?.omni_reference_task_type, "reference");
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
