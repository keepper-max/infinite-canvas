import { nanoid } from "nanoid";

import { DRAMA_NODE_TYPES } from "@/components/canvas/nodes/drama-nodes";
import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import type { CanvasConnection, CanvasNodeData, Position } from "@/types/canvas";

export const DIRECTOR_WORKFLOW_VERSION = 1;

export type DirectorWorkflowProfile = "short" | "standard" | "full";

export type DirectorWorkflowPlan = {
    title: string;
    synopsis: string;
    profile: DirectorWorkflowProfile;
    story: string;
    script: string;
    characters: string;
    scenes: string;
    props: string;
    storyboard: string;
    seedance: string;
    productionNotes: string[];
    missingMaterials: string[];
};

type TemplateKey = keyof typeof DRAMA_NODE_TYPES;
type Link = { from: TemplateKey; to: TemplateKey; role: NonNullable<CanvasConnection["role"]>; resourceType: NonNullable<CanvasConnection["resourceType"]> };

const layout: Array<{ key: TemplateKey; x: number; y: number }> = [
    { key: "story", x: 0, y: 300 },
    { key: "writer", x: 460, y: 300 },
    { key: "breakdown", x: 920, y: 300 },
    { key: "character", x: 1380, y: 0 },
    { key: "scene", x: 1380, y: 300 },
    { key: "prop", x: 1380, y: 600 },
    { key: "storyboard", x: 1380, y: 900 },
    { key: "turnaround", x: 1840, y: 0 },
    { key: "panorama", x: 1840, y: 300 },
    { key: "optimize", x: 1980, y: 900 },
    { key: "composition", x: 2320, y: 300 },
    { key: "skill", x: 2580, y: 900 },
    { key: "firstFrame", x: 2820, y: 180 },
    { key: "lastFrame", x: 3300, y: 180 },
    { key: "video", x: 3820, y: 420 },
    { key: "voice", x: 3360, y: 840 },
    { key: "sfx", x: 3820, y: 840 },
    { key: "music", x: 3820, y: 1140 },
    { key: "subtitles", x: 3360, y: 1180 },
    { key: "timeline", x: 4300, y: 520 },
    { key: "output", x: 4960, y: 520 },
];

const links: Link[] = [
    { from: "story", to: "writer", role: "data", resourceType: "text" },
    { from: "writer", to: "breakdown", role: "data", resourceType: "json" },
    { from: "breakdown", to: "character", role: "data", resourceType: "json" },
    { from: "breakdown", to: "scene", role: "data", resourceType: "json" },
    { from: "breakdown", to: "prop", role: "data", resourceType: "json" },
    { from: "breakdown", to: "storyboard", role: "data", resourceType: "json" },
    { from: "story", to: "storyboard", role: "data", resourceType: "text" },
    { from: "character", to: "turnaround", role: "data", resourceType: "json" },
    { from: "scene", to: "panorama", role: "data", resourceType: "json" },
    { from: "storyboard", to: "optimize", role: "data", resourceType: "json" },
    { from: "turnaround", to: "composition", role: "identity", resourceType: "image" },
    { from: "panorama", to: "composition", role: "environment", resourceType: "image" },
    { from: "storyboard", to: "composition", role: "data", resourceType: "json" },
    { from: "optimize", to: "skill", role: "data", resourceType: "prompt" },
    { from: "storyboard", to: "skill", role: "data", resourceType: "json" },
    { from: "turnaround", to: "firstFrame", role: "identity", resourceType: "image" },
    { from: "panorama", to: "firstFrame", role: "environment", resourceType: "image" },
    { from: "composition", to: "firstFrame", role: "composition", resourceType: "image" },
    { from: "firstFrame", to: "lastFrame", role: "first_frame", resourceType: "image" },
    { from: "skill", to: "video", role: "data", resourceType: "prompt" },
    { from: "turnaround", to: "video", role: "identity", resourceType: "image" },
    { from: "panorama", to: "video", role: "environment", resourceType: "image" },
    { from: "composition", to: "video", role: "composition", resourceType: "image" },
    { from: "firstFrame", to: "video", role: "first_frame", resourceType: "image" },
    { from: "lastFrame", to: "video", role: "last_frame", resourceType: "image" },
    { from: "storyboard", to: "voice", role: "data", resourceType: "json" },
    { from: "character", to: "voice", role: "data", resourceType: "json" },
    { from: "storyboard", to: "sfx", role: "data", resourceType: "json" },
    { from: "storyboard", to: "music", role: "data", resourceType: "json" },
    { from: "storyboard", to: "subtitles", role: "data", resourceType: "json" },
    { from: "video", to: "timeline", role: "video_input", resourceType: "video" },
    { from: "voice", to: "timeline", role: "audio_input", resourceType: "audio" },
    { from: "sfx", to: "timeline", role: "audio_input", resourceType: "audio" },
    { from: "music", to: "timeline", role: "audio_input", resourceType: "audio" },
    { from: "subtitles", to: "timeline", role: "data", resourceType: "timeline" },
    { from: "timeline", to: "output", role: "data", resourceType: "timeline" },
];

