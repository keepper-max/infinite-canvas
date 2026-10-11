import test from "node:test";
import assert from "node:assert/strict";
import { runChatModel } from "@/lib/model-runner";

test("文字模型可按供应商能力省略 temperature", async () => {
  const originalFetch = globalThis.fetch;
  process.env.TEST_CHAT_MODEL_KEY = "test-only";
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "连接正常" } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    const result = await runChatModel(
      {
        id: "model-1",
        projectId: "project-1",
        name: "Claude Opus 5.5",
        baseUrl: "https://example.test/v1",
        model: "claude-opus-5-5",
        script: "",
        apiKeyEnv: "TEST_CHAT_MODEL_KEY",
        enabled: 1,
        updatedAt: new Date(),
      },
      "测试",
      { temperature: null, maxCompletionTokens: 8000 },
    );
    assert.equal(result.text, "连接正常");
    assert.equal("temperature" in requestBody, false);
    assert.equal(requestBody.max_completion_tokens, 8000);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TEST_CHAT_MODEL_KEY;
  }
});
