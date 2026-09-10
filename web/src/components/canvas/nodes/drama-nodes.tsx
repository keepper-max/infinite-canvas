import { useState, type ReactNode } from "react";
import { App, Button, Input, InputNumber, Select, Tag } from "antd";
import { BookOpen, Box, Camera, Clapperboard, FileJson, Film, Image as ImageIcon, LayoutList, Map, Package, PanelsTopLeft, Sparkles, UserRound, WandSparkles } from "lucide-react";

import { executeDramaNode, markDramaDescendantsStale } from "@/lib/drama/drama-runtime";
import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import type { CanvasNodeContext, CanvasNodeDefinition, CanvasNodeResource } from "@/types/canvas-plugin";
import type { DramaCharacterCard, DramaNodeState, DramaStoryboardShot, DramaWorkflowKind, SeedanceSkillResult } from "@/types/drama";

export const DRAMA_NODE_TYPES = {
    story: "drama:story",
    writer: "drama:writer",
    breakdown: "drama:breakdown",
    character: "drama:character",
    turnaround: "drama:turnaround",
    scene: "drama:scene",
    panorama: "drama:panorama",
    prop: "drama:prop",
    composition: "drama:composition",
    storyboard: "drama:storyboard",
    optimize: "drama:prompt-optimize",
    firstFrame: "drama:first-frame",
    lastFrame: "drama:last-frame",
    skill: "drama:seedance-skill",
    video: "drama:seedance-video",
} as const;

type DramaDefinitionInput = Omit<CanvasNodeDefinition, "Content" | "Panel" | "defaultMetadata" | "definitionVersion"> & {
    workflowKind: DramaWorkflowKind;
    tone: string;
    defaultBrief?: string;
};

const definitions: DramaDefinitionInput[] = [
    node(DRAMA_NODE_TYPES.story, "故事创意", "story.idea", <BookOpen />, "#8b5cf6", "输入故事主题、人物关系和结局目标"),
    node(DRAMA_NODE_TYPES.writer, "AI 编剧", "story.writer", <WandSparkles />, "#7c3aed", "把创意发展成可拆解剧本"),
    node(DRAMA_NODE_TYPES.breakdown, "剧本拆解", "script.breakdown", <FileJson />, "#6366f1", "提取角色、场景、道具与镜头"),
    node(DRAMA_NODE_TYPES.character, "角色设定", "character.profile", <UserRound />, "#f59e0b", "固定身份、外观、服装与声音"),
    node(DRAMA_NODE_TYPES.turnaround, "角色三视图", "character.turnaround", <PanelsTopLeft />, "#f97316", "生成身份一致的正侧背三视图", "角色全身，正面、侧面、背面三视图"),
    node(DRAMA_NODE_TYPES.scene, "场景候选", "scene.candidate", <Map />, "#10b981", "建立场景空间与光线"),
    node(DRAMA_NODE_TYPES.panorama, "全景环境", "scene.panorama", <ImageIcon />, "#14b8a6", "生成空间连续性母版"),
    node(DRAMA_NODE_TYPES.prop, "关键道具", "prop.image", <Package />, "#84cc16", "固定道具结构、归属和状态"),
    node(DRAMA_NODE_TYPES.composition, "3D 构图", "composition.3d", <Box />, "#06b6d4", "明确机位、站位、比例和视线"),
    node(DRAMA_NODE_TYPES.storyboard, "分镜表", "storyboard.plan", <LayoutList />, "#3b82f6", "镜头、时长、动作、运镜与对白"),
    node(DRAMA_NODE_TYPES.optimize, "提示词优化", "prompt.optimize", <Sparkles />, "#a855f7", "把镜头目标改写成可执行描述"),
    node(DRAMA_NODE_TYPES.firstFrame, "首帧", "frame.first", <Camera />, "#ec4899", "绑定角色和场景的动作起点"),
    node(DRAMA_NODE_TYPES.lastFrame, "尾帧", "frame.last", <Camera />, "#db2777", "锁定当前镜头动作终点"),
    node(DRAMA_NODE_TYPES.skill, "Seedance 漫剧 Skill", "skill.seedance", <Clapperboard />, "#f43f5e", "编译镜头、动作、连续性和声音"),
    node(DRAMA_NODE_TYPES.video, "Seedance 视频", "video.seedance", <Film />, "#ef4444", "按首帧、尾帧或多参考生成视频"),
];

