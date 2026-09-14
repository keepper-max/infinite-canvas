import { type ReactNode } from "react";
import { Input, InputNumber, Select, Slider, Switch } from "antd";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { clampVideoSeconds, computeVideoSize, inferVideoRatio, parseVideoResolution, readVideoDimensions, VIDEO_SECONDS_MAX, VIDEO_SECONDS_MIN, videoRatioOptions } from "@/lib/media-size";
import { type AiConfig } from "@/stores/use-config-store";
import { isSeedanceVideoModel, normalizeVideoGenerationMode, selectedVideoModel, supportedVideoModes, supportsVideoParameter, updateVideoModelParameter, videoParameter, videoParameterValue } from "@/lib/video-model-capabilities";

const resolutionOptions = [
    { value: "480", label: "480p" },
    { value: "720", label: "720p" },
    { value: "1080", label: "1080p" },
];
const videoModeOptions = [
    { value: "t2v", labelKey: "t2v" },
    { value: "i2v", labelKey: "i2v" },
    { value: "flf2v", labelKey: "flf2v" },
    { value: "multiref", labelKey: "multiref" },
] as const;

export const videoResolutionOptions = resolutionOptions.map((item) => ({ value: item.value, label: item.label }));
export const videoSizeOptions = videoRatioOptions.map((item) => ({
    value: item.value,
    get label() {
        return item.value === "auto" ? i18n.t("settingsPanels.common.auto") : item.value;
    },
}));
export const videoSecondsRange = { min: VIDEO_SECONDS_MIN, max: VIDEO_SECONDS_MAX };

export type VideoSettingKey = keyof Pick<AiConfig, "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoMode" | "videoBitrateMode" | "videoOutputFormat" | "videoModelParameters">;

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: <K extends VideoSettingKey>(key: K, value: AiConfig[K]) => void;
    theme: CanvasTheme;
    selectedModel?: string;
    showTitle?: boolean;
    className?: string;
    forceAdaptiveRatio?: boolean;
};

