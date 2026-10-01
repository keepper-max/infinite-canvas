import type { ProviderConfig } from "./config.js";
import type { CompiledGenerationRequest } from "./model-gateway.js";
import type { ObjectStorage } from "./object-storage.js";
import {
  ProviderError,
  providerUserMessage,
  type GenerationProvider,
  type ProviderArtifact,
  type ProviderResult,
} from "./provider.js";

export class VolcengineArkProvider implements GenerationProvider {
  constructor(
    private readonly config: ProviderConfig,
    private readonly submitTimeoutMs: number,
    private readonly storage?: ObjectStorage,
  ) {}

  async create(
    request: CompiledGenerationRequest,
    correlationOrSignal?: string | AbortSignal,
    signal?: AbortSignal,
  ): Promise<ProviderResult> {
    this.assertConfigured();
    const correlationId =
      typeof correlationOrSignal === "string" ? correlationOrSignal : undefined;
    const requestSignal =
      correlationOrSignal instanceof AbortSignal ? correlationOrSignal : signal;
    if (request.capability === "text")
      return this.createText(request, correlationId, requestSignal);
    if (request.capability === "image")
      return this.createImage(request, correlationId, requestSignal);
    if (request.capability === "video")
      return this.createVideo(request, correlationId, requestSignal);
    throw new ProviderError(
      "PROVIDER_SCHEMA_UNSUPPORTED",
      "所选模型暂不支持该能力",
      false,
    );
  }

  async get(providerJobId: string, signal?: AbortSignal) {
    const payload = await this.json(
      `/contents/generations/tasks/${encodeURIComponent(providerJobId)}`,
      { method: "GET", signal },
    );
    const status = normalizeStatus(payload);
    const usage = arkUsage(payload, providerJobId);
    if (status === "failed")
      throw new ProviderError(
        "PROVIDER_REJECTED",
        providerUserMessage(readError(payload), "视频生成失败"),
        false,
        { usage: { ...usage, billable: false } },
      );
    if (status !== "completed")
      return { providerJobId, status, progress: 10, usage };
    const url = stringValue(asRecord(asRecord(payload).content).video_url);
    if (!url)
      throw new ProviderError(
        "PROVIDER_RESULT_MISSING",
        "视频任务已完成，但没有返回可用结果",
        true,
        { usage },
      );
    return {
      providerJobId,
      status,
      progress: 100,
      usage,
      artifacts: [{ kind: "video", mimeType: "video/mp4", url }],
    } satisfies ProviderResult;
  }

  async cancel(providerJobId: string, signal?: AbortSignal) {
    const response = await this.raw(
      `/contents/generations/tasks/${encodeURIComponent(providerJobId)}`,
      { method: "DELETE", signal },
    );
    if (!response.ok && ![404, 405, 409].includes(response.status))
      await this.throwResponse(response);
  }

  async fetchVideoContent(
    providerJobId: string,
    range: string,
    signal?: AbortSignal,
  ) {
    const result = await this.get(providerJobId, signal);
    const url = result.artifacts?.[0]?.url;
    if (!url) return new Response(null, { status: 404 });
    return fetch(url, {
      signal,
      headers: { Accept: "video/*,application/octet-stream", Range: range },
    });
  }

  private async createText(
    request: CompiledGenerationRequest,
    correlationId?: string,
    signal?: AbortSignal,
  ) {
    const payload = await this.json(
      "/chat/completions",
      {
        method: "POST",
        signal,
        headers: this.jsonHeaders(correlationId),
        body: JSON.stringify({
          model: request.upstreamModel,
          messages: [{ role: "user", content: request.prompt }],
          ...request.upstreamParameters,
        }),
      },
    );
    const text = readText(payload);
    if (!text)
      throw new ProviderError(
        "PROVIDER_REJECTED",
        "模型没有返回文本结果",
        false,
      );
    return {
      billingTraceId: stringValue(asRecord(payload).id) || correlationId,
      status: "completed" as const,
      usage: arkUsage(payload),
      artifacts: [
        { kind: "text" as const, mimeType: "text/plain; charset=utf-8", text },
      ],
    };
  }

