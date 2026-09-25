import { platformRequest } from "./platform";

export type CloudAssetKind = "character" | "scene" | "prop" | "image" | "video" | "audio" | "subtitle" | "project_export";
export type CloudAssetSource = "upload" | "generation" | "edit" | "compose" | "migration";

export type CloudAssetVersion = {
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
    source: CloudAssetSource;
    sourceJobId: string | null;
    parentVersionIds: string[];
    provenance: Record<string, unknown>;
    thumbnailStorageKey: string | null;
    thumbnailMimeType: string | null;
    thumbnailBytes: number | null;
    thumbnailUrl?: string;
    createdAt: string;
    downloadUrl?: string;
};

export type CloudAsset = {
    id: string;
    projectId: string;
    kind: CloudAssetKind;
    name: string;
    currentVersionId: string | null;
    status: "active" | "trashed";
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    trashedAt: string | null;
    versions: CloudAssetVersion[];
};

type UploadOptions = {
    assetId?: string;
    kind?: CloudAssetKind;
    name?: string;
    source?: CloudAssetSource;
    parentVersionIds?: string[];
    provenance?: Record<string, unknown>;
    signal?: AbortSignal;
};

export async function listCloudAssets(projectId: string, includeTrashed = false, signal?: AbortSignal) {
    const suffix = includeTrashed ? "?status=all" : "";
    return (await platformRequest<{ assets: CloudAsset[] }>(`/api/projects/${encodeURIComponent(projectId)}/assets${suffix}`, { signal })).assets;
}

export async function uploadCloudAsset(projectId: string, file: Blob & { name?: string }, options: UploadOptions = {}) {
    const metadata = await readMediaMetadata(file);
    const sha256 = await digestSha256(file);
    const thumbnail = file.type.startsWith("image/") ? await createImageThumbnail(file) : file.type.startsWith("video/") ? await createVideoThumbnail(file).catch(() => undefined) : undefined;
    const input = {
        assetId: options.assetId,
        kind: options.kind || kindFromMimeType(file.type),
        name: options.name || file.name || "未命名素材",
        mimeType: file.type || "application/octet-stream",
        bytes: file.size,
        sha256,
        ...metadata,
        source: options.source || "upload",
        parentVersionIds: options.parentVersionIds || [],
        provenance: options.provenance || {},
        ...(thumbnail ? { thumbnail: { mimeType: thumbnail.type, bytes: thumbnail.size, sha256: await digestSha256(thumbnail) } } : {}),
    };
    const { upload } = await platformRequest<{ upload: { uploadId: string; assetId: string; uploadUrl: string; headers: Record<string, string>; thumbnailUpload?: { url: string; headers: Record<string, string> } } }>(
        `/api/projects/${encodeURIComponent(projectId)}/assets/uploads`,
        { method: "POST", body: JSON.stringify(input), signal: options.signal },
    );
    const uploaded = await fetch(upload.uploadUrl, { method: "PUT", headers: upload.headers, body: file, signal: options.signal });
    if (!uploaded.ok) throw new Error(`素材上传失败（${uploaded.status}）`);
    if (thumbnail && upload.thumbnailUpload) {
        const thumbnailResponse = await fetch(upload.thumbnailUpload.url, { method: "PUT", headers: upload.thumbnailUpload.headers, body: thumbnail, signal: options.signal });
        if (!thumbnailResponse.ok) throw new Error(`缩略图上传失败（${thumbnailResponse.status}）`);
    }
    return (await platformRequest<{ asset: CloudAsset }>(`/api/projects/${encodeURIComponent(projectId)}/assets/uploads/${encodeURIComponent(upload.uploadId)}/complete`, { method: "POST", body: "{}", signal: options.signal })).asset;
}

export async function setCloudAssetCurrentVersion(assetId: string, versionId: string) {
    return (await platformRequest<{ asset: CloudAsset }>(`/api/assets/${encodeURIComponent(assetId)}/current-version`, { method: "PATCH", body: JSON.stringify({ versionId }) })).asset;
}

export async function trashCloudAsset(assetId: string, reason = "") {
    return (await platformRequest<{ asset: CloudAsset }>(`/api/assets/${encodeURIComponent(assetId)}/trash`, { method: "POST", body: JSON.stringify({ reason }) })).asset;
}

export async function restoreCloudAsset(assetId: string) {
    return (await platformRequest<{ asset: CloudAsset }>(`/api/assets/${encodeURIComponent(assetId)}/restore`, { method: "POST", body: "{}" })).asset;
}

