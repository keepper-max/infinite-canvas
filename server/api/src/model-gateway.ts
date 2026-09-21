import type { Pool } from "pg";

import { DomainError } from "./domain.js";

export type Capability = "text" | "image" | "video" | "audio";
export type GenerationMode =
  "chat" | "t2i" | "i2i" | "tts" | "t2v" | "i2v" | "flf2v" | "multiref";
export type ModelDefinition = {
  id: string;
  displayName: string;
  capability: Capability;
  upstreamModel: string;
  providerId: string;
  modes: GenerationMode[];
  acceptedParameters: string[];
  requiredParametersByMode: Partial<Record<GenerationMode, string[]>>;
  limits: Record<string, unknown>;
  parameterMap: Record<string, string>;
};

export type PublicModelParameter = {
  key: string;
  type: "boolean" | "string" | "integer" | "number";
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: Array<string | number | boolean>;
  min?: number;
  max?: number;
  step?: number;
};

export type GenerationInput = {
  modelId: string;
  capability: Capability;
  mode: GenerationMode;
  prompt: string;
  parameters?: Record<string, unknown>;
  references?: Array<{
    role: string;
    url?: string;
    dataUrl?: string;
    assetVersionId?: string;
    virtualPortraitId?: string;
    mimeType?: string;
  }>;
  trace?: {
    workflowKind?: string;
    skillId?: string;
    skillVersion?: string;
    inputHash?: string;
    outputRevision?: number;
    userModified?: boolean;
    inputSnapshot?: Record<string, unknown>;
    assetKind?: "character" | "scene" | "prop" | "image" | "video" | "audio";
    assetName?: string;
  };
};

export type CompiledGenerationRequest = GenerationInput & {
  upstreamModel: string;
  providerId: string;
  upstreamParameters: Record<string, unknown>;
  providerMetadata?: Record<string, unknown>;
};

type CatalogCapabilityProfile = Pick<
  ModelDefinition,
  | "capability"
  | "modes"
  | "acceptedParameters"
  | "requiredParametersByMode"
  | "limits"
  | "parameterMap"
>;

export class ModelGateway {
  constructor(private readonly pool: Pool) {}