const profiles: Record<DirectorWorkflowProfile, TemplateKey[]> = {
    short: ["story", "storyboard", "skill", "video"],
    standard: ["story", "writer", "breakdown", "character", "scene", "storyboard", "turnaround", "panorama", "optimize", "composition", "skill", "firstFrame", "video", "voice", "sfx", "subtitles", "timeline", "output"],
    full: layout.map((item) => item.key),
};

export function directorSystemPrompt(input: string, requestedProfile: DirectorWorkflowProfile | "auto") {
    return `你是守守画布的漫剧总导演。把用户想法规划成一份可以由现有画布节点执行的漫剧生产方案。只返回合法 JSON，不使用 Markdown。

硬性规则：
1. 只规划，不生成图片、视频或音频，不虚构已经看过任何素材。
2. profile 只能是 short、standard、full。用户指定时必须遵守；auto 时：单镜头或极短概念用 short，常规多镜头漫剧用 standard，明确要求完整后期、配乐、首尾帧控制或复杂资产时才用 full。
3. 每个镜头只承担一个主要叙事任务，写清动作起点、动作终点和下一段接续状态。
4. 素材缺失只写入 missingMaterials，不得假装素材已经存在。
5. 不写模型 ID、价格、分辨率、时长上限或平台能力；Seedance 2.0 的参数不得套到其他版本。
6. seedance 字段只写通用导演要求：人物与素材职责、动作因果、镜头、光线、声音、连续性和禁止迁移项。

JSON 结构：
{"title":"项目名","synopsis":"一句话梗概","profile":"short|standard|full","story":"故事目标、起点和结局","script":"按场次组织的剧本要求","characters":"角色身份、外观、服装、状态与关系","scenes":"场景空间、时间和光线连续性","props":"关键道具、归属和状态","storyboard":"逐镜头任务、动作起点、动作终点、接续状态、对白和声音","seedance":"Seedance 导演编译要求","productionNotes":["制作提示"],"missingMaterials":["需要用户补充的素材"]}

用户选择：${requestedProfile}
用户想法：${input}`;
}

export function parseDirectorPlan(text: string): DirectorWorkflowPlan {
    const source = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] || text.trim();
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("导演模型没有返回可用的工作流结构");
    const value = JSON.parse(source.slice(start, end + 1)) as Record<string, unknown>;
    const profile = ["short", "standard", "full"].includes(String(value.profile)) ? (value.profile as DirectorWorkflowProfile) : "standard";
    const clean = (item: unknown) => (typeof item === "string" ? item.trim() : "");
    const list = (item: unknown) => (Array.isArray(item) ? item.map(clean).filter(Boolean).slice(0, 20) : []);
    const story = clean(value.story) || clean(value.synopsis);
    if (!story) throw new Error("导演方案缺少故事目标");
    return {
        title: clean(value.title) || "未命名漫剧",
        synopsis: clean(value.synopsis) || story.slice(0, 160),
        profile,
        story,
        script: clean(value.script) || story,
        characters: clean(value.characters),
        scenes: clean(value.scenes),
        props: clean(value.props),
        storyboard: clean(value.storyboard) || story,
        seedance: clean(value.seedance) || "保持人物、服装、场景、道具、动作和声音连续；每个镜头只完成当前任务。",
        productionNotes: list(value.productionNotes),
        missingMaterials: list(value.missingMaterials),
    };
}

