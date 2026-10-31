import type { LibraryReference, OutfitSlots, ReferenceRole } from "@/types/pose-costume";
import type { ChannelModel } from "@/stores/use-config-store";

export const POSE_COSTUME_NODE_TYPE = "reference:pose-costume";
export const POSE_COSTUME_COMMIT = "0cc039e096ac4ec2e2a24c2972e5e9c930235cb1";
export const POSE_COSTUME_SKILL_COMMIT = "5004fbdb42487cdfe95351b6a41ee11938b33a23";
export const REFERENCE_ROLES: ReferenceRole[] = ["character", "pose", "costume"];
export const REFERENCE_ROLE_LABELS: Record<ReferenceRole, string> = { character: "人物", pose: "姿势", costume: "服装" };

export function outfitJobStatusLabel(status?: string) {
    const labels: Record<string, string> = {
        pending: "等待执行",
        queued: "排队中",
        submitting: "提交中",
        retrying: "重试中",
        running: "生成中",
        downloading: "读取结果中",
        persisting: "保存中",
        billing_pending: "积分核验中",
        payment_required: "等待补充积分",
        cancel_requested: "已申请取消",
        cancelled: "已取消",
        failed: "失败",
        completed: "已完成",
    };
    return labels[status || ""] || "状态待核验";
}

export function orderedOutfitReferences(slots: OutfitSlots) {
    return REFERENCE_ROLES.flatMap((role) => (slots[role] ? [{ role, reference: slots[role]! }] : []));
}

export function buildOutfitPrompt(slots: OutfitSlots) {
    const instructions: Record<ReferenceRole, string> = {
        character: "用于身份、五官、发型、体貌与画风；服装和动作按后续参考调整。",
        pose: "用于动作、重心、支撑点、身体朝向与构图；不复制人偶关节、辅助线或模特身份。",
        costume: "用于服装版型、层次、颜色与材质；不复制服装模特身份、五官与站姿。",
    };
    return [
        "结合实际提交的参考图，创作一张完整人物图。",
        ...orderedOutfitReferences(slots).map(({ role, reference }, index) => `图 ${index + 1}（${REFERENCE_ROLE_LABELS[role]}：${reference.name}${reference.angle ? `，${reference.angle}` : ""}）：${instructions[role]}${role === "pose" && reference.source === "https://ai-pose-depth-gallery.pages.dev/" ? "此图为深度图，亮暗表示前后距离；仅参考动作、透视和遮挡，不复制灰度、人偶外观或背景。" : ""}`),
        "让服装随动作自然形变，保持透视、遮挡和接触关系合理。人物完整着装、背景简洁，不制作拼贴、对照图、说明文字或水印。",
    ].join("\n");
}

export function matchesLibraryQuery(item: LibraryReference, query: string) {
    const normalize = (value: string) =>
        value
            .normalize("NFKC")
            .toLocaleLowerCase()
            .replace(/\bgray\b/g, "grey");
    const text = normalize([item.id, item.code, ...Object.values(item.title), ...Object.values(item.keywords), ...Object.values(item.category), ...Object.values(item.series)].join(" "));
    const terms = item.keywords.zh
        .split(/\s+/)
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);
    const matches = (word: string) => {
        if (text.includes(word)) return true;
        if (!/^[\u3400-\u9fff]+$/.test(word)) return false;
        let rest = word;
        while (rest) {
            const term = terms.find((value) => rest.startsWith(value));
            if (!term) return false;
            rest = rest.slice(term.length);
        }
        return true;
    };
    return normalize(query).trim().split(/\s+/).filter(Boolean).every(matches);
}

/** Image data permissions are separate from the application's MIT license. */
export function libraryImagePolicy(item: Pick<LibraryReference, "kind">, personalTrial = false) {
    if (item.kind !== "character" && personalTrial) return { allowed: true, license: "individual-creative-reference-only", note: "ギア · 仅本地个人逐张创作参考，图片按需从原站读取；不授予图片转载、再分发、转售或整库下载权。" };
    return item.kind === "character"
        ? { allowed: true, license: "CC0-1.0", note: "あぎ · CC0 1.0；原作者同时请求避免图片再分发。仅按需读取所选图片。" }
        : { allowed: false, license: "permission-required", note: "ギア · 允许逐张创作参考，禁止批量下载、转载和再分发。守守画布的库内展示、热链及项目资产保存尚缺授权；可使用自有图片。" };
}

export function poseDepthReference(item: LibraryReference): LibraryReference {
    if (item.kind !== "pose") return item;
    const depthUrl = (value: string) => value.replace("https://ai-pose-gallery.pages.dev/", "https://ai-pose-depth-gallery.pages.dev/");
    return { ...item, source: "https://ai-pose-depth-gallery.pages.dev/", variants: item.variants.map((variant) => ({ ...variant, thumbnail: depthUrl(variant.thumbnail), original: depthUrl(variant.original) })) };
}

export function outfitModelError(model: ChannelModel | undefined, count: number) {
    if (!model || model.capability !== "image" || !model.modes?.includes("i2i")) return "该模型未确认支持多图参考，请选择支持 i2i 的平台模型。";
    const maximum = model.limits?.maxImages;
    if (maximum === undefined || maximum === null || maximum === "" || !Number.isFinite(Number(maximum))) return "模型未声明参考图数量上限，暂不能确认支持本次组合。";
    if (Number(maximum) < count) return `本次需 ${count} 张参考图，模型最多支持 ${maximum} 张；未提交任务。`;
    return null;
}
