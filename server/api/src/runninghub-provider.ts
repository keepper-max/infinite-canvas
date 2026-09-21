import type { RunningHubConfig } from "./config.js";
import type { CompiledGenerationRequest } from "./model-gateway.js";
import {
  ProviderError,
  providerUserMessage,
  type GenerationProvider,
  type ProviderArtifact,
  type ProviderResult,
} from "./provider.js";

type RegistryParameter = {
  fieldKey: string;
  type: string;
  required?: boolean;
  multipleInputs?: boolean;
};

export class RunningHubProvider implements GenerationProvider {
  constructor(
    private readonly config: RunningHubConfig,
    private readonly submitTimeoutMs: number,
  ) {}

  async create(
    request: CompiledGenerationRequest,
    _correlationOrSignal?: string | AbortSignal,
    signal?: AbortSignal,
  ): Promise<ProviderResult> {
    const requestSignal =
      _correlationOrSignal instanceof AbortSignal
        ? _correlationOrSignal
        : signal;
    if (!this.config.apiKey)
      throw new ProviderError(
        "PROVIDER_AUTH_FAILED",
        "海马云服务尚未配置",
        false,
      );
    const metadata = asRecord(request.providerMetadata);
    const parameters = registryParameters(metadata.params);
    const body: Record<string, unknown> = { ...request.upstreamParameters };
    delete body.references;
    delete body.firstFrame;
    delete body.lastFrame;
    const promptField = findPromptField(parameters);
    if (promptField) body[promptField.fieldKey] = request.prompt;
    else if (request.prompt.trim())
      throw new ProviderError(
        "PROVIDER_SCHEMA_UNSUPPORTED",
        "该海马云模型没有可识别的文本输入字段",
        false,
      );
    await this.attachMedia(
      body,
      parameters,
      request.references || [],
      requestSignal,
    );
    normalizeRunningHubImageParameters(request.upstreamModel, body);
    if (
      request.upstreamModel.endsWith(
        "bytedance/seedance-2.5-token/multimodal-video",
      ) &&
      body.conversionSlots === undefined
    )
      body.conversionSlots = ["all"];
    if (typeof body.conversionSlots === "string")
      body.conversionSlots = [body.conversionSlots];
    const payload = await this.json(
      `/${request.upstreamModel.replace(/^\/+/, "")}`,
      body,
      requestSignal,
    );
    const taskId = readTaskId(payload);
    if (!taskId)
      throw new ProviderError(
        "PROVIDER_REJECTED",
        "海马云没有返回任务编号",
        false,
      );
    return { providerJobId: taskId, status: "pending", progress: 1 };
  }

  async get(
    providerJobId: string,
    signal?: AbortSignal,
    capability?: CompiledGenerationRequest["capability"],
  ): Promise<ProviderResult> {
    const payload = await this.json(
      "/query",
      { taskId: providerJobId },
      signal,
    );
    const usage = runningHubUsage(payload, providerJobId);
    const status = normalizeStatus(payload);
    if (status === "failed")
      throw new ProviderError(
        "PROVIDER_REJECTED",
        providerUserMessage(readError(payload), "海马云生成失败"),
        false,
        { upstreamMessage: sanitize(readError(payload)), usage },
      );
    if (status !== "completed")
      return {
        providerJobId,
        status,
        progress: readProgress(payload),
        ...(Object.keys(usage).length ? { usage } : {}),
      };
    const artifacts = readArtifacts(payload, capability);
    if (!artifacts.length)
      throw new ProviderError(
        "PROVIDER_RESULT_MISSING",
        "海马云任务已完成，但没有返回可用结果",
        true,
        { usage },
      );
    return {
      providerJobId,
      status,
      progress: 100,
      artifacts,
      ...(Object.keys(usage).length ? { usage } : {}),
    };
  }

  async cancel(_providerJobId: string, _signal?: AbortSignal) {
    // The public v2 contract does not currently advertise a cancellation API.
  }

