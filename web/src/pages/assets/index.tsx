import { ArchiveRestore, Download, History, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Card, Drawer, Empty, Input, Popconfirm, Progress, Segmented, Select, Space, Spin, Tag, Typography } from "antd";

import { useAuth } from "@/components/auth/auth-context";
import { formatBytes } from "@/lib/image-utils";
import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import {
    currentVersion,
    getCloudStorageUsage,
    getCloudAssetDownloadUrl,
    listCloudAssets,
    permanentlyDeleteCloudAsset,
    restoreCloudAsset,
    setCloudAssetCurrentVersion,
    trashCloudAsset,
    uploadCloudAsset,
    type CloudAsset,
    type CloudAssetKind,
    type CloudStorageUsage,
} from "@/services/api/assets";
import { useAssetStore, type Asset as LocalAsset } from "@/stores/use-asset-store";

const kindLabels: Record<CloudAssetKind, string> = {
    character: "角色",
    scene: "场景",
    prop: "道具",
    image: "图片",
    video: "视频",
    audio: "音频",
    subtitle: "字幕",
    project_export: "项目文件",
};

export default function AssetsPage() {
    const { message } = App.useApp();
    const { workspace } = useAuth();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const versionInputRef = useRef<HTMLInputElement>(null);
    const versionParentIdsRef = useRef<string[]>([]);
    const localAssets = useAssetStore((state) => state.assets);
    const [assets, setAssets] = useState<CloudAsset[]>([]);
    const [storageUsage, setStorageUsage] = useState<CloudStorageUsage | null>(null);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [migrating, setMigrating] = useState(false);
    const [failedMigrationIds, setFailedMigrationIds] = useState<string[]>([]);
    const [selected, setSelected] = useState<CloudAsset | null>(null);
    const [keyword, setKeyword] = useState("");
    const [view, setView] = useState<"active" | "trash">("active");

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [items, usage] = await Promise.all([
                listCloudAssets(workspace.projectId, true),
                getCloudStorageUsage().catch(() => null),
            ]);
            setAssets(items);
            setStorageUsage(usage);
            setSelected((current) => (current ? items.find((item) => item.id === current.id) || null : null));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "素材加载失败");
        } finally {
            setLoading(false);
        }
    }, [message, workspace.projectId]);

    useEffect(() => {
        void load();
    }, [load]);

    const visibleAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets.filter((asset) => asset.status === (view === "active" ? "active" : "trashed") && (!query || `${asset.name} ${kindLabels[asset.kind]}`.toLowerCase().includes(query)));
    }, [assets, keyword, view]);

    const uploadFiles = async (files: FileList | File[], assetId?: string, parentVersionIds: string[] = []) => {
        const list = Array.from(files);
        if (!list.length) return;
        setUploading(true);
        try {
            for (const file of list) await uploadCloudAsset(workspace.projectId, file, { assetId, parentVersionIds });
            message.success(assetId ? "新版本已保存" : `已上传 ${list.length} 个素材`);
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "素材上传失败");
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
            if (versionInputRef.current) versionInputRef.current.value = "";
        }
    };

    const migrateLocalAssets = async (onlyIds?: string[]) => {
        const migrated = readMigratedIds(workspace.projectId);
        const candidates = localAssets.filter(
            (asset): asset is Extract<LocalAsset, { kind: "image" | "video" }> =>
                (asset.kind === "image" || asset.kind === "video") && !migrated.has(asset.id) && (!onlyIds || onlyIds.includes(asset.id)),
        );
        if (!candidates.length) {
            message.info("没有待迁移的本地媒体素材");
            return;
        }
        setMigrating(true);
        const failed: string[] = [];
        for (const asset of candidates) {
            try {
                const blob = await readLocalBlob(asset);
                if (!blob) throw new Error("本地文件不存在");
                const file = new File([blob], fileNameForLocalAsset(asset), { type: blob.type || asset.data.mimeType || "application/octet-stream" });
                await uploadCloudAsset(workspace.projectId, file, { source: "migration", provenance: { localAssetId: asset.id, localStorageKey: asset.data.storageKey || null } });
                migrated.add(asset.id);
                writeMigratedIds(workspace.projectId, migrated);
            } catch {
                failed.push(asset.id);
            }
        }
        setFailedMigrationIds(failed);
        setMigrating(false);
        await load();
        if (failed.length) message.warning(`${candidates.length - failed.length} 个迁移成功，${failed.length} 个可重试`);
        else message.success(`已迁移 ${candidates.length} 个本地素材，原本地文件仍保留`);
    };

    const moveToTrash = async (asset: CloudAsset) => {
        try {
            await trashCloudAsset(asset.id, "用户从资产库移入回收站");
            message.success("已移入回收站");
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "操作失败");
        }
    };

    const restore = async (asset: CloudAsset) => {
        try {
            await restoreCloudAsset(asset.id);
            message.success("素材已恢复");
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "恢复失败");
        }
    };

    const permanentlyDelete = async (asset: CloudAsset) => {
        try {
            const result = await permanentlyDeleteCloudAsset(asset.id);
            message.success(result.storageStatus === "completed" ? "素材已永久删除" : "素材记录已删除，文件正在后台清理");
            if (selected?.id === asset.id) setSelected(null);
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "永久删除失败");
        }
    };

    const chooseVersion = async (asset: CloudAsset, versionId: string) => {
        try {
            const updated = await setCloudAssetCurrentVersion(asset.id, versionId);
            setAssets((items) => items.map((item) => (item.id === updated.id ? updated : item)));
            setSelected(updated);
            message.success("主版本已切换，历史版本未被覆盖");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "版本切换失败");
        }
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-900 dark:text-stone-100">
            <header className="border-b border-stone-200 px-6 py-5 dark:border-stone-800">
                <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-semibold">项目资产</h1>
                        <p className="mt-1 text-sm text-stone-500">图片、视频与音频统一保存；每次上传都会创建一个新版本。</p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-4">
                        {storageUsage ? (
                            <div className="w-48" aria-label="云端存储用量">
                                <div className="mb-1 flex justify-between gap-2 text-xs text-stone-500 dark:text-stone-400">
                                    <span>云端存储</span>
                                    <span>{storageUsage.unlimited ? `${formatBytes(storageUsage.usedBytes)} / 不限` : `${formatBytes(storageUsage.usedBytes)} / ${formatBytes(storageUsage.quotaBytes || 0)}`}</span>
                                </div>
                                {!storageUsage.unlimited ? <Progress percent={Math.min(100, Math.round(((storageUsage.usedBytes + storageUsage.reservedBytes) / (storageUsage.quotaBytes || 1)) * 100))} showInfo={false} size="small" status={(storageUsage.remainingBytes || 0) <= 0 ? "exception" : "normal"} /> : null}
                            </div>
                        ) : null}
                        <Space wrap>
                        <Button icon={<RefreshCw className="size-4" />} onClick={() => void load()}>刷新</Button>
                        <Button loading={migrating} icon={<ArchiveRestore className="size-4" />} onClick={() => void migrateLocalAssets()}>迁移本地素材</Button>
                        {failedMigrationIds.length ? <Button loading={migrating} onClick={() => void migrateLocalAssets(failedMigrationIds)}>重试失败项（{failedMigrationIds.length}）</Button> : null}
                        <Button type="primary" loading={uploading} icon={<Upload className="size-4" />} onClick={() => fileInputRef.current?.click()}>上传素材</Button>
                        </Space>
                    </div>
                </div>
            </header>

            <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
                <div className="mx-auto max-w-7xl">
                    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                        <Input allowClear prefix={<Search className="size-4 text-stone-400" />} placeholder="搜索素材" value={keyword} onChange={(event) => setKeyword(event.target.value)} className="max-w-md" />
                        <Segmented value={view} onChange={(value) => setView(value as "active" | "trash")} options={[{ label: `全部素材（${assets.filter((item) => item.status === "active").length}）`, value: "active" }, { label: `回收站（${assets.filter((item) => item.status === "trashed").length}）`, value: "trash" }]} />
                    </div>

                    {loading ? <div className="flex justify-center py-24"><Spin size="large" /></div> : null}
                    {!loading && !visibleAssets.length ? <Empty className="py-24" description={view === "trash" ? "回收站为空" : "还没有云端素材，可上传或迁移本地素材"} /> : null}
                    {!loading && visibleAssets.length ? (
                        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {visibleAssets.map((asset) => <CloudAssetCard key={asset.id} asset={asset} onOpen={() => setSelected(asset)} onTrash={() => void moveToTrash(asset)} onRestore={() => void restore(asset)} onPurge={() => void permanentlyDelete(asset)} />)}
                        </div>
                    ) : null}
                </div>
            </main>

            <AssetVersionsDrawer
                asset={selected}
                uploading={uploading}
                onClose={() => setSelected(null)}
                onUploadVersion={(parentVersionId) => {
                    versionParentIdsRef.current = parentVersionId ? [parentVersionId] : [];
                    versionInputRef.current?.click();
                }}
                onChooseVersion={chooseVersion}
            />
            <input ref={fileInputRef} type="file" multiple accept="image/*,video/*,audio/*,.srt,.vtt,.zip" className="hidden" onChange={(event) => void (event.target.files && uploadFiles(event.target.files))} />
            <input
                ref={versionInputRef}
                type="file"
                accept="image/*,video/*,audio/*,.srt,.vtt,.zip"
                className="hidden"
                onChange={(event) => void (event.target.files && selected && uploadFiles(event.target.files, selected.id, versionParentIdsRef.current))}
            />
        </div>
    );
}

