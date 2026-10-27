import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { getAutoCutProject } from "@/services/api/autocut";
import { getCloudAssetDownloadUrl } from "@/services/api/assets";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

// The canvas unmounts node Content while showing its loading shell. Poll from the page, not Content.
export function useAutoCutBridge(projectId: string, loaded: boolean, nodes: CanvasNodeData[], nodesRef: MutableRefObject<CanvasNodeData[]>, setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>) {
    const key = nodes
        .filter((n) => n.type === "autocut:editor" && n.metadata?.autocut?.projectId)
        .map((n) => `${n.id}:${n.metadata!.autocut!.projectId}:${n.metadata!.autocut!.taskId || ""}`)
        .sort()
        .join("|");
    useEffect(() => {
        if (!loaded || !key) return;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined,
            checking = false;
        const apply = (id: string, patch: CanvasNodeMetadata) => {
            if (controller.signal.aborted) return;
            let changed = false;
            const next = nodesRef.current.map((n) => {
                if (n.type !== "autocut:editor" || n.metadata?.autocut?.projectId !== id) return n;
                const metadata = { ...n.metadata, ...patch, autocut: { ...n.metadata.autocut, ...patch.autocut } };
                if (JSON.stringify(metadata) === JSON.stringify(n.metadata)) return n;
                changed = true;
                return { ...n, metadata };
            });
            if (changed) {
                nodesRef.current = next;
                setNodes(next);
            }
        };
        const poll = async () => {
            if (checking || controller.signal.aborted) return;
            checking = true;
            clearTimeout(timer);
            let pending = false;
            try {
                const ids = [...new Set(nodesRef.current.filter((n) => n.type === "autocut:editor").flatMap((n) => (n.metadata?.autocut?.projectId ? [n.metadata.autocut.projectId] : [])))];
                for (const id of ids) {
                    try {
                        const detail = await getAutoCutProject(id, controller.signal),
                            task = detail.tasks.find((t) => !["export", "prepare", "effects"].includes(t.input?.kind || "") && !t.input?.p1?.previewClipId);
                        if (detail.project.project_id !== projectId) throw new Error("剪辑工程不属于当前画布项目");
                        if (!task || controller.signal.aborted) continue;
                        const active = ["queued", "running"].includes(task.status);
                        pending ||= active;
                        const output = task.status === "completed" ? task.output_asset_version_id : null;
                        const content = output ? await getCloudAssetDownloadUrl(output) : undefined;
                        apply(id, {
                            status: active ? "loading" : task.status === "completed" ? "success" : task.status === "cancelled" ? "idle" : "error",
                            jobProgress: task.progress,
                            errorDetails: task.error_message || undefined,
                            jobStatusMessage: task.status === "cancelled" ? "任务已取消" : active ? "正在智能剪辑" : task.status === "completed" ? "剪辑已完成" : "剪辑失败",
                            ...(output ? { assetVersionId: output, content } : {}),
                            autocut: { projectId: id, taskId: task.id, revisionId: task.output_revision_id || detail.project.current_revision_id || undefined },
                        });
                    } catch (e) {
                        if (!controller.signal.aborted) apply(id, { status: "error", errorDetails: e instanceof Error ? e.message : "剪辑状态读取失败" });
                    }
                }
            } finally {
                checking = false;
                if (pending && !controller.signal.aborted) timer = setTimeout(() => void poll(), 2000);
            }
        };
        const focus = () => {
            if (document.visibilityState === "visible") void poll();
        };
        void poll();
        window.addEventListener("focus", focus);
        return () => {
            controller.abort();
            clearTimeout(timer);
            window.removeEventListener("focus", focus);
        };
    }, [projectId, loaded, key, nodesRef, setNodes]);
}
