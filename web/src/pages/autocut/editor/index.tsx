import { summarizeCreditCalls } from "@/lib/credit-display";
import { App, Alert, Button, Checkbox, Empty, Input, InputNumber, Progress, Select, Tag, theme } from "antd";
import { ArrowLeft, Copy, Download, Film, Plus, Redo2, Save, Scissors, Sparkles, Trash2, Undo2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getCloudAssetDownloadUrl, listCloudAssets, uploadCloudAsset, type CloudAsset } from "@/services/api/assets";
import { getP1Project, p1Capabilities, saveP1Timeline, startP1Task, addP1Assets, cancelAutoCutTask, retryAutoCutTask, restoreAutoCutRevision, type P1Detail, type ExportFormat } from "@/services/api/autocut";
import { createFeedback } from "@/services/api/operations";
import { Timeline } from "./timeline";
import { SourcePreview } from "./preview";
import { Inspector } from "./inspector";
import { uid, reflow, splitClip, duplicateClips, removeClips, upgradeTimeline, applyPreset, P1_LIMITS, type P1Timeline, type STYLE_PRESETS } from "./model";

const labels: Record<ExportFormat, string> = { otio: "OpenTimelineIO", fcp7: "FCP7 XML", jianying: "剪映草稿", capcut: "CapCut 草稿", srt: "SRT 字幕" };
const presets = [
    ["minimal-speech", "简约口播"],
    ["vlog", "轻快 Vlog"],
    ["cinematic-travel", "旅行运镜"],
    ["product", "商品展示"],
    ["knowledge", "知识讲解"],
] as const;
export default function AutoCutEditorPage() {
    const { message, modal } = App.useApp(),
        { token } = theme.useToken(),
        [params] = useSearchParams(),
        id = params.get("edit") ?? "";
    const [detail, setDetail] = useState<P1Detail | null>(null),
        [doc, setDoc] = useState<P1Timeline | null>(null),
        [assets, setAssets] = useState<CloudAsset[]>([]),
        [caps, setCaps] = useState<Awaited<ReturnType<typeof p1Capabilities>> | null>(null);
    const [selected, setSelected] = useState<string[]>([]),
        [time, setTime] = useState(0),
        [playing, setPlaying] = useState(false),
        [dirty, setDirty] = useState(false),
        [busy, setBusy] = useState(false),
        [error, setError] = useState(""),
        [history, setHistory] = useState<{ past: P1Timeline[]; future: P1Timeline[] }>({ past: [], future: [] }),
        [thumbnails, setThumbnails] = useState<Record<string, string>>({});
    const file = useRef<HTMLInputElement>(null),
        state = useRef({ doc, dirty });
    state.current = { doc, dirty };
    const report = useCallback(
        (e: unknown) => {
            const text = e instanceof Error ? e.message : "操作失败";
            setError(text);
            void message.error(text);
        },
        [message],
    );
    const load = useCallback(
        async (reset = false) => {
            if (!id) return;
            const d = await getP1Project(id);
            setDetail(d);
            if (reset || !state.current.dirty) {
                const t = d.timeline;
                if (t) setDoc(t.schema_version === 2 ? t : upgradeTimeline(t, (key) => !!d.analyses[key]?.hasAudio));
                if (reset) {
                    setDirty(false);
                    setHistory({ past: [], future: [] });
                }
            }
        },
        [id],
    );
    useEffect(() => {
        void Promise.all([p1Capabilities(), load(true)])
            .then(([c]) => setCaps(c))
            .catch(report);
    }, [load, report]);
    useEffect(() => {
        if (!detail?.project.project_id) return;
        let live = true;
        void listCloudAssets(detail.project.project_id)
            .then((a) => {
                if (live) setAssets(a);
            })
            .catch(report);
        return () => {
            live = false;
        };
    }, [detail?.project.project_id, detail?.analyses, report]);
    const active = detail?.tasks.find((t) => ["queued", "running"].includes(t.status));
    useEffect(() => {
        if (!active) return;
        const timer = setInterval(() => {
            void load().catch(report);
        }, 2000);
        return () => clearInterval(timer);
    }, [active?.id, load, report]);
    useEffect(() => {
        if (!dirty) return;
        const stop = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = "";
        };
        window.addEventListener("beforeunload", stop);
        return () => window.removeEventListener("beforeunload", stop);
    }, [dirty]);
    useEffect(() => {
        let live = true;
        const sources = assets.flatMap((a) => a.versions).filter((v) => detail?.project.asset_version_ids.includes(v.id));
        void Promise.all(sources.map(async (v) => [v.id, v.thumbnailUrl || (v.mimeType.startsWith("image/") ? await getCloudAssetDownloadUrl(v.id) : v.thumbnailStorageKey ? `/api/media/asset-versions/${v.id}?thumbnail=1` : "")] as const))
            .then((entries) => {
                if (live) setThumbnails(Object.fromEntries(entries));
            })
            .catch(report);
        return () => {
            live = false;
        };
    }, [assets, detail?.project.asset_version_ids, report]);
    const mimeTypes = useMemo(() => Object.fromEntries((detail?.assets ?? []).map((a) => [a.id, a.mimeType])), [detail?.assets]);
    const disabled = busy || !!active || !caps?.enabled;
    const change = (next: P1Timeline) => {
        if (disabled || !doc) return;
        if (next.tracks.length > P1_LIMITS.tracks || next.tracks.flatMap((t) => t.clips).length > P1_LIMITS.clips || next.effect_stack.length > P1_LIMITS.effects || next.effect_stack.some((e) => e.keyframes.length > P1_LIMITS.keyframes)) {
            report(new Error("超出已确认的工程资源上限，未应用本次修改"));
            return;
        }
        setPlaying(false);
        setHistory((h) => ({ past: [...h.past, doc], future: [] }));
        setDoc(next);
        setDirty(true);
        setTime((v) => Math.min(v, next.target_duration));
    };
    async function save() {
        if (!doc || !detail) throw new Error("请先添加主轨素材");
        if (!dirty && detail.timeline?.schema_version === 2) return doc;
        const saved = await saveP1Timeline(id, detail.project.current_revision_id, doc);
        setDoc(saved);
        setDetail((d) => (d ? { ...d, project: { ...d.project, current_revision_id: saved.revision_id }, timeline: saved } : d));
        setDirty(false);
        return saved;
    }
    async function action(fn: () => Promise<unknown>) {
        setBusy(true);
        setError("");
        setPlaying(false);
        try {
            await fn();
        } catch (e) {
            report(e);
        } finally {
            setBusy(false);
        }
    }
    async function run(kind: "prepare" | "render" | "effects" | "export", extra: { format?: ExportFormat; includeMedia?: boolean; acceptLossy?: boolean; previewClipId?: string; clipIds?: string[]; budget?: number; prompt?: string } = {}) {
        if (!detail) throw new Error("工程未加载");
        const t = kind === "prepare" ? doc : await save();
        await startP1Task(id, {
            operationId: uid(),
            expectedRevision: kind === "prepare" ? detail.project.current_revision_id : (t?.revision_id ?? detail.project.current_revision_id),
            kind,
            prompt: extra.prompt ?? "",
            mode: "custom",
            targetDurationMs: t?.target_duration ?? 60000,
            aspectRatio: t?.aspect_ratio ?? "16:9",
            budgetCents: extra.budget ?? 0,
            confirmed: kind === "effects",
            p1: { version: 1, format: extra.format, includeMedia: extra.includeMedia, acceptLossy: extra.acceptLossy, previewClipId: extra.previewClipId, clipIds: extra.clipIds },
        });
        await load();
    }
    async function append(assetId: string, role: "main" | "overlay" | "music") {
        if (!detail) return;
        const a = detail.assets.find((a) => a.id === assetId),
            info = detail.analyses[assetId];
        if (!a || !info) throw new Error("请先点击“准备素材”，读取时长和媒体信息");
        if ((role === "music" && !info.hasAudio) || (role !== "music" && a.mimeType.startsWith("audio/"))) throw new Error("素材类型与轨道不符");
        const n = doc
            ? structuredClone(doc)
            : {
                  schema_version: 2 as const,
                  project_id: id,
                  revision_id: uid(),
                  target_duration: 0,
                  aspect_ratio: "16:9" as const,
                  fps: 25 as const,
                  tracks: [{ id: uid(), name: "视频主轨", kind: "video" as const, role: "main" as const, layer: 0, muted: false, volume: 1, clips: [] }],
                  subtitles: [],
                  effect_stack: [],
                  audio_settings: { master_volume: 1 },
                  export_settings: { codec: "h264" as const, format: "mp4" as const, resolution: 720 as const },
                  warnings: [],
              };
        if (!doc && role !== "main") throw new Error("请先添加视频主轨");
        let track = n.tracks.find((t) => t.role === role);
        if (role === "overlay" || !track) {
            track = {
                id: uid(),
                name: role === "overlay" ? `叠加画面 ${n.tracks.filter((t) => t.role === "overlay").length + 1}` : "背景音乐",
                kind: role === "music" ? "audio" : "video",
                role,
                layer: role === "overlay" ? Math.max(0, ...n.tracks.filter((t) => t.kind === "video").map((t) => t.layer)) + 1 : 0,
                muted: false,
                volume: 1,
                clips: [],
            };
            n.tracks.push(track);
        }
        const start = role === "main" ? n.target_duration : Math.round(time),
            length = a.mimeType.startsWith("image/") ? 5000 : info.durationMs,
            out = role === "main" ? length : Math.min(length, n.target_duration - start);
        if (out <= 0) throw new Error("请将播放头移到工程范围内");
        const c = { id: uid(), asset_id: a.assetId, asset_version_id: a.id, source_in: 0, source_out: out, timeline_start: start, speed: 1, effects: { volume: 1, muted: role !== "music" } };
        track.clips.push(c);
        if (role === "main" && info.hasAudio) {
            let sound = n.tracks.find((t) => t.role === "original");
            if (!sound) {
                sound = { id: uid(), name: "原声", kind: "audio", role: "original", layer: 0, muted: false, volume: 1, clips: [] };
                n.tracks.push(sound);
            }
            sound.clips.push({ ...structuredClone(c), id: uid(), linked_clip_id: c.id, effects: { volume: 1, muted: false } });
        }
        reflow(n, doc ?? undefined);
        if (n.tracks.length > P1_LIMITS.tracks || n.tracks.flatMap((t) => t.clips).length > P1_LIMITS.clips) throw new Error("超出轨道或片段数量上限");
        if (doc) change(n);
        else {
            setDoc(n);
            setDirty(true);
        }
        setSelected([c.id]);
    }
    function exportDialog() {
        let format: ExportFormat = "otio",
            includeMedia = true,
            acceptLossy = false;
        modal.confirm({
            title: "导出可编辑工程 · 实验功能",
            width: 560,
            okText: "确认兼容性并导出",
            content: (
                <div className="space-y-4">
                    <Alert type="warning" title="尚未做目标软件打开验收" description="滤镜、转场、缓动与字幕排版可能降级。工程包内附兼容性说明、原始 Timeline 和独立 SRT；请保留 MP4 作为视觉参考。" />
                    <Select
                        className="w-full"
                        defaultValue={format}
                        options={caps?.formats.map((f) => ({ value: f.format, label: `${labels[f.format]}${f.enabled ? " · 未验收" : " · 不可用"}`, disabled: !f.enabled }))}
                        onChange={(v) => {
                            format = v;
                        }}
                    />
                    <Checkbox
                        defaultChecked
                        onChange={(e) => {
                            includeMedia = e.target.checked;
                        }}
                    >
                        打包使用的原素材（总包不超过 5 GiB）
                    </Checkbox>
                    <Checkbox
                        onChange={(e) => {
                            acceptLossy = e.target.checked;
                        }}
                    >
                        我理解效果可能无法在目标软件完整还原
                    </Checkbox>
                    <p className="text-xs opacity-60">下载链接按现有 15 分钟签名规则生成。安装脚本只写入指定的新文件夹，不覆盖已有草稿。</p>
                </div>
            ),
            onOk: () => {
                if (!acceptLossy) return Promise.reject(new Error("请确认效果降级提示"));
                return action(() => run("export", { format, includeMedia, acceptLossy }));
            },
        });
    }
    function aiDialog() {
        if (!selected.length) return;
        let budget: number | null = null,
            prompt = "为选中片段添加克制的基础运镜或淡入淡出";
        modal.confirm({
            title: "AI 效果规划 · 仅选中范围",
            okText: "确认积分预算并生成",
            content: (
                <div className="space-y-3">
                    <p>不会改写粗剪选段或自动重试付费请求；选中片段元数据与指令将交给现有模型，按已包含平台计费加价的整数积分结算。</p>
                    <Input.TextArea
                        defaultValue={prompt}
                        onChange={(e) => {
                            prompt = e.target.value;
                        }}
                    />
                    <InputNumber
                        aria-label="AI效果积分预算上限"
                        min={1}
                        precision={0}
                        suffix="积分"
                        placeholder="积分预算上限"
                        onChange={(v) => {
                            budget = v;
                        }}
                    />
                </div>
            ),
            onOk: () => {
                if (!budget) return Promise.reject(new Error("请填写积分预算上限"));
                const cents = budget;
                return action(() => run("effects", { clipIds: selected, budget: cents, prompt }));
            },
        });
    }
    function undo(redo = false) {
        const from = redo ? history.future : history.past;
        if (!doc || !from.length || disabled) return;
        const next = from[from.length - 1];
        setHistory(redo ? { past: [...history.past, doc], future: from.slice(0, -1) } : { past: from.slice(0, -1), future: [...history.future, doc] });
        setDoc(next);
        setDirty(true);
        setPlaying(false);
    }
    async function upload(files: FileList | null) {
        if (!files || !detail) return;
        for (const f of Array.from(files)) {
            if (f.size > 500 * 1024 ** 2) throw new Error(`${f.name} 超过 500 MB`);
            const a = await uploadCloudAsset(detail.project.project_id, f, { streamHash: true });
            if (a.currentVersionId) await addP1Assets(id, detail.project.current_revision_id, [a.currentVersionId]);
        }
        await load();
    }
    if (!id)
        return (
            <Empty description="请先从 AI 智能剪辑选择工程">
                <Link to="/autocut">返回工程列表</Link>
            </Empty>
        );
    return (
        <div className="flex h-[calc(100dvh-56px)] min-h-[650px] flex-col" style={{ color: token.colorText, background: token.colorBgLayout }}>
            <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3" style={{ borderColor: token.colorBorderSecondary, background: token.colorBgContainer }}>
                <Link to="/autocut" aria-label="返回粗剪">
                    <ArrowLeft size={18} />
                </Link>
                <h1 className="ml-2 mr-auto text-sm font-semibold">
                    {detail?.project.name ?? "AutoCut"} <span className="ml-2 font-normal opacity-50">可视化精修</span>
                </h1>
                <Tag color="gold">可视化精修 · 测试版</Tag>
                {dirty && <span className="text-xs opacity-50">未保存</span>}
                <Button icon={<Save size={14} />} disabled={disabled || !doc} onClick={() => void action(save)}>
                    保存版本
                </Button>
                <Button icon={<Film size={14} />} disabled={disabled || !doc} onClick={() => void action(() => run("render"))}>
                    渲染 MP4
                </Button>
                <Button type="primary" icon={<Download size={14} />} disabled={disabled || !doc} onClick={exportDialog}>
                    导出工程
                </Button>
            </header>
            {caps && !caps.enabled && <Alert type="info" title="可视化精修暂未开放，当前工程只读。" />}
            {error && <Alert closable type="error" title={error} onClose={() => setError("")} />}
            {!!doc?.warnings.length && (
                <details className="px-4 py-1 text-xs">
                    <summary>工程提示与 AI 说明（{doc.warnings.length}）</summary>
                    <ul className="max-h-24 overflow-auto">
                        {doc.warnings.map((text, i) => (
                            <li key={i}>{text}</li>
                        ))}
                    </ul>
                </details>
            )}
            {!active && detail?.tasks[0] && ["failed", "cancelled"].includes(detail.tasks[0].status) && (
                <Alert
                    type="warning"
                    title={detail.tasks[0].error_message || "任务已取消；已发生费用以账本记录为准"}
                    action={
                        <Button
                            size="small"
                            disabled={disabled || dirty}
                            onClick={() =>
                                void action(async () => {
                                    await retryAutoCutTask(id, detail.tasks[0].id);
                                    await load();
                                })
                            }
                        >
                            重试原任务
                        </Button>
                    }
                />
            )}
            {active && (
                <div className="flex items-center gap-3 px-4 py-2">
                    <span className="text-xs">
                        {active.stage} · {active.id.slice(0, 8)}
                    </span>
                    <Progress className="flex-1" percent={active.progress} size="small" />
                    <Button
                        size="small"
                        onClick={() =>
                            void action(async () => {
                                await cancelAutoCutTask(id, active.id);
                                await load();
                            })
                        }
                    >
                        取消任务
                    </Button>
                </div>
            )}
            <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(300px,1fr)_280px] gap-px" style={{ background: token.colorBorderSecondary }}>
                <aside className="overflow-y-auto p-3" style={{ background: token.colorBgContainer }}>
                    <div className="mb-3 flex items-center justify-between text-sm">
                        <span>工程素材</span>
                        <Button type="text" size="small" icon={<Upload size={14} />} aria-label="上传素材" disabled={disabled} onClick={() => file.current?.click()} />
                        <input
                            ref={file}
                            type="file"
                            hidden
                            multiple
                            accept="video/*,audio/*,image/*"
                            onChange={(e) => {
                                const f = e.target.files;
                                void action(() => upload(f));
                                e.target.value = "";
                            }}
                        />
                    </div>
                    <Button block size="small" disabled={disabled} onClick={() => void action(() => run("prepare"))}>
                        准备素材 · 不调用付费模型
                    </Button>
                    {detail?.assets.map((a) => (
                        <div key={a.id} className="my-3 border-b pb-3" style={{ borderColor: token.colorBorderSecondary }}>
                            {thumbnails[a.id] && <img src={thumbnails[a.id]} alt="" className="mb-2 h-20 w-full rounded object-cover" />}
                            <p className="truncate text-xs" title={a.name}>
                                {a.name}
                            </p>
                            <p className="my-1 text-[10px] opacity-50">
                                {(a.bytes / 1024 ** 2).toFixed(1)} MB · {detail.analyses[a.id] ? `${(detail.analyses[a.id].durationMs / 1000).toFixed(1)}s` : "待读取"}
                            </p>
                            <div className="flex gap-1">
                                {!a.mimeType.startsWith("audio/") && (
                                    <>
                                        <Button size="small" disabled={disabled} onClick={() => void action(() => append(a.id, "main"))}>
                                            主轨
                                        </Button>
                                        <Button size="small" disabled={disabled || !doc} onClick={() => void action(() => append(a.id, "overlay"))}>
                                            叠加
                                        </Button>
                                    </>
                                )}
                                <Button size="small" disabled={disabled || !doc || !detail.analyses[a.id]?.hasAudio} onClick={() => void action(() => append(a.id, "music"))}>
                                    音轨
                                </Button>
                            </div>
                        </div>
                    ))}
                    <Select<string>
                        className="my-2 w-full"
                        placeholder="添加素材库已有版本"
                        disabled={disabled}
                        value={undefined}
                        options={assets.filter((a) => a.currentVersionId && !detail?.project.asset_version_ids.includes(a.currentVersionId) && ["video", "audio", "image"].includes(a.kind)).map((a) => ({ value: a.currentVersionId!, label: a.name }))}
                        onChange={(v) =>
                            void action(async () => {
                                await addP1Assets(id, detail!.project.current_revision_id, [v]);
                                await load();
                            })
                        }
                    />
                </aside>
                <main className="flex min-h-0 flex-col p-3" style={{ background: token.colorBgLayout }}>
                    {doc ? (
                        <SourcePreview timeline={doc} time={time} playing={playing} onTime={setTime} onPlaying={setPlaying} mimeTypes={mimeTypes} />
                    ) : (
                        <div className="m-auto">
                            <Empty description="准备素材后添加到主轨，或先用粗剪生成初稿" />
                        </div>
                    )}
                    <div className="flex flex-wrap items-center justify-center gap-2 py-2">
                        <Select
                            size="small"
                            disabled={disabled || !doc}
                            value={doc?.aspect_ratio ?? "16:9"}
                            options={["16:9", "9:16", "1:1"].map((value) => ({ value, label: value }))}
                            onChange={(v) => doc && change({ ...doc, aspect_ratio: v as P1Timeline["aspect_ratio"] })}
                        />
                        <Select<string>
                            size="small"
                            placeholder="风格预设"
                            value={undefined}
                            disabled={disabled || !doc || !selected.length}
                            options={presets.map(([value, label]) => ({ value, label }))}
                            onChange={(v) => doc && change(applyPreset(doc, v as (typeof STYLE_PRESETS)[number], new Set(selected)))}
                        />
                        <Button size="small" disabled={disabled || !selected.length} onClick={() => void action(() => run("render", { previewClipId: selected[0] }))}>
                            片段低清预览
                        </Button>
                        <Button size="small" icon={<Sparkles size={12} />} disabled={disabled || !selected.length} onClick={aiDialog}>
                            AI 效果
                        </Button>
                        <span className="text-[10px] opacity-50">字体、锐化及滤镜预览近似；最终以 MP4 为准</span>
                    </div>
                </main>
                <div style={{ background: token.colorBgContainer, pointerEvents: disabled ? "none" : undefined, opacity: disabled ? 0.6 : 1 }}>{doc && <Inspector document={doc} selected={selected} time={time} change={change} />}</div>
            </div>
            <div className="flex flex-wrap items-center gap-1 border-t px-3 py-1" style={{ background: token.colorBgContainer, borderColor: token.colorBorderSecondary }}>
                <Button type="text" size="small" icon={<Undo2 size={14} />} disabled={disabled || !history.past.length} onClick={() => undo()}>
                    撤销
                </Button>
                <Button type="text" size="small" icon={<Redo2 size={14} />} disabled={disabled || !history.future.length} onClick={() => undo(true)}>
                    重做
                </Button>
                <Button type="text" size="small" icon={<Scissors size={14} />} disabled={disabled || !selected.length} onClick={() => doc && change(splitClip(structuredClone(doc), selected[0], Math.round(time)))}>
                    分割
                </Button>
                <Button type="text" size="small" icon={<Copy size={14} />} disabled={disabled || !selected.length} onClick={() => doc && change(duplicateClips(structuredClone(doc), new Set(selected)))}>
                    复制
                </Button>
                <Button
                    type="text"
                    size="small"
                    icon={<Trash2 size={14} />}
                    disabled={disabled || !selected.length}
                    onClick={() => {
                        if (!doc) return;
                        const n = removeClips(structuredClone(doc), new Set(selected));
                        n.subtitles = n.subtitles.filter((s) => !selected.includes(s.id));
                        n.effect_stack = n.effect_stack.filter((e) => !selected.includes(e.target.id));
                        change(n);
                        setSelected([]);
                    }}
                >
                    删除
                </Button>
                <Button
                    type="text"
                    size="small"
                    icon={<Plus size={14} />}
                    disabled={disabled || !doc || time >= doc.target_duration}
                    onClick={() => {
                        if (!doc) return;
                        const key = uid();
                        change({
                            ...doc,
                            subtitles: [...doc.subtitles, { id: key, start: Math.round(time), end: Math.min(doc.target_duration, Math.round(time) + 3000), text: "输入字幕或标题", kind: "title", layer: 100, font_size: 32, color: "#ffffff", x: 0, y: 0.8 }],
                        });
                        setSelected([key]);
                    }}
                >
                    字幕 / 标题
                </Button>
                <Select<string>
                    size="small"
                    className="ml-auto w-44"
                    value={undefined}
                    placeholder="恢复历史版本"
                    disabled={disabled}
                    options={detail?.revisions.map((r, i) => ({ value: r.id, label: `版本 ${detail.revisions.length - i} · ${new Date(r.created_at).toLocaleTimeString()}` }))}
                    onChange={(v) =>
                        modal.confirm({
                            title: "恢复历史版本？",
                            content: "将建立新版本；未保存修改会被替换。",
                            onOk: () =>
                                action(async () => {
                                    await restoreAutoCutRevision(id, detail!.project.current_revision_id, v);
                                    await load(true);
                                }),
                        })
                    }
                />
            </div>
            {doc && (
                <div style={{ background: token.colorBgContainer, pointerEvents: disabled ? "none" : undefined }}>
                    <Timeline document={doc} time={time} selected={selected} select={setSelected} seek={setTime} change={change} thumbnails={thumbnails} />
                </div>
            )}
            <footer className="flex max-h-24 shrink-0 flex-wrap items-center gap-3 overflow-auto border-t px-4 py-2 text-xs" style={{ borderColor: token.colorBorderSecondary, background: token.colorBgContainer }}>
                <span className="opacity-50">历史输出</span>
                {detail?.tasks
                    .filter((t) => t.output_asset_version_id && t.status === "completed")
                    .slice(0, 8)
                    .map((t) => (
                        <Button
                            key={t.id}
                            type="link"
                            size="small"
                            onClick={() => {
                                void getCloudAssetDownloadUrl(t.output_asset_version_id!)
                                    .then((url) => {
                                        const a = document.createElement("a");
                                        a.href = url;
                                        a.target = "_blank";
                                        a.rel = "noopener noreferrer";
                                        a.click();
                                    })
                                    .catch(report);
                            }}
                        >
                            {t.input?.kind === "export" ? "工程 ZIP" : t.input?.p1?.previewClipId ? "低清预览" : "MP4"} · {t.id.slice(0, 6)}
                        </Button>
                    ))}
                <span className="ml-auto opacity-50">{detail ? summarizeCreditCalls(detail.calls) : "正在读取积分账单…"}</span>
                <Button
                    type="link"
                    size="small"
                    onClick={() => {
                        let text = "";
                        modal.confirm({
                            title: "反馈精修问题",
                            content: (
                                <Input.TextArea
                                    placeholder="请勿填写原始素材或隐私"
                                    maxLength={1500}
                                    onChange={(e) => {
                                        text = e.target.value;
                                    }}
                                />
                            ),
                            onOk: () => createFeedback({ category: "problem", pagePath: "/autocut/editor", content: `AutoCut P1 工程 ${id}\n${text}` }),
                        });
                    }}
                >
                    问题反馈
                </Button>
            </footer>
        </div>
    );
}
