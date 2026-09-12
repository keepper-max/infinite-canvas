import { modelDefinitionOf, type AiConfig, type ChannelModel, type ModelGenerationMode, type ModelParameterDefinition } from "@/stores/use-config-store";
import { inferVideoRatio } from "@/lib/media-size";

export type VideoGenerationMode = Extract<ModelGenerationMode, "t2v" | "i2v" | "flf2v" | "multiref">;
export type VideoParameterKey = "duration" | "resolution" | "aspectRatio" | "generateAudio" | "watermark" | "bitrateMode" | "outputFormat";

const VIDEO_MODES: VideoGenerationMode[] = ["t2v", "i2v", "flf2v", "multiref"];

export function selectedVideoModel(config: AiConfig, selectedModel?: string) {
    return modelDefinitionOf(config, selectedModel || config.model || config.videoModel);
}

export function supportedVideoModes(model?: ChannelModel): VideoGenerationMode[] {
    const modes = (model?.modes || []).filter((mode): mode is VideoGenerationMode => VIDEO_MODES.includes(mode as VideoGenerationMode));
    return modes.length ? modes : VIDEO_MODES;
}

export function normalizeVideoGenerationMode(value: string | undefined, modes: VideoGenerationMode[], imageCount = 0): VideoGenerationMode {
    const inferred = value === "reference" ? "multiref" : value === "frames" ? (imageCount >= 2 ? "flf2v" : imageCount === 1 ? "i2v" : "t2v") : value;
    return modes.includes(inferred as VideoGenerationMode) ? (inferred as VideoGenerationMode) : modes[0] || "t2v";
}

export function videoParameter(model: ChannelModel | undefined, key: VideoParameterKey): ModelParameterDefinition | undefined {
    return model?.parameters?.find((item) => item.key === key);
}

export function supportsVideoParameter(model: ChannelModel | undefined, key: VideoParameterKey) {
    if (!model?.parameters?.length) return true;
    return Boolean(videoParameter(model, key));
}

export function videoParameterValue(config: AiConfig, model: ChannelModel | undefined, key: VideoParameterKey, fallback: string) {
    const configValue = {
        duration: config.videoSeconds,
        resolution: config.vquality ? `${config.vquality.replace(/p$/i, "")}p` : "",
        aspectRatio: inferVideoRatio(config.size || "auto"),
        generateAudio: config.videoGenerateAudio,
        watermark: config.videoWatermark,
        bitrateMode: config.videoBitrateMode,
        outputFormat: config.videoOutputFormat,
    }[key];
    const definition = videoParameter(model, key);
    const options = definition?.options?.map(String) || [];
    const normalized = key === "resolution" ? String(configValue || "").toLowerCase() : String(configValue || "");
    if (!options.length || options.some((option) => option.toLowerCase() === normalized.toLowerCase())) return normalized || fallback;
    if (definition?.defaultValue !== undefined && definition.defaultValue !== null) return String(definition.defaultValue);
    return options[0] || fallback;
}