  private async createImage(
    request: CompiledGenerationRequest,
    correlationId?: string,
    signal?: AbortSignal,
  ) {
    const references = await this.referenceUrls(
      request.mode === "i2i" ? request.references || [] : [],
    );
    const parameters = { ...request.upstreamParameters };
    delete parameters.references;
    const payload = await this.json(
      "/images/generations",
      {
        method: "POST",
        signal,
        headers: this.jsonHeaders(correlationId),
        body: JSON.stringify({
          model: request.upstreamModel,
          prompt: request.prompt,
          response_format: "url",
          ...parameters,
          ...(references.length
            ? { image: references.length === 1 ? references[0] : references }
            : {}),
        }),
      },
    );
    const urls = readImageUrls(payload);
    if (!urls.length)
      throw new ProviderError(
        "PROVIDER_RESULT_MISSING",
        "模型没有返回图片结果",
        true,
      );
    return {
      billingTraceId: stringValue(asRecord(payload).id) || correlationId,
      status: "completed" as const,
      usage: {
        ...arkUsage(payload),
        generated_images: urls.length,
        input_images: references.length,
      },
      artifacts: urls.map(
        (url): ProviderArtifact => ({ kind: "image", mimeType: imageMimeType(url), url }),
      ),
    };
  }

  private async createVideo(
    request: CompiledGenerationRequest,
    correlationId?: string,
    signal?: AbortSignal,
  ) {
    const content: Array<Record<string, unknown>> = [
      { type: "text", text: request.prompt },
    ];
    const references = videoReferencesForMode(request);
    for (const reference of references) {
      const url = await this.referenceUrl(reference);
      const mimeType = String(reference.mimeType || "image/jpeg");
      const type = mimeType.startsWith("video/")
        ? "video_url"
        : mimeType.startsWith("audio/")
          ? "audio_url"
          : "image_url";
      const role = /first_frame/.test(reference.role)
        ? "first_frame"
        : /last_frame/.test(reference.role)
          ? "last_frame"
          : type === "video_url"
            ? "reference_video"
            : type === "audio_url"
              ? "reference_audio"
              : "reference_image";
      content.push({ type, [type]: { url }, role });
    }
    const parameters = { ...request.upstreamParameters };
    delete parameters.firstFrame;
    delete parameters.lastFrame;
    delete parameters.references;
    if (references.some((item) => /first_frame|last_frame/.test(item.role)))
      parameters.ratio = "adaptive";
    const payload = await this.json(
      "/contents/generations/tasks",
      {
        method: "POST",
        signal,
        headers: this.jsonHeaders(correlationId),
        body: JSON.stringify({
          model: request.upstreamModel,
          content,
          ...parameters,
        }),
      },
    );
    const id = stringValue(asRecord(payload).id);
    if (!id)
      throw new ProviderError(
        "PROVIDER_REJECTED",
        "模型服务没有返回视频任务编号",
        false,
      );
    const status = normalizeStatus(payload);
    if (status === "failed")
      throw new ProviderError(
        "PROVIDER_REJECTED",
        providerUserMessage(readError(payload), "视频生成失败"),
        false,
      );
    return {
      providerJobId: id,
      billingTraceId: id,
      status,
      progress: 1,
      usage: arkUsage(payload, id),
    };
  }

  private async referenceUrls(
    references: NonNullable<CompiledGenerationRequest["references"]>,
  ) {
    return Promise.all(references.map((reference) => this.referenceUrl(reference)));
  }

  private async referenceUrl(
    reference: NonNullable<CompiledGenerationRequest["references"]>[number],
  ) {
    if (reference.storageKey && this.storage)
      return this.storage.createDownloadUrl(reference.storageKey);
    const source = reference.url || reference.dataUrl;
    if (!source || source.startsWith("asset://"))
      throw new ProviderError(
        "PROVIDER_SCHEMA_UNSUPPORTED",
        "参考素材无法提供给模型服务",
        false,
      );
    return source;
  }