  async refreshCatalog(catalogUrl: string) {
    const response = await fetch(catalogUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new Error(`Model catalog returned ${response.status}`);
    const payload = (await response.json()) as unknown;
    const candidates = catalogItems(payload);
    await this.pool.query(
      "update model_catalog set discovered=false,healthy=false,checked_at=now(),updated_at=now() where provider_id='token360'",
    );
    for (const candidate of candidates) {
      const name = String(
        candidate.id || candidate.model || candidate.name || "",
      ).trim();
      if (!name) continue;
      const profile = catalogModelProfile(candidate);
      const displayName = String(candidate.displayName || name).trim();
      const known = await this.pool.query(
        "update model_catalog set display_name=$2,discovered=true,healthy=true,catalog_metadata=$3,discovered_at=now(),checked_at=now(),updated_at=now() where upstream_model=$1 returning id",
        [name, displayName, sanitizeCatalogEntry(candidate)],
      );
      let id = String(known.rows[0]?.id || "");
      if (!profile) {
        if (id.startsWith("catalog."))
          await this.pool.query(
            "update model_catalog set enabled=false,healthy=false,updated_at=now() where id=$1",
            [id],
          );
        continue;
      }
      if (!id) {
        id = `catalog.${profile.capability}.${createSlug(name)}`.slice(0, 190);
        await this.pool.query(
          `insert into model_catalog(id,display_name,capability,upstream_model,provider_id,discovered,enabled,healthy,catalog_metadata,discovered_at,checked_at)
                    values($1,$2,$3,$4,'token360',true,true,true,$5,now(),now())
                    on conflict(id) do update set display_name=excluded.display_name,capability=excluded.capability,upstream_model=excluded.upstream_model,catalog_metadata=excluded.catalog_metadata,discovered=true,enabled=true,healthy=true,discovered_at=now(),checked_at=now(),updated_at=now()`,
          [
            id,
            displayName,
            profile.capability,
            name,
            sanitizeCatalogEntry(candidate),
          ],
        );
      }
      if (id.startsWith("catalog.")) {
        await this.pool.query(
          "update model_catalog set enabled=true,healthy=true,updated_at=now() where id=$1",
          [id],
        );
      }
      if (id.startsWith("catalog.") || profile.capability === "video")
        await this.upsertCatalogProfile(id, profile);
    }
    return candidates.length;
  }

  async refreshRunningHubCatalog(catalogUrl: string) {
    const response = await fetch(catalogUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error(`RunningHub model registry returned ${response.status}`);
    const payload = (await response.json()) as unknown;
    const candidates = catalogItems(payload);
    await this.pool.query(
      "update model_catalog set discovered=false,healthy=false,checked_at=now(),updated_at=now() where provider_id='runninghub'",
    );
    let imported = 0;
    for (const candidate of candidates) {
      const endpoint = String(candidate.endpoint || "").trim();
      const profile = runningHubModelProfile(candidate);
      if (!endpoint) continue;
      const capability =
        profile?.capability ||
        String(candidate.output_type || "unsupported").toLowerCase();
      const id = `runninghub.${capability}.${createSlug(endpoint)}`.slice(
        0,
        190,
      );
      const displayName = runningHubDisplayName(candidate, endpoint);
      const metadata = sanitizeRunningHubEntry(candidate);
      await this.pool.query(
        `insert into model_catalog(id,display_name,capability,upstream_model,provider_id,discovered,enabled,healthy,catalog_metadata,discovered_at,checked_at)
         values($1,$2,$3,$4,'runninghub',true,$6,true,$5,now(),now())
         on conflict(id) do update set display_name=excluded.display_name,capability=excluded.capability,
          upstream_model=excluded.upstream_model,provider_id='runninghub',catalog_metadata=excluded.catalog_metadata,
          discovered=true,enabled=excluded.enabled,healthy=true,discovered_at=now(),checked_at=now(),updated_at=now()`,
        [id, displayName, capability, endpoint, metadata, Boolean(profile)],
      );
      if (profile) await this.upsertCatalogProfile(id, profile);
      imported += 1;
    }
    return imported;
  }

  private async upsertCatalogProfile(
    id: string,
    profile: CatalogCapabilityProfile,
  ) {
    await this.pool.query(
      `insert into model_capabilities(model_id,modes,accepted_parameters,required_parameters_by_mode,limits,parameter_map)
       values($1,$2,$3,$4,$5,$6)
       on conflict(model_id) do update set modes=excluded.modes,accepted_parameters=excluded.accepted_parameters,
       required_parameters_by_mode=excluded.required_parameters_by_mode,limits=excluded.limits,
       parameter_map=excluded.parameter_map,updated_at=now()`,
      [
        id,
        JSON.stringify(profile.modes),
        JSON.stringify(profile.acceptedParameters),
        JSON.stringify(profile.requiredParametersByMode),
        JSON.stringify(profile.limits),
        JSON.stringify(profile.parameterMap),
      ],
    );
  }

  async listPublicModels(): Promise<
    Array<
      Omit<ModelDefinition, "upstreamModel" | "providerId" | "parameterMap"> & {
        parameters: PublicModelParameter[];
        defaults: Record<string, unknown>;
      }
    >
  > {
    const result = await this.pool
      .query(`select c.id, c.display_name, c.capability, c.catalog_metadata,
                    p.modes, p.accepted_parameters, p.required_parameters_by_mode, p.limits
            from model_catalog c join model_capabilities p on p.model_id = c.id
            where c.enabled = true and c.healthy = true
              and c.provider_id=coalesce(
                (select value->>'providerId' from platform_settings where key='managed_provider'),
                'token360'
              )
            order by c.capability, c.display_name`);
    return result.rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      capability: row.capability,
      modes: row.modes || [],
      acceptedParameters: row.accepted_parameters || [],
      requiredParametersByMode: row.required_parameters_by_mode || {},
      limits: row.limits || {},
      parameters: publicParameterSchema(row.catalog_metadata),
      defaults: publicParameterDefaults(row.catalog_metadata),
    }));
  }

  async compile(input: GenerationInput): Promise<CompiledGenerationRequest> {
    const result = await this.pool.query(
      `select c.id, c.display_name, c.capability, c.upstream_model, c.provider_id,c.catalog_metadata,
            p.modes, p.accepted_parameters, p.required_parameters_by_mode, p.limits, p.parameter_map
            from model_catalog c join model_capabilities p on p.model_id = c.id
            where c.id = $1 and c.enabled = true and c.healthy = true`,
      [input.modelId],
    );
    const row = result.rows[0];
    if (!row)
      throw new DomainError("MODEL_NOT_AVAILABLE", "所选模型当前不可用", 422);
    if (row.capability !== input.capability)
      throw new DomainError(
        "MODEL_CAPABILITY_MISMATCH",
        "所选模型不支持当前节点",
        422,
      );
    const modes = arrayOfStrings(row.modes);
    if (!modes.includes(input.mode))
      throw new DomainError(
        "MODE_NOT_SUPPORTED",
        "所选模型不支持当前生成模式",
        422,
      );
    const promptLimit = Number(row.limits?.maxPromptChars || 0);
    if (!input.prompt.trim())
      throw new DomainError("PROMPT_REQUIRED", "请输入生成内容", 422);
    if (promptLimit && input.prompt.length > promptLimit)
      throw new DomainError(
        "INVALID_MODEL_PARAMETER",
        `提示词不能超过 ${promptLimit} 个字符`,
        422,
      );
    const references = Array.isArray(input.references) ? input.references : [];
    const videoExtension = isSeedanceVideoExtension(
      row.upstream_model,
      input,
      references,
    );
    const effectiveParameters = {
      ...publicParameterDefaults(row.catalog_metadata),
      ...(input.parameters || {}),
    };
    validateModelLimits(
      row.limits,
      videoExtension
        ? { ...effectiveParameters, aspectRatio: undefined }
        : effectiveParameters,
      references,
      input.mode,
    );
    const parameterSource: Record<string, unknown> = {
      ...effectiveParameters,
    };
    if (videoExtension) parameterSource.aspectRatio = "adaptive";
    const byRole = new Map(
      references.map((reference) => [reference.role, reference]),
    );
    if (byRole.has("first_frame"))
      parameterSource.firstFrame = byRole.get("first_frame");
    if (byRole.has("last_frame"))
      parameterSource.lastFrame = byRole.get("last_frame");
    if (references.length) parameterSource.references = references;
    for (const required of arrayOfStrings(
      row.required_parameters_by_mode?.[input.mode],
    )) {
      if (
        parameterSource[required] === undefined ||
        parameterSource[required] === null
      )
        throw new DomainError(
          "INVALID_MODEL_PARAMETER",
          `当前模式缺少必要输入：${humanParameter(required)}`,
          422,
        );
    }
    if (input.mode !== "multiref") delete parameterSource.omniReferenceTaskType;
    if (input.mode === "t2v") {
      delete parameterSource.firstFrame;
      delete parameterSource.lastFrame;
      delete parameterSource.references;
    } else if (input.mode === "i2v") {
      delete parameterSource.lastFrame;
      delete parameterSource.references;
    } else if (input.mode === "flf2v") {
      delete parameterSource.references;
    }
    const accepted = new Set(arrayOfStrings(row.accepted_parameters));
    const parameterMap = isRecord(row.parameter_map)
      ? (row.parameter_map as Record<string, string>)
      : {};
    const upstreamParameters: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parameterSource)) {
      if (accepted.has(key) && value !== undefined && value !== "")
        upstreamParameters[parameterMap[key] || key] = value;
    }
    return {
      ...input,
      references,
      upstreamModel: row.upstream_model,
      providerId: row.provider_id,
      upstreamParameters,
      providerMetadata:
        row.provider_id === "runninghub" && isRecord(row.catalog_metadata)
          ? row.catalog_metadata
          : undefined,
    };
  }
}