  async fetchVideoContent(
    _providerJobId: string,
    _range: string,
    _signal?: AbortSignal,
  ) {
    return new Response(null, { status: 404 });
  }

  private async attachMedia(
    body: Record<string, unknown>,
    parameters: RegistryParameter[],
    references: NonNullable<CompiledGenerationRequest["references"]>,
    signal?: AbortSignal,
  ) {
    const mediaParameters = parameters.filter((item) =>
      ["IMAGE", "VIDEO", "AUDIO"].includes(item.type),
    );
    if (!references.length) return;
    const uploaded = await Promise.all(
      references.map(async (reference) => ({
        reference,
        url: await this.uploadReference(reference, signal),
      })),
    );
    for (const type of ["IMAGE", "VIDEO", "AUDIO"] as const) {
      const candidates = uploaded.filter(({ reference }) =>
        referenceMimeType(reference).startsWith(type.toLowerCase()),
      );
      if (!candidates.length) continue;
      const fields = mediaParameters.filter((item) => item.type === type);
      if (!fields.length)
        throw new ProviderError(
          "PROVIDER_SCHEMA_UNSUPPORTED",
          `所选海马云模型不接受${mediaLabel(type)}参考素材`,
          false,
        );
      const remaining = [...candidates];
      for (const field of fields) {
        const rolePattern = /first|start/i.test(field.fieldKey)
          ? /first_frame/
          : /last|end/i.test(field.fieldKey)
            ? /last_frame/
            : null;
        const matched = rolePattern
          ? remaining.filter(({ reference }) =>
              rolePattern.test(reference.role),
            )
          : remaining;
        if (!matched.length) continue;
        const selected = field.multipleInputs ? matched : [matched[0]!];
        body[field.fieldKey] = field.multipleInputs
          ? selected.map((item) => item.url)
          : selected[0]!.url;
        for (const item of selected)
          remaining.splice(remaining.indexOf(item), 1);
      }
      if (remaining.length)
        throw new ProviderError(
          "PROVIDER_SCHEMA_UNSUPPORTED",
          `参考${mediaLabel(type)}数量或角色与海马云模型不匹配`,
          false,
        );
    }
  }

  private async uploadReference(
    reference: NonNullable<CompiledGenerationRequest["references"]>[number],
    signal?: AbortSignal,
  ) {
    const source = reference.url || reference.dataUrl;
    if (!source)
      throw new ProviderError(
        "PROVIDER_UPLOAD_FAILED",
        "参考素材缺少可上传内容",
        false,
      );
    const response = await fetch(source, { signal });
    if (!response.ok)
      throw new ProviderError(
        "PROVIDER_UPLOAD_FAILED",
        "读取参考素材失败",
        true,
        { status: response.status },
      );
    const form = new FormData();
    const blob = await response.blob();
    form.append("file", blob, `reference.${extensionFor(blob.type)}`);
    const payload = await this.request("/media/upload/binary", {
      method: "POST",
      body: form,
      signal,
    });
    const url = String(asRecord(unwrap(payload)).download_url || "");
    if (!/^https?:\/\//i.test(url))
      throw new ProviderError(
        "PROVIDER_UPLOAD_FAILED",
        "海马云没有返回素材地址",
        true,
      );
    return url;
  }

  private json(path: string, body: unknown, signal?: AbortSignal) {
    return this.request(path, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      signal,
    });
  }

