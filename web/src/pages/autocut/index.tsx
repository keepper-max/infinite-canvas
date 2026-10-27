import { formatCreditPoints } from "@/lib/credit-display";
import { createFeedback } from "@/services/api/operations";
import { App, Alert, Button, Checkbox, Empty, Input, InputNumber, Progress, Select, Slider, Tag, theme } from "antd";
import { ArrowDown, ArrowUp, Download, Film, LoaderCircle, Plus, RotateCcw, Save, Scissors, Sparkles, Trash2, Upload, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { reflowTimeline } from "./timeline";
import { listProjects, type ProjectSummary } from "@/services/api/platform";
import { getCloudAssetDownloadUrl, listCloudAssets, uploadCloudAsset, type CloudAsset } from "@/services/api/assets";
import {
    archiveAutoCutProject,
    autoCutStatus,
    cancelAutoCutTask,
    createAutoCutProject,
    getAutoCutProject,
    listAutoCutProjects,
    restoreAutoCutRevision,
    retryAutoCutTask,
    saveAutoCutTimeline,
    startAutoCutTask,
    type AutoCutDetail,
    type AutoCutProject,
    type AutoCutRequest,
    type AutoCutTimeline,
} from "@/services/api/autocut";

const modes = [
    { value: "auto", label: "智能粗剪 · 直接帮我剪" },
    { value: "highlights", label: "精彩片段" },
    { value: "speech", label: "口播 / 访谈" },
    { value: "travel", label: "Vlog / 旅行" },
    { value: "product", label: "商品 / 商业宣传" },
    { value: "custom", label: "自定义要求" },
];
const stageNames: Record<string, string> = { queued: "排队中", preprocessing: "读取素材", analysis: "理解画面与语音", billing: "等待模型费用结算", planning: "编排剪辑方案", rendering: "渲染初稿", uploading: "保存成片", completed: "成片已就绪" };
const seconds = (ms: number) => Number((ms / 1000).toFixed(3));

export default function AutoCutPage() {
    const { message, modal } = App.useApp(),
        { token } = theme.useToken();
    const [params, setParams] = useSearchParams();
    const [workspaces, setWorkspaces] = useState<ProjectSummary[]>([]),
        [workspace, setWorkspace] = useState("");
    const [projects, setProjects] = useState<AutoCutProject[]>([]),
        [projectId, setProjectId] = useState(params.get("edit") || "");
    const [assets, setAssets] = useState<CloudAsset[]>([]),
        [selected, setSelected] = useState<string[]>([]);
    const [detail, setDetail] = useState<AutoCutDetail | null>(null),
        [timeline, setTimeline] = useState<AutoCutTimeline | null>(null);
    const [p1, setP1] = useState(false);
    const [enabled, setEnabled] = useState(false),
        [busy, setBusy] = useState(false),
        [dirty, setDirty] = useState(false),
        [error, setError] = useState("");
    const [prompt, setPrompt] = useState(""),
        [mode, setMode] = useState<AutoCutRequest["mode"]>("auto"),
        [duration, setDuration] = useState(60);
    const [aspect, setAspect] = useState<AutoCutTimeline["aspect_ratio"]>("9:16"),
        [budget, setBudget] = useState<number | null>(null),
        [preview, setPreview] = useState("");
    const [uploading, setUploading] = useState(false);
    const [subtitleOnly, setSubtitleOnly] = useState(false);
    const undo = useRef<AutoCutTimeline[]>([]),
        fileInput = useRef<HTMLInputElement>(null),
        player = useRef<HTMLVideoElement>(null);
    const active = detail?.tasks.find((t) => ["queued", "running"].includes(t.status));
    const output = detail?.tasks.find((t) => t.status === "completed" && t.output_asset_version_id && !["export", "prepare", "effects"].includes(t.input?.kind || "") && !t.input?.p1?.previewClipId);
    const report = (e: unknown) => {
        const text = e instanceof Error ? e.message : "操作失败";
        setError(text);
        void message.error(text);
    };
    const load = useCallback(async (id: string, signal?: AbortSignal) => {
        const data = await getAutoCutProject(id, signal);
        if (signal?.aborted) return;
        if ((data.timeline as { schema_version?: number })?.schema_version === 2) {
            window.location.assign(`/autocut/editor?workspace=${data.project.project_id}&edit=${id}`);
            return;
        }
        setDetail(data);
        setTimeline(data.timeline);
        setDirty(false);
        undo.current = [];
        if (data.timeline) setAspect(data.timeline.aspect_ratio);
    }, []);
    useEffect(() => {
        void Promise.all([listProjects(), autoCutStatus()])
            .then(([p, s]) => {
                setWorkspaces(p);
                setWorkspace(params.get("workspace") || p.find((p) => p.isDefault)?.projectId || p[0]?.projectId || "");
                setEnabled(s.enabled && s.accepting);
                setP1(s.p1Enabled);
            })
            .catch(report);
    }, []);
    useEffect(() => {
        if (!workspace) return;
        let live = true;
        void Promise.all([listAutoCutProjects(workspace), listCloudAssets(workspace)])
            .then(([p, a]) => {
                if (live) {
                    setProjects(p);
                    setAssets(a.filter((a) => ["video", "image", "audio"].includes(a.kind)));
                    setSelected([]);
                }
            })
            .catch(report);
        return () => {
            live = false;
        };
    }, [workspace]);
    useEffect(() => {
        if (!projectId) {
            setDetail(null);
            setTimeline(null);
            setPreview("");
            return;
        }
        const controller = new AbortController();
        setError("");
        void load(projectId, controller.signal).catch((e) => {
            if (!controller.signal.aborted) report(e);
        });
        return () => controller.abort();
    }, [projectId, load]);
    useEffect(() => {
        if (!active || !projectId) return;
        const controller = new AbortController();
        const timer = setInterval(() => {
            void load(projectId, controller.signal).catch((e) => {
                if (!controller.signal.aborted) report(e);
            });
        }, 2000);
        return () => {
            clearInterval(timer);
            controller.abort();
        };
    }, [active?.id, projectId, load]);
    useEffect(() => {
        let live = true;
        setPreview("");
        if (output?.output_asset_version_id)
            void getCloudAssetDownloadUrl(output.output_asset_version_id)
                .then((url) => {
                    if (live) setPreview(url);
                })
                .catch(report);
        return () => {
            live = false;
        };
    }, [output?.output_asset_version_id]);
    function open(id: string) {
        setProjectId(id);
        setParams(id ? { edit: id, workspace } : { workspace });
    }
    function edit(next: AutoCutTimeline) {
        if (timeline) undo.current.push(structuredClone(timeline));
        setTimeline(timeline ? reflowTimeline(next, timeline) : next);
        setDirty(true);
    }
    async function persist() {
        if (!detail || !timeline) return;
        const t = await saveAutoCutTimeline(detail.project.id, detail.project.current_revision_id, timeline);
        setTimeline(t);
        setDetail({ ...detail, project: { ...detail.project, current_revision_id: t.revision_id }, timeline: t });
        setDirty(false);
        return t;
    }
    async function saveOnly() {
        setBusy(true);
        try {
            await persist();
            void message.success("时间线已保存");
        } catch (e) {
            report(e);
        } finally {
            setBusy(false);
        }
    }
    async function run(kind: "edit" | "render") {
        setBusy(true);
        setError("");
        try {
            let id = projectId,
                revision = detail?.project.current_revision_id || null;
            if (!id) {
                const p = await createAutoCutProject(workspace, `剪辑 · ${new Date().toLocaleString("zh-CN")}`, selected);
                id = p.id;
                open(id);
                setProjects((past) => [p, ...past]);
            }
            if (dirty) revision = (await persist())?.revision_id || revision;
            await startAutoCutTask(id, {
                operationId: crypto.randomUUID(),
                expectedRevision: revision,
                kind,
                prompt,
                mode,
                targetDurationMs: Math.round(duration * 1000),
                aspectRatio: aspect,
                budgetCents: kind === "edit" ? budget || 0 : 0,
                confirmed: true,
                scope: subtitleOnly ? "subtitles" : "all",
            });
            await load(id);
        } catch (e) {
            report(e);
        } finally {
            setBusy(false);
        }
    }
    function sendQualityFeedback() {
        let rating = "基本满意",
            comment = "";
        modal.confirm({
            title: "智能剪辑效果反馈",
            okText: "提交反馈",
            content: (
                <div className="space-y-3">
                    <Select
                        defaultValue={rating}
                        options={["非常满意", "基本满意", "需要调整", "无法使用"].map((value) => ({ value, label: value }))}
                        onChange={(value) => {
                            rating = value;
                        }}
                        style={{ width: "100%" }}
                    />
                    <Input.TextArea
                        placeholder="补充问题描述；请勿填写隐私或原始素材"
                        onChange={(e) => {
                            comment = e.target.value;
                        }}
                        maxLength={1500}
                    />
                </div>
            ),
            onOk: async () => {
                await createFeedback({ category: "problem", pagePath: "/autocut", content: `AutoCut 效果：${rating}\nTask ID: ${detail?.tasks[0]?.id || "未创建任务"}\n工程: ${projectId || "未创建"}\n${comment}` });
                void message.success("反馈已提交");
            },
        });
    }
    function confirmEdit() {
        modal.confirm({
            title: "开始 AI 智能剪辑",
            content: `关键帧和转写将提交现有模型分析，请确认你有素材使用权并允许此处理。本次积分预算上限 ${formatCreditPoints(budget ?? 0)}。素材分析会复用缓存，失败后不会自动重复付费调用。`,
            okText: "确认并开始",
            onOk: () => run("edit"),
        });
    }
    async function upload(files: FileList | null) {
        if (!files || !workspace) return;
        setUploading(true);
        try {
            for (const file of Array.from(files)) {
                if (file.size > 500 * 1024 * 1024) throw new Error(`${file.name} 超过 500 MB`);
                const asset = await uploadCloudAsset(workspace, file, { streamHash: true });
                setAssets((p) => [asset, ...p]);
                if (asset.currentVersionId) setSelected((p) => [...p, asset.currentVersionId!].slice(0, 20));
            }
        } catch (e) {
            report(e);
        } finally {
            setUploading(false);
            if (fileInput.current) fileInput.current.value = "";
        }
    }
    const visual = timeline?.tracks.find((t) => t.kind === "video");
    const disabled = busy || Boolean(active);
    return (
        <main className="mx-auto w-full max-w-[1600px] px-4 py-7 md:px-8" style={{ color: token.colorText }}>
            <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
                <div>
                    <div className="mb-2 flex items-center gap-2 text-xs tracking-[0.18em]" style={{ color: token.colorTextSecondary }}>
                        <Scissors size={14} /> SHOUSHOU / AUTOCUT
                    </div>
                    <h1 className="text-2xl font-semibold">AI 智能剪辑 · 测试版</h1>
                    {p1 && projectId && (
                        <a href={`/autocut/editor?workspace=${workspace}&edit=${projectId}`} className="mr-3 text-sm underline">
                            进入可视化精修
                        </a>
                    )}
                    <Button type="link" onClick={sendQualityFeedback}>
                        效果评价 / 问题反馈
                    </Button>
                    <p className="mt-2 text-sm" style={{ color: token.colorTextSecondary }}>
                        把创作意图交给 AI，把剪辑决定留在可编辑的时间线上。
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Select
                        aria-label="工作空间"
                        disabled={busy || uploading}
                        value={workspace || undefined}
                        options={workspaces.map((p) => ({ value: p.projectId, label: p.projectTitle }))}
                        onChange={(v) => {
                            setWorkspace(v);
                            setProjectId("");
                            setParams({ workspace: v });
                        }}
                        style={{ minWidth: 150 }}
                    />
                    <Select aria-label="剪辑工程" disabled={busy || uploading} placeholder="重新打开工程" value={projectId || undefined} options={projects.map((p) => ({ value: p.id, label: p.name }))} onChange={open} style={{ minWidth: 180 }} />
                    <Button
                        icon={<Plus size={15} />}
                        disabled={busy || uploading}
                        onClick={() => {
                            open("");
                            setDirty(false);
                        }}
                    >
                        新建
                    </Button>
                    {projectId && (
                        <Button
                            disabled={disabled}
                            onClick={() =>
                                modal.confirm({
                                    title: "归档剪辑工程？",
                                    content: "已保存版本和文件会保留。归档将释放素材引用保护，此后可在素材库中管理文件。",
                                    onOk: async () => {
                                        try {
                                            await archiveAutoCutProject(projectId);
                                            setProjects((p) => p.filter((x) => x.id !== projectId));
                                            open("");
                                        } catch (e) {
                                            report(e);
                                        }
                                    },
                                })
                            }
                        >
                            归档
                        </Button>
                    )}
                </div>
            </header>
            {!enabled && <Alert className="mb-4" type="info" showIcon title="智能剪辑处理服务尚未启用。已保存工程仍可打开；启用后即可分析和渲染。" />}
            {error && <Alert className="mb-4" type="error" showIcon closable title={error} onClose={() => setError("")} />}
            <div className="grid items-start gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
                <aside className="space-y-5">
                    <section className="rounded-xl border p-4" style={{ borderColor: token.colorBorderSecondary, background: token.colorBgContainer }}>
                        <div className="mb-3 flex items-center justify-between">
                            <h2 className="font-medium">01 / 素材</h2>
                            <span className="text-xs" style={{ color: token.colorTextSecondary }}>
                                {detail ? detail.assets.length : selected.length} / 20
                            </span>
                        </div>
                        <input ref={fileInput} hidden type="file" multiple accept=".mp4,.mov,.jpg,.jpeg,.png,.webp,.mp3,.wav,.m4a" onChange={(e) => void upload(e.target.files)} />
                        {!projectId && (
                            <Button block icon={uploading ? <LoaderCircle size={15} className="animate-spin" /> : <Upload size={15} />} disabled={uploading} onClick={() => fileInput.current?.click()}>
                                上传素材
                            </Button>
                        )}
                        <p className="my-3 text-xs leading-5" style={{ color: token.colorTextSecondary }}>
                            视频、图片、音频；每项最多 500 MB、30 分钟。可直接复用当前空间素材。
                        </p>
                        <div className="max-h-[380px] space-y-2 overflow-auto">
                            {projectId
                                ? detail?.assets.map((a) => (
                                      <div key={a.id} className="border-b py-2" style={{ borderColor: token.colorBorderSecondary }}>
                                          <div className="truncate text-sm">{a.name}</div>
                                          <div className="mt-1 text-xs" style={{ color: token.colorTextSecondary }}>
                                              {detail.analyses[a.id] ? `${seconds(detail.analyses[a.id].durationMs)} 秒 · 已分析` : "等待分析"}
                                          </div>
                                      </div>
                                  ))
                                : assets.map((a) => (
                                      <Checkbox
                                          key={a.id}
                                          className="!flex py-1"
                                          disabled={!a.currentVersionId || (!selected.includes(a.currentVersionId) && selected.length >= 20)}
                                          checked={selected.includes(a.currentVersionId || "")}
                                          onChange={(e) => setSelected((p) => (e.target.checked ? [...p, a.currentVersionId!] : p.filter((x) => x !== a.currentVersionId)))}
                                      >
                                          <span className="break-all text-sm">{a.name}</span>
                                      </Checkbox>
                                  ))}
                            {!assets.length && !detail && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="从一段素材开始" />}
                        </div>
                    </section>
                    <section className="space-y-3 rounded-xl border p-4" style={{ borderColor: token.colorBorderSecondary, background: token.colorBgContainer }}>
                        <h2 className="font-medium">02 / 创作意图</h2>
                        <Select aria-label="剪辑模式" className="w-full" value={mode} options={modes} onChange={setMode} disabled={disabled} />
                        <Input.TextArea
                            aria-label="剪辑要求"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            rows={4}
                            placeholder={timeline ? "把开头缩短、删掉第三个镜头，或只修改字幕…" : "例如：突出海边风景，剪成节奏轻快的旅行短片。也可以留空直接帮我剪。"}
                            disabled={disabled}
                        />
                        {timeline && (
                            <Checkbox checked={subtitleOnly} disabled={disabled} onChange={(e) => setSubtitleOnly(e.target.checked)}>
                                只修改字幕，保持镜头与声音
                            </Checkbox>
                        )}
                        <div className="flex items-center justify-between gap-2">
                            <label className="text-xs">目标秒数</label>
                            <InputNumber aria-label="目标秒数" min={1} max={1800} value={duration} onChange={(v) => setDuration(v || 60)} disabled={disabled} />
                            <Select aria-label="成片比例" value={aspect} onChange={setAspect} options={["9:16", "16:9", "1:1"].map((value) => ({ value, label: value }))} disabled={disabled} />
                        </div>
                        <label className="flex items-center justify-between gap-3 text-xs">
                            本次积分预算
                            <InputNumber aria-label="积分预算" max={1000} min={1} precision={0} suffix="积分" value={budget} onChange={setBudget} placeholder="请填写" disabled={disabled} />
                        </label>
                        <Button type="primary" block icon={<Sparkles size={16} />} loading={busy} disabled={!enabled || Boolean(active) || !budget || (!projectId && !selected.length)} onClick={confirmEdit}>
                            {timeline ? "按要求修改并生成初稿" : "直接帮我剪"}
                        </Button>
                    </section>
                </aside>
                <div className="min-w-0 space-y-5">
                    <section className="overflow-hidden rounded-xl border" style={{ borderColor: token.colorBorderSecondary, background: token.colorBgContainer }}>
                        <div className="relative grid min-h-[300px] place-items-center p-4 md:min-h-[420px]" style={{ background: token.colorFillQuaternary }}>
                            {preview ? (
                                <video
                                    ref={player}
                                    controls
                                    playsInline
                                    src={preview}
                                    className="max-h-[520px] w-full"
                                    onError={() => {
                                        if (output?.output_asset_version_id) void getCloudAssetDownloadUrl(output.output_asset_version_id).then(setPreview).catch(report);
                                    }}
                                />
                            ) : (
                                <div className="text-center" style={{ color: token.colorTextSecondary }}>
                                    <Film size={36} className="mx-auto mb-4 opacity-40" />
                                    <p>{active ? "正在理解素材并制作初稿" : "第一版成片将在这里出现"}</p>
                                    <p className="mt-2 text-xs">原始素材保留，每次修改都会保存独立版本</p>
                                </div>
                            )}
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3" style={{ borderColor: token.colorBorderSecondary }}>
                            <span className="text-xs" style={{ color: token.colorTextSecondary }}>
                                {output ? (output.output_revision_id === detail?.project.current_revision_id ? "当前版本成片" : "预览为历史成片；修改后请重新渲染") : "等待初稿"}
                            </span>
                            <div className="flex gap-2">
                                <Button icon={<Film size={14} />} disabled={disabled || !enabled || !timeline} onClick={() => void run("render")}>
                                    重新渲染
                                </Button>
                                <Button
                                    icon={<Download size={14} />}
                                    disabled={!preview}
                                    onClick={() => {
                                        if (preview) window.open(preview, "_blank", "noopener,noreferrer");
                                    }}
                                >
                                    导出 MP4
                                </Button>
                            </div>
                        </div>
                    </section>
                    {active && (
                        <section className="rounded-xl border p-4" style={{ borderColor: token.colorBorderSecondary }}>
                            <div className="mb-2 flex items-center justify-between text-sm">
                                <span>
                                    {stageNames[active.stage] || active.stage}
                                    {active.cancel_requested ? " · 正在停止" : ""}
                                </span>
                                <Button
                                    size="small"
                                    danger
                                    disabled={active.cancel_requested}
                                    onClick={() =>
                                        void cancelAutoCutTask(projectId, active.id)
                                            .then(() => load(projectId))
                                            .catch(report)
                                    }
                                >
                                    取消任务
                                </Button>
                            </div>
                            <Progress percent={active.progress} size="small" />
                            <p className="text-xs" style={{ color: token.colorTextSecondary }}>
                                预算上限 {formatCreditPoints(active.budget_cents)} · 模型步骤报价占用 {formatCreditPoints(active.reserved_cents)}（非实际扣费）
                            </p>
                        </section>
                    )}
                    {detail?.tasks[0]?.status === "failed" && (
                        <Alert
                            type="error"
                            showIcon
                            title={detail.tasks[0].error_message}
                            action={
                                <Button
                                    size="small"
                                    disabled={busy}
                                    onClick={() =>
                                        void retryAutoCutTask(projectId, detail.tasks[0].id)
                                            .then(() => load(projectId))
                                            .catch(report)
                                    }
                                >
                                    安全重试
                                </Button>
                            }
                        />
                    )}
                    {timeline ? (
                        <section className="space-y-4 rounded-xl border p-4 md:p-5" style={{ borderColor: token.colorBorderSecondary, background: token.colorBgContainer }}>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <h2 className="font-medium">
                                    03 / 可编辑时间线{" "}
                                    <span className="ml-2 text-xs font-normal" style={{ color: token.colorTextSecondary }}>
                                        {seconds(timeline.target_duration)} 秒
                                    </span>
                                    {dirty && <Tag className="ml-2">未保存</Tag>}
                                </h2>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        icon={<RotateCcw size={14} />}
                                        disabled={disabled || !undo.current.length}
                                        onClick={() => {
                                            const prev = undo.current.pop();
                                            if (prev) {
                                                setTimeline(prev);
                                                setDirty(true);
                                            }
                                        }}
                                    >
                                        撤销
                                    </Button>
                                    <Select<string>
                                        aria-label="恢复历史版本"
                                        placeholder="恢复版本"
                                        value={undefined}
                                        disabled={disabled}
                                        options={detail?.revisions.map((r, i) => ({ value: r.id, label: `${i === 0 ? "最新 · " : ""}${new Date(r.created_at).toLocaleString("zh-CN")}` }))}
                                        onChange={(v) =>
                                            modal.confirm({
                                                title: "恢复为此版本？",
                                                content: "当前未保存的修改会被替换，已保存版本仍可恢复。",
                                                onOk: async () => {
                                                    try {
                                                        await restoreAutoCutRevision(projectId, detail!.project.current_revision_id, v);
                                                        await load(projectId);
                                                    } catch (e) {
                                                        report(e);
                                                    }
                                                },
                                            })
                                        }
                                        style={{ width: 150 }}
                                    />
                                    <Button icon={<Save size={14} />} disabled={disabled || !dirty} onClick={() => void saveOnly()}>
                                        保存
                                    </Button>
                                </div>
                            </div>
                            {timeline.warnings
                                .filter((w) => !/schema|json|metadata|uuid|subtitles|不可信|程序映射|元数据|audio.*轨道/i.test(w))
                                .map((w) => w.replace(/(\d+)ms/g, (_, n) => `${Number(n) / 1000} 秒`))
                                .map((w, i) => (
                                    <Alert key={i} type="warning" title={w} />
                                ))}
                            <div className="flex h-12 gap-0.5 overflow-hidden rounded" aria-label="画面轨道">
                                {visual?.clips.map((c, i) => (
                                    <button
                                        key={c.id}
                                        style={{ flexGrow: c.source_out - c.source_in, flexBasis: 0, minWidth: 22, background: token.colorPrimaryBg, color: token.colorPrimaryText }}
                                        title={`${i + 1} · ${seconds(c.source_out - c.source_in)} 秒`}
                                        onClick={() => {
                                            if (player.current) player.current.currentTime = c.timeline_start / 1000;
                                        }}
                                    >
                                        {i + 1}
                                    </button>
                                ))}
                            </div>
                            {timeline.tracks.map((track, trackIndex) => (
                                <div key={track.id} className="space-y-2">
                                    <h3 className="text-xs" style={{ color: token.colorTextSecondary }}>
                                        {track.kind === "video" ? "画面与原声" : "外加音轨"}
                                    </h3>
                                    {track.clips.map((c, i) => (
                                        <div key={c.id} className="flex flex-wrap items-center gap-2 border-b py-2" style={{ borderColor: token.colorBorderSecondary }}>
                                            <span className="w-6 text-xs">{i + 1}</span>
                                            <span className="min-w-24 flex-1 truncate text-sm">{detail?.assets.find((a) => a.id === c.asset_version_id)?.name || "素材"}</span>
                                            <label className="text-xs">
                                                入点{" "}
                                                <InputNumber
                                                    aria-label={`片段${i + 1}入点秒`}
                                                    size="small"
                                                    min={0}
                                                    value={seconds(c.source_in)}
                                                    disabled={disabled}
                                                    onChange={(v) => {
                                                        const t = structuredClone(timeline);
                                                        t.tracks[trackIndex].clips[i].source_in = Math.round((v || 0) * 1000);
                                                        edit(t);
                                                    }}
                                                    style={{ width: 80 }}
                                                />
                                            </label>
                                            <label className="text-xs">
                                                出点{" "}
                                                <InputNumber
                                                    aria-label={`片段${i + 1}出点秒`}
                                                    size="small"
                                                    min={0}
                                                    value={seconds(c.source_out)}
                                                    disabled={disabled}
                                                    onChange={(v) => {
                                                        const t = structuredClone(timeline);
                                                        t.tracks[trackIndex].clips[i].source_out = Math.round((v || 0) * 1000);
                                                        edit(t);
                                                    }}
                                                    style={{ width: 80 }}
                                                />
                                            </label>
                                            <Checkbox
                                                checked={c.effects.muted}
                                                disabled={disabled}
                                                onChange={(e) => {
                                                    const t = structuredClone(timeline);
                                                    t.tracks[trackIndex].clips[i].effects.muted = e.target.checked;
                                                    edit(t);
                                                }}
                                            >
                                                静音
                                            </Checkbox>
                                            <Button
                                                aria-label="上移"
                                                size="small"
                                                type="text"
                                                icon={<ArrowUp size={14} />}
                                                disabled={disabled || i === 0}
                                                onClick={() => {
                                                    const t = structuredClone(timeline),
                                                        clips = t.tracks[trackIndex].clips;
                                                    [clips[i - 1], clips[i]] = [clips[i], clips[i - 1]];
                                                    edit(t);
                                                }}
                                            />
                                            <Button
                                                aria-label="下移"
                                                size="small"
                                                type="text"
                                                icon={<ArrowDown size={14} />}
                                                disabled={disabled || i === track.clips.length - 1}
                                                onClick={() => {
                                                    const t = structuredClone(timeline),
                                                        clips = t.tracks[trackIndex].clips;
                                                    [clips[i + 1], clips[i]] = [clips[i], clips[i + 1]];
                                                    edit(t);
                                                }}
                                            />
                                            <Button
                                                aria-label="删除片段"
                                                size="small"
                                                type="text"
                                                danger
                                                icon={<Trash2 size={14} />}
                                                disabled={disabled || (track.kind === "video" && track.clips.length <= 1)}
                                                onClick={() => {
                                                    const t = structuredClone(timeline);
                                                    t.tracks[trackIndex].clips.splice(i, 1);
                                                    edit(t);
                                                }}
                                            />
                                        </div>
                                    ))}
                                </div>
                            ))}
                            <div className="flex max-w-sm items-center gap-3">
                                <Volume2 size={16} />
                                <label className="text-xs">总音量</label>
                                <Slider
                                    className="flex-1"
                                    min={0}
                                    max={2}
                                    step={0.05}
                                    value={timeline.audio_settings.master_volume}
                                    disabled={disabled}
                                    onChange={(v) => {
                                        const t = structuredClone(timeline);
                                        t.audio_settings.master_volume = v;
                                        edit(t);
                                    }}
                                />
                            </div>
                            <details>
                                <summary className="cursor-pointer text-sm">字幕 · {timeline.subtitles.length} 条</summary>
                                <div className="mt-3 max-h-80 space-y-2 overflow-auto">
                                    {timeline.subtitles.map((s, i) => (
                                        <div key={s.id} className="flex flex-wrap gap-2">
                                            <InputNumber
                                                aria-label="字幕开始秒"
                                                size="small"
                                                value={seconds(s.start)}
                                                disabled={disabled}
                                                onChange={(v) => {
                                                    const t = structuredClone(timeline);
                                                    t.subtitles[i].start = Math.round((v || 0) * 1000);
                                                    edit(t);
                                                }}
                                            />
                                            <InputNumber
                                                aria-label="字幕结束秒"
                                                size="small"
                                                value={seconds(s.end)}
                                                disabled={disabled}
                                                onChange={(v) => {
                                                    const t = structuredClone(timeline);
                                                    t.subtitles[i].end = Math.round((v || 0) * 1000);
                                                    edit(t);
                                                }}
                                            />
                                            <Input
                                                aria-label={`字幕${i + 1}`}
                                                className="!w-auto min-w-40 flex-1"
                                                value={s.text}
                                                disabled={disabled}
                                                onChange={(e) => {
                                                    const t = structuredClone(timeline);
                                                    t.subtitles[i].text = e.target.value;
                                                    edit(t);
                                                }}
                                            />
                                            <Button
                                                type="text"
                                                aria-label="删除字幕"
                                                icon={<Trash2 size={14} />}
                                                disabled={disabled}
                                                onClick={() => {
                                                    const t = structuredClone(timeline);
                                                    t.subtitles.splice(i, 1);
                                                    edit(t);
                                                }}
                                            />
                                        </div>
                                    ))}
                                    <Button
                                        size="small"
                                        icon={<Plus size={13} />}
                                        disabled={disabled}
                                        onClick={() => {
                                            const t = structuredClone(timeline);
                                            t.subtitles.push({ id: crypto.randomUUID(), start: 0, end: Math.min(1000, t.target_duration), text: "新字幕" });
                                            edit(t);
                                        }}
                                    >
                                        添加字幕
                                    </Button>
                                </div>
                            </details>
                        </section>
                    ) : null}
                </div>
            </div>
        </main>
    );
}