export function runningHubModelProfile(
  candidate: Record<string, unknown>,
): CatalogCapabilityProfile | null {
  const capability = normalizeCapability(
    candidate.output_type === "string" ? "text" : candidate.output_type,
  );
  if (!capability) return null;
  const params = runningHubParameters(candidate.params);
  const scalar = params.filter(
    (item) =>
      !["IMAGE", "VIDEO", "AUDIO"].includes(item.sourceType) &&
      !isPromptField(item.upstreamKey),
  );
  const media = params.filter((item) =>
    ["IMAGE", "VIDEO", "AUDIO"].includes(item.sourceType),
  );
  if (!params.some((item) => isPromptField(item.upstreamKey))) return null;
  if (capability === "text" && media.some((item) => item.required)) return null;
  const acceptedParameters = scalar.map((item) => item.key);
  const parameterMap = Object.fromEntries(
    scalar.map((item) => [item.key, item.upstreamKey]),
  );
  const modes: GenerationMode[] = [];
  const requiredParametersByMode: Partial<Record<GenerationMode, string[]>> =
    {};
  if (capability === "text") modes.push("chat");
  if (capability === "audio") modes.push("tts");
  if (capability === "image") {
    const images = media.filter((item) => item.sourceType === "IMAGE");
    if (!images.some((item) => item.required)) modes.push("t2i");
    if (images.length) {
      modes.push("i2i");
      acceptedParameters.push("references");
      if (images.some((item) => item.required))
        requiredParametersByMode.i2i = ["references"];
    }
  }
  if (capability === "video") {
    const images = media.filter((item) => item.sourceType === "IMAGE");
    const videos = media.filter((item) => item.sourceType === "VIDEO");
    const audios = media.filter((item) => item.sourceType === "AUDIO");
    if (!media.some((item) => item.required)) modes.push("t2v");
    if (images.length) {
      const supportsMultiple = images.some((item) => item.multipleInputs);
      modes.push(
        supportsMultiple ? "multiref" : images.length > 1 ? "flf2v" : "i2v",
      );
      acceptedParameters.push("references", "firstFrame");
      if (images.length > 1) acceptedParameters.push("lastFrame");
      if (supportsMultiple) requiredParametersByMode.multiref = ["references"];
      else if (images.length > 1)
        requiredParametersByMode.flf2v = ["firstFrame", "lastFrame"];
      else requiredParametersByMode.i2v = ["firstFrame"];
    }
    if (videos.length || audios.length) {
      if (!modes.includes("multiref")) modes.push("multiref");
      if (!acceptedParameters.includes("references"))
        acceptedParameters.push("references");
      if (media.some((item) => item.required))
        requiredParametersByMode.multiref = ["references"];
    }
    if (!modes.length) modes.push("t2v");
  }
  const parameterSchema = scalar.map((item) => item.publicDefinition);
  const imageLimit = maximumInputCount(media, "IMAGE", 9);
  const videoLimit = maximumInputCount(media, "VIDEO", 3);
  const audioLimit = maximumInputCount(media, "AUDIO", 3);
  const promptLimit = Math.max(
    1,
    ...params
      .filter((item) => isPromptField(item.upstreamKey))
      .map((item) => item.max || 20_000),
  );
  return {
    capability,
    modes: Array.from(new Set(modes)),
    acceptedParameters: Array.from(new Set(acceptedParameters)),
    requiredParametersByMode,
    limits: {
      maxImages: imageLimit,
      maxVideos: videoLimit,
      maxAudios: audioLimit,
      maxPromptChars: promptLimit,
      parameterSchema,
      durations: optionsFor(parameterSchema, "duration"),
      resolutions: optionsFor(parameterSchema, "resolution"),
      aspectRatios: optionsFor(parameterSchema, "aspectRatio"),
    },
    parameterMap,
  };
}

