import { Gauge, HardDrive, ScanLine, ShieldCheck, Upload } from "lucide-react";
import { Alert, Button, Modal, Progress } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { DEPTH_VIDEO_FPS, DEPTH_VIDEO_MAX_SECONDS, DEPTH_VIDEO_RESOLUTION, generateDepthVideo, type DepthVideoProgress, type DepthVideoResult } from "@/lib/depth-motion/generate-depth-video";
import { formatBytes } from "@/lib/image-utils";

type DepthMotionDialogProps = {
    open: boolean;
    onCancel: () => void;
    onComplete: (result: DepthVideoResult, sourceName: string) => Promise<void> | void;
};

export function DepthMotionDialog({ open, onCancel, onComplete }: DepthMotionDialogProps) {
    const { t } = useTranslation();
    const inputRef = useRef<HTMLInputElement>(null);
    const controllerRef = useRef<AbortController | null>(null);
    const [file, setFile] = useState<File | null>(null);
    const [progress, setProgress] = useState<DepthVideoProgress | null>(null);
    const [error, setError] = useState("");
    const [running, setRunning] = useState(false);
    const hasWebGpu = useMemo(() => typeof navigator !== "undefined" && "gpu" in navigator, [open]);

    useEffect(() => {
        if (open) return;
        controllerRef.current?.abort();
        controllerRef.current = null;
        setFile(null);
        setProgress(null);
        setError("");
        setRunning(false);
    }, [open]);

    const start = async () => {
        if (!file || running) return;
        const controller = new AbortController();
        controllerRef.current = controller;
        setRunning(true);
        setError("");
        try {
            const result = await generateDepthVideo(file, { signal: controller.signal, onProgress: setProgress });
            await onComplete(result, file.name);
        } catch (cause) {
            if (cause instanceof DOMException && cause.name === "AbortError") return;
            setError(cause instanceof Error ? cause.message : t("depthMotion.failed"));
        } finally {
            if (controllerRef.current === controller) controllerRef.current = null;
            setRunning(false);
        }
    };

    const cancel = () => {
        controllerRef.current?.abort();
        onCancel();
    };

    return (
        <Modal
            open={open}
            title={
                <div className="flex items-center gap-2">
                    <span className="flex size-8 items-center justify-center rounded-md bg-stone-950 text-white dark:bg-stone-100 dark:text-stone-950">
                        <ScanLine className="size-4" />
                    </span>
                    <span>{t("depthMotion.title")}</span>
                </div>
            }
            width={640}
            onCancel={cancel}
            maskClosable={!running}
            closable={!running}
            footer={
                <div className="flex items-center justify-between gap-3">
                    <span className="text-left text-xs text-stone-500 dark:text-stone-400">{t("depthMotion.privacy")}</span>
                    <div className="flex gap-2">
                        <Button onClick={cancel}>{t("common.cancel")}</Button>
                        <Button type="primary" icon={<ScanLine className="size-4" />} loading={running} disabled={!file || running} onClick={() => void start()}>
                            {running ? t("depthMotion.processing") : t("depthMotion.start")}
                        </Button>
                    </div>
                </div>
            }
        >
            <div className="space-y-4 pt-2">
                <div className="grid gap-3 sm:grid-cols-3">
                    <Spec icon={<Gauge className="size-4" />} label={t("depthMotion.outputLabel")} value={`${DEPTH_VIDEO_RESOLUTION}p · ${DEPTH_VIDEO_FPS}fps`} />
                    <Spec icon={<HardDrive className="size-4" />} label={t("depthMotion.limitLabel")} value={t("depthMotion.limitValue", { seconds: DEPTH_VIDEO_MAX_SECONDS })} />
                    <Spec icon={<ShieldCheck className="size-4" />} label={t("depthMotion.runtimeLabel")} value={hasWebGpu ? t("depthMotion.webGpuReady") : t("depthMotion.wasmFallback")} accent={hasWebGpu} />
                </div>

                <button
                    type="button"
                    className="group flex min-h-36 w-full flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50 px-6 text-center transition hover:border-stone-500 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-500 dark:hover:bg-stone-800"
                    disabled={running}
                    onClick={() => inputRef.current?.click()}
                >
                    {file ? (
                        <>
                            <span className="mb-2 flex size-10 items-center justify-center rounded-full bg-stone-950 text-white dark:bg-stone-100 dark:text-stone-950">
                                <Upload className="size-4" />
                            </span>
                            <span className="max-w-full truncate text-sm font-semibold">{file.name}</span>
                            <span className="mt-1 text-xs text-stone-500">{formatBytes(file.size)}</span>
                            {!running ? <span className="mt-2 text-xs text-stone-500">{t("depthMotion.replaceFile")}</span> : null}
                        </>
                    ) : (
                        <>
                            <Upload className="mb-3 size-6 text-stone-500" />
                            <span className="text-sm font-semibold">{t("depthMotion.selectFile")}</span>
                            <span className="mt-1 text-xs text-stone-500">{t("depthMotion.fileHint")}</span>
                        </>
                    )}
                </button>
                <input
                    ref={inputRef}
                    type="file"
                    accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
                    className="hidden"
                    onChange={(event) => {
                        const next = event.target.files?.[0] || null;
                        event.target.value = "";
                        if (!next) return;
                        setFile(next);
                        setError("");
                        setProgress(null);
                    }}
                />

                {progress ? (
                    <div className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950">
                        <div className="mb-2 flex items-center justify-between text-xs">
                            <span className="font-medium">{t(`depthMotion.phase.${progress.phase}`)}</span>
                            <span className="text-stone-500">{progress.backend || t("depthMotion.preparing")}</span>
                        </div>
                        <Progress percent={progress.percent} showInfo={false} strokeColor="#78716c" trailColor="rgba(120,113,108,.18)" />
                    </div>
                ) : null}

                {error ? <Alert type="error" showIcon message={error} closable onClose={() => setError("")} /> : null}

                <div className="rounded-lg border border-stone-200 px-3 py-3 text-xs leading-5 text-stone-600 dark:border-stone-800 dark:text-stone-400">
                    <div className="mb-1 font-semibold text-stone-900 dark:text-stone-100">{t("depthMotion.hardwareTitle")}</div>
                    <p>{t("depthMotion.hardwareMinimum")}</p>
                    <p>{t("depthMotion.hardwareRecommended")}</p>
                    <p>{t("depthMotion.hardwareFallback")}</p>
                </div>
            </div>
        </Modal>
    );
}

function Spec({ icon, label, value, accent = false }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
    return (
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900">
            <div className="mb-2 flex items-center gap-1.5 text-xs text-stone-500">
                {icon}
                <span>{label}</span>
            </div>
            <div className={`text-sm font-semibold ${accent ? "text-emerald-600 dark:text-emerald-400" : "text-stone-900 dark:text-stone-100"}`}>{value}</div>
        </div>
    );
}
