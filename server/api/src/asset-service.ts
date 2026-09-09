import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase, NodePgTransaction } from "drizzle-orm/node-postgres";
import type { ExtractTablesWithRelations } from "drizzle-orm";

import type { AssetDocument, AssetVersionDocument, BeginAssetUpload } from "./asset-contract.js";
import { DomainError } from "./domain.js";
import type { ObjectStorage } from "./object-storage.js";
import * as tables from "./db/schema.js";

type Database = NodePgDatabase<typeof tables>;
type Transaction = NodePgTransaction<typeof tables, ExtractTablesWithRelations<typeof tables>>;
type Executor = Database | Transaction;

export interface AssetServicePort {
    list(projectId: string, userId: string, includeTrashed?: boolean): Promise<AssetDocument[] | null>;
    beginUpload(projectId: string, userId: string, input: BeginAssetUpload): Promise<{ uploadId: string; assetId: string; storageKey: string; uploadUrl: string; headers: Record<string, string>; thumbnailUpload?: { url: string; headers: Record<string, string> } }>;
    completeUpload(projectId: string, uploadId: string, userId: string): Promise<AssetDocument | null>;
    createDownloadUrl(versionId: string, userId: string): Promise<{ url: string } | null>;
    setCurrentVersion(assetId: string, versionId: string, userId: string): Promise<AssetDocument | null>;
    trash(assetId: string, userId: string, reason: string): Promise<AssetDocument | null>;
    restore(assetId: string, userId: string): Promise<AssetDocument | null>;
}

export class PostgresAssetService implements AssetServicePort {
    constructor(private readonly db: Database, private readonly storage: ObjectStorage) {}

    async list(projectId: string, userId: string, includeTrashed = false) {
        if (!(await hasProjectAccess(this.db, projectId, userId))) return null;
        const rows = await this.db
            .select()
            .from(tables.assets)
            .where(and(eq(tables.assets.projectId, projectId), ...(includeTrashed ? [] : [eq(tables.assets.status, "active")])))
            .orderBy(desc(tables.assets.updatedAt));
        return Promise.all(rows.map((row) => this.readAsset(row.id, userId))).then((items) => items.filter((item): item is AssetDocument => Boolean(item)));
    }

    async beginUpload(projectId: string, userId: string, input: BeginAssetUpload) {
        const storageKey = `projects/${projectId}/${input.kind}/${randomUUID()}`;
        const thumbnailStorageKey = input.thumbnail ? `projects/${projectId}/thumbnails/${randomUUID()}` : undefined;
        const created = await this.db.transaction(async (tx) => {
            if (!(await hasProjectAccess(tx, projectId, userId))) throw new DomainError("PROJECT_FORBIDDEN", "无权访问该项目", 403);
            let assetId = input.assetId;
            if (assetId) {
                const [asset] = await tx.select({ id: tables.assets.id }).from(tables.assets).where(and(eq(tables.assets.id, assetId), eq(tables.assets.projectId, projectId), eq(tables.assets.status, "active"))).limit(1);
                if (!asset) throw new DomainError("ASSET_NOT_FOUND", "找不到该素材", 404);
            } else {
                [assetId] = await tx.insert(tables.assets).values({ projectId, kind: input.kind, name: input.name, createdBy: userId }).returning({ id: tables.assets.id }).then((rows) => [rows[0]!.id]);
            }
            if (!assetId) throw new DomainError("ASSET_CREATE_FAILED", "无法创建素材", 500, true);
            if (input.parentVersionIds.length) {
                const parents = await tx
                    .select({ id: tables.assetVersions.id })
                    .from(tables.assetVersions)
                    .innerJoin(tables.assets, eq(tables.assets.id, tables.assetVersions.assetId))
                    .where(and(eq(tables.assets.projectId, projectId), inArray(tables.assetVersions.id, input.parentVersionIds)));
                if (parents.length !== new Set(input.parentVersionIds).size) throw new DomainError("ASSET_PARENT_FORBIDDEN", "部分来源版本不属于当前项目", 422);
            }
            const [upload] = await tx
                .insert(tables.assetUploads)
                .values({ projectId, assetId, storageKey, mimeType: input.mimeType, bytes: input.bytes, sha256: input.sha256, width: input.width, height: input.height, durationMs: input.durationMs, source: input.source, parentVersionIds: input.parentVersionIds, provenance: input.provenance, thumbnailStorageKey, thumbnailMimeType: input.thumbnail?.mimeType, thumbnailBytes: input.thumbnail?.bytes, thumbnailSha256: input.thumbnail?.sha256, createdBy: userId })
                .returning({ id: tables.assetUploads.id, assetId: tables.assetUploads.assetId });
            return upload;
        });
        try {
            const signed = await this.storage.createUploadUrl(storageKey, input.mimeType, input.sha256);
            const thumbnailSigned = input.thumbnail && thumbnailStorageKey ? await this.storage.createUploadUrl(thumbnailStorageKey, input.thumbnail.mimeType, input.thumbnail.sha256) : undefined;
            return { uploadId: created.id, assetId: created.assetId, storageKey, uploadUrl: signed.url, headers: signed.headers, ...(thumbnailSigned ? { thumbnailUpload: thumbnailSigned } : {}) };
        } catch (error) {
            await this.db.transaction(async (tx) => {
                await tx.delete(tables.assetUploads).where(eq(tables.assetUploads.id, created.id));
                await tx.delete(tables.assets).where(and(eq(tables.assets.id, created.assetId), isNull(tables.assets.currentVersionId)));
            }).catch(() => undefined);
            throw error;
        }
    }

