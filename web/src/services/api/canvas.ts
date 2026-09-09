import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import { platformRequest } from "./platform";

export type CanvasSettings = { backgroundMode: CanvasBackgroundMode; showImageInfo: boolean };

export type CanvasDraft = {
    contractVersion: 1;
    nodes: CanvasNodeData[];
    edges: CanvasConnection[];
    viewport: ViewportTransform;
    settings: CanvasSettings;
};

export type CanvasDocument = CanvasDraft & {
    projectId: string;
    canvasId: string;
    revision: number;
    updatedAt: string;
};

export type CanvasMigrationReport = {
    nodeCount: number;
    edgeCount: number;
    excludedPaths: string[];
    pendingResourceRefs: string[];
    needsReviewEdgeIds: string[];
};

export type CanvasSnapshotSummary = { version: number; source: string; restoredFromVersion: number | null; createdAt: string };

export async function getCanvas(projectId: string, signal?: AbortSignal) {
    return (await platformRequest<{ canvas: CanvasDocument }>(canvasPath(projectId), { signal })).canvas;
}

export async function saveCanvas(projectId: string, draft: CanvasDraft, expectedRevision: number) {
    return (await platformRequest<{ canvas: CanvasDocument }>(canvasPath(projectId), { method: "PUT", body: JSON.stringify({ ...draft, expectedRevision }) })).canvas;
}

export async function listCanvasSnapshots(projectId: string) {
    return (await platformRequest<{ snapshots: CanvasSnapshotSummary[] }>(`${canvasPath(projectId)}/snapshots`)).snapshots;
}

export async function restoreCanvasSnapshot(projectId: string, version: number, expectedRevision: number) {
    return (await platformRequest<{ canvas: CanvasDocument }>(`${canvasPath(projectId)}/snapshots/${version}/restore`, { method: "POST", body: JSON.stringify({ expectedRevision }) })).canvas;
}

export async function migrateIndexedDbCanvas(projectId: string, migrationKey: string, draft: CanvasDraft, expectedRevision: number) {
    return platformRequest<{ canvas: CanvasDocument; report: CanvasMigrationReport; alreadyMigrated: boolean }>(`${canvasPath(projectId)}/migrations/indexeddb`, {
        method: "POST",
        body: JSON.stringify({ migrationKey, ...draft, expectedRevision }),
    });
}

export function createCanvasDraft(nodes: CanvasNodeData[], edges: CanvasConnection[], viewport: ViewportTransform, settings: CanvasSettings): CanvasDraft {
    return {
        contractVersion: 1,
        nodes: nodes.map((node) => ({ ...node, metadata: sanitizeMetadata(node.metadata || {}) as CanvasNodeData["metadata"] })),
        edges: edges.map((edge, order) => ({ ...edge, order: edge.order ?? order, metadata: sanitizeMetadata(edge.metadata || {}) as Record<string, unknown> })),
        viewport,
        settings,
    };
}

function canvasPath(projectId: string) {
    return `/api/projects/${encodeURIComponent(projectId)}/canvas`;
}

function sanitizeMetadata(value: unknown): unknown {
    if (typeof value === "string") return /^(blob:|data:(?:image|video|audio)\/)/i.test(value) ? "" : value;
    if (Array.isArray(value)) return value.map((item) => sanitizeMetadata(item));
    if (!value || typeof value !== "object") return value;
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        const normalized = key.replace(/[-_\s]/g, "").toLowerCase();
        if (/apikey|secret|password|authorization|credential|accesstoken|refreshtoken/.test(normalized) || ["token", "authtoken", "bearer"].includes(normalized)) continue;
        if (["baseurl", "proxy", "proxyurl", "webdav", "webdavurl", "channel", "channels"].includes(normalized)) continue;
        output[key] = sanitizeMetadata(item);
    }
    return output;
}