function node(type: string, title: string, workflowKind: DramaWorkflowKind, icon: ReactNode, tone: string, description: string, defaultBrief = ""): DramaDefinitionInput {
    const media = ["character.turnaround", "scene.candidate", "scene.panorama", "prop.image", "composition.3d", "frame.first", "frame.last", "video.seedance"].includes(workflowKind);
    return {
        type,
        title,
        workflowKind,
        icon,
        tone,
        description,
        defaultBrief,
        defaultSize: workflowKind === "storyboard.plan" ? { width: 560, height: 320 } : media ? { width: 360, height: 240 } : { width: 380, height: 250 },
        minimapColor: tone,
        autoOpenPanel: true,
        resource: dramaResource,
        execution: { capability: workflowKind === "story.idea" ? "none" : workflowKind === "video.seedance" ? "video" : media ? "image" : "text" },
        execute: executeDramaNode,
        ports: dramaPorts(workflowKind),
    };
}

function dramaPorts(kind: DramaWorkflowKind): NonNullable<CanvasNodeDefinition["ports"]> {
    const allRoles = ["data", "identity", "environment", "composition", "motion", "first_frame", "last_frame", "video_input", "audio_input"] as const;
    const outputType =
        kind === "video.seedance"
            ? "video"
            : ["character.turnaround", "scene.candidate", "scene.panorama", "prop.image", "composition.3d", "frame.first", "frame.last"].includes(kind)
              ? "image"
              : kind === "skill.seedance" || kind === "prompt.optimize"
                ? "prompt"
                : "json";
    return [
        ...(kind === "story.idea"
            ? []
            : [
                  {
                      id: `${kind}.input`,
                      label: "输入",
                      direction: "input" as const,
                      resourceTypes: ["text", "prompt", "image", "video", "audio", "json", "asset"] as NonNullable<CanvasNodeDefinition["ports"]>[number]["resourceTypes"],
                      roles: [...allRoles],
                      cardinality: "many" as const,
                  },
              ]),
        { id: `${kind}.output`, label: "输出", direction: "output", resourceTypes: [outputType], roles: [...allRoles], cardinality: "many" },
    ];
}

function dramaResource(nodeData: Parameters<NonNullable<CanvasNodeDefinition["resource"]>>[0]): CanvasNodeResource | null {
    const kind = nodeData.workflowKind || "";
    const content = nodeData.metadata?.content;
    if (kind === "video.seedance" && content) return { kind: "video", url: content };
    if (["character.turnaround", "scene.candidate", "scene.panorama", "prop.image", "composition.3d", "frame.first", "frame.last"].includes(kind) && content) return { kind: "image", url: content };
    if (content) return { kind: "text", text: content };
    return null;
}

let registered = false;
export function registerDramaNodes() {
    if (registered) return;
    registered = true;
    registerNodeDefinitions(
        definitions.map(({ tone, defaultBrief, ...definition }) => ({
            ...definition,
            definitionVersion: 1,
            defaultMetadata: { status: "idle", drama: { schemaVersion: 1, brief: defaultBrief }, ...(definition.workflowKind === "video.seedance" ? { seconds: "5", vquality: "720p", size: "1280x720", generateAudio: "true" } : {}) },
            Content: DramaNodeContent,
            Panel: DramaNodePanel,
        })),
        "builtin",
    );
}

