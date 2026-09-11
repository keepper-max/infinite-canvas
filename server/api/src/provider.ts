import type { ProviderConfig } from "./config.js";
import type { CompiledGenerationRequest } from "./model-gateway.js";

export type ProviderArtifact = {
  kind: "text" | "image" | "video" | "audio";
  mimeType: string;
  url?: string;
  bytes?: Uint8Array;
  text?: string;
};
export type ProviderResult = {
  providerJobId?: string;
  status: "pending" | "running" | "completed";
  progress?: number;
  artifacts?: ProviderArtifact[];
};

export class ProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly safeDetails: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export class Token360Provider {
  constructor(
    private readonly config: ProviderConfig,
    private readonly submitTimeoutMs: number,
  ) {}

  async create(
    request: CompiledGenerationRequest,
    signal?: AbortSignal,
  ): Promise<ProviderResult> {
    if (!this.config.apiKey)
      throw new ProviderError(
        "PROVIDER_AUTH_FAILED",
        "模型服务尚未配置",
        false,
      );
    if (request.capability === "text") {
      const payload = await this.json(
        "/v1/chat/completions",
        {
          model: request.upstreamModel,
          messages: [{ role: "user", content: request.prompt }],
          ...request.upstreamParameters,
        },
        signal,
      );
      const text = readText(payload);
      if (!text)
        throw new ProviderError(
          "PROVIDER_REJECTED",
          "模型没有返回文本结果",
          false,
        );
      return {
        status: "completed",
        artifacts: [
          { kind: "text", mimeType: "text/plain; charset=utf-8", text },
        ],
      };
    }
    if (request.capability === "image") {
      const payload = await this.json(
        "/v1/images/generations",
        {
          model: request.upstreamModel,
          prompt: request.prompt,
          ...request.upstreamParameters,
        },
        signal,
      );
      const artifacts = readUrls(payload).map((url) => ({
        kind: "image" as const,
        mimeType: "image/png",
        url,
      }));
      const base64 = readBase64(payload).map((value) => ({
        kind: "image" as const,
        mimeType: "image/png",
        bytes: Uint8Array.from(Buffer.from(value, "base64")),
      }));
      if (!artifacts.length && !base64.length)
        throw new ProviderError(
          "PROVIDER_REJECTED",
          "模型没有返回图片结果",
          false,
        );
      return { status: "completed", artifacts: [...artifacts, ...base64] };
    }
    if (request.capability === "audio") {
      const response = await this.fetch(
        "/v1/audio/speech",
        {
          model: request.upstreamModel,
          input: request.prompt,
          ...request.upstreamParameters,
        },
        signal,
      );
      return {
        status: "completed",
        artifacts: [
          {
            kind: "audio",
            mimeType: response.headers.get("content-type") || "audio/mpeg",
            bytes: new Uint8Array(await response.arrayBuffer()),
          },
        ],
      };
    }
    const payload = await this.json(
      "/v1/videos",
      compileVideoBody(request),
      signal,
    );
    const directUrls = readUrls(payload);
    if (directUrls.length)
      return {
        status: "completed",
        artifacts: directUrls.map((url) => ({
          kind: "video",
          mimeType: "video/mp4",
          url,
        })),
      };
    const id = readId(payload);
    if (!id)
      throw new ProviderError(
        "PROVIDER_REJECTED",
        "模型没有返回视频任务编号",
        false,
      );
    const status = normalizeStatus(payload);
    if (status === "failed")
      throw new ProviderError(
        "PROVIDER_REJECTED",
        providerUserMessage(readError(payload), "视频生成失败"),
        false,
        { upstreamMessage: sanitizeProviderDetail(readError(payload)) },
      );
    return { providerJobId: id, status, progress: readProgress(payload) };
  }

