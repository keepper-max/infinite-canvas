import { z } from "zod";

import { DomainError } from "./domain.js";

export const CANVAS_CONTRACT_VERSION = 1;
export const MAX_CANVAS_BYTES = 4 * 1024 * 1024;

const finiteNumber = z.number().finite();
const positionSchema = z.object({ x: finiteNumber, y: finiteNumber }).strict();
const viewportSchema = z.object({ x: finiteNumber, y: finiteNumber, k: z.number().finite().min(0.01).max(20) }).strict();
const settingsSchema = z.object({ backgroundMode: z.enum(["lines", "dots", "none"]).default("lines"), showImageInfo: z.boolean().default(false) }).strict();
const metadataSchema = z.record(z.string(), z.unknown());

const nodeSchema = z
    .object({
        id: z.string().min(1).max(160),
        type: z.string().min(1).max(160),
        title: z.string().max(500).default(""),
        position: positionSchema,
        width: z.number().int().min(24).max(20_000),
        height: z.number().int().min(24).max(20_000),
        metadata: metadataSchema.optional(),
        definitionId: z.string().min(1).max(200).optional(),
        definitionVersion: z.number().int().min(1).max(10_000).optional(),
        workflowKind: z.string().min(1).max(200).optional(),
        locked: z.boolean().optional(),
    })
    .strict();

const edgeSchema = z
    .object({
        id: z.string().min(1).max(160),
        fromNodeId: z.string().min(1).max(160),
        toNodeId: z.string().min(1).max(160),
        sourcePortId: z.string().min(1).max(200).optional(),
        targetPortId: z.string().min(1).max(200).optional(),
        resourceType: z.enum(["text", "prompt", "image", "video", "audio", "json", "asset", "timeline"]).optional(),
        role: z.enum(["data", "identity", "environment", "composition", "motion", "first_frame", "last_frame", "video_input", "audio_input", "mask"]).optional(),
        order: z.number().int().min(0).max(100_000).optional(),
        metadata: metadataSchema.optional(),
    })
    .strict();

const canvasWriteSchema = z
    .object({
        expectedRevision: z.number().int().min(0),
        contractVersion: z.literal(CANVAS_CONTRACT_VERSION).default(CANVAS_CONTRACT_VERSION),
        nodes: z.array(nodeSchema).max(1_000),
        edges: z.array(edgeSchema).max(4_000),
        viewport: viewportSchema,
        settings: settingsSchema.default({ backgroundMode: "lines", showImageInfo: false }),
    })
    .strict();

export type CanvasViewport = z.infer<typeof viewportSchema>;
export type CanvasSettings = z.infer<typeof settingsSchema>;
export type CanvasNode = z.infer<typeof nodeSchema> & Required<Pick<z.infer<typeof nodeSchema>, "definitionId" | "definitionVersion" | "workflowKind" | "locked">>;
export type CanvasEdge = z.infer<typeof edgeSchema> & Required<Pick<z.infer<typeof edgeSchema>, "sourcePortId" | "targetPortId" | "resourceType" | "role" | "order">>;

export type CanvasDocument = {
    projectId: string;
    canvasId: string;
    revision: number;
    contractVersion: number;
    nodes: CanvasNode[];
    edges: CanvasEdge[];
    viewport: CanvasViewport;
    settings: CanvasSettings;
    updatedAt: string;
};

export type CanvasWrite = Omit<CanvasDocument, "projectId" | "canvasId" | "revision" | "updatedAt"> & { expectedRevision: number };

export type CanvasMigrationReport = {
    nodeCount: number;
    edgeCount: number;
    excludedPaths: string[];
    pendingResourceRefs: string[];
    needsReviewEdgeIds: string[];
};

export type CanvasSnapshotSummary = { version: number; source: string; restoredFromVersion: number | null; createdAt: string };

