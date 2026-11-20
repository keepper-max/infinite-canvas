import type { ProviderConfig } from "./config.js";
import type { CompiledGenerationRequest } from "./model-gateway.js";
import type { ObjectStorage } from "./object-storage.js";
import { DomainError } from "./domain.js";
import { fetchRemoteMedia } from "./remote-media.js";
import { ProviderError, readBillingTrace, type GenerationProvider, type ProviderArtifact, type ProviderResult } from "./provider.js";
import { VolcengineArkProvider } from "./volcengine-ark-provider.js";

export const WANGSU_IMAGE_MODELS = ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"] as const;

export class WangsuProvider implements GenerationProvider {
  private readonly video: VolcengineArkProvider;
  constructor(private readonly config: ProviderConfig, private readonly submitTimeoutMs: number, private readonly storage?: ObjectStorage) {
    this.video = new VolcengineArkProvider(config, submitTimeoutMs, storage, "wangsu_model_catalog", false);
  }

  async create(request: CompiledGenerationRequest, correlationOrSignal?: string | AbortSignal, signal?: AbortSignal): Promise<ProviderResult> {
    if (request.capability === "video") return this.video.create(request, correlationOrSignal, signal);
    if (request.capability !== "image" || !WANGSU_IMAGE_MODELS.includes(request.upstreamModel as typeof WANGSU_IMAGE_MODELS[number]) || !["t2i", "i2i"].includes(request.mode))
      throw new ProviderError("PROVIDER_SCHEMA_UNSUPPORTED", "网宿暂不支持该模型或生成模式", false);
    if (!this.config.apiKey) throw new ProviderError("PROVIDER_AUTH_FAILED", "模型服务尚未配置", false);
    const correlationId = typeof correlationOrSignal === "string" ? correlationOrSignal : undefined;
    const externalSignal = correlationOrSignal instanceof AbortSignal ? correlationOrSignal : signal;
    const timeout = this.submitTimeoutMs > 0 ? AbortSignal.timeout(this.submitTimeoutMs) : undefined;
    const requestSignal = externalSignal && timeout ? AbortSignal.any([externalSignal, timeout]) : externalSignal || timeout;
    try {
      const parameters = { ...request.upstreamParameters };
      delete parameters.references;
      const body = { ...parameters, model: request.upstreamModel, prompt: request.prompt };
      let form: FormData | undefined;
      if (request.mode === "i2i") {
        if (!request.references?.length) throw new ProviderError("PROVIDER_SCHEMA_UNSUPPORTED", "图片编辑需要参考图片", false);
        form = new FormData();
        for (const [key, value] of Object.entries(body)) if (value !== undefined && value !== null) form.append(key, String(value));
        for (const [index, reference] of request.references.entries()) {
          let response: Response;
          if (reference.storageKey && this.storage) {
            const download = await this.storage.openDownload(reference.storageKey, undefined, requestSignal);
            response = new Response(download.body, { headers: { "content-type": download.mimeType } });
          } else {
            const url = reference.url || reference.dataUrl;
            if (!url) throw new ProviderError("PROVIDER_UPLOAD_FAILED", "参考图片缺少内容", false);
            response = await fetchRemoteMedia(url, { signal: requestSignal });
          }
          if (!response.ok) throw new ProviderError("PROVIDER_UPLOAD_FAILED", "读取参考图片失败", true);
          const blob = await response.blob();
          if (!blob.type.startsWith("image/")) throw new ProviderError("PROVIDER_SCHEMA_UNSUPPORTED", "图片编辑仅支持图片参考", false);
          const extension = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png";
          form.append(request.references.length === 1 ? "image" : "image[]", blob, `reference-${index}.${extension}`);
        }
      }
      const response = await fetch(`${this.config.baseUrl.replace(/\/doubao\/?$/, "")}/images/${form ? "edits" : "generations"}`, {
        method: "POST", signal: requestSignal, body: form || JSON.stringify(body),
        headers: { Authorization: `Bearer ${this.config.apiKey}`, Accept: "application/json", ...(form ? {} : { "content-type": "application/json" }), ...(correlationId ? { "X-Request-ID": correlationId } : {}) },
      });
      if (!response.ok) {
        const code = [401, 403].includes(response.status) ? "PROVIDER_AUTH_FAILED" : response.status === 429 ? "PROVIDER_RATE_LIMITED" : response.status >= 500 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REJECTED";
        throw new ProviderError(code, code === "PROVIDER_AUTH_FAILED" ? "模型服务授权失败" : "网宿图片请求失败，请检查参数或稍后重试", response.status === 429 || response.status >= 500, { status: response.status });
      }
      const payload = await response.json() as Record<string, unknown>;
      const requestId = typeof payload.id === "string" ? payload.id : undefined;
      const trace = readBillingTrace(response, requestId, correlationId);
      const usage = { ...record(payload.usage), currency: "USD", billing_amount_source: "wangsu_model_catalog", ...(trace ? { provider_request_id: trace } : {}) };
      const format = String(payload.output_format || parameters.output_format || "png");
      const mimeType = format === "jpeg" || format === "jpg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
      const artifacts = (Array.isArray(payload.data) ? payload.data : []).flatMap<ProviderArtifact>((value) => {
        const image = record(value);
        if (typeof image.b64_json === "string" && image.b64_json) {
          const bytes = new Uint8Array(Buffer.from(image.b64_json, "base64"));
          return bytes.length ? [{ kind: "image" as const, mimeType, bytes }] : [];
        }
        return typeof image.url === "string" && image.url ? [{ kind: "image" as const, mimeType, url: image.url }] : [];
      });
      if (!artifacts.length) throw new ProviderError("PROVIDER_RESULT_MISSING", "网宿没有返回可用图片", false, { usage, billingTraceId: trace });
      return { status: "completed", billingTraceId: trace, usage: { ...usage, generated_images: artifacts.length }, artifacts };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof DomainError && error.code === "UNSAFE_MEDIA_URL") throw new ProviderError(error.code, error.message, false);
      throw new ProviderError(error instanceof Error && error.name === "TimeoutError" ? "PROVIDER_TIMEOUT" : "PROVIDER_UNAVAILABLE", "网宿图片请求未完成，请检查任务状态", true);
    }
  }

  get(id: string, signal?: AbortSignal) { return this.video.get(id, signal); }
  cancel(id: string, signal?: AbortSignal) { return this.video.cancel(id, signal); }
  fetchVideoContent(id: string, range: string, signal?: AbortSignal) { return this.video.fetchVideoContent(id, range, signal); }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
