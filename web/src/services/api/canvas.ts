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

export type CanvasSnapshotSummary = { version: number; source: string; restoredFromVersion: number | null; createdAt: string; restorable?: boolean; restoreReason?: string };
const knownCanvas = new Map<string, CanvasDocument>();
const acknowledge = (canvas: CanvasDraft) =>
    canvas.nodes
        .filter((n) => n.type === "knowledge:document")
        .map((n) => ({ id: n.id, reference: n.metadata?.knowledgeReference ?? null }))
        .sort((a, b) => a.id.localeCompare(b.id));
async function writeCapability(projectId: string, draft: CanvasDraft, expectedRevision: number) {
    const base = knownCanvas.get(projectId);
    if (!draft.nodes.some((n) => n.type === "knowledge:document") && !base?.nodes.some((n) => n.type === "knowledge:document")) return undefined;
    if (!base || base.revision !== expectedRevision) throw new Error("请先读取当前画布后再保存知识节点，原草稿仍保留");
    const ack = acknowledge(base);
    const issued = await platformRequest<{ token: string }>(`${canvasPath(projectId)}/write-capability`, { method: "POST", body: JSON.stringify({ expectedRevision, acknowledgedKnowledgeNodes: ack }) });
    return { token: issued.token, deletedKnowledgeNodeIds: ack.filter((n) => !draft.nodes.some((d) => d.id === n.id)).map((n) => n.id) };
}

export async function getCanvas(projectId: string, signal?: AbortSignal) {
    const canvas = (await platformRequest<{ canvas: CanvasDocument }>(canvasPath(projectId), { signal })).canvas;
    knownCanvas.set(projectId, structuredClone(canvas));
    return canvas;
}

export async function saveCanvas(projectId: string, draft: CanvasDraft, expectedRevision: number) {
    const proof = await writeCapability(projectId, draft, expectedRevision);
    const canvas = (await platformRequest<{ canvas: CanvasDocument }>(canvasPath(projectId), { method: "PUT", body: JSON.stringify({ ...draft, expectedRevision, writeCapability: proof }) })).canvas;
    knownCanvas.set(projectId, structuredClone(canvas));
    return canvas;
}

export async function listCanvasSnapshots(projectId: string) {
    return (await platformRequest<{ snapshots: CanvasSnapshotSummary[] }>(`${canvasPath(projectId)}/snapshots`)).snapshots;
}

export async function restoreCanvasSnapshot(projectId: string, version: number, expectedRevision: number) {
    const canvas = (await platformRequest<{ canvas: CanvasDocument }>(`${canvasPath(projectId)}/snapshots/${version}/restore`, { method: "POST", body: JSON.stringify({ expectedRevision }) })).canvas;
    knownCanvas.set(projectId, structuredClone(canvas));
    return canvas;
}

export async function migrateIndexedDbCanvas(projectId: string, migrationKey: string, draft: CanvasDraft, expectedRevision: number) {
    const result = await platformRequest<{ canvas: CanvasDocument; report: CanvasMigrationReport; alreadyMigrated: boolean }>(`${canvasPath(projectId)}/migrations/indexeddb`, {
        method: "POST",
        body: JSON.stringify({ migrationKey, ...draft, expectedRevision, writeCapability: await writeCapability(projectId, draft, expectedRevision) }),
    });
    knownCanvas.set(projectId, structuredClone(result.canvas));
    return result;
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
    const cloudBacked = "assetVersionId" in value && typeof value.assetVersionId === "string" && Boolean(value.assetVersionId);
    for (const [key, item] of Object.entries(value)) {
        const normalized = key.replace(/[-_\s]/g, "").toLowerCase();
        if (normalized === "thumbnailurl" || (cloudBacked && normalized === "content")) continue;
        if (/apikey|secret|password|authorization|credential|accesstoken|refreshtoken/.test(normalized) || ["token", "authtoken", "bearer"].includes(normalized)) continue;
        if (["baseurl", "proxy", "proxyurl", "webdav", "webdavurl", "channel", "channels"].includes(normalized)) continue;
        output[key] = sanitizeMetadata(item);
    }
    return output;
}
