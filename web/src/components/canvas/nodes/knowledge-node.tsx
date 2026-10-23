import { useEffect, useRef, useState } from "react";
import { App, Button, Input, Select, Alert, Checkbox, Drawer } from "antd";
import { BookOpen, ExternalLink, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/auth/auth-context";
import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import { ensureKnowledgeSpace, getKnowledgeSpaces, listKnowledge, knowledgeAction, getKnowledgeHistory, type KnowledgeSummary, type KnowledgeSpace } from "@/services/api/knowledge";
import { referenceSummary, knowledgeDragType, type KnowledgeReference } from "@/services/api/knowledge-canvas";
import { useKnowledgeActions } from "@/pages/knowledge/use-actions";

const openEvent = "shoushou:open-knowledge-node";
function open(ctx: CanvasNodeContext) {
    window.dispatchEvent(new CustomEvent(openEvent, { detail: { nodeId: ctx.node.id } }));
}
let registered = false;
export function registerKnowledgeNodes() {
    if (registered) return;
    registered = true;
    registerNodeDefinitions([
        {
            type: "knowledge:document",
            workflowKind: "knowledge.reference",
            title: "知识文档",
            icon: <BookOpen size={20} />,
            defaultSize: { width: 340, height: 230 },
            defaultMetadata: {},
            autoOpenPanel: true,
            hasTargetHandle: false,
            Content: KnowledgeNodeContent,
            Panel: KnowledgeNodePanel,
            resource: () => ({ kind: "text" }),
            ports: [{ id: "knowledge.output", label: "知识正文", direction: "output", resourceTypes: ["text"], roles: ["data"], cardinality: "many" }],
            execution: { capability: "none" },
            onDoubleClick: (ctx) => {
                open(ctx);
                return true;
            },
            toolbar: (ctx) => [{ id: "open-knowledge", title: "打开知识原文", label: "原文", icon: <ExternalLink size={14} />, onClick: () => open(ctx) }],
        },
    ]);
}
function KnowledgeNodeContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { user } = useAuth(),
        navigate = useNavigate(),
        ref = ctx.node.metadata?.knowledgeReference;
    const q = useQuery({ queryKey: ["knowledge-reference", user.id, ctx.projectId, ref], queryFn: ({ signal }) => referenceSummary(ctx.projectId, ref!, signal), enabled: !!ref, retry: false, gcTime: 0 });
    useEffect(() => {
        const changed = () => {
            if (ref) void q.refetch();
        };
        window.addEventListener("knowledge:changed", changed);
        return () => window.removeEventListener("knowledge:changed", changed);
    }, [ref, q.refetch]);
    useEffect(() => {
        const handler = (e: Event) => {
            if ((e as CustomEvent).detail.nodeId !== ctx.node.id) return;
            if (ref) navigate(`/knowledge?space=${ref.spaceId}&doc=${ref.documentId}&project=${ctx.projectId}&view=document`);
            else ctx.openPanel();
        };
        window.addEventListener(openEvent, handler);
        return () => window.removeEventListener(openEvent, handler);
    }, [ref, ctx.node.id, ctx.projectId, navigate]);
    const value = q.error ? undefined : q.data;
    return (
        <div className="flex h-full flex-col gap-3 overflow-hidden p-4" style={{ color: ctx.theme.node.text }}>
            <div className="flex items-center gap-2 text-xs" style={{ color: ctx.theme.node.label }}>
                <BookOpen size={16} />
                项目知识 · {ref?.mode === "pinned" ? "固定版本" : "最新版本"}
            </div>
            <strong className="truncate">{value?.title || (ref ? "知识引用" : "选择知识文档")}</strong>
            <p className="line-clamp-3 text-sm whitespace-pre-wrap" style={{ color: ctx.theme.node.label }}>
                {q.error ? q.error.message : value?.excerpt || (q.isPending && ref ? "正在校验引用权限…" : "新建或引用已有文档，将知识连接到文本创作节点。")}
            </p>
            <div className="mt-auto flex items-center justify-between text-xs">
                <span>{value ? `r${value.revision} · ${value.characters} 字符${value.latestRevision > value.revision ? " · 有新版本" : " · 已同步"}` : q.error ? "引用失效" : "待关联"}</span>
                <button
                    type="button"
                    aria-label="打开知识原文"
                    onClick={(e) => {
                        e.stopPropagation();
                        open(ctx);
                    }}
                >
                    <ExternalLink size={15} />
                </button>
            </div>
        </div>
    );
}
function KnowledgeNodePanel({ ctx }: { ctx: CanvasNodeContext }) {
    const { user } = useAuth(),
        navigate = useNavigate();
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const { message } = App.useApp(),
        [spaces, setSpaces] = useState<KnowledgeSpace[]>([]),
        [space, setSpace] = useState(""),
        [projectSpace, setProjectSpace] = useState(""),
        [items, setItems] = useState<KnowledgeSummary[]>([]),
        [q, setQ] = useState(""),
        [page, setPage] = useState(1),
        [total, setTotal] = useState(0),
        [name, setName] = useState(""),
        [copy, setCopy] = useState(false),
        [busy, setBusy] = useState(false),
        [error, setError] = useState(""),
        [versions, setVersions] = useState<{ revision: number }[]>([]);
    const ref = ctx.node.metadata?.knowledgeReference;
    const operations = useKnowledgeActions(
        user.id,
        projectSpace,
        (action, result) => {
            if (!mounted.current) return;
            ctx.updateNode({ title: result.title });
            ctx.updateMetadata({ knowledgeReference: { spaceId: projectSpace, documentId: result.id, mode: "latest" } });
            if (action.action === "document.create") setName("");
        },
        "canvas:" + ctx.node.id,
    );
    useEffect(() => {
        let live = true;
        void (async () => {
            const p = await ensureKnowledgeSpace("project", ctx.projectId);
            const all = await getKnowledgeSpaces();
            if (live) {
                setProjectSpace(p.id);
                setSpace(p.id);
                setSpaces(all.filter((s) => s.kind === "personal" || s.project_id === ctx.projectId));
            }
        })().catch((e) => {
            if (live) setError(e.message);
        });
        return () => {
            live = false;
        };
    }, [ctx.projectId]);
    useEffect(() => {
        if (!space) return;
        const c = new AbortController();
        setItems([]);
        void listKnowledge(space, { q, page, pageSize: 20 }, c.signal)
            .then((r) => {
                setItems(r.items);
                setTotal(r.total);
            })
            .catch((e) => {
                if (!c.signal.aborted) setError(e.message);
            });
        return () => c.abort();
    }, [space, q, page]);
    useEffect(() => {
        let live = true;
        setVersions([]);
        if (ref)
            void getKnowledgeHistory(ref.spaceId, ref.documentId)
                .then((v) => {
                    if (live) setVersions(v.filter((x) => !x.deleted_at));
                })
                .catch((e) => {
                    if (live) setError(e.message);
                });
        return () => {
            live = false;
        };
    }, [ref?.spaceId, ref?.documentId]);
    const choose = async (d: KnowledgeSummary) => {
        setBusy(true);
        setError("");
        try {
            let target = d;
            if (space !== projectSpace) {
                if (!copy) throw new Error("请确认复制为独立项目知识，原个人文档不会共享或自动同步");
                const result = await operations.run({ operationId: crypto.randomUUID(), action: "document.copyFrom", payload: { sourceSpaceId: space, sourceDocumentId: d.id, sourceRevision: d.revision } });
                if (!result) return;
                target = { ...result, excerpt: "" };
            }
            const next: KnowledgeReference = { spaceId: projectSpace, documentId: target.id, mode: "latest" };
            await referenceSummary(ctx.projectId, next);
            if (!mounted.current) return;
            ctx.updateNode({ title: target.title });
            ctx.updateMetadata({ knowledgeReference: next });
            message.success("已关联知识；执行文本生成时由服务端读取正文");
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    const create = async () => {
        if (!name.trim()) return;
        const result = await operations.run({ operationId: crypto.randomUUID(), action: "document.create", payload: { title: name.trim(), markdown: "", folderId: null } });
        if (result && mounted.current && (!ctx.prepareGeneration || (await ctx.prepareGeneration())) && mounted.current) navigate(`/knowledge?space=${projectSpace}&doc=${result.id}&project=${ctx.projectId}&view=document`);
    };
    return (
        <Drawer open mask={false} title="知识文档引用" width="min(440px, 100vw)" onClose={ctx.closePanel} closable={{ "aria-label": "关闭知识面板" }}>
            <div className="flex flex-col gap-3" data-canvas-shortcuts-ignore data-canvas-no-zoom onPointerDown={(e) => e.stopPropagation()}>
                {error && <Alert type="error" title={error} />}
                {operations.error && <Alert type="error" title={operations.error} />}
                {operations.pending && (
                    <Button type="text" loading={operations.busy} onClick={() => void operations.run()}>
                        核查上次知识操作回执
                    </Button>
                )}
                {ref && (
                    <>
                        <div className="flex gap-2">
                            <Button type="text" icon={<ExternalLink size={14} />} onClick={() => open(ctx)}>
                                编辑原文
                            </Button>
                            <Button type="text" icon={<RefreshCw size={14} />} onClick={() => window.dispatchEvent(new Event("knowledge:changed"))}>
                                更新状态
                            </Button>
                        </div>
                        <Select
                            aria-label="知识引用版本"
                            value={ref.mode === "latest" ? "latest" : ref.revision}
                            options={[{ value: "latest", label: "Latest · 执行时读取最新版本" }, ...versions.map((v) => ({ value: v.revision, label: `Pinned · 固定 r${v.revision}` }))]}
                            onChange={(v) => ctx.updateMetadata({ knowledgeReference: v === "latest" ? { spaceId: ref.spaceId, documentId: ref.documentId, mode: "latest" } : { ...ref, mode: "pinned", revision: Number(v) } })}
                        />
                    </>
                )}
                <strong>新建项目知识</strong>
                <div className="flex gap-2">
                    <Input aria-label="新知识标题" value={name} onChange={(e) => setName(e.target.value)} />
                    <Button type="text" disabled={!projectSpace || !name.trim()} loading={busy} onClick={() => void create()}>
                        新建并编辑
                    </Button>
                </div>
                <strong>引用已有知识</strong>
                <Select
                    aria-label="选择引用知识空间"
                    value={space || undefined}
                    options={spaces.map((s) => ({ value: s.id, label: s.name + (s.kind === "personal" ? " · 个人" : " · 项目") }))}
                    onChange={(v) => {
                        setSpace(v);
                        setPage(1);
                        setCopy(false);
                    }}
                />
                <Input
                    aria-label="搜索引用文档"
                    value={q}
                    onChange={(e) => {
                        setQ(e.target.value);
                        setPage(1);
                    }}
                />
                {space !== projectSpace && (
                    <Checkbox checked={copy} onChange={(e) => setCopy(e.target.checked)}>
                        复制为独立项目文档，项目成员可读；之后不自动同步，附件保留原引用
                    </Checkbox>
                )}
                <div className="max-h-60 overflow-auto">
                    {items.map((d) => (
                        <div
                            key={d.id}
                            draggable={space === projectSpace}
                            onDragStart={(e) => {
                                e.dataTransfer.setData(knowledgeDragType, JSON.stringify({ spaceId: space, documentId: d.id }));
                            }}
                            className="flex items-center justify-between gap-2 py-2"
                        >
                            <span className="truncate">
                                {d.title}{" "}
                                <small>
                                    r{d.revision} · {d.id.slice(0, 6)}
                                </small>
                            </span>
                            <Button type="text" loading={busy} onClick={() => void choose(d)}>
                                {space === projectSpace ? "引用" : "复制并引用"}
                            </Button>
                        </div>
                    ))}
                </div>
                <div className="flex justify-between">
                    <Button type="text" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                        上一页
                    </Button>
                    <span>
                        {page} · {total} 篇
                    </span>
                    <Button type="text" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>
                        下一页
                    </Button>
                </div>
                <small>知识关系与执行连线分开维护。所有连接的知识正文将在执行时作为文本输入；请先断开不希望提供给模型的知识。</small>
            </div>
        </Drawer>
    );
}