function CloudAssetCard({ asset, onOpen, onTrash, onRestore, onPurge }: { asset: CloudAsset; onOpen: () => void; onTrash: () => void; onRestore: () => void; onPurge: () => void }) {
    const version = currentVersion(asset);
    return (
        <Card hoverable className="overflow-hidden" styles={{ body: { padding: 0 } }} cover={<button type="button" className="block aspect-[4/3] w-full overflow-hidden bg-stone-100 dark:bg-stone-900" onClick={onOpen}><AssetPreview asset={asset} compact /></button>}>
            <button type="button" className="block w-full p-4 text-left" onClick={onOpen}>
                <div className="flex items-start justify-between gap-3"><Typography.Text strong ellipsis>{asset.name}</Typography.Text><Tag>{kindLabels[asset.kind]}</Tag></div>
                <div className="mt-2 text-xs text-stone-500">v{version?.version || 0} · {version ? formatBytes(version.bytes) : "待上传"}</div>
            </button>
            <div className="flex gap-2 px-4 pb-4">
                <Button size="small" icon={<History className="size-3.5" />} onClick={onOpen}>版本</Button>
                {asset.status === "active" ? <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={onTrash}>回收</Button> : <><Button size="small" icon={<ArchiveRestore className="size-3.5" />} onClick={onRestore}>恢复</Button><Popconfirm title="永久删除素材？" description="文件和所有历史版本将永久删除，无法恢复。" okText="永久删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={onPurge}><Button size="small" danger icon={<Trash2 className="size-3.5" />}>永久删除</Button></Popconfirm></>}
            </div>
        </Card>
    );
}

function AssetVersionsDrawer({ asset, uploading, onClose, onUploadVersion, onChooseVersion }: { asset: CloudAsset | null; uploading: boolean; onClose: () => void; onUploadVersion: (parentVersionId?: string) => void; onChooseVersion: (asset: CloudAsset, versionId: string) => void }) {
    const { message } = App.useApp();
    const version = asset ? currentVersion(asset) : undefined;
    const [compareVersionId, setCompareVersionId] = useState<string>();
    const [compareUrl, setCompareUrl] = useState<string>();

    useEffect(() => {
        setCompareVersionId(asset?.versions.find((item) => item.id !== asset.currentVersionId)?.id);
    }, [asset?.id, asset?.currentVersionId, asset?.versions.length]);

    useEffect(() => {
        let cancelled = false;
        setCompareUrl(undefined);
        if (compareVersionId) {
            void getCloudAssetDownloadUrl(compareVersionId)
                .then((url) => {
                    if (!cancelled) setCompareUrl(url);
                })
                .catch(() => {
                    if (!cancelled) message.warning("对比版本预览地址获取失败");
                });
        }
        return () => {
            cancelled = true;
        };
    }, [compareVersionId, message]);

    const compareVersion = asset?.versions.find((item) => item.id === compareVersionId);
    const downloadVersion = async (versionId: string) => {
        try {
            await openDownload(versionId);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "下载地址获取失败");
        }
    };
    return (
        <Drawer title="素材与版本" open={Boolean(asset)} size="large" onClose={onClose}>
            {asset ? <div className="space-y-6">
                <div className={compareVersion ? "grid gap-3 sm:grid-cols-2" : undefined}>
                    <div><div className="mb-2 text-xs text-stone-500">当前主版本</div><AssetPreview asset={asset} /></div>
                    {compareVersion ? <div><div className="mb-2 text-xs text-stone-500">对比版本 v{compareVersion.version}</div><AssetPreview asset={asset} versionId={compareVersion.id} urlOverride={compareUrl} /></div> : null}
                </div>
                <div><Typography.Title level={4} className="!mb-1">{asset.name}</Typography.Title><Typography.Text type="secondary">当前主版本 v{version?.version || 0}，历史版本保持不可变</Typography.Text></div>
                <Space wrap>
                    <Button type="primary" loading={uploading} icon={<Upload className="size-4" />} onClick={() => onUploadVersion(version?.id)}>从当前版本继续</Button>
                    {version ? <Button icon={<Download className="size-4" />} onClick={() => void downloadVersion(version.id)}>下载当前版本</Button> : null}
                    {asset.versions.length > 1 ? <Select allowClear placeholder="选择对比版本" value={compareVersionId} className="min-w-36" onChange={setCompareVersionId} options={asset.versions.filter((item) => item.id !== asset.currentVersionId).map((item) => ({ label: `对比 v${item.version}`, value: item.id }))} /> : null}
                </Space>
                <div className="rounded-xl border border-stone-200 dark:border-stone-800">
                    {asset.versions.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 p-4 last:border-0 dark:border-stone-800">
                        <div className="min-w-0"><div className="font-medium">v{item.version} {item.id === asset.currentVersionId ? <Tag color="green">当前</Tag> : null}</div><div className="mt-1 text-xs text-stone-500">{sourceLabel(item.source)} · {formatBytes(item.bytes)} · {new Date(item.createdAt).toLocaleString()}</div><div className="mt-1 max-w-md truncate text-xs text-stone-400">{provenanceLabel(item)}</div></div>
                        <Space wrap>{item.id !== asset.currentVersionId ? <Button size="small" onClick={() => setCompareVersionId(item.id)}>预览对比</Button> : null}<Button size="small" onClick={() => void downloadVersion(item.id)}>下载</Button><Button size="small" onClick={() => onUploadVersion(item.id)}>从此版本继续</Button>{item.id !== asset.currentVersionId ? <Button size="small" onClick={() => void onChooseVersion(asset, item.id)}>设为主版本</Button> : null}</Space>
                    </div>)}
                </div>
            </div> : null}
        </Drawer>
    );
}

