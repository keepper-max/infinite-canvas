import { nanoid } from "nanoid";

import { DRAMA_NODE_TYPES } from "@/components/canvas/nodes/drama-nodes";
import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import type { CanvasConnection, CanvasNodeData, Position } from "@/types/canvas";

type TemplateKey = keyof typeof DRAMA_NODE_TYPES;

const layout: Array<{ key: TemplateKey; x: number; y: number }> = [
    { key: "story", x: 0, y: 240 },
    { key: "writer", x: 460, y: 240 },
    { key: "breakdown", x: 920, y: 240 },
    { key: "character", x: 1380, y: 0 },
    { key: "scene", x: 1380, y: 300 },
    { key: "prop", x: 1380, y: 600 },
    { key: "storyboard", x: 1380, y: 900 },
    { key: "turnaround", x: 1840, y: 0 },
    { key: "panorama", x: 1840, y: 300 },
    { key: "optimize", x: 1980, y: 900 },
    { key: "composition", x: 2320, y: 300 },
    { key: "skill", x: 2580, y: 900 },
    { key: "firstFrame", x: 2820, y: 180 },
    { key: "lastFrame", x: 3300, y: 180 },
    { key: "video", x: 3820, y: 420 },
];

type Link = { from: TemplateKey; to: TemplateKey; role: NonNullable<CanvasConnection["role"]>; resourceType: NonNullable<CanvasConnection["resourceType"]> };

const links: Link[] = [
    { from: "story", to: "writer", role: "data", resourceType: "text" },
    { from: "writer", to: "breakdown", role: "data", resourceType: "json" },
    { from: "breakdown", to: "character", role: "data", resourceType: "json" },
    { from: "breakdown", to: "scene", role: "data", resourceType: "json" },
    { from: "breakdown", to: "prop", role: "data", resourceType: "json" },
    { from: "breakdown", to: "storyboard", role: "data", resourceType: "json" },
    { from: "character", to: "turnaround", role: "data", resourceType: "json" },
    { from: "scene", to: "panorama", role: "data", resourceType: "json" },
    { from: "storyboard", to: "optimize", role: "data", resourceType: "json" },
    { from: "turnaround", to: "composition", role: "identity", resourceType: "image" },
    { from: "panorama", to: "composition", role: "environment", resourceType: "image" },
    { from: "storyboard", to: "composition", role: "data", resourceType: "json" },
    { from: "optimize", to: "skill", role: "data", resourceType: "prompt" },
    { from: "storyboard", to: "skill", role: "data", resourceType: "json" },
    { from: "turnaround", to: "firstFrame", role: "identity", resourceType: "image" },
    { from: "panorama", to: "firstFrame", role: "environment", resourceType: "image" },
    { from: "composition", to: "firstFrame", role: "composition", resourceType: "image" },
    { from: "firstFrame", to: "lastFrame", role: "first_frame", resourceType: "image" },
    { from: "skill", to: "video", role: "data", resourceType: "prompt" },
    { from: "turnaround", to: "video", role: "identity", resourceType: "image" },
    { from: "panorama", to: "video", role: "environment", resourceType: "image" },
    { from: "composition", to: "video", role: "composition", resourceType: "image" },
    { from: "firstFrame", to: "video", role: "first_frame", resourceType: "image" },
    { from: "lastFrame", to: "video", role: "last_frame", resourceType: "image" },
];

export function buildDramaTemplate(origin: Position): { nodes: CanvasNodeData[]; connections: CanvasConnection[] } {
    const byKey = new Map<TemplateKey, CanvasNodeData>();
    const nodes = layout.map(({ key, x, y }) => {
        const node = createCanvasNode(DRAMA_NODE_TYPES[key], { x: origin.x + x, y: origin.y + y });
        byKey.set(key, node);
        return node;
    });
    const connections = links.map((link, index) => {
        const source = byKey.get(link.from)!;
        const target = byKey.get(link.to)!;
        return {
            id: nanoid(),
            fromNodeId: source.id,
            toNodeId: target.id,
            sourcePortId: `${source.workflowKind}.output`,
            targetPortId: `${target.workflowKind}.input`,
            role: link.role,
            resourceType: link.resourceType,
            order: index,
            metadata: { templateId: "drama-production-v1", templateVersion: 1 },
        } satisfies CanvasConnection;
    });
    return { nodes, connections };
}
