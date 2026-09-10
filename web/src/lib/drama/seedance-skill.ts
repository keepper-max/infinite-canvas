import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import type { DramaCharacterCard, DramaStoryboardShot, SeedanceSkillResult } from "@/types/drama";

export const SEEDANCE_DRAMA_SKILL_ID = "seedance-20-drama";
export const SEEDANCE_DRAMA_SKILL_VERSION = "6.7.0";

export function buildDramaInputSnapshot(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const incoming = connections.filter((edge) => edge.toNodeId === node.id).sort((left, right) => (left.order || 0) - (right.order || 0));
    return {
        nodeId: node.id,
        workflowKind: node.workflowKind || "generic",
        brief: node.metadata?.drama?.brief || node.metadata?.prompt || "",
        inputs: incoming.map((edge) => {
            const source = nodes.find((item) => item.id === edge.fromNodeId);
            return {
                edgeId: edge.id,
                nodeId: edge.fromNodeId,
                title: source?.title || edge.fromNodeId,
                workflowKind: source?.workflowKind || "generic",
                resourceType: edge.resourceType || "asset",
                role: edge.role || "data",
                assetId: source?.metadata?.assetId,
                assetVersionId: source?.metadata?.assetVersionId,
                value: compactNodeValue(source),
            };
        }),
    };
}

export function hashDramaInput(value: unknown) {
    const text = stableStringify(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    return (hash >>> 0).toString(16).padStart(8, "0");
}

export function parseStructuredResponse(text: string) {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] || trimmed;
    const start = fenced.indexOf("{");
    const end = fenced.lastIndexOf("}");
    if (start < 0 || end <= start) return { text: trimmed };
    try {
        return JSON.parse(fenced.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
        return { text: trimmed };
    }
}

export function normalizeCharacter(value: unknown): DramaCharacterCard {
    const record = asRecord(value);
    return {
        name: clean(record.name) || "未命名角色",
        identity: clean(record.identity),
        appearance: clean(record.appearance),
        wardrobe: clean(record.wardrobe),
        state: clean(record.state),
        turnaroundVersionId: clean(record.turnaroundVersionId) || undefined,
        voiceBinding: clean(record.voiceBinding) || undefined,
        shotIds: stringList(record.shotIds),
    };
}

export function normalizeStoryboard(value: unknown): DramaStoryboardShot[] {
    const root = asRecord(value);
    const rows = Array.isArray(root.shots) ? root.shots : Array.isArray(value) ? value : [];
    return rows.slice(0, 100).map((item, index) => {
        const row = asRecord(item);
        return {
            id: clean(row.id) || `S${String(index + 1).padStart(3, "0")}`,
            durationSec: Math.max(1, Math.min(30, Number(row.durationSec) || 5)),
            shotSize: clean(row.shotSize),
            picture: clean(row.picture),
            action: clean(row.action),
            camera: clean(row.camera),
            dialogue: clean(row.dialogue),
            characterIds: stringList(row.characterIds),
            sceneId: clean(row.sceneId),
            firstFrameStatus: status(row.firstFrameStatus),
            videoStatus: status(row.videoStatus),
        };
    });
}

export function normalizeSeedanceSkillResult(value: unknown): SeedanceSkillResult {
    const root = asRecord(value);
    const recommended = clean(root.recommendedMode);
    return {
        prompt: clean(root.prompt) || clean(root.text),
        camera: clean(root.camera),
        motion: clean(root.motion),
        continuity: stringList(root.continuity),
        audio: clean(root.audio),
        negative: stringList(root.negative),
        recommendedMode: ["t2v", "i2v", "flf2v", "multiref"].includes(recommended) ? (recommended as SeedanceSkillResult["recommendedMode"]) : "t2v",
    };
}

export function dramaSystemPrompt(workflowKind: string) {
    const common = "你是AI漫剧制作系统。只处理当前节点，保持角色、服装、场景、道具和镜头连续性；不要提前完成后续剧情。只返回合法JSON，不使用Markdown代码块。";
    const prompts: Record<string, string> = {
        "story.writer": `${common} 根据故事创意输出 {title,logline,storyPromise,finalOutcome,script}。剧本按场次和动作组织。`,
        "script.breakdown": `${common} 从剧本提取 {characters:[{name,identity,appearance,wardrobe,state,voiceBinding,shotIds}],scenes:[{id,name,location,timeOfDay,atmosphere}],props:[{id,name,owner,state}],shots:[...]}。`,
        "character.profile": `${common} 输出一个主角色卡 {name,identity,appearance,wardrobe,state,voiceBinding,shotIds}，身份与服装描述必须可复用。`,
        "storyboard.plan": `${common} 输出 {shots:[{id,durationSec,shotSize,picture,action,camera,dialogue,characterIds,sceneId,firstFrameStatus,videoStatus}]}。每镜头只有一个主要动作和一个明确终点。`,
        "prompt.optimize": `${common} 输出 {prompt}，把抽象形容词改成可见动作、明确机位、物理光源和声音意图。`,
        "skill.seedance": `${common} 这是 Seedance 漫剧提示词编译。输出 {prompt,camera,motion,continuity,audio,negative,recommendedMode}。prompt 是可直接发送的自然语言，只包含当前镜头；内部分析标签不得出现在 prompt。每个参考只承担一个角色，已完成事件不重演，未来事件不提前。recommendedMode 只能是 t2v/i2v/flf2v/multiref。`,
    };
    return prompts[workflowKind] || `${common} 输出 {prompt}。`;
}

export function dramaUserPrompt(snapshot: ReturnType<typeof buildDramaInputSnapshot>) {
    return `当前节点资料：\n${JSON.stringify(snapshot, null, 2)}\n请严格按系统要求生成。`;
}

export function skillPromptText(result: SeedanceSkillResult) {
    return [
        result.prompt,
        result.camera && `镜头：${result.camera}`,
        result.motion && `动作：${result.motion}`,
        result.audio && `声音：${result.audio}`,
        result.continuity.length && `连续性：${result.continuity.join("；")}`,
        result.negative.length && `避免：${result.negative.join("；")}`,
    ]
        .filter(Boolean)
        .join("\n");
}

function compactNodeValue(node?: CanvasNodeData) {
    if (!node) return null;
    const drama = node.metadata?.drama;
    if (drama?.skillResult) return drama.skillResult;
    if (drama?.shots) return { shots: drama.shots };
    if (drama?.character) return drama.character;
    if (drama?.output != null) return drama.output;
    const text = node.metadata?.content || node.metadata?.prompt || drama?.brief || "";
    return text.length > 12_000 ? `${text.slice(0, 12_000)}…` : text;
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) || "null";
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function clean(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}
function stringList(value: unknown) {
    return Array.isArray(value)
        ? value.map(clean).filter(Boolean)
        : typeof value === "string"
          ? value
                .split(/[，,；;\n]/)
                .map((item) => item.trim())
                .filter(Boolean)
          : [];
}
function status(value: unknown): DramaStoryboardShot["firstFrameStatus"] {
    return ["pending", "running", "completed", "failed"].includes(String(value)) ? (value as DramaStoryboardShot["firstFrameStatus"]) : "pending";
}
