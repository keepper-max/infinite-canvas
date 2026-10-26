import { createParser } from "eventsource-parser";
import { DomainError } from "./domain.js";

export type ProviderStreamTrace = {
  version: 1;
  status: number;
  contentType: "sse" | "other";
  openedAt: number;
  firstByteAt?: number;
  lastByteAt?: number;
  lastEventAt?: number;
  bytes: number;
  chunks: number;
  events: number;
  comments: number;
  textChars: number;
  reasoningChars: number;
  toolFragments: number;
  finishSeen: boolean;
  finishReason?: "stop" | "tool_calls" | "length" | "content_filter" | "other";
  usageSeen: boolean;
  usageFrameSeen: boolean;
  invalidUsage: boolean;
  promptTokens?: number;
  completionTokens?: number;
  doneSeen: boolean;
  jsonErrors: number;
  sseErrors: number;
  providerError: boolean;
  readErrorCode?:
    | "ECONNRESET"
    | "EPIPE"
    | "UND_ERR_SOCKET"
    | "UND_ERR_CONNECT_TIMEOUT"
    | "UND_ERR_HEADERS_TIMEOUT"
    | "UND_ERR_BODY_TIMEOUT"
    | "OTHER";
  identityMismatch: boolean;
  unsupportedChoices: boolean;
  networkEof: boolean;
  upstreamCancelRequested: boolean;
  termination:
    | "pending"
    | "protocol_complete"
    | "remote_eof"
    | "invalid_terminal"
    | "aborted"
    | "read_error"
    | "consumer_cancel";
};