export async function permanentlyDeleteCloudAsset(assetId: string) {
    return (await platformRequest<{ purge: { assetId: string; storageStatus: "completed" | "pending" } }>(`/api/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" })).purge;
}

export async function getCloudAssetDownloadUrl(versionId: string) {
    return (await platformRequest<{ url: string }>(`/api/asset-versions/${encodeURIComponent(versionId)}/download`)).url;
}

export async function getCloudAssetDownloadUrls(versionIds: string[]) {
    if (!versionIds.length) return {};
    return (
        await platformRequest<{ versions: Record<string, { url: string; thumbnailUrl?: string }> }>("/api/asset-versions/downloads", {
            method: "POST",
            body: JSON.stringify({ versionIds: [...new Set(versionIds)] }),
        })
    ).versions;
}

export function currentVersion(asset: CloudAsset) {
    return asset.versions.find((version) => version.id === asset.currentVersionId) || asset.versions[0];
}

function kindFromMimeType(mimeType: string): CloudAssetKind {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    if (mimeType.includes("subtitle") || mimeType === "text/vtt") return "subtitle";
    return "project_export";
}

async function createImageThumbnail(file: Blob) {
    const bitmap = await createImageBitmap(file);
    try {
        const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("无法生成缩略图"))), "image/webp", 0.82));
    } finally {
        bitmap.close();
    }
}

async function createVideoThumbnail(file: Blob) {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    try {
        video.muted = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.src = url;
        await waitForMediaEvent(video, "loadedmetadata");
        const seekTime = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(0.1, video.duration / 2) : 0;
        if (seekTime > 0) {
            video.currentTime = seekTime;
            await waitForMediaEvent(video, "seeked");
        } else if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            await waitForMediaEvent(video, "loadeddata");
        }
        if (!video.videoWidth || !video.videoHeight) throw new Error("无法读取视频首帧");
        const scale = Math.min(1, 512 / Math.max(video.videoWidth, video.videoHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
        return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("无法生成视频缩略图"))), "image/webp", 0.82));
    } finally {
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
    }
}

function waitForMediaEvent(media: HTMLMediaElement, eventName: "loadedmetadata" | "loadeddata" | "seeked") {
    return new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
            cleanup();
            reject(new Error("读取视频素材超时"));
        }, 10_000);
        const cleanup = () => {
            window.clearTimeout(timeout);
            media.removeEventListener(eventName, onReady);
            media.removeEventListener("error", onError);
        };
        const onReady = () => {
            cleanup();
            resolve();
        };
        const onError = () => {
            cleanup();
            reject(new Error("无法读取视频素材"));
        };
        media.addEventListener(eventName, onReady, { once: true });
        media.addEventListener("error", onError, { once: true });
    });
}

async function digestSha256(blob: Blob) {
    try {
        const subtle = globalThis.crypto?.subtle;
        if (subtle) return bytesToHex(new Uint8Array(await subtle.digest("SHA-256", await blob.arrayBuffer())));

        const { sha256 } = await import("@noble/hashes/sha2.js");
        const hasher = sha256.create();
        const reader = blob.stream().getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            hasher.update(value);
        }
        return bytesToHex(hasher.digest());
    } catch {
        throw new Error("素材校验失败，请重新选择素材后重试");
    }
}

function bytesToHex(bytes: Uint8Array) {
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function readMediaMetadata(blob: Blob): Promise<{ width?: number; height?: number; durationMs?: number }> {
    const url = URL.createObjectURL(blob);
    try {
        if (blob.type.startsWith("image/")) return await readImage(url);
        if (blob.type.startsWith("video/")) return await readVideo(url);
        if (blob.type.startsWith("audio/")) return await readAudio(url);
        return {};
    } finally {
        URL.revokeObjectURL(url);
    }
}

function readImage(url: string) {
    return new Promise<{ width?: number; height?: number }>((resolve) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth || undefined, height: image.naturalHeight || undefined });
        image.onerror = () => resolve({});
        image.src = url;
    });
}

function readVideo(url: string) {
    return new Promise<{ width?: number; height?: number; durationMs?: number }>((resolve) => {
        const media = document.createElement("video");
        const done = () => resolve({ width: media.videoWidth || undefined, height: media.videoHeight || undefined, durationMs: Number.isFinite(media.duration) ? Math.round(media.duration * 1000) : undefined });
        media.onloadedmetadata = done;
        media.onerror = done;
        media.src = url;
    });
}

function readAudio(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        const media = document.createElement("audio");
        const done = () => resolve({ durationMs: Number.isFinite(media.duration) ? Math.round(media.duration * 1000) : undefined });
        media.onloadedmetadata = done;
        media.onerror = done;
        media.src = url;
    });
}
