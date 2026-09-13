import { currentVersion, uploadCloudAsset } from "./assets";
import { platformRequest } from "./platform";

export type VirtualPortrait = {
    id: string;
    projectId: string;
    name: string;
    status: "processing" | "active" | "failed";
    errorMessage: string | null;
    sourceAssetId: string;
    sourceAssetVersionId: string;
    providerAssetId: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    previewUrl: string;
    createdAt: string;
    updatedAt: string;
};

export async function listVirtualPortraits(projectId: string, refresh = false, signal?: AbortSignal) {
    const suffix = refresh ? "?refresh=true" : "";
    return (await platformRequest<{ portraits: VirtualPortrait[] }>(`/api/projects/${encodeURIComponent(projectId)}/virtual-portraits${suffix}`, { signal })).portraits;
}

export async function createVirtualPortrait(projectId: string, file: File, signal?: AbortSignal) {
    const asset = await uploadCloudAsset(projectId, file, {
        kind: "character",
        name: file.name || "Virtual Portrait",
        source: "upload",
        provenance: { purpose: "virtual-portrait" },
        signal,
    });
    const version = currentVersion(asset);
    if (!version) throw new Error("角色源图保存失败，请重新上传");
    return (
        await platformRequest<{ portrait: VirtualPortrait }>(`/api/projects/${encodeURIComponent(projectId)}/virtual-portraits`, {
            method: "POST",
            body: JSON.stringify({ assetVersionId: version.id, name: file.name || "Virtual Portrait" }),
            signal,
        })
    ).portrait;
}

export async function archiveVirtualPortrait(id: string) {
    return platformRequest<{ archivedId: string }>(`/api/virtual-portraits/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" });
}