/** Observe decoded HTTP body bytes before the SDK, never payloads or TLS wire data. */
export function observePinhaozhanStream(
  original: Response,
  signal: AbortSignal,
  persist: (trace: ProviderStreamTrace) => Promise<void>,
) {
  const trace: ProviderStreamTrace = {
    version: 1,
    status: original.status,
    contentType: original.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("text/event-stream")
      ? "sse"
      : "other",
    openedAt: Date.now(),
    bytes: 0,
    chunks: 0,
    events: 0,
    comments: 0,
    textChars: 0,
    reasoningChars: 0,
    toolFragments: 0,
    finishSeen: false,
    usageSeen: false,
    usageFrameSeen: false,
    invalidUsage: false,
    doneSeen: false,
    jsonErrors: 0,
    sseErrors: 0,
    providerError: false,
    identityMismatch: false,
    unsupportedChoices: false,
    networkEof: false,
    upstreamCancelRequested: false,
    termination: "pending",
  };
  let writes = Promise.resolve(),
    persistenceError: unknown,
    persistenceFailed = false;
  const record = () => {
    const snapshot = { ...trace };
    writes = writes
      .then(() => {
        if (!persistenceFailed) return persist(snapshot);
      })
      .catch((error) => {
        persistenceFailed = true;
        persistenceError = error;
      });
  };
  const flush = async () => {
    record();
    await writes;
    if (persistenceFailed)
      throw persistenceError ?? new Error("Stream trace persistence failed");
  };
  if (!original.ok || trace.contentType !== "sse" || !original.body) {
    record();
    return { response: original, trace, flush };
  }
  let id: string | undefined,
    ended = false,
    invalidTerminal = false;
  const safeComplete = () =>
    trace.finishSeen &&
    ["stop", "tool_calls"].includes(trace.finishReason ?? "") &&
    trace.usageSeen &&
    !trace.jsonErrors &&
    !trace.sseErrors &&
    !trace.providerError &&
    !trace.identityMismatch &&
    !trace.unsupportedChoices;
  const parser = createParser({
    onComment() {
      trace.comments++;
    },
    onError() {
      trace.sseErrors++;
    },
    onEvent({ data }) {
      trace.events++;
      trace.lastEventAt = Date.now();
      if (data === "[DONE]") {
        if (trace.doneSeen) {
          invalidTerminal = true;
          return;
        }
        trace.doneSeen = true;
        invalidTerminal = !safeComplete();
        return;
      }
      if (trace.doneSeen) {
        invalidTerminal = true;
        return;
      }
      let value: any;
      try {
        value = JSON.parse(data);
      } catch {
        trace.jsonErrors++;
        return;
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        trace.jsonErrors++;
        return;
      }
      if (value.error != null) trace.providerError = true;
      if (typeof value.id === "string" && value.id) {
        if (id && id !== value.id) trace.identityMismatch = true;
        id ??= value.id;
      }
      if (Array.isArray(value.choices)) {
        if (value.choices.length > 1) trace.unsupportedChoices = true;
        const choice = value.choices[0];
        if (choice?.index != null && choice.index !== 0)
          trace.unsupportedChoices = true;
        if (typeof choice?.delta?.content === "string")
          trace.textChars += choice.delta.content.length;
        const reasoning =
          choice?.delta?.reasoning_content ?? choice?.delta?.reasoning;
        if (typeof reasoning === "string")
          trace.reasoningChars += reasoning.length;
        if (Array.isArray(choice?.delta?.tool_calls))
          trace.toolFragments += choice.delta.tool_calls.length;
        if (choice?.finish_reason != null) {
          const first = !trace.finishSeen;
          trace.finishSeen = true;
          trace.finishReason = [
            "stop",
            "tool_calls",
            "length",
            "content_filter",
          ].includes(choice.finish_reason)
            ? choice.finish_reason
            : "other";
          if (first) record();
        }
      }
      if (value.usage != null) {
        const u = value.usage;
        const valid =
          Number.isSafeInteger(u.prompt_tokens) &&
          u.prompt_tokens >= 0 &&
          Number.isSafeInteger(u.completion_tokens) &&
          u.completion_tokens >= 0 &&
          Number.isSafeInteger(u.prompt_tokens + u.completion_tokens) &&
          (u.total_tokens == null ||
            u.total_tokens === u.prompt_tokens + u.completion_tokens);
        const first = !trace.usageFrameSeen;
        trace.usageFrameSeen = true;
        trace.usageSeen = valid;
        trace.invalidUsage = !valid;
        if (valid) {
          trace.promptTokens = u.prompt_tokens;
          trace.completionTokens = u.completion_tokens;
        }
        if (first) record();
      }
    },
  });
  const decoder = new TextDecoder(),
    reader = original.body.getReader();
  const cancelUpstream = () => {
    trace.upstreamCancelRequested = true;
    void reader.cancel().catch(() => undefined);
  };
  let abort: () => void;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      abort = () => {
        if (ended) return;
        ended = true;
        trace.termination = "aborted";
        signal.removeEventListener("abort", abort);
        cancelUpstream();
        record();
        controller.error(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    },
    async pull(controller) {
      if (ended) return;
      try {
        const { done, value } = await reader.read();
        if (ended) return;
        signal.throwIfAborted();
        if (done) {
          trace.networkEof = true;
          parser.feed(decoder.decode());
          ended = true;
          signal.removeEventListener("abort", abort);
          trace.termination = "remote_eof";
          record();
          controller.close();
          return;
        }
        const first = !trace.firstByteAt;
        trace.firstByteAt ??= Date.now();
        trace.lastByteAt = Date.now();
        trace.bytes += value.byteLength;
        trace.chunks++;
        if (first) record();
        parser.feed(decoder.decode(value, { stream: true }));
        if (invalidTerminal) {
          trace.termination = "invalid_terminal";
          throw new DomainError(
            "AGENT_STREAM_INCOMPLETE",
            "供应商流结束信息不完整，保留原请求等待核查",
            409,
          );
        }
        controller.enqueue(value);
        if (trace.doneSeen && safeComplete()) {
          signal.throwIfAborted();
          ended = true;
          signal.removeEventListener("abort", abort);
          trace.termination = "protocol_complete";
          cancelUpstream();
          record();
          controller.close();
        }
      } catch (error) {
        if (ended) return;
        ended = true;
        signal.removeEventListener("abort", abort);
        if (trace.termination !== "invalid_terminal")
          trace.termination = signal.aborted ? "aborted" : "read_error";
        if (trace.termination === "read_error") {
          const code = (error as any)?.cause?.code ?? (error as any)?.code;
          trace.readErrorCode = [
            "ECONNRESET",
            "EPIPE",
            "UND_ERR_SOCKET",
            "UND_ERR_CONNECT_TIMEOUT",
            "UND_ERR_HEADERS_TIMEOUT",
            "UND_ERR_BODY_TIMEOUT",
          ].includes(code)
            ? code
            : "OTHER";
        }
        cancelUpstream();
        record();
        controller.error(error);
      }
    },
    cancel() {
      if (ended) return;
      ended = true;
      signal.removeEventListener("abort", abort);
      trace.termination = "consumer_cancel";
      cancelUpstream();
      record();
    },
  });
  return {
    response: new Response(body, {
      status: original.status,
      statusText: original.statusText,
      headers: original.headers,
    }),
    trace,
    flush,
  };
}
