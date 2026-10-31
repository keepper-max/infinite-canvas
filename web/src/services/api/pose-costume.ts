import { POSE_COSTUME_COMMIT, orderedOutfitReferences } from "@/lib/canvas/pose-costume";
import { PERSONAL_REFERENCE_TRIAL } from "@/constant/env";
import { libraryImagePolicy, outfitModelError } from "@/lib/canvas/pose-costume";
import type { LibraryReference, LibraryVariant, OutfitReference, OutfitRun } from "@/types/pose-costume";
import type { ChannelModel } from "@/stores/use-config-store";
import { currentVersion, digestSha256, getCloudAssetDownloadUrl, listCloudAssets, uploadCloudAsset, type CloudAsset, type CloudAssetVersion } from "./assets";
import { createManagedJob, type ManagedReference } from "./jobs";

// Read the upstream public index at a reviewed revision; do not redistribute its data in our bundle.
export const REFERENCE_CATALOG_URL = `https://raw.githubusercontent.com/hongye007/open-pose-costume/${POSE_COSTUME_COMMIT}/public/data/catalog.json`;
const CATALOG_SHA256 = "de5480fb921115055e6eb69896dfa103f43149dfaaed05961042ca2d9076a5a1";
export async function loadReferenceCatalog(signal?: AbortSignal): Promise<LibraryReference[]> {
    const response = await fetch(REFERENCE_CATALOG_URL, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!response.ok) throw new Error(`参考目录读取失败（${response.status}），请重试`);
    const bytes = await response.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (value) => value.toString(16).padStart(2, "0")).join("");
    if (hash !== CATALOG_SHA256) throw new Error("参考目录与已核验版本不一致，已停止加载");
    const data = JSON.parse(new TextDecoder().decode(bytes)) as { items?: LibraryReference[] };
    if (!Array.isArray(data.items)) throw new Error("参考目录格式不正确");
    const origins = { pose: "https://ai-pose-gallery.pages.dev", costume: "https://ai-costume-gallery.pages.dev", character: "https://ai-portrait-gallery.pages.dev" };
    for (const item of data.items) {
        if (!origins[item.kind] || !item.id || !item.title?.zh || !item.title?.en || !item.variants?.length) throw new Error("参考目录条目不完整");
        for (const variant of item.variants) {
            for (const value of [variant.thumbnail, variant.original]) {
                const url = new URL(value);
                if (url.origin !== origins[item.kind] || !/\.(png|jpg|webp)$/.test(url.pathname)) throw new Error("参考目录包含未核验的图片来源");
            }
        }
    }
    return data.items;
}

export function outfitReferenceFromAsset(asset: CloudAsset, version: CloudAssetVersion): OutfitReference {
    const provenance = version.provenance || {};
    const text = (key: string) => (typeof provenance[key] === "string" ? (provenance[key] as string) : undefined);
    return {
        assetId: asset.id,
        assetVersionId: version.id,
        name: asset.name,
        mimeType: version.mimeType,
        width: version.width || undefined,
        height: version.height || undefined,
        catalogId: text("referenceCatalogId"),
        variantId: text("referenceVariantId"),
        code: text("code"),
        angle: text("angle"),
        source: text("source"),
        license: text("license"),
    };
}