function AssetPreview({ asset, compact = false, versionId, urlOverride }: { asset: CloudAsset; compact?: boolean; versionId?: string; urlOverride?: string }) {
    const version = versionId ? asset.versions.find((item) => item.id === versionId) : currentVersion(asset);
    const url = urlOverride || (compact ? version?.thumbnailUrl || version?.downloadUrl : version?.downloadUrl);
    if (!url) return <div className="flex h-full min-h-40 items-center justify-center text-sm text-stone-500">暂无预览</div>;
    if (asset.kind === "image" || asset.kind === "character" || asset.kind === "scene" || asset.kind === "prop") return <img src={url} alt={asset.name} className={`${compact ? "h-full" : "max-h-[420px]"} w-full object-contain`} />;
    if (asset.kind === "video") return <video src={url} controls={!compact} muted={compact} className={`${compact ? "h-full" : "max-h-[420px]"} w-full bg-black object-contain`} />;
    if (asset.kind === "audio") return <div className="flex min-h-40 items-center justify-center p-6"><audio src={url} controls /></div>;
    return <div className="flex min-h-40 items-center justify-center text-sm text-stone-500">{kindLabels[asset.kind]}</div>;
}

async function openDownload(versionId: string) {
    const url = await getCloudAssetDownloadUrl(versionId);
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.append(link);
    link.click();
    link.remove();
}

