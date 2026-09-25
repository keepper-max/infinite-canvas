import { defaultConfig, resolveModelForCapability, type AiConfig } from "@/stores/use-config-store";
import i18n from "@/i18n";
import { cacheRemoteImagePreview, getCachedImagePreviewUrls, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { imageMetadata, referenceUrl } from "@/lib/canvas/canvas-node-factory";
import type { NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import type { ReferenceImage } from "@/types/image";
import { artifactUrl } from "@/services/api/jobs";
import { getCloudAssetDownloadUrls } from "@/services/api/assets";
import { CanvasNodeType, type CanvasAssistantSession, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

export function imageExtension(dataUrl: string) {
    return dataUrl.match(/^data:image[/]([^;]+)/)?.[1] || dataUrl.match(/image[/]([^;]+)/)?.[1] || "png";
}

export function audioExtension(mimeType?: string) {
    if (mimeType?.includes("wav")) return "wav";
    if (mimeType?.includes("opus")) return "opus";
    if (mimeType?.includes("aac")) return "aac";
    if (mimeType?.includes("flac")) return "flac";
    if (mimeType?.includes("pcm")) return "pcm";
    return "mp3";
}

export function generationReferenceUrls(context: { referenceImages: ReferenceImage[]; referenceVideos: Array<{ storageKey?: string; url?: string }>; referenceAudios?: Array<{ storageKey?: string; url?: string }> }) {
    return [
        ...context.referenceImages.map(referenceUrl).filter((url): url is string => Boolean(url)),
        ...context.referenceVideos.map((video) => video.storageKey || video.url).filter((url): url is string => Boolean(url)),
        ...(context.referenceAudios || []).map((audio) => audio.storageKey || audio.url).filter((url): url is string => Boolean(url)),
    ];
}

export async function resolveMetadataReferences(metadata: CanvasNodeMetadata, nodes: CanvasNodeData[] = []) {
    if (metadata.generationType !== "edit") return [];
    if (!metadata.references?.length) return null;
    const references = await Promise.all(
        metadata.references.map(async (reference, index) => {
            const assetVersionId = reference.startsWith("asset-version:") ? reference.slice("asset-version:".length) : undefined;
            if (assetVersionId) {
                const dataUrl = await artifactUrl({ id: assetVersionId, assetVersionId }).catch(() => "");
                return dataUrl ? { id: `${index}`, name: `reference-${index}.png`, type: "image/png", dataUrl, assetVersionId } : null;
            }
            if (reference.startsWith("image:")) {
                const dataUrl = await resolveImageUrl(reference, "");
                return dataUrl ? { id: `${index}`, name: `reference-${index}.png`, type: "image/png", dataUrl, storageKey: reference } : null;
            }
            const source = nodes.find((node) => node.type === CanvasNodeType.Image && node.metadata?.storageKey === reference);
            if (source?.metadata?.assetVersionId && source.metadata.content)
                return {
                    id: source.id,
                    name: `${source.title || source.id}.png`,
                    type: source.metadata.mimeType || "image/png",
                    dataUrl: source.metadata.content,
                    storageKey: source.metadata.storageKey,
                    assetId: source.metadata.assetId,
                    assetVersionId: source.metadata.assetVersionId,
                };
            return /^(?:data:image\/|https?:\/\/)/i.test(reference) ? { id: `${index}`, name: `reference-${index}.png`, type: "image/png", dataUrl: reference } : null;
        }),
    );
    return references.every(Boolean) ? (references as ReferenceImage[]) : null;
}

export async function hydrateCanvasImages(nodes: CanvasNodeData[], signal?: AbortSignal) {
    const versionIds = nodes.flatMap((node) => [node.metadata?.assetVersionId, ...(node.metadata?.images || []).map((image) => image.assetVersionId)]).filter((id): id is string => Boolean(id));
    const [downloads, cachedPreviews]: [Record<string, { url: string; thumbnailUrl?: string }>, Record<string, string>] = await Promise.all([
        getCloudAssetDownloadUrls(versionIds, signal).catch((error) => {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            return {} as Record<string, { url: string; thumbnailUrl?: string }>;
        }),
        getCachedImagePreviewUrls(versionIds),
    ]);
    for (const versionId of versionIds) cacheRemoteImagePreview(versionId, downloads[versionId]?.thumbnailUrl, signal);
    return Promise.all(
        nodes.map(async (node) => {
            const metadata = node.metadata;
            const content = metadata?.content;
            if ((node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && metadata && (content || metadata.storageKey || metadata.assetVersionId)) {
                const download = metadata.assetVersionId ? downloads[metadata.assetVersionId] : undefined;
                return {
                    ...node,
                    metadata: {
                        ...metadata,
                        content: await hydrateGeneratedMediaUrl(content, metadata.storageKey, download?.url),
                        ...(cachedPreviews[metadata.assetVersionId || ""] || download?.thumbnailUrl ? { thumbnailUrl: cachedPreviews[metadata.assetVersionId || ""] || download?.thumbnailUrl } : {}),
                    },
                };
            }
            if (node.type !== CanvasNodeType.Image || !metadata) return node;
            const images = metadata.images
                ? await Promise.all(
                      metadata.images.map(async (image) =>
                          image.content || image.storageKey || image.assetVersionId
                              ? {
                                    ...image,
                                    content: await hydrateGeneratedImageUrl(image.content, image.storageKey, image.assetVersionId ? downloads[image.assetVersionId]?.url : undefined),
                                    ...(image.assetVersionId && (cachedPreviews[image.assetVersionId] || downloads[image.assetVersionId]?.thumbnailUrl) ? { thumbnailUrl: cachedPreviews[image.assetVersionId] || downloads[image.assetVersionId]!.thumbnailUrl } : {}),
                                }
                              : image,
                      ),
                  )
                : undefined;
            if (metadata.storageKey || metadata.assetVersionId) {
                const download = metadata.assetVersionId ? downloads[metadata.assetVersionId] : undefined;
                return {
                    ...node,
                    metadata: {
                        ...metadata,
                        content: await hydrateGeneratedImageUrl(content, metadata.storageKey, download?.url),
                        ...(images ? { images } : {}),
                        ...(cachedPreviews[metadata.assetVersionId || ""] || download?.thumbnailUrl ? { thumbnailUrl: cachedPreviews[metadata.assetVersionId || ""] || download?.thumbnailUrl } : {}),
                    },
                };
            }
            if (content?.startsWith("[image omitted]")) return { ...node, metadata: { ...metadata, ...imageMetadata(await uploadImage(content)), ...(images ? { images } : {}) } };
            return images ? { ...node, metadata: { ...metadata, images } } : node;
        }),
    );
}

export function prepareCanvasMediaPlaceholders(nodes: CanvasNodeData[]) {
    return nodes.map((node) => {
        const metadata = node.metadata;
        if (!metadata) return node;
        let imagesChanged = false;
        const images = metadata.images?.map((image) => {
            if (!image.assetVersionId) return image;
            if (image.content || image.thumbnailUrl) return image;
            imagesChanged = true;
            return { ...image, content: "", thumbnailUrl: undefined };
        });
        const primaryImage = metadata.images?.find((image) => image.id === (metadata.primaryImageId || metadata.images?.[0]?.id));
        const clearPrimaryContent = Boolean((metadata.assetVersionId || primaryImage?.assetVersionId) && !metadata.content && !metadata.thumbnailUrl);
        if (!clearPrimaryContent && !imagesChanged) return node;
        return {
            ...node,
            metadata: {
                ...metadata,
                ...(clearPrimaryContent ? { content: "", thumbnailUrl: undefined } : {}),
                ...(images ? { images } : {}),
            },
        };
    });
}

async function hydrateGeneratedImageUrl(content = "", storageKey?: string, signedUrl?: string) {
    if (signedUrl) return signedUrl;
    return storageKey ? resolveImageUrl(storageKey, content) : content;
}

async function hydrateGeneratedMediaUrl(content = "", storageKey?: string, signedUrl?: string) {
    if (signedUrl) return signedUrl;
    return storageKey ? resolveMediaUrl(storageKey, content) : content;
}

export async function hydrateAssistantImages(sessions: CanvasAssistantSession[]) {
    const hydrateItem = async <T extends { dataUrl?: string; storageKey?: string }>(item: T) => {
        if (item.storageKey) return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        if (item.dataUrl?.startsWith("data:image/")) {
            const image = await uploadImage(item.dataUrl);
            return { ...item, dataUrl: image.url, storageKey: image.storageKey };
        }
        return item;
    };
    return Promise.all(
        sessions.map(async (session) => ({
            ...session,
            messages: await Promise.all(
                session.messages.map(async (message) => ({
                    ...message,
                    references: await Promise.all((message.references || []).map(hydrateItem)),
                })),
            ),
        })),
    );
}

export function getGenerationCount(count: string) {
    return Math.max(1, Math.min(15, Math.floor(Math.abs(Number(count)) || 1)));
}

export function getInputSummary(inputs: NodeGenerationInput[]) {
    const resources = [...new Map(inputs.flatMap((input) => (input.type === "group" ? input.children : [input])).map((input) => [input.nodeId, input])).values()];
    return {
        textCount: resources.filter((input) => input.type === "text").length,
        imageCount: resources.filter((input) => input.type === "image").length,
        videoCount: resources.filter((input) => input.type === "video").length,
        audioCount: resources.filter((input) => input.type === "audio").length,
    };
}

export function buildGenerationConfig(config: AiConfig, node: CanvasNodeData | undefined, mode: CanvasNodeGenerationMode): AiConfig {
    return {
        ...config,
        model: resolveModelForCapability(config, node?.metadata?.model, mode),
        reasoningEffort: node?.metadata?.reasoningEffort || config.reasoningEffort || defaultConfig.reasoningEffort,
        quality: node?.metadata?.quality || config.quality || defaultConfig.quality,
        size: node?.metadata?.size || config.size || defaultConfig.size,
        background: node?.metadata?.background ?? config.background ?? defaultConfig.background,
        videoSeconds: node?.metadata?.seconds || config.videoSeconds || defaultConfig.videoSeconds,
        vquality: node?.metadata?.vquality || config.vquality || defaultConfig.vquality,
        videoGenerateAudio: node?.metadata?.generateAudio || config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node?.metadata?.watermark || config.videoWatermark || defaultConfig.videoWatermark,
        videoMode: node?.metadata?.videoMode || config.videoMode || defaultConfig.videoMode,
        videoBitrateMode: node?.metadata?.videoBitrateMode || config.videoBitrateMode || defaultConfig.videoBitrateMode,
        videoOutputFormat: node?.metadata?.videoOutputFormat || config.videoOutputFormat || defaultConfig.videoOutputFormat,
        videoModelParameters: node?.metadata?.videoModelParameters || config.videoModelParameters || {},
        audioVoice: node?.metadata?.audioVoice || config.audioVoice || defaultConfig.audioVoice,
        audioFormat: node?.metadata?.audioFormat || config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node?.metadata?.audioSpeed || config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node?.metadata?.audioInstructions || config.audioInstructions || defaultConfig.audioInstructions,
        count: String(node?.metadata?.count || (mode === "image" ? config.canvasImageCount || config.count : config.count) || defaultConfig.count),
    };
}

export function hasResumableVideoTask(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Video && Boolean(node.metadata?.videoTaskId) && !node.metadata?.content && !node.metadata?.storageKey && !node.metadata?.assetVersionId;
}

export function resetInterruptedGeneration(nodes: CanvasNodeData[]) {
    return nodes.map((node) =>
        node.metadata?.status === "loading"
            ? hasResumableVideoTask(node)
                ? node
                : {
                      ...node,
                      metadata: {
                          ...node.metadata,
                          status: "error" as const,
                          errorDetails: i18n.t("canvas.generation.interrupted"),
                          images: node.metadata.images?.map((image) => (image.status === "loading" ? { ...image, status: "error" as const, errorDetails: i18n.t("canvas.generation.interrupted") } : image)),
                          texts: node.metadata.texts?.map((text) => (text.status === "loading" ? { ...text, status: "error" as const, errorDetails: i18n.t("canvas.generation.interrupted") } : text)),
                      },
                  }
            : node,
    );
}

export function isGenerationCanceled(error: unknown) {
    return error instanceof Error && (error.message === i18n.t("common.requestCanceled") || error.name === "AbortError");
}

export function findRetrySourceNode(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const queue = connections.filter((connection) => connection.toNodeId === nodeId).map((connection) => connection.fromNodeId);
    const visited = new Set<string>();
    while (queue.length) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const node = nodes.find((item) => item.id === id);
        if (node?.type === CanvasNodeType.Config) return node;
        connections.filter((connection) => connection.toNodeId === id).forEach((connection) => queue.push(connection.fromNodeId));
    }
    return null;
}

export function sourceNodeReferenceImages(node: CanvasNodeData | null) {
    if (!node || node.type !== CanvasNodeType.Image || !node.metadata?.content) return [];
    return [
        {
            id: node.id,
            name: `${node.title || node.id}.png`,
            type: node.metadata.mimeType || "image/png",
            dataUrl: node.metadata.content,
            storageKey: node.metadata.storageKey,
            assetId: node.metadata.assetId,
            assetVersionId: node.metadata.assetVersionId,
        },
    ];
}

export function isAudioFile(file: File) {
    return file.type.startsWith("audio/") || /\.(mp3|wav)$/i.test(file.name);
}

export function buildAngleLabel(params: CanvasImageAngleParams) {
    const horizontal =
        params.horizontalAngle === 0
            ? i18n.t("canvas.generation.front")
            : params.horizontalAngle > 0
              ? i18n.t("canvas.generation.rotateRight", { angle: params.horizontalAngle })
              : i18n.t("canvas.generation.rotateLeft", { angle: Math.abs(params.horizontalAngle) });
    const pitch = params.pitchAngle === 0 ? i18n.t("canvas.generation.level") : params.pitchAngle > 0 ? i18n.t("canvas.generation.topDown", { angle: params.pitchAngle }) : i18n.t("canvas.generation.lowAngle", { angle: Math.abs(params.pitchAngle) });
    return i18n.t("canvas.generation.angleLabel", { horizontal, pitch, distance: params.cameraDistance.toFixed(1), lens: i18n.t(params.wideAngle ? "canvas.editors.wide" : "canvas.editors.standard") });
}

export function buildAnglePrompt(params: CanvasImageAngleParams) {
    return i18n.t("canvas.generation.anglePrompt", { angle: buildAngleLabel(params) });
}