export function parseCanvasWrite(raw: unknown): { write: CanvasWrite; report: CanvasMigrationReport } {
    const encodedBytes = Buffer.byteLength(JSON.stringify(raw), "utf8");
    if (encodedBytes > MAX_CANVAS_BYTES) throw new DomainError("CANVAS_TOO_LARGE", "画布结构超过 4MB，请先移除内嵌媒体后重试", 422);
    const parsed = canvasWriteSchema.parse(raw);
    const report: CanvasMigrationReport = { nodeCount: parsed.nodes.length, edgeCount: parsed.edges.length, excludedPaths: [], pendingResourceRefs: [], needsReviewEdgeIds: [] };
    const nodeIds = new Set<string>();
    const nodes = parsed.nodes.map((node, index) => {
        if (nodeIds.has(node.id)) throw new DomainError("DUPLICATE_NODE_ID", `节点 ${node.id} 重复`, 422);
        nodeIds.add(node.id);
        const metadata = sanitizeValue(node.metadata || {}, `nodes[${index}].metadata`, report) as Record<string, unknown>;
        return {
            ...node,
            title: node.title || node.id,
            metadata,
            definitionId: node.definitionId || definitionIdFor(node.type),
            definitionVersion: node.definitionVersion || 1,
            workflowKind: node.workflowKind || workflowKindFor(node.type, metadata),
            locked: node.locked ?? false,
        };
    });
    const edgeIds = new Set<string>();
    const edges = parsed.edges.map((edge, index) => {
        if (edgeIds.has(edge.id)) throw new DomainError("DUPLICATE_EDGE_ID", `连线 ${edge.id} 重复`, 422);
        edgeIds.add(edge.id);
        if (edge.fromNodeId === edge.toNodeId) throw new DomainError("INVALID_CANVAS_EDGE", "节点不能连接到自身", 422);
        if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) throw new DomainError("INVALID_CANVAS_EDGE", `连线 ${edge.id} 引用了不存在的节点`, 422);
        const inferred = inferEdge(nodes.find((node) => node.id === edge.fromNodeId), edge);
        if (!edge.sourcePortId || !edge.targetPortId || !edge.resourceType || !edge.role) report.needsReviewEdgeIds.push(edge.id);
        return {
            ...edge,
            sourcePortId: edge.sourcePortId || "legacy.output",
            targetPortId: edge.targetPortId || "legacy.input",
            resourceType: edge.resourceType || inferred.resourceType,
            role: edge.role || "data",
            order: edge.order ?? index,
            metadata: sanitizeValue(edge.metadata || {}, `edges[${index}].metadata`, report) as Record<string, unknown>,
        };
    });
    return { write: { ...parsed, nodes, edges }, report: finalizeReport(report) };
}

function inferEdge(source: CanvasNode | undefined, edge: z.infer<typeof edgeSchema>) {
    if (edge.resourceType) return { resourceType: edge.resourceType };
    if (source?.type === "text") return { resourceType: "text" as const };
    if (source?.type === "image") return { resourceType: "image" as const };
    if (source?.type === "video") return { resourceType: "video" as const };
    if (source?.type === "audio") return { resourceType: "audio" as const };
    return { resourceType: "asset" as const };
}

function definitionIdFor(type: string) {
    return type.includes(":") ? `plugin.${type}` : `core.${type}`;
}

function workflowKindFor(type: string, metadata: Record<string, unknown>) {
    if (type === "image") return "image.generate";
    if (type === "audio") return "audio.voice";
    if (type === "video") {
        const mode = typeof metadata.videoMode === "string" ? metadata.videoMode.toLowerCase() : "";
        if (mode.includes("multi") || mode.includes("reference")) return "video.multiref";
        if (mode.includes("first") && mode.includes("last")) return "video.flf2v";
        return "video.i2v";
    }
    return "generic";
}

function sanitizeValue(value: unknown, path: string, report: CanvasMigrationReport): unknown {
    if (typeof value === "string") {
        if (/^(blob:|data:(?:image|video|audio)\/)/i.test(value)) {
            report.excludedPaths.push(path);
            return "";
        }
        return value;
    }
    if (Array.isArray(value)) return value.map((item, index) => sanitizeValue(item, `${path}[${index}]`, report));
    if (!value || typeof value !== "object") return value;
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        const normalized = key.replace(/[-_\s]/g, "").toLowerCase();
        const secret = /apikey|secret|password|authorization|credential|accesstoken|refreshtoken/.test(normalized) || ["token", "authtoken", "bearer"].includes(normalized);
        const connectionConfig = ["baseurl", "proxy", "proxyurl", "webdav", "webdavurl", "channel", "channels"].includes(normalized);
        if (secret || connectionConfig) {
            report.excludedPaths.push(`${path}.${key}`);
            continue;
        }
        if (normalized === "storagekey" && typeof item === "string" && item) report.pendingResourceRefs.push(item);
        output[key] = sanitizeValue(item, `${path}.${key}`, report);
    }
    return output;
}

function finalizeReport(report: CanvasMigrationReport): CanvasMigrationReport {
    return {
        ...report,
        excludedPaths: [...new Set(report.excludedPaths)].slice(0, 200),
        pendingResourceRefs: [...new Set(report.pendingResourceRefs)].slice(0, 2_000),
        needsReviewEdgeIds: [...new Set(report.needsReviewEdgeIds)],
    };
}
