import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Collapse, Input, InputNumber, Select, Tag, Modal } from "antd";
import { ArrowUp, History, Plus, Square, X, RefreshCw } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/components/auth/auth-context";
import { useNativeAgentStore } from "@/stores/use-native-agent-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import localforage from "localforage";
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
} from "@/services/api/native-agent";
import {agentPanelLayout} from "@/lib/canvas/native-agent-view";
import type {AgentCanvasDiff} from "@/stores/use-native-agent-store";
const states: Record<string, string> = { paused:"已暂停",pending: "排队中", planning: "正在分析", running: "正在执行", awaiting_approval: "等待确认", completed: "已完成", failed: "执行失败", cancelled: "已取消", awaiting_manual_review: "结果待核查" };
const tools: Record<string, string> = {
    search_knowledge: "搜索知识",
    read_knowledge: "读取资料",
    get_project_context: "获取项目上下文",
    get_canvas_state: "读取画布版本",
    create_canvas_node: "创建节点",
    connect_canvas_nodes: "连接节点",
    update_canvas_node: "更新节点",
    create_knowledge_document: "创建文档",
    list_canvas_nodes: "读取节点",
    list_knowledge_relations: "查看引用",
    suggest_knowledge_relation: "建议关联",
    apply_knowledge_relation: "建立知识关联",
    get_job_status: "查询任务",
};
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
        [stream, setStream] = useState<Record<string, string>>({}),
        [saved, setSaved] = useState<{ runId: string; projectId: string; revision: number; nodeIds: string[] } | null>(null);
    const [budgetCents, setBudgetCents] = useState(0);
    const [modelSelectionEnabled,setModelSelectionEnabled]=useState(true),[maxBudgetCents,setMaxBudgetCents]=useState<number|null>(null);
    const [viewportWidth,setViewportWidth]=useState(window.innerWidth),[diff,setDiff]=useState<AgentCanvasDiff|null>(null),[resumeOpen,setResumeOpen]=useState(false),[resumeModel,setResumeModel]=useState(''),[resumeBudget,setResumeBudget]=useState(0),[syncFeedback,setSyncFeedback]=useState('');
    const syncAttempt=useRef(''),resumeOperation=useRef('');
    const [limits,setLimits]=useState<Record<string,number>>({}),[limitsHash,setLimitsHash]=useState(''),[newContent,setNewContent]=useState(false);
    const scrollPane=useRef<HTMLElement|null>(null),followTail=useRef(true);
    const panelLayout=agentPanelLayout(width,viewportWidth);
    useEffect(()=>{const resized=()=>setViewportWidth(window.innerWidth);window.addEventListener('resize',resized);return()=>window.removeEventListener('resize',resized);},[]);

    const paidModel = !!modelId && modelId !== "native-agent-fixture";
    const [connectionVersion, setConnectionVersion] = useState(0);
    const cursors = useRef(new Map<string, number>());
    const pending = useRef<{ operationId: string; sessionOperationId: string; prompt: string; sessionId: string; mode: AgentMode; modelId: string; budgetCents: number } | null>(null),
        decisions = useRef(new Map<string, { operationId: string; decision: string; instruction?: string }>()),
        generation = useRef(0),
        bottom = useRef<HTMLDivElement>(null);
    const selectedSession = useRef(sessionId);
    selectedSession.current = sessionId;
    const key = `native-agent:${user.id}:${projectId}`;
    const latest = snapshot?.runs.at(-1),
        active = latest && !["completed", "failed", "cancelled"].includes(latest.status);
    const latestPlan=snapshot?.plans?.filter(p=>p.run_id===latest?.id).at(-1);
    useEffect(()=>{
        if(!saved||bridge?.projectId!==saved.projectId)return;
        const key=saved.projectId+':'+saved.revision;if(syncAttempt.current===key)return;syncAttempt.current=key;
        let cancelled=false;
        void bridge.sync().then(result=>{if(!cancelled)setSyncFeedback('本页已同步到 revision '+result.revision);}).catch(e=>{if(!cancelled)setSyncFeedback('服务器已保存；本页未同步：'+e.message);});
        return()=>{cancelled=true;};
    },[saved?.revision,saved?.projectId,bridge]);
    const refresh = async () => {
        const current = generation.current;
        if (sessionId) {
            const next = await getAgentSession(sessionId);
            if (generation.current === current && selectedSession.current === sessionId) setSnapshot(previous => acceptAgentSnapshot(previous, next));
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
        setStream({});
        setSaved(null);
        setSyncFeedback("");syncAttempt.current="";
        setError("");
        pending.current = null;
        void Promise.all([listAgentSessions(projectId, controller.signal), nativeAgentStatus(controller.signal), localforage.getItem<{ sessionId: string; draft: string; pending: typeof pending.current }>(key)])
            .then(([items, status, local]) => {
                if (generation.current !== request) return;
                setSessions(items);
                setModels(status.models);setLimits(status.limits);setLimitsHash(status.limitsHash);
                setModelId(status.defaultModelId??status.models[0]?.id??'');setModelSelectionEnabled(status.userModelSelectionEnabled??true);setMaxBudgetCents(status.maxBudgetCents??null);if(status.maxBudgetCents!=null)setBudgetCents(status.maxBudgetCents);
                setDraft(local?.draft || "");
                pending.current = local?.pending || null;
                setReadyKey(key);
                const id = items.some((s) => s.id === local?.sessionId) ? local!.sessionId : items.find((s) => !s.closed_at)?.id || "";
                setSessionId(id);
            })
            .catch((e) => {
                if (!controller.signal.aborted) setError(e.message);
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
        setStream({});
        setSaved(null);setSyncFeedback("");syncAttempt.current="";
        cursors.current.clear();
        void getAgentSession(sessionId, controller.signal)
            .then((next) => {
                if (!controller.signal.aborted) {
                    setSnapshot(previous => acceptAgentSnapshot(previous, next));
                    setMode(next.runs.at(-1)?.mode??next.session.mode);
                    setSessions(items => items.some(item => item.id === next.session.id) ? items : [next.session, ...items]);
                }
            })
            .catch((e) => {
                if (!controller.signal.aborted) setError(e.message);
            });
        return () => controller.abort();
    }, [sessionId]);
    useEffect(() => {
        const op = pending.current;
        if (!op || !snapshot?.runs.some((r) => r.operation_id === op.operationId)) return;
        pending.current = null;
        setDraft((text) => (text === op.prompt ? "" : text));
        void localforage.setItem(key, { sessionId, draft: draft === op.prompt ? "" : draft, pending: null });
    }, [snapshot, key, sessionId, draft]);
    useEffect(() => {
        if (readyKey !== key || (!sessionId && !draft)) return;
        void localforage.setItem(key, { sessionId, draft, pending: pending.current });
    }, [key, readyKey, sessionId, draft]);
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
                    if (e.type === "message.delta") setStream((prev) => ({ ...prev, [`${e.run_id}:${e.item_id}`]: (prev[`${e.run_id}:${e.item_id}`] || "") + String(e.data.delta || "") }));
                    if (e.type === "canvas.saved") setSaved(previous => ({ runId: e.run_id, projectId, revision: Number(e.data.revision), nodeIds: [...new Set([...(previous?.runId === e.run_id ? previous.nodeIds : []), ...((e.data.nodeIds || []) as string[])])] }));
                }
                cursors.current.set(runId, cursor);
                let status = latest.status;
                {
                    const next = await getAgentSession(sessionId, controller.signal);
                    if (controller.signal.aborted) return;
                    setSnapshot(previous => acceptAgentSnapshot(previous, next));
                    status = next.runs.find((r) => r.id === runId)?.status || status;
                }
                if (["completed", "failed", "cancelled"].includes(status)) return;
                if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 1000);
            } catch (e) {
                if (!controller.signal.aborted) {
                    setError(e instanceof Error ? e.message : "连接中断，请重连");
                    if (e instanceof PlatformApiError && [401, 403, 404].includes(e.status)) {
                        setSnapshot(null);
                        setStream({});
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
    useEffect(()=>{const pane=scrollPane.current;if(!pane)return;if(followTail.current){pane.scrollTop=pane.scrollHeight;setNewContent(false);}else setNewContent(true);},[snapshot?.messages.length,latest?.status,stream]);
    const submit = async () => {
        if (readyKey !== key || active || snapshot?.session.closed_at || !draft.trim() || !modelId || (paidModel && budgetCents <= 0) || busy) return;
        setBusy(true);
        setError("");
        const current = generation.current;
        try {
            const op = pending.current ?? { operationId: crypto.randomUUID(), sessionOperationId: crypto.randomUUID(), prompt: draft, sessionId, mode, modelId, budgetCents: paidModel ? budgetCents : 0 };
            pending.current = op;
            await localforage.setItem(key, { sessionId, draft: op.prompt, pending: op });
            const id = op.sessionId || (await createAgentSession(projectId, op.mode, op.sessionOperationId)).id;
            op.sessionId = id;
            await localforage.setItem(key, { sessionId: id, draft: op.prompt, pending: op });
            if (generation.current === current) setSessionId(id);
            const run = await startAgentRun(id, op.prompt, op.modelId, op.mode, op.operationId, op.budgetCents ?? 0);
            if (generation.current !== current) return;
            pending.current = null;
            setSessionId(id);
            setDraft("");
            const [next, items] = await Promise.all([getAgentSession(id), listAgentSessions(projectId)]);
            if (generation.current !== current) return;
            setSnapshot(previous => acceptAgentSnapshot(previous, next));
            setSessions(items);
            await localforage.setItem(key, { sessionId: id, draft: "", pending: null });
            if (run.status === "awaiting_manual_review") setError("原请求状态不明，已保留操作ID，请核查，勿重复创建任务");
        } catch (e) {
            if (generation.current === current) setError((e as Error).message + "。重试会查询同一个操作，不会创建新的任务。");
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
            if (generation.current === current) setError((e as Error).message);
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
    return (
        <aside
            aria-label="原生创作助手面板"
            data-canvas-shortcuts-ignore
            className={(panelLayout.overlay?"fixed inset-y-0 right-0 z-[85] ":"relative shrink-0 ")+"flex max-w-full flex-col border-l bg-background"}
            style={{ width:panelLayout.width, background: theme.node.panel, color: theme.node.text, borderColor: theme.node.stroke }}
        >
            <button aria-label="调整助手面板宽度" className={"absolute inset-y-0 left-0 w-2 -translate-x-1/2 cursor-col-resize "+(panelLayout.overlay?"hidden":"")} onPointerDown={resize} />
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
                            setError("尚有请求回执未确认，请先查询原操作");
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
            <div className="px-5 pb-3 text-xs text-muted-foreground">当前项目 · {workspace.projectId === projectId ? workspace.projectTitle : projectId}</div>
            <main ref={scrollPane} onScroll={event=>{const p=event.currentTarget;followTail.current=p.scrollHeight-p.scrollTop-p.clientHeight<64;}} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5" aria-live="polite">
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
                                        .catch((e) => setError(e.message))
                                }
                            >
                                重新查询
                            </Button>
                        }
                    />
                )}
                {!snapshot?.messages.length && (
                    <div className="py-12">
                        <h3 className="text-lg font-medium">从已有知识开始创作</h3>
                        <p className="mt-3 text-sm leading-7 text-muted-foreground">让助手检索世界观和人物设定，为当前项目搭建创作流程。所有业务写入会先展示计划，等待你确认。</p>
                        <Button type="text" className="mt-4 !h-auto !whitespace-normal !px-0 !text-left" onClick={() => setDraft("根据雾港世界观、林岚和周可的人物设定，帮我搭建第一集漫剧的剧本创作流程。")}>
                            搭建第一集漫剧创作流程
                        </Button>
                    </div>
                )}
                {snapshot?.messages.map((m) => (
                    <article className="py-4" key={`${sessionId}:${m.turn_id}:${m.item_id}`}>
                        <div className="mb-2 text-xs text-muted-foreground">{m.role === "user" ? "你" : "创作助手"}</div>
                        {m.role === "assistant" && snapshot?.steps.some(step=>step.id===m.item_id&&step.kind==='model') && snapshot?.runs.some(run=>run.id===m.run_id&&run.plan_protocol===1&&run.mode==='execute') ? <p className="mb-2 text-xs text-muted-foreground">规划说明 · 实际执行结果以保存回执为准</p> : null}
                        <div className="whitespace-pre-wrap break-words text-sm leading-7">{m.content}</div>
                    </article>
                ))}
                {Object.entries(stream)
                    .filter(([id]) => !snapshot?.messages.some((m) => `${m.run_id}:${m.item_id}` === id))
                    .map(([id, text]) => (
                        <p className="whitespace-pre-wrap break-words py-3 text-sm leading-7" key={id}>
                            {text}
                        </p>
                    ))}
                {latest && (
                    <div className="my-4 flex flex-wrap items-center gap-2 text-xs">
                        <Tag>{states[latest.status] || latest.status}</Tag>
                        <span className="text-muted-foreground">
                            {latest.rounds} 轮模型 · {latest.tool_count} 次工具
                        </span>
                        {active && (
                            <Button
                                size="small"
                                type="text"
                                icon={<Square size={12} />}
                                onClick={() =>
                                    void cancelAgentRun(latest.id)
                                        .then(refresh)
                                        .catch((e) => setError(e.message))
                                }
                            >
                                停止任务
                            </Button>
                        )}
                    </div>
                )}
                {latest&&<p className="my-3 text-xs tabular-nums text-muted-foreground">实际模型 {latest.model_id} · 准入策略 v{latest.policy_snapshot?.version ?? "历史"} · Token {Number(latest.input_tokens)+Number(latest.output_tokens)} · 已结算 ¥{((latest.spent_cents??0)/100).toFixed(2)} · 待核验预留 ¥{((latest.reserved_cents??0)/100).toFixed(2)} / 上限 ¥{((latest.budget_cents??0)/100).toFixed(2)}</p>}
                {latestPlan&&<section className="my-4 border-t pt-3" style={{borderColor:theme.node.stroke}} aria-label="完整执行计划"><h3 className="text-sm font-medium">{latestPlan.goal}</h3><p className="my-2 text-xs text-muted-foreground">计划 r{latestPlan.revision} · {latestPlan.status==='awaiting_approval'?'一次确认后执行全部步骤':latestPlan.status==='completed'?'已按服务器回执完成':latestPlan.status} · {latestPlan.expected_outputs?.nodes?.length??latestPlan.steps.filter(s=>s.toolName==='create_canvas_node'&&!s.dedupeOf).length} 个节点 / {latestPlan.expected_outputs?.edges?.length??latestPlan.steps.filter(s=>s.toolName==='connect_canvas_nodes'&&!s.dedupeOf).length} 条连接</p></section>}
                {latest?.status==='paused'&&<Button type="text" onClick={()=>{setResumeModel(latest.model_id);setResumeBudget(0);resumeOperation.current=crypto.randomUUID();setResumeOpen(true);}}>继续剩余计划 / 选择模型</Button>}
                {latest?.error_message && <Alert type="warning" title={latest.error_message} showIcon />}
                {latest && (latest.status === 'awaiting_manual_review' || latest.error_code === 'AGENT_BILLING_UNCONFIRMED') && <Button type="text" onClick={() => void reconcileAgentRun(latest.id).then(refresh).then(() => setConnectionVersion(value => value + 1)).catch(error => setError(error.message))}>核查原模型回执</Button>}

                {!!snapshot?.steps.length && (
                    <Collapse
                        ghost
                        items={[
                            {
                                key: "steps",
                                label: "执行记录",
                                children: (
                                    <ol className="space-y-3 text-xs">
                                        {snapshot.steps.map((s) => (
                                            <li key={`${s.run_id}:${s.id}`} className="min-w-0">
                                                <details><summary className="flex cursor-pointer justify-between gap-3">
                                                <span>{s.kind === "model" ? "模型分析" : s.tool_name==="read_knowledge"?"读取资料 · "+((s.output as any)?.title??snapshot?.sources?.find(source=>source.documentId===(s.input as any)?.documentId)?.title??"授权片段"):tools[s.tool_name || ""] || s.tool_name}</span>
                                                <span className="text-muted-foreground">{({pending:"待执行",awaiting_approval:"待计划确认",running:"执行中",completed:"已完成",failed:"失败",unknown:"待核查",cancelled:"已取消",submitting:"已提交"} as Record<string,string>)[s.status]??s.status}</span>
                                                </summary><pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify({operationId:(s as any).operation_id,parameters:s.input,result:s.output,error:s.error_message},null,2)}</pre></details>
                                            </li>
                                        ))}
                                    </ol>
                                ),
                            },
                        ]}
                    />
                )}
                {!!snapshot?.sources?.length&&<Collapse ghost items={[{key:'sources',label:'已使用知识来源',children:<ul className="space-y-2 text-xs">{snapshot.sources.filter(s=>s.runId===latest?.id).map((source,index)=><li key={source.documentId+':'+source.revision+':'+index}>{source.title} · r{source.revision}<br/><span className="break-all text-muted-foreground">{source.contentHash}</span>{source.ranges?.map(range=><span key={range.start+':'+range.end}> · 字符 {range.start}–{range.end}</span>)}</li>)}</ul>}]} />}
                {snapshot?.approvals
                    .filter((a) => a.status === "pending")
                    .map((a) => (
                        <Approval key={a.id} approval={a} busy={busy} onDecide={decide} />
                    ))}
                {saved && (
                    <div className="mt-5 border-t pt-4" style={{ borderColor: theme.node.stroke }}>
                        <p className="text-sm">画布已保存 · revision {saved.revision}</p>
                        <p className="my-2 text-xs leading-5 text-muted-foreground">{syncFeedback||"正在核对本页草稿与服务器结果"}</p>
                        {!!latestPlan?.expected_outputs?.nodes?.length&&<p className="mb-2 text-xs">{latestPlan.expected_outputs.nodes.map(n=>n.title).join("、")}</p>}
                        <Button
                            type="text"
                            icon={<RefreshCw size={14} />}
                            disabled={bridge?.projectId !== saved.projectId}
                            onClick={() =>
                                void bridge
                                    ?.sync()
                                    .then(result => {setSyncFeedback("本页已同步到 revision "+result.revision);message.success("已载入保存结果");})
                                    .catch((e) => setError(e.message))
                            }
                        >
                            同步画布结果
                        </Button>
                        <Button type="text" onClick={()=>void bridge?.compare().then(setDiff).catch(e=>setError(e.message))}>查看本地与服务器差异</Button>
                        <Button type="text" onClick={()=>void bridge?.keepDraft().then(()=>message.success('本地草稿已保留，服务器未被覆盖')).catch(e=>setError(e.message))}>保留草稿</Button>
                        <Button type="text" disabled={bridge?.projectId !== saved.projectId || !saved.nodeIds.length} onClick={() => void bridge?.sync().then(() => bridge.focus(saved.nodeIds)).catch((e) => setError(e.message))}>定位新节点</Button>
                    </div>
                )}
                {newContent&&<Button type="text" className="sticky bottom-0" onClick={()=>{followTail.current=true;if(scrollPane.current)scrollPane.current.scrollTop=scrollPane.current.scrollHeight;setNewContent(false);}}>有新内容 · 回到最新</Button>}
                <div ref={bottom} />
            </main>
            <Modal title="本地草稿与服务器版本" open={!!diff} onCancel={()=>setDiff(null)} footer={<Button onClick={()=>setDiff(null)}>保留当前编辑并返回</Button>}><p>服务器 revision {diff?.revision} · 本页 {diff?.localNodeCount} 节点 / 服务器 {diff?.remoteNodeCount} 节点。</p><p className="my-3">查看不会覆盖草稿，也不会自动合并或保存。</p>{diff?.addedNodes.map(n=><p key={n.id}>服务器新增：{n.title}</p>)}{diff?.changedNodes.map(n=><p key={n.id}>内容有差异：{n.title}</p>)}</Modal>
            <Modal title="批准新预算，继续剩余计划" open={resumeOpen} onCancel={()=>setResumeOpen(false)} okText="批准预算并续跑" confirmLoading={busy} onOk={()=>{if(!latest||!resumeModel)return;setBusy(true);void resumeAgentRun(latest.id,latest.revision,resumeModel,resumeBudget,resumeOperation.current,limitsHash).then(refresh).then(()=>{setResumeOpen(false);setConnectionVersion(v=>v+1);}).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}><p className="mb-3">保持原目标和已保存步骤；本次明确增加 {limits.rounds} 轮模型、{limits.tools} 次工具、{limits.totalTokens} Token、{Math.round((limits.activeMs??0)/60000)} 分钟预算，不重新执行已完成操作。若画布变化，重新规划后需要再次审批；供应商状态不明时不允许续跑。</p><Select aria-label="续跑模型" className="mb-3 w-full" disabled={!modelSelectionEnabled} value={resumeModel} options={models.map(m=>({value:m.id,label:m.name}))} onChange={setResumeModel}/><label className="flex items-center gap-2">额外人民币积分预算（元）<InputNumber aria-label="续跑额外预算" min={0} precision={2} value={resumeBudget/100} onChange={v=>setResumeBudget(Math.round(Number(v??0)*100))}/></label><p className="mt-3 text-xs text-muted-foreground">等待核验的预留保留，不将未知费用认定为免费。</p></Modal>
            <footer className="border-t p-4" style={{ borderColor: theme.node.stroke }}>
                <div className="mb-3 flex gap-2">
                    <Select
                        aria-label="执行模式"
                        value={active ? latest.mode : mode}
                        onChange={setMode}
                        disabled={!!active || busy}
                        options={[
                            { value: "advice", label: "建议模式" },
                            { value: "execute", label: "执行模式" },
                        ]}
                    />
                    <Select aria-label="助手模型" className="min-w-0 flex-1" value={(active?latest.model_id:modelId) || undefined} onChange={setModelId} options={models.map((m) => ({ value: m.id, label: m.name }))} placeholder="暂无已验证且开放的工具模型" disabled={!!active || busy || !modelSelectionEnabled} />
                </div>
                {paidModel && <label className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">本次积分费用上限（元）<InputNumber aria-label="积分费用预算" min={0} max={maxBudgetCents==null?undefined:maxBudgetCents/100} precision={2} step={0.01} value={budgetCents / 100} onChange={value => setBudgetCents(Math.round(Number(value ?? 0) * 100))} disabled={!!active || busy} /><span>按现有人民币积分计费，包含平台计费与取整；未核验费用保持预留{maxBudgetCents!=null?`；平台每Run上限¥${(maxBudgetCents/100).toFixed(2)}`:''}</span></label>}
                <Input.TextArea
                    aria-label="给创作助手的指令"
                    disabled={readyKey !== key}
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
                    <Button type="text" icon={<ArrowUp size={17} />} loading={busy} disabled={readyKey !== key || !!active || !draft.trim() || !modelId || (paidModel && budgetCents <= 0) || !!snapshot?.session.closed_at} onClick={() => void submit()}>
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
                                .catch((e) => setError(e.message))
                        }
                    >
                        结束会话
                    </Button>
                )}
            </footer>
        </aside>
    );
}
function Approval({ approval, busy, onDecide }: { approval: AgentApproval; busy: boolean; onDecide: (a: AgentApproval, d: "approve" | "revise" | "cancel", instruction?: string) => Promise<void> }) {
    const [instruction, setInstruction] = useState("");
    return (
        <section className="my-5 border-y py-5">
            <h3 className="font-medium">请确认执行计划</h3>
            <p className="my-2 text-xs leading-5 text-muted-foreground">仅执行以下参数。资料内容不能改变你的权限或审批范围。</p>
            <ol className="space-y-3">
                {approval.preview.map((p, i) => (
                    <li key={p.operationId}>
                        <div className="text-sm">
                            {i + 1}. {p.summary || tools[p.tool] || p.tool}
                        </div>
                        <details className="mt-1 text-xs text-muted-foreground">
                            <summary className="cursor-pointer py-1">查看写入参数</summary>
                            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all leading-5">{JSON.stringify(p.parameters, null, 2)}</pre>
                        </details>
                    </li>
                ))}
            </ol>
            <Input.TextArea className="mt-4" aria-label="计划修改意见" placeholder="需要调整？填写修改意见后重新规划" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
            <div className="mt-3 flex flex-wrap gap-2">
                <Button type="primary" disabled={busy} onClick={() => void onDecide(approval, "approve")}>
                    确认执行
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
