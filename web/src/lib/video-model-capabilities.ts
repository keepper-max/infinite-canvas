import { modelDefinitionOf, type AiConfig, type ChannelModel, type ModelGenerationMode, type ModelParameterDefinition } from "@/stores/use-config-store";
import { inferVideoRatio } from "@/lib/media-size";

export type VideoGenerationMode = Extract<ModelGenerationMode, "t2v" | "i2v" | "flf2v" | "multiref">;
export type CoreVideoParameterKey = "duration" | "resolution" | "aspectRatio" | "generateAudio" | "watermark" | "bitrateMode" | "outputFormat";

const VIDEO_MODES: VideoGenerationMode[] = ["t2v", "i2v", "flf2v", "multiref"];

export function selectedVideoModel(config: AiConfig, selectedModel?: string) {
    return modelDefinitionOf(config, selectedModel || config.model || config.videoModel);
}

export function isSeedanceVideoModel(model?: ChannelModel) {
    return /seedance/i.test(`${model?.name || ""} ${model?.displayName || ""}`);
}

export function supportedVideoModes(model?: ChannelModel): VideoGenerationMode[] {
    const modes = (model?.modes || []).filter((mode): mode is VideoGenerationMode => VIDEO_MODES.includes(mode as VideoGenerationMode));
    return modes.length ? modes : VIDEO_MODES;
}

export function videoImageReferenceLimit(model: ChannelModel | undefined, mode: VideoGenerationMode) {
    if (mode === "t2v") return 0;
    if (mode === "i2v") return 1;
    if (mode === "flf2v") return 2;
    const value = Number(model?.limits?.maxImages);
    return Number.isFinite(value) && value >= 0 ? value : 9;
}

export function normalizeVideoGenerationMode(value: string | undefined, modes: VideoGenerationMode[], imageCount = 0): VideoGenerationMode {
    const inferred = value === "reference" ? "multiref" : value === "frames" ? (imageCount >= 2 ? "flf2v" : imageCount === 1 ? "i2v" : "t2v") : value;
    return modes.includes(inferred as VideoGenerationMode) ? (inferred as VideoGenerationMode) : modes[0] || "t2v";
}

export function videoParameter(model: ChannelModel | undefined, key: string): ModelParameterDefinition | undefined {
    return model?.parameters?.find((item) => item.key === key);
}

export function supportsVideoParameter(model: ChannelModel | undefined, key: string) {
    if (!model?.parameters?.length) return true;
    return Boolean(videoParameter(model, key));
}

export function videoParameterValue(config: AiConfig, model: ChannelModel | undefined, key: string, fallback = "") {
    const modelValue = model?.name ? config.videoModelParameters?.[model.name]?.[key] : undefined;
    const legacyValue = (
        {
            duration: config.videoSeconds,
            resolution: providerResolutionValue(config.vquality),
            aspectRatio: inferVideoRatio(config.size || "auto"),
            generateAudio: config.videoGenerateAudio,
            watermark: config.videoWatermark,
            bitrateMode: config.videoBitrateMode,
            outputFormat: config.videoOutputFormat,
        } as Partial<Record<CoreVideoParameterKey, string>>
    )[key as CoreVideoParameterKey];
    const configValue = modelValue ?? legacyValue;
    const definition = videoParameter(model, key);
    const options = definition?.options?.map(String) || [];
    const normalized = String(configValue || "");
    const matchedOption = options.find((option) => option.toLowerCase() === normalized.toLowerCase());
    if (normalized && !options.length) return normalized;
    if (matchedOption !== undefined) return matchedOption;
    if (definition?.defaultValue !== undefined && definition.defaultValue !== null) return String(definition.defaultValue);
    return options[0] || fallback;
}

export function updateVideoModelParameter(config: AiConfig, model: ChannelModel | undefined, key: string, value: string) {
    if (!model?.name) return config.videoModelParameters || {};
    return {
        ...(config.videoModelParameters || {}),
        [model.name]: {
            ...(config.videoModelParameters?.[model.name] || {}),
            [key]: value,
        },
    };
}

export function videoParameterPayload(config: AiConfig, model: ChannelModel | undefined): Record<string, unknown> {
    const definitions = model?.parameters || [];
    if (!definitions.length) {
        return {
            duration: Number(config.videoSeconds || 6),
            resolution: providerResolutionValue(config.vquality) || "720p",
            aspectRatio: inferVideoRatio(config.size || "auto"),
            generateAudio: config.videoGenerateAudio === "true",
            watermark: config.videoWatermark === "true",
            bitrateMode: config.videoBitrateMode,
            outputFormat: config.videoOutputFormat,
        };
    }
    return Object.fromEntries(
        definitions.flatMap((definition): Array<[string, unknown]> => {
            const raw = videoParameterValue(config, model, definition.key);
            if (raw === "" && !definition.required) return [];
            if (definition.type === "boolean") return [[definition.key, raw === "true"]];
            if (definition.type === "integer" || definition.type === "number") {
                const value = Number(raw);
                return Number.isFinite(value) ? [[definition.key, value]] : [];
            }
            return [[definition.key, raw]];
        }),
    );
}

function providerResolutionValue(value: string | undefined) {
    const raw = String(value || "")
        .trim()
        .toLowerCase();
    if (!raw) return "";
    if (/^\d+$/.test(raw)) return `${raw}p`;
    return raw;
}