  private async request(path: string, init: RequestInit) {
    const timeout =
      this.submitTimeoutMs > 0
        ? AbortSignal.timeout(this.submitTimeoutMs)
        : undefined;
    const signal =
      init.signal && timeout
        ? AbortSignal.any([init.signal, timeout])
        : init.signal || timeout;
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
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
        "PROVIDER_UNAVAILABLE",
        "海马云服务连接失败",
        true,
        { errorName: error instanceof Error ? error.name : "UnknownError" },
      );
    }
    const text = await response.text();
    const payload = safeJson(text);
    const root = asRecord(payload);
    if (
      !response.ok ||
      Number(root.code || 0) !== 0 ||
      Boolean(
        root.errorCode ||
        root.error_code ||
        root.errorMessage ||
        root.error_message,
      )
    )
      this.throwResponse(response.status, payload);
    return payload;
  }

  private throwResponse(status: number, payload: unknown): never {
    const message = readError(payload);
    if (status === 401 || status === 403)
      throw new ProviderError(
        "PROVIDER_AUTH_FAILED",
        "海马云服务授权失败",
        false,
      );
    if (status === 429)
      throw new ProviderError(
        "PROVIDER_RATE_LIMITED",
        "海马云服务繁忙，请稍后重试",
        true,
      );
    if (status >= 500)
      throw new ProviderError(
        "PROVIDER_UNAVAILABLE",
        "海马云服务暂时不可用",
        true,
      );
    throw new ProviderError(
      "PROVIDER_REJECTED",
      providerUserMessage(
        message,
        "海马云拒绝了当前请求，请检查参数和参考素材",
      ),
      false,
      { status, upstreamMessage: sanitize(message) },
    );
  }
}

function registryParameters(value: unknown): RegistryParameter[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const row = asRecord(item);
        const fieldKey = String(row.fieldKey || "");
        const type = String(row.type || "").toUpperCase();
        return fieldKey && type
          ? [
              {
                fieldKey,
                type,
                required: row.required === true,
                multipleInputs: row.multipleInputs === true,
              },
            ]
          : [];
      })
    : [];
}

function normalizeRunningHubImageParameters(
  upstreamModel: string,
  body: Record<string, unknown>,
) {
  if (!upstreamModel.startsWith("rhart-image-g-2.5-official-token/")) return;
  const match = String(body.size || "").match(/^(\d+)x(\d+)$/i);
  delete body.size;
  if (!match) return;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return;
  const supported = [
    "1:1",
    "2:3",
    "3:2",
    "4:3",
    "3:4",
    "16:9",
    "9:16",
    "21:9",
    "9:21",
  ];
  const ratio = width / height;
  body.aspectRatio = supported.reduce((best, candidate) => {
    const [candidateWidth, candidateHeight] = candidate.split(":").map(Number);
    const [bestWidth, bestHeight] = best.split(":").map(Number);
    return Math.abs(candidateWidth! / candidateHeight! - ratio) <
      Math.abs(bestWidth! / bestHeight! - ratio)
      ? candidate
      : best;
  }, "1:1");
  const longEdge = Math.max(width, height);
  body.resolution = longEdge > 3_000 ? "4k" : longEdge > 2_200 ? "2k" : "1k";
}

function findPromptField(parameters: RegistryParameter[]) {
  const names = ["prompt", "text_prompt", "text", "content", "lyrics"];
  return names
    .map((name) =>
      parameters.find(
        (item) => item.type === "STRING" && item.fieldKey === name,
      ),
    )
    .find(Boolean);
}

function readTaskId(value: unknown) {
  const record = asRecord(unwrap(value));
  return [record.taskId, record.task_id].find(
    (item): item is string => typeof item === "string" && Boolean(item),
  );
}

function normalizeStatus(value: unknown): ProviderResult["status"] | "failed" {
  const status = String(
    asRecord(unwrap(value)).status || "CREATE",
  ).toUpperCase();
  if (status === "SUCCESS") return "completed";
  if (["FAILED", "CANCEL", "CANCELLED"].includes(status)) return "failed";
  return status === "RUNNING" ? "running" : "pending";
}

function readProgress(value: unknown) {
  const progress = Number(asRecord(unwrap(value)).progress || 0);
  return Number.isFinite(progress) ? Math.max(1, Math.min(99, progress)) : 1;
}

