import { artifactUrl, createManagedJob, waitForManagedJob, type ManagedJobTrace, type ManagedReference } from "@/services/api/jobs";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import type { DramaNodeState, DramaWorkflowKind, SeedanceSkillResult } from "@/types/drama";
import {
    buildDramaInputSnapshot,
    dramaSystemPrompt,
    dramaUserPrompt,
    hashDramaInput,
    normalizeCharacter,
    normalizeSeedanceSkillResult,
    normalizeStoryboard,
    parseStructuredResponse,
    SEEDANCE_DRAMA_SKILL_ID,
    SEEDANCE_DRAMA_SKILL_VERSION,
    skillPromptText,
} from "@/lib/drama/seedance-skill";

const IMAGE_KINDS = new Set<DramaWorkflowKind>(["character.turnaround", "scene.candidate", "scene.panorama", "prop.image", "composition.3d", "frame.first", "frame.last"]);

export async function executeDramaNode(ctx: CanvasNodeContext) {
    const kind = ctx.node.workflowKind as DramaWorkflowKind;
    if (kind === "story.idea") return validateStoryNode(ctx);
    const snapshot = buildDramaInputSnapshot(ctx.node, ctx.getNodes(), ctx.getConnections());
    const inputHash = hashDramaInput(snapshot);
    if (ctx.node.metadata?.status === "success" && ctx.node.metadata.drama?.inputHash === inputHash && !ctx.node.metadata.drama?.stale) return;
    ctx.updateMetadata({ status: "loading", errorDetails: undefined, drama: mergeDrama(ctx.node, { inputSnapshot: snapshot, inputHash, stale: false }) });
    try {
        if (IMAGE_KINDS.has(kind)) await executeImageNode(ctx, kind, snapshot, inputHash);
        else if (kind === "video.seedance") await executeVideoNode(ctx, snapshot, inputHash);
        else await executeTextNode(ctx, kind, snapshot, inputHash);
        markDramaDescendantsStale(ctx, ctx.node.id);
    } catch (error) {
        const message = error instanceof Error ? error.message : "节点执行失败";
        ctx.updateMetadata({ status: "error", errorDetails: message, drama: mergeDrama(ctx.node, { inputSnapshot: snapshot, inputHash }) });
        throw error;
    }
}

export function markDramaDescendantsStale(ctx: CanvasNodeContext, nodeId: string) {
    const queue = [nodeId];
    const visited = new Set<string>([nodeId]);
    while (queue.length) {
        const current = queue.shift()!;
        ctx.getConnections()
            .filter((edge) => edge.fromNodeId === current)
            .forEach((edge) => {
                if (visited.has(edge.toNodeId)) return;
                visited.add(edge.toNodeId);
                queue.push(edge.toNodeId);
                const downstream = ctx.getNode(edge.toNodeId);
                if (downstream?.metadata?.status === "success") ctx.applyOps([{ type: "update_node", id: downstream.id, metadata: { drama: mergeDrama(downstream, { stale: true }) } }]);
            });
    }
}

export function dramaExecutionOrder(nodes: CanvasNodeData[], connections: CanvasConnection[], requestedIds?: Set<string>) {
    const candidates = nodes.filter(
        (node) =>
            node.workflowKind?.startsWith("story.") ||
            node.workflowKind?.startsWith("script.") ||
            node.workflowKind?.startsWith("character.") ||
            node.workflowKind?.startsWith("scene.") ||
            node.workflowKind?.startsWith("prop.") ||
            node.workflowKind?.startsWith("composition.") ||
            node.workflowKind?.startsWith("storyboard.") ||
            node.workflowKind?.startsWith("prompt.") ||
            node.workflowKind?.startsWith("frame.") ||
            node.workflowKind?.startsWith("skill.") ||
            node.workflowKind?.startsWith("video.seedance"),
    );
    const ids = new Set(candidates.map((node) => node.id));
    const allowed = requestedIds || ids;
    const indegree = new Map(candidates.map((node) => [node.id, 0]));
    const outgoing = new Map(candidates.map((node) => [node.id, [] as string[]]));
    connections.forEach((edge) => {
        if (!ids.has(edge.fromNodeId) || !ids.has(edge.toNodeId)) return;
        indegree.set(edge.toNodeId, (indegree.get(edge.toNodeId) || 0) + 1);
        outgoing.get(edge.fromNodeId)?.push(edge.toNodeId);
    });
    const queue = candidates.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
    const result: CanvasNodeData[] = [];
    for (let index = 0; index < queue.length; index += 1) {
        const id = queue[index]!;
        const node = candidates.find((item) => item.id === id);
        if (node && allowed.has(id)) result.push(node);
        (outgoing.get(id) || []).forEach((next) => {
            indegree.set(next, (indegree.get(next) || 0) - 1);
            if (indegree.get(next) === 0) queue.push(next);
        });
    }
    return result;
}