export function runningHubDisplayName(
  candidate: Record<string, unknown>,
  fallback = "",
) {
  const original = String(
    candidate.display_name ||
      candidate.name_cn ||
      candidate.name_en ||
      fallback,
  ).trim();
  if (!/全能(?:图片|视频)/.test(original)) return original;
  const technicalName = String(candidate.name_en || "").trim();
  if (!technicalName) return original;
  const normalized = technicalName.toLowerCase();
  const family = firstMatchingLabel(normalized, [
    ["nano-banana2-gemini31flash-lite", "Nano Banana 2（Gemini 3.1 Flash Lite）"],
    ["nano-banana2-gemini31flash", "Nano Banana 2（Gemini 3.1 Flash）"],
    ["nano-banana-pro", "Nano Banana Pro"],
    ["nano-banana", "Nano Banana"],
    ["gpt-image-1.5", "GPT Image 1.5"],
    ["gpt-image-2.0", "GPT Image 2"],
    ["gpt-image-2", "GPT Image 2"],
    ["grok-4-image", "Grok 4 Image"],
    ["grok-3-image", "Grok 3 Image"],
    ["grok-imagine-video-v1.5", "Grok Imagine Video 1.5"],
    ["grok-imagine-video", "Grok Imagine Video"],
    [
      "grok-imagine/image-to-video-channel-low-price-v1.5",
      "Grok Imagine Video 1.5",
    ],
    [
      "grok-imagine/text-to-video-channel-low-price-v1.5",
      "Grok Imagine Video 1.5",
    ],
    ["grok-imagine/edit-video", "Grok Imagine Video"],
    ["xai/grok-imagine/", "Grok Imagine Video"],
    ["rhart-imagine-image-quality", "Grok Imagine Image（高质量）"],
    ["grok-imagine-image", "Grok Imagine Image"],
    ["grok-image", "Grok Image"],
    ["gemini-omni-flash", "Gemini Omni Flash"],
    ["runwayml/gen4-aleph", "Runway Gen-4 Aleph"],
    ["runwayml/gen4-turbo", "Runway Gen-4 Turbo"],
    ["sora-upload-character", "Sora 2"],
    ["sora-2", "Sora 2"],
    ["google/veo3.1-fast", "Veo 3.1 Fast"],
    ["google/veo3.1-lite", "Veo 3.1 Lite"],
    ["google/veo3.1-pro", "Veo 3.1 Pro"],
  ]);
  const task = firstMatchingLabel(normalized, [
    ["upload-character", "角色上传"],
    ["reference-to-video", "参考生视频"],
    ["start-end-to-video", "首尾帧生视频"],
    ["image-to-video-realistic", "图生视频（真人）"],
    ["image-to-video-pro", "图生视频 Pro"],
    ["text-to-video-pro", "文生视频 Pro"],
    ["image-to-video", "图生视频"],
    ["text-to-video", "文生视频"],
    ["video-to-video", "视频编辑"],
    ["edit-video", "视频编辑"],
    ["video-edit", "视频编辑"],
    ["video-extend", "视频扩展"],
    ["text-to-image", "文生图"],
    ["image-to-image", "图生图"],
    ["edit-ultra", "图片编辑 Ultra"],
    ["/edit", "图片编辑"],
  ]);
  const channel = /deprecated|已下架/i.test(`${original} ${technicalName}`)
    ? "已下架"
    : normalized.includes("official-stable")
      ? "官方稳定版"
      : normalized.endsWith("-official")
        ? "官方稳定版"
      : normalized.includes("channel-low-price")
        ? "低价渠道版"
        : "";
  return [family || technicalName.split("/")[0], task, channel]
    .filter(Boolean)
    .join(" · ");
}