function readArtifacts(
  value: unknown,
  capability?: CompiledGenerationRequest["capability"],
): ProviderArtifact[] {
  const root = asRecord(unwrap(value));
  const results = Array.isArray(root.results) ? root.results : [];
  const artifacts: ProviderArtifact[] = [];
  for (const result of results) {
    const item = asRecord(result);
    const url = [item.url, item.outputUrl, item.output].find(
      (entry): entry is string =>
        typeof entry === "string" && /^https?:\/\//i.test(entry),
    );
    if (url) {
      const kind =
        capability && capability !== "text" ? capability : mediaKind(url);
      artifacts.push({ kind, mimeType: mimeType(url, kind), url });
    }
    const text = [item.text, item.content, item.output].find(
      (entry): entry is string =>
        typeof entry === "string" && !/^https?:\/\//i.test(entry),
    );
    if (text)
      artifacts.push({
        kind: "text",
        mimeType: "text/plain; charset=utf-8",
        text,
      });
  }
  return artifacts;
}

function readError(value: unknown) {
  const root = asRecord(value);
  const data = asRecord(unwrap(value));
  return String(
    root.errorMessage ||
      root.error_message ||
      root.message ||
      root.msg ||
      data.errorMessage ||
      data.error_message ||
      data.message ||
      data.error ||
      root.errorCode ||
      root.error_code ||
      "",
  );
}

export function runningHubUsage(
  value: unknown,
  providerJobId?: string,
): Record<string, unknown> {
  const envelope = asRecord(value);
  const data = asRecord(unwrap(value));
  const billing = asRecord(data.usage || envelope.usage);
  const tokenUsage = asRecord(billing.tokenUsage || data.tokenUsage);
  const tokens = asRecord(tokenUsage.usage || billing.token_usage);
  const values: Record<string, unknown> = {
    provider_request_id:
      providerJobId || stringValue(data.taskId) || stringValue(data.task_id),
    third_party_consume_money:
      billing.thirdPartyConsumeMoney ?? data.thirdPartyConsumeMoney,
    consume_money: billing.consumeMoney ?? data.consumeMoney,
    consume_coins: billing.consumeCoins ?? data.consumeCoins,
    task_cost_time: billing.taskCostTime ?? data.taskCostTime,
    billing_seconds: billing.billingSeconds ?? data.billingSeconds,
    prompt_tokens: tokens.prompt_tokens,
    completion_tokens: tokens.completion_tokens,
    total_tokens: tokens.total_tokens,
    currency: billing.currency ?? data.currency,
  };
  return Object.fromEntries(
    Object.entries(values).filter(
      ([, item]) => item !== undefined && item !== null && item !== "",
    ),
  );
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function unwrap(value: unknown) {
  const record = asRecord(value);
  return record.data ?? record;
}
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return { message: value };
  }
}
function sanitize(value: string) {
  return value.replace(/bearer\s+\S+/gi, "Bearer [REDACTED]").slice(0, 1_000);
}
function referenceMimeType(
  reference: NonNullable<CompiledGenerationRequest["references"]>[number],
) {
  if (reference.mimeType) return reference.mimeType;
  if (/\.(mp4|mov|webm)(?:\?|$)/i.test(reference.url || "")) return "video/mp4";
  if (/\.(mp3|wav|ogg)(?:\?|$)/i.test(reference.url || "")) return "audio/mpeg";
  return "image/png";
}
function mediaLabel(type: "IMAGE" | "VIDEO" | "AUDIO") {
  return type === "IMAGE" ? "图片" : type === "VIDEO" ? "视频" : "音频";
}
function extensionFor(mime: string) {
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("video")) return "mp4";
  if (mime.includes("audio")) return "mp3";
  return "png";
}
function mediaKind(url: string): ProviderArtifact["kind"] {
  if (/\.(mp4|mov|webm)(?:\?|$)/i.test(url)) return "video";
  if (/\.(mp3|wav|ogg)(?:\?|$)/i.test(url)) return "audio";
  return "image";
}
function mimeType(url: string, knownKind?: ProviderArtifact["kind"]) {
  const kind = knownKind || mediaKind(url);
  return kind === "video"
    ? "video/mp4"
    : kind === "audio"
      ? "audio/mpeg"
      : "image/png";
}
