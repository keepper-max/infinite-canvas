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
};

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
      const capability = normalizeCapability(
        candidate.modelType || candidate.type || candidate.capability,
      );
      const known = await this.pool.query(
        "update model_catalog set discovered=true,healthy=true,catalog_metadata=$2,discovered_at=now(),checked_at=now(),updated_at=now() where upstream_model=$1 returning id",
        [name, sanitizeCatalogEntry(candidate)],
      );
      if (!known.rowCount && capability) {
        const id = `catalog.${capability}.${createSlug(name)}`.slice(0, 190);
        await this.pool.query(
          `insert into model_catalog(id,display_name,capability,upstream_model,provider_id,discovered,enabled,healthy,catalog_metadata,discovered_at,checked_at)
                    values($1,$2,$3,$2,'token360',true,false,false,$4,now(),now()) on conflict(id) do update set catalog_metadata=excluded.catalog_metadata,discovered=true,discovered_at=now(),checked_at=now(),updated_at=now()`,
          [id, name, capability, sanitizeCatalogEntry(candidate)],
        );
      }
    }
    return candidates.length;
  }

  async listPublicModels(): Promise<
    Array<
      Omit<
        ModelDefinition,
        | "upstreamModel"
        | "providerId"
        | "parameterMap"
        | "requiredParametersByMode"
      >
    >
  > {
    const result = await this.pool
      .query(`select c.id, c.display_name, c.capability, p.modes, p.accepted_parameters, p.limits
            from model_catalog c join model_capabilities p on p.model_id = c.id
            where c.enabled = true and c.healthy = true order by c.capability, c.display_name`);
    return result.rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      capability: row.capability,
      modes: row.modes || [],
      acceptedParameters: row.accepted_parameters || [],
      limits: row.limits || {},
    }));
  }

  async compile(input: GenerationInput): Promise<CompiledGenerationRequest> {
    const result = await this.pool.query(
      `select c.id, c.display_name, c.capability, c.upstream_model, c.provider_id,
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
    validateModelLimits(row.limits, input.parameters || {}, references);
    const parameterSource: Record<string, unknown> = {
      ...(input.parameters || {}),
    };
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
    if (input.mode !== "multiref")
      delete parameterSource.omni_reference_task_type;
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
    };
  }
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
  if (text.includes("video")) return "video";
  if (text.includes("image")) return "image";
  if (text.includes("audio") || text.includes("speech")) return "audio";
  if (text.includes("text") || text.includes("chat") || text.includes("llm"))
    return "text";
  return null;
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
    "status",
    "supportedParameters",
  ];
  return Object.fromEntries(
    allowed
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, value[key]]),
  );
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
) {
  const limits = isRecord(limitsValue) ? limitsValue : {};
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
    const maximum = Number(limits[limitKey] || 0);
    if (maximum && count > maximum)
      throw new DomainError(
        "INVALID_MODEL_PARAMETER",
        `参考素材数量超过模型上限（最多 ${maximum} 个）`,
        422,
      );
  }
}
