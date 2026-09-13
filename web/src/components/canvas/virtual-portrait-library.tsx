import { App, Empty, Popconfirm, Spin } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Trash2, UserRound } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import type { CanvasTheme } from "@/lib/canvas-theme";
import { cn } from "@/lib/utils";
import { archiveVirtualPortrait, createVirtualPortrait, listVirtualPortraits, type VirtualPortrait } from "@/services/api/virtual-portraits";

import { CANVAS_ASSET_DRAG_TYPE, type InsertAssetPayload } from "./asset-picker-modal";

export function VirtualPortraitLibrary({ projectId, onInsert, theme }: { projectId: string; onInsert: (payload: InsertAssetPayload) => void; theme: CanvasTheme }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const queryKey = ["virtual-portraits", projectId] as const;
    const portraits = useQuery({
        queryKey,
        queryFn: ({ signal }) => listVirtualPortraits(projectId, true, signal),
        refetchInterval: (query) => (query.state.data?.some((item) => item.status === "processing") ? 5000 : false),
    });
    const createMutation = useMutation({
        mutationFn: (file: File) => createVirtualPortrait(projectId, file),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey });
            message.success(t("canvas.sidePanel.virtualPortraitCreated"));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t("canvas.sidePanel.virtualPortraitCreateFailed")),
    });
    const archiveMutation = useMutation({
        mutationFn: archiveVirtualPortrait,
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey });
            message.success(t("canvas.sidePanel.virtualPortraitRemoved"));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t("canvas.sidePanel.virtualPortraitRemoveFailed")),
    });
    const items = portraits.data || [];

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-1">
                <span className="text-xs opacity-60">{t("canvas.sidePanel.virtualPortraitHint")}</span>
                <div className="flex shrink-0 items-center">
                    <button type="button" onClick={() => void portraits.refetch()} className="grid size-7 place-items-center rounded-md transition hover:bg-black/5 dark:hover:bg-white/10" aria-label={t("canvas.sidePanel.refreshVirtualPortraits")}>
                        <RefreshCw className={cn("size-3.5", portraits.isFetching && "animate-spin")} />
                    </button>
                    <button
                        type="button"
                        disabled={createMutation.isPending}
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
                    >
                        <Plus className="size-3.5" />
                        {t("canvas.sidePanel.add")}
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) createMutation.mutate(file);
                            event.target.value = "";
                        }}
                    />
                </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                {portraits.isLoading ? (
                    <div className="grid h-32 place-items-center">
                        <Spin size="small" />
                    </div>
                ) : portraits.isError ? (
                    <button type="button" onClick={() => void portraits.refetch()} className="mt-12 w-full text-center text-xs text-red-500">
                        {t("canvas.sidePanel.loadFailedRetry")}
                    </button>
                ) : items.length ? (
                    <div className="grid grid-cols-2 gap-2">
                        {items.map((portrait) => (
                            <VirtualPortraitCard key={portrait.id} portrait={portrait} theme={theme} onInsert={onInsert} onRemove={() => archiveMutation.mutate(portrait.id)} />
                        ))}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.sidePanel.noVirtualPortraits")} className="pt-16" />
                )}
            </div>
        </div>
    );
}

function VirtualPortraitCard({ portrait, theme, onInsert, onRemove }: { portrait: VirtualPortrait; theme: CanvasTheme; onInsert: (payload: InsertAssetPayload) => void; onRemove: () => void }) {
    const { t } = useTranslation();
    const ready = portrait.status === "active";
    const payload: InsertAssetPayload = {
        kind: "image",
        dataUrl: portrait.previewUrl,
        title: portrait.name,
        assetId: portrait.sourceAssetId,
        assetVersionId: portrait.sourceAssetVersionId,
        virtualPortraitId: portrait.id,
        mimeType: portrait.mimeType,
        width: portrait.width || undefined,
        height: portrait.height || undefined,
    };
    return (
        <div
            className={cn("group relative aspect-square overflow-hidden rounded-xl border", ready && "cursor-grab active:cursor-grabbing")}
            style={{ borderColor: theme.node.stroke, background: theme.node.panel }}
            draggable={ready}
            onDragStart={(event) => {
                if (!ready) return;
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData(CANVAS_ASSET_DRAG_TYPE, JSON.stringify(payload));
            }}
        >
            <img src={portrait.previewUrl} alt={portrait.name} className="size-full object-cover transition duration-300 group-hover:scale-[1.04]" />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-2 pt-8 text-white">
                <div className="truncate text-xs font-medium">{portrait.name}</div>
                <div className={cn("mt-0.5 text-[10px]", portrait.status === "failed" ? "text-red-300" : portrait.status === "active" ? "text-emerald-300" : "text-amber-200")}>{t(`canvas.sidePanel.virtualPortraitStatus.${portrait.status}`)}</div>
            </div>
            <div className="absolute inset-0 flex items-center justify-center gap-2 opacity-0 transition group-hover:bg-black/25 group-hover:opacity-100">
                {ready ? (
                    <button type="button" onClick={() => onInsert(payload)} className="grid size-8 place-items-center rounded-full bg-white/90 text-stone-800" aria-label={t("canvas.sidePanel.inserted")}>
                        <UserRound className="size-4" />
                    </button>
                ) : null}
                <Popconfirm title={t("canvas.sidePanel.removeVirtualPortraitTitle")} okText={t("canvas.sidePanel.remove")} cancelText={t("common.cancel")} okButtonProps={{ danger: true }} onConfirm={onRemove}>
                    <button type="button" className="grid size-8 place-items-center rounded-full bg-white/90 text-red-500" aria-label={t("canvas.sidePanel.removeAsset")}>
                        <Trash2 className="size-4" />
                    </button>
                </Popconfirm>
            </div>
            {portrait.status === "failed" && portrait.errorMessage ? <div className="absolute inset-x-1 top-1 line-clamp-2 rounded bg-red-950/80 px-1.5 py-1 text-[9px] text-red-100">{portrait.errorMessage}</div> : null}
        </div>
    );
}