export function downstreamDramaNodeIds(startIds: Set<string>, connections: CanvasConnection[]) {
    const result = new Set(startIds);
    const queue = [...startIds];
    while (queue.length) {
        const current = queue.shift()!;
        connections
            .filter((edge) => edge.fromNodeId === current)
            .forEach((edge) => {
                if (result.has(edge.toNodeId)) return;
                result.add(edge.toNodeId);
                queue.push(edge.toNodeId);
            });
    }
    return result;
}

async function executeTextNode(ctx: CanvasNodeContext, kind: DramaWorkflowKind, snapshot: ReturnType<typeof buildDramaInputSnapshot>, inputHash: string) {
    const model = ctx.ai.defaultModel("text");
    const trace = traceFor(ctx, inputHash, snapshot, kind === "skill.seedance");
    const job = await waitForManagedJob(
        (
            await createManagedJob(
                { model, capability: "text", mode: "chat", prompt: `${dramaSystemPrompt(kind)}\n\n${dramaUserPrompt(snapshot)}`, trace },
                { projectId: ctx.projectId, nodeId: ctx.node.id, nodeRevision: Number(ctx.node.metadata?.drama?.outputHash ? 1 : 0), idempotencyKey: `${ctx.node.id}:${kind}:${inputHash}` },
            )
        ).id,
    );
    const text = String(job.artifacts?.find((artifact) => artifact.text)?.text || "").trim();
    if (!text) throw new Error("模型没有返回可用内容");
    const output = parseStructuredResponse(text);
    const patch: Partial<DramaNodeState> = { output, inputSnapshot: snapshot, inputHash, outputHash: hashDramaInput(output), stale: false, textModel: model, lastRunAt: new Date().toISOString(), userModified: false };
    if (kind === "character.profile") patch.character = normalizeCharacter(output);
    if (kind === "storyboard.plan") patch.shots = normalizeStoryboard(output);
    if (kind === "skill.seedance") {
        patch.skillResult = normalizeSeedanceSkillResult(output);
        patch.skillId = SEEDANCE_DRAMA_SKILL_ID;
        patch.skillVersion = SEEDANCE_DRAMA_SKILL_VERSION;
    }
    const content = kind === "skill.seedance" ? skillPromptText(patch.skillResult!) : displayText(output, text);
    ctx.updateMetadata({ content, prompt: content, status: "success", errorDetails: undefined, drama: mergeDrama(ctx.node, patch) });
}

async function executeImageNode(ctx: CanvasNodeContext, kind: DramaWorkflowKind, snapshot: ReturnType<typeof buildDramaInputSnapshot>, inputHash: string) {
    const model = ctx.ai.defaultModel("image");
    const references = inputReferences(ctx, "image");
    const prompt = imagePrompt(kind, snapshot);
    const trace = { ...traceFor(ctx, inputHash, snapshot, false), assetKind: assetKindFor(kind), assetName: ctx.node.title } satisfies ManagedJobTrace;
    const job = await waitForManagedJob(
        (
            await createManagedJob(
                { model, capability: "image", mode: references.length ? "i2i" : "t2i", prompt, parameters: { count: 1, size: ctx.node.metadata?.size || "1536x1024", quality: ctx.node.metadata?.quality || "high" }, references, trace },
                { projectId: ctx.projectId, nodeId: ctx.node.id, idempotencyKey: `${ctx.node.id}:${kind}:${inputHash}` },
            )
        ).id,
    );
    const artifact = job.artifacts?.find((item) => item.assetVersionId);
    if (!artifact) throw new Error("图片任务没有返回素材版本");
    const url = await artifactUrl(artifact);
    ctx.updateMetadata({
        content: url,
        assetId: artifact.assetId,
        assetVersionId: artifact.assetVersionId,
        mimeType: artifact.mimeType || "image/png",
        prompt,
        model,
        status: "success",
        errorDetails: undefined,
        drama: mergeDrama(ctx.node, { inputSnapshot: snapshot, inputHash, outputHash: hashDramaInput(artifact.assetVersionId), stale: false, assetBindings: bindings(ctx), lastRunAt: new Date().toISOString(), userModified: false }),
    });
    if (kind === "character.turnaround") {
        ctx.getUpstream()
            .filter((node) => node.workflowKind === "character.profile" && node.metadata?.drama?.character)
            .forEach((node) => {
                const character = { ...node.metadata!.drama!.character!, turnaroundVersionId: artifact.assetVersionId };
                ctx.applyOps([{ type: "update_node", id: node.id, metadata: { drama: mergeDrama(node, { character, output: character }) } }]);
            });
    }
}

