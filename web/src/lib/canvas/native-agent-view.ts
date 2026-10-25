import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";
export function agentPanelLayout(width: number, viewportWidth: number) {
    const preferred = Number.isFinite(width) ? Math.min(760, Math.max(360, width)) : 440;
    const overlay = viewportWidth < 1280;
    return { overlay, width: Math.min(preferred, overlay ? viewportWidth : Math.max(360, viewportWidth - 920)) };
}
export function preserveCanvasCenter(view: ViewportTransform, before: { width: number; height: number }, after: { width: number; height: number }) {
    return { ...view, x: view.x + (after.width - before.width) / 2, y: view.y + (after.height - before.height) / 2 };
}
/** Merge resolved media URLs only when the corresponding source is still unchanged. */
export function mergeHydratedNodes(current: CanvasNodeData[], before: CanvasNodeData[], resolved: CanvasNodeData[]) {
    const original = new Map(before.map((n) => [n.id, n])),
        hydrated = new Map(resolved.map((n) => [n.id, n]));
    return current.map((node) => {
        if (!["image", "video", "audio"].includes(node.type)) return node;
        const old = original.get(node.id),
            next = hydrated.get(node.id);
        if (!old?.metadata || !next?.metadata || !node.metadata) return node;
        const metadata = { ...node.metadata };
        if (metadata.assetVersionId === old.metadata.assetVersionId && metadata.storageKey === old.metadata.storageKey && metadata.content === old.metadata.content) {
            metadata.content = next.metadata.content;
            metadata.thumbnailUrl = next.metadata.thumbnailUrl;
        }
        if (metadata.images)
            metadata.images = metadata.images.map((image) => {
                const prior = old.metadata?.images?.find((i) => i.id === image.id),
                    ready = next.metadata?.images?.find((i) => i.id === image.id);
                return prior && ready && image.assetVersionId === prior.assetVersionId && image.storageKey === prior.storageKey && image.content === prior.content ? { ...image, content: ready.content, thumbnailUrl: ready.thumbnailUrl } : image;
            });
        return { ...node, metadata };
    });
}