const imports = new Map<string, Promise<OutfitReference>>();
export async function importLibraryReference(projectId: string, item: LibraryReference, variant: LibraryVariant): Promise<OutfitReference> {
    const policy = libraryImagePolicy(item, PERSONAL_REFERENCE_TRIAL);
    if (!policy.allowed) throw new Error(policy.note);
    const key = `${projectId}:${item.id}:${variant.id}:${variant.original}`;
    const previous = imports.get(key);
    if (previous) return previous;
    const flight = (async () => {
        const assets = await listCloudAssets(projectId);
        const existing = assets
            .flatMap((asset) => asset.versions.map((version) => ({ asset, version })))
            .find(({ version }) => version.provenance.referenceCatalogId === item.id && version.provenance.referenceVariantId === variant.id && version.provenance.referenceCommit === POSE_COSTUME_COMMIT && version.provenance.originalUrl === variant.original);
        let reference: OutfitReference;
        if (existing) reference = outfitReferenceFromAsset(existing.asset, existing.version);
        else {
            const response = await fetch(variant.original, { credentials: "omit", referrerPolicy: "no-referrer" });
            if (!response.ok) throw new Error(`参考原图读取失败（${response.status}），未创建生成任务`);
            const blob = await response.blob();
            if (!blob.type.startsWith("image/")) throw new Error("原站未返回图片");
            const asset = await uploadCloudAsset(projectId, blob, {
                name: `${item.title.zh} · ${item.code} · ${variant.label.zh}`,
                provenance: {
                    purpose: "pose-costume-reference",
                    referenceCatalogId: item.id,
                    referenceVariantId: variant.id,
                    referenceCommit: POSE_COSTUME_COMMIT,
                    code: item.code,
                    angle: variant.angle,
                    source: item.source,
                    originalUrl: variant.original,
                    license: policy.license,
                    rightsNote: policy.note,
                },
            });
            const version = currentVersion(asset);
            if (!version) throw new Error("云端参考图片缺少版本");
            reference = outfitReferenceFromAsset(asset, version);
        }
        return { ...reference, catalogId: item.id, code: item.code, variantId: variant.id, angle: variant.angle, source: item.source, license: policy.license };
    })();
    imports.set(key, flight);
    try {
        return await flight;
    } finally {
        imports.delete(key);
    }
}

export async function uploadOutfitReference(projectId: string, file: File) {
    if (!file.type.startsWith("image/")) throw new Error("请选择图片文件");
    const hash = await digestSha256(file);
    const assets = await listCloudAssets(projectId);
    const existing = assets.flatMap((asset) => asset.versions.map((version) => ({ asset, version }))).find(({ version }) => version.sha256 === hash);
    if (existing) return outfitReferenceFromAsset(existing.asset, existing.version);
    // The existing asset service validates media, size, quota and project write permission.
    const asset = await uploadCloudAsset(projectId, file, { name: file.name, provenance: { purpose: "pose-costume-reference", source: "user-upload" } });
    const version = currentVersion(asset);
    if (!version) throw new Error("云端参考图片缺少版本");
    return outfitReferenceFromAsset(asset, version);
}

export async function outfitReferenceUrl(reference: OutfitReference) {
    return getCloudAssetDownloadUrl(reference.assetVersionId);
}

export function outfitJobInput(run: OutfitRun, model: ChannelModel | undefined) {
    const ordered = orderedOutfitReferences(run.slots);
    if (!run.slots.pose || !run.slots.costume) throw new Error("请补齐姿势和服装参考");
    if (!run.prompt.trim()) throw new Error("请填写组合描述");
    const error = outfitModelError(model, ordered.length);
    if (error) throw new Error(error);
    const roles: Record<string, ManagedReference["role"]> = { character: "identity_reference", pose: "composition_reference", costume: "identity_reference" };
    return {
        model: run.model,
        capability: "image" as const,
        mode: "i2i" as const,
        prompt: run.prompt,
        parameters: run.parameters,
        references: ordered.map(({ role, reference }) => ({ role: roles[role], assetVersionId: reference.assetVersionId, mimeType: reference.mimeType })),
        trace: {
            workflowKind: "reference.pose-costume",
            skillId: "open-pose-costume-skill",
            skillVersion: "5004fbdb42487cdfe95351b6a41ee11938b33a23",
            inputSnapshot: { slots: run.slots, referenceOrder: ordered.map(({ role }) => role), prompt: run.prompt, model: run.model, catalogCommit: POSE_COSTUME_COMMIT },
            assetKind: "image" as const,
            assetName: "角色搭配生成",
        },
    };
}

export async function submitOutfitJob(projectId: string, nodeId: string, run: OutfitRun, model: ChannelModel | undefined) {
    return createManagedJob(outfitJobInput(run, model), { projectId, nodeId, idempotencyKey: run.operationId });
}