async function executeVideoNode(ctx: CanvasNodeContext, snapshot: ReturnType<typeof buildDramaInputSnapshot>, inputHash: string) {
    const model = ctx.ai.defaultModel("video");
    const references = inputReferences(ctx, "video");
    const roles = new Set(references.map((item) => item.role));
    const mode = roles.has("first_frame") && roles.has("last_frame") ? "flf2v" : references.length > 1 || roles.has("video_input") || roles.has("motion_reference") ? "multiref" : roles.has("first_frame") ? "i2v" : "t2v";
    const skill = upstreamSkill(ctx);
    const prompt = skill
        ? skillPromptText(skill)
        : snapshot.inputs
              .map((item) => (typeof item.value === "string" ? item.value : ""))
              .filter(Boolean)
              .join("\n");
    if (!prompt.trim()) throw new Error("请先连接 Seedance Skill 或提示词节点");
    const trace = { ...traceFor(ctx, inputHash, snapshot, true), assetKind: "video", assetName: ctx.node.title } satisfies ManagedJobTrace;
    const job = await waitForManagedJob(
        (
            await createManagedJob(
                {
                    model,
                    capability: "video",
                    mode,
                    prompt,
                    parameters: {
                        duration: Number(ctx.node.metadata?.seconds || 5),
                        resolution: ctx.node.metadata?.vquality || "720p",
                        aspectRatio: ratio(ctx.node.metadata?.size),
                        generateAudio: ctx.node.metadata?.generateAudio !== "false",
                        watermark: ctx.node.metadata?.watermark === "true",
                    },
                    references,
                    trace,
                },
                { projectId: ctx.projectId, nodeId: ctx.node.id, idempotencyKey: `${ctx.node.id}:video:${inputHash}` },
            )
        ).id,
    );
    const artifact = job.artifacts?.find((item) => item.assetVersionId);
    if (!artifact) throw new Error("视频任务没有返回素材版本");
    const url = await artifactUrl(artifact);
    ctx.updateMetadata({
        content: url,
        assetId: artifact.assetId,
        assetVersionId: artifact.assetVersionId,
        mimeType: artifact.mimeType || "video/mp4",
        prompt,
        model,
        videoMode: mode,
        status: "success",
        errorDetails: undefined,
        drama: mergeDrama(ctx.node, {
            inputSnapshot: snapshot,
            inputHash,
            outputHash: hashDramaInput(artifact.assetVersionId),
            stale: false,
            assetBindings: bindings(ctx),
            skillId: skill ? SEEDANCE_DRAMA_SKILL_ID : undefined,
            skillVersion: skill ? SEEDANCE_DRAMA_SKILL_VERSION : undefined,
            lastRunAt: new Date().toISOString(),
            userModified: false,
        }),
    });
}

function validateStoryNode(ctx: CanvasNodeContext) {
    const brief = ctx.node.metadata?.drama?.brief?.trim() || ctx.node.metadata?.content?.trim() || "";
    if (!brief) throw new Error("请先填写故事创意");
    const outputHash = hashDramaInput(brief);
    if (ctx.node.metadata?.status === "success" && ctx.node.metadata.drama?.inputHash === outputHash && !ctx.node.metadata.drama?.stale) return;
    ctx.updateMetadata({ content: brief, status: "success", errorDetails: undefined, drama: mergeDrama(ctx.node, { brief, output: brief, inputHash: outputHash, outputHash, stale: false, accepted: true, lastRunAt: new Date().toISOString() }) });
    markDramaDescendantsStale(ctx, ctx.node.id);
}

function traceFor(ctx: CanvasNodeContext, inputHash: string, snapshot: Record<string, unknown>, skill: boolean): ManagedJobTrace {
    return { workflowKind: ctx.node.workflowKind, ...(skill ? { skillId: SEEDANCE_DRAMA_SKILL_ID, skillVersion: SEEDANCE_DRAMA_SKILL_VERSION } : {}), inputHash, inputSnapshot: snapshot, userModified: Boolean(ctx.node.metadata?.drama?.userModified) };
}

