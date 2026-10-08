import { App as AntApp, Button, Select, Segmented, Spin, Tag } from "antd";
import { Boxes, ExternalLink, Film, Image as ImageIcon, LoaderCircle, Save, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { DIRECTOR_DESK_URL } from "@/constant/env";
import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { currentVersion, uploadCloudAsset, type CloudAsset } from "@/services/api/assets";
import { createCanvasDraft, getCanvas, saveCanvas } from "@/services/api/canvas";
import { listProjects, type ProjectSummary } from "@/services/api/platform";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType } from "@/types/canvas";

type DirectorAction = "capabilities.get" | "project.get" | "timeline.get" | "export.frame" | "export.video";
type FramePosition = "current" | "first" | "last";
type ExportQuality = "720p" | "1080p";
type ExportFps = 24 | 30 | 60;
type AssetPurpose = "composition-reference" | "first-frame" | "last-frame" | "white-model-video";

type DirectorResponse = {
    protocolVersion: number;
    requestId: string;
    action: DirectorAction | "unknown";
    ok: boolean;
    data?: unknown;
    error?: { code?: string; message?: string };
};

type FrameExport = { dataUrl: string; fileName: string; width: number; height: number };
type VideoExport = { blob: Blob; fileName: string; mimeType: string; width: number; height: number; durationMs: number };
type DirectorCapabilities = { protocolVersion: number; actions: string[] };
type PendingRequest = { action: DirectorAction; resolve: (value: unknown) => void; reject: (error: Error) => void; timeout: number };
type SavedDirectorAsset = { asset: CloudAsset; purpose: AssetPurpose; label: string; projectId: string };

const PROTOCOL_VERSION = 1;
const REQUIRED_ACTIONS: DirectorAction[] = ["capabilities.get", "project.get", "timeline.get", "export.frame", "export.video"];

function normalizedDirectorUrl(projectId: string, theme: "dark" | "light", requestedMode: string | null) {
    const url = new URL(DIRECTOR_DESK_URL, window.location.origin);
    url.searchParams.set("instanceId", `canvas_${projectId}`);
    url.searchParams.set("theme", theme);
    url.searchParams.set("hostOrigin", window.location.origin);
    if (requestedMode === "professional") url.searchParams.set("mode", "professional");
    else if (requestedMode === "simple") url.searchParams.set("mode", "simple");
    return url;
}

function isDirectorResponse(value: unknown): value is DirectorResponse {
    if (!value || typeof value !== "object") return false;
    const response = value as Partial<DirectorResponse>;
    return response.protocolVersion === PROTOCOL_VERSION && typeof response.requestId === "string" && typeof response.action === "string" && typeof response.ok === "boolean";
}

async function dataUrlToFile(dataUrl: string, fileName: string) {
    if (!dataUrl.startsWith("data:image/png")) throw new Error("导演台返回的图片格式无效");
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error("无法读取导演台导出的图片");
    return new File([await response.blob()], fileName || "3D构图参考图.png", { type: "image/png" });
}

function purposeLabel(purpose: AssetPurpose) {
    if (purpose === "first-frame") return "3D首帧";
    if (purpose === "last-frame") return "3D尾帧";
    if (purpose === "white-model-video") return "3D白模参考视频";
    return "3D构图参考图";
}