function sourceLabel(source: CloudAsset["versions"][number]["source"]) {
    return { upload: "上传", generation: "生成", edit: "编辑", compose: "合成", migration: "本地迁移" }[source];
}

function provenanceLabel(version: CloudAsset["versions"][number]) {
    const parts = [
        version.sourceJobId ? `任务 ${version.sourceJobId}` : "",
        version.parentVersionIds.length ? `继承 ${version.parentVersionIds.length} 个版本` : "",
        typeof version.provenance.modelId === "string" ? `模型 ${version.provenance.modelId}` : "",
        typeof version.provenance.skillId === "string" ? `Skill ${version.provenance.skillId}` : "",
    ].filter(Boolean);
    return parts.join(" · ") || "来源信息已随版本保存";
}

async function readLocalBlob(asset: Extract<LocalAsset, { kind: "image" | "video" }>) {
    if (!asset.data.storageKey) return null;
    return asset.kind === "image" ? getImageBlob(asset.data.storageKey) : getMediaBlob(asset.data.storageKey);
}

function fileNameForLocalAsset(asset: Extract<LocalAsset, { kind: "image" | "video" }>) {
    const extension = asset.data.mimeType?.split("/")[1]?.split("+")[0] || (asset.kind === "image" ? "png" : "mp4");
    return `${asset.title || "本地素材"}.${extension}`;
}

function migrationStorageKey(projectId: string) {
    return `infinite-canvas:asset-migrations:${projectId}`;
}

function readMigratedIds(projectId: string) {
    try {
        const value = JSON.parse(localStorage.getItem(migrationStorageKey(projectId)) || "[]");
        return new Set<string>(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
    } catch {
        return new Set<string>();
    }
}

function writeMigratedIds(projectId: string, ids: Set<string>) {
    localStorage.setItem(migrationStorageKey(projectId), JSON.stringify([...ids]));
}