function inputReferences(ctx: CanvasNodeContext, target: "image" | "video"): ManagedReference[] {
    return ctx
        .getConnections()
        .filter((edge) => edge.toNodeId === ctx.node.id)
        .sort((left, right) => (left.order || 0) - (right.order || 0))
        .flatMap((edge): ManagedReference[] => {
            const source = ctx.getNode(edge.fromNodeId);
            if (!source?.metadata?.assetVersionId && !source?.metadata?.content) return [];
            const role = managedRole(edge.role || "data", target);
            if (!role) return [];
            return [{ role, assetVersionId: source.metadata.assetVersionId, ...(!source.metadata.assetVersionId ? { url: source.metadata.content } : {}), mimeType: source.metadata.mimeType }];
        });
}

function managedRole(role: string, target: "image" | "video"): ManagedReference["role"] | null {
    if (target === "image") {
        if (["identity", "first_frame", "composition", "data"].includes(role)) return "identity_reference";
        if (role === "environment") return "environment_reference";
        return null;
    }
    const map: Record<string, ManagedReference["role"]> = {
        identity: "identity_reference",
        environment: "environment_reference",
        composition: "composition_reference",
        motion: "motion_reference",
        first_frame: "first_frame",
        last_frame: "last_frame",
        video_input: "video_input",
        audio_input: "audio_reference",
    };
    return map[role] || null;
}

function bindings(ctx: CanvasNodeContext) {
    return ctx
        .getConnections()
        .filter((edge) => edge.toNodeId === ctx.node.id)
        .flatMap((edge) => {
            const source = ctx.getNode(edge.fromNodeId);
            if (!source || !["identity", "environment", "composition", "motion", "first_frame", "last_frame", "video_input", "audio_input"].includes(edge.role || "")) return [];
            return [{ role: edge.role as NonNullable<DramaNodeState["assetBindings"]>[number]["role"], nodeId: source.id, assetId: source.metadata?.assetId, assetVersionId: source.metadata?.assetVersionId }];
        });
}

function upstreamSkill(ctx: CanvasNodeContext): SeedanceSkillResult | undefined {
    return ctx
        .getConnections()
        .filter((edge) => edge.toNodeId === ctx.node.id)
        .map((edge) => ctx.getNode(edge.fromNodeId)?.metadata?.drama?.skillResult)
        .find(Boolean);
}

function imagePrompt(kind: DramaWorkflowKind, snapshot: ReturnType<typeof buildDramaInputSnapshot>) {
    const intent: Record<string, string> = {
        "character.turnaround": "生成同一原创角色的正面、侧面、背面三视图，身份、脸型、发型、服装和比例完全一致，纯净中性背景，不添加文字。",
        "scene.candidate": "生成可用于漫剧分镜的场景候选图，空间关系明确，无人物，无文字。",
        "scene.panorama": "生成同一场景的宽幅全景环境母版，入口、出口、前中后景和主要光源明确，无人物，无文字。",
        "prop.image": "生成故事关键道具的标准资产图，结构、材质和磨损状态清晰，中性背景，无文字。",
        "composition.3d": "生成预演式3D构图参考，明确机位、人物站位、比例、视线和景深层次，不改变角色身份。",
        "frame.first": "生成当前镜头首帧，锁定角色身份、服装、场景空间、机位和动作起点，无字幕水印。",
        "frame.last": "生成当前镜头尾帧，保持首帧身份与空间连续性，准确到达动作终点，无字幕水印。",
    };
    return `${intent[kind] || "生成漫剧视觉资产。"}\n输入资料：${JSON.stringify(snapshot)}`;
}

function assetKindFor(kind: DramaWorkflowKind): ManagedJobTrace["assetKind"] {
    if (kind === "character.turnaround") return "character";
    if (kind === "scene.candidate" || kind === "scene.panorama") return "scene";
    if (kind === "prop.image") return "prop";
    return "image";
}

function displayText(output: Record<string, unknown>, fallback: string) {
    for (const key of ["script", "prompt", "logline", "text"]) if (typeof output[key] === "string" && output[key]) return String(output[key]);
    return fallback;
}
function mergeDrama(node: CanvasNodeData, patch: Partial<DramaNodeState>): DramaNodeState {
    return { schemaVersion: 1, ...node.metadata?.drama, ...patch };
}
function ratio(size?: string) {
    if (!size) return "16:9";
    const match = size.match(/(\d+)\s*[x×]\s*(\d+)/i);
    if (!match) return size.includes(":") ? size : "16:9";
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height) return "16:9";
    return width >= height ? "16:9" : "9:16";
}