export function directorWorkflowNodeKeys(profile: DirectorWorkflowProfile) {
    return profiles[profile];
}

export function buildDirectorWorkflow(plan: DirectorWorkflowPlan, origin: Position): { nodes: CanvasNodeData[]; connections: CanvasConnection[] } {
    const active = new Set(profiles[plan.profile]);
    const buildId = `director-${nanoid(10)}`;
    const byKey = new Map<TemplateKey, CanvasNodeData>();
    const nodes = layout
        .filter(({ key }) => active.has(key))
        .map(({ key, x, y }) => {
            const node = createCanvasNode(DRAMA_NODE_TYPES[key], { x: origin.x + x, y: origin.y + y });
            const brief = briefFor(key, plan);
            node.metadata = {
                ...node.metadata,
                ...(key === "story" ? { content: brief } : {}),
                drama: { ...node.metadata?.drama, schemaVersion: 1, brief, directorBuildId: buildId, directorWorkflowVersion: DIRECTOR_WORKFLOW_VERSION },
            };
            byKey.set(key, node);
            return node;
        });
    const connections = links
        .filter((link) => active.has(link.from) && active.has(link.to))
        .filter((link) => !(link.from === "story" && link.to === "storyboard" && active.has("breakdown")))
        .map((link, index) => {
            const source = byKey.get(link.from)!;
            const target = byKey.get(link.to)!;
            return {
                id: nanoid(),
                fromNodeId: source.id,
                toNodeId: target.id,
                sourcePortId: `${source.workflowKind}.output`,
                targetPortId: `${target.workflowKind}.input`,
                role: link.role,
                resourceType: link.resourceType,
                order: index,
                metadata: { directorBuildId: buildId, directorWorkflowVersion: DIRECTOR_WORKFLOW_VERSION },
            } satisfies CanvasConnection;
        });
    return { nodes, connections };
}

export function directorWorkflowOrigin(nodes: CanvasNodeData[]): Position {
    if (!nodes.length) return { x: 160, y: 160 };
    return { x: Math.max(...nodes.map((node) => node.position.x + node.width)) + 240, y: Math.min(...nodes.map((node) => node.position.y)) };
}

function briefFor(key: TemplateKey, plan: DirectorWorkflowPlan) {
    const values: Partial<Record<TemplateKey, string>> = {
        story: plan.story,
        writer: plan.script,
        breakdown: `按本项目实际内容拆解角色、场景、道具和镜头，不补写无关剧情。\n${plan.script}`,
        character: plan.characters || "根据剧本建立主要角色卡，缺失的身份或外观信息保留为待确认。",
        turnaround: plan.characters || "根据已确认角色卡生成一致的角色三视图。",
        scene: plan.scenes || "根据剧本建立场景空间、时间和光线连续性。",
        panorama: plan.scenes || "根据已确认场景建立可复用的全景环境母版。",
        prop: plan.props || "提取会影响剧情和连续性的关键道具，记录归属与状态。",
        storyboard: plan.storyboard,
        optimize: `把分镜改写为可见动作、明确机位、物理光源和声音意图。\n${plan.seedance}`,
        composition: "根据角色、场景和分镜明确机位、站位、比例、视线和动作空间。",
        skill: plan.seedance,
        firstFrame: "从当前分镜建立动作起点，锁定人物、场景、道具、构图和光线。",
        lastFrame: "从当前分镜建立动作终点和下一段接续状态，不提前完成未来动作。",
        video: plan.seedance,
        voice: "根据分镜对白和角色声音设定生成角色配音。",
        sfx: "根据每个镜头的动作因果生成同步音效与环境声。",
        music: "根据整集叙事曲线规划统一配乐，避免每个片段各自重启音乐。",
        subtitles: "根据分镜对白生成并校对字幕时间。",
        timeline: "按分镜顺序排列视频、对白、音效、音乐和字幕，保留镜头接续。",
        output: "合成并保存完整成片。",
    };
    return values[key] || plan.synopsis;
}
