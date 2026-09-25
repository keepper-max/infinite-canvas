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
    .strict()
    .superRefine((input, context) => {
        if (!mimeMatchesKind(input.kind, input.mimeType)) context.addIssue({ code: "custom", path: ["mimeType"], message: "文件类型与素材类别不匹配" });
        if (input.thumbnail && !input.thumbnail.mimeType.toLowerCase().startsWith("image/")) context.addIssue({ code: "custom", path: ["thumbnail", "mimeType"], message: "缩略图必须是图片" });
    });

export const completeAssetUploadSchema = z.object({}).strict();
export const setCurrentVersionSchema = z.object({ versionId: z.string().uuid() }).strict();
export const trashAssetSchema = z.object({ reason: z.string().trim().max(500).default("") }).strict();
export const assetVersionDownloadsSchema = z.object({ versionIds: z.array(z.string().uuid()).max(200) }).strict();

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

function mimeMatchesKind(kind: z.infer<typeof assetKindSchema>, mimeType: string) {
    const normalized = mimeType.toLowerCase();
    if (["character", "scene", "prop", "image"].includes(kind)) return normalized.startsWith("image/");
    if (kind === "video") return normalized.startsWith("video/");
    if (kind === "audio") return normalized.startsWith("audio/");
    if (kind === "subtitle") return ["text/plain", "text/vtt", "application/x-subrip"].includes(normalized);
    return ["application/json", "application/zip", "application/x-zip-compressed"].includes(normalized);
}
