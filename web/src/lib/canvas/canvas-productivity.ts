import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export type CanvasAlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type CanvasDistributeAxis = "horizontal" | "vertical";
export type CanvasAlignmentGuides = { x?: number; y?: number };

const HORIZONTAL_GAP = 120;
const VERTICAL_GAP = 72;
const COLLISION_GAP = 32;

export function snapCanvasNodes(moving: CanvasNodeData[], stationary: CanvasNodeData[], threshold: number): { dx: number; dy: number; guides: CanvasAlignmentGuides } {
    if (!moving.length) return { dx: 0, dy: 0, guides: {} };
    const movingLeft = Math.min(...moving.map((node) => node.position.x));
    const movingRight = Math.max(...moving.map((node) => node.position.x + node.width));
    const movingTop = Math.min(...moving.map((node) => node.position.y));
    const movingBottom = Math.max(...moving.map((node) => node.position.y + node.height));
    const movingXs = [movingLeft, (movingLeft + movingRight) / 2, movingRight];
    const movingYs = [movingTop, (movingTop + movingBottom) / 2, movingBottom];
    let bestX: { delta: number; guide: number } | null = null;
    let bestY: { delta: number; guide: number } | null = null;
    stationary.forEach((node) => {
        const targetsX = [node.position.x, node.position.x + node.width / 2, node.position.x + node.width];
        const targetsY = [node.position.y, node.position.y + node.height / 2, node.position.y + node.height];
        movingXs.forEach((source) =>
            targetsX.forEach((target) => {
                const delta = target - source;
                if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) bestX = { delta, guide: target };
            }),
        );
        movingYs.forEach((source) =>
            targetsY.forEach((target) => {
                const delta = target - source;
                if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) bestY = { delta, guide: target };
            }),
        );
    });
    const xSnap = bestX as { delta: number; guide: number } | null;
    const ySnap = bestY as { delta: number; guide: number } | null;
    return { dx: xSnap?.delta || 0, dy: ySnap?.delta || 0, guides: { x: xSnap?.guide, y: ySnap?.guide } };
}

export function alignCanvasNodes(nodes: CanvasNodeData[], selectedIds: Set<string>, mode: CanvasAlignMode) {
    const selected = nodes.filter((node) => selectedIds.has(node.id));
    const movable = selected.filter((node) => !node.locked);
    if (selected.length < 2 || !movable.length) return nodes;

    const left = Math.min(...selected.map((node) => node.position.x));
    const right = Math.max(...selected.map((node) => node.position.x + node.width));
    const top = Math.min(...selected.map((node) => node.position.y));
    const bottom = Math.max(...selected.map((node) => node.position.y + node.height));
    const centerX = (left + right) / 2;
    const centerY = (top + bottom) / 2;

    return nodes.map((node) => {
        if (!selectedIds.has(node.id) || node.locked) return node;
        const x = mode === "left" ? left : mode === "center" ? centerX - node.width / 2 : mode === "right" ? right - node.width : node.position.x;
        const y = mode === "top" ? top : mode === "middle" ? centerY - node.height / 2 : mode === "bottom" ? bottom - node.height : node.position.y;
        return x === node.position.x && y === node.position.y ? node : { ...node, position: { x, y } };
    });
}

export function distributeCanvasNodes(nodes: CanvasNodeData[], selectedIds: Set<string>, axis: CanvasDistributeAxis) {
    const selected = nodes.filter((node) => selectedIds.has(node.id)).sort((a, b) => (axis === "horizontal" ? a.position.x - b.position.x : a.position.y - b.position.y));
    if (selected.length < 3) return nodes;

    const first = selected[0];
    const last = selected[selected.length - 1];
    const span = axis === "horizontal" ? last.position.x + last.width - first.position.x : last.position.y + last.height - first.position.y;
    const occupied = selected.reduce((sum, node) => sum + (axis === "horizontal" ? node.width : node.height), 0);
    const gap = (span - occupied) / (selected.length - 1);
    const positions = new Map<string, number>();
    let cursor = axis === "horizontal" ? first.position.x : first.position.y;
    selected.forEach((node) => {
        positions.set(node.id, cursor);
        cursor += (axis === "horizontal" ? node.width : node.height) + gap;
    });

    return nodes.map((node) => {
        const value = positions.get(node.id);
        if (value == null || node.locked || node.id === first.id || node.id === last.id) return node;
        return { ...node, position: axis === "horizontal" ? { ...node.position, x: value } : { ...node.position, y: value } };
    });
}

