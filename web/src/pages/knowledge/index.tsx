import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useRef, useState, type CSSProperties } from "react";
import { useSearchParams, useBlocker } from "react-router-dom";
import { Alert, App, Button, Drawer, Input, Modal, Select, Spin, Tooltip } from "antd";
import { BookOpen, ChevronRight, Download, History, Info, PanelLeft, PanelRight, Save, Upload, Trash2, FileText, Sun, Moon, Network, Pin } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { useThemeStore } from "@/stores/use-theme-store";
import { canvasThemes } from "@/lib/canvas-theme";
import {
    ensureKnowledgeSpace,
    getKnowledgeSpaces,
    listKnowledge,
    getKnowledgeFolders,
    getKnowledgeTags,
    getKnowledgeRelations,
    getKnowledgeHistory,
    getKnowledgeVersion,
    getKnowledgeDocument,
    type KnowledgeSpace,
    type KnowledgeFolder,
    type KnowledgeSummary,
    type KnowledgeRelations,
    type KnowledgeDocument,
} from "@/services/api/knowledge";
import Navigation, { folderPath } from "./navigation";
import Relations from "./relations";
import { useKnowledgeDocument } from "./use-document";
import { useKnowledgeActions } from "./use-actions";
import { useKnowledgeBootstrap } from './use-bootstrap';
import { useKnowledgeLayout } from './use-layout';
import { useMarkdownImport } from './use-import';
import KnowledgeSectionBoundary from './section-boundary';
import KnowledgeLinkDialog from './link-dialog';
import type { EditorHandle } from "./editor";
import AddToCanvas from "./add-to-canvas";
import "./style.css";
const Editor = lazy(() => import("./editor"));
const Graph = lazy(() => import("./graph"));
export default function KnowledgePage() {
    const { user, workspace } = useAuth(),
        { message, modal } = App.useApp(),
        [params, setParams] = useSearchParams(),
        space = params.get("space") || "",
        id = params.get("doc") || "";
    const [view, setView] = useState<"document" | "graph">(() => (params.get("view") === "document" ? "document" : params.get("view") === "graph" || localStorage.getItem("knowledge:default-view:" + user.id) === "graph" ? "graph" : "document"));
    const [canvasDocument, setCanvasDocument] = useState<string | null>(null);
    const [linkDialog, setLinkDialog] = useState<{ id: string; mode: 'add' | 'view' | 'remove' } | null>(null);
    const [locate, setLocate] = useState<{ id: string; start: number; end: number; token: string } | undefined>();
    const [defaultView, setDefaultView] = useState(() => localStorage.getItem("knowledge:default-view:" + user.id) || "document");
    const switchView = async (next: "document" | "graph") => {
        try {
            editor.current?.flush();
            await d.prepareLeave();
            protectedNavigation.current = true; queueMicrotask(() => { protectedNavigation.current = false; });
            setView(next);
            setParams(previous => { const n = new URLSearchParams(previous); n.set('view', next); return n; });
        } catch (e) {
            message.error((e as Error).message);
        }
    };
    const bootstrap = useKnowledgeBootstrap(user.id), { spaces, setSpaces, projects } = bootstrap,
        project = spaces.find(s => s.id === space)?.project_id || params.get('project') || workspace.projectId;
    const [folders, setFolders] = useState<KnowledgeFolder[]>([]),
        [items, setItems] = useState<KnowledgeSummary[]>([]),
        [total, setTotal] = useState(0),
        [page, setPage] = useState(1),
        [query, setQuery] = useState(""),
        [folder, setFolder] = useState(""),
        [tags, setTags] = useState<{ tag: string; count: number }[]>([]),
        [tag, setTag] = useState(""),
        [trash, setTrash] = useState(false),
        [refresh, setRefresh] = useState(0),
        [relations, setRelations] = useState<KnowledgeRelations | null>(null);
    const { nav, refs, navWidth, refWidth, setNav, setRefs, setNavWidth, setRefWidth } = useKnowledgeLayout(user.id);
    const [properties, setProperties] = useState(false),
        [history, setHistory] = useState(false),
        [versions, setVersions] = useState<Awaited<ReturnType<typeof getKnowledgeHistory>>>([]),
        [version, setVersion] = useState<Awaited<ReturnType<typeof getKnowledgeVersion>> | null>(null),
        [form, setForm] = useState<"document" | "folder" | "folderEdit" | null>(null),
        [name, setName] = useState(""),
        [parent, setParent] = useState<string | null>(null),
        [error, setError] = useState(""), [listLoading, setListLoading] = useState(false), [spaceDenied, setSpaceDenied] = useState(false);
    const editor = useRef<EditorHandle>(null),
        file = useRef<HTMLInputElement>(null),
        root = useRef<HTMLDivElement>(null),
        q = useDeferredValue(query),
        theme = useThemeStore((s) => s.theme),
        setTheme = useThemeStore((s) => s.setTheme),
        t = canvasThemes[theme];
    const reloadList = useCallback(() => setRefresh((n) => n + 1), []),
        d = useKnowledgeDocument(user.id, space, id, reloadList),
        active = spaces.find((s) => s.id === space),
        canWrite = Boolean(!bootstrap.loading && !bootstrap.error && !spaceDenied && active && ["owner", "admin", "editor"].includes(active.role));
    const protectedNavigation = useRef(false), listSpace = useRef(space), navigationContext = useRef(''), overlays = useRef(new Set<{ destroy: () => void }>());
    navigationContext.current = space + ':' + id;
    const confirm = (config: Parameters<typeof modal.confirm>[0]) => { const dialog = modal.confirm(config); overlays.current.add(dialog); return dialog; };
    useEffect(() => () => { overlays.current.forEach(dialog => dialog.destroy()); overlays.current.clear(); }, [space, id]);
    const go = async (docId: string, newSpace = space) => {
        try {
            editor.current?.flush();
            await d.prepareLeave();
            protectedNavigation.current = true; queueMicrotask(() => { protectedNavigation.current = false; });
            setParams({ space: newSpace, ...(docId ? { doc: docId } : {}), project, view: docId ? 'document' : view });
            if (docId) setView("document");
        } catch (e) {
            message.error((e as Error).message);
        }
    };
    const actions = useKnowledgeActions(user.id, space, (action, result, startedUrl) => {
        reloadList();
        if (action.action === "document.create" || action.action === "document.import") {
            if (result.importedExisting) message.info("已存在相同文档，已打开原文");
            setTrash(false);
            if (startedUrl && startedUrl !== window.location.href) { message.info('文档已保存到原知识空间，可从最近编辑打开'); return; }
            void go(result.id);
        }
        if (action.action === "document.restore") void d.reload();
    });
    const backToLibrary = async () => {
        try { editor.current?.flush(); await d.prepareLeave(); protectedNavigation.current = true; queueMicrotask(() => { protectedNavigation.current = false; }); setView('document'); setParams({ space: active?.id || spaces.find(s => s.kind === 'personal')?.id || '', project, view: 'document' }); if (bootstrap.error) bootstrap.retry(); }
        catch (e) { message.error((e as Error).message); }
    };
    const importer = useMarkdownImport(space, folder, canWrite && actions.ready && !actions.pending, async () => { editor.current?.flush(); await d.prepareLeave(); }, actions.run);
    useEffect(() => {
        if (bootstrap.loading || bootstrap.error || space) return;
        const personal = spaces.find(s => s.kind === 'personal');
        if (personal) setParams(previous => { if (previous.has('space')) return previous; const next = new URLSearchParams(previous); next.set('space', personal.id); return next; }, { replace: true });
    }, [spaces, space, bootstrap.loading, bootstrap.error]);
    useEffect(() => { const requested = params.get('view'); setView(requested === 'graph' ? 'graph' : requested === 'document' || params.has('doc') ? 'document' : localStorage.getItem('knowledge:default-view:' + user.id) === 'graph' ? 'graph' : 'document'); }, [params, user.id]);
    useEffect(() => { setForm(null); setHistory(false); setProperties(false); setCanvasDocument(null); setVersion(null); setLinkDialog(null); }, [space, id]);
    useEffect(() => {
        if (!space || !active || bootstrap.loading || bootstrap.error) { setItems([]); setFolders([]); setTags([]); setTotal(0); setListLoading(false); return; }
        const controller = new AbortController();
        const changedSpace = listSpace.current !== space; listSpace.current = space;
        if (changedSpace) { setFolder(''); setTag(''); setQuery(''); setPage(1); setFolders([]); setTags([]); setTotal(0); }
        setListLoading(true);
        setError("");
        setItems([]);
        void Promise.all([listKnowledge(space, { q: changedSpace ? '' : q, tag: changedSpace ? '' : tag, folderId: changedSpace ? undefined : folder || undefined, deleted: trash, page: changedSpace ? 1 : page }, controller.signal), getKnowledgeFolders(space, controller.signal), getKnowledgeTags(space, controller.signal)])
            .then(([r, f, t]) => {
                if (controller.signal.aborted) return;
                setItems(r.items);
                setSpaceDenied(false);
                setTotal(r.total);
                setFolders(f);
                setTags(t);
            })
            .catch((e) => {
                if (!controller.signal.aborted) { setError(e.message); if ([401, 403, 404].includes(e.status)) { setSpaceDenied(true); setItems([]); setFolders([]); setTags([]); setTotal(0); } }
            }).finally(() => { if (!controller.signal.aborted) setListLoading(false); });
        return () => controller.abort();
    }, [space, q, tag, folder, trash, page, refresh, active?.id, bootstrap.loading, bootstrap.error]);
    useEffect(() => {
        setRelations(null);
        if (!space || !active || !id || view === "graph") return;
        let live = true;
        void getKnowledgeRelations(space, id)
            .then((v) => {
                if (live) setRelations(v);
            })
            .catch((e) => {
                if (live) setError(e.message);
            });
        return () => {
            live = false;
        };
    }, [space, id, refresh, view]);
    const save = useCallback(async () => {
        try {
            editor.current?.flush();
            await d.save();
        } catch (e) {
            message.info((e as Error).message);
        }
    }, [d.save]);
    const blocker = useBlocker(({ currentLocation, nextLocation }) => {
        if (protectedNavigation.current) { protectedNavigation.current = false; return false; }
        return (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search) && (d.dirty || Boolean(editor.current?.isDirty()));
    });
    useEffect(() => {
        if (blocker.state !== "blocked") return;
        const dialog = confirm({
            title: "离开知识库",
            content: "离开前会保护本页草稿，稍后可继续编辑。",
            okText: "保护草稿并离开",
            cancelText: "继续编辑",
            onOk: async () => {
                try {
                    editor.current?.flush();
                    await d.prepareLeave();
                    blocker.proceed();
                } catch (e) {
                    message.info((e as Error).message);
                    throw e;
                }
            },
            onCancel: () => blocker.reset(),
        });
        return () => dialog.destroy();
    }, [blocker.state]);
    useEffect(() => {
        const key = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                e.preventDefault();
                void save();
            }
        };
        window.addEventListener("keydown", key);
        return () => window.removeEventListener("keydown", key);
    }, [save]);
    const wikiState = useRef({ relations, space, id, folders, canWrite, d, actions, go });
    wikiState.current = { relations, space, id, folders, canWrite, d, actions, go };
    const onWiki = useCallback(async (target: string) => {
        const context = navigationContext.current;
        const { relations, space, id, folders, canWrite, d, actions, go } = wikiState.current;
        const relation = relations?.outgoing.find((l) => l.target_text === target);
        if (relation?.target_id) {
            await go(relation.target_id);
            return;
        }
        try {
            const key = target.split("#")[0].replace(/\.md$/i, "");
            const choices = relation?.choices.length ? relation.choices : (await listKnowledge(space, { q: key })).items.filter((d) => d.title === key).map((d) => ({ id: d.id, title: d.title, folder_id: d.folderId }));
            if (navigationContext.current !== context) return;
            if (choices.length === 1 && !relation) {
                await go(choices[0].id);
                return;
            }
            if (choices.length) {
                const picker = modal.info({
                    title: "选择引用的文档",
                    content: (
                        <div className="knowledge-choices">
                            <p>{canWrite ? "选择后绑定这条引用，Markdown 原文保持不变。" : "选择要预览的文档。"}</p>
                            {choices.map((c) => (
                                <Button
                                    type="text"
                                    key={c.id}
                                    onClick={async () => {
                                        if (canWrite && relation && d.document) {
                                            if (d.dirty || editor.current?.isDirty()) {
                                                message.info("请先保存当前文档，再选择引用目标");
                                                return;
                                            }
                                            const result = await actions.run({ operationId: crypto.randomUUID(), action: "document.resolveLink", payload: { id, expectedRevision: d.document.revision, ordinal: relation.ordinal, targetId: c.id } });
                                            if (!result) return;
                                        }
                                        picker.destroy();
                                        await go(c.id);
                                    }}
                                >
                                    {c.title} · {folderPath(folders, c.folder_id)} · {c.id.slice(0, 8)}
                                </Button>
                            ))}
                        </div>
                    ),
                });
                overlays.current.add(picker);
                return;
            }
            message.info("尚未解析到“" + target + "”，请新建或保存后重试。");
        } catch (e) {
            message.error((e as Error).message);
        }
    }, []);
    const newForm = (type: "document" | "folder" | "folderEdit") => {
        setForm(type);
        const current = folders.find((f) => f.id === folder);
        setName(type === "folderEdit" ? current?.name || "" : "");
        setParent(type === "folderEdit" ? (current?.parent_id ?? null) : folder || null);
    };
    const submit = async () => {
        if (!name.trim()) return;
        let action;
        if (form === "document") action = { action: "document.create", payload: { title: name.trim(), markdown: "", folderId: parent } };
        else if (form === "folder") action = { action: "folder.create", payload: { name: name.trim(), parentId: parent } };
        else {
            const f = folders.find((v) => v.id === folder)!;
            action = { action: "folder.save", payload: { id: f.id, name: name.trim(), parentId: parent, expectedRevision: f.revision } };
        }
        const r = await actions.run({ operationId: crypto.randomUUID(), ...action });
        if (r) setForm(null);
    };
    const chooseProject = async (projectId: string) => {
        try {
            editor.current?.flush();
            await d.prepareLeave();
            let s = spaces.find((v) => v.project_id === projectId);
            if (!s) {
                await ensureKnowledgeSpace("project", projectId);
                const all = await getKnowledgeSpaces();
                setSpaces(all);
                s = all.find((v) => v.project_id === projectId);
            }
            if (s) {
                setFolder("");
                setPage(1);
                protectedNavigation.current = true; queueMicrotask(() => { protectedNavigation.current = false; });
                setParams({ space: s.id, project: projectId, view });
            }
        } catch (e) {
            message.error((e as Error).message);
        }
    };
    const remove = () => {
        const doc = d.document;
        if (!doc) return;
        confirm({
            title: "移入回收站？",
            content: "原文和历史版本保留，可以恢复。",
            okText: "移入回收站",
            cancelText: "取消",
            onOk: async () => {
                const result = await actions.run({ operationId: crypto.randomUUID(), action: "document.delete", payload: { id: doc.id, expectedRevision: doc.revision } });
                if (result) {
                    await d.reload();
                    reloadList();
                }
            },
        });
    };
    const openHistory = async () => {
        if (!d.document) return;
        const context = navigationContext.current;
        setHistory(true);
        setVersion(null);
        setVersions([]);
        try {
            const result = await getKnowledgeHistory(space, id);
            if (navigationContext.current === context) setVersions(result);
        } catch (e) {
            message.error((e as Error).message);
        }
    };
    const restore = () => {
        if (!version || !d.document) return;
        confirm({
            title: "恢复到这个历史版本？",
            content: "这会生成新版本，保留现有历史；本页未保存内容另存为本机草稿副本。",
            okText: "恢复并生成新版本",
            cancelText: "取消",
            onOk: async () => {
                editor.current?.flush();
                await d.archiveDraft();
                const result = await actions.run({ operationId: crypto.randomUUID(), action: "document.restore", payload: { id, expectedRevision: d.document!.revision, version: version.revision } });
                if (result) {
                    await d.reload();
                    setHistory(false);
                }
            },
        });
    };
    const exportMarkdown = () => {
        let source: string | undefined;
        try {
            source = editor.current?.flush();
        } catch (e) {
            message.info((e as Error).message);
            return;
        }
        const doc = d.document;
        if (!doc) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([source ?? doc.markdown], { type: "text/markdown;charset=utf-8" }));
        a.download = doc.title.replace(/[\\/:*?"<>|]/g, "_") + ".md";
        a.click();
        URL.revokeObjectURL(a.href);
    };
    const resize = (side: "left" | "right", e: React.PointerEvent<HTMLDivElement>) => {
        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);
        const move = (event: PointerEvent) => {
            const box = root.current?.getBoundingClientRect();
            if (!box) return;
            const n = side === "left" ? event.clientX - box.left : box.right - event.clientX;
            const width = Math.max(220, Math.min(420, n));
            side === "left" ? setNavWidth(width) : setRefWidth(width);
        };
        target.addEventListener("pointermove", move);
        target.addEventListener("pointerup", () => target.removeEventListener("pointermove", move), { once: true });
    };
    const vars = { "--k-bg": t.canvas.background, "--k-paper": t.node.panel, "--k-text": t.node.text, "--k-muted": t.node.label, "--k-line": t.node.stroke, "--nav-width": navWidth + "px", "--ref-width": refWidth + "px" } as CSSProperties;
    const disabled = !canWrite || Boolean(d.document?.deletedAt);
    return (
        <div ref={root} className={`knowledge-page ${nav ? "nav-open" : ""} ${refs ? "refs-open" : ""}`} style={vars}>
            <div className="knowledge-mobile-bar">
                <button
                    aria-label="展开知识导航"
                    aria-expanded={nav}
                    onClick={() => {
                        setNav(!nav);
                        setRefs(false);
                    }}
                >
                    <PanelLeft size={17} />
                </button>
                <span>知识库</span>
                <button
                    aria-label="展开文档关系"
                    aria-expanded={refs}
                    onClick={() => {
                        setRefs(!refs);
                        setNav(false);
                    }}
                >
                    <PanelRight size={17} />
                </button>
            </div>
            <div className={`knowledge-panel-slot knowledge-panel-left ${nav ? "is-open" : ""}`} inert={!nav} style={{ width: nav ? navWidth + 4 : 0 }}>
                <Navigation
                    spaces={spaces}
                    space={space}
                    onSpace={(s) => {
                        setFolder("");
                        setPage(1);
                        void go("", s);
                    }}
                    folders={folders}
                    folder={folder}
                    onFolder={(f) => {
                        setFolder(f);
                        setPage(1);
                    }}
                    items={items}
                    total={total}
                    page={page}
                    onPage={setPage}
                    active={id}
                    onOpen={(doc) => void go(doc)}
                    query={query}
                    onQuery={(s) => {
                        setQuery(s);
                        setPage(1);
                    }}
                    tags={tags}
                    tag={tag}
                    onTag={(s) => {
                        setTag(s);
                        setPage(1);
                    }}
                    trash={trash}
                    onTrash={() => {
                        setTrash(!trash);
                        setPage(1);
                    }}
                    onNew={() => newForm("document")}
                    onFolderCreate={() => newForm("folder")}
                    onFolderEdit={() => newForm("folderEdit")}
                    onFolderDelete={() => {
                        const f = folders.find((v) => v.id === folder);
                        if (f)
                            confirm({
                                title: "删除空文件夹？",
                                content: "含有文档或子文件夹时将拒绝删除。",
                                onOk: async () => {
                                    const result = await actions.run({ operationId: crypto.randomUUID(), action: "folder.delete", payload: { id: f.id, expectedRevision: f.revision } });
                                    if (result) setFolder("");
                                },
                            });
                    }}
                    onCollapse={() => setNav(false)}
                    canWrite={canWrite && !actions.pending}
                />
                <div
                    className="knowledge-resizer left"
                    role="separator"
                    tabIndex={0}
                    aria-label="调整导航宽度"
                    aria-orientation="vertical"
                    aria-valuenow={navWidth}
                    onPointerDown={(e) => resize("left", e)}
                    onKeyDown={(e) => {
                        if (e.key === "ArrowLeft") setNavWidth((v) => Math.max(220, v - 10));
                        if (e.key === "ArrowRight") setNavWidth((v) => Math.min(420, v + 10));
                    }}
                />
            </div>
            <main className="knowledge-main" aria-busy={bootstrap.loading || listLoading || d.loading}>
                <header className="knowledge-context">
                    <div className="knowledge-breadcrumb">
                        <Button type="text" onClick={() => void backToLibrary()}>返回知识库</Button>
                        {!nav && (
                            <button aria-label="展开知识导航" onClick={() => setNav(true)}>
                                <PanelLeft size={16} />
                            </button>
                        )}
                        <BookOpen size={16} />
                        <span>{active?.name || "知识库"}</span>
                        <ChevronRight size={13} />
                        <span>{d.document?.title || "开始记录"}</span>
                    </div>
                    <div className="knowledge-view-switch" role="group" aria-label="知识库视图">
                        <Button type="text" aria-pressed={view === "document"} onClick={() => void switchView("document")} icon={<BookOpen size={14} />}>
                            文档
                        </Button>
                        <Button type="text" aria-pressed={view === "graph"} onClick={() => void switchView("graph")} icon={<Network size={14} />}>
                            知识图谱
                        </Button>
                        <Tooltip title={defaultView === view ? "当前默认视图" : "将当前视图设为默认"}>
                            <Button
                                type="text"
                                aria-label="设为默认视图"
                                aria-pressed={defaultView === view}
                                icon={<Pin size={13} />}
                                onClick={() => {
                                    localStorage.setItem("knowledge:default-view:" + user.id, view);
                                    setDefaultView(view);
                                    message.success("已设置默认视图");
                                }}
                            />
                        </Tooltip>
                    </div>
                    <div className="knowledge-context-actions">
                        <Button type="text" disabled={!id || !!d.document?.deletedAt} onClick={() => setCanvasDocument(id)}>添加到画布</Button>
                        <Select
                            aria-label="选择项目知识库"
                            placeholder="切换项目知识库"
                            value={active?.kind === "project" ? project : undefined}
                            onChange={(v) => void chooseProject(v)}
                            options={projects.map((p) => ({ value: p.projectId, label: p.projectTitle }))}
                        />
                        <button aria-label="切换主题" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
                            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
                        </button>
                        {!refs && view === "document" && (
                            <button aria-label="展开文档关系" onClick={() => setRefs(true)}>
                                <PanelRight size={16} />
                            </button>
                        )}
                    </div>
                </header>
                {(error || d.error) && <Alert type="warning" showIcon title={error || d.error} action={<Button onClick={() => { reloadList(); if (d.error) d.retryLoad(); }}>重试知识请求</Button>} />}
                {(bootstrap.error || bootstrap.projectError || importer.error) && <Alert type="warning" showIcon title={bootstrap.error || bootstrap.projectError || importer.error} action={<Button onClick={bootstrap.retry}>重试加载知识库</Button>} />}
                {importer.reading && <Alert type="info" title={actions.busy ? '正在导入 Markdown；你可以返回知识库，原操作会保留回执' : '正在读取 Markdown 文件'} />}
                {actions.pending && (
                    <Alert
                        type="warning"
                        showIcon
                        title="管理操作尚未确认"
                        description={actions.error || "已记录原操作ID，禁止换ID重复创建。"}
                        action={
                            <Button disabled={actions.busy} onClick={() => void actions.run()}>
                                查询并重试原操作
                            </Button>
                        }
                    />
                )}
                {actions.busy && <Button type="text" onClick={actions.stopWaiting}>停止等待并保留原操作</Button>}
                {actions.error && !actions.pending && <Alert type="warning" title={actions.error} />}
                {d.conflict && (
                    <Alert
                        type="warning"
                        showIcon
                        title="版本冲突：本机草稿未覆盖服务器"
                        description="先比较内容，再明确选择。"
                        action={
                            <Button
                                onClick={async () => {
                                    const remote = await getKnowledgeDocument(space, id);
                                    confirm({
                                        title: "比较并处理冲突",
                                        width: 850,
                                        content: (
                                            <div className="knowledge-conflict">
                                                <section>
                                                    <h4>本机草稿</h4>
                                                    <pre>{d.document?.markdown}</pre>
                                                </section>
                                                <section>
                                                    <h4>服务器 · 版本 {remote.revision}</h4>
                                                    <pre>{remote.markdown}</pre>
                                                </section>
                                            </div>
                                        ),
                                        okText: "以最新版本保存本机内容",
                                        cancelText: "仅查看服务器（保留草稿）",
                                        onOk: async () => {
                                            try {
                                                await d.rebase(remote.revision);
                                            } catch (e) {
                                                message.info((e as Error).message);
                                                throw e;
                                            }
                                        },
                                        onCancel: () => d.loadServer(),
                                    });
                                }}
                            >
                                比较与处理
                            </Button>
                        }
                    />
                )}
                {bootstrap.loading || (!space && !bootstrap.error) ? <div className="knowledge-empty" role="status"><Spin /><h1>正在加载知识空间</h1><p>正在验证账号权限与个人知识库。</p></div> : bootstrap.error || !active || spaceDenied ? <div className="knowledge-empty"><h1>{bootstrap.error ? '知识空间加载失败' : '知识空间不存在或无权访问'}</h1><p>这不是空知识库。请重试或选择可访问的知识空间。</p><Button onClick={bootstrap.retry}>重试加载知识库</Button><Button disabled={!spaces.some(s => s.kind === 'personal')} onClick={() => void go('', spaces.find(s => s.kind === 'personal')!.id)}>返回个人知识库</Button></div> : view === "graph" ? (
                    <KnowledgeSectionBoundary key={space + ':graph'} onBack={() => void switchView('document')}>
                    <Suspense
                        fallback={
                            <div className="knowledge-empty">
                                <Spin />
                                <p>正在加载知识图谱</p>
                            </div>
                        }
                    >
                        <Graph
                            canWrite={canWrite}
                            onRelate={(sourceId, mode) => { void (async () => { try { editor.current?.flush(); await d.prepareLeave(); if (mode !== 'view' && (!canWrite || d.dirty || editor.current?.isDirty())) { message.info('请先保存当前草稿，再建立或移除关联；草稿已保留'); return; } setLinkDialog({ id: sourceId, mode }); } catch (e) { message.error((e as Error).message); } })(); }}
                            onAdd={setCanvasDocument}
                            key={space}
                            actor={user.id}
                            space={space}
                            documentId={id}
                            folderId={folder}
                            tag={tag}
                            theme={theme}
                            onOpen={async (doc) => {
                                await go(doc);
                            }}
                            onDocument={() => void switchView("document")}
                        />
                    </Suspense>
                    </KnowledgeSectionBoundary>
                ) : d.loading ? (
                    <div className="knowledge-empty">
                        <Spin />
                        <p>正在读取文档</p>
                    </div>
                ) : d.document ? (
                    <article key={d.document.id} className="knowledge-document" onBlur={() => void d.save()}>
                        <div className="knowledge-document-heading">
                            <div className="knowledge-eyebrow">
                                {active?.kind === "personal" ? "个人知识资产" : "项目知识"} <span>版本 {d.document.revision}</span>
                                {d.document.deletedAt && <span>回收站</span>}
                            </div>
                            <Input className="knowledge-title" aria-label="文档标题" placeholder="文档标题" value={d.document.title} disabled={disabled} onChange={(e) => d.change({ title: e.target.value })} />
                            <div className="knowledge-document-actions">
                                <span className="knowledge-save-status" role="status" data-testid="save-status">
                                    <i className={d.status === "已保存" ? "saved" : ""} />
                                    {d.status}
                                </span>
                                <div>
                                    <Tooltip title="保存 Ctrl/⌘ S">
                                        <Button type="text" aria-label="保存文档" disabled={disabled || actions.busy} icon={<Save size={15} />} onClick={() => void save()}>
                                            保存
                                        </Button>
                                    </Tooltip>
                                    <Button type="text" aria-label="导出Markdown" icon={<Download size={15} />} onClick={exportMarkdown} />
                                    <Button type="text" aria-label="文档历史" icon={<History size={15} />} onClick={() => void openHistory()} />
                                    <Button type="text" aria-label="文档属性" icon={<Info size={15} />} onClick={() => setProperties(true)} />
                                    <Button type="text" aria-label="删除文档" disabled={disabled || d.dirty} icon={<Trash2 size={15} />} onClick={remove} />
                                </div>
                            </div>
                        </div>
                        <KnowledgeSectionBoundary key={space + ':' + id} onBack={() => void go('')}><Suspense
                            fallback={
                                <div className="knowledge-empty">
                                    <Spin />
                                    正在加载编辑器
                                </div>
                            }
                        >
                            <Editor
                                locate={locate?.id === id ? locate : undefined}
                                ref={editor}
                                key={d.document.id}
                                id={d.document.id}
                                spaceId={space}
                                source={d.document.markdown}
                                disabled={disabled}
                                onChange={(markdown) => d.change({ markdown })}
                                onComposition={d.setComposing}
                                onWiki={onWiki}
                                onRichDraft={d.protectRich}
                                restoredRich={d.restoredRich}
                            />
                        </Suspense></KnowledgeSectionBoundary>
                    </article>
                ) : (
                    <div className="knowledge-empty">
                        <BookOpen size={42} strokeWidth={1} />
                        <h1>{listLoading ? '正在加载文档列表' : error || d.error ? '知识内容加载失败' : folder && !total ? '当前文件夹还没有文档' : q || tag || trash ? '当前筛选没有匹配文档' : total ? "知识，正在连成网络" : "让想法有迹可循"}</h1>
                        <p>{error || d.error ? '请重试请求，原文和本机草稿保留。' : total ? `最近编辑与搜索在左侧，${total} 篇文档等待继续探索。` : "记录、连接，再回到创作。你的知识独立保存。"}</p>
                        {(error || d.error) && <Button onClick={() => { reloadList(); d.retryLoad(); }}>重试知识请求</Button>}
                        {!!total && (
                            <Button type="text" icon={<Network size={17} />} onClick={() => void switchView("graph")}>
                                探索知识图谱
                            </Button>
                        )}
                        <Button type="text" disabled={!canWrite} icon={<FileText size={16} />} onClick={() => newForm("document")}>
                            写下第一篇文档
                        </Button>
                        <Button type="text" disabled={!canWrite || !actions.ready || Boolean(actions.pending) || importer.reading} icon={<Upload size={16} />} onClick={() => file.current?.click()}>
                            导入 Markdown
                        </Button>
                    </div>
                )}
                {view === "document" && (
                    <footer className="knowledge-page-footer">
                        <span>{d.document ? d.document.markdown.length.toLocaleString() + " 字符 · Markdown 原文" : "原生知识库"}</span>
                        <Button type="text" size="small" disabled={!canWrite || !actions.ready || Boolean(actions.pending) || importer.reading} icon={<Upload size={13} />} onClick={() => file.current?.click()}>
                            导入 Markdown
                        </Button>
                    </footer>
                )}
            </main>
            <div className={`knowledge-panel-slot knowledge-panel-right ${refs && view === "document" ? "is-open" : ""}`} inert={!(refs && view === "document")} style={{ width: refs && view === "document" ? refWidth + 4 : 0 }}>
                <div
                    className="knowledge-resizer right"
                    role="separator"
                    tabIndex={0}
                    aria-label="调整关系宽度"
                    aria-orientation="vertical"
                    aria-valuenow={refWidth}
                    onPointerDown={(e) => resize("right", e)}
                    onKeyDown={(e) => {
                        if (e.key === "ArrowLeft") setRefWidth((v) => Math.min(420, v + 10));
                        if (e.key === "ArrowRight") setRefWidth((v) => Math.max(220, v - 10));
                    }}
                />
                <Relations relations={spaceDenied ? null : relations} onOpen={(doc) => void go(doc)} onWiki={onWiki} onCollapse={() => setRefs(false)} />
            </div>
            <input
                type="file"
                accept=".md,.markdown,text/markdown"
                hidden
                ref={file}
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void importer.importFile(f);
                    e.target.value = "";
                }}
            />
            <Modal
                open={Boolean(form)}
                title={form === "document" ? "新建文档" : form === "folderEdit" ? "重命名或移动文件夹" : "新建文件夹"}
                okText="确定"
                cancelText="取消"
                confirmLoading={actions.busy}
                onOk={() => void submit()}
                onCancel={() => setForm(null)}
            >
                <Input autoFocus aria-label="名称" placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} onPressEnter={() => void submit()} />
                <Select
                    aria-label="所属文件夹"
                    className="knowledge-form-select"
                    value={parent || ""}
                    onChange={(v) => setParent(v || null)}
                    options={[{ value: "", label: "根目录" }, ...folders.filter((f) => form !== "folderEdit" || f.id !== folder).map((f) => ({ value: f.id, label: folderPath(folders, f.id) }))]}
                />
            </Modal>
            <Drawer open={properties} title="文档属性" onClose={() => setProperties(false)}>
                {d.document && (
                    <div className="knowledge-properties">
                        <label>文档 ID</label>
                        <code>{d.document.id}</code>
                        <label>保存位置</label>
                        <Select
                            aria-label="文档所在文件夹"
                            disabled={disabled}
                            value={d.document.folderId || ""}
                            onChange={(v) => d.change({ folderId: v || null })}
                            options={[{ value: "", label: "根目录" }, ...folders.map((f) => ({ value: f.id, label: folderPath(folders, f.id) }))]}
                        />
                        <label>内容 SHA256</label>
                        <code>{d.document.contentHash}</code>
                        <label>最近更新</label>
                        <span>{new Date(d.document.updatedAt).toLocaleString()}</span>
                        <label>Frontmatter 原文</label>
                        <pre>{d.document.markdown.startsWith("---\n") ? d.document.markdown.slice(0, d.document.markdown.indexOf("\n---", 4) + 4) : "无 Frontmatter"}</pre>
                        <label>其他页面 / 历史本机草稿</label>
                        {d.otherDrafts.map((v) => (
                            <Button key={v.key} onClick={() => void d.adopt(v.draft)}>
                                {new Date(v.draft.updatedAt).toLocaleString()} · {v.draft.document.title}
                            </Button>
                        ))}
                    </div>
                )}
            </Drawer>
            <AddToCanvas target={canvasDocument && active ? { space: active, documentId: canvasDocument } : null} projectId={project} prepareLeave={async () => { editor.current?.flush(); await d.prepareLeave(); }} onClose={() => setCanvasDocument(null)} />
            {linkDialog && <KnowledgeLinkDialog key={space + ':' + linkDialog.id + ':' + linkDialog.mode} actor={user.id} space={space} sourceId={linkDialog.id} mode={linkDialog.mode} onClose={() => setLinkDialog(null)} onSaved={sourceId => { reloadList(); if (sourceId === id && !d.dirty) void d.reload(); }} onOpen={(sourceId, start, end) => { setLinkDialog(null); void go(sourceId).then(() => { if (start !== undefined) setLocate({ id: sourceId, start, end: end ?? start, token: crypto.randomUUID() }); }); }} />}
            <Drawer open={history} title="历史版本" width="min(680px, 100vw)" onClose={() => setHistory(false)}>
                <div className="knowledge-history">
                    {versions.map((v) => (
                        <Button type="text" key={v.revision} onClick={() => void getKnowledgeVersion(space, id, v.revision).then(setVersion)}>
                            <History size={14} />
                            版本 {v.revision} · {v.title} · {new Date(v.created_at).toLocaleString()}
                            {v.deleted_at ? " · 已删除" : ""}
                        </Button>
                    ))}
                </div>
                {version && (
                    <>
                        <h3>
                            版本 {version.revision} · {version.title}
                        </h3>
                        <pre className="knowledge-history-preview">{version.markdown}</pre>
                        <Button disabled={!canWrite || actions.busy} onClick={restore}>
                            恢复此版本
                        </Button>
                    </>
                )}
            </Drawer>
        </div>
    );
}