function firstMatchingLabel(
  value: string,
  candidates: ReadonlyArray<readonly [string, string]>,
) {
  return candidates.find(([pattern]) => value.includes(pattern))?.[1] || "";
}

function runningHubParameters(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const upstreamKey = String(entry.fieldKey || "").trim();
    const sourceType = String(entry.type || "").toUpperCase();
    if (!upstreamKey || !sourceType) return [];
    const key = publicParameterName(upstreamKey) || upstreamKey;
    const options = Array.isArray(entry.options)
      ? entry.options.flatMap((option) => {
          const value = isRecord(option) ? option.value : option;
          return ["string", "number", "boolean"].includes(typeof value)
            ? [value as string | number | boolean]
            : [];
        })
      : undefined;
    const type: PublicModelParameter["type"] =
      sourceType === "BOOLEAN"
        ? "boolean"
        : sourceType === "INT"
          ? "integer"
          : sourceType === "FLOAT" || sourceType === "NUMBER"
            ? "number"
            : "string";
    const publicDefinition: PublicModelParameter = {
      key,
      type,
      ...(String(entry.description || "").trim()
        ? { description: String(entry.description).trim() }
        : {}),
      ...(entry.required === true ? { required: true } : {}),
      ...(entry.defaultValue !== undefined && entry.defaultValue !== null
        ? { defaultValue: entry.defaultValue }
        : {}),
      ...(options?.length ? { options } : {}),
      ...(Number.isFinite(Number(entry.min)) ? { min: Number(entry.min) } : {}),
      ...(Number.isFinite(Number(entry.max)) ? { max: Number(entry.max) } : {}),
      ...(Number.isFinite(Number(entry.step))
        ? { step: Number(entry.step) }
        : {}),
    };
    return [
      {
        key,
        upstreamKey,
        sourceType,
        required: entry.required === true,
        multipleInputs: entry.multipleInputs === true,
        maxInputNum: Number(entry.maxInputNum || 0),
        max: Number(entry.maxLength || 0),
        publicDefinition,
      },
    ];
  });
}

function isPromptField(value: string) {
  return ["prompt", "text_prompt", "text", "content", "lyrics"].includes(value);
}
function maximumInputCount(
  params: ReturnType<typeof runningHubParameters>,
  type: string,
  fallback: number,
) {
  const matching = params.filter((item) => item.sourceType === type);
  if (!matching.length) return 0;
  return matching.reduce(
    (sum, item) =>
      sum + (item.multipleInputs ? item.maxInputNum || fallback : 1),
    0,
  );
}
function optionsFor(parameters: PublicModelParameter[], key: string) {
  return parameters.find((item) => item.key === key)?.options || [];
}
function sanitizeRunningHubEntry(candidate: Record<string, unknown>) {
  return {
    endpoint: candidate.endpoint,
    output_type: candidate.output_type,
    category: candidate.category,
    class_name: candidate.class_name,
    name_cn: candidate.name_cn,
    name_en: candidate.name_en,
    params: Array.isArray(candidate.params) ? candidate.params : [],
    normalizedApiParameterSchema: {
      fields: runningHubParameters(candidate.params)
        .filter(
          (item) =>
            !["IMAGE", "VIDEO", "AUDIO"].includes(item.sourceType) &&
            !isPromptField(item.upstreamKey),
        )
        .map((item) => ({
          name: item.upstreamKey,
          type: item.publicDefinition.type,
          description: item.publicDefinition.description,
          required: item.publicDefinition.required,
          default: item.publicDefinition.defaultValue,
          enum: item.publicDefinition.options,
          min: item.publicDefinition.min,
          max: item.publicDefinition.max,
          step: item.publicDefinition.step,
          playground_visible: true,
          request_role: "model_parameter",
        })),
    },
    effectiveDefaultParams: Object.fromEntries(
      runningHubParameters(candidate.params)
        .filter((item) => item.publicDefinition.defaultValue !== undefined)
        .map((item) => [item.upstreamKey, item.publicDefinition.defaultValue]),
    ),
  };
}

function isSeedanceVideoExtension(
  upstreamModel: unknown,
  input: GenerationInput,
  references: NonNullable<GenerationInput["references"]>,
) {
  return (
    input.capability === "video" &&
    /seedance/i.test(String(upstreamModel || "")) &&
    references.some((reference) => reference.role === "video_input")
  );
}