    async completeUpload(projectId: string, uploadId: string, userId: string) {
        if (!(await hasProjectAccess(this.db, projectId, userId))) return null;
        const [upload] = await this.db.select().from(tables.assetUploads).where(and(eq(tables.assetUploads.id, uploadId), eq(tables.assetUploads.projectId, projectId), eq(tables.assetUploads.createdBy, userId))).limit(1);
        if (!upload) throw new DomainError("ASSET_UPLOAD_NOT_FOUND", "找不到该上传任务", 404);
        if (upload.completedAt) return this.readAsset(upload.assetId, userId);
        const stored = await this.storage.stat(upload.storageKey);
        if (!stored) throw new DomainError("ASSET_UPLOAD_INCOMPLETE", "文件尚未上传完成", 409, true);
        const thumbnailStored = upload.thumbnailStorageKey ? await this.storage.stat(upload.thumbnailStorageKey) : null;
        const thumbnailMismatch = upload.thumbnailStorageKey && (!thumbnailStored || thumbnailStored.bytes !== upload.thumbnailBytes || thumbnailStored.mimeType !== upload.thumbnailMimeType || thumbnailStored.sha256?.toLowerCase() !== upload.thumbnailSha256?.toLowerCase());
        if (stored.bytes !== upload.bytes || stored.mimeType !== upload.mimeType || stored.sha256?.toLowerCase() !== upload.sha256.toLowerCase() || thumbnailMismatch) {
            await this.storage.delete(upload.storageKey).catch(() => undefined);
            if (upload.thumbnailStorageKey) await this.storage.delete(upload.thumbnailStorageKey).catch(() => undefined);
            throw new DomainError("ASSET_UPLOAD_MISMATCH", "上传文件校验失败，请重新上传", 422, true);
        }
        try {
            await this.db.transaction(async (tx) => {
                await tx.execute(sql`select id from ${tables.assets} where id = ${upload.assetId} for update`);
                const [fresh] = await tx.select({ completedAt: tables.assetUploads.completedAt }).from(tables.assetUploads).where(eq(tables.assetUploads.id, upload.id)).limit(1);
                if (fresh?.completedAt) return;
                const [latest] = await tx.select({ version: tables.assetVersions.version }).from(tables.assetVersions).where(eq(tables.assetVersions.assetId, upload.assetId)).orderBy(desc(tables.assetVersions.version)).limit(1);
                const [version] = await tx
                    .insert(tables.assetVersions)
                    .values({ assetId: upload.assetId, version: (latest?.version ?? 0) + 1, storageKey: upload.storageKey, mimeType: upload.mimeType, bytes: upload.bytes, width: upload.width, height: upload.height, durationMs: upload.durationMs, sha256: upload.sha256, source: upload.source, parentVersionIds: upload.parentVersionIds, provenance: upload.provenance, thumbnailStorageKey: upload.thumbnailStorageKey, thumbnailMimeType: upload.thumbnailMimeType, thumbnailBytes: upload.thumbnailBytes, createdBy: userId })
                    .returning({ id: tables.assetVersions.id });
                await tx.update(tables.assets).set({ currentVersionId: version.id, status: "active", trashedAt: null, updatedAt: new Date() }).where(eq(tables.assets.id, upload.assetId));
                await tx.update(tables.assetUploads).set({ completedAt: new Date() }).where(eq(tables.assetUploads.id, upload.id));
            });
        } catch (error) {
            await this.db
                .insert(tables.trashItems)
                .values({ projectId, objectType: "storage_object", objectId: upload.id, reason: "asset_version_commit_failed", metadata: { storageKey: upload.storageKey }, deletedBy: userId })
                .onConflictDoNothing()
                .catch(() => undefined);
            throw error;
        }
        return this.readAsset(upload.assetId, userId);
    }