  async get(
    providerJobId: string,
    signal?: AbortSignal,
  ): Promise<ProviderResult> {
    const payload = await this.json(
      `/v1/videos/${encodeURIComponent(providerJobId)}`,
      undefined,
      signal,
      "GET",
    );
    const status = normalizeStatus(payload);
    if (status === "completed") {
      const urls = readUrls(payload);
      if (urls.length)
        return {
          providerJobId,
          status,
          progress: 100,
          artifacts: urls.map((url) => ({
            kind: "video",
            mimeType: "video/mp4",
            url,
          })),
        };
      const content = await this.raw(
        `/v1/videos/${encodeURIComponent(providerJobId)}/content?format=binary`,
        { method: "GET", signal },
      );
      if (!content.ok) await this.throwResponse(content);
      return {
        providerJobId,
        status,
        progress: 100,
        artifacts: [
          {
            kind: "video",
            mimeType: content.headers.get("content-type") || "video/mp4",
            bytes: new Uint8Array(await content.arrayBuffer()),
          },
        ],
      };
    }
    if (status === "pending" || status === "running")
      return { providerJobId, status, progress: readProgress(payload) };
    throw new ProviderError(
      "PROVIDER_REJECTED",
      providerUserMessage(readError(payload), "视频生成失败"),
      false,
      { upstreamMessage: sanitizeProviderDetail(readError(payload)) },
    );
  }

  async cancel(providerJobId: string, signal?: AbortSignal) {
    const response = await this.raw(
      `/v1/videos/${encodeURIComponent(providerJobId)}`,
      { method: "DELETE", signal },
    );
    if (!response.ok && response.status !== 404 && response.status !== 405)
      await this.throwResponse(response);
  }

  private json(
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    method = "POST",
  ) {
    return this.raw(path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      headers:
        body === undefined ? undefined : { "content-type": "application/json" },
    }).then(async (response) => {
      if (!response.ok) await this.throwResponse(response);
      return response.json() as Promise<unknown>;
    });
  }
  private fetch(path: string, body: unknown, signal?: AbortSignal) {
    return this.raw(path, {
      method: "POST",
      body: JSON.stringify(body),
      signal,
      headers: { "content-type": "application/json" },
    }).then(async (response) => {
      if (!response.ok) await this.throwResponse(response);
      return response;
    });
  }
  private async raw(path: string, init: RequestInit) {
    const timeout =
      this.submitTimeoutMs > 0
        ? AbortSignal.timeout(this.submitTimeoutMs)
        : undefined;
    const signal =
      init.signal && timeout
        ? AbortSignal.any([init.signal, timeout])
        : init.signal || timeout;
    try {
      return await fetch(`${this.config.baseUrl}${path}`, {
        ...init,
        signal,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: "application/json",
          ...init.headers,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError")
        throw new ProviderError(
          "PROVIDER_TIMEOUT",
          "模型响应超时，请稍后重试",
          true,
          { errorName: error.name },
        );
      throw new ProviderError(
        "PROVIDER_UNAVAILABLE",
        "模型服务连接失败",
        true,
        { errorName: error instanceof Error ? error.name : "UnknownError" },
      );
    }
  }
  private async throwResponse(response: Response): Promise<never> {
    const text = (await response.text()).slice(0, 2_000);
    const upstreamMessage = readError(safeJson(text));
    if (response.status === 401 || response.status === 403)
      throw new ProviderError(
        "PROVIDER_AUTH_FAILED",
        "模型服务授权失败",
        false,
        { status: response.status },
      );
    if (response.status === 429)
      throw new ProviderError(
        "PROVIDER_RATE_LIMITED",
        "模型服务繁忙，请稍后重试",
        true,
        { status: response.status },
      );
    if (response.status >= 500)
      throw new ProviderError(
        "PROVIDER_UNAVAILABLE",
        "模型服务暂时不可用",
        true,
        { status: response.status },
      );
    throw new ProviderError(
      "PROVIDER_REJECTED",
      providerUserMessage(
        upstreamMessage,
        "模型拒绝了当前请求，请检查参数和参考素材",
      ),
      false,
      {
        status: response.status,
        upstreamMessage: sanitizeProviderDetail(upstreamMessage),
      },
    );
  }
}

function compileVideoBody(request: CompiledGenerationRequest) {
  const body: Record<string, unknown> = {
    model: request.upstreamModel,
    prompt: request.prompt,
    ...request.upstreamParameters,
  };
  const source = (value: unknown) =>
    value && typeof value === "object"
      ? (value as Record<string, unknown>).url ||
        (value as Record<string, unknown>).dataUrl
      : value;
  const frames = [
    body.firstFrame
      ? {
          type: "image_url",
          frame_type: "first_frame",
          image_url: { url: source(body.firstFrame) },
        }
      : null,
    body.lastFrame
      ? {
          type: "image_url",
          frame_type: "last_frame",
          image_url: { url: source(body.lastFrame) },
        }
      : null,
  ].filter(Boolean);
  if (frames.length) body.frame_images = frames;
  delete body.firstFrame;
  delete body.lastFrame;
  if (Array.isArray(body.references)) {
    body.input_references = body.references.map((value) => {
      const item = asRecord(value);
      const url = source(item);
      const mime = String(item.mimeType || "");
      const type = mime.startsWith("video/")
        ? "video_url"
        : mime.startsWith("audio/")
          ? "audio_url"
          : "image_url";
      return { type, [type]: { url }, role: "reference" };
    });
  }
  delete body.references;
  if (request.mode === "multiref") body.omni_reference_task_type = "reference";
  return body;
}
function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return { message: value };
  }
}
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
function unwrap(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  return asRecord(
    record.data && !Array.isArray(record.data) ? record.data : record,
  );
}
function readId(value: unknown) {
  const record = unwrap(value);
  return [record.id, record.task_id, record.job_id].find(
    (entry): entry is string => typeof entry === "string",
  );
}
function readProgress(value: unknown) {
  const n = Number(unwrap(value).progress || 0);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}