function DramaNodeContent({ ctx }: { ctx: CanvasNodeContext }) {
    const drama = ctx.node.metadata?.drama;
    const kind = ctx.node.workflowKind || "";
    const tone = definitions.find((item) => item.type === ctx.node.type)?.tone || "#8b5cf6";
    const content = ctx.node.metadata?.content;
    if (kind === "video.seedance" && content) return <video src={content} className="h-full w-full object-cover" muted controls />;
    if (["character.turnaround", "scene.candidate", "scene.panorama", "prop.image", "composition.3d", "frame.first", "frame.last"].includes(kind) && content) return <img src={content} alt={ctx.node.title} className="h-full w-full object-cover" />;
    if (kind === "storyboard.plan" && drama?.shots?.length) return <StoryboardPreview rows={drama.shots} tone={tone} />;
    if (kind === "character.profile" && drama?.character) return <CharacterPreview card={drama.character} tone={tone} />;
    if (kind === "skill.seedance" && drama?.skillResult) return <SkillPreview value={drama.skillResult} tone={tone} />;
    return (
        <div className="flex h-full flex-col gap-3 overflow-hidden p-4" style={{ color: ctx.theme.node.text }}>
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{ctx.node.title}</span>
                <div className="flex items-center gap-1.5">
                    {drama?.stale ? <Tag color="orange">需更新</Tag> : null}
                    {drama?.accepted ? <Tag color="green">已采用</Tag> : null}
                </div>
            </div>
            <div className="h-1 rounded-full" style={{ background: tone }} />
            <p className="line-clamp-6 whitespace-pre-wrap text-xs leading-5" style={{ color: ctx.theme.node.muted }}>
                {content || drama?.brief || "双击节点填写内容并执行"}
            </p>
            {drama?.lastRunAt ? <span className="mt-auto text-[10px] opacity-45">{new Date(drama.lastRunAt).toLocaleString()}</span> : null}
        </div>
    );
}

function DramaNodePanel({ ctx, onClose }: { ctx: CanvasNodeContext; onClose: () => void }) {
    const { message } = App.useApp();
    const [running, setRunning] = useState(false);
    const drama = ctx.node.metadata?.drama || { schemaVersion: 1 as const };
    const kind = ctx.node.workflowKind || "";
    const update = (patch: Partial<DramaNodeState>, metadata: Record<string, unknown> = {}) => {
        ctx.updateMetadata({ ...metadata, drama: { ...drama, ...patch, schemaVersion: 1, stale: false, userModified: true } });
        markDramaDescendantsStale(ctx, ctx.node.id);
    };
    const run = async () => {
        setRunning(true);
        try {
            await executeDramaNode(ctx);
            message.success("节点执行完成");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "节点执行失败");
        } finally {
            setRunning(false);
        }
    };
    return (
        <div className="rounded-2xl border p-4 shadow-2xl" data-canvas-no-zoom style={{ background: ctx.theme.node.panel, borderColor: ctx.theme.node.stroke, color: ctx.theme.node.text }} onPointerDown={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
                <div>
                    <div className="font-semibold">{ctx.node.title}</div>
                    <div className="mt-1 text-xs opacity-55">{definitions.find((item) => item.type === ctx.node.type)?.description}</div>
                </div>
                <Button type="text" onClick={onClose}>
                    关闭
                </Button>
            </div>
            {kind === "character.profile" ? <CharacterEditor value={drama.character} onChange={(character) => update({ character, output: character }, { content: JSON.stringify(character, null, 2) })} /> : null}
            {kind === "storyboard.plan" ? <StoryboardEditor rows={drama.shots || []} onChange={(shots) => update({ shots, output: { shots } }, { content: JSON.stringify({ shots }, null, 2) })} /> : null}
            {kind === "skill.seedance" ? <SkillEditor value={drama.skillResult} onChange={(skillResult) => update({ skillResult, output: skillResult }, { content: skillResult.prompt, prompt: skillResult.prompt })} /> : null}
            {!["character.profile", "storyboard.plan", "skill.seedance"].includes(kind) ? (
                <div className="grid gap-3">
                    <label className="text-xs opacity-60">创作要求</label>
                    <Input.TextArea
                        autoSize={{ minRows: 4, maxRows: 10 }}
                        value={drama.brief || ""}
                        onChange={(event) => update({ brief: event.target.value }, kind === "story.idea" ? { content: event.target.value } : {})}
                        placeholder="填写当前节点需要完成的内容"
                    />
                    {drama.output != null ? (
                        <>
                            <label className="text-xs opacity-60">结构化结果</label>
                            <Input.TextArea
                                autoSize={{ minRows: 3, maxRows: 8 }}
                                value={typeof drama.output === "string" ? drama.output : JSON.stringify(drama.output, null, 2)}
                                onChange={(event) => update({ output: event.target.value }, { content: event.target.value })}
                            />
                        </>
                    ) : null}
                </div>
            ) : null}
            {kind === "video.seedance" ? (
                <div className="mt-3 grid grid-cols-3 gap-2">
                    <InputNumber min={1} max={30} value={Number(ctx.node.metadata?.seconds || 5)} addonAfter="秒" onChange={(value) => ctx.updateMetadata({ seconds: String(value || 5) })} />
                    <Select value={ctx.node.metadata?.vquality || "720p"} options={["480p", "720p", "1080p"].map((value) => ({ value, label: value }))} onChange={(value) => ctx.updateMetadata({ vquality: value })} />
                    <Select value={ctx.node.metadata?.size || "1280x720"} options={["1280x720", "720x1280", "1024x1024"].map((value) => ({ value, label: value }))} onChange={(value) => ctx.updateMetadata({ size: value })} />
                </div>
            ) : null}
            <div className="mt-4 flex items-center justify-between">
                <div className="text-xs opacity-55">
                    {drama.inputHash ? `输入 ${drama.inputHash}` : "尚未执行"}
                    {drama.skillVersion ? ` · Skill ${drama.skillVersion}` : ""}
                </div>
                <Button type="primary" loading={running} onClick={() => void run()}>
                    {kind === "story.idea" ? "确认故事" : "执行此节点"}
                </Button>
            </div>
        </div>
    );
}