    async createDownloadUrl(versionId: string, userId: string) {
        const [row] = await this.db
            .select({ storageKey: tables.assetVersions.storageKey, name: tables.assets.name })
            .from(tables.assetVersions)
            .innerJoin(tables.assets, eq(tables.assets.id, tables.assetVersions.assetId))
            .innerJoin(tables.projectMembers, eq(tables.projectMembers.projectId, tables.assets.projectId))
            .where(and(eq(tables.assetVersions.id, versionId), eq(tables.projectMembers.userId, userId)))
            .limit(1);
        return row ? { url: await this.storage.createDownloadUrl(row.storageKey, row.name) } : null;
    }

    async setCurrentVersion(assetId: string, versionId: string, userId: string) {
        const asset = await this.readAsset(assetId, userId);
        if (!asset) return null;
        if (!asset.versions.some((version) => version.id === versionId)) throw new DomainError("ASSET_VERSION_NOT_FOUND", "该版本不属于当前素材", 422);
        await this.db.update(tables.assets).set({ currentVersionId: versionId, updatedAt: new Date() }).where(eq(tables.assets.id, assetId));
        return this.readAsset(assetId, userId);
    }

    async trash(assetId: string, userId: string, reason: string) {
        const asset = await this.readAsset(assetId, userId);
        if (!asset) return null;
        if (asset.status === "trashed") return asset;
        await this.db.transaction(async (tx) => {
            await tx.update(tables.assets).set({ status: "trashed", trashedAt: new Date(), updatedAt: new Date() }).where(eq(tables.assets.id, assetId));
            await tx.insert(tables.trashItems).values({ projectId: asset.projectId, objectType: "asset", objectId: assetId, reason, deletedBy: userId }).onConflictDoNothing();
        });
        return this.readAsset(assetId, userId);
    }

    async restore(assetId: string, userId: string) {
        const asset = await this.readAsset(assetId, userId);
        if (!asset) return null;
        if (asset.status === "active") return asset;
        await this.db.transaction(async (tx) => {
            await tx.update(tables.assets).set({ status: "active", trashedAt: null, updatedAt: new Date() }).where(eq(tables.assets.id, assetId));
            await tx.delete(tables.trashItems).where(and(eq(tables.trashItems.projectId, asset.projectId), eq(tables.trashItems.objectType, "asset"), eq(tables.trashItems.objectId, assetId)));
        });
        return this.readAsset(assetId, userId);
    }

    private async readAsset(assetId: string, userId: string): Promise<AssetDocument | null> {
        const [asset] = await this.db
            .select({ id: tables.assets.id, projectId: tables.assets.projectId, kind: tables.assets.kind, name: tables.assets.name, currentVersionId: tables.assets.currentVersionId, status: tables.assets.status, createdBy: tables.assets.createdBy, createdAt: tables.assets.createdAt, updatedAt: tables.assets.updatedAt, trashedAt: tables.assets.trashedAt })
            .from(tables.assets)
            .innerJoin(tables.projectMembers, eq(tables.projectMembers.projectId, tables.assets.projectId))
            .where(and(eq(tables.assets.id, assetId), eq(tables.projectMembers.userId, userId)))
            .limit(1);
        if (!asset) return null;
        if (!asset.createdBy) throw new DomainError("ASSET_OWNER_MISSING", "素材缺少创建者信息", 500);
        const versions = await this.db.select().from(tables.assetVersions).where(eq(tables.assetVersions.assetId, assetId)).orderBy(desc(tables.assetVersions.version), asc(tables.assetVersions.createdAt));
        const documents = versions.map(serializeVersion);
        const current = documents.find((version) => version.id === asset.currentVersionId);
        if (current) {
            current.downloadUrl = await this.storage.createDownloadUrl(current.storageKey);
            if (current.thumbnailStorageKey) current.thumbnailUrl = await this.storage.createDownloadUrl(current.thumbnailStorageKey);
        }
        return {
            ...asset,
            kind: asset.kind as AssetDocument["kind"],
            status: asset.status as AssetDocument["status"],
            createdAt: asset.createdAt.toISOString(),
            updatedAt: asset.updatedAt.toISOString(),
            trashedAt: asset.trashedAt?.toISOString() ?? null,
            versions: documents,
        };
    }
}

async function hasProjectAccess(db: Executor, projectId: string, userId: string) {
    const [member] = await db.select({ projectId: tables.projectMembers.projectId }).from(tables.projectMembers).where(and(eq(tables.projectMembers.projectId, projectId), eq(tables.projectMembers.userId, userId))).limit(1);
    return Boolean(member);
}

function serializeVersion(row: typeof tables.assetVersions.$inferSelect): AssetVersionDocument {
    return {
        ...row,
        parentVersionIds: Array.isArray(row.parentVersionIds) ? row.parentVersionIds.filter((value): value is string => typeof value === "string") : [],
        provenance: isRecord(row.provenance) ? row.provenance : {},
        createdAt: row.createdAt.toISOString(),
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