export function VideoSettingsPanel({ config, onConfigChange, theme, selectedModel, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", forceAdaptiveRatio = false }: VideoSettingsPanelProps) {
    const { t } = useTranslation();
    const model = selectedVideoModel(config, selectedModel);
    const hasDynamicSchema = Boolean(model?.parameters?.length);
    const modes = supportedVideoModes(model);
    const videoMode = normalizeVideoGenerationMode(config.videoMode, modes);
    const durationDefinition = videoParameter(model, "duration");
    const durationValue = videoParameterValue(config, model, "duration", "6");
    const durationControl = readDurationControl(durationDefinition);
    const parsedSeconds = Number(durationValue === "-1" ? 6 : clampVideoSeconds(durationValue));
    const seconds = Number.isFinite(parsedSeconds) ? Math.max(durationControl.min, Math.min(durationControl.max, parsedSeconds)) : durationControl.min;
    const resolutionValue = normalizeVideoResolutionValue(videoParameterValue(config, model, "resolution", "720p"));
    const resolution = parseVideoResolution(resolutionValue);
    const extensionRatio = forceAdaptiveRatio && isSeedanceVideoModel(model);
    const selectedRatio = extensionRatio ? "auto" : inferVideoRatio(videoParameterValue(config, model, "aspectRatio", "auto"));
    const dimensions = readVideoDimensions(config.size || "auto", resolution, selectedRatio);
    const resolutionValues = (videoParameter(model, "resolution")?.options?.map(String) || resolutionOptions.map((item) => item.value)).map(normalizeVideoResolutionValue);
    const ratioValues = extensionRatio ? ["auto"] : (videoParameter(model, "aspectRatio")?.options?.map((value) => inferVideoRatio(String(value))) || videoRatioOptions.map((item) => item.value));
    const additionalParameters = (model?.parameters || []).filter((definition) => !CORE_VIDEO_PARAMETER_KEYS.has(definition.key));
    const updateModelParameters = (values: Record<string, string>) => {
        const next = Object.entries(values).reduce((parameters, [key, value]) => updateVideoModelParameter({ ...config, videoModelParameters: parameters }, model, key, value), config.videoModelParameters);
        onConfigChange("videoModelParameters", next);
    };
    const updateCoreParameter = <K extends VideoSettingKey>(configKey: K, value: AiConfig[K], parameterKey: string, parameterValue = String(value)) => {
        onConfigChange(configKey, value);
        updateModelParameters({ [parameterKey]: parameterValue });
    };
    const providerResolution = (value: string) =>
        videoParameter(model, "resolution")
            ?.options?.map(String)
            .find((option) => normalizeVideoResolutionValue(option) === value) || value;
    const updateAdditionalParameter = (key: string, value: string) => onConfigChange("videoModelParameters", updateVideoModelParameter(config, model, key, value));
    const applySize = (nextResolution: string, ratio: string) => {
        onConfigChange("vquality", nextResolution);
        onConfigChange("size", computeVideoSize(nextResolution, ratio));
        updateModelParameters({ resolution: providerResolution(nextResolution), aspectRatio: ratio });
    };
    const selectResolution = (nextResolution: string) => {
        if (selectedRatio === "auto") updateCoreParameter("vquality", nextResolution, "resolution", providerResolution(nextResolution));
        else applySize(nextResolution, selectedRatio);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.video.title")}</div> : null}
                {supportsVideoParameter(model, "resolution") ? (
                    <SettingGroup title={t("settingsPanels.video.quality")} color={theme.node.muted}>
                        <div className="grid grid-cols-4 gap-2.5">
                            {resolutionValues.map((value) => (
                                <OptionPill key={value} selected={resolutionValue === value} theme={theme} onClick={() => selectResolution(value)}>
                                    {videoResolutionLabel(value)}
                                </OptionPill>
                            ))}
                        </div>
                    </SettingGroup>
                ) : null}
                {!hasDynamicSchema && supportsVideoParameter(model, "aspectRatio") ? (
                    <SettingGroup title={t("settingsPanels.video.size")} color={theme.node.muted}>
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                            <DimensionInput prefix="W" value={dimensions.width} disabled={selectedRatio === "auto"} theme={theme} onChange={(value) => updateDimension("width", value, dimensions, onConfigChange)} />
                            <span className="text-lg opacity-45">↔</span>
                            <DimensionInput prefix="H" value={dimensions.height} disabled={selectedRatio === "auto"} theme={theme} onChange={(value) => updateDimension("height", value, dimensions, onConfigChange)} />
                        </div>
                    </SettingGroup>
                ) : null}
                {supportsVideoParameter(model, "aspectRatio") ? (
                    <SettingGroup title={t("settingsPanels.video.ratio")} color={theme.node.muted}>
                        <div className="grid grid-cols-4 gap-2.5">
                            {videoRatioOptions
                                .filter((item) => ratioValues.includes(item.value))
                                .map((item) => (
                                    <button
                                        key={item.value}
                                        type="button"
                                        className="flex h-[72px] flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent text-sm transition enabled:cursor-pointer enabled:hover:opacity-80 disabled:cursor-default"
                                        style={{ borderColor: selectedRatio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                        disabled={extensionRatio}
                                        onMouseDown={(event) => event.stopPropagation()}
                                        onClick={() => applySize(resolutionValue, item.value)}
                                    >
                                        <SizePreview width={item.width} height={item.height} color={theme.node.text} />
                                        <span>{item.value === "auto" ? t("settingsPanels.common.auto") : item.value}</span>
                                    </button>
                                ))}
                        </div>
                        {extensionRatio ? <div className="mt-2 text-xs" style={{ color: theme.node.muted }}>{t("settingsPanels.video.extensionRatioHint")}</div> : null}
                    </SettingGroup>
                ) : null}
                {supportsVideoParameter(model, "duration") ? (
                    <SettingGroup title={t("settingsPanels.video.seconds")} color={theme.node.muted}>
                        {durationControl.continuous ? (
                            <div className="space-y-2.5 rounded-xl border px-3 py-2.5" style={{ borderColor: theme.node.stroke }} onMouseDown={(event) => event.stopPropagation()}>
                                <div className="flex justify-end">
                                    <div className="inline-flex rounded-full border p-0.5 text-xs" style={{ borderColor: theme.node.stroke }}>
                                        {durationControl.smart ? (
                                            <button
                                                type="button"
                                                className="h-7 rounded-full px-3 transition"
                                                style={{ background: durationValue === "-1" ? theme.node.text : "transparent", color: durationValue === "-1" ? theme.node.fill : theme.node.muted }}
                                                onClick={() => updateCoreParameter("videoSeconds", "-1", "duration")}
                                            >
                                                {t("settingsPanels.video.smart")}
                                            </button>
                                        ) : null}
                                        <span
                                            className="grid h-7 min-w-14 place-items-center rounded-full px-3 font-semibold"
                                            style={{ background: durationValue === "-1" ? "transparent" : theme.node.text, color: durationValue === "-1" ? theme.node.muted : theme.node.fill }}
                                        >
                                            {seconds}s
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 text-[11px]" style={{ color: theme.node.muted }}>
                                    <span>{durationControl.min}s</span>
                                    <Slider
                                        className="min-w-0 flex-1"
                                        min={durationControl.min}
                                        max={durationControl.max}
                                        step={durationControl.step}
                                        value={seconds}
                                        onChange={(value) => updateCoreParameter("videoSeconds", String(Array.isArray(value) ? value[0] : value), "duration")}
                                    />
                                    <span>{durationControl.max}s</span>
                                </div>
                            </div>
                        ) : durationDefinition?.options?.length ? (
                            <Select
                                className="w-full"
                                value={durationValue}
                                options={durationDefinition.options.map((value) => ({ value: String(value), label: String(value) === "-1" ? t("settingsPanels.video.smart") : `${value}s` }))}
                                onChange={(value) => updateCoreParameter("videoSeconds", value, "duration")}
                                getPopupContainer={(trigger) => trigger.parentElement || document.body}
                            />
                        ) : (
                            <div className="flex items-center gap-3" onMouseDown={(event) => event.stopPropagation()}>
                                <Slider
                                    className="min-w-0 flex-1"
                                    min={VIDEO_SECONDS_MIN}
                                    max={VIDEO_SECONDS_MAX}
                                    step={1}
                                    value={seconds}
                                    onChange={(value) => updateCoreParameter("videoSeconds", String(Array.isArray(value) ? value[0] : value), "duration")}
                                />
                                <SecondsInput value={seconds} theme={theme} onCommit={(value) => updateCoreParameter("videoSeconds", String(value), "duration")} />
                                <span className="shrink-0 text-sm" style={{ color: theme.node.muted }}>
                                    s
                                </span>
                            </div>
                        )}
                    </SettingGroup>
                ) : null}
                <SettingGroup title={t("settingsPanels.video.mode")} color={theme.node.muted}>
                    <div className="grid grid-cols-2 gap-2.5">
                        {videoModeOptions
                            .filter((item) => modes.includes(item.value))
                            .map((item) => (
                                <OptionPill key={item.value} selected={videoMode === item.value} theme={theme} onClick={() => onConfigChange("videoMode", item.value)}>
                                    {t(`settingsPanels.video.modes.${item.labelKey}`)}
                                </OptionPill>
                            ))}
                    </div>
                    <div className="text-xs leading-5" style={{ color: theme.node.muted }}>
                        {t(`settingsPanels.video.modeHints.${videoMode}`)}
                    </div>
                </SettingGroup>
                {supportsVideoParameter(model, "bitrateMode") ? (
                    <SelectSetting
                        title={t("settingsPanels.video.bitrateMode")}
                        value={videoParameterValue(config, model, "bitrateMode", "high")}
                        definition={videoParameter(model, "bitrateMode")}
                        onChange={(value) => updateCoreParameter("videoBitrateMode", value, "bitrateMode")}
                    />
                ) : null}
                {supportsVideoParameter(model, "outputFormat") ? (
                    <SelectSetting
                        title={t("settingsPanels.video.outputFormat")}
                        value={videoParameterValue(config, model, "outputFormat", "mp4")}
                        definition={videoParameter(model, "outputFormat")}
                        onChange={(value) => updateCoreParameter("videoOutputFormat", value, "outputFormat")}
                    />
                ) : null}
                {supportsVideoParameter(model, "generateAudio") ? (
                    <SwitchSetting
                        title={t("settingsPanels.video.generateAudio")}
                        checked={videoParameterValue(config, model, "generateAudio", "false") === "true"}
                        onChange={(value) => updateCoreParameter("videoGenerateAudio", String(value), "generateAudio")}
                    />
                ) : null}
                {supportsVideoParameter(model, "watermark") ? (
                    <SwitchSetting title={t("settingsPanels.video.watermark")} checked={videoParameterValue(config, model, "watermark", "false") === "true"} onChange={(value) => updateCoreParameter("videoWatermark", String(value), "watermark")} />
                ) : null}
                {additionalParameters.map((definition) => (
                    <DynamicParameterSetting key={definition.key} definition={definition} value={videoParameterValue(config, model, definition.key)} onChange={(value) => updateAdditionalParameter(definition.key, value)} />
                ))}
            </div>
        </ImageSettingsTheme>
    );
}

function readDurationControl(definition?: { options?: Array<string | number | boolean>; min?: number; max?: number; step?: number }) {
    const smart = definition?.options?.some((value) => String(value) === "-1") || false;
    const options = Array.from(new Set((definition?.options || []).map(Number).filter((value) => Number.isFinite(value) && value >= VIDEO_SECONDS_MIN && value <= VIDEO_SECONDS_MAX))).sort((left, right) => left - right);
    const min = Number.isFinite(definition?.min) ? Math.max(VIDEO_SECONDS_MIN, Number(definition?.min)) : (options[0] ?? VIDEO_SECONDS_MIN);
    const max = Number.isFinite(definition?.max) ? Math.min(VIDEO_SECONDS_MAX, Number(definition?.max)) : (options.at(-1) ?? VIDEO_SECONDS_MAX);
    const inferredStep = options.length > 1 ? options[1] - options[0] : 1;
    const step = Number.isFinite(definition?.step) && Number(definition?.step) > 0 ? Number(definition?.step) : inferredStep;
    const continuous = !options.length || (options.length > 1 && options.every((value, index) => index === 0 || value - options[index - 1] === step));
    return { smart, min, max, step, continuous };
}

export function videoResolutionLabel(value: string) {
    const normalized = normalizeVideoResolutionValue(value);
    return /k$/i.test(normalized) ? normalized.toUpperCase() : `${normalized}p`;
}

export function videoSizeLabel(value: string) {
    const ratio = inferVideoRatio(value);
    return ratio === "auto" ? i18n.t("settingsPanels.video.adaptive") : ratio;
}

export function videoSecondsLabel(value: string) {
    if (String(value).trim() === "-1") return i18n.t("settingsPanels.video.smart");
    return `${value || "6"}s`;
}

export function videoModeLabel(value: string) {
    return i18n.t(`settingsPanels.video.modes.${normalizeVideoModeValue(value)}`);
}

export function normalizeVideoModeValue(value: string | undefined) {
    return value === "reference" ? "multiref" : ["t2v", "i2v", "flf2v", "multiref"].includes(value || "") ? value! : "t2v";
}

export function normalizeVideoSizeValue(value: string, resolution = "720") {
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    const ratio = inferVideoRatio(value);
    return ratio === "auto" ? "auto" : computeVideoSize(resolution, ratio);
}

export function normalizeVideoResolutionValue(value: string) {
    const raw = String(value || "")
        .trim()
        .toLowerCase();
    if (/^\d+p$/.test(raw)) return raw.slice(0, -1);
    if (/^\d+$/.test(raw) || /^\d+(?:\.\d+)?k$/.test(raw)) return raw;
    return parseVideoResolution(raw);
}

function updateDimension(key: "width" | "height", value: number | null, dimensions: { width: number; height: number }, onConfigChange: VideoSettingsPanelProps["onConfigChange"]) {
    const next = Math.max(1, Math.floor(value || dimensions[key] || 720));
    onConfigChange("size", `${key === "width" ? next : dimensions.width}x${key === "height" ? next : dimensions.height}`);
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            disabled={disabled}
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function SettingGroup({ title, description, color, children }: { title: string; description?: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }} title={description}>
                {title}
            </div>
            {children}
        </div>
    );
}

function SelectSetting({ title, value, definition, onChange }: { title: string; value: string; definition?: { options?: Array<string | number | boolean> }; onChange: (value: string) => void }) {
    return (
        <SettingGroup title={title} color="currentColor">
            <Select className="w-full" value={value} options={(definition?.options || []).map((option) => ({ value: String(option), label: String(option) }))} onChange={onChange} />
        </SettingGroup>
    );
}

const CORE_VIDEO_PARAMETER_KEYS = new Set(["duration", "resolution", "aspectRatio", "generateAudio", "watermark", "bitrateMode", "outputFormat"]);

const PARAMETER_LABELS: Record<string, [string, string]> = {
    style: ["风格", "Style"],
    promptExpansion: ["提示词扩展", "Prompt expansion"],
    promptExtend: ["提示词扩展", "Prompt expansion"],
    seed: ["随机种子", "Seed"],
    size: ["输出尺寸", "Output size"],
    quality: ["生成质量", "Generation quality"],
    movementAmplitude: ["运动幅度", "Movement amplitude"],
};

function parameterLabel(key: string) {
    const labels = PARAMETER_LABELS[key];
    if (labels) return i18n.resolvedLanguage?.startsWith("zh") ? labels[0] : labels[1];
    return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (character) => character.toUpperCase());
}

function DynamicParameterSetting({ definition, value, onChange }: { definition: NonNullable<ReturnType<typeof videoParameter>>; value: string; onChange: (value: string) => void }) {
    const title = parameterLabel(definition.key);
    if (definition.type === "boolean") return <SwitchSetting title={title} description={definition.description} checked={value === "true"} onChange={(checked) => onChange(String(checked))} />;
    if (definition.options?.length)
        return (
            <SettingGroup title={title} description={definition.description} color="currentColor">
                <Select className="w-full" value={value || undefined} options={definition.options.map((option) => ({ value: String(option), label: String(option) }))} onChange={onChange} />
            </SettingGroup>
        );
    if (definition.type === "integer" || definition.type === "number") {
        return (
            <SettingGroup title={title} description={definition.description} color="currentColor">
                <InputNumber
                    className="w-full"
                    value={value === "" ? null : Number(value)}
                    min={definition.min}
                    max={definition.max}
                    step={definition.step || (definition.type === "integer" ? 1 : undefined)}
                    precision={definition.type === "integer" ? 0 : undefined}
                    onChange={(next) => onChange(next === null ? "" : String(next))}
                />
            </SettingGroup>
        );
    }
    return (
        <SettingGroup title={title} description={definition.description} color="currentColor">
            <Input value={value} onChange={(event) => onChange(event.target.value)} />
        </SettingGroup>
    );
}

function SwitchSetting({ title, description, checked, onChange }: { title: string; description?: string; checked: boolean; onChange: (value: boolean) => void }) {
    return (
        <div className="flex items-center justify-between gap-3 text-sm">
            <span title={description}>{title}</span>
            <Switch checked={checked} onChange={onChange} />
        </div>
    );
}

function SecondsInput({ value, theme, onCommit }: { value: number; theme: CanvasTheme; onCommit: (value: number) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = Number(clampVideoSeconds(input.value));
        input.value = String(next);
        onCommit(next);
    };

    return (
        <label className="flex h-9 w-[68px] shrink-0 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text }}>
            <input
                type="number"
                min={VIDEO_SECONDS_MIN}
                max={VIDEO_SECONDS_MAX}
                className="min-w-0 flex-1 bg-transparent px-2 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value}
                key={value}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function DimensionInput({ prefix, value, disabled, theme, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input
                type="number"
                min={1}
                disabled={disabled}
                className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                value={value || ""}
                onChange={(event) => onChange(Number(event.target.value) || null)}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}
