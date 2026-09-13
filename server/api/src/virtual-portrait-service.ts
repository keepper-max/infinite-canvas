import type { Pool, PoolClient } from "pg";

import type { ProviderConfig } from "./config.js";
import { DomainError } from "./domain.js";
import type { ObjectStorage } from "./object-storage.js";
import { assertProjectAccess } from "./project-access.js";
import type { VirtualPortraitDocument } from "./virtual-portrait-contract.js";

type ProviderAsset = {
  id?: string;
  assetId: string;
  status: "processing" | "active" | "failed";
  errorMessage?: string;
};

export interface VirtualPortraitServicePort {
  list(
    projectId: string,
    userId: string,
    refresh?: boolean,
  ): Promise<VirtualPortraitDocument[]>;
  create(
    projectId: string,
    userId: string,
    input: { assetVersionId: string; name: string },
  ): Promise<VirtualPortraitDocument>;
  archive(id: string, userId: string): Promise<boolean>;
}

export class Token360VirtualPortraitClient {
  constructor(private readonly config: ProviderConfig) {}

  async createGroup(name: string) {
    const payload = await this.request("/v1/asset-groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, groupKind: "VIRTUAL_PORTRAIT" }),
    });
    const record = unwrapRecord(payload);
    const id = stringField(record, "id", "groupId", "group_id");
    if (!id)
      throw new DomainError(
        "VIRTUAL_PORTRAIT_PROVIDER_INVALID",
        "角色资产服务没有返回资产分组编号",
        503,
        true,
      );
    const status = stringField(record, "status", "state");
    return {
      id,
      status: status ? normalizeStatus(status) : ("active" as const),
    };
  }

  async uploadAsset(
    groupId: string,
    name: string,
    bytes: Uint8Array,
    mimeType: string,
  ) {
    const form = new FormData();
    form.append("groupId", groupId);
    form.append("name", name);
    form.append(
      "file",
      new Blob([bytes.slice().buffer], { type: mimeType }),
      name,
    );
    return readProviderAsset(
      await this.request("/v1/assets", { method: "POST", body: form }),
    );
  }

  async getAsset(assetId: string) {
    return readProviderAsset(
      await this.request(`/v1/assets/${encodeURIComponent(assetId)}`, {
        method: "GET",
      }),
    );
  }

  private async request(path: string, init: RequestInit) {
    if (!this.config.apiKey)
      throw new DomainError(
        "VIRTUAL_PORTRAIT_UNAVAILABLE",
        "角色资产服务尚未配置",
        503,
        true,
      );
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: "application/json",
          ...init.headers,
        },
      });
    } catch (error) {
      throw new DomainError(
        "VIRTUAL_PORTRAIT_UNAVAILABLE",
        "角色资产服务连接失败",
        503,
        true,
        { cause: error },
      );
    }
    const text = await response.text();
    const payload = safeJson(text);
    if (!response.ok) {
      const message = safeProviderMessage(payload);
      if (response.status === 401 || response.status === 403)
        throw new DomainError(
          "VIRTUAL_PORTRAIT_AUTH_FAILED",
          "角色资产服务授权失败",
          503,
          false,
        );
      throw new DomainError(
        response.status >= 500
          ? "VIRTUAL_PORTRAIT_UNAVAILABLE"
          : "VIRTUAL_PORTRAIT_REJECTED",
        message ||
          (response.status >= 500
            ? "角色资产服务暂时不可用"
            : "角色资产服务拒绝了当前素材"),
        response.status >= 500 ? 503 : 422,
        response.status >= 500,
      );
    }
    return payload;
  }
}

export class VirtualPortraitService implements VirtualPortraitServicePort {
  constructor(
    private readonly pool: Pool,
    private readonly storage: ObjectStorage,
    private readonly provider: Token360VirtualPortraitClient,
  ) {}

  async list(projectId: string, userId: string, refresh = false) {
    await assertProjectAccess(this.pool, projectId, userId);
    if (refresh) await this.refreshProcessing(projectId);
    const result = await this.pool.query(
      `select vp.*, v.mime_type, v.width, v.height, v.storage_key
         from virtual_portraits vp
         join asset_versions v on v.id=vp.source_asset_version_id
        where vp.project_id=$1 and vp.archived_at is null
        order by vp.updated_at desc`,
      [projectId],
    );
    return Promise.all(result.rows.map((row) => this.serialize(row)));
  }

