import { type ReactNode } from "react";
import { Select, Slider, Switch } from "antd";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { clampVideoSeconds, computeVideoSize, inferVideoRatio, parseVideoResolution, readVideoDimensions, VIDEO_SECONDS_MAX, VIDEO_SECONDS_MIN, videoRatioOptions } from "@/lib/media-size";
import { type AiConfig } from "@/stores/use-config-store";
import { normalizeVideoGenerationMode, selectedVideoModel, supportedVideoModes, supportsVideoParameter, videoParameter, videoParameterValue } from "@/lib/video-model-capabilities";

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
export const videoSizeOptions = videoRatioOptions.map((item) => ({ value: item.value, get label() { return item.value === "auto" ? i18n.t("settingsPanels.common.auto") : item.value; } }));
export const videoSecondsRange = { min: VIDEO_SECONDS_MIN, max: VIDEO_SECONDS_MAX };

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoMode" | "videoBitrateMode" | "videoOutputFormat", value: string) => void;
    theme: CanvasTheme;
    selectedModel?: string;
    showTitle?: boolean;
    className?: string;
};

export function VideoSettingsPanel({ config, onConfigChange, theme, selectedModel, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: VideoSettingsPanelProps) {
    const { t } = useTranslation();
    const model = selectedVideoModel(config, selectedModel);
    const hasDynamicSchema = Boolean(model?.parameters?.length);
    const modes = supportedVideoModes(model);
    const videoMode = normalizeVideoGenerationMode(config.videoMode, modes);
    const durationDefinition = videoParameter(model, "duration");
    const durationValue = videoParameterValue(config, model, "duration", "6");
    const seconds = Number(durationValue === "-1" ? 6 : clampVideoSeconds(durationValue));
    const resolution = parseVideoResolution(videoParameterValue(config, model, "resolution", "720p"));
    const selectedRatio = inferVideoRatio(videoParameterValue(config, model, "aspectRatio", "auto"));
    const dimensions = readVideoDimensions(config.size || "auto", resolution, selectedRatio);
    const resolutionValues = (videoParameter(model, "resolution")?.options?.map(String) || resolutionOptions.map((item) => `${item.value}p`)).map((value) => value.replace(/p$/i, ""));
    const ratioValues = videoParameter(model, "aspectRatio")?.options?.map(String) || videoRatioOptions.map((item) => item.value);
    const applySize = (nextResolution: string, ratio: string) => {
        onConfigChange("vquality", nextResolution);
        onConfigChange("size", computeVideoSize(nextResolution, ratio));
    };
    const selectResolution = (nextResolution: string) => {
        if (selectedRatio === "auto") onConfigChange("vquality", nextResolution);
        else applySize(nextResolution, selectedRatio);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.video.title")}</div> : null}
                {supportsVideoParameter(model, "resolution") ? <SettingGroup title={t("settingsPanels.video.quality")} color={theme.node.muted}>
                    <div className="grid grid-cols-4 gap-2.5">
                        {resolutionValues.map((value) => (
                            <OptionPill key={value} selected={resolution === value} theme={theme} onClick={() => selectResolution(value)}>
                                {value}p
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup> : null}
                {!hasDynamicSchema && supportsVideoParameter(model, "aspectRatio") ? <SettingGroup title={t("settingsPanels.video.size")} color={theme.node.muted}>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                        <DimensionInput prefix="W" value={dimensions.width} disabled={selectedRatio === "auto"} theme={theme} onChange={(value) => updateDimension("width", value, dimensions, onConfigChange)} />
                        <span className="text-lg opacity-45">↔</span>
                        <DimensionInput prefix="H" value={dimensions.height} disabled={selectedRatio === "auto"} theme={theme} onChange={(value) => updateDimension("height", value, dimensions, onConfigChange)} />
                    </div>
                </SettingGroup> : null}
                {supportsVideoParameter(model, "aspectRatio") ? <SettingGroup title={t("settingsPanels.video.ratio")} color={theme.node.muted}>
                    <div className="grid grid-cols-4 gap-2.5">
                        {videoRatioOptions.filter((item) => ratioValues.includes(item.value)).map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                style={{ borderColor: selectedRatio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => applySize(resolution, item.value)}
                            >
                                <SizePreview width={item.width} height={item.height} color={theme.node.text} />
                                <span>{item.value === "auto" ? t("settingsPanels.common.auto") : item.value}</span>
                            </button>
                        ))}
                    </div>
                </SettingGroup> : null}
                {supportsVideoParameter(model, "duration") ? <SettingGroup title={t("settingsPanels.video.seconds")} color={theme.node.muted}>
                    {durationDefinition?.options?.length ? <Select className="w-full" value={durationValue} options={durationDefinition.options.map((value) => ({ value: String(value), label: String(value) === "-1" ? t("settingsPanels.video.smart") : `${value}s` }))} onChange={(value) => onConfigChange("videoSeconds", value)} /> : <div className="flex items-center gap-3" onMouseDown={(event) => event.stopPropagation()}>
                        <Slider className="min-w-0 flex-1" min={VIDEO_SECONDS_MIN} max={VIDEO_SECONDS_MAX} step={1} value={seconds} onChange={(value) => onConfigChange("videoSeconds", String(Array.isArray(value) ? value[0] : value))} />
                        <SecondsInput value={seconds} theme={theme} onCommit={(value) => onConfigChange("videoSeconds", String(value))} />
                        <span className="shrink-0 text-sm" style={{ color: theme.node.muted }}>s</span>
                    </div>}
                </SettingGroup> : null}
                <SettingGroup title={t("settingsPanels.video.mode")} color={theme.node.muted}>
                    <div className="grid grid-cols-2 gap-2.5">
                        {videoModeOptions.filter((item) => modes.includes(item.value)).map((item) => (
                            <OptionPill key={item.value} selected={videoMode === item.value} theme={theme} onClick={() => onConfigChange("videoMode", item.value)}>
                                {t(`settingsPanels.video.modes.${item.labelKey}`)}
                            </OptionPill>
                        ))}
                    </div>
                    <div className="text-xs leading-5" style={{ color: theme.node.muted }}>{t(`settingsPanels.video.modeHints.${videoMode}`)}</div>
                </SettingGroup>
                {supportsVideoParameter(model, "bitrateMode") ? <SelectSetting title={t("settingsPanels.video.bitrateMode")} value={videoParameterValue(config, model, "bitrateMode", "high")} definition={videoParameter(model, "bitrateMode")} onChange={(value) => onConfigChange("videoBitrateMode", value)} /> : null}
                {supportsVideoParameter(model, "outputFormat") ? <SelectSetting title={t("settingsPanels.video.outputFormat")} value={videoParameterValue(config, model, "outputFormat", "mp4")} definition={videoParameter(model, "outputFormat")} onChange={(value) => onConfigChange("videoOutputFormat", value)} /> : null}
                {supportsVideoParameter(model, "generateAudio") ? <SwitchSetting title={t("settingsPanels.video.generateAudio")} checked={videoParameterValue(config, model, "generateAudio", "false") === "true"} onChange={(value) => onConfigChange("videoGenerateAudio", String(value))} /> : null}
                {supportsVideoParameter(model, "watermark") ? <SwitchSetting title={t("settingsPanels.video.watermark")} checked={videoParameterValue(config, model, "watermark", "false") === "true"} onChange={(value) => onConfigChange("videoWatermark", String(value))} /> : null}
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(value: string) {
    return `${parseVideoResolution(value)}p`;
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
    return parseVideoResolution(value);
}

function updateDimension(key: "width" | "height", value: number | null, dimensions: { width: number; height: number }, onConfigChange: VideoSettingsPanelProps["onConfigChange"]) {
    const next = Math.max(1, Math.floor(value || dimensions[key] || 720));
    onConfigChange("size", `${key === "width" ? next : dimensions.width}x${key === "height" ? next : dimensions.height}`);
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" disabled={disabled} className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35" style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function SelectSetting({ title, value, definition, onChange }: { title: string; value: string; definition?: { options?: Array<string | number | boolean> }; onChange: (value: string) => void }) {
    return <SettingGroup title={title} color="currentColor"><Select className="w-full" value={value} options={(definition?.options || []).map((option) => ({ value: String(option), label: String(option) }))} onChange={onChange} /></SettingGroup>;
}

function SwitchSetting({ title, checked, onChange }: { title: string; checked: boolean; onChange: (value: boolean) => void }) {
    return <div className="flex items-center justify-between text-sm"><span>{title}</span><Switch checked={checked} onChange={onChange} /></div>;
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
            <input type="number" min={1} disabled={disabled} className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value || ""} onChange={(event) => onChange(Number(event.target.value) || null)} onMouseDown={(event) => event.stopPropagation()} />
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
