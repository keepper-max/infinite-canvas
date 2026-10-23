import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Input, Select, Spin, Tooltip } from "antd";
import { ArrowLeft, BookOpen, Expand, GitBranch, Globe2, Maximize2, Minus, Plus, RefreshCw, Search } from "lucide-react";
import localforage from "localforage";
import { getKnowledgeGraph, listKnowledge, type KnowledgeGraphNode, type KnowledgeGraphEdge, type KnowledgeGraphPage, type KnowledgeSummary } from "@/services/api/knowledge";
import { GraphEngine, type LayoutCache, type PointNode } from "./engine";
import "./style.css";
const layouts = localforage.createInstance({ name: "shoushou-knowledge", storeName: "graph_layouts" });
type Data = { nodes: KnowledgeGraphNode[]; edges: KnowledgeGraphEdge[] };
type Props = { actor: string; space: string; documentId: string; folderId: string; tag: string; theme: string; onOpen: (id: string) => Promise<void>; onDocument: () => void; onAdd: (id: string) => void; onRelate: (id: string, mode: 'add' | 'remove' | 'view') => void; canWrite: boolean };
export default function KnowledgeGraph(p: Props) {
    const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null), [lastHovered, setLastHovered] = useState<PointNode | null>(null);
    const relate = useRef(p.onRelate); relate.current = p.onRelate;
    const menuRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!menu) return; menuRef.current?.querySelector('button')?.focus();
        const close = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null); };
        const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
        window.addEventListener('pointerdown', close); window.addEventListener('keydown', key);
        return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', key); };
    }, [menu]);
    const [mode, setMode] = useState<"global" | "local">("global"),
        [center, setCenter] = useState(p.documentId),
        [selected, setSelected] = useState(""),
        [history, setHistory] = useState<string[]>([]);
    const [data, setData] = useState<Data>({ nodes: [], edges: [] }),
        [paging, setPaging] = useState<KnowledgeGraphPage | null>(null),
        [loading, setLoading] = useState(false),
        [error, setError] = useState(""),
        [hover, setHover] = useState<PointNode | null>(null),
        [ready, setReady] = useState(0),
        [search, setSearch] = useState(""),
        [results, setResults] = useState<KnowledgeSummary[]>([]);
    const canvas = useRef<HTMLCanvasElement>(null),
        engine = useRef<GraphEngine | null>(null),
        selectRef = useRef<(id: string) => void>(() => {}),
        openRef = useRef(p.onOpen),
        generation = useRef(0),
        request = useRef<AbortController | null>(null),
        after = useRef<{ node?: string; edge?: string }>({}),
        dataRef = useRef(data),
        currentCenter = useRef(center),
        searchRequest = useRef<AbortController | null>(null),
        pendingFocus = useRef<string | null>(null);
    dataRef.current = data;
    currentCenter.current = center;
    openRef.current = p.onOpen;
    const cacheKey = `v1:${p.actor}:${p.space}:${mode}:${p.folderId}:${p.tag}`;
    const merge = useCallback((page: KnowledgeGraphPage, reset = false, updatePaging = true) => {
        setData((old) => {
            const nodes = new Map((reset ? [] : old.nodes).map((n) => [n.id, n])),
                edges = new Map((reset ? [] : old.edges).map((e) => [e.source + ":" + e.target, e]));
            page.nodes.forEach((n) => nodes.set(n.id, n));
            page.edges.forEach((e) => edges.set(e.source + ":" + e.target, e));
            return { nodes: [...nodes.values()], edges: [...edges.values()] };
        });
        if (updatePaging) setPaging(page);
    }, []);
    const load = useCallback(
        async (reset = false, centerId = mode === "local" ? currentCenter.current : undefined) => {
            request.current?.abort();
            const controller = new AbortController();
            request.current = controller;
            const token = ++generation.current;
            setLoading(true);
            setError("");
            try {
                const page = await getKnowledgeGraph(
                    p.space,
                    { centerId: centerId || undefined, folderId: p.folderId || undefined, tag: p.tag || undefined, pageSize: 100, ...(!reset ? { cursor: after.current.node, edgeCursor: mode === "global" ? after.current.edge : undefined } : {}) },
                    controller.signal,
                );
                if (token !== generation.current) return;
                after.current = {
                    node: page.nodes.filter((n) => n.id !== centerId).at(-1)?.id || (!reset ? after.current.node : undefined),
                    edge: page.edges.length ? `${page.edges.at(-1)!.source}:${page.edges.at(-1)!.target}` : !reset ? after.current.edge : undefined,
                };
                merge(page, reset);
                if (mode === "local" && !centerId && page.nodes.length) {
                    setCenter(page.nodes[0].id);
                    setSelected(page.nodes[0].id);
                }
            } catch (e) {
                if (controller.signal.aborted) return;
                const failure = e as Error & { status?: number };
                setError(failure.message);
                if ([401, 403, 404].includes(failure.status || 0)) {
                    searchRequest.current?.abort();
                    setData({ nodes: [], edges: [] });
                    setPaging(null);
                    setHover(null);
                    setLastHovered(null);
                    setMenu(null);
                    setSelected("");
                    setResults([]);
                }
            } finally {
                if (token === generation.current) setLoading(false);
            }
        },
        [p.space, p.folderId, p.tag, mode, merge],
    );
    useEffect(() => {
        setData({ nodes: [], edges: [] });
        setPaging(null);
        after.current = {};
        void load(true);
        return () => {
            generation.current++;
            request.current?.abort();
        };
    }, [load]);
    useEffect(() => {
        let live = true;
        const key = cacheKey;
        void layouts
            .getItem<LayoutCache>(key)
            .catch(() => null)
            .then((cache) => {
                if (!live || !canvas.current) return;
                setHover(null);
                setLastHovered(null); setMenu(null);
                const graph = new GraphEngine(canvas.current, { select: (id) => selectRef.current(id), open: (id) => void openRef.current(id), hover: node => { setHover(node); if (node) setLastHovered(node); }, context: (node, x, y) => setMenu({ id: node.id, x, y }), settled: (value) => void layouts.setItem(key, value).catch(() => {}) }, cache || undefined);
                engine.current = graph;
                setReady((v) => v + 1);
            });
        return () => {
            live = false;
            engine.current?.destroy();
            engine.current = null;
        };
    }, [cacheKey]);
    useEffect(() => {
        const graph = engine.current;
        if (!graph) return;
        const depths = new Map<string, number>();
        if (mode === "local" && center) {
            const adjacency = new Map<string, string[]>();
            for (const e of data.edges) {
                adjacency.set(e.source, [...(adjacency.get(e.source) || []), e.target]);
                adjacency.set(e.target, [...(adjacency.get(e.target) || []), e.source]);
            }
            const queue = [center];
            depths.set(center, 0);
            for (let i = 0; i < queue.length; i++) {
                const id = queue[i];
                for (const next of adjacency.get(id) || [])
                    if (!depths.has(next)) {
                        depths.set(next, depths.get(id)! + 1);
                        queue.push(next);
                    }
            }
        }
        const wasEmpty = graph.snapshot().nodes.length === 0;
        graph.setData(data.nodes, data.edges, mode === "local" ? center : null, depths);
        if (wasEmpty && data.nodes.length && mode === "global" && !graph.hasCachedLayout()) graph.fit(false);
        if (selected) graph.select(selected, mode === "local");
        if (pendingFocus.current) {
            graph.select(pendingFocus.current, true);
            pendingFocus.current = null;
        }
    }, [data, center, mode, ready]);
    useEffect(() => {
        engine.current?.setTheme();
    }, [p.theme]);
    useEffect(() => { const changed = () => void load(true); window.addEventListener('knowledge:changed', changed); return () => window.removeEventListener('knowledge:changed', changed); }, [load]);
    useEffect(() => {
        const controller = new AbortController();
        searchRequest.current = controller;
        if (!search.trim()) {
            setResults([]);
            return;
        }
        void listKnowledge(p.space, { q: search, folderId: p.folderId || undefined, tag: p.tag || undefined }, controller.signal)
            .then((r) => {
                if (!controller.signal.aborted) setResults(r.items);
            })
            .catch(() => {
                if (!controller.signal.aborted) setResults([]);
            });
        return () => controller.abort();
    }, [search, p.space, p.folderId, p.tag]);
    useEffect(() => {
        let live = true;
        const controller = new AbortController();
        const recheck = () => {
            void getKnowledgeGraph(p.space, { pageSize: 1, centerId: mode === "local" ? currentCenter.current || undefined : undefined }, controller.signal).catch((e: Error & { status?: number }) => {
                if (!live || controller.signal.aborted) return;
                if ([401, 403, 404].includes(e.status || 0)) {
                    generation.current++;
                    request.current?.abort();
                    searchRequest.current?.abort();
                    setData({ nodes: [], edges: [] });
                    setPaging(null);
                    setSelected("");
                    setHover(null);
                    setLastHovered(null);
                    setMenu(null);
                    setResults([]);
                    setLoading(false);
                    setError(e.message);
                }
            });
        };
        window.addEventListener("focus", recheck);
        return () => {
            live = false;
            controller.abort();
            window.removeEventListener("focus", recheck);
        };
    }, [p.space, mode]);
    const choose = async (id: string, remember = true) => {
        setSelected(id);
        engine.current?.select(id);
        if (mode === "local") {
            const previous = currentCenter.current;
            if (remember && previous && previous !== id) setHistory((h) => [...h, previous]);
            setCenter(id);
            currentCenter.current = id;
            after.current = {};
            await load(false, id);
            engine.current?.focus(id);
        } else if (!dataRef.current.nodes.some((n) => n.id === id)) {
            try {
                const token = generation.current;
                const page = await getKnowledgeGraph(p.space, { centerId: id, pageSize: 100, folderId: p.folderId || undefined, tag: p.tag || undefined });
                if (token !== generation.current) return;
                pendingFocus.current = id;
                merge(page, false, false);
            } catch (e) {
                setError((e as Error).message);
            }
        }
    };
    selectRef.current = (id) => void choose(id);
    const loadedIds = new Set(data.nodes.map((n) => n.id)),
        focused = data.nodes.find((n) => n.id === selected),
        visibleEdges = data.edges.filter((e) => loadedIds.has(e.source) && loadedIds.has(e.target));
    const toLocal = () => {
        const next = selected || p.documentId || data.nodes[0]?.id || "";
        setCenter(next);
        currentCenter.current = next;
        setSelected(next);
        setMode("local");
        setHistory([]);
    };
    const more = Boolean(paging?.nextCursor || (mode === "global" && paging?.nextEdgeCursor));
    const cardNode = hover || focused || lastHovered;
    return (
        <section className="knowledge-graph" aria-label="知识图谱" data-mode={mode} data-loading={loading} data-more={more} data-loaded-nodes={data.nodes.length} data-loaded-edges={visibleEdges.length}>
            <div className="knowledge-graph-bar">
                <div className="knowledge-graph-modes">
                    <Button type="text" className={mode === "global" ? "active" : ""} icon={<Globe2 size={14} />} onClick={() => setMode("global")}>
                        全局图谱
                    </Button>
                    <Button type="text" className={mode === "local" ? "active" : ""} icon={<GitBranch size={14} />} onClick={toLocal}>
                        局部图谱
                    </Button>
                </div>
                <div className="knowledge-graph-actions">
                    <Tooltip title="返回上一知识焦点">
                        <Button
                            type="text"
                            aria-label="返回上一知识焦点"
                            disabled={!history.length || mode !== "local"}
                            icon={<ArrowLeft size={16} />}
                            onClick={() => {
                                const id = history.at(-1)!;
                                setHistory((h) => h.slice(0, -1));
                                void choose(id, false);
                            }}
                        />
                    </Tooltip>
                    <Button type="text" aria-label="刷新知识图谱" icon={<RefreshCw size={15} />} loading={loading} onClick={() => void load(true)} />
                    <Button type="text" aria-label="返回文档视图" icon={<BookOpen size={15} />} onClick={p.onDocument} />
                </div>
            </div>
            {error && <Alert type="warning" title={error} action={<Button onClick={() => void load(true)}>重新验证权限</Button>} />}
            <div className="knowledge-graph-stage">
                <canvas ref={canvas} tabIndex={0} role="application" aria-label="可交互知识网络，方向键平移，加减缩放，Home重置，Enter打开选中节点" />
                <div className="knowledge-graph-search">
                    <Input allowClear aria-label="搜索并定位图谱节点" prefix={<Search size={15} />} placeholder="搜索知识，定位节点" value={search} onChange={(e) => setSearch(e.target.value)} />
                    {search && (
                        <div className="knowledge-graph-results">
                            {results.map((n) => (
                                <button
                                    key={n.id}
                                    onClick={() => {
                                        void choose(n.id);
                                        setSearch("");
                                    }}
                                >
                                    <span>{n.title}</span>
                                    <small>
                                        {n.folderId ? "文件夹 · " : ""}
                                        {n.id.slice(0, 8)}
                                    </small>
                                </button>
                            ))}
                            {!results.length && <small>没有匹配文档</small>}
                        </div>
                    )}
                </div>
                <div className="knowledge-graph-caption">
                    <span>{mode === "local" ? "从一篇文档出发" : "让联系浮现"}</span>
                    <p>{mode === "local" ? data.nodes.find((n) => n.id === center)?.title || "选择一个知识焦点" : "每一条线，都来自真实的双向链接"}</p>
                </div>
                {loading && (
                    <div className="knowledge-graph-loading">
                        <Spin size="small" />
                        <span>正在读取授权知识</span>
                    </div>
                )}
                {!loading && !data.nodes.length && !error && (
                    <div className="knowledge-graph-empty">
                        <GitBranch size={34} strokeWidth={1} />
                        <h2>还没有知识节点</h2>
                        <p>创建或导入文档后，再来探索它们的联系。</p>
                        <Button type="text" onClick={p.onDocument}>
                            返回文档
                        </Button>
                    </div>
                )}
                {!!data.nodes.length && !visibleEdges.length && !loading && <div className="knowledge-graph-unlinked">还没有知识关联。选择两个文档建立第一条连线。{paging?.nextEdgeCursor ? "更多关系仍在下一页。" : ""}</div>}
                {menu && <div ref={menuRef} data-knowledge-menu role="menu" aria-label="知识节点操作" className="knowledge-graph-context" style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 160) }}>{(['add', 'view', 'remove'] as const).map((mode, i) => <Button key={mode} role="menuitem" type="text" disabled={mode !== 'view' && !p.canWrite} onClick={() => { relate.current(menu.id, mode); setMenu(null); }}>{['建立关联', '查看来源引用', '移除关联'][i]}</Button>)}</div>}
                <div className="knowledge-graph-controls">
                    <Button type="text" aria-label="放大图谱" icon={<Plus size={17} />} onClick={() => engine.current?.zoom(1.25)} />
                    <Button type="text" aria-label="缩小图谱" icon={<Minus size={17} />} onClick={() => engine.current?.zoom(0.8)} />
                    <Button type="text" aria-label="恢复初始视角" icon={<Maximize2 size={17} />} onClick={() => engine.current?.fit()} />
                </div>
                {cardNode && (
                    <div className="knowledge-graph-focus">
                        <small>
                            {hover ? "正在探索" : "当前焦点"}
                            {focused?.id === center ? " · 中心节点" : ""}
                        </small>
                        <strong>{cardNode.title}</strong>
                        <span>
                            {cardNode.degree} 条引用 · {cardNode.unresolvedCount} 个未解析链接
                        </span>
                        <div>
                            <Button type="text" icon={<BookOpen size={14} />} onClick={() => void p.onOpen(cardNode.id)}>
                                打开文档
                            </Button>
                            <Button type="text" disabled={!p.canWrite} onClick={() => p.onRelate(cardNode.id, 'add')}>建立关联</Button>
                            <Button type="text" onClick={() => p.onRelate(cardNode.id, 'view')}>查看来源引用</Button>
                            <Button type="text" disabled={!p.canWrite} onClick={() => p.onRelate(cardNode.id, 'remove')}>移除关联</Button>
                            <Button type="text" onClick={() => p.onAdd(cardNode.id)}>引用到创作画布</Button>
                            <Button
                                type="text"
                                icon={<Expand size={14} />}
                                onClick={() => {
                                    const node = cardNode;
                                    if (mode === "global") {
                                        setSelected(node.id);
                                        setCenter(node.id);
                                        currentCenter.current = node.id;
                                        setMode("local");
                                    } else void choose(node.id);
                                }}
                            >
                                展开关联
                            </Button>
                        </div>
                    </div>
                )}
                <div className="knowledge-graph-legend">
                    <span className="outgoing">正向引用</span>
                    <span className="incoming">反向引用</span>
                    <small>拖拽节点 · 滚轮缩放 · 双击打开</small>
                </div>
            </div>
            <footer className="knowledge-graph-footer">
                <small>知识连线来自文档中的双向链接，也可以手动建立关联。</small>
                <span>
                    {mode === "global" ? `已载入 ${data.nodes.length} / ${paging?.totalNodes ?? 0} 篇` : `已探索 ${data.nodes.length} 篇 · 中心关联 ${Math.max(0, (paging?.totalNodes ?? 1) - 1)} 篇`} · {visibleEdges.length} 条可见关系
                    {p.folderId || p.tag ? " · 已筛选" : ""}
                </span>
                <div>
                    {more && (
                        <Button type="text" aria-label={mode === "local" ? "加载更多关联" : "加载更多知识"} disabled={loading} loading={loading} onClick={() => void load(false)}>
                            加载更多{mode === "local" ? "关联" : "知识"}
                        </Button>
                    )}
                    <Select
                        aria-label="键盘选择知识节点"
                        placeholder="定位已载入节点"
                        showSearch
                        optionFilterProp="label"
                        value={selected || undefined}
                        onChange={(id) => void choose(id)}
                        options={data.nodes.map((n) => ({ value: n.id, label: n.title + " · " + n.id.slice(0, 6) }))}
                    />
                </div>
            </footer>
        </section>
    );
}
