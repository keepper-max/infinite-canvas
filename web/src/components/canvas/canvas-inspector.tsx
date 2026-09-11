import { Button, Input, Select, Switch } from "antd";
import { Cable, ExternalLink, Lock, LockOpen, Trash2, Unplug } from "lucide-react";
import type { ReactNode } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasConnection, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

const ROLE_OPTIONS: Array<{ value: NonNullable<CanvasConnection["role"]>; label: string }> = [
    { value: "data", label: "数据" },
    { value: "identity", label: "角色身份" },
    { value: "environment", label: "环境" },
    { value: "composition", label: "构图" },
    { value: "motion", label: "动作" },
    { value: "first_frame", label: "首帧" },
    { value: "last_frame", label: "尾帧" },
    { value: "video_input", label: "视频输入" },
    { value: "audio_input", label: "音频输入" },
    { value: "mask", label: "蒙版" },
];

export function CanvasInspector({
    node,
    connection,
    fromNode,
    toNode,
    references,
    onUpdateNode,
    onUpdateMetadata,
    onToggleLock,
    onOpenVersion,
    onUpdateConnectionRole,
    onReconnect,
    onDeleteConnection,
}: {
    node: CanvasNodeData | null;
    connection: CanvasConnection | null;
    fromNode?: CanvasNodeData;
    toNode?: CanvasNodeData;
    references: CanvasNodeData[];
    onUpdateNode: (nodeId: string, patch: Partial<Pick<CanvasNodeData, "title">>) => void;
    onUpdateMetadata: (nodeId: string, patch: CanvasNodeMetadata) => void;
    onToggleLock: (nodeId: string) => void;
    onOpenVersion: (nodeId: string) => void;
    onUpdateConnectionRole: (connectionId: string, role: NonNullable<CanvasConnection["role"]>) => void;
    onReconnect: (connectionId: string) => void;
    onDeleteConnection: (connectionId: string) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (!node && !connection) return null;
    const panelStyle = { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text };

    return (
        <aside className="pointer-events-auto absolute bottom-24 right-4 top-20 z-[75] w-[300px] overflow-y-auto rounded-2xl border p-4 shadow-2xl backdrop-blur-xl" style={panelStyle} onMouseDown={(event) => event.stopPropagation()}>
            {node ? (
                <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-45">节点检查器</div>
                            <div className="mt-1 text-sm font-semibold">{node.title}</div>
                        </div>
                        <Switch checked={Boolean(node.locked)} checkedChildren={<Lock className="size-3" />} unCheckedChildren={<LockOpen className="size-3" />} onChange={() => onToggleLock(node.id)} />
                    </div>
                    <InspectorField label="名称">
                        <Input value={node.title} onChange={(event) => onUpdateNode(node.id, { title: event.target.value })} />
                    </InspectorField>
                    <InspectorField label="模型">
                        <Input value={node.metadata?.model || ""} placeholder="跟随全局模型" onChange={(event) => onUpdateMetadata(node.id, { model: event.target.value })} />
                    </InspectorField>
                    <InspectorField label="提示词">
                        <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} value={node.metadata?.prompt || ""} placeholder="输入该节点的生成目标" onChange={(event) => onUpdateMetadata(node.id, { prompt: event.target.value })} />
                    </InspectorField>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <Info label="状态" value={node.metadata?.status || "idle"} />
                        <Info label="尺寸" value={`${Math.round(node.width)} × ${Math.round(node.height)}`} />
                        <Info label="比例" value={node.metadata?.size || "自动"} />
                        <Info label="时长" value={node.metadata?.seconds ? `${node.metadata.seconds}s` : "—"} />
                        <Info label="资产版本" value={node.metadata?.assetVersionId || "—"} />
                        <Info label="任务" value={node.metadata?.generationJobId || node.metadata?.videoTaskId || "—"} />
                        <Info label="生成数量" value={String(node.metadata?.count || node.metadata?.textCount || 1)} />
                        <Info label="质量" value={node.metadata?.quality || node.metadata?.vquality || "自动"} />
                    </div>
                    <div>
                        <div className="mb-2 text-xs font-medium opacity-55">参考素材</div>
                        {references.length ? (
                            <div className="space-y-1.5">
                                {references.map((reference) => <div key={reference.id} className="truncate rounded-lg border border-current/10 px-2.5 py-2 text-xs" title={reference.title}>{reference.title}</div>)}
                            </div>
                        ) : <div className="rounded-lg border border-dashed border-current/15 px-3 py-4 text-center text-xs opacity-45">暂无连接的参考素材</div>}
                    </div>
                    {node.metadata?.errorDetails ? <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs leading-5 text-red-400">{node.metadata.errorDetails}</div> : null}
                    {node.metadata?.assetVersionId ? (
                        <Button block icon={<ExternalLink className="size-4" />} onClick={() => onOpenVersion(node.id)}>
                            查看资产版本
                        </Button>
                    ) : null}
                </div>
            ) : connection ? (
                <div className="space-y-4">
                    <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-45">连线检查器</div>
                        <div className="mt-2 flex items-center gap-2 text-sm font-semibold">
                            <Cable className="size-4" />
                            {fromNode?.title || "来源"} → {toNode?.title || "目标"}
                        </div>
                    </div>
                    <Info label="资源类型" value={connection.resourceType || "自动识别"} />
                    <InspectorField label="引用角色">
                        <Select className="w-full" value={connection.role || "data"} options={ROLE_OPTIONS} onChange={(role) => onUpdateConnectionRole(connection.id, role)} />
                    </InspectorField>
                    <div className="grid grid-cols-2 gap-2">
                        <Button icon={<Unplug className="size-4" />} onClick={() => onReconnect(connection.id)}>
                            重新连接
                        </Button>
                        <Button danger icon={<Trash2 className="size-4" />} onClick={() => onDeleteConnection(connection.id)}>
                            断开
                        </Button>
                    </div>
                </div>
            ) : null}
        </aside>
    );
}

function InspectorField({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block space-y-1.5">
            <span className="text-xs font-medium opacity-55">{label}</span>
            {children}
        </label>
    );
}

function Info({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0 rounded-lg border border-current/10 p-2">
            <div className="opacity-45">{label}</div>
            <div className="mt-1 truncate font-medium" title={value}>
                {value}
            </div>
        </div>
    );
}
