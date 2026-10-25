import VerifiedReply from "./verified-reply";
import CreativeDecisionsPanel from "./creative-decisions";
import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Collapse, Input, InputNumber, Select, Modal } from "antd";
import { ArrowUp, History, Plus, Square, X, RefreshCw } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/components/auth/auth-context";
import { useNativeAgentStore } from "@/stores/use-native-agent-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { readAgentDraft, saveAgentDraft } from "./draft-storage";
import { PlatformApiError } from "@/services/api/platform";
import {
    acceptAgentSnapshot,
    createAgentSession,
    listAgentSessions,
    getAgentSession,
    startAgentRun,
    nativeAgentStatus,
    cancelAgentRun,
    reconcileAgentRun,
    resumeAgentRun,
    decideAgentPlan,
    closeAgentSession,
    readAgentEvents,
    type AgentSnapshot,
    type AgentSession,
    type AgentApproval,
    type AgentMode,
    type AgentTaskPresentation,
} from "@/services/api/native-agent";
import { agentPanelLayout } from "@/lib/canvas/native-agent-view";
import type { AgentCanvasDiff } from "@/stores/use-native-agent-store";
import TaskPresentation from "./task-presentation";
const friendlyError = (e: unknown) =>
    e instanceof PlatformApiError
        ? /BUDGET|TOKEN|CONTEXT|ROUND|LIMIT/.test(e.code)
            ? "本次任务达到已批准的执行或费用上限，完成的步骤会保留。请确认新的预算后继续。"
            : /CREDIT|BALANCE/.test(e.code)
              ? "积分余额不足，请先检查余额；尚未发起新的调用。"
              : /BILLING|UNKNOWN|RECEIPT|UNCONFIRMED/.test(e.code)
                ? "原请求的结果或费用仍需核查，请先查询原操作，不要重复提交。"
                : e.status === 401
                  ? "登录已过期，请重新登录。"
                  : e.status === 403
                    ? "当前没有操作权限，请检查项目和资料访问权限。"
                    : e.status === 409
                      ? "内容或计划已变化，请重新查询并确认；未覆盖你的草稿。"
                      : e.status === 404
                        ? "所需内容已无法访问，请重新选择。"
                        : "操作暂未完成，请重新查询状态；结果未确认前不要新建重复请求。"
        : e instanceof Error && /当前画布有未保存内容或冲突/.test(e.message)
          ? "本页有未保存内容或冲突，暂未载入服务器结果。请先保留草稿或查看差异。"
          : e instanceof Error && /网络|连接|草稿|审批|请求回执/.test(e.message)
            ? e.message
            : "连接或操作暂未完成，请重新查询；本地输入和原操作记录仍保留。";
