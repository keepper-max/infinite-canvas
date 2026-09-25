import localforage from "localforage";

import type { CanvasDocument, CanvasDraft } from "@/services/api/canvas";

export type CanvasCloudCacheEntry = {
    lastSuccessful?: CanvasDocument;
    pendingDraft?: CanvasDraft;
    legacyBackup?: { draft: CanvasDraft; createdAt: string };
};

const cache = localforage.createInstance({ name: "infinite-canvas", storeName: "canvas_cloud_cache", description: "Cloud canvas cache and recoverable drafts" });

export async function getCanvasCloudCache(projectId: string): Promise<CanvasCloudCacheEntry> {
    return (await cache.getItem<CanvasCloudCacheEntry>(projectId)) || {};
}

export async function updateCanvasCloudCache(projectId: string, patch: Partial<CanvasCloudCacheEntry>) {
    const current = await getCanvasCloudCache(projectId);
    const next = { ...current, ...patch };
    await cache.setItem(projectId, next);
    return next;
}

export async function recordSuccessfulCanvas(projectId: string, canvas: CanvasDocument) {
    const current = await getCanvasCloudCache(projectId);
    await cache.setItem(projectId, { ...current, lastSuccessful: canvas, pendingDraft: undefined });
}

export async function recordPendingCanvas(projectId: string, draft: CanvasDraft) {
    await updateCanvasCloudCache(projectId, { pendingDraft: draft });
}

export async function clearPendingCanvas(projectId: string) {
    const current = await getCanvasCloudCache(projectId);
    if (!current.pendingDraft) return;
    await cache.setItem(projectId, { ...current, pendingDraft: undefined });
}

export async function backupLegacyCanvas(projectId: string, draft: CanvasDraft) {
    const current = await getCanvasCloudCache(projectId);
    if (current.legacyBackup) return;
    await cache.setItem(projectId, { ...current, legacyBackup: { draft, createdAt: new Date().toISOString() } });
}