function CharacterPreview({ card, tone }: { card: DramaCharacterCard; tone: string }) {
    return (
        <div className="h-full overflow-hidden p-4">
            <div className="mb-2 flex items-center gap-2">
                <UserRound className="size-4" style={{ color: tone }} />
                <b>{card.name}</b>
            </div>
            <div className="grid gap-1 text-xs opacity-70">
                <span>{card.identity}</span>
                <span>{card.appearance}</span>
                <span>{card.wardrobe}</span>
                <span>状态：{card.state || "待定"}</span>
                {card.turnaroundVersionId ? <span className="truncate">三视图版本：{card.turnaroundVersionId}</span> : null}
            </div>
        </div>
    );
}
function CharacterEditor({ value, onChange }: { value?: DramaCharacterCard; onChange: (value: DramaCharacterCard) => void }) {
    const card = value || { name: "", identity: "", appearance: "", wardrobe: "", state: "", shotIds: [] };
    const field = (key: keyof DramaCharacterCard, label: string) => <Input value={String(card[key] || "")} placeholder={label} onChange={(event) => onChange({ ...card, [key]: event.target.value })} />;
    return (
        <div className="grid grid-cols-2 gap-2">
            {field("name", "角色名")}
            {field("identity", "身份")}
            {field("appearance", "外观")}
            {field("wardrobe", "服装")}
            {field("state", "当前状态")}
            {field("voiceBinding", "声音绑定")}
            <Input className="col-span-2" value={card.shotIds.join("；")} placeholder="出现镜头，如 S001；S003" onChange={(event) => onChange({ ...card, shotIds: splitList(event.target.value) })} />
            {card.turnaroundVersionId ? <Input className="col-span-2" value={card.turnaroundVersionId} disabled addonBefore="三视图版本" /> : null}
        </div>
    );
}
function StoryboardPreview({ rows, tone }: { rows: DramaStoryboardShot[]; tone: string }) {
    return (
        <div className="h-full overflow-auto p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
                <LayoutList className="size-4" style={{ color: tone }} />
                {rows.length} 个镜头
            </div>
            {rows.slice(0, 5).map((row) => (
                <div key={row.id} className="grid grid-cols-[44px_42px_1fr] gap-2 border-t py-2 text-[10px]" style={{ borderColor: `${tone}35` }}>
                    <b>{row.id}</b>
                    <span>{row.durationSec}s</span>
                    <span className="truncate">{row.picture || row.action}</span>
                </div>
            ))}
        </div>
    );
}
function StoryboardEditor({ rows, onChange }: { rows: DramaStoryboardShot[]; onChange: (rows: DramaStoryboardShot[]) => void }) {
    const update = (index: number, patch: Partial<DramaStoryboardShot>) => onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
    return (
        <div className="grid max-h-[460px] gap-3 overflow-auto">
            {rows.map((row, index) => (
                <div key={`${row.id}-${index}`} className="grid grid-cols-2 gap-2 rounded-xl border p-2">
                    <div className="col-span-2 grid grid-cols-[72px_90px_100px_1fr] gap-2">
                        <Input value={row.id} onChange={(event) => update(index, { id: event.target.value })} />
                        <InputNumber min={1} max={30} value={row.durationSec} addonAfter="秒" onChange={(value) => update(index, { durationSec: value || 5 })} />
                        <Input value={row.shotSize} placeholder="景别" onChange={(event) => update(index, { shotSize: event.target.value })} />
                        <Input value={row.sceneId} placeholder="场景 ID" onChange={(event) => update(index, { sceneId: event.target.value })} />
                    </div>
                    <Input value={row.picture} placeholder="画面" onChange={(event) => update(index, { picture: event.target.value })} />
                    <Input value={row.action} placeholder="主要动作与终点" onChange={(event) => update(index, { action: event.target.value })} />
                    <Input value={row.camera} placeholder="运镜" onChange={(event) => update(index, { camera: event.target.value })} />
                    <Input value={row.dialogue} placeholder="对白" onChange={(event) => update(index, { dialogue: event.target.value })} />
                    <Input className="col-span-2" value={row.characterIds.join("；")} placeholder="角色 ID，如 character-1；character-2" onChange={(event) => update(index, { characterIds: splitList(event.target.value) })} />
                    <div className="col-span-2 flex gap-3 text-xs opacity-55">
                        <span>首帧：{row.firstFrameStatus}</span>
                        <span>视频：{row.videoStatus}</span>
                    </div>
                </div>
            ))}
            <Button
                onClick={() =>
                    onChange([
                        ...rows,
                        { id: `S${String(rows.length + 1).padStart(3, "0")}`, durationSec: 5, shotSize: "中景", picture: "", action: "", camera: "", dialogue: "", characterIds: [], sceneId: "", firstFrameStatus: "pending", videoStatus: "pending" },
                    ])
                }
            >
                添加镜头
            </Button>
        </div>
    );
}
function SkillPreview({ value, tone }: { value: SeedanceSkillResult; tone: string }) {
    return (
        <div className="h-full overflow-hidden p-4">
            <div className="mb-2 flex items-center justify-between">
                <b>生成模式</b>
                <Tag color={tone}>{value.recommendedMode}</Tag>
            </div>
            <p className="line-clamp-5 whitespace-pre-wrap text-xs leading-5 opacity-70">{value.prompt}</p>
            <div className="mt-2 text-[10px] opacity-50">
                {value.camera} · {value.motion}
            </div>
        </div>
    );
}
function SkillEditor({ value, onChange }: { value?: SeedanceSkillResult; onChange: (value: SeedanceSkillResult) => void }) {
    const skill = value || { prompt: "", camera: "", motion: "", continuity: [], audio: "", negative: [], recommendedMode: "t2v" as const };
    return (
        <div className="grid gap-2">
            <Input.TextArea autoSize={{ minRows: 4, maxRows: 8 }} value={skill.prompt} placeholder="Seedance 自然语言提示词" onChange={(event) => onChange({ ...skill, prompt: event.target.value })} />
            <div className="grid grid-cols-2 gap-2">
                <Input value={skill.camera} placeholder="运镜" onChange={(event) => onChange({ ...skill, camera: event.target.value })} />
                <Input value={skill.motion} placeholder="动作" onChange={(event) => onChange({ ...skill, motion: event.target.value })} />
                <Input value={skill.audio} placeholder="声音" onChange={(event) => onChange({ ...skill, audio: event.target.value })} />
                <Select value={skill.recommendedMode} options={["t2v", "i2v", "flf2v", "multiref"].map((item) => ({ value: item, label: item }))} onChange={(recommendedMode) => onChange({ ...skill, recommendedMode })} />
            </div>
            <Input value={skill.continuity.join("；")} placeholder="连续性要求" onChange={(event) => onChange({ ...skill, continuity: event.target.value.split("；").filter(Boolean) })} />
            <Input value={skill.negative.join("；")} placeholder="负面约束" onChange={(event) => onChange({ ...skill, negative: event.target.value.split("；").filter(Boolean) })} />
        </div>
    );
}

function splitList(value: string) {
    return value
        .split(/[；;,，]/)
        .map((item) => item.trim())
        .filter(Boolean);
}
