import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Empty, Image, Input, Modal, Select, Slider, Spin, Tabs } from "antd";
import { useQuery } from "@tanstack/react-query";
import { BookImage, X } from "lucide-react";
import { nanoid } from "nanoid";

import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { buildOutfitPrompt, orderedOutfitReferences, outfitJobStatusLabel, outfitModelError, POSE_COSTUME_NODE_TYPE, REFERENCE_ROLES, REFERENCE_ROLE_LABELS } from "@/lib/canvas/pose-costume";
import { ReferenceBrowser } from "./pose-costume-library";
import { useGenerationRiskConfirmation } from "@/hooks/use-generation-risk-confirmation";
import { useEffectiveConfig, modelDefinitionOf, resolveModelRequestConfig, isServerManagedConfig, selectableModelsByCapability, decodeChannelModel } from "@/stores/use-config-store";
import { managedImageParameters } from "@/services/api/image";
import { currentVersion, getCloudAssetDownloadUrls, listCloudAssets, type CloudAsset } from "@/services/api/assets";
import { artifactUrl, cancelManagedJob, getManagedJob, retryManagedJob, waitForManagedJob, type ManagedJob } from "@/services/api/jobs";
import { getProject } from "@/services/api/platform";
import { importLibraryReference, outfitReferenceFromAsset, outfitReferenceUrl, submitOutfitJob, uploadOutfitReference } from "@/services/api/pose-costume";
import { imageToDataUrl, resolveImageUrl } from "@/services/image-storage";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import type { LibraryReference, LibraryVariant, OutfitReference, OutfitRun, OutfitSlots, PoseCostumeState, ReferenceRole } from "@/types/pose-costume";

const actionClass = "rounded px-2 py-1 text-xs transition hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10";
const ended = (status?: string) => ["completed", "failed", "cancelled"].includes(status || "");

function ReferenceThumbnail({ reference }: { reference?: OutfitReference }) {
    const url = useQuery({ queryKey: ["pose-costume-image", reference?.assetVersionId], queryFn: () => outfitReferenceUrl(reference!), enabled: Boolean(reference) });
    return reference ? <Image src={url.data} alt={reference.name} height={112} style={{ objectFit: "contain", width: "100%" }} /> : <div className="flex h-28 items-center justify-center text-xs opacity-50">尚未选择</div>;
}

function PoseCostumeContent({ ctx }: { ctx: CanvasNodeContext }) {
    const state = ctx.node.metadata?.poseCostume;
    return (
        <button type="button" className="flex h-full w-full flex-col justify-between p-5 text-left" style={{ color: ctx.theme.node.text }} onClick={ctx.openPanel}>
            <div className="flex items-center gap-2 text-sm font-semibold">
                <BookImage className="size-5" />
                姿势与服装参考库
            </div>
            <div className="grid grid-cols-3 gap-2">
                {REFERENCE_ROLES.map((role) => (
                    <div key={role} className="min-w-0">
                        <div className="mb-2 text-xs opacity-60">{REFERENCE_ROLE_LABELS[role]}</div>
                        <div className="truncate text-xs">{state?.slots?.[role]?.name || "待选择"}</div>
                    </div>
                ))}
            </div>
            <span className="text-xs opacity-60">浏览参考 · 保存搭配 · 在画布生成</span>
        </button>
    );
}