export default function DirectorDeskPage() {
    const { message } = AntApp.useApp();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const theme = useThemeStore((state) => state.theme);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const pendingRef = useRef(new Map<string, PendingRequest>());
    const readyRequestRef = useRef<Promise<void> | null>(null);
    const [projects, setProjects] = useState<ProjectSummary[]>([]);
    const [projectId, setProjectId] = useState("");
    const [ready, setReady] = useState(false);
    const [connectionError, setConnectionError] = useState("");
    const [quality, setQuality] = useState<ExportQuality>("720p");
    const [fps, setFps] = useState<ExportFps>(30);
    const [busy, setBusy] = useState("");
    const [savedAssets, setSavedAssets] = useState<SavedDirectorAsset[]>([]);

    const requestedMode = searchParams.get("mode");
    const directorUrl = useMemo(() => (projectId ? normalizedDirectorUrl(projectId, theme, requestedMode) : null), [projectId, requestedMode, theme]);
    const directorOrigin = directorUrl?.origin || "";

    useEffect(() => {
        const controller = new AbortController();
        void listProjects(controller.signal)
            .then((items) => {
                const editable = items.filter((item) => item.role !== "viewer");
                setProjects(editable);
                setProjectId((current) => (editable.some((item) => item.projectId === current) ? current : editable[0]?.projectId || ""));
            })
            .catch((error) => {
                if (!controller.signal.aborted) setConnectionError(error instanceof Error ? error.message : "读取项目失败");
            });
        return () => controller.abort();
    }, []);

    useEffect(() => {
        pendingRef.current.forEach((pending) => {
            window.clearTimeout(pending.timeout);
            pending.reject(new Error("3D导演台目标或显示设置已切换，请重新操作"));
        });
        pendingRef.current.clear();
        setReady(false);
        setConnectionError("");
        readyRequestRef.current = null;
    }, [directorUrl?.href]);

    const request = useCallback(
        (action: DirectorAction, options?: Record<string, unknown>) => {
            const target = iframeRef.current?.contentWindow;
            if (!target || !directorOrigin) return Promise.reject(new Error("3D导演台尚未准备好"));
            const requestId = crypto.randomUUID();
            return new Promise<unknown>((resolve, reject) => {
                const timeout = window.setTimeout(
                    () => {
                        pendingRef.current.delete(requestId);
                        reject(new Error(`3D导演台请求超时：${action}`));
                    },
                    action === "export.video" ? 60_000 : 15_000,
                );
                pendingRef.current.set(requestId, { action, resolve, reject, timeout });
                target.postMessage(
                    {
                        type: "storyai:director-desk:request",
                        payload: { requestId, action, ...(options ? { options } : {}) },
                    },
                    directorOrigin,
                );
            });
        },
        [directorOrigin],
    );

    const saveFile = useCallback(
        async (file: File, purpose: AssetPurpose) => {
            if (!projectId) throw new Error("请先选择要保存素材的画布");
            const label = purposeLabel(purpose);
            const asset = await uploadCloudAsset(projectId, file, {
                kind: file.type.startsWith("video/") ? "video" : "image",
                name: file.name || label,
                source: "compose",
                provenance: { source: "3d-director-desk", purpose, protocolVersion: PROTOCOL_VERSION },
            });
            setSavedAssets((items) => [{ asset, purpose, label, projectId }, ...items]);
            return asset;
        },
        [projectId],
    );

    const saveCaptureBatch = useCallback(
        async (captures: unknown) => {
            if (!Array.isArray(captures) || captures.length === 0) return;
            setBusy("正在保存导演台截图");
            try {
                for (const [index, capture] of captures.entries()) {
                    if (!capture || typeof capture !== "object") continue;
                    const value = capture as { dataUrl?: unknown; fileName?: unknown };
                    if (typeof value.dataUrl !== "string") continue;
                    const file = await dataUrlToFile(value.dataUrl, typeof value.fileName === "string" ? value.fileName : `3D构图参考图-${index + 1}.png`);
                    await saveFile(file, "composition-reference");
                }
                message.success("导演台截图已保存到素材库");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "截图保存失败；导演台工程和导出结果仍保留在当前页面");
            } finally {
                setBusy("");
            }
        },
        [message, saveFile],
    );

    useEffect(() => {
        function handleMessage(event: MessageEvent) {
            if (!directorOrigin || event.origin !== directorOrigin || event.source !== iframeRef.current?.contentWindow) return;
            const messageData = event.data;
            if (messageData?.type === "storyai:director-desk-ready") {
                iframeRef.current?.contentWindow?.postMessage(
                    {
                        type: "storyai:director-desk-session",
                        payload: { instanceId: `canvas_${projectId}`, theme },
                    },
                    directorOrigin,
                );
                if (!readyRequestRef.current) {
                    readyRequestRef.current = request("capabilities.get")
                        .then((value) => {
                            const capabilities = value as Partial<DirectorCapabilities>;
                            if (capabilities.protocolVersion !== PROTOCOL_VERSION || !REQUIRED_ACTIONS.every((action) => capabilities.actions?.includes(action))) {
                                throw new Error("3D导演台协议版本或导出能力不兼容");
                            }
                            setReady(true);
                            setConnectionError("");
                        })
                        .catch((error) => {
                            setReady(false);
                            setConnectionError(error instanceof Error ? error.message : "3D导演台能力检查失败");
                        });
                }
                return;
            }
            if (messageData?.type === "storyai:director-desk-captures-sent") {
                void saveCaptureBatch(messageData.payload?.captures);
                return;
            }
            if (messageData?.type === "storyai:director-desk-close") {
                message.info("导演台工程已保留；可从顶部导航离开此页");
                return;
            }
            if (messageData?.type !== "storyai:director-desk:response" || !isDirectorResponse(messageData.payload)) return;
            const response = messageData.payload;
            const pending = pendingRef.current.get(response.requestId);
            if (!pending) return;
            window.clearTimeout(pending.timeout);
            pendingRef.current.delete(response.requestId);
            if (response.action !== pending.action) {
                pending.reject(new Error(`导演台响应不匹配：期望 ${pending.action}，收到 ${response.action}`));
            } else if (!response.ok) {
                const prefix = response.error?.code === "export-busy" ? "已有导出任务正在运行：" : "";
                pending.reject(new Error(`${prefix}${response.error?.message || "3D导演台请求失败"}`));
            } else {
                pending.resolve(response.data);
            }
        }
        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [directorOrigin, message, projectId, request, saveCaptureBatch, theme]);

    useEffect(
        () => () => {
            pendingRef.current.forEach((pending) => {
                window.clearTimeout(pending.timeout);
                pending.reject(new Error("3D导演台页面已关闭"));
            });
            pendingRef.current.clear();
        },
        [],
    );

    const exportFrame = async (position: FramePosition) => {
        const purpose: AssetPurpose = position === "first" ? "first-frame" : position === "last" ? "last-frame" : "composition-reference";
        const label = purposeLabel(purpose);
        setBusy(`正在导出${label}`);
        try {
            const result = (await request("export.frame", { position, quality, fileName: `${label}.png` })) as FrameExport;
            const file = await dataUrlToFile(result.dataUrl, result.fileName || `${label}.png`);
            await saveFile(file, purpose);
            message.success(`${label}已保存到素材库`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : `${label}导出失败`);
        } finally {
            setBusy("");
        }
    };

    const exportVideo = async () => {
        setBusy("正在导出白模参考视频");
        try {
            const result = (await request("export.video", { quality, fps, fileName: "3D白模参考视频.mp4" })) as VideoExport;
            if (!(result.blob instanceof Blob) || result.blob.size === 0) throw new Error("导演台没有返回有效视频");
            const file = new File([result.blob], result.fileName || "3D白模参考视频.mp4", { type: result.mimeType || "video/mp4" });
            await saveFile(file, "white-model-video");
            message.success("3D白模参考视频已保存到素材库");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "白模参考视频导出失败");
        } finally {
            setBusy("");
        }
    };

    const insertIntoCanvas = async (savedAsset: SavedDirectorAsset) => {
        const targetProjectId = savedAsset.projectId;
        if (!targetProjectId) return;
        setBusy("正在插入主画布");
        try {
            const version = currentVersion(savedAsset.asset);
            if (!version) throw new Error("素材版本不存在，无法插入画布");
            const canvas = await getCanvas(targetProjectId);
            const type = savedAsset.asset.kind === "video" ? CanvasNodeType.Video : CanvasNodeType.Image;
            const spec = NODE_DEFAULT_SIZE[type];
            const maxRight = canvas.nodes.reduce((value, node) => Math.max(value, node.position.x + node.width), 0);
            const center = canvas.nodes.length ? { x: maxRight + 72 + spec.width / 2, y: canvas.nodes[0].position.y + spec.height / 2 } : { x: spec.width / 2 + 120, y: spec.height / 2 + 120 };
            const node = createCanvasNode(type, center, {
                assetId: savedAsset.asset.id,
                assetVersionId: version.id,
                storageKey: version.storageKey,
                status: "success",
                mimeType: version.mimeType,
                bytes: version.bytes,
                naturalWidth: version.width ?? undefined,
                naturalHeight: version.height ?? undefined,
                durationMs: version.durationMs ?? undefined,
            });
            node.title = savedAsset.label;
            const saved = await saveCanvas(targetProjectId, createCanvasDraft([...canvas.nodes, node], canvas.edges, canvas.viewport, canvas.settings), canvas.revision);
            updateProject(targetProjectId, {
                nodes: saved.nodes,
                connections: saved.edges,
                viewport: saved.viewport,
                backgroundMode: saved.settings.backgroundMode,
                showImageInfo: saved.settings.showImageInfo,
            });
            message.success("已作为普通媒体节点插入主画布");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "插入主画布失败；素材仍保留在素材库");
        } finally {
            setBusy("");
        }
    };

    return (
        <main className="flex h-full min-h-0 flex-col bg-stone-100 text-stone-950 dark:bg-stone-950 dark:text-stone-100">
            <section className="flex shrink-0 flex-wrap items-center gap-2 border-b border-stone-200 bg-white/95 px-3 py-2 dark:border-stone-800 dark:bg-stone-900/95">
                <div className="mr-2 flex items-center gap-2">
                    <Boxes className="size-5" />
                    <strong>3D导演台</strong>
                </div>
                <Select className="min-w-44" value={projectId || undefined} placeholder="选择目标画布" options={projects.map((item) => ({ value: item.projectId, label: item.projectTitle }))} onChange={setProjectId} />
                <Segmented<ExportQuality> value={quality} options={["720p", "1080p"]} onChange={setQuality} />
                <Select className="w-24" value={fps} options={[24, 30, 60].map((value) => ({ value, label: `${value} FPS` }))} onChange={setFps} />
                <Button disabled={!ready || Boolean(busy)} icon={<ImageIcon className="size-4" />} onClick={() => void exportFrame("current")}>
                    导出构图图
                </Button>
                <Button disabled={!ready || Boolean(busy)} onClick={() => void exportFrame("first")}>
                    导出首帧
                </Button>
                <Button disabled={!ready || Boolean(busy)} onClick={() => void exportFrame("last")}>
                    导出尾帧
                </Button>
                <Button disabled={!ready || Boolean(busy)} icon={<Film className="size-4" />} onClick={() => void exportVideo()}>
                    导出白模视频
                </Button>
                <span className="ml-auto flex items-center gap-2 text-xs text-stone-500">
                    {busy ? (
                        <>
                            <LoaderCircle className="size-3.5 animate-spin" />
                            {busy}
                        </>
                    ) : connectionError ? (
                        <Tag color="error">{connectionError}</Tag>
                    ) : ready ? (
                        <Tag color="success">已连接</Tag>
                    ) : (
                        <>
                            <Spin size="small" />
                            正在连接
                        </>
                    )}
                </span>
            </section>

            <section className="relative min-h-0 flex-1">
                {!projectId ? (
                    <div className="grid h-full place-items-center text-sm text-stone-500">没有可编辑画布，请先创建画布</div>
                ) : directorUrl ? (
                    <iframe
                        ref={iframeRef}
                        className="h-full w-full border-0"
                        src={directorUrl.href}
                        title="3D导演台"
                        allow="fullscreen"
                        sandbox="allow-scripts allow-same-origin allow-downloads allow-pointer-lock"
                        onError={() => setConnectionError("3D导演台加载失败，主画布不受影响")}
                    />
                ) : null}

                {savedAssets.length ? (
                    <aside className="absolute bottom-3 right-3 z-10 max-h-[42%] w-[min(420px,calc(100%-24px))] overflow-y-auto rounded-xl border border-stone-200 bg-white/95 p-3 shadow-2xl backdrop-blur dark:border-stone-700 dark:bg-stone-900/95">
                        <div className="mb-2 text-sm font-semibold">已保存到项目素材库</div>
                        <div className="space-y-2">
                            {savedAssets.map((item) => (
                                <div key={`${item.asset.id}:${item.asset.currentVersionId}`} className="flex items-center gap-2 rounded-lg border border-stone-200 p-2 text-xs dark:border-stone-700">
                                    <Save className="size-4 shrink-0 text-emerald-500" />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate font-medium">{item.asset.name}</div>
                                        <div className="text-stone-500">{item.label}</div>
                                    </div>
                                    <Button size="small" type="text" icon={<ExternalLink className="size-3.5" />} onClick={() => navigate(`/assets?projectId=${encodeURIComponent(item.projectId)}`)}>
                                        查看
                                    </Button>
                                    <Button size="small" disabled={Boolean(busy)} icon={<Send className="size-3.5" />} onClick={() => void insertIntoCanvas(item)}>
                                        插入主画布
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </aside>
                ) : null}
            </section>
        </main>
    );
}
