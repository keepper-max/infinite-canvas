import { App, Button, Drawer, Input, Select, Tag } from "antd";
import { ArrowRight, CheckCircle2, Clapperboard, Film, History, LoaderCircle, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, RotateCcw, Sparkles, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { registerDramaNodes } from "@/components/canvas/nodes/drama-nodes";
import { createCanvasDraft, getCanvas, saveCanvas } from "@/services/api/canvas";
import { createManagedJob, getManagedJob, retryManagedJob, subscribeProjectJobEvents, waitForManagedJob } from "@/services/api/jobs";
import { getDirectorSettings, getPendingDirectorJob, listDirectorHistory, type DirectorHistoryJob, type DirectorSettings } from "@/services/api/director";
import { listProjects, type ProjectSummary } from "@/services/api/platform";
import { buildDirectorWorkflow, directorSystemPrompt, directorWorkflowNodeKeys, directorWorkflowOrigin, parseDirectorPlan, type DirectorWorkflowPlan, type DirectorWorkflowProfile } from "@/lib/drama/director-workflow";
import { modelOptionLabel, useEffectiveConfig } from "@/stores/use-config-store";

registerDramaNodes();

const PROFILE_OPTIONS = [
    { value: "auto", label: "由导演判断", description: "根据故事复杂度选择最精简的工作流" },
    { value: "short", label: "快速短片", description: "故事、分镜、导演提示词和视频" },
    { value: "standard", label: "标准漫剧", description: "包含角色、场景、分镜、声音和成片" },
    { value: "full", label: "完整制作", description: "增加道具、尾帧、配乐等完整生产节点" },
] as const;

const NODE_NAMES: Record<string, string> = {
    story: "故事创意",
    writer: "AI 编剧",
    breakdown: "剧本拆解",
    character: "角色设定",
    turnaround: "角色三视图",
    scene: "场景候选",
    panorama: "全景环境",
    prop: "关键道具",
    composition: "3D 构图",
    storyboard: "分镜表",
    optimize: "提示词优化",
    firstFrame: "首帧",
    lastFrame: "尾帧",
    skill: "Seedance 漫剧 Skill",
    video: "Seedance 视频",
    voice: "角色配音",
    sfx: "镜头音效",
    music: "背景音乐",
    subtitles: "字幕轨",
    timeline: "成片时间线",
    output: "成片输出",
};

const PENDING_DIRECTOR_JOB_KEY = "shoushou.director.pending-job.v1";
const LAST_HANDLED_DIRECTOR_JOB_KEY = "shoushou.director.last-handled-job.v1";

type PendingDirectorJob = {
    jobId: string;
    profile: DirectorWorkflowProfile | "auto";
    idea?: string;
};

function readPendingDirectorJob(): PendingDirectorJob | null {
    try {
        const value = JSON.parse(localStorage.getItem(PENDING_DIRECTOR_JOB_KEY) || "null") as Partial<PendingDirectorJob> | null;
        if (!value?.jobId || !PROFILE_OPTIONS.some((item) => item.value === value.profile)) return null;
        return { jobId: value.jobId, profile: value.profile! };
    } catch {
        return null;
    }
}

function savePendingDirectorJob(value: PendingDirectorJob | null) {
    try {
        if (value) localStorage.setItem(PENDING_DIRECTOR_JOB_KEY, JSON.stringify({ jobId: value.jobId, profile: value.profile }));
        else localStorage.removeItem(PENDING_DIRECTOR_JOB_KEY);
    } catch {
        // Browser storage can be unavailable in private or restricted contexts.
    }
}

function readLastHandledDirectorJobId() {
    try {
        return localStorage.getItem(LAST_HANDLED_DIRECTOR_JOB_KEY) || "";
    } catch {
        return "";
    }
}

function saveLastHandledDirectorJobId(jobId: string) {
    try {
        localStorage.setItem(LAST_HANDLED_DIRECTOR_JOB_KEY, jobId);
    } catch {
        // Browser storage can be unavailable in private or restricted contexts.
    }
}

export default function DirectorWorkbenchPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const config = useEffectiveConfig();
    const [directorSettings, setDirectorSettings] = useState<DirectorSettings>();
    const model = directorSettings?.modelId || config.textModel || config.model;
    const [idea, setIdea] = useState("");
    const [profile, setProfile] = useState<DirectorWorkflowProfile | "auto">("auto");
    const [plan, setPlan] = useState<DirectorWorkflowPlan | null>(null);
    const [projects, setProjects] = useState<ProjectSummary[]>([]);
    const [projectId, setProjectId] = useState("");
    const [planning, setPlanning] = useState(false);
    const [planningStage, setPlanningStage] = useState("");
    const [pendingJob, setPendingJob] = useState<PendingDirectorJob | null>(() => readPendingDirectorJob());
    const [recoveringPendingJob, setRecoveringPendingJob] = useState(true);
    const [transferring, setTransferring] = useState(false);
    const [history, setHistory] = useState<DirectorHistoryJob[]>([]);
    const [historyLoading, setHistoryLoading] = useState(true);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [historyCollapsed, setHistoryCollapsed] = useState(false);
    const [selectedHistoryJobId, setSelectedHistoryJobId] = useState("");
    const planningControllerRef = useRef<AbortController | null>(null);
    const billingWatchCleanupRef = useRef<(() => void) | null>(null);
    const resumedPendingJobRef = useRef(false);
    const selectedProfile = PROFILE_OPTIONS.find((item) => item.value === profile) || PROFILE_OPTIONS[0];
    const nodeKeys = useMemo(() => (plan ? directorWorkflowNodeKeys(plan.profile) : []), [plan]);

    const loadHistory = useCallback(async (signal?: AbortSignal) => {
        setHistoryLoading(true);
        try {
            setHistory(await listDirectorHistory(signal));
        } catch (error) {
            if (!signal?.aborted) message.error(error instanceof Error ? error.message : "生成记录加载失败");
        } finally {
            if (!signal?.aborted) setHistoryLoading(false);
        }
    }, [message]);

    useEffect(() => {
        const controller = new AbortController();
        void loadHistory(controller.signal);
        return () => controller.abort();
    }, [loadHistory]);

    useEffect(() => {
        let live = true;
        void listProjects()
            .then((items) => {
                if (!live) return;
                const editable = items.filter((item) => item.role === "owner");
                setProjects(editable);
                setProjectId((current) => current || editable.find((item) => item.isDefault)?.projectId || editable[0]?.projectId || "");
            })
            .catch((error) => message.error(error instanceof Error ? error.message : "画布列表加载失败"));
        return () => {
            live = false;
        };
    }, [message]);

    useEffect(() => {
        const controller = new AbortController();
        void getDirectorSettings(controller.signal)
            .then(setDirectorSettings)
            .catch((error) => message.error(error instanceof Error ? error.message : "导演台设置加载失败"));
        return () => controller.abort();
    }, [message]);

    useEffect(() => {
        const controller = new AbortController();
        void getPendingDirectorJob(controller.signal)
            .then((job) => {
                if (!job || job.id === readLastHandledDirectorJobId()) return;
                const recoveredProfile = PROFILE_OPTIONS.some((item) => item.value === job.profile) ? (job.profile as PendingDirectorJob["profile"]) : pendingJob?.jobId === job.id ? pendingJob.profile : "auto";
                const recovered = { jobId: job.id, profile: recoveredProfile, idea: job.idea };
                savePendingDirectorJob(recovered);
                setPendingJob(recovered);
                if (job.idea) setIdea(job.idea);
                setProfile(recoveredProfile);
            })
            .catch((error) => {
                if (!controller.signal.aborted) message.error(error instanceof Error ? error.message : "未完成任务检查失败");
            })
            .finally(() => {
                if (!controller.signal.aborted) setRecoveringPendingJob(false);
            });
        return () => controller.abort();
    }, [message]);

    useEffect(
        () => () => {
            planningControllerRef.current?.abort();
            billingWatchCleanupRef.current?.();
        },
        [],
    );

    const watchBillingCompletion = (pending: PendingDirectorJob, projectId: string) => {
        billingWatchCleanupRef.current?.();
        let resumed = false;
        const resumeOnce = () => {
            if (resumed) return;
            resumed = true;
            billingWatchCleanupRef.current?.();
            billingWatchCleanupRef.current = null;
            void resumePlan(pending);
        };
        const verifyCurrentStatus = () => {
            void getManagedJob(pending.jobId)
                .then((job) => {
                    if (job.status !== "billing_pending") resumeOnce();
                })
                .catch(() => undefined);
        };
        billingWatchCleanupRef.current = subscribeProjectJobEvents(
            projectId,
            (event) => {
                if (event.jobId === pending.jobId && event.status !== "billing_pending") resumeOnce();
            },
            verifyCurrentStatus,
        );
    };

    const waitForPlan = async (pending: PendingDirectorJob, signal: AbortSignal) => {
        const completed = await waitForManagedJob(pending.jobId, signal, (job) => {
            if (job.status === "billing_pending") {
                setPlanningStage("上一笔规划已经生成，费用仍在核对中；任务已保留且没有重复提交，可以稍后点击“继续检查规划”。");
                return;
            }
            if (["pending", "queued"].includes(job.status)) setPlanningStage("导演任务正在排队");
            else setPlanningStage("导演模型正在生成规划");
        }, { pauseOnBillingPending: true });
        if (completed.status === "billing_pending") {
            watchBillingCompletion(pending, completed.projectId);
            return;
        }
        billingWatchCleanupRef.current?.();
        billingWatchCleanupRef.current = null;
        const text = String(completed.artifacts?.find((artifact) => artifact.text)?.text || "").trim();
        if (!text) throw new Error("导演模型没有返回规划结果");
        const parsed = parseDirectorPlan(text);
        setPlan(pending.profile === "auto" ? parsed : { ...parsed, profile: pending.profile });
        saveLastHandledDirectorJobId(pending.jobId);
        savePendingDirectorJob(null);
        setPendingJob(null);
        setPlanningStage("");
        setSelectedHistoryJobId(pending.jobId);
        await loadHistory();
        message.success("工作流方案已生成，请确认后转移到画布");
    };

    const resumePlan = async (pending: PendingDirectorJob) => {
        planningControllerRef.current?.abort();
        const controller = new AbortController();
        planningControllerRef.current = controller;
        setPlanning(true);
        setPlanningStage("正在恢复上次的导演任务");
        try {
            await waitForPlan(pending, controller.signal);
        } catch (error) {
            if (controller.signal.aborted) return;
            savePendingDirectorJob(null);
            setPendingJob(null);
            setPlanningStage("");
            await loadHistory();
            message.error(error instanceof Error ? error.message : "导演规划失败");
        } finally {
            if (planningControllerRef.current === controller) planningControllerRef.current = null;
            if (!controller.signal.aborted) setPlanning(false);
        }
    };

    useEffect(() => {
        if (recoveringPendingJob || !pendingJob || resumedPendingJobRef.current) return;
        resumedPendingJobRef.current = true;
        void resumePlan(pendingJob);
    }, [pendingJob, recoveringPendingJob]);

    const openHistoryJob = async (item: DirectorHistoryJob) => {
        if (planning) return;
        if (pendingJob && pendingJob.jobId !== item.id) return message.info("请先完成当前待恢复的导演任务");
        const recoveredProfile = PROFILE_OPTIONS.some((option) => option.value === item.profile) ? (item.profile as PendingDirectorJob["profile"]) : "auto";
        setSelectedHistoryJobId(item.id);
        setIdea(item.idea);
        setProfile(recoveredProfile);
        setHistoryOpen(false);
        if (["pending", "queued", "submitting", "retrying", "running", "downloading", "persisting", "billing_pending"].includes(item.status)) {
            const pending = { jobId: item.id, profile: recoveredProfile, idea: item.idea };
            savePendingDirectorJob(pending);
            resumedPendingJobRef.current = true;
            setPendingJob(pending);
            return resumePlan(pending);
        }
        setPlan(null);
        if (item.status !== "completed") {
            message.info(item.error?.message || (item.status === "cancelled" ? "这次规划已取消" : "这次规划尚未交付"));
            return;
        }
        setHistoryLoading(true);
        try {
            const job = await getManagedJob(item.id);
            const text = String(job.artifacts?.find((artifact) => artifact.text)?.text || "").trim();
            if (!text) throw new Error("这条记录缺少可恢复的导演方案");
            const parsed = parseDirectorPlan(text);
            setPlan(recoveredProfile === "auto" ? parsed : { ...parsed, profile: recoveredProfile });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "导演方案恢复失败");
        } finally {
            setHistoryLoading(false);
        }
    };

    const retryHistoryJob = async (item: DirectorHistoryJob) => {
        if (planning || pendingJob) return;
        const recoveredProfile = PROFILE_OPTIONS.some((option) => option.value === item.profile) ? (item.profile as PendingDirectorJob["profile"]) : "auto";
        setPlanning(true);
        setPlanningStage("正在重新提交失败的导演任务");
        try {
            const job = await retryManagedJob(item.id);
            const pending = { jobId: job.id, profile: recoveredProfile, idea: item.idea };
            savePendingDirectorJob(pending);
            resumedPendingJobRef.current = true;
            setPendingJob(pending);
            setIdea(item.idea);
            setProfile(recoveredProfile);
            await waitForPlan(pending, new AbortController().signal);
        } catch (error) {
            setPlanningStage("");
            await loadHistory();
            message.error(error instanceof Error ? error.message : "导演任务重试失败");
        } finally {
            setPlanning(false);
        }
    };

    const startNewPlan = () => {
        if (pendingJob) return message.info("请先完成当前待恢复的导演任务");
        setSelectedHistoryJobId("");
        setIdea("");
        setProfile("auto");
        setPlan(null);
        setPlanningStage("");
        setHistoryOpen(false);
    };

    const createPlan = async () => {
        if (pendingJob) {
            message.info("正在恢复上一笔导演任务，本次不会重复提交当前输入");
            return resumePlan(pendingJob);
        }
        const input = idea.trim();
        if (!input) return message.warning("请先描述你想制作的漫剧");
        const controller = new AbortController();
        planningControllerRef.current = controller;
        setPlanning(true);
        setPlanningStage("正在提交导演任务");
        try {
            const job = await createManagedJob(
                {
                    model,
                    capability: "text",
                    mode: "chat",
                    prompt: directorSystemPrompt(input, profile),
                    trace: { workflowKind: "director.workflow", skillId: "seedance-director-workflow", skillVersion: "1", inputSnapshot: { idea: input, profile } },
                },
                { signal: controller.signal },
            );
            const pending = { jobId: job.id, profile, idea: input };
            savePendingDirectorJob(pending);
            resumedPendingJobRef.current = true;
            setPendingJob(pending);
            await waitForPlan(pending, controller.signal);
        } catch (error) {
            if (controller.signal.aborted) return;
            savePendingDirectorJob(null);
            setPendingJob(null);
            setPlanningStage("");
            message.error(error instanceof Error ? error.message : "导演规划失败");
        } finally {
            if (planningControllerRef.current === controller) planningControllerRef.current = null;
            if (!controller.signal.aborted) setPlanning(false);
        }
    };

    const transfer = async () => {
        if (!plan || !projectId) return;
        setTransferring(true);
        try {
            const canvas = await getCanvas(projectId);
            const created = buildDirectorWorkflow(plan, directorWorkflowOrigin(canvas.nodes));
            const saved = await saveCanvas(projectId, createCanvasDraft([...canvas.nodes, ...created.nodes], [...canvas.edges, ...created.connections], canvas.viewport, canvas.settings), canvas.revision);
            message.success(`已向画布添加 ${created.nodes.length} 个节点`);
            navigate(`/canvas/${saved.projectId}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "转移到画布失败");
        } finally {
            setTransferring(false);
        }
    };

    return (
        <main className="h-full overflow-y-auto bg-[#f4f1ea] text-stone-950 dark:bg-[#11100f] dark:text-stone-100">
            <div className="mx-auto max-w-[1780px] px-4 pt-4 xl:hidden">
                <Button icon={<History className="size-4" />} onClick={() => setHistoryOpen(true)}>生成记录</Button>
            </div>
            <div className={`mx-auto grid min-h-full max-w-[1780px] gap-5 px-4 py-6 lg:grid-cols-[0.92fr_1.08fr] lg:px-8 lg:py-8 ${historyCollapsed ? "xl:grid-cols-[52px_minmax(0,.92fr)_minmax(0,1.08fr)]" : "xl:grid-cols-[260px_minmax(0,.92fr)_minmax(0,1.08fr)]"}`}>
                <aside className="hidden min-h-[620px] xl:block">
                    {historyCollapsed ? (
                        <Button className="!h-12 !w-12" icon={<PanelLeftOpen className="size-4" />} aria-label="展开生成记录" onClick={() => setHistoryCollapsed(false)} />
                    ) : (
                        <DirectorHistoryPanel
                            items={history}
                            loading={historyLoading}
                            selectedId={selectedHistoryJobId || pendingJob?.jobId || ""}
                            disabled={planning || Boolean(pendingJob)}
                            onSelect={(item) => void openHistoryJob(item)}
                            onRetry={(item) => void retryHistoryJob(item)}
                            onRefresh={() => void loadHistory()}
                            onNew={startNewPlan}
                            onCollapse={() => setHistoryCollapsed(true)}
                        />
                    )}
                </aside>
                <section className="relative overflow-hidden rounded-[28px] border border-stone-300/70 bg-[#171513] p-6 text-stone-100 shadow-[0_28px_80px_rgba(62,45,27,.16)] dark:border-stone-800 lg:p-9">
                    <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-amber-400/10 blur-3xl" />
                    <div className="relative flex h-full min-h-[620px] flex-col">
                        <div className="flex items-center gap-3">
                            <span className="grid size-11 place-items-center rounded-2xl border border-amber-300/30 bg-amber-300/10 text-amber-200">
                                <Clapperboard className="size-5" />
                            </span>
                            <div>
                                <p className="text-xs tracking-[.22em] text-amber-200/70">SHOUSHOU DIRECTOR</p>
                                <h1 className="mt-1 text-2xl font-semibold tracking-tight">AI 漫剧导演台</h1>
                            </div>
                        </div>

                        <div className="mt-10 max-w-xl">
                            <h2 className="text-[clamp(2rem,5vw,4.5rem)] font-semibold leading-[.98] tracking-[-.055em]">从一个想法，搭出一条能执行的制作线。</h2>
                            <p className="mt-5 max-w-lg text-sm leading-7 text-stone-400">导演台只负责规划和搭建，不会自动启动收费生成。确认后，它会把现有漫剧节点、创作要求和连线一次性放进你的画布。</p>
                        </div>

                        <label className="mt-10 block text-xs font-medium tracking-wide text-stone-400">你想制作什么</label>
                        <Input.TextArea
                            value={idea}
                            onChange={(event) => {
                                setIdea(event.target.value);
                                setPlan(null);
                                setSelectedHistoryJobId("");
                            }}
                            disabled={Boolean(pendingJob) || planning || recoveringPendingJob}
                            autoSize={{ minRows: 8, maxRows: 16 }}
                            maxLength={12_000}
                            showCount
                            placeholder="例如：一名失去记忆的女剑客，在雨夜客栈认出追杀自己的旧部。需要三段连续镜头，重点表现试探、认出和拔剑前的停顿……"
                            className="director-idea-input mt-2 !border-stone-700 !bg-stone-950/50 !text-base !leading-7 !text-stone-100 placeholder:!text-stone-600"
                        />

                        <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                            <label className="block">
                                <span className="mb-2 block text-xs font-medium tracking-wide text-stone-400">工作流规模</span>
                                <Select className="w-full" value={profile} disabled={Boolean(pendingJob) || planning || recoveringPendingJob} options={PROFILE_OPTIONS.map(({ value, label }) => ({ value, label }))} onChange={(value) => {
                                    setProfile(value);
                                    setPlan(null);
                                    setSelectedHistoryJobId("");
                                }} />
                                <span className="mt-2 block text-xs text-stone-500">{selectedProfile.description}</span>
                            </label>
                            <Button
                                type="primary"
                                size="large"
                                icon={planning ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                                disabled={planning || recoveringPendingJob || (!pendingJob && !idea.trim()) || !directorSettings?.enabled}
                                onClick={() => void createPlan()}
                            >
                                {planning
                                    ? planningStage.includes("核对")
                                        ? "正在核费"
                                        : "正在规划"
                                    : recoveringPendingJob
                                      ? "检查未完成任务"
                                      : pendingJob
                                        ? "继续检查规划"
                                        : "生成工作流"}
                            </Button>
                        </div>

                        {planningStage ? (
                            <div className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-5 ${planningStage.includes("核对") ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : "border-stone-700 bg-stone-900/60 text-stone-400"}`}>
                                {planningStage}
                            </div>
                        ) : null}

                        <div className="mt-auto flex items-center gap-2 pt-10 text-xs text-stone-500">
                            <CheckCircle2 className={`size-4 ${directorSettings?.enabled ? "text-emerald-400" : "text-stone-600"}`} />
                            {!directorSettings ? "正在读取导演台设置" : directorSettings.enabled ? `导演台文字模型：${directorSettings.modelDisplayName || modelOptionLabel(config, model)}` : "导演台已由管理员停用"}
                        </div>
                    </div>
                </section>

                <section className="rounded-[28px] border border-stone-300/70 bg-white/75 p-5 backdrop-blur dark:border-stone-800 dark:bg-stone-950/60 lg:p-8">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <div className="flex items-center gap-2 text-sm font-semibold">
                                <Workflow className="size-4 text-amber-600" />
                                构建预览
                            </div>
                            <p className="mt-1 text-xs text-stone-500">先确认节点和缺失素材，再写入目标画布。</p>
                        </div>
                        {plan ? <Tag color="gold">{plan.profile === "short" ? "快速短片" : plan.profile === "full" ? "完整制作" : "标准漫剧"}</Tag> : null}
                    </div>

                    {!plan ? (
                        <div className="grid min-h-[560px] place-items-center">
                            <div className="max-w-sm text-center">
                                <span className="mx-auto grid size-16 place-items-center rounded-full border border-dashed border-stone-300 text-stone-400 dark:border-stone-700">
                                    <Film className="size-7" />
                                </span>
                                <h3 className="mt-5 text-lg font-medium">等待导演方案</h3>
                                <p className="mt-2 text-sm leading-6 text-stone-500">输入创意后，系统会生成故事任务、所需节点、节点内容和连接关系。</p>
                            </div>
                        </div>
                    ) : (
                        <div className="mt-7 space-y-7">
                            <div>
                                <p className="text-2xl font-semibold tracking-tight">{plan.title}</p>
                                <p className="mt-2 text-sm leading-6 text-stone-500">{plan.synopsis}</p>
                            </div>

                            <div>
                                <p className="mb-3 text-xs font-semibold tracking-[.16em] text-stone-400">将创建 {nodeKeys.length} 个节点</p>
                                <div className="flex flex-wrap items-center gap-2">
                                    {nodeKeys.map((key, index) => (
                                        <div key={key} className="flex items-center gap-2">
                                            <span className="rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-xs dark:border-stone-800 dark:bg-stone-900">{NODE_NAMES[key] || key}</span>
                                            {index < nodeKeys.length - 1 ? <ArrowRight className="size-3 text-stone-300 dark:text-stone-700" /> : null}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <PreviewBlock title="故事目标" content={plan.story} />
                            <PreviewBlock title="分镜与接续" content={plan.storyboard} />
                            <PreviewBlock title="Seedance 导演要求" content={plan.seedance} />

                            {plan.missingMaterials.length ? (
                                <div className="rounded-2xl border border-amber-300/60 bg-amber-50 p-4 dark:border-amber-900/70 dark:bg-amber-950/20">
                                    <p className="text-sm font-medium text-amber-900 dark:text-amber-200">需要补充的素材</p>
                                    <ul className="mt-2 space-y-1 text-sm leading-6 text-amber-800/80 dark:text-amber-300/80">
                                        {plan.missingMaterials.map((item) => (
                                            <li key={item}>· {item}</li>
                                        ))}
                                    </ul>
                                </div>
                            ) : null}

                            <div className="border-t border-stone-200 pt-5 dark:border-stone-800">
                                <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                                    <label>
                                        <span className="mb-2 block text-xs font-medium text-stone-500">目标画布</span>
                                        <Select className="w-full" value={projectId || undefined} placeholder="选择画布" options={projects.map((project) => ({ value: project.projectId, label: project.projectTitle }))} onChange={setProjectId} />
                                    </label>
                                    <Button type="primary" size="large" loading={transferring} disabled={!projectId} icon={<Workflow className="size-4" />} onClick={() => void transfer()}>
                                        转移到画布
                                    </Button>
                                </div>
                                <p className="mt-3 text-xs text-stone-400">只追加节点和连线，不覆盖画布原有内容；转移后不会自动执行生成任务。</p>
                            </div>
                        </div>
                    )}
                </section>
            </div>
            <Drawer title="生成记录" placement="left" width={320} open={historyOpen} onClose={() => setHistoryOpen(false)}>
                <DirectorHistoryPanel
                    items={history}
                    loading={historyLoading}
                    selectedId={selectedHistoryJobId || pendingJob?.jobId || ""}
                    disabled={planning || Boolean(pendingJob)}
                    onSelect={(item) => void openHistoryJob(item)}
                    onRetry={(item) => void retryHistoryJob(item)}
                    onRefresh={() => void loadHistory()}
                    onNew={startNewPlan}
                />
            </Drawer>
        </main>
    );
}

function DirectorHistoryPanel({ items, loading, selectedId, disabled, onSelect, onRetry, onRefresh, onNew, onCollapse }: {
    items: DirectorHistoryJob[];
    loading: boolean;
    selectedId: string;
    disabled: boolean;
    onSelect: (item: DirectorHistoryJob) => void;
    onRetry: (item: DirectorHistoryJob) => void;
    onRefresh: () => void;
    onNew: () => void;
    onCollapse?: () => void;
}) {
    return (
        <div className="flex h-full min-h-[620px] flex-col rounded-[24px] border border-stone-300/70 bg-white/70 p-3 dark:border-stone-800 dark:bg-stone-950/60">
            <div className="flex items-center justify-between gap-2 px-1 pb-3">
                <div>
                    <p className="text-sm font-semibold">生成记录</p>
                    <p className="mt-0.5 text-[11px] text-stone-500">打开记录不会重复扣费</p>
                </div>
                <div className="flex items-center gap-1">
                    <Button type="text" size="small" icon={<RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />} aria-label="刷新记录" onClick={onRefresh} />
                    {onCollapse ? <Button type="text" size="small" icon={<PanelLeftClose className="size-4" />} aria-label="收起生成记录" onClick={onCollapse} /> : null}
                </div>
            </div>
            <Button className="mb-3" icon={<Plus className="size-4" />} disabled={disabled} onClick={onNew}>新建导演方案</Button>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {!items.length && !loading ? <p className="px-2 py-8 text-center text-xs text-stone-400">还没有生成记录</p> : null}
                {items.map((item) => {
                    const status = directorHistoryStatus(item.status);
                    return (
                        <div key={item.id} className={`rounded-xl border p-3 transition ${selectedId === item.id ? "border-amber-400/70 bg-amber-50/70 dark:bg-amber-950/20" : "border-stone-200 bg-white/60 hover:border-stone-300 dark:border-stone-800 dark:bg-stone-900/50 dark:hover:border-stone-700"}`}>
                            <button type="button" className="block w-full text-left disabled:cursor-not-allowed disabled:opacity-60" disabled={disabled && selectedId !== item.id} onClick={() => onSelect(item)}>
                                <span className="line-clamp-2 text-sm font-medium leading-5">{item.idea.trim() || "未命名导演方案"}</span>
                                <span className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                                    <span className={status.className}>{status.label}</span>
                                    <span className="text-stone-400">{formatDirectorHistoryTime(item.createdAt)}</span>
                                </span>
                                {item.error?.message ? <span className="mt-2 line-clamp-2 block text-[11px] leading-4 text-red-500">{item.error.message}</span> : null}
                            </button>
                            {item.status === "failed" && item.retryable ? (
                                <Button className="mt-2 !px-0" type="link" size="small" icon={<RotateCcw className="size-3" />} disabled={disabled} onClick={() => onRetry(item)}>重试</Button>
                            ) : null}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function directorHistoryStatus(status: string) {
    if (status === "completed") return { label: "已完成", className: "text-emerald-600 dark:text-emerald-400" };
    if (status === "failed") return { label: "生成失败", className: "text-red-600 dark:text-red-400" };
    if (status === "cancelled") return { label: "已取消", className: "text-stone-500" };
    if (status === "payment_required") return { label: "待补积分", className: "text-amber-600 dark:text-amber-400" };
    if (status === "billing_pending") return { label: "费用核对中", className: "text-amber-600 dark:text-amber-400" };
    return { label: "生成中", className: "text-sky-600 dark:text-sky-400" };
}

function formatDirectorHistoryTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function PreviewBlock({ title, content }: { title: string; content: string }) {
    return (
        <div>
            <p className="mb-2 text-xs font-semibold tracking-[.16em] text-stone-400">{title}</p>
            <p className="whitespace-pre-wrap rounded-2xl border border-stone-200 bg-stone-50/70 p-4 text-sm leading-7 text-stone-700 dark:border-stone-800 dark:bg-stone-900/70 dark:text-stone-300">{content}</p>
        </div>
    );
}
