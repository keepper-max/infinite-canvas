import test from "node:test";
import assert from "node:assert/strict";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { observePinhaozhanStream } from "../src/pinhaozhan-stream.js";
import { executeAgentProtocol } from "../src/native-agent/model.js";
import { parseConversationDecision } from "../src/native-agent/conversation-policy.js";
const usage = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
const frame = (
  delta: unknown,
  finish_reason: unknown = null,
  u?: unknown,
  id = "synthetic-id",
) =>
  "data: " +
  JSON.stringify({
    id,
    choices: [{ index: 0, delta, finish_reason }],
    ...(u ? { usage: u } : {}),
  }) +
  "\n\n";
const terminal = frame({}, "stop", usage) + "data: [DONE]\n\n";
function source(wire: string, close = false, fragment = false) {
  let cancelled = 0;
  const bytes = new TextEncoder().encode(wire);
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      if (fragment) for (const b of bytes) c.enqueue(Uint8Array.of(b));
      else c.enqueue(bytes);
      if (close) c.close();
    },
    cancel() {
      cancelled++;
    },
  });
  return {
    response: new Response(body, {
      headers: {
        "content-type": "text/event-stream",
        "x-oneapi-request-id": "synthetic-header",
      },
    }),
    cancelled: () => cancelled,
  };
}

test(
  "valid finish + usage + DONE closes a hanging connection without changing bytes",
  { timeout: 3000 },
  async () => {
    const wire =
        frame({ role: "assistant", content: "中文完整内容" }) + terminal,
      s = source(wire),
      snapshots: unknown[] = [];
    const observed = observePinhaozhanStream(
      s.response,
      AbortSignal.timeout(1000),
      async (t) => {
        snapshots.push(t);
      },
    );
    assert.equal(await observed.response.text(), wire);
    await observed.flush();
    assert.equal(s.cancelled(), 1);
    assert.equal(observed.trace.termination, "protocol_complete");
    assert.equal(observed.trace.networkEof, false);
    assert.equal(observed.trace.doneSeen, true);
    assert.equal(observed.trace.promptTokens, 100);
    assert.equal(
      observed.response.headers.get("x-oneapi-request-id"),
      "synthetic-header",
    );
    assert.ok(snapshots.length <= 5);
    assert.ok(!JSON.stringify(snapshots).includes("中文完整内容"));
  },
);
test(
  "UTF8 single-byte fragments, CRLF, comments and separate usage event preserve original wire",
  { timeout: 3000 },
  async () => {
    const wire = (
        ": keepalive\n\n" +
        frame({ content: "🙂中文" }) +
        frame({}, "stop") +
        "data: " +
        JSON.stringify({ id: "synthetic-id", choices: [], usage }) +
        "\n\ndata: [DONE]\n\n"
      ).replaceAll("\n", "\r\n"),
      s = source(wire, false, true),
      o = observePinhaozhanStream(
        s.response,
        AbortSignal.timeout(1000),
        async () => {},
      );
    assert.equal(await o.response.text(), wire);
    await o.flush();
    assert.equal(o.trace.comments, 1);
    assert.equal(o.trace.termination, "protocol_complete");
    assert.equal(o.trace.bytes, new TextEncoder().encode(wire).length);
  },
);
for (const [name, wire] of Object.entries({
  missing_usage:
    frame({ content: "partial" }) + frame({}, "stop") + "data: [DONE]\n\n",
  missing_finish:
    frame({ content: "partial" }, null, usage) + "data: [DONE]\n\n",
  truncated_finish:
    frame({ content: "partial" }) +
    frame({}, "length", usage) +
    "data: [DONE]\n\n",
  bad_usage:
    frame({}, "stop", { ...usage, completion_tokens: -1 }) + "data: [DONE]\n\n",
  changed_identity:
    frame({ content: "partial" }, null, undefined, "other") + terminal,
  malformed_json: "data: {BROKEN}\n\n" + terminal,
  provider_error:
    "data: " +
    JSON.stringify({ error: { message: "must-not-persist-secret" } }) +
    "\n\n" +
    terminal,
  after_done:
    frame({ content: "partial" }) +
    terminal +
    frame({ content: "not allowed" }),
  multiple_choices:
    "data: " +
    JSON.stringify({
      id: "synthetic-id",
      choices: [
        { index: 0, delta: {} },
        { index: 1, delta: {} },
      ],
    }) +
    "\n\n" +
    terminal,
}))
  test(
    "invalid terminal fails closed: " + name,
    { timeout: 3000 },
    async () => {
      const s = source(wire),
        o = observePinhaozhanStream(
          s.response,
          AbortSignal.timeout(1000),
          async () => {},
        );
      await assert.rejects(o.response.text(), {
        code: "AGENT_STREAM_INCOMPLETE",
      });
      await o.flush();
      assert.equal(o.trace.termination, "invalid_terminal");
      assert.equal(s.cancelled(), 1);
      assert.ok(!JSON.stringify(o.trace).includes("must-not-persist-secret"));
    },
  );