  private jsonHeaders(correlationId?: string) {
    return {
      "content-type": "application/json",
      ...(correlationId ? { "X-Request-ID": correlationId } : {}),
    };
  }

  private async json(path: string, init: RequestInit) {
    const response = await this.raw(path, init);
    if (!response.ok) await this.throwResponse(response);
    return (await response.json()) as unknown;
  }

  private async raw(path: string, init: RequestInit) {
    this.assertConfigured();
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
      throw new ProviderError(
        error instanceof Error && error.name === "TimeoutError"
          ? "PROVIDER_TIMEOUT"
          : "PROVIDER_UNAVAILABLE",
        error instanceof Error && error.name === "TimeoutError"
          ? "模型响应超时，请稍后重试"
          : "模型服务连接失败",
        true,
        { errorName: error instanceof Error ? error.name : "UnknownError" },
      );
    }
  }

  private assertConfigured() {
    if (!this.config.apiKey)
      throw new ProviderError(
        "PROVIDER_AUTH_FAILED",
        "模型服务尚未配置",
        false,
      );
  }

  private async throwResponse(response: Response): Promise<never> {
    const payload = safeJson((await response.text()).slice(0, 2_000));
    const message = readError(payload);
    if ([401, 403].includes(response.status))
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
      providerUserMessage(message, "模型拒绝了当前请求，请检查参数和参考素材"),
      false,
      { status: response.status, upstreamMessage: sanitize(message) },
    );
  }
}

function normalizeStatus(value: unknown): ProviderResult["status"] | "failed" {
  const status = String(asRecord(value).status || "pending").toLowerCase();
  if (["completed", "succeeded", "success", "done"].includes(status))
    return "completed";
  if (["failed", "error", "cancelled", "canceled"].includes(status))
    return "failed";
  return status === "running" ? "running" : "pending";
}

function videoReferencesForMode(request: CompiledGenerationRequest) {
  const references = request.references || [];
  if (request.mode === "t2v") return [];
  if (request.mode === "i2v")
    return references.filter((item) => /first_frame/.test(item.role)).slice(0, 1);
  if (request.mode === "flf2v")
    return references.filter((item) => /first_frame|last_frame/.test(item.role));
  return references;
}

function arkUsage(value: unknown, providerRequestId?: string) {
  const record = asRecord(value);
  const usage = asRecord(record.usage);
  return {
    ...usage,
    ...(providerRequestId ? { provider_request_id: providerRequestId } : {}),
    currency: "CNY",
    billing_amount_source: "volcengine_official_list_price",
  };
}

function readText(value: unknown) {
  const choices = Array.isArray(asRecord(value).choices)
    ? (asRecord(value).choices as unknown[])
    : [];
  const first = asRecord(choices[0]);
  return String(asRecord(first.message).content || first.text || "").trim();
}

function readImageUrls(value: unknown) {
  const data = Array.isArray(asRecord(value).data)
    ? (asRecord(value).data as unknown[])
    : [];
  return data.flatMap((item) => {
    const url = stringValue(asRecord(item).url);
    return url ? [url] : [];
  });
}

function imageMimeType(url: string) {
  try {
    const extension = new URL(url).pathname.split(".").pop()?.toLowerCase();
    if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
    if (extension === "webp") return "image/webp";
  } catch {
    // Provider URLs are validated by the download stage; use the documented default here.
  }
  return "image/png";
}

function readError(value: unknown) {
  const record = asRecord(value);
  const error = asRecord(record.error);
  return String(error.message || record.message || "").trim();
}

function sanitize(value: string) {
  return value
    .replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/https?:\/\/\S+/gi, "[URL]")
    .slice(0, 1_000);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return { message: value };
  }
}