function catalogItems(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];
  for (const value of [
    payload.data,
    payload.models,
    isRecord(payload.data) ? payload.data.list : undefined,
    isRecord(payload.data) ? payload.data.records : undefined,
  ]) {
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}
function normalizeCapability(value: unknown): Capability | null {
  const text = String(value || "").toLowerCase();
  if (text.includes("speech_to_text") || text.includes("speech-to-text"))
    return null;
  if (text.includes("video")) return "video";
  if (text.includes("image")) return "image";
  if (text.includes("audio") || text.includes("speech")) return "audio";
  if (text.includes("text") || text.includes("chat") || text.includes("llm"))
    return "text";
  return null;
}

export function catalogModelProfile(
  candidate: Record<string, unknown>,
): CatalogCapabilityProfile | null {
  const capability = normalizeCapability(
    candidate.modelType || candidate.type || candidate.capability,
  );
  if (!capability) return null;
  const supported = new Set(
    catalogStrings(
      candidate.supported_parameters || candidate.supportedParameters,
    ),
  );
  const inputs = new Set(
    catalogStrings(candidate.modelInputTypes).map((value) =>
      value.toLowerCase(),
    ),
  );
  const accepts = (...names: string[]) =>
    names.some((name) => supported.has(name));

  if (capability === "text") {
    return {
      capability,
      modes: ["chat"],
      acceptedParameters: accepts("reasoning_effort")
        ? ["reasoningEffort"]
        : [],
      requiredParametersByMode: {},
      limits: { maxPromptChars: 120_000 },
      parameterMap: { reasoningEffort: "reasoning_effort" },
    };
  }
  if (capability === "image") {
    const supportsReferences =
      inputs.has("image") || accepts("images", "image");
    return {
      capability,
      modes: supportsReferences ? ["t2i", "i2i"] : ["t2i"],
      acceptedParameters: [
        ...(accepts("n") ? ["count"] : []),
        ...(accepts("size") ? ["size"] : []),
        ...(accepts("quality") ? ["quality"] : []),
        ...(accepts("background") ? ["background"] : []),
        ...(supportsReferences ? ["references"] : []),
      ],
      requiredParametersByMode: supportsReferences
        ? { i2i: ["references"] }
        : {},
      limits: { maxImages: 9, maxPromptChars: 20_000 },
      parameterMap: { count: "n", references: "images" },
    };
  }
  if (capability === "video") {
    const fields = catalogParameterFields(candidate);
    const frameField = fields.find((field) => field.name === "frame_images");
    const referenceField = fields.find(
      (field) => field.name === "input_references",
    );
    const frameLimit = catalogArrayLimit(frameField);
    const supportsFrames = accepts("frame_images") && frameLimit !== 0;
    const supportsLastFrame =
      supportsFrames && (frameLimit === null || frameLimit >= 2);
    const supportsReferences =
      accepts("input_references") &&
      (!referenceField || catalogReferenceSupport(referenceField));
    const parameters = publicParameterSchema(candidate);
    const modes: GenerationMode[] = ["t2v"];
    if (supportsFrames) modes.push("i2v");
    if (supportsLastFrame) modes.push("flf2v");
    if (supportsReferences) modes.push("multiref");
    return {
      capability,
      modes,
      acceptedParameters: [
        ...parameters.map((parameter) => parameter.key),
        ...(accepts("omni_reference_task_type")
          ? ["omniReferenceTaskType"]
          : []),
        ...(supportsFrames ? ["firstFrame"] : []),
        ...(supportsLastFrame ? ["lastFrame"] : []),
        ...(supportsReferences ? ["references"] : []),
      ],
      requiredParametersByMode: {
        ...(supportsFrames ? { i2v: ["firstFrame"] } : {}),
        ...(supportsLastFrame ? { flf2v: ["firstFrame", "lastFrame"] } : {}),
        ...(supportsReferences ? { multiref: ["references"] } : {}),
      },
      limits: videoCatalogLimits(candidate),
      parameterMap: {
        ...Object.fromEntries(
          parameters.map((parameter) => [
            parameter.key,
            catalogParameterFields(candidate).find(
              (field) => publicParameterName(field.name) === parameter.key,
            )?.name || parameter.key,
          ]),
        ),
        omniReferenceTaskType: "omni_reference_task_type",
      },
    };
  }
  return {
    capability,
    modes: ["tts"],
    acceptedParameters: [
      ...(accepts("voice") ? ["voice"] : []),
      ...(accepts("response_format", "audio_format") ? ["format"] : []),
      ...(accepts("speed") ? ["speed"] : []),
      ...(accepts("instructions") ? ["instructions"] : []),
    ],
    requiredParametersByMode: {},
    limits: { maxPromptChars: 10_000 },
    parameterMap: {
      format: accepts("response_format") ? "response_format" : "audio_format",
    },
  };
}