test(
  "partial stream remains aborted, never repaired into a successful response",
  { timeout: 3000 },
  async () => {
    const s = source(
        frame({ content: '{"intent":"chat","summary":"unfinished' }),
      ),
      o = observePinhaozhanStream(
        s.response,
        AbortSignal.timeout(100),
        async () => {},
      );
    await assert.rejects(o.response.text(), { name: "TimeoutError" });
    await o.flush();
    assert.equal(o.trace.termination, "aborted");
    assert.equal(o.trace.doneSeen, false);
    assert.equal(o.trace.finishSeen, false);
    assert.ok(o.trace.lastByteAt);
    assert.equal(s.cancelled(), 1);
  },
);
test(
  "natural EOF stays compatible, and consumer cancel stays distinct",
  { timeout: 3000 },
  async () => {
    const s = source(
        frame({ content: "complete" }) + frame({}, "stop", usage),
        true,
      ),
      o = observePinhaozhanStream(
        s.response,
        new AbortController().signal,
        async () => {},
      );
    await o.response.text();
    await o.flush();
    assert.equal(o.trace.termination, "remote_eof");
    assert.equal(o.trace.networkEof, true);
    assert.equal(o.trace.doneSeen, false);
    const c = new AbortController(),
      p = source(frame({ content: "partial" })),
      v = observePinhaozhanStream(p.response, c.signal, async () => {}),
      reader = v.response.body!.getReader();
    await reader.read();
    await reader.cancel();
    c.abort();
    await v.flush();
    assert.equal(v.trace.termination, "consumer_cancel");
    assert.equal(p.cancelled(), 1);
  },
);
test("non-SSE errors pass through and pre-aborted requests do not fabricate output", async () => {
  const response = Response.json({ error: "do-not-log" }, { status: 401 }),
    o = observePinhaozhanStream(
      response,
      new AbortController().signal,
      async () => {},
    );
  assert.equal(o.response, response);
  await o.flush();
  assert.equal(o.trace.contentType, "other");
  assert.ok(!JSON.stringify(o.trace).includes("do-not-log"));
  const p = observePinhaozhanStream(
    source(terminal).response,
    AbortSignal.abort(),
    async () => {},
  );
  await assert.rejects(p.response.text());
  await p.flush();
  assert.equal(p.trace.termination, "aborted");
  assert.equal(p.trace.bytes, 0);
});
test("trace persistence failure is observed, does not retry, and cannot report persistence success", async () => {
  let writes = 0;
  const o = observePinhaozhanStream(
    source(terminal).response,
    new AbortController().signal,
    async () => {
      writes++;
      throw undefined;
    },
  );
  await o.response.text();
  await assert.rejects(o.flush());
  assert.equal(writes, 1);
});
test(
  "slow metadata persistence does not delay consumption; final flush waits for it",
  { timeout: 3000 },
  async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
        release = r;
      }),
      o = observePinhaozhanStream(
        source(terminal).response,
        AbortSignal.timeout(1000),
        async () => {
          await gate;
        },
      );
    assert.ok((await o.response.text()).includes("[DONE]"));
    release();
    await o.flush();
    assert.equal(o.trace.termination, "protocol_complete");
  },
);
test(
  "actual SDK completes hanging valid stream, and strict semantic validation still rejects partial JSON",
  { timeout: 5000 },
  async () => {
    for (const content of [
      "正常中文输出",
      '{"intent":"chat","summary":"unfinished',
    ]) {
      let observation: ReturnType<typeof observePinhaozhanStream> | undefined,
        posts = 0;
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 1000);
      const sdk = createOpenAICompatible({
        name: "isolated-sse",
        baseURL: "http://127.0.0.1/v1",
        includeUsage: true,
        fetch: async (_u, init) => {
          posts++;
          assert.equal(
            JSON.parse(String(init?.body)).stream_options.include_usage,
            true,
          );
          observation = observePinhaozhanStream(
            source(frame({ content }) + terminal).response,
            init?.signal as AbortSignal,
            async () => {},
          );
          return observation.response;
        },
      });
      try {
        const r = await executeAgentProtocol(
          sdk("synthetic"),
          [{ role: "user", content: "hi" }],
          controller.signal,
          async () => {},
          { mode: "advice", toolNames: [] },
          "substitute",
        );
        await observation!.flush();
        assert.equal(r.text, content);
        assert.equal(r.inputTokens, 100);
        assert.equal(posts, 1);
        if (content.startsWith("{"))
          assert.throws(() => parseConversationDecision(r.text, "hi", []), {
            code: "AGENT_CONVERSATION_INVALID",
          });
      } finally {
        clearTimeout(timer);
      }
    }
  },
);

test("reasoning and tool fragments are counted without persisting their content", async () => {
  const wire =
    frame({ reasoning_content: "private-reasoning-marker" }) +
    frame({
      tool_calls: [
        { index: 0, function: { arguments: "private-tool-marker" } },
      ],
    }) +
    frame({}, "tool_calls", usage) +
    "data: [DONE]\n\n";
  const snapshots: unknown[] = [];
  const o = observePinhaozhanStream(
    source(wire).response,
    new AbortController().signal,
    async (t) => {
      snapshots.push(t);
    },
  );
  await o.response.text();
  await o.flush();
  assert.equal(o.trace.reasoningChars, "private-reasoning-marker".length);
  assert.equal(o.trace.toolFragments, 1);
  assert.equal(o.trace.textChars, 0);
  assert.equal(o.trace.termination, "protocol_complete");
  assert.ok(!JSON.stringify(snapshots).includes("private-reasoning-marker"));
  assert.ok(!JSON.stringify(snapshots).includes("private-tool-marker"));
});
