import { FileText, Image as ImageIcon, Music2, Plus, Puzzle, Video, X } from "lucide-react";
import { Popover, Select } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { getGroupResourceNodes } from "@/lib/canvas/canvas-resource-references";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { isVideoExtensionReference } from "./canvas-node-generation";

export function CanvasNodeReferenceBar({ nodeId, nodes, connectedNodes, connections = [], allowVideoPurpose = false, onDisconnect, onStartSelection, onVideoPurposeChange }: { nodeId: string; nodes: CanvasNodeData[]; connectedNodes: CanvasNodeData[]; connections?: CanvasConnection[]; allowVideoPurpose?: boolean; onDisconnect?: (fromNodeId: string, toNodeId: string) => void; onStartSelection?: (nodeId: string) => void; onVideoPurposeChange?: (fromNodeId: string, toNodeId: string, role: "motion" | "video_input") => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const references = connectedNodes.flatMap((sourceNode) => (sourceNode.type === CanvasNodeType.Group ? getGroupResourceNodes(sourceNode.id, nodes) : [sourceNode]).map((node) => ({ node, sourceNodeId: sourceNode.id })));
    const hasImageReference = references.some(({ node }) => referenceKind(node) === "image");
    return (
        <div className="mb-2">
            <div className="mb-1.5 text-[11px] font-medium" style={{ color: theme.node.muted }}>{t("canvas.references.title")}</div>
            <div className="thin-scrollbar flex min-h-12 items-start gap-2 overflow-x-auto pb-1">
                {references.map(({ node, sourceNodeId }) => {
                    const connection = connections.find((item) => item.fromNodeId === sourceNodeId && item.toNodeId === nodeId);
                    return <ReferenceItem key={`${sourceNodeId}:${node.id}`} node={node} videoPurpose={allowVideoPurpose && sourceNodeId === node.id && referenceKind(node) === "video" ? (isVideoExtensionReference(connection, hasImageReference) ? "video_input" : "motion") : undefined} onVideoPurposeChange={(role) => onVideoPurposeChange?.(sourceNodeId, nodeId, role)} onRemove={() => onDisconnect?.(sourceNodeId, nodeId)} />;
                })}
                <button type="button" className="grid size-12 shrink-0 place-items-center rounded-xl border bg-transparent transition hover:opacity-70" style={{ borderColor: theme.toolbar.border, color: theme.node.muted }} title={t("canvas.references.select")} onClick={() => onStartSelection?.(nodeId)}>
                    <Plus className="size-4" />
                </button>
            </div>
        </div>
    );
}

function ReferenceItem({ node, videoPurpose, onVideoPurposeChange, onRemove }: { node: CanvasNodeData; videoPurpose?: "motion" | "video_input"; onVideoPurposeChange: (role: "motion" | "video_input") => void; onRemove: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    const content = node.metadata?.content || resource?.url;
    const kind = referenceKind(node);
    const Icon = kind === "image" ? ImageIcon : kind === "video" ? Video : kind === "audio" ? Music2 : kind === "text" ? FileText : Puzzle;
    return (
        <div className={videoPurpose ? "w-24 shrink-0" : "w-12 shrink-0"}>
            <Popover placement="topLeft" mouseEnterDelay={0.15} content={<ReferencePreview node={node} content={content} />}>
                <div className="group relative mx-auto grid size-12 place-items-center rounded-xl border" style={{ background: theme.toolbar.activeBg, borderColor: theme.toolbar.border }}>
                    <span className="grid size-full place-items-center overflow-hidden rounded-[inherit]">
                        {kind === "image" && content ? <img src={content} alt="" className="size-full object-cover" /> : kind === "video" && content ? <video src={content} className="size-full object-cover" muted /> : <Icon className="size-4 opacity-65" />}
                    </span>
                    <button type="button" className="absolute right-0 top-0 grid size-5 place-items-center rounded-full border opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }} aria-label={t("canvas.references.disconnect")} title={t("canvas.references.disconnect")} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRemove(); }}><X className="size-3" /></button>
                </div>
            </Popover>
            {videoPurpose ? (
                <Select
                    size="small"
                    variant="borderless"
                    value={videoPurpose}
                    className="mt-0.5 w-full text-[11px]"
                    options={[{ value: "motion", label: t("canvas.references.motionReference") }, { value: "video_input", label: t("canvas.references.videoExtension") }]}
                    onMouseDown={(event) => event.stopPropagation()}
                    onChange={onVideoPurposeChange}
                />
            ) : null}
        </div>
    );
}

function referenceKind(node: CanvasNodeData) {
    return getNodeDefinition(node.type)?.resource?.(node)?.kind || (node.type === CanvasNodeType.Image ? "image" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : node.type === CanvasNodeType.Text ? "text" : "asset");
}

function ReferencePreview({ node, content }: { node: CanvasNodeData; content?: string }) {
    const { t } = useTranslation();
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    if ((resource?.kind === "image" || node.type === CanvasNodeType.Image) && content) return <img src={content} alt={node.title} className="max-h-52 w-72 rounded-lg object-contain" />;
    if ((resource?.kind === "video" || node.type === CanvasNodeType.Video) && content) return <video src={content} className="max-h-52 w-72 rounded-lg" muted controls />;
    if ((resource?.kind === "audio" || node.type === CanvasNodeType.Audio) && content) return <audio src={content} className="w-72" controls />;
    return <div className="max-h-52 w-72 overflow-auto whitespace-pre-wrap text-sm">{resource?.text || node.metadata?.content || node.metadata?.prompt || node.title || t("canvas.references.empty")}</div>;
}