function catalogStrings(value: unknown): string[] {
  if (Array.isArray(value))
    return value
      .map(String)
      .map((item) => item.trim())
      .filter(Boolean);
  return String(value || "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
function createSlug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown"
  );
}
function sanitizeCatalogEntry(value: Record<string, unknown>) {
  const allowed = [
    "id",
    "name",
    "model",
    "type",
    "modelType",
    "capability",
    "description",
    "descriptionEn",
    "descriptionZh",
    "displayName",
    "modelInputTypes",
    "modelOutputTypes",
    "status",
    "supportedParameters",
    "supported_parameters",
    "effectiveDefaultParams",
    "normalizedApiParameterSchema",
  ];
  return Object.fromEntries(
    allowed
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, value[key]]),
  );
}

const PUBLIC_PARAMETER_NAMES: Record<string, string> = {
  duration: "duration",
  resolution: "resolution",
  aspect_ratio: "aspectRatio",
  ratio: "aspectRatio",
  generate_audio: "generateAudio",
  watermark: "watermark",
  bitrate_mode: "bitrateMode",
  output_format: "outputFormat",
};

function publicParameterName(value: unknown) {
  const name = String(value || "").trim();
  if (!/^[a-z][a-z0-9_]*$/.test(name)) return "";
  return (
    PUBLIC_PARAMETER_NAMES[name] ||
    name.replace(/_([a-z0-9])/g, (_, character: string) =>
      character.toUpperCase(),
    )
  );
}

function catalogParameterFields(
  candidate: unknown,
): Array<Record<string, unknown>> {
  if (!isRecord(candidate)) return [];
  const schema = candidate.normalizedApiParameterSchema;
  return isRecord(schema) && Array.isArray(schema.fields)
    ? schema.fields.filter(isRecord)
    : [];
}

function publicParameterSchema(candidate: unknown): PublicModelParameter[] {
  return catalogParameterFields(candidate).flatMap((field) => {
    const key = publicParameterName(field.name);
    const type = String(field.type || "");
    if (
      !key ||
      field.playground_visible !== true ||
      (field.request_role !== undefined &&
        field.request_role !== "model_parameter") ||
      field.transport_only === true ||
      !["boolean", "string", "integer", "number"].includes(type)
    )
      return [];
    const options = Array.isArray(field.enum)
      ? field.enum.filter((value): value is string | number | boolean =>
          ["string", "number", "boolean"].includes(typeof value),
        )
      : undefined;
    return [
      {
        key,
        type: type as PublicModelParameter["type"],
        ...(String(field.description || "").trim()
          ? { description: String(field.description).trim() }
          : {}),
        ...(field.required === true ? { required: true } : {}),
        ...(field.default !== undefined && field.default !== null
          ? { defaultValue: field.default }
          : {}),
        ...(options?.length ? { options } : {}),
        ...(field.min !== undefined &&
        field.min !== null &&
        Number.isFinite(Number(field.min))
          ? { min: Number(field.min) }
          : {}),
        ...(field.max !== undefined &&
        field.max !== null &&
        Number.isFinite(Number(field.max))
          ? { max: Number(field.max) }
          : {}),
        ...(field.step !== undefined &&
        field.step !== null &&
        Number.isFinite(Number(field.step))
          ? { step: Number(field.step) }
          : {}),
      },
    ];
  });
}

function publicParameterDefaults(candidate: unknown) {
  if (!isRecord(candidate) || !isRecord(candidate.effectiveDefaultParams))
    return {};
  return Object.fromEntries(
    Object.entries(candidate.effectiveDefaultParams).flatMap(
      ([name, value]): Array<[string, unknown]> => {
        const key = publicParameterName(name);
        return key ? [[key, value]] : [];
      },
    ),
  );
}

function videoCatalogLimits(candidate: Record<string, unknown>) {
  const fields = catalogParameterFields(candidate);
  const field = (name: string) => fields.find((item) => item.name === name);
  const enumValues = (name: string): unknown[] => {
    const values = field(name)?.enum;
    return Array.isArray(values) ? values : [];
  };
  const referenceField = field("input_references");
  const referenceLimit = (
    key: "reference_images" | "reference_videos" | "reference_audios",
    fallback: number,
  ) => {
    const value = referenceField?.[key];
    if (!isRecord(value)) return fallback;
    const maximum = Number(value.max_items);
    return Number.isFinite(maximum) && maximum >= 0 ? maximum : fallback;
  };
  return {
    maxImages: referenceLimit("reference_images", 9),
    maxVideos: referenceLimit("reference_videos", 3),
    maxAudios: referenceLimit("reference_audios", 3),
    maxPromptChars: 20_000,
    durations: enumValues("duration"),
    resolutions: enumValues("resolution"),
    aspectRatios: enumValues("aspect_ratio").length
      ? enumValues("aspect_ratio")
      : enumValues("ratio"),
    parameterSchema: publicParameterSchema(candidate),
  };
}

