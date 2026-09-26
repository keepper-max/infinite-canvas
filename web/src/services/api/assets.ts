import { platformRequest } from "./platform";

type CloudAssetDownload = { url: string; thumbnailUrl?: string };

const downloadUrlCache = new Map<string, { download: CloudAssetDownload; expiresAt: number }>();
// Bump when the cached response shape changes so older sessions refetch thumbnail URLs.
const DOWNLOAD_CACHE_PREFIX = "canvas-asset-download:v2:";

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

export type CloudStorageUsage = {
    usedBytes: number;
    reservedBytes: number;
    quotaBytes: number | null;
    remainingBytes: number | null;
    unlimited: boolean;
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

export async function getCloudStorageUsage(signal?: AbortSignal) {
    return (await platformRequest<{ usage: CloudStorageUsage }>("/api/assets/storage-usage", { signal })).usage;
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

export async function getCloudAssetDownloadUrls(versionIds: string[], signal?: AbortSignal) {
    if (!versionIds.length) return {};
    const now = Date.now();
    const uniqueIds = [...new Set(versionIds)];
    const versions: Record<string, CloudAssetDownload> = {};
    const missing: string[] = [];
    for (const versionId of uniqueIds) {
        const cached = readCachedDownload(versionId);
        if (cached && cached.expiresAt > now) versions[versionId] = cached.download;
        else missing.push(versionId);
    }
    if (!missing.length) return versions;
    const fetched = (
        await platformRequest<{ versions: Record<string, CloudAssetDownload> }>("/api/asset-versions/downloads", {
            method: "POST",
            body: JSON.stringify({ versionIds: missing }),
            signal,
        })
    ).versions;
    for (const [versionId, download] of Object.entries(fetched)) {
        versions[versionId] = download;
        const expiresAt = downloadExpiry(download);
        if (expiresAt > now) cacheDownload(versionId, { download, expiresAt });
    }
    return versions;
}

export function clearCloudAssetDownloadUrlCache() {
    downloadUrlCache.clear();
    if (typeof sessionStorage === "undefined") return;
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = sessionStorage.key(index);
        if (key?.startsWith(DOWNLOAD_CACHE_PREFIX)) sessionStorage.removeItem(key);
    }
}

export function invalidateCloudAssetDownloadUrls(versionIds: string[]) {
    for (const versionId of new Set(versionIds)) {
        downloadUrlCache.delete(versionId);
        if (typeof sessionStorage === "undefined") continue;
        try {
            sessionStorage.removeItem(`${DOWNLOAD_CACHE_PREFIX}${versionId}`);
        } catch {
            // Memory invalidation is sufficient when session storage is unavailable.
        }
    }
}

function readCachedDownload(versionId: string) {
    const memory = downloadUrlCache.get(versionId);
    if (memory) return memory;
    if (typeof sessionStorage === "undefined") return undefined;
    try {
        const cached = JSON.parse(sessionStorage.getItem(`${DOWNLOAD_CACHE_PREFIX}${versionId}`) || "null") as { download?: CloudAssetDownload; expiresAt?: number } | null;
        if (!cached?.download?.url || typeof cached.expiresAt !== "number") return undefined;
        const entry = { download: cached.download, expiresAt: cached.expiresAt };
        downloadUrlCache.set(versionId, entry);
        return entry;
    } catch {
        return undefined;
    }
}

function cacheDownload(versionId: string, entry: { download: CloudAssetDownload; expiresAt: number }) {
    downloadUrlCache.set(versionId, entry);
    if (typeof sessionStorage === "undefined") return;
    try {
        sessionStorage.setItem(`${DOWNLOAD_CACHE_PREFIX}${versionId}`, JSON.stringify(entry));
    } catch {
        // Memory caching still works when session storage is unavailable or full.
    }
}

function downloadExpiry(download: CloudAssetDownload) {
    if ([download.url, download.thumbnailUrl].filter(Boolean).every((url) => url?.startsWith("/api/media/asset-versions/"))) return Number.MAX_SAFE_INTEGER;
    const expiries = [download.url, download.thumbnailUrl].filter((url): url is string => Boolean(url)).map(signedUrlExpiry).filter((value): value is number => value !== null);
    return expiries.length ? Math.min(...expiries) - 30_000 : 0;
}

function signedUrlExpiry(value: string) {
    try {
        const url = new URL(value, typeof window === "undefined" ? "http://localhost" : window.location.origin);
        const expires = url.searchParams.get("X-Amz-Expires") || url.searchParams.get("x-amz-expires");
        const signedAt = url.searchParams.get("X-Amz-Date") || url.searchParams.get("x-amz-date");
        if (expires && signedAt) {
            const match = signedAt.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
            if (match) return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6])) + Number(expires) * 1000;
        }
        const absolute = url.searchParams.get("Expires") || url.searchParams.get("expires");
        if (absolute && /^\d+$/.test(absolute)) return Number(absolute) * 1000;
    } catch {
        return null;
    }
    return null;
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