export function autoLayoutCanvasNodes(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const topLevel = nodes.filter((node) => !node.metadata?.groupId && node.type !== CanvasNodeType.Group);
    const ids = new Set(topLevel.map((node) => node.id));
    const incoming = new Map(topLevel.map((node) => [node.id, 0]));
    const outgoing = new Map(topLevel.map((node) => [node.id, [] as string[]]));

    connections.forEach((edge) => {
        if (!ids.has(edge.fromNodeId) || !ids.has(edge.toNodeId)) return;
        outgoing.get(edge.fromNodeId)?.push(edge.toNodeId);
        incoming.set(edge.toNodeId, (incoming.get(edge.toNodeId) || 0) + 1);
    });

    const queue = topLevel.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
    const levels = new Map<string, number>(queue.map((id) => [id, 0]));
    for (let index = 0; index < queue.length; index += 1) {
        const id = queue[index];
        for (const nextId of outgoing.get(id) || []) {
            levels.set(nextId, Math.max(levels.get(nextId) || 0, (levels.get(id) || 0) + 1));
            const remaining = (incoming.get(nextId) || 0) - 1;
            incoming.set(nextId, remaining);
            if (remaining === 0) queue.push(nextId);
        }
    }
    topLevel.forEach((node) => {
        if (!levels.has(node.id)) levels.set(node.id, 0);
    });

    const originX = Math.min(...topLevel.map((node) => node.position.x), 0);
    const originY = Math.min(...topLevel.map((node) => node.position.y), 0);
    const columnWidths = new Map<number, number>();
    topLevel.forEach((node) => columnWidths.set(levels.get(node.id) || 0, Math.max(columnWidths.get(levels.get(node.id) || 0) || 0, node.width)));
    const columnX = new Map<number, number>();
    let x = originX;
    [...columnWidths.keys()]
        .sort((a, b) => a - b)
        .forEach((level) => {
            columnX.set(level, x);
            x += (columnWidths.get(level) || 0) + HORIZONTAL_GAP;
        });

    const occupied = nodes
        .filter((node) => node.locked || node.type === CanvasNodeType.Group || Boolean(node.metadata?.groupId))
        .map((node) => ({ left: node.position.x - COLLISION_GAP, top: node.position.y - COLLISION_GAP, right: node.position.x + node.width + COLLISION_GAP, bottom: node.position.y + node.height + COLLISION_GAP }));
    const positions = new Map<string, { x: number; y: number }>();
    const rows = new Map<number, CanvasNodeData[]>();
    topLevel
        .filter((node) => !node.locked)
        .forEach((node) => {
            const level = levels.get(node.id) || 0;
            rows.set(level, [...(rows.get(level) || []), node]);
        });
    rows.forEach((column, level) => {
        let y = originY;
        column.forEach((node) => {
            const nextX = columnX.get(level) || originX;
            while (occupied.some((rect) => nextX < rect.right && nextX + node.width > rect.left && y < rect.bottom && y + node.height > rect.top)) y += node.height + VERTICAL_GAP;
            positions.set(node.id, { x: nextX, y });
            occupied.push({ left: nextX - COLLISION_GAP, top: y - COLLISION_GAP, right: nextX + node.width + COLLISION_GAP, bottom: y + node.height + COLLISION_GAP });
            y += node.height + VERTICAL_GAP;
        });
    });

    return nodes.map((node) => (positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node));
}

export function inferConnectionResourceType(node: CanvasNodeData): NonNullable<CanvasConnection["resourceType"]> {
    if (node.type === CanvasNodeType.Image) return "image";
    if (node.type === CanvasNodeType.Video) return "video";
    if (node.type === CanvasNodeType.Audio) return "audio";
    if (node.type === CanvasNodeType.Config) return "json";
    if (node.type === CanvasNodeType.Group) return "asset";
    return node.workflowKind?.includes("prompt") || node.metadata?.generationMode === "text" ? "prompt" : "text";
}

export function inferConnectionRole(source: CanvasNodeData, target: CanvasNodeData): NonNullable<CanvasConnection["role"]> {
    const resourceType = inferConnectionResourceType(source);
    if (target.type === CanvasNodeType.Video) {
        if (resourceType === "audio") return "audio_input";
        if (resourceType === "video") return "video_input";
        if (resourceType === "image") return "first_frame";
    }
    return "data";
}

export function isConnectionRoleCompatible(connection: Pick<CanvasConnection, "resourceType" | "role">) {
    if (connection.role === "first_frame" || connection.role === "last_frame" || connection.role === "identity" || connection.role === "environment" || connection.role === "composition" || connection.role === "motion" || connection.role === "mask")
        return connection.resourceType === "image";
    if (connection.role === "video_input") return connection.resourceType === "video";
    if (connection.role === "audio_input") return connection.resourceType === "audio";
    return true;
}