function normalizeStatus(value: unknown): ProviderResult["status"] | "failed" {
  const status = String(unwrap(value).status || "pending").toLowerCase();
  if (["completed", "succeeded", "success", "done"].includes(status))
    return "completed";
  if (["failed", "error", "cancelled", "canceled"].includes(status))
    return "failed";
  return ["processing", "running", "in_progress"].includes(status)
    ? "running"
    : "pending";
}
function readError(value: unknown): string {
  const record = asRecord(value);
  const error = asRecord(record.error);
  return (
    [record.message, record.msg, error.message, unwrap(value).message].find(
      (entry): entry is string =>
        typeof entry === "string" && Boolean(entry.trim()),
    ) || ""
  );
}
function providerUserMessage(value: string, fallback: string) {
  const message = value.toLowerCase();
  if (message.includes("omni_reference_task_type"))
    return "当前生成模式与多参考参数不匹配";
  if (message.includes("first_frame") || message.includes("last_frame"))
    return "首帧或尾帧参数不符合模型要求";
  if (message.includes("content") && message.includes("policy"))
    return "生成内容未通过模型安全检查";
  return fallback;
}
function sanitizeProviderDetail(value: string) {
  if (!value) return "";
  return value
    .replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/sk-[a-z0-9_-]+/gi, "[REDACTED]")
    .replace(/https?:\/\/\S+/gi, "[URL]")
    .slice(0, 1_000);
}
function readText(value: unknown): string {
  const record = asRecord(value);
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = asRecord(choices[0]);
  return String(
    asRecord(first.message).content || first.text || unwrap(value).text || "",
  ).trim();
}
function dataArray(value: unknown): unknown[] {
  const record = asRecord(value);
  return Array.isArray(record.data)
    ? record.data
    : Array.isArray(unwrap(value).data)
      ? (unwrap(value).data as unknown[])
      : [];
}
function readUrls(value: unknown): string[] {
  const record = unwrap(value);
  const candidates = [
    record.video_url,
    record.result_url,
    record.url,
    asRecord(record.content).video_url,
    asRecord(record.content).url,
    ...dataArray(value).flatMap((entry) => {
      const item = asRecord(entry);
      return [item.url, item.video_url, item.result_url];
    }),
  ];
  return [
    ...new Set(
      candidates.filter(
        (entry): entry is string =>
          typeof entry === "string" && /^https?:\/\//i.test(entry),
      ),
    ),
  ];
}
function readBase64(value: unknown): string[] {
  return dataArray(value)
    .map((entry) => asRecord(entry).b64_json)
    .filter((entry): entry is string => typeof entry === "string");
}
