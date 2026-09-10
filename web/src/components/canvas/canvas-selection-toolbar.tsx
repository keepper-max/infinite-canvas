import type { ReactNode } from "react";
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, Group, Lock, LockOpen, Ungroup } from "lucide-react";
import { Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { nodeBounds } from "@/lib/canvas/canvas-node-geometry";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";

const SELECTION_PAD = 14;

export function CanvasSelectionToolbar({
    nodes,
    viewport,
    showToolbar,
    canGroup,
    canUngroup,
    onGroup,
    onUngroup,
    onAlign,
    onDistribute,
    onToggleLock,
}: {
    nodes: CanvasNodeData[];
    viewport: ViewportTransform;
    showToolbar: boolean;
    canGroup: boolean;
    canUngroup: boolean;
    onGroup: () => void;
    onUngroup: () => void;
    onAlign: (mode: "left" | "center" | "right" | "top" | "middle" | "bottom") => void;
    onDistribute: (axis: "horizontal" | "vertical") => void;
    onToggleLock: () => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (nodes.length < 2) return null;

    const bounds = nodeBounds(nodes);
    const left = viewport.x + bounds.left * viewport.k - SELECTION_PAD;
    const top = viewport.y + bounds.top * viewport.k - SELECTION_PAD;
    const width = (bounds.right - bounds.left) * viewport.k + SELECTION_PAD * 2;
    const height = (bounds.bottom - bounds.top) * viewport.k + SELECTION_PAD * 2;
    const showActions = showToolbar;
    const allLocked = nodes.every((node) => node.locked);

    return (
        <>
            <svg className="pointer-events-none absolute z-[65] overflow-visible" style={{ left, top, width, height }}>
                <rect
                    x={1}
                    y={1}
                    width={Math.max(width - 2, 0)}
                    height={Math.max(height - 2, 0)}
                    rx={16}
                    ry={16}
                    fill={theme.canvas.selectionFill}
                    stroke={theme.canvas.selectionStroke}
                    strokeOpacity={0.55}
                    strokeWidth={1.5}
                    strokeDasharray="7 5"
                    strokeLinecap="round"
                />
            </svg>
            {showActions ? (
                <div
                    className="absolute z-[70] flex h-12 -translate-x-1/2 -translate-y-full items-center overflow-visible rounded-[18px] border text-[15px] shadow-[0_8px_28px_rgba(15,23,42,.16)] backdrop-blur"
                    style={{ left: left + width / 2, top: top - 8, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    {canGroup ? <SelectionAction title={t("canvas.nodeToolbar.groupTitle")} label={t("canvas.nodeToolbar.group")} icon={<Group className="size-4" />} onClick={onGroup} /> : null}
                    {canUngroup ? <SelectionAction title={t("canvas.nodeToolbar.ungroupTitle")} label={t("canvas.nodeToolbar.ungroup")} icon={<Ungroup className="size-4" />} onClick={onUngroup} /> : null}
                    <SelectionAction title="左对齐" icon={<AlignStartVertical className="size-4" />} onClick={() => onAlign("left")} />
                    <SelectionAction title="水平居中" icon={<AlignCenterVertical className="size-4" />} onClick={() => onAlign("center")} />
                    <SelectionAction title="右对齐" icon={<AlignEndVertical className="size-4" />} onClick={() => onAlign("right")} />
                    <SelectionAction title="顶部对齐" icon={<AlignStartHorizontal className="size-4" />} onClick={() => onAlign("top")} />
                    <SelectionAction title="垂直居中" icon={<AlignCenterHorizontal className="size-4" />} onClick={() => onAlign("middle")} />
                    <SelectionAction title="底部对齐" icon={<AlignEndHorizontal className="size-4" />} onClick={() => onAlign("bottom")} />
                    {nodes.length >= 3 ? <SelectionAction title="水平等距" icon={<AlignHorizontalDistributeCenter className="size-4" />} onClick={() => onDistribute("horizontal")} /> : null}
                    {nodes.length >= 3 ? <SelectionAction title="垂直等距" icon={<AlignVerticalDistributeCenter className="size-4" />} onClick={() => onDistribute("vertical")} /> : null}
                    <SelectionAction title={allLocked ? "解锁所选节点" : "锁定所选节点"} icon={allLocked ? <LockOpen className="size-4" /> : <Lock className="size-4" />} onClick={onToggleLock} />
                </div>
            ) : null}
        </>
    );
}

function SelectionAction({ title, label, icon, onClick }: { title: string; label?: string; icon: ReactNode; onClick: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.2} color={theme.toolbar.panel} styles={{ root: { color: theme.node.text, boxShadow: "0 8px 24px rgba(15,23,42,.16)", fontSize: 13, fontWeight: 500 } }}>
            <button type="button" className="group relative flex h-12 items-center whitespace-nowrap px-1" onClick={onClick} aria-label={title}>
                <span
                    className="flex h-9 items-center gap-2 rounded-lg px-2 transition"
                    style={{ color: theme.toolbar.item }}
                    onMouseEnter={(event) => (event.currentTarget.style.background = theme.toolbar.itemHover)}
                    onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
                >
                    {icon}
                    {label ? <span>{label}</span> : null}
                </span>
            </button>
        </Tooltip>
    );
}