function PoseCostumePanel({ ctx, onClose }: { ctx: CanvasNodeContext; onClose: () => void }) {
    const confirmRisk = useGenerationRiskConfirmation();
    const config = useEffectiveConfig();
    const latest = useRef(ctx);
    latest.current = ctx;
    const state = ctx.node.metadata?.poseCostume || {};
    const slots = state.slots || {};
    const [busy, setBusy] = useState(false);
    const actionInFlight = useRef(false);
    const [job, setJob] = useState<ManagedJob>();
    const [watch, setWatch] = useState(0);
    const [error, setError] = useState("");
    const [assetRole, setAssetRole] = useState<ReferenceRole>();
    const [canvasRole, setCanvasRole] = useState<ReferenceRole>();
    const [savingCombination, setSavingCombination] = useState(false);
    const [combinationName, setCombinationName] = useState("");
    const [compareRole, setCompareRole] = useState<ReferenceRole>("pose");
    const [overlay, setOverlay] = useState(false);
    const [slider, setSlider] = useState(50);
    const project = useQuery({ queryKey: ["pose-costume-project", ctx.projectId], queryFn: ({ signal }) => getProject(ctx.projectId, signal) });
    const editable = ["owner", "admin", "editor"].includes(project.data?.role || "");
    const assets = useQuery({ queryKey: ["pose-costume-assets", ctx.projectId], queryFn: ({ signal }) => listCloudAssets(ctx.projectId, false, signal), enabled: Boolean(assetRole) });
    const selectedModel = state.model || config.imageModel;
    const definition = modelDefinitionOf(config, selectedModel);
    const models = selectableModelsByCapability(config, "image").filter((value) => isServerManagedConfig(resolveModelRequestConfig(config, value)));
    const modelError = outfitModelError(definition, orderedOutfitReferences(slots).length);
    const running = Boolean(state.run && !ended(state.run.status));
    const disabled = !editable || busy || running;

    // Always merge against the current node, including when an upload or task finishes later.
    const update = (patch: Partial<PoseCostumeState>) => {
        const active = latest.current;
        const node = active.getNode(active.node.id);
        if (node) active.updateMetadata({ poseCostume: { ...node.metadata?.poseCostume, ...patch } });
    };
    const setSlot = (role: ReferenceRole, reference?: OutfitReference) => {
        const current = latest.current.getNode(ctx.node.id)?.metadata?.poseCostume || {};
        const next = { ...current.slots, [role]: reference };
        update({ slots: next, prompt: buildOutfitPrompt(next) });
    };
    const perform = async (action: () => Promise<void>) => {
        if (actionInFlight.current || !editable) return;
        actionInFlight.current = true;
        setBusy(true);
        setError("");
        try {
            await action();
        } catch (e) {
            setError(e instanceof Error ? e.message : "操作失败，请重试");
        } finally {
            actionInFlight.current = false;
            setBusy(false);
        }
    };

    const addImage = async (reference: OutfitReference) => {
        const url = await outfitReferenceUrl(reference);
        latest.current.applyOps([
            {
                type: "add_node",
                nodeType: "image",
                title: reference.name,
                position: { x: ctx.node.position.x + ctx.node.width + 60, y: ctx.node.position.y },
                width: 300,
                height: (300 * (reference.height || 300)) / (reference.width || 300),
                metadata: { content: url, status: "success", assetId: reference.assetId, assetVersionId: reference.assetVersionId, mimeType: reference.mimeType, naturalWidth: reference.width, naturalHeight: reference.height, libraryReference: reference },
            },
        ]);
    };
    const chooseLibrary = (item: LibraryReference, variant: LibraryVariant, insert: boolean) =>
        perform(async () => {
            const reference = await importLibraryReference(ctx.projectId, item, variant);
            if (insert) await addImage(reference);
            else setSlot(item.kind, reference);
        });
    const chooseAsset = (asset: CloudAsset) => {
        const version = currentVersion(asset);
        if (!version || !assetRole) return;
        setSlot(assetRole, outfitReferenceFromAsset(asset, version));
        setAssetRole(undefined);
    };
    const chooseCanvas = (id: string) =>
        perform(async () => {
            const node = ctx.getNode(id);
            const metadata = node?.metadata;
            if (!node || !metadata?.content || !canvasRole) throw new Error("画布图片已不存在");
            let reference: OutfitReference;
            if (metadata.assetId && metadata.assetVersionId)
                reference = { ...metadata.libraryReference, assetId: metadata.assetId, assetVersionId: metadata.assetVersionId, name: node.title, mimeType: metadata.mimeType || "image/png", width: metadata.naturalWidth, height: metadata.naturalHeight };
            else {
                const dataUrl = await imageToDataUrl({ dataUrl: metadata.content, storageKey: metadata.storageKey });
                const response = await fetch(dataUrl);
                const blob = await response.blob();
                reference = await uploadOutfitReference(ctx.projectId, new File([blob], node.title, { type: blob.type }));
                // Reuse this migration on subsequent selections, rather than upload again.
                latest.current.applyOps([{ type: "update_node", id, metadata: { assetId: reference.assetId, assetVersionId: reference.assetVersionId } }]);
            }
            setSlot(canvasRole, reference);
            setCanvasRole(undefined);
        });

    const submit = (recover = false) =>
        perform(async () => {
            if (!recover && (modelError || !isServerManagedConfig(resolveModelRequestConfig(config, selectedModel)))) throw new Error(modelError || "请选择平台内置模型");
            if (!recover && (!slots.pose || !slots.costume)) throw new Error("请先选择姿势与服装参考");
            if (!recover && !(await confirmRisk())) return;
            const generationConfig = buildGenerationConfig(config, undefined, "image");
            const run: OutfitRun =
                recover && state.run
                    ? state.run
                    : {
                          operationId: `pose-costume:${nanoid()}`,
                          slots: structuredClone(slots),
                          prompt: state.prompt ?? buildOutfitPrompt(slots),
                          model: selectedModel,
                          parameters: managedImageParameters({ ...generationConfig, model: selectedModel }, definition, 1),
                          status: "submitting",
                      };
            update({ run });
            if (!ctx.prepareGeneration || !(await ctx.prepareGeneration())) throw new Error("画布未保存，未提交任务");
            // The persisted operation ID recovers a lost submission response without charging a new job.
            const created = await submitOutfitJob(ctx.projectId, ctx.node.id, run, modelDefinitionOf(config, run.model));
            update({ run: { ...run, jobId: created.id, status: created.status } });
            await ctx.prepareGeneration();
        });

    const runId = state.run?.jobId;
    useEffect(() => {
        if (!runId || !editable) return;
        const controller = new AbortController();
        const active = latest.current;
        const run = active.getNode(active.node.id)?.metadata?.poseCostume?.run;
        if (!run || run.jobId !== runId) return;
        const restore = async () => {
            try {
                const result = await waitForManagedJob(
                    runId,
                    controller.signal,
                    (snapshot) => {
                        if (snapshot.projectId !== active.projectId || snapshot.nodeId !== active.node.id) throw new Error("任务不属于当前项目或节点，已停止恢复");
                        setJob(snapshot);
                    },
                    { pauseOnBillingPending: true },
                );
                if (controller.signal.aborted) return;
                if (result.status !== "completed") {
                    update({ run: { ...run, status: result.status } });
                    return;
                }
                if (!result.artifacts?.length) throw new Error("任务未交付可用图片");
                const ids: string[] = [];
                for (const [index, artifact] of result.artifacts.entries()) {
                    const id = `pose-result-${result.id}-${index}`;
                    ids.push(id);
                    if (active.getNode(id)) continue;
                    const url = await artifactUrl(artifact, controller.signal);
                    const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
                        const image = new window.Image();
                        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
                        image.onerror = () => reject(new Error("结果图片暂不可读，请恢复任务重试"));
                        image.src = url;
                    });
                    if (controller.signal.aborted || !active.getNode(active.node.id)) return;
                    active.applyOps([
                        {
                            type: "add_node",
                            id,
                            nodeType: "image",
                            title: "角色搭配结果",
                            position: { x: active.node.position.x + active.node.width + 60 + index * 340, y: active.node.position.y },
                            width: 320,
                            height: (320 * dimensions.height) / dimensions.width,
                            metadata: {
                                content: url,
                                status: "success",
                                assetId: artifact.assetId,
                                assetVersionId: artifact.assetVersionId,
                                generationJobId: result.id,
                                mimeType: artifact.mimeType,
                                naturalWidth: dimensions.width,
                                naturalHeight: dimensions.height,
                                prompt: run.prompt,
                                model: run.model,
                                references: orderedOutfitReferences(run.slots).map(({ reference }) => `asset-version:${reference.assetVersionId}`),
                                poseCostume: { slots: run.slots, prompt: run.prompt, model: run.model, run: { ...run, status: "completed" } },
                            },
                        },
                    ]);
                }
                update({ resultNodeIds: ids, run: { ...run, status: "completed" } });
                await active.prepareGeneration?.();
            } catch (e) {
                if (controller.signal.aborted) return;
                setError(e instanceof Error ? e.message : "恢复任务失败");
                const snapshot = await getManagedJob(runId).catch(() => undefined);
                if (controller.signal.aborted) return;
                if (snapshot?.projectId === active.projectId && snapshot.nodeId === active.node.id) {
                    setJob(snapshot);
                    update({ run: { ...run, status: snapshot.status } });
                }
            }
        };
        void restore();
        // Closing a panel only stops waiting; explicit cancellation uses the server cancel endpoint.
        return () => controller.abort();
    }, [runId, editable, watch]);

    const resultNode = ctx.getNode(state.resultNodeIds?.[0] || "");
    const comparisonSlots = resultNode?.metadata?.poseCostume?.slots || slots;
    const comparison = useQuery({
        queryKey: ["pose-costume-comparison", comparisonSlots[compareRole]?.assetVersionId, resultNode?.metadata?.assetVersionId],
        queryFn: async () => getCloudAssetDownloadUrls([comparisonSlots[compareRole]?.assetVersionId, resultNode?.metadata?.assetVersionId].filter((id): id is string => Boolean(id))),
    });
    const referenceUrl = comparison.data?.[comparisonSlots[compareRole]?.assetVersionId || ""]?.url;
    const resultUrl = comparison.data?.[resultNode?.metadata?.assetVersionId || ""]?.url;

    return (
        <Modal open title="姿势与服装参考库" onCancel={onClose} footer={null} width={1180} destroyOnHidden styles={{ body: { color: ctx.theme.node.text, maxHeight: "calc(100dvh - 200px)", overflowY: "auto" } }}>
            {project.isError ? <p role="alert">无法核验项目权限，请重新打开参考库。</p> : !editable && !project.isPending ? <p>当前项目仅可查看。</p> : null}
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_370px]" data-canvas-no-zoom onPointerDown={(event) => event.stopPropagation()}>
                <ReferenceBrowser
                    favorites={state.favorites || []}
                    onFavorite={(id) => update({ favorites: (state.favorites || []).includes(id) ? state.favorites?.filter((value) => value !== id) : [...(state.favorites || []), id] })}
                    onChoose={chooseLibrary}
                    disabled={disabled}
                />
                <div className="space-y-4 lg:border-l lg:pl-5" style={{ borderColor: ctx.theme.node.stroke }}>
                    <div className="flex items-baseline justify-between">
                        <h3 className="text-base font-semibold">角色搭配</h3>
                        <span className="text-xs opacity-60">按人物 → 姿势 → 服装提交</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        {REFERENCE_ROLES.map((role) => (
                            <div key={role} className="min-w-0">
                                <div className="flex items-center justify-between text-xs font-medium">
                                    {REFERENCE_ROLE_LABELS[role]}
                                    {slots[role] && (
                                        <button className={actionClass} disabled={disabled} onClick={() => setSlot(role)} aria-label={`移除${REFERENCE_ROLE_LABELS[role]}`}>
                                            <X className="size-3" />
                                        </button>
                                    )}
                                </div>
                                <ReferenceThumbnail reference={slots[role]} />
                                <p className="truncate text-[11px] opacity-60" title={slots[role]?.name}>
                                    {slots[role]?.name || (role === "character" ? "可选身份图" : "必选参考图")}
                                </p>
                                <div className="mt-1 flex flex-wrap text-xs">
                                    <button disabled={disabled} className={actionClass} onClick={() => setCanvasRole(role)}>
                                        画布
                                    </button>
                                    <button disabled={disabled} className={actionClass} onClick={() => setAssetRole(role)}>
                                        资产
                                    </button>
                                    <label className={`${actionClass} cursor-pointer`}>
                                        上传
                                        <input
                                            disabled={disabled}
                                            className="hidden"
                                            type="file"
                                            accept="image/*"
                                            aria-label={`上传${REFERENCE_ROLE_LABELS[role]}参考`}
                                            onChange={(event) => {
                                                const file = event.target.files?.[0];
                                                event.target.value = "";
                                                if (file) void perform(async () => setSlot(role, await uploadOutfitReference(ctx.projectId, file)));
                                            }}
                                        />
                                    </label>
                                    {slots[role] && (
                                        <button className={actionClass} disabled={disabled} onClick={() => void perform(() => addImage(slots[role]!))}>
                                            添加节点
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                    <Input.TextArea aria-label="组合描述" disabled={disabled} value={state.prompt ?? buildOutfitPrompt(slots)} onChange={(event) => update({ prompt: event.target.value })} rows={8} />
                    <button disabled={disabled} className={actionClass} onClick={() => update({ prompt: buildOutfitPrompt(slots) })}>
                        按当前图片顺序重建描述
                    </button>
                    <Select
                        className="w-full"
                        aria-label="平台生图模型"
                        disabled={disabled}
                        value={selectedModel}
                        onChange={(model) => update({ model })}
                        options={models.map((value) => ({ value, label: modelDefinitionOf(config, value)?.displayName || decodeChannelModel(value)?.model || value }))}
                    />
                    <p className="text-xs opacity-60">采用画布当前尺寸与质量，每次生成一张。积分由平台后台预留和结算，实际费用取决于模型用量；提示词不能保证绝对身份一致或精确姿势。</p>
                    {modelError && (
                        <p className="text-xs" role="status">
                            {modelError}
                        </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                        <Button type="text" disabled={disabled || Boolean(modelError) || !slots.pose || !slots.costume} onClick={() => void submit()}>
                            参考生成
                        </Button>
                        <Button type="text" disabled={disabled} onClick={() => setSavingCombination(true)}>
                            保存搭配
                        </Button>
                        {busy && <Spin size="small" />}
                    </div>
                    {state.combinations?.length ? (
                        <div className="space-y-1">
                            <p className="text-xs opacity-60">已保存搭配</p>
                            {state.combinations.map((combination) => (
                                <div key={combination.id} className="flex justify-between">
                                    <button className={`${actionClass} truncate text-left`} disabled={disabled} onClick={() => update({ slots: combination.slots, prompt: combination.prompt, model: combination.model })}>
                                        {combination.name}
                                    </button>
                                    <button className={actionClass} disabled={disabled} aria-label={`删除搭配 ${combination.name}`} onClick={() => update({ combinations: state.combinations?.filter((value) => value.id !== combination.id) })}>
                                        删除
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : null}
                    {state.run && (
                        <div className="space-y-2 text-xs" role="status">
                            <p>
                                任务：{outfitJobStatusLabel(job?.status || state.run.status)}
                                {job ? ` · ${job.progress}%` : ""}
                            </p>
                            {job?.creditsDue && <p>待结算／交付积分：{job.creditsDue}</p>}
                            {!state.run.jobId && (
                                <button disabled={busy || !editable} className={actionClass} onClick={() => void submit(true)}>
                                    恢复提交（复用原操作编号）
                                </button>
                            )}
                            {state.run.jobId && (
                                <button
                                    disabled={busy || !editable}
                                    className={actionClass}
                                    onClick={() => {
                                        setError("");
                                        setWatch((value) => value + 1);
                                    }}
                                >
                                    刷新任务与恢复结果
                                </button>
                            )}
                            {running && state.run.jobId && (
                                <button
                                    disabled={busy || !editable}
                                    className={actionClass}
                                    onClick={() =>
                                        void perform(async () => {
                                            const result = await cancelManagedJob(state.run!.jobId!);
                                            setJob(result);
                                            update({ run: { ...state.run!, status: result.status } });
                                            setWatch((value) => value + 1);
                                        })
                                    }
                                >
                                    申请取消任务
                                </button>
                            )}
                            {state.run.status === "failed" && job?.error?.retryable && state.run.jobId && (
                                <button
                                    disabled={busy || !editable}
                                    className={actionClass}
                                    onClick={() =>
                                        void perform(async () => {
                                            if (!(await confirmRisk())) return;
                                            if (!ctx.prepareGeneration || !(await ctx.prepareGeneration())) throw new Error("请先保存画布");
                                            const retried = await retryManagedJob(state.run!.jobId!);
                                            update({ run: { ...state.run!, jobId: retried.id, status: retried.status } });
                                            await ctx.prepareGeneration();
                                        })
                                    }
                                >
                                    重试原任务（可能产生积分）
                                </button>
                            )}
                            <p className="opacity-60">关闭面板只停止等待。申请取消后，后台可能已执行并产生积分。</p>
                        </div>
                    )}
                    {error && (
                        <p role="alert" className="text-xs text-red-500">
                            {error}
                        </p>
                    )}
                    {resultUrl && (
                        <div className="space-y-3">
                            <div className="flex justify-between">
                                <span className="text-sm font-semibold">参考与结果</span>
                                <Checkbox checked={overlay} onChange={(event) => setOverlay(event.target.checked)}>
                                    叠加对照
                                </Checkbox>
                            </div>
                            <Select aria-label="对照参考" value={compareRole} onChange={setCompareRole} options={REFERENCE_ROLES.filter((role) => comparisonSlots[role]).map((role) => ({ value: role, label: REFERENCE_ROLE_LABELS[role] }))} />
                            {overlay ? (
                                <>
                                    <div className="relative h-80 overflow-hidden">
                                        <img src={referenceUrl} alt="参考原图" className="absolute size-full object-contain" />
                                        <img src={resultUrl} alt="生成结果" className="absolute size-full object-contain" style={{ clipPath: `inset(0 ${100 - slider}% 0 0)` }} />
                                    </div>
                                    <Slider aria-label="参考与结果叠加对照" value={slider} onChange={setSlider} />
                                </>
                            ) : (
                                <Image.PreviewGroup>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <p className="mb-2 text-xs">参考</p>
                                            <Image src={referenceUrl} alt="参考原图" />
                                        </div>
                                        <div>
                                            <p className="mb-2 text-xs">结果</p>
                                            <Image src={resultUrl} alt="生成结果" />
                                        </div>
                                    </div>
                                </Image.PreviewGroup>
                            )}
                        </div>
                    )}
                </div>
            </div>
            <Modal
                open={savingCombination}
                title="保存搭配"
                okText="保存"
                cancelText="取消"
                okButtonProps={{ disabled: disabled || !combinationName.trim() }}
                onCancel={() => setSavingCombination(false)}
                onOk={() => {
                    if (disabled || !combinationName.trim()) return;
                    update({ combinations: [...(state.combinations || []), { id: nanoid(), name: combinationName.trim(), slots: structuredClone(slots), prompt: state.prompt ?? buildOutfitPrompt(slots), model: selectedModel }] });
                    setSavingCombination(false);
                    setCombinationName("");
                }}
            >
                <Input aria-label="组合名称" value={combinationName} onChange={(event) => setCombinationName(event.target.value)} />
            </Modal>
            <Modal open={Boolean(assetRole)} title="从当前项目资产选择" footer={null} onCancel={() => setAssetRole(undefined)}>
                <div className="grid grid-cols-2 gap-2">
                    {assets.isPending ? (
                        <Spin />
                    ) : assets.isError ? (
                        <Button onClick={() => void assets.refetch()}>读取失败，重试</Button>
                    ) : (
                        assets.data
                            ?.filter((asset) => currentVersion(asset)?.mimeType.startsWith("image/"))
                            .map((asset) => (
                                <button disabled={disabled} className={`${actionClass} text-left`} key={asset.id} onClick={() => chooseAsset(asset)}>
                                    <ReferenceThumbnail reference={outfitReferenceFromAsset(asset, currentVersion(asset)!)} />
                                    <span>{asset.name}</span>
                                </button>
                            ))
                    )}
                </div>
            </Modal>
            <Modal open={Boolean(canvasRole)} title="从当前画布选择图片" footer={null} onCancel={() => setCanvasRole(undefined)}>
                <div className="grid grid-cols-2 gap-2">
                    {ctx
                        .getNodes()
                        .filter((node) => node.type === "image" && node.metadata?.content)
                        .map((node) => (
                            <button disabled={disabled} className={actionClass} key={node.id} onClick={() => void chooseCanvas(node.id)}>
                                <CanvasImage src={node.metadata!.content!} storageKey={node.metadata?.storageKey} title={node.title} />
                                <span>{node.title}</span>
                            </button>
                        ))}
                </div>
            </Modal>
        </Modal>
    );
}

function CanvasImage({ src, storageKey, title }: { src: string; storageKey?: string; title: string }) {
    const url = useQuery({ queryKey: ["pose-costume-canvas-image", src, storageKey], queryFn: () => resolveImageUrl(storageKey, src) });
    return <img src={url.data} alt={title} className="h-28 w-full object-contain" loading="lazy" />;
}

let registered = false;
export function registerPoseCostumeNode() {
    if (registered) return;
    registered = true;
    registerNodeDefinitions(
        [
            {
                type: POSE_COSTUME_NODE_TYPE,
                title: "姿势与服装参考库",
                description: "查找参考、收藏搭配与多图角色生成",
                icon: <BookImage className="size-5" />,
                defaultSize: { width: 420, height: 230 },
                defaultMetadata: { poseCostume: {} },
                workflowKind: "reference.pose-costume",
                autoOpenPanel: true,
                Content: PoseCostumeContent,
                Panel: PoseCostumePanel,
            },
        ],
        "builtin",
    );
}