  async create(
    projectId: string,
    userId: string,
    input: { assetVersionId: string; name: string },
  ) {
    await assertProjectAccess(this.pool, projectId, userId, "edit");
    const source = (
      await this.pool.query(
        `select v.id, v.asset_id, v.storage_key, v.mime_type, v.width, v.height
           from asset_versions v join assets a on a.id=v.asset_id
          where v.id=$1 and a.project_id=$2 and a.status='active' and a.trashed_at is null`,
        [input.assetVersionId, projectId],
      )
    ).rows[0];
    if (!source)
      throw new DomainError(
        "ASSET_VERSION_NOT_FOUND",
        "角色源图不存在或不属于当前项目",
        404,
      );
    if (!String(source.mime_type).startsWith("image/"))
      throw new DomainError(
        "VIRTUAL_PORTRAIT_IMAGE_REQUIRED",
        "Virtual Portrait 只能使用图片素材",
        422,
      );
    const library = await this.ensureLibrary(projectId, userId);
    const uploaded = await this.provider.uploadAsset(
      library.provider_group_id,
      input.name,
      await this.storage.get(source.storage_key),
      source.mime_type,
    );
    const result = await this.pool.query(
      `insert into virtual_portraits(project_id,library_id,source_asset_id,source_asset_version_id,provider_record_id,provider_asset_id,name,status,error_message,created_by)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [
        projectId,
        library.id,
        source.asset_id,
        source.id,
        uploaded.id || null,
        uploaded.assetId,
        input.name,
        uploaded.status,
        uploaded.errorMessage || null,
        userId,
      ],
    );
    return this.serialize({
      ...result.rows[0],
      mime_type: source.mime_type,
      width: source.width,
      height: source.height,
      storage_key: source.storage_key,
    });
  }

  async archive(id: string, userId: string) {
    const existing = await this.pool.query(
      "select project_id from virtual_portraits where id=$1 and archived_at is null",
      [id],
    );
    if (!existing.rows[0]) return false;
    await assertProjectAccess(
      this.pool,
      existing.rows[0].project_id,
      userId,
      "edit",
    );
    const result = await this.pool.query(
      `update virtual_portraits set archived_at=now(),updated_at=now() where id=$1 and archived_at is null returning project_id`,
      [id],
    );
    return Boolean(result.rows[0]);
  }

  private async ensureLibrary(projectId: string, userId: string) {
    const client = await this.pool.connect();
    try {
      await assertProjectAccess(client, projectId, userId, "edit");
      await client.query("select pg_advisory_lock(hashtext($1))", [
        `virtual-portrait:${projectId}`,
      ]);
      const existing = await client.query(
        "select * from virtual_portrait_libraries where project_id=$1",
        [projectId],
      );
      if (existing.rows[0]) return existing.rows[0];
      const project = await client.query(
        "select name from projects where id=$1",
        [projectId],
      );
      const name = `${String(project.rows[0]?.name || "未命名项目").slice(0, 160)} · Virtual Portrait`;
      const group = await this.provider.createGroup(name);
      const created = await client.query(
        `insert into virtual_portrait_libraries(project_id,provider_group_id,name,provider_status,created_by)
         values($1,$2,$3,$4,$5) returning *`,
        [projectId, group.id, name, group.status, userId],
      );
      return created.rows[0];
    } finally {
      await client
        .query("select pg_advisory_unlock(hashtext($1))", [
          `virtual-portrait:${projectId}`,
        ])
        .catch(() => undefined);
      client.release();
    }
  }

  private async refreshProcessing(projectId: string) {
    const pending = await this.pool.query(
      "select id,provider_asset_id from virtual_portraits where project_id=$1 and status='processing' and archived_at is null",
      [projectId],
    );
    await Promise.all(
      pending.rows.map(async (row) => {
        try {
          const asset = await this.provider.getAsset(row.provider_asset_id);
          await this.pool.query(
            "update virtual_portraits set status=$2,error_message=$3,updated_at=now() where id=$1",
            [row.id, asset.status, asset.errorMessage || null],
          );
        } catch {
          // Keep the last durable provider state when a refresh is temporarily unavailable.
        }
      }),
    );
  }

  private async serialize(
    row: Record<string, unknown>,
  ): Promise<VirtualPortraitDocument> {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      name: String(row.name),
      status: normalizeStatus(String(row.status || "processing")),
      errorMessage: row.error_message ? String(row.error_message) : null,
      sourceAssetId: String(row.source_asset_id),
      sourceAssetVersionId: String(row.source_asset_version_id),
      providerAssetId: String(row.provider_asset_id),
      mimeType: String(row.mime_type || "image/png"),
      width: row.width == null ? null : Number(row.width),
      height: row.height == null ? null : Number(row.height),
      previewUrl: await this.storage.createDownloadUrl(String(row.storage_key)),
      createdAt: dateText(row.created_at),
      updatedAt: dateText(row.updated_at),
    };
  }
}

function unwrapRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return {};
  let record = payload as Record<string, unknown>;
  for (let depth = 0; depth < 3; depth += 1) {
    let nested: Record<string, unknown> | undefined;
    for (const key of ["data", "asset", "result"]) {
      const value = record[key];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        nested = value as Record<string, unknown>;
        break;
      }
    }
    if (!nested) break;
    record = nested;
  }
  return record;
}

function readProviderAsset(payload: unknown): ProviderAsset {
  const record = unwrapRecord(payload);
  const assetId = stringField(record, "assetId", "asset_id", "assetID");
  if (!assetId || !assetId.startsWith("ta_"))
    throw new DomainError(
      "VIRTUAL_PORTRAIT_PROVIDER_INVALID",
      "角色资产服务没有返回可用的 Asset ID",
      503,
      true,
    );
  const status = normalizeStatus(stringField(record, "status", "state"));
  return {
    id: stringField(record, "id"),
    assetId,
    status,
    errorMessage:
      status === "failed"
        ? safeProviderMessage(record) || undefined
        : undefined,
  };
}

function normalizeStatus(value?: string): "processing" | "active" | "failed" {
  const status = String(value || "").toLowerCase();
  if (["active", "ready", "succeeded", "success", "completed"].includes(status))
    return "active";
  if (["failed", "error", "rejected", "inactive"].includes(status))
    return "failed";
  return "processing";
}

function stringField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys)
    if (typeof record[key] === "string" && record[key])
      return record[key] as string;
  return undefined;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function safeProviderMessage(payload: unknown) {
  const record = unwrapRecord(payload);
  const error = record.error;
  const nested =
    error && typeof error === "object" && !Array.isArray(error)
      ? (error as Record<string, unknown>)
      : {};
  return (
    (typeof error === "string" ? error : "") ||
    stringField(nested, "message", "detail") ||
    stringField(
      record,
      "message",
      "msg",
      "detail",
      "errorMessage",
      "error_message",
      "failureReason",
      "failure_reason",
    ) ||
    ""
  )
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted]")
    .slice(0, 300);
}

function dateText(value: unknown) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(String(value)).toISOString();
}
