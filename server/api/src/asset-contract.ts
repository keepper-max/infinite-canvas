import { z } from "zod";

export const assetKindSchema = z.enum(["character", "scene", "prop", "image", "video", "audio", "subtitle", "project_export"]);
export const assetSourceSchema = z.enum(["upload", "generation", "edit", "compose", "migration"]);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, "SHA-256 格式不正确").transform((value) => value.toLowerCase());
const dimensionSchema = z.number().int().positive().optional();

export const beginAssetUploadSchema = z
    .object({
        assetId: z.string().uuid().optional(),
        kind: assetKindSchema,
        name: z.string().trim().min(1).max(200),
        mimeType: z.string().trim().min(1).max(200),
        bytes: z.number().int().positive(),
        sha256: sha256Schema,
        width: dimensionSchema,
        height: dimensionSchema,
        durationMs: dimensionSchema,
        source: assetSourceSchema.default("upload"),
        parentVersionIds: z.array(z.string().uuid()).max(50).default([]),
        provenance: z.record(z.string(), z.unknown()).default({}),
        thumbnail: z.object({ mimeType: z.string().trim().min(1).max(200), bytes: z.number().int().positive(), sha256: sha256Schema }).strict().optional(),
    })
    .strict();

export const completeAssetUploadSchema = z.object({}).strict();
export const setCurrentVersionSchema = z.object({ versionId: z.string().uuid() }).strict();
export const trashAssetSchema = z.object({ reason: z.string().trim().max(500).default("") }).strict();

export type BeginAssetUpload = z.infer<typeof beginAssetUploadSchema>;

export type AssetVersionDocument = {
    id: string;
    assetId: string;
    version: number;
    storageKey: string;
    mimeType: string;
    bytes: number;
    width: number | null;
    height: number | null;
    durationMs: number | null;
    sha256: string;
    source: string;
    sourceJobId: string | null;
    parentVersionIds: string[];
    provenance: Record<string, unknown>;
    thumbnailStorageKey: string | null;
    thumbnailMimeType: string | null;
    thumbnailBytes: number | null;
    thumbnailUrl?: string;
    createdBy: string;
    createdAt: string;
    downloadUrl?: string;
};

export type AssetDocument = {
    id: string;
    projectId: string;
    kind: z.infer<typeof assetKindSchema>;
    name: string;
    currentVersionId: string | null;
    status: "active" | "trashed";
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    trashedAt: string | null;
    versions: AssetVersionDocument[];
};