function catalogArrayLimit(field: Record<string, unknown> | undefined) {
  if (!field) return null;
  if (
    field.max_items === undefined ||
    field.max_items === null ||
    field.max_items === ""
  )
    return null;
  const value = Number(field.max_items);
  return Number.isFinite(value) ? value : null;
}

function catalogReferenceSupport(field: Record<string, unknown> | undefined) {
  if (!field) return false;
  const limits = [
    field.reference_images,
    field.reference_videos,
    field.reference_audios,
  ]
    .filter(isRecord)
    .filter(
      (value) =>
        value.max_items !== undefined &&
        value.max_items !== null &&
        value.max_items !== "",
    )
    .map((value) => Number(value.max_items))
    .filter(Number.isFinite);
  return !limits.length || limits.some((value) => value > 0);
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function humanParameter(value: string) {
  return (
    (
      {
        firstFrame: "首帧",
        lastFrame: "尾帧",
        references: "参考素材",
      } as Record<string, string>
    )[value] || value
  );
}

function validateModelLimits(
  limitsValue: unknown,
  parameters: Record<string, unknown>,
  references: GenerationInput["references"] = [],
  mode: GenerationMode = "t2v",
) {
  const limits = isRecord(limitsValue) ? limitsValue : {};
  const parameterSchema = Array.isArray(limits.parameterSchema)
    ? limits.parameterSchema.filter(isRecord)
    : [];
  for (const definition of parameterSchema) {
    const key = String(definition.key || "");
    const value = parameters[key];
    if (value === undefined || value === null || value === "") {
      if (definition.required === true)
        throw new DomainError(
          "INVALID_MODEL_PARAMETER",
          `缺少模型参数：${key}`,
          422,
        );
      continue;
    }
    const type = String(definition.type || "");
    const validType =
      type === "boolean"
        ? typeof value === "boolean"
        : type === "integer"
          ? typeof value === "number" && Number.isInteger(value)
          : type === "number"
            ? typeof value === "number" && Number.isFinite(value)
            : type === "string"
              ? typeof value === "string"
              : true;
    if (!validType)
      throw new DomainError(
        "INVALID_MODEL_PARAMETER",
        `模型参数类型不正确：${key}`,
        422,
      );
    const options = Array.isArray(definition.options) ? definition.options : [];
    if (
      options.length &&
      !options.some(
        (option) =>
          String(option).toLowerCase() === String(value).toLowerCase(),
      )
    )
      throw new DomainError(
        "INVALID_MODEL_PARAMETER",
        `模型参数不在支持范围内：${key}`,
        422,
      );
    if (typeof value === "number") {
      const minimum = Number(definition.min);
      const maximum = Number(definition.max);
      if (
        (definition.min !== undefined &&
          Number.isFinite(minimum) &&
          value < minimum) ||
        (definition.max !== undefined &&
          Number.isFinite(maximum) &&
          value > maximum)
      )
        throw new DomainError(
          "INVALID_MODEL_PARAMETER",
          `模型参数超出支持范围：${key}`,
          422,
        );
    }
  }
  for (const [parameter, limitKey, label] of [
    ["duration", "durations", "时长"],
    ["resolution", "resolutions", "清晰度"],
    ["aspectRatio", "aspectRatios", "画面比例"],
  ] as const) {
    const value = parameters[parameter];
    const allowed = Array.isArray(limits[limitKey]) ? limits[limitKey] : [];
    if (
      value !== undefined &&
      allowed.length &&
      !allowed.some((item) => String(item) === String(value))
    )
      throw new DomainError(
        "INVALID_MODEL_PARAMETER",
        `${label}不在模型支持范围内`,
        422,
      );
  }
  if (mode !== "multiref") return;
  const referenceList = references || [];
  const counts = {
    maxImages: referenceList.filter(
      (item) => !item.mimeType || item.mimeType.startsWith("image/"),
    ).length,
    maxVideos: referenceList.filter((item) =>
      item.mimeType?.startsWith("video/"),
    ).length,
    maxAudios: referenceList.filter(
      (item) =>
        item.mimeType?.startsWith("audio/") || item.role === "audio_reference",
    ).length,
  };
  for (const [limitKey, count] of Object.entries(counts)) {
    const rawMaximum = limits[limitKey];
    const maximum = Number(rawMaximum);
    if (
      rawMaximum !== undefined &&
      rawMaximum !== null &&
      rawMaximum !== "" &&
      Number.isFinite(maximum) &&
      count > maximum
    )
      throw new DomainError(
        "INVALID_MODEL_PARAMETER",
        `参考素材数量超过模型上限（最多 ${maximum} 个）`,
        422,
      );
  }
}