export default function NativeAgentPanel() {
    const { user, workspace } = useAuth(),
        { search, pathname } = useLocation(),
        { message } = App.useApp();
    const projectId = /^\/canvas\/([^/]+)/.exec(pathname)?.[1] || new URLSearchParams(search).get("project") || workspace.projectId;
    const width = useNativeAgentStore((s) => s.width),
        toggle = useNativeAgentStore((s) => s.toggle),
        setWidth = useNativeAgentStore((s) => s.setWidth);
    const bridge = useNativeAgentStore((s) => s.bridge),
        theme = canvasThemes[useThemeStore((s) => s.theme)];
    const [readyKey, setReadyKey] = useState(""),
        [sessions, setSessions] = useState<AgentSession[]>([]),
        [sessionId, setSessionId] = useState(""),
        [snapshot, setSnapshot] = useState<AgentSnapshot | null>(null),
        [draft, setDraft] = useState(""),
        [mode, setMode] = useState<AgentMode>("advice"),
        [models, setModels] = useState<{ id: string; name: string }[]>([]),
        [modelId, setModelId] = useState(""),
        [error, setError] = useState(""),
        [busy, setBusy] = useState(false),
        [saved, setSaved] = useState<{ runId: string; projectId: string; revision: number; nodeIds: string[] } | null>(null);
    const [budgetCents, setBudgetCents] = useState(0);
    const [modelSelectionEnabled, setModelSelectionEnabled] = useState(true),
        [maxBudgetCents, setMaxBudgetCents] = useState<number | null>(null);
    const [viewportWidth, setViewportWidth] = useState(window.innerWidth),
        [diff, setDiff] = useState<AgentCanvasDiff | null>(null),
        [resumeOpen, setResumeOpen] = useState(false),
        [resumeModel, setResumeModel] = useState(""),
        [resumeBudget, setResumeBudget] = useState(0),
        [syncFeedback, setSyncFeedback] = useState("");
    const syncAttempt = useRef(""),
        resumeOperation = useRef("");
    const [limits, setLimits] = useState<Record<string, number>>({}),
        [limitsHash, setLimitsHash] = useState(""),
        [newContent, setNewContent] = useState(false);
    const [freshReplies, setFreshReplies] = useState<string[]>([]);
    const [accessDenied, setAccessDenied] = useState(false);
    const selectedProject = useRef(projectId);
    selectedProject.current = projectId;
    const reportError = (e: unknown) => {
        if (selectedProject.current !== projectId || (sessionId && selectedSession.current !== sessionId)) return;
        setError(friendlyError(e));
        if (e instanceof PlatformApiError && [401, 403, 404].includes(e.status)) {
            setAccessDenied(true);
            setSnapshot(null);
            setSaved(null);
        }
    };
    const scrollPane = useRef<HTMLElement | null>(null),
        followTail = useRef(true);
    const panelLayout = agentPanelLayout(width, viewportWidth);
    useEffect(() => {
        const resized = () => setViewportWidth(window.innerWidth);
        window.addEventListener("resize", resized);
        return () => window.removeEventListener("resize", resized);
    }, []);

    const paidModel = !!modelId && modelId !== "native-agent-fixture";
    const [connectionVersion, setConnectionVersion] = useState(0);
    const cursors = useRef(new Map<string, number>());
    const pending = useRef<{ operationId: string; sessionOperationId: string; prompt: string; sessionId: string; mode: AgentMode; modelId: string; budgetCents: number; conversationVersion?: 1 } | null>(null),
        decisions = useRef(new Map<string, { operationId: string; decision: string; instruction?: string }>()),
        generation = useRef(0),
        bottom = useRef<HTMLDivElement>(null);
    const preferredMode = useRef<{ sessionId: string; mode: AgentMode } | null>(null);
    const selectedSession = useRef(sessionId);
    selectedSession.current = sessionId;
    const key = `native-agent:${user.id}:${projectId}`;
    const restoringSession = !!sessionId && !snapshot && !accessDenied;
    const latest = snapshot?.runs.at(-1),
        active = latest && !["completed", "failed", "cancelled"].includes(latest.status);
    const latestTask = snapshot?.presentation?.tasks.find((t) => t.runId === latest?.id);
    const progressVersion = latestTask?.progressItems.map((p) => p.key + ":" + p.status).join("|") ?? "";
    useEffect(() => {
        if (!saved || bridge?.projectId !== saved.projectId) return;
        const key = saved.projectId + ":" + saved.revision;
        if (syncAttempt.current === key) return;
        syncAttempt.current = key;
        let cancelled = false;
        void bridge
            .sync()
            .then((result) => {
                if (!cancelled) setSyncFeedback("本页已载入保存结果");
            })
            .catch((e) => {
                if (!cancelled) setSyncFeedback("服务器已保存；本页尚未同步，请先保留草稿再重新载入。");
            });
        return () => {
            cancelled = true;
        };
    }, [saved?.revision, saved?.projectId, bridge]);
    const refresh = async () => {
        const current = generation.current;
        if (sessionId) {
            const next = await getAgentSession(sessionId);
            if (generation.current === current && selectedSession.current === sessionId) {
                setAccessDenied(false);
                setSnapshot((previous) => acceptAgentSnapshot(previous, next));
            }
        }
    };
    useEffect(() => {
        const request = ++generation.current,
            controller = new AbortController();
        setReadyKey("");
        setSnapshot(null);
        setSessions([]);
        setModels([]);
        setBusy(false);
        setSessionId("");
        setDraft("");
        setSaved(null);
        setSyncFeedback("");
        syncAttempt.current = "";
        setError("");
        pending.current = null;
        void Promise.all([listAgentSessions(projectId, controller.signal), nativeAgentStatus(controller.signal), readAgentDraft<{ sessionId: string; mode?: AgentMode; draft: string; pending: typeof pending.current }>(key)])
            .then(([items, status, local]) => {
                if (generation.current !== request) return;
                setAccessDenied(false);
                setSessions(items);
                setModels(status.models);
                setLimits(status.limits);
                setLimitsHash(status.limitsHash);
                setModelId(status.defaultModelId ?? status.models[0]?.id ?? "");
                setModelSelectionEnabled(status.userModelSelectionEnabled ?? true);
                setMaxBudgetCents(status.maxBudgetCents ?? null);
                if (status.maxBudgetCents != null) setBudgetCents(status.maxBudgetCents);
                preferredMode.current = local && (local.mode === "execute" || local.mode === "advice") ? { sessionId: local.sessionId, mode: local.mode } : null;
                setMode(preferredMode.current?.mode ?? "advice");
                setDraft(local?.draft || "");
                pending.current = local?.pending || null;
                setReadyKey(key);
                const id = items.some((s) => s.id === local?.sessionId) ? local!.sessionId : items.find((s) => !s.closed_at)?.id || "";
                setSessionId(id);
            })
            .catch((e) => {
                if (!controller.signal.aborted) reportError(e);
            });
        return () => {
            controller.abort();
            generation.current++;
        };
    }, [key, projectId]);
    useEffect(() => {
        if (!sessionId) return;
        const controller = new AbortController();
        setSnapshot(null);
        setFreshReplies([]);
        setSaved(null);
        setSyncFeedback("");
        syncAttempt.current = "";
        cursors.current.clear();
        void getAgentSession(sessionId, controller.signal)
            .then((next) => {
                if (!controller.signal.aborted) {
                    setAccessDenied(false);
                    setSnapshot((previous) => acceptAgentSnapshot(previous, next));
                    setMode(preferredMode.current?.sessionId === sessionId ? preferredMode.current.mode : next.runs.at(-1)?.mode ?? next.session.mode);
                    setSessions((items) => (items.some((item) => item.id === next.session.id) ? items : [next.session, ...items]));
                }
            })
            .catch((e) => {
                if (!controller.signal.aborted) reportError(e);
            });
        return () => controller.abort();
    }, [sessionId]);
    useEffect(() => {
        const op = pending.current;
        if (!op || !snapshot?.runs.some((r) => r.operation_id === op.operationId)) return;
        pending.current = null;
        setDraft((text) => (text === op.prompt ? "" : text));
        void saveAgentDraft(key, { sessionId, mode, draft: draft === op.prompt ? "" : draft, pending: null }).catch((e) => reportError(e));
    }, [snapshot, key, sessionId, draft]);
    useEffect(() => {
        if (readyKey !== key || (!sessionId && !draft)) return;
        void saveAgentDraft(key, { sessionId, mode, draft, pending: pending.current }).catch((e) => reportError(e));
    }, [key, readyKey, sessionId, draft, mode]);
    useEffect(() => {
        if (!latest) return;
        const controller = new AbortController(),
            runId = latest.id;
        let cursor = cursors.current.get(runId) || 0,
            timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            try {
                const events = await readAgentEvents(runId, cursor, controller.signal);
                if (controller.signal.aborted) return;
                for (const e of events) {
                    cursor = Math.max(cursor, e.id);
                    if (e.type === "canvas.saved")
                        setSaved((previous) => ({ runId: e.run_id, projectId, revision: Number(e.data.revision), nodeIds: [...new Set([...(previous?.runId === e.run_id ? previous.nodeIds : []), ...((e.data.nodeIds || []) as string[])])] }));
                }
                cursors.current.set(runId, cursor);
                const verified = events.filter((e) => e.type === "conversation.message" && e.data.verified === true).map((e) => String((e.data.message as { item_id: string }).item_id));
                if (verified.length) setFreshReplies((prior) => [...new Set([...prior, ...verified])]);
                let status = latest.status;
                {
                    const next = await getAgentSession(sessionId, controller.signal);
                    if (controller.signal.aborted) return;
                    setSnapshot((previous) => acceptAgentSnapshot(previous, next));
                    status = next.runs.find((r) => r.id === runId)?.status || status;
                }
                if (["completed", "failed", "cancelled"].includes(status)) return;
                if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 1000);
            } catch (e) {
                if (!controller.signal.aborted) {
                    reportError(e);
                    if (e instanceof PlatformApiError && [401, 403, 404].includes(e.status)) {
                        setSnapshot(null);
                        setSaved(null);
                    }
                }
            }
        };
        void poll();
        return () => {
            controller.abort();
            clearTimeout(timer);
        };
    }, [latest?.id, sessionId, projectId, connectionVersion]);
    useEffect(() => {
        const pane = scrollPane.current;
        if (!pane) return;
        if (followTail.current) {
            pane.scrollTop = pane.scrollHeight;
            setNewContent(false);
        } else setNewContent(true);
    }, [snapshot?.messages.length, latest?.status, progressVersion]);
    const submit = async () => {
        if (readyKey !== key || restoringSession || accessDenied || active || snapshot?.session.closed_at || !draft.trim() || !modelId || (paidModel && budgetCents <= 0) || busy) return;
        setBusy(true);
        setError("");
        const current = generation.current;
        try {
            const op = pending.current ?? { operationId: crypto.randomUUID(), sessionOperationId: crypto.randomUUID(), prompt: draft, sessionId, mode, modelId, budgetCents: paidModel ? budgetCents : 0, conversationVersion: 1 as const };
            pending.current = op;
            await saveAgentDraft(key, { sessionId, mode: op.mode, draft: op.prompt, pending: op });
            const id = op.sessionId || (await createAgentSession(projectId, op.mode, op.sessionOperationId)).id;
            op.sessionId = id;
            await saveAgentDraft(key, { sessionId: id, mode: op.mode, draft: op.prompt, pending: op });
            if (generation.current === current) setSessionId(id);
            const run = await startAgentRun(id, op.prompt, op.modelId, op.mode, op.operationId, op.budgetCents ?? 0, op.conversationVersion);
            if (generation.current !== current) return;
            pending.current = null;
            setSessionId(id);
            setDraft("");
            const [next, items] = await Promise.all([getAgentSession(id), listAgentSessions(projectId)]);
            if (generation.current !== current) return;
            setSnapshot((previous) => acceptAgentSnapshot(previous, next));
            setSessions(items);
            await saveAgentDraft(key, { sessionId: id, mode: op.mode, draft: "", pending: null });
            if (run.status === "awaiting_manual_review") setError("上次请求还没有确认结果，请先查询进度，不要重复创建任务");
        } catch (e) {
            if (generation.current === current) {
                reportError(e);
                setError(friendlyError(e) + "。重试会查询同一个操作，不会创建新的任务。");
            }
        } finally {
            if (generation.current === current) setBusy(false);
        }
    };
    const decide = async (a: AgentApproval, decision: "approve" | "revise" | "cancel", instruction?: string) => {
        setBusy(true);
        setError("");
        const current = generation.current;
        try {
            const existing = decisions.current.get(a.id);
            if (existing && (existing.decision !== decision || existing.instruction !== instruction)) throw new Error("上一审批请求回执未确认，请先按原决定重试或重新查询状态");
            const op = existing ?? { operationId: crypto.randomUUID(), decision, instruction };
            decisions.current.set(a.id, op);
            await decideAgentPlan(a, decision, op.operationId, instruction);
            decisions.current.delete(a.id);
            if (generation.current === current) await refresh();
        } catch (e) {
            if (generation.current === current) reportError(e);
        } finally {
            if (generation.current === current) setBusy(false);
        }
    };
    const resize = (event: React.PointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const x = event.clientX,
            initial = width;
        event.currentTarget.setPointerCapture(event.pointerId);
        const target = event.currentTarget;
        const move = (e: PointerEvent) => setWidth(Math.min(760, Math.max(360, initial + x - e.clientX)));
        const up = () => {
            target.removeEventListener("pointermove", move);
            target.removeEventListener("pointerup", up);
            target.removeEventListener("pointercancel", up);
        };
        target.addEventListener("pointermove", move);
        target.addEventListener("pointerup", up);
        target.addEventListener("pointercancel", up);
    };
    const focusResult = (ids: string[]) => {
        const current = generation.current,
            target = bridge;
        if (!target || target.projectId !== projectId) return;
        void target
            .sync()
            .then(() => {
                if (generation.current === current && selectedSession.current === sessionId && useNativeAgentStore.getState().bridge === target) target.focus(ids);
            })
            .catch((e) => {
                if (generation.current === current) reportError(e);
            });
    };
    return (
        <aside
            aria-label="原生创作助手面板"
            data-canvas-shortcuts-ignore
            className={(panelLayout.overlay ? "fixed inset-y-0 right-0 z-[85] " : "relative shrink-0 ") + "flex max-w-full flex-col border-l bg-background"}
            style={{ width: panelLayout.width, background: theme.node.panel, color: theme.node.text, borderColor: theme.node.stroke }}
        >
            <button aria-label="调整助手面板宽度" className={"absolute inset-y-0 left-0 w-2 -translate-x-1/2 cursor-col-resize " + (panelLayout.overlay ? "hidden" : "")} onPointerDown={resize} />
            <header className="flex items-center justify-between px-5 py-4">
                <div>
                    <h2 className="font-semibold">创作助手</h2>
                    <p className="mt-1 text-xs text-muted-foreground">读取资料 · 制定计划 · 确认后执行</p>
                </div>
                <Button type="text" icon={<X size={18} />} aria-label="关闭助手" onClick={toggle} />
            </header>
            <div className="flex gap-2 px-5 pb-3">
                <Select
                    aria-label="历史会话"
                    className="min-w-0 flex-1"
                    placeholder="新会话"
                    value={sessionId || undefined}
                    suffixIcon={<History size={14} />}
                    options={sessions.map((s) => ({ value: s.id, label: s.title + (s.closed_at ? "（已结束）" : "") }))}
                    onChange={(id) => {
                        if (pending.current) {
                            setError("上次操作还没有确认结果，请先查询进度");
                            return;
                        }
                        setSessionId(id);
                    }}
                />
                <Button
                    type="text"
                    aria-label="新建会话"
                    icon={<Plus size={17} />}
                    onClick={() => {
                        if (draft || pending.current) {
                            setError("请先处理当前输入草稿或未确认请求");
                            return;
                        }
                        setSessionId("");
                        setSnapshot(null);
                        setSaved(null);
                    }}
                />
            </div>
            <div className="px-5 pb-3 text-xs text-muted-foreground">当前项目 · {workspace.projectId === projectId ? workspace.projectTitle : "所选画布"}</div>
            <main
                ref={scrollPane}
                onScroll={(event) => {
                    const p = event.currentTarget;
                    followTail.current = p.scrollHeight - p.scrollTop - p.clientHeight < 64;
                }}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5"
                aria-live="polite"
            >
                {error && (
                    <Alert
                        type="error"
                        showIcon
                        title={error}
                        action={
                            <Button
                                size="small"
                                onClick={() =>
                                    void refresh()
                                        .then(() => {
                                            setError("");
                                            setConnectionVersion((v) => v + 1);
                                        })
                                        .catch((e) => reportError(e))
                                }
                            >
                                重新查询
                            </Button>
                        }
                    />
                )}
                {restoringSession && (
                    <p className="py-5 text-sm text-muted-foreground" role="status">
                        正在载入会话记录…
                    </p>
                )}
                {(!sessionId || snapshot?.messages.length === 0) && (
                    <div className="py-12">
                        <h3 className="text-lg font-medium">一起讨论你的作品</h3>
                        <p className="mt-3 text-sm leading-7 text-muted-foreground">可以聊剧情、比较方案，或让助手阅读已有设定再给建议。只有你明确要求修改时，才会准备写入计划并请你确认。</p>
                        <Button type="text" className="mt-4 !h-auto !whitespace-normal !px-0 !text-left" onClick={() => setDraft("根据雾港世界观、林岚和周可的人物设定，帮我搭建第一集漫剧的剧本创作流程。")}>
                            搭建第一集漫剧创作流程
                        </Button>
                    </div>
                )}
                {snapshot?.messages.map((m, index) => {
                    const historicalTask = snapshot.presentation?.tasks.find((t) => t.runId === m.run_id);
                    const atEnd = snapshot.messages[index + 1]?.run_id !== m.run_id;
                    return (
                        <div key={`${sessionId}:${m.turn_id}:${m.item_id}`}>
                            <article className="py-4">
                                <div className="mb-2 text-xs text-muted-foreground">{m.role === "user" ? "你" : "创作助手"}</div>
                                {m.role === "assistant" ? <VerifiedReply text={m.content} animate={freshReplies.includes(m.item_id)} /> : <div className="whitespace-pre-wrap break-words text-sm leading-7">{m.content}</div>}
                            </article>
                            {atEnd && historicalTask?.result && historicalTask.runId !== latest?.id && <TaskPresentation task={historicalTask} canFocus={bridge?.projectId === projectId} onFocus={focusResult} />}
                        </div>
                    );
                })}
                {latestTask && (latestTask.plan || latestTask.result || latestTask.progressItems.length > 0 || latestTask.safeErrorMessage || latestTask.status !== "completed") && (
                    <TaskPresentation task={latestTask} canFocus={bridge?.projectId === projectId} onFocus={focusResult} />
                )}
                {latest?.status === "paused" && latest.error_code !== "AGENT_CONVERSATION_INVALID" && (
                    <Button
                        type="text"
                        onClick={() => {
                            setResumeModel(latest.model_id);
                            setResumeBudget(0);
                            resumeOperation.current = crypto.randomUUID();
                            setResumeOpen(true);
                        }}
                    >
                        {latest.error_code === "AGENT_INVALID_TOOL_ARGUMENTS" || latest.error_code === "AGENT_TOOL_SCOPE_MISMATCH" ? "修正调用后继续 / 选择模型" : "继续剩余计划 / 选择模型"}
                    </Button>
                )}
                {latest?.error_message && !["completed", "cancelled"].includes(latest.status) && <Alert type="warning" title={latest.error_message} showIcon />}
                {latest?.status === "paused" && <Button disabled={busy} onClick={() => {
                    const run = latest, selected = sessionId;
                    setBusy(true);
                    void cancelAgentRun(run.id).then(async () => {
                        if (selectedProject.current !== projectId || selectedSession.current !== selected) return;
                        await refresh();
                        if (selectedProject.current !== projectId || selectedSession.current !== selected) return;
                        if (pending.current?.operationId === run.operation_id) pending.current = null;
                        setDraft((text) => text || snapshot?.messages.filter((m) => m.role === "user").at(-1)?.content || "");
                        preferredMode.current = { sessionId: selected, mode: "execute" };
                        setMode("execute");
                        setError("");
                        message.info("已结束暂停任务并切换执行模式。请确认输入后发送；没有重试或新增模型费用。");
                    }).catch(reportError).finally(() => { if (selectedSession.current === selected) setBusy(false); });
                }}>结束暂停，切换执行模式</Button>}
                {latest && (latest.status === "awaiting_manual_review" || latest.error_code === "AGENT_BILLING_UNCONFIRMED") && (
                    <Button
                        type="text"
                        onClick={() =>
                            void reconcileAgentRun(latest.id)
                                .then(refresh)
                                .then(() => setConnectionVersion((value) => value + 1))
                                .catch((error) => reportError(error))
                        }
                    >
                        核查原模型回执
                    </Button>
                )}

                {!!snapshot?.sources?.filter((s) => s.runId === latest?.id).length && (
                    <Collapse
                        ghost
                        items={[
                            {
                                key: "sources",
                                label: "已使用知识来源",
                                children: (
                                    <ul className="space-y-2 text-xs">
                                        {snapshot.sources
                                            .filter((s) => s.runId === latest?.id)
                                            .map((source, index) => (
                                                <li key={source.documentId + ":" + source.revision + ":" + index}>
                                                    {source.title} · 资料版本 {source.revision}
                                                </li>
                                            ))}
                                    </ul>
                                ),
                            },
                        ]}
                    />
                )}
                {!accessDenied && <CreativeDecisionsPanel key={projectId} projectId={projectId} snapshot={snapshot} />}
                {snapshot?.approvals
                    .filter((a) => a.status === "pending")
                    .map((a) => (
                        <Approval key={a.id} approval={a} plan={snapshot.presentation?.tasks.find((t) => t.runId === a.run_id)?.plan ?? null} busy={busy} onDecide={decide} />
                    ))}
                {saved && (
                    <Collapse
                        ghost
                        items={[
                            {
                                key: "canvas-sync",
                                label: "画布同步与草稿",
                                children: (
                                    <div className="space-y-2 text-xs">
                                        <p className="leading-5 text-muted-foreground">{syncFeedback || "正在核对本页草稿与保存结果"}</p>
                                        <div className="flex flex-wrap gap-2">
                                            <Button
                                                type="text"
                                                size="small"
                                                disabled={bridge?.projectId !== saved.projectId}
                                                onClick={() =>
                                                    void bridge
                                                        ?.sync()
                                                        .then(() => {
                                                            setSyncFeedback("本页已同步保存结果");
                                                            message.success("已载入保存结果");
                                                        })
                                                        .catch((e) => reportError(e))
                                                }
                                            >
                                                同步画布结果
                                            </Button>
                                            <Button
                                                type="text"
                                                size="small"
                                                onClick={() =>
                                                    void bridge
                                                        ?.compare()
                                                        .then(setDiff)
                                                        .catch((e) => reportError(e))
                                                }
                                            >
                                                查看本地与服务器差异
                                            </Button>
                                            <Button
                                                type="text"
                                                size="small"
                                                onClick={() =>
                                                    void bridge
                                                        ?.keepDraft()
                                                        .then(() => message.success("本地草稿已保留，服务器未被覆盖"))
                                                        .catch((e) => reportError(e))
                                                }
                                            >
                                                保留草稿
                                            </Button>
                                        </div>
                                    </div>
                                ),
                            },
                        ]}
                    />
                )}
                {newContent && (
                    <Button
                        type="text"
                        className="sticky bottom-0"
                        onClick={() => {
                            followTail.current = true;
                            if (scrollPane.current) scrollPane.current.scrollTop = scrollPane.current.scrollHeight;
                            setNewContent(false);
                        }}
                    >
                        有新内容 · 回到最新
                    </Button>
                )}
                <div ref={bottom} />
            </main>

            <Modal title="本地草稿与服务器版本" open={!!diff} onCancel={() => setDiff(null)} footer={<Button onClick={() => setDiff(null)}>保留当前编辑并返回</Button>}>
                <p>
                    服务器画布版本 {diff?.revision} · 本页 {diff?.localNodeCount} 节点 / 服务器 {diff?.remoteNodeCount} 节点。
                </p>
                <p className="my-3">查看不会覆盖草稿，也不会自动合并或保存。</p>
                {diff?.addedNodes.map((n) => (
                    <p key={n.id}>服务器新增：{n.title}</p>
                ))}
                {diff?.changedNodes.map((n) => (
                    <p key={n.id}>内容有差异：{n.title}</p>
                ))}
            </Modal>
            <Modal
                title="批准新预算，继续剩余计划"
                open={resumeOpen}
                onCancel={() => setResumeOpen(false)}
                okText="批准预算并续跑"
                confirmLoading={busy}
                onOk={() => {
                    if (!latest || !resumeModel) return;
                    setBusy(true);
                    void resumeAgentRun(latest.id, latest.revision, resumeModel, resumeBudget, resumeOperation.current, limitsHash)
                        .then(refresh)
                        .then(() => {
                            setResumeOpen(false);
                            setConnectionVersion((v) => v + 1);
                        })
                        .catch((e) => reportError(e))
                        .finally(() => setBusy(false));
                }}
            >
                <p className="mb-3">
                    保持原目标和已保存步骤；本次明确增加 {limits.rounds} 轮模型、{limits.tools} 次工具、{limits.totalTokens} Token、{Math.round((limits.activeMs ?? 0) / 60000)}{" "}
                    分钟预算，不重新执行已完成操作。若画布变化，重新规划后需要再次审批；供应商状态不明时不允许续跑。
                </p>
                {(latest?.error_code === "AGENT_INVALID_TOOL_ARGUMENTS" || latest?.error_code === "AGENT_TOOL_SCOPE_MISMATCH") && <p className="mb-3 text-xs text-muted-foreground">上次是工具或参数不匹配，增加积分不能修复。确认后将携带错误反馈重新规划剩余操作，仍消耗模型积分；不会重放已完成写入，实际保存仍须审批。</p>}
                <Select aria-label="续跑模型" className="mb-3 w-full" disabled={!modelSelectionEnabled} value={resumeModel} options={models.map((m) => ({ value: m.id, label: m.name }))} onChange={setResumeModel} />
                <label className="flex items-center gap-2">
                    额外积分预算
                    <InputNumber aria-label="续跑额外预算" min={0} precision={0} step={1} value={resumeBudget} onChange={(v) => setResumeBudget(Math.round(Number(v ?? 0)))} />
                </label>
                <p className="mt-3 text-xs text-muted-foreground">等待核验的预留保留，不将未知费用认定为免费。</p>
            </Modal>
            <footer className="border-t p-4" style={{ borderColor: theme.node.stroke }}>
                <div className="mb-3 flex gap-2">
                    <Select
                        aria-label="执行模式"
                        value={active ? latest.mode : mode}
                        onChange={(value) => { preferredMode.current = { sessionId, mode: value }; setMode(value); }}
                        disabled={!!active || busy || restoringSession}
                        options={[
                            { value: "advice", label: "建议模式" },
                            { value: "execute", label: "执行模式" },
                        ]}
                    />
                    <Select
                        aria-label="助手模型"
                        className="min-w-0 flex-1"
                        value={(active ? latest.model_id : modelId) || undefined}
                        onChange={setModelId}
                        options={models.map((m) => ({ value: m.id, label: m.name }))}
                        placeholder="当前没有可用的助手模型"
                        disabled={!!active || busy || !modelSelectionEnabled}
                    />
                </div>
                {paidModel && (
                    <label className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        本次积分上限
                        <InputNumber
                            aria-label="积分费用预算"
                            min={0}
                            max={maxBudgetCents ?? undefined}
                            precision={0}
                            step={1}
                            value={budgetCents}
                            onChange={(value) => setBudgetCents(Math.round(Number(value ?? 0)))}
                            disabled={!!active || busy || restoringSession}
                        />
                        <span>按实际用量扣除积分，未核验消耗保持预留{maxBudgetCents != null ? `；每次任务最高 ${maxBudgetCents} 积分` : ""}</span>
                    </label>
                )}
                <Input.TextArea
                    aria-label="给创作助手的指令"
                    disabled={readyKey !== key || restoringSession}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    autoSize={{ minRows: 3, maxRows: 8 }}
                    placeholder="描述你想完成的创作任务…"
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            void submit();
                        }
                    }}
                />
                <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Ctrl + Enter 发送 · 写入需确认</span>
                    <Button
                        type="text"
                        icon={<ArrowUp size={17} />}
                        loading={busy}
                        disabled={readyKey !== key || restoringSession || accessDenied || !!active || !draft.trim() || !modelId || (paidModel && budgetCents <= 0) || !!snapshot?.session.closed_at}
                        onClick={() => void submit()}
                    >
                        发送
                    </Button>
                </div>
                {sessionId && !active && (
                    <Button
                        size="small"
                        type="text"
                        disabled={!!snapshot?.session.closed_at}
                        onClick={() =>
                            void closeAgentSession(sessionId)
                                .then(refresh)
                                .catch((e) => reportError(e))
                        }
                    >
                        结束会话
                    </Button>
                )}
            </footer>
        </aside>
    );
}
function Approval({ approval, plan, busy, onDecide }: { approval: AgentApproval; plan: AgentTaskPresentation["plan"]; busy: boolean; onDecide: (a: AgentApproval, d: "approve" | "revise" | "cancel", instruction?: string) => Promise<void> }) {
    const [instruction, setInstruction] = useState("");
    return (
        <section className="my-5 border-y py-5">
            <h3 className="font-medium">请确认执行计划</h3>
            <p className="my-2 text-xs leading-5 text-muted-foreground">仅执行以下参数。资料内容不能改变你的权限或审批范围。</p>
            <ol className="space-y-3 text-sm">
                {plan?.items.map((p, i) => (
                    <li key={p.key}>
                        <p>
                            {i + 1}. {p.title}
                        </p>
                        {p.description && (
                            <details className="mt-1 text-xs text-muted-foreground">
                                <summary className="cursor-pointer py-1">查看内容说明</summary>
                                <p className="max-h-48 overflow-auto whitespace-pre-wrap break-words leading-5">{p.description}</p>
                            </details>
                        )}
                    </li>
                ))}
            </ol>
            {!plan && <p className="my-3 text-sm">这份历史计划暂时无法完整展示，请取消或修改方案后重新确认。</p>}
            {plan && (
                <p className="my-3 text-xs text-muted-foreground">
                    {plan.nodeCount > 0 || plan.edgeCount > 0 ? `预计创建 ${plan.nodeCount} 个节点和 ${plan.edgeCount} 条连线。` : ""}
                    {plan.consequence} 确认只授权此方案，修改后需要重新确认。
                </p>
            )}
            <Input.TextArea className="mt-4" aria-label="计划修改意见" placeholder="需要调整？填写修改意见后重新规划" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
            <div className="mt-3 flex flex-wrap gap-2">
                <Button type="primary" disabled={busy || !plan} onClick={() => void onDecide(approval, "approve")}>
                    {plan && (plan.nodeCount > 0 || plan.edgeCount > 0) ? "确认创建" : "确认执行"}
                </Button>
                <Button type="text" disabled={busy || !instruction.trim()} onClick={() => void onDecide(approval, "revise", instruction)}>
                    修改计划
                </Button>
                <Button type="text" disabled={busy} onClick={() => void onDecide(approval, "cancel")}>
                    取消
                </Button>
            </div>
        </section>
    );
}
