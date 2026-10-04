import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { App, Button, Modal, Select, Tooltip } from "antd";
import { FileJson, ImageDown, KeyRound, Redo2, Route, Save, Sparkles, Trash2, Undo2 } from "lucide-react";
import { nanoid } from "nanoid";

import { useImageEditorViewport } from "@/components/canvas/use-image-editor-viewport";
import { CAMERA_MOTION_ACTIONS, CAMERA_MOTION_COLORS, createCameraMotionState, drawCameraMotionGuide, exportCameraMotionGuide, smoothMotionPoints } from "@/lib/canvas/camera-motion";
import { canvasThemes } from "@/lib/canvas-theme";
import { readImageMeta } from "@/lib/image-utils";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CameraMotionEditorResult, CameraMotionPath, CameraMotionPoint, CameraMotionState } from "@/types/camera-motion";

type Props = {
    open: boolean;
    sourceImageNodeId: string;
    imageUrl: string;
    initialValue?: CameraMotionState;
    onClose: () => void;
    onConfirm: (result: CameraMotionEditorResult) => void | Promise<void>;
};

export function CameraMotionEditor({ open, sourceImageNodeId, imageUrl, initialValue, onClose, onConfirm }: Props) {
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const overlayRef = useRef<HTMLCanvasElement>(null);
    const drawingRef = useRef<{ pointerId: number; pathId: string; endpoint?: "start" | "end" } | null>(null);
    const historyRef = useRef<CameraMotionPath[][]>([]);
    const redoRef = useRef<CameraMotionPath[][]>([]);
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const [paths, setPaths] = useState<CameraMotionPath[]>([]);
    const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
    const [historyVersion, setHistoryVersion] = useState(0);
    const [saving, setSaving] = useState<"save" | "generate" | null>(null);
    const viewport = useImageEditorViewport(image, open);
    const selectedPath = paths.find((path) => path.id === selectedPathId) || null;
    const prompt = useMemo(() => createCameraMotionState(sourceImageNodeId, paths).prompt, [paths, sourceImageNodeId]);

    useEffect(() => {
        if (!open) return;
        const restored = initialValue?.sourceImageNodeId === sourceImageNodeId ? clonePaths(initialValue.paths) : [];
        setPaths(restored);
        setSelectedPathId(restored.at(-1)?.id || null);
        setSaving(null);
        historyRef.current = [];
        redoRef.current = [];
        setHistoryVersion((value) => value + 1);
        void readImageMeta(imageUrl)
            .then(setImage)
            .catch(() => message.error("原图读取失败，请刷新素材后重试"));
    }, [imageUrl, initialValue, message, open, sourceImageNodeId]);

    useEffect(() => {
        const canvas = overlayRef.current;
        if (!canvas || !image) return;
        const context = canvas.getContext("2d");
        if (!context) return;
        context.clearRect(0, 0, canvas.width, canvas.height);
        drawCameraMotionGuide(context, image.width, image.height, paths, selectedPathId || undefined);
    }, [image, paths, selectedPathId]);

    const pushHistory = useCallback((snapshot: CameraMotionPath[]) => {
        historyRef.current.push(clonePaths(snapshot));
        if (historyRef.current.length > 50) historyRef.current.shift();
        redoRef.current = [];
        setHistoryVersion((value) => value + 1);
    }, []);

    const undo = useCallback(() => {
        const previous = historyRef.current.pop();
        if (!previous) return;
        redoRef.current.push(clonePaths(paths));
        setPaths(previous);
        setSelectedPathId((current) => (previous.some((path) => path.id === current) ? current : previous.at(-1)?.id || null));
        setHistoryVersion((value) => value + 1);
    }, [paths]);

    const redo = useCallback(() => {
        const next = redoRef.current.pop();
        if (!next) return;
        historyRef.current.push(clonePaths(paths));
        setPaths(next);
        setSelectedPathId(next.at(-1)?.id || null);
        setHistoryVersion((value) => value + 1);
    }, [paths]);

    useEffect(() => {
        if (!open) return;
        const onKeyDown = (event: KeyboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest("input,textarea,[contenteditable='true']")) return;
            if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
            const key = event.key.toLowerCase();
            if (key !== "z" && key !== "y") return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (key === "y" || event.shiftKey) redo();
            else undo();
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [open, redo, undo]);

    const startDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const point = readPoint(event.currentTarget, event.clientX, event.clientY);
        const endpoint = findNearestEndpoint(paths, point, event.currentTarget);
        if (endpoint) {
            pushHistory(paths);
            drawingRef.current = { pointerId: event.pointerId, ...endpoint };
            setSelectedPathId(endpoint.pathId);
            return;
        }
        const path: CameraMotionPath = {
            id: nanoid(),
            color: CAMERA_MOTION_COLORS[paths.length % CAMERA_MOTION_COLORS.length],
            action: "tracking",
            speed: "medium",
            rawPoints: [point],
            points: [point],
            keyframes: [],
        };
        pushHistory(paths);
        drawingRef.current = { pointerId: event.pointerId, pathId: path.id };
        setPaths((current) => [...current, path]);
        setSelectedPathId(path.id);
    };

    const moveDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const drawing = drawingRef.current;
        if (!drawing || drawing.pointerId !== event.pointerId) return;
        event.preventDefault();
        const point = readPoint(event.currentTarget, event.clientX, event.clientY);
        setPaths((current) =>
            current.map((path) => {
                if (path.id !== drawing.pathId) return path;
                if (drawing.endpoint) {
                    const rawPoints = [...path.rawPoints];
                    rawPoints[drawing.endpoint === "start" ? 0 : rawPoints.length - 1] = point;
                    return { ...path, rawPoints, points: smoothMotionPoints(rawPoints) };
                }
                const previous = path.rawPoints.at(-1);
                if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.002) return path;
                const rawPoints = [...path.rawPoints, point];
                return { ...path, rawPoints, points: smoothMotionPoints(rawPoints) };
            }),
        );
    };

    const stopDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        if (drawingRef.current?.pointerId !== event.pointerId) return;
        drawingRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        setPaths((current) => current.filter((path) => path.rawPoints.length > 1));
    };

    const updateSelected = (patch: Partial<CameraMotionPath>) => {
        if (!selectedPath) return;
        pushHistory(paths);
        setPaths((current) => current.map((path) => (path.id === selectedPath.id ? { ...path, ...patch } : path)));
    };

    const addKeyframe = () => {
        if (!selectedPath) return;
        const progress = (selectedPath.keyframes.length + 1) / (selectedPath.keyframes.length + 2);
        updateSelected({ keyframes: [...selectedPath.keyframes, { id: nanoid(), progress, easing: "ease_in_out" }] });
    };

    const removeSelected = () => {
        if (!selectedPath) return;
        pushHistory(paths);
        const next = paths.filter((path) => path.id !== selectedPath.id);
        setPaths(next);
        setSelectedPathId(next.at(-1)?.id || null);
    };

    const clearAll = () => {
        if (!paths.length) return;
        pushHistory(paths);
        setPaths([]);
        setSelectedPathId(null);
    };

    const exportJson = () => {
        if (!paths.length) return;
        const blob = new Blob([JSON.stringify(createCameraMotionState(sourceImageNodeId, paths), null, 2)], { type: "application/json" });
        downloadBlob(blob, "camera-motion.json");
    };

    const exportGuide = async () => {
        if (!image || !paths.length) return;
        try {
            downloadBlob(await exportCameraMotionGuide(imageUrl, paths, image.width, image.height), "camera-motion-guide.png");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "引导图导出失败");
        }
    };

    const exportOriginal = async () => {
        try {
            const response = await fetch(imageUrl);
            if (!response.ok) throw new Error("原图读取失败");
            const blob = await response.blob();
            downloadBlob(blob, `camera-motion-original.${blob.type.includes("jpeg") ? "jpg" : blob.type.includes("webp") ? "webp" : "png"}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "原图导出失败");
        }
    };

    const submit = async (generate: boolean) => {
        if (!image || !paths.some((path) => path.points.length > 1)) return message.warning("请先在画面上绘制至少一条运镜轨迹");
        setSaving(generate ? "generate" : "save");
        try {
            const motion = createCameraMotionState(sourceImageNodeId, paths);
            const guideBlob = await exportCameraMotionGuide(imageUrl, paths, image.width, image.height);
            await onConfirm({ motion, guideBlob, generate });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "运镜轨迹保存失败");
        } finally {
            setSaving(null);
        }
    };

    return (
        <Modal title={null} open={open} onCancel={onClose} footer={null} width={1180} centered destroyOnHidden styles={{ body: { padding: 0, overflow: "hidden", background: theme.node.panel } }}>
            <div className="flex h-[min(82vh,820px)] min-h-[600px] flex-col" style={{ color: theme.node.text }} data-canvas-no-zoom>
                <header className="flex h-14 shrink-0 items-center justify-between border-b px-5" style={{ borderColor: theme.toolbar.border }}>
                    <div>
                        <div className="text-sm font-semibold">AI 运镜轨迹编辑器</div>
                        <div className="text-[11px]" style={{ color: theme.node.muted }}>
                            在原图上绘制镜头路径，轨迹只作为生成参考，不会写入原图。
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <IconButton title="撤销" disabled={!historyRef.current.length} onClick={undo}>
                            <Undo2 className="size-4" />
                        </IconButton>
                        <IconButton title="重做" disabled={!redoRef.current.length} onClick={redo}>
                            <Redo2 className="size-4" />
                        </IconButton>
                        <IconButton title="导出原图" onClick={() => void exportOriginal()}>
                            <ImageDown className="size-4" />
                        </IconButton>
                        <IconButton title="导出引导图" disabled={!paths.length} onClick={() => void exportGuide()}>
                            <Route className="size-4" />
                        </IconButton>
                        <IconButton title="导出轨迹 JSON" disabled={!paths.length} onClick={exportJson}>
                            <FileJson className="size-4" />
                        </IconButton>
                        <span className="sr-only">{historyVersion}</span>
                    </div>
                </header>

                <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px]">
                    <div
                        ref={viewport.viewportRef}
                        {...viewport.panHandlers}
                        className={`relative min-h-0 overflow-hidden ${viewport.scrollClassName} ${viewport.isPanning ? "cursor-grabbing" : viewport.spacePressed ? "cursor-grab" : ""}`}
                        style={{ background: theme.canvas.background }}
                    >
                        <div className="relative" style={viewport.contentStyle}>
                            <div ref={viewport.stageRef} className="absolute isolate overflow-hidden rounded-lg select-none" style={viewport.stageStyle}>
                                {image ? (
                                    <div className="absolute left-0 top-0" style={viewport.mediaStyle}>
                                        <img src={imageUrl} alt="运镜参考" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
                                        <canvas
                                            ref={overlayRef}
                                            width={image.width}
                                            height={image.height}
                                            className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
                                            onPointerDown={startDraw}
                                            onPointerMove={moveDraw}
                                            onPointerUp={stopDraw}
                                            onPointerCancel={stopDraw}
                                        />
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>

                    <aside className="thin-scrollbar max-h-[34vh] min-h-0 overflow-y-auto border-t p-4 lg:max-h-none lg:border-l lg:border-t-0" style={{ borderColor: theme.toolbar.border }}>
                        <section className="space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold">轨迹列表</span>
                                <Button type="text" size="small" danger disabled={!paths.length} onClick={clearAll}>
                                    清空
                                </Button>
                            </div>
                            <div className="space-y-1.5">
                                {paths.map((path, index) => (
                                    <button
                                        key={path.id}
                                        type="button"
                                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors"
                                        style={{ background: selectedPathId === path.id ? theme.toolbar.activeBg : "transparent" }}
                                        onClick={() => setSelectedPathId(path.id)}
                                    >
                                        <span className="size-2.5 rounded-full" style={{ background: path.color }} />
                                        <span className="flex-1">轨迹 {index + 1}</span>
                                        <span style={{ color: theme.node.muted }}>{CAMERA_MOTION_ACTIONS.find((item) => item.value === path.action)?.label}</span>
                                    </button>
                                ))}
                                {!paths.length ? (
                                    <div className="rounded-xl border border-dashed p-4 text-center text-xs" style={{ borderColor: theme.toolbar.border, color: theme.node.muted }}>
                                        按住鼠标在图片上绘制第一条轨迹
                                    </div>
                                ) : null}
                            </div>
                        </section>

                        {selectedPath ? (
                            <section className="mt-5 space-y-4 border-t pt-4" style={{ borderColor: theme.toolbar.border }}>
                                <Field label="运镜动作">
                                    <Select className="w-full" value={selectedPath.action} options={CAMERA_MOTION_ACTIONS.map(({ value, label }) => ({ value, label }))} onChange={(action) => updateSelected({ action })} />
                                </Field>
                                <Field label="速度">
                                    <Select
                                        className="w-full"
                                        value={selectedPath.speed}
                                        options={[
                                            { value: "slow", label: "缓慢" },
                                            { value: "medium", label: "中速" },
                                            { value: "fast", label: "快速" },
                                        ]}
                                        onChange={(speed) => updateSelected({ speed })}
                                    />
                                </Field>
                                <Field label="轨迹颜色">
                                    <div className="flex gap-2">
                                        {CAMERA_MOTION_COLORS.map((color) => (
                                            <button
                                                key={color}
                                                type="button"
                                                className="size-7 rounded-full border-2"
                                                style={{ background: color, borderColor: selectedPath.color === color ? theme.node.text : "transparent" }}
                                                onClick={() => updateSelected({ color })}
                                            />
                                        ))}
                                    </div>
                                </Field>
                                <div className="grid grid-cols-2 gap-2">
                                    <Button icon={<KeyRound className="size-4" />} onClick={addKeyframe}>
                                        关键帧
                                    </Button>
                                    <Button danger icon={<Trash2 className="size-4" />} onClick={removeSelected}>
                                        删除轨迹
                                    </Button>
                                </div>
                            </section>
                        ) : null}

                        <section className="mt-5 border-t pt-4" style={{ borderColor: theme.toolbar.border }}>
                            <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
                                <Route className="size-4" />
                                生成提示词
                            </div>
                            <pre className="whitespace-pre-wrap rounded-xl p-3 text-[11px] leading-5" style={{ background: theme.canvas.background, color: theme.node.muted }}>
                                {prompt}
                            </pre>
                        </section>
                    </aside>
                </div>

                <footer className="flex h-16 shrink-0 items-center justify-between border-t px-5" style={{ borderColor: theme.toolbar.border }}>
                    <span className="text-xs" style={{ color: theme.node.muted }}>
                        空格拖动画布，滚轮缩放；关闭后可从原图片节点再次进入继续编辑。
                    </span>
                    <div className="flex gap-2">
                        <Button onClick={onClose}>取消</Button>
                        <Button icon={<Save className="size-4" />} loading={saving === "save"} disabled={Boolean(saving)} onClick={() => void submit(false)}>
                            保存轨迹
                        </Button>
                        <Button type="primary" icon={<Sparkles className="size-4" />} loading={saving === "generate"} disabled={Boolean(saving)} onClick={() => void submit(true)}>
                            保存并生成视频
                        </Button>
                    </div>
                </footer>
            </div>
        </Modal>
    );
}

function IconButton({ title, disabled, onClick, children }: { title: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <Tooltip title={title}>
            <Button type="text" shape="circle" disabled={disabled} onClick={onClick}>
                {children}
            </Button>
        </Tooltip>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block space-y-1.5">
            <span className="text-[11px] opacity-65">{label}</span>
            {children}
        </label>
    );
}

function readPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number): CameraMotionPoint {
    const rect = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)) };
}

function findNearestEndpoint(paths: CameraMotionPath[], point: CameraMotionPoint, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    const threshold = 18;
    let nearest: { pathId: string; endpoint: "start" | "end"; distance: number } | null = null;
    for (const path of paths) {
        const candidates = [
            { endpoint: "start" as const, point: path.rawPoints[0] },
            { endpoint: "end" as const, point: path.rawPoints.at(-1) },
        ];
        for (const candidate of candidates) {
            if (!candidate.point) continue;
            const distance = Math.hypot((candidate.point.x - point.x) * rect.width, (candidate.point.y - point.y) * rect.height);
            if (distance <= threshold && (!nearest || distance < nearest.distance)) nearest = { pathId: path.id, endpoint: candidate.endpoint, distance };
        }
    }
    return nearest ? { pathId: nearest.pathId, endpoint: nearest.endpoint } : null;
}

function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
}

function clonePaths(paths: CameraMotionPath[]) {
    return paths.map((path) => ({ ...path, rawPoints: path.rawPoints.map((point) => ({ ...point })), points: path.points.map((point) => ({ ...point })), keyframes: path.keyframes.map((keyframe) => ({ ...keyframe })) }));
}
