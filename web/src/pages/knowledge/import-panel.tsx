import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Alert, App, Button, Checkbox, Drawer, Input, Progress, Select, Spin, Upload } from "antd";
import { FileUp, Download, RotateCcw } from "lucide-react";
import localforage from "localforage";
import { getImport, getImportOperation, listImports, uploadImport, importChange, getImportSources, reparseImport, originalImportUrl, type ImportTask } from "@/services/api/knowledge-import";
import { getKnowledgeDocument, type KnowledgeFolder } from "@/services/api/knowledge";
import { useKnowledgeActions } from "./use-actions";
import { folderPath } from "./navigation";
import type { EditorHandle } from "./editor";
import type { JSONContent } from "@tiptap/core";
const Editor = lazy(() => import("./editor"));
const drafts = localforage.createInstance({ name: "infinite-canvas", storeName: "knowledge_import_drafts" });
const states: Record<string, string> = { uploading: "上传中", queued: "等待解析", parsing: "正在解析", awaiting_confirmation: "等待确认", failed: "转换失败", completed: "已保存", cancelled: "已取消", cleaned: "暂存已清理" };
export default function ImportPanel({
    actor,
    space,
    spaceName,
    folder,
    folders,
    documentId,
    canWrite,
    prepareLeave,
    onSaved,
    request,
}: {
    actor: string;
    space: string;
    spaceName: string;
    folder: string;
    folders: KnowledgeFolder[];
    documentId: string;
    canWrite: boolean;
    prepareLeave: () => Promise<void>;
    onSaved: (id: string) => void;
    request: number;
}) {
    const { message } = App.useApp();
    const [open, setOpen] = useState(false),
        [tasks, setTasks] = useState<ImportTask[]>([]),
        [task, setTask] = useState<ImportTask | null>(null),
        [title, setTitle] = useState(""),
        [body, setBody] = useState(""),
        [target, setTarget] = useState(folder),
        [error, setError] = useState(""),
        [busy, setBusy] = useState(false),
        [progress, setProgress] = useState(0),
        [duplicate, setDuplicate] = useState(false),
        [before, setBefore] = useState<string | null>(null),
        [sources, setSources] = useState<Awaited<ReturnType<typeof getImportSources>>>([]);
    const editor = useRef<EditorHandle>(null),
        active = useRef(space),
        flight = useRef(false),
        generation = useRef(0),
        loaded = useRef(""),
        bodyRef = useRef(body);
    const [richDraft, setRichDraft] = useState<{ id: string; content: JSONContent } | undefined>();
    const rich = useRef<JSONContent | undefined>(undefined);
    active.current = space;
    bodyRef.current = body;
    useEffect(() => {
        active.current = space;
        return () => {
            active.current = "";
            generation.current++;
        };
    }, [space]);
    const actions = useKnowledgeActions(
        actor,
        space,
        (_op, result) => {
            window.dispatchEvent(new Event("knowledge:changed"));
            setOpen(false);
            setTask(null);
            onSaved(result.id);
        },
        "material-import",
    );
    const refresh = async () => {
        const owner = space;
        const items = await listImports(space);
        if (active.current === owner) setTasks(items);
    };
    const select = async (id: string) => {
        const token = ++generation.current;
        setError("");
        setBefore(null);
        try {
            editor.current?.flush();
            const t = await getImport(space, id),
                saved = await drafts.getItem<{ title: string; body: string; folder: string; rich?: JSONContent }>(actor + ":" + space + ":" + id);
            if (token !== generation.current || active.current !== space) return;
            loaded.current = id;
            setTask(t);
            setTitle(saved?.title ?? t.filename.replace(/\.[^.]+$/, ""));
            setBody(saved?.body ?? t.markdown ?? "");
            setTarget(saved?.folder ?? t.folder_id ?? "");
            setDuplicate(false);
            rich.current = saved?.rich;
            setRichDraft(saved?.rich ? { id: crypto.randomUUID(), content: saved.rich } : undefined);
            if (t.reparse_document_id) {
                const current = await getKnowledgeDocument(space, t.reparse_document_id);
                if (token === generation.current) setBefore(current.markdown);
            }
        } catch (e) {
            if (token === generation.current) setError((e as Error).message);
        }
    };
    useEffect(() => {
        generation.current++;
        loaded.current = "";
        setOpen(false);
        setTask(null);
        setTasks([]);
        setSources([]);
        setError("");
        setBusy(false);
        setRichDraft(undefined);
        rich.current = undefined;
    }, [space]);
    useEffect(() => {
        if (!open || !space) return;
        let live = true;
        const poll = async () => {
            const version = generation.current;
            try {
                const items = await listImports(space);
                if (!live || version !== generation.current) return;
                setTasks(items);
                if (task && ["queued", "parsing", "uploading"].includes(task.state)) {
                    const next = await getImport(space, task.id);
                    if (!live || version !== generation.current) return;
                    setTask(next);
                    if (next.state === "awaiting_confirmation") setBody(next.markdown ?? "");
                }
            } catch (e) {
                if (live) setError((e as Error).message);
            }
        };
        void poll();
        const interval = setInterval(() => void poll(), 1500);
        return () => {
            live = false;
            clearInterval(interval);
        };
    }, [open, space, task?.id, task?.state]);
    useEffect(() => {
        let live = true;
        setSources([]);
        if (documentId && space)
            void getImportSources(space, documentId)
                .then((v) => {
                    if (live) setSources(v);
                })
                .catch(() => {});
        return () => {
            live = false;
        };
    }, [space, documentId, open]);
    useEffect(() => {
        if (!task || task.state !== "awaiting_confirmation" || loaded.current !== task.id) return;
        const key = actor + ":" + space + ":" + task.id;
        void drafts.setItem(key, { title, body, folder: target, rich: rich.current }).catch(() => setError("本机预览草稿无法保存，请勿关闭页面"));
    }, [title, body, target, task?.id, task?.state, actor, space]);
    const start = async () => {
        try {
            await prepareLeave();
        } catch (e) {
            message.error((e as Error).message);
            return;
        }
        if (active.current !== space) return;
        try {
            setOpen(true);
            setError("");
            await refresh();
        } catch (e) {
            setError((e as Error).message);
            setOpen(true);
        }
    };
    useEffect(() => {
        if (request) void start();
    }, [request]);
    const choose = async (file: File) => {
        if (flight.current) {
            setError("上一次上传仍在后台确认，请稍后重试；原操作不会重复创建文档");
            return false;
        }
        if (!/\.(docx|pdf|txt|md|markdown)$/i.test(file.name) || !file.size || file.size > 10 * 1024 * 1024) {
            setError("请选择不超过10MiB的 DOCX、文字型 PDF、TXT 或 Markdown 文件");
            return false;
        }
        flight.current = true;
        setBusy(true);
        setProgress(0);
        setError("");
        const owner = space;
        try {
            await prepareLeave();
            if (active.current !== owner) return false;
            const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), (x) => x.toString(16).padStart(2, "0")).join("");
            const key = `upload:${actor}:${space}:${hash}:${file.name}:${folder}`,
                record = await drafts.getItem<{ operationId: string; id?: string }>(key),
                operationId = record?.operationId ?? crypto.randomUUID();
            await drafts.setItem(key, { operationId });
            let t: ImportTask | undefined;
            if (record)
                try {
                    t = await getImportOperation(space, operationId);
                } catch (e) {
                    if ((e as { code?: string }).code !== "KNOWLEDGE_IMPORT_OPERATION_NOT_FOUND") throw e;
                }
            if (t?.state === "uploading") t = undefined;
            t ??= await uploadImport(space, operationId, file, folder || null, setProgress);
            await drafts.setItem(key, { operationId, id: t.id });
            // Completed/cancelled task selected again is a new explicit upload, not an automatic retry.
            if (["completed", "cancelled", "cleaned"].includes(t.state)) {
                await drafts.removeItem(key);
                setError("此文件已有导入记录。已打开记录；如需独立副本，请再次选择文件并确认重复导入。");
            }
            if (active.current === owner) {
                await select(t.id);
                await refresh();
            }
        } catch (e) {
            if (active.current === owner) setError((e as Error).message);
        } finally {
            flight.current = false;
            if (active.current === owner) setBusy(false);
        }
        return false;
    };
    const confirm = async () => {
        if (!task) return;
        try {
            const markdown = editor.current?.flush() ?? bodyRef.current;
            await actions.run({ operationId: crypto.randomUUID(), action: "document.importConfirm", payload: { taskId: task.id, title, markdown, folderId: target || null, allowDuplicate: duplicate } });
        } catch (e) {
            setError((e as Error).message);
        }
    };
    const change = async (action: "cancel" | "retry") => {
        if (!task) return;
        const owner = space,
            version = generation.current;
        setBusy(true);
        try {
            const t = await importChange(space, task.id, action);
            if (active.current !== owner || generation.current !== version) return;
            setTask(t);
            await refresh();
        } catch (e) {
            if (active.current === owner) setError((e as Error).message);
        } finally {
            if (active.current === owner) setBusy(false);
        }
    };
    const reparse = async (id: string) => {
        const owner = space;
        setOpen(true);
        setBusy(true);
        try {
            await prepareLeave();
            if (active.current !== owner) return;
            const key = `reparse:${actor}:${space}:${id}`;
            let op = await drafts.getItem<string>(key);
            if (!op) {
                op = crypto.randomUUID();
                await drafts.setItem(key, op);
            }
            const t = await reparseImport(space, id, op);
            if (active.current !== owner) return;
            await select(t.id);
            await drafts.removeItem(key);
        } catch (e) {
            if (active.current === owner) setError((e as Error).message);
        } finally {
            if (active.current === owner) setBusy(false);
        }
    };
    return (
        <>
            <Button type="text" icon={<FileUp size={15} />} disabled={!canWrite} onClick={() => void start()}>
                导入资料
            </Button>
            {sources.length > 0 && (
                <Button
                    type="text"
                    onClick={() => {
                        setOpen(true);
                        void select(sources[0].id);
                    }}
                >
                    原始资料
                </Button>
            )}
            <Drawer
                title="导入资料"
                open={open}
                size="large"
                onClose={() => {
                    try {
                        editor.current?.flush();
                        setOpen(false);
                    } catch (e) {
                        setError((e as Error).message);
                    }
                }}
                styles={{ wrapper: { width: "min(1000px, 100vw)", maxWidth: "100vw" }, body: { padding: 20 } }}
                extra={
                    <Button
                        type="text"
                        onClick={() => {
                            try {
                                editor.current?.flush();
                                setOpen(false);
                            } catch (e) {
                                setError((e as Error).message);
                            }
                        }}
                    >
                        返回知识库
                    </Button>
                }
            >
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 16 }}>
                    <span>当前知识空间：{spaceName} · 文件上传后暂存，确认保存才会创建文档。</span>
                    {(error || actions.error) && (
                        <Alert
                            type="error"
                            showIcon
                            title={error || actions.error}
                            action={
                                <Button
                                    onClick={() =>
                                        void refresh()
                                            .then(() => setError(""))
                                            .catch((e) => setError(e.message))
                                    }
                                >
                                    重试查询
                                </Button>
                            }
                        />
                    )}
                    {actions.pending && (
                        <Alert
                            type="warning"
                            title="保存结果待确认，保留原操作后查询回执"
                            action={
                                <Button loading={actions.busy} onClick={() => void actions.run()}>
                                    确认原操作结果
                                </Button>
                            }
                        />
                    )}
                    <Upload.Dragger accept=".docx,.pdf,.txt,.md,.markdown" multiple={false} showUploadList={false} disabled={busy || Boolean(actions.pending)} beforeUpload={choose}>
                        <FileUp size={24} style={{ margin: "0 auto 8px" }} />
                        <p>拖拽或选择资料</p>
                        <p>DOCX / 文字型 PDF / TXT / Markdown · 最大 10 MiB · 扫描件暂需 OCR</p>
                    </Upload.Dragger>
                    {busy && <Progress percent={progress} status="active" />}
                    {tasks.length > 0 && (
                        <Select aria-label="恢复导入任务" placeholder="恢复最近导入任务" value={task?.id} onChange={(id) => void select(id)} options={tasks.map((t) => ({ value: t.id, label: `${t.filename} · ${states[t.state] || t.state}` }))} />
                    )}
                    {task && (
                        <div className="knowledge-import-preview" style={{ display: "grid", gridTemplateColumns: "minmax(180px, .65fr) minmax(0, 1.5fr)", gap: 20 }}>
                            <aside style={{ minWidth: 0, overflowWrap: "anywhere", display: "flex", flexDirection: "column", gap: 12 }}>
                                <strong>{task.filename}</strong>
                                <span>{states[task.state] || task.state}</span>
                                <span>{Number(task.bytes).toLocaleString()} 字节</span>
                                <small>SHA256：{task.sha256}</small>
                                <small>{task.converter || "等待转换器"}</small>
                                <span>原件信息（不是原文渲染预览）</span>
                                <a href={originalImportUrl(space, task.id)} download>
                                    <Download size={14} /> 下载原件
                                </a>
                                {task.pages?.map((p) => (
                                    <small key={p.page}>
                                        第{p.page}页 · {p.characters}字符
                                    </small>
                                ))}
                                {task.state === "completed" && (
                                    <>
                                        <Button disabled={!canWrite} icon={<RotateCcw size={14} />} onClick={() => void reparse(task.id)}>
                                            重新解析并比较
                                        </Button>
                                        <Button
                                            onClick={() => {
                                                setOpen(false);
                                                if (task.document_id) onSaved(task.document_id);
                                            }}
                                        >
                                            打开知识文档
                                        </Button>
                                    </>
                                )}
                                {task.state === "failed" && (
                                    <Button loading={busy} onClick={() => void change("retry")}>
                                        重试转换
                                    </Button>
                                )}
                                {!["completed", "cancelled", "cleaned"].includes(task.state) && (
                                    <Button disabled={busy || actions.busy || Boolean(actions.pending)} onClick={() => void change("cancel")}>
                                        取消本次导入
                                    </Button>
                                )}
                            </aside>
                            <section style={{ minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 }}>
                                {task.error && <Alert type="error" title={task.error} />}
                                {task.warnings?.length > 0 && (
                                    <Alert
                                        type="warning"
                                        title="部分内容可能无法完整识别，请核对后保存。"
                                        description={task.warnings.map((w, i) => (
                                            <p key={i}>{w}</p>
                                        ))}
                                    />
                                )}
                                {["queued", "parsing", "uploading"].includes(task.state) && <Alert type="info" title="任务继续在后台处理；可返回知识库，重新打开或刷新后恢复。" />}
                                {task.state === "awaiting_confirmation" && (
                                    <>
                                        <Input aria-label="导入文档标题" value={title} onChange={(e) => setTitle(e.target.value)} />
                                        <Select aria-label="导入保存目录" value={target} onChange={setTarget} options={[{ value: "", label: "根目录" }, ...folders.map((f) => ({ value: f.id, label: folderPath(folders, f.id) }))]} />
                                        {before !== null && (
                                            <details>
                                                <summary>对比当前正文与重新解析结果（确认后创建新版本，不覆盖历史）</summary>
                                                <pre style={{ whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto" }}>{before}</pre>
                                            </details>
                                        )}
                                        <Suspense fallback={<Spin />}>
                                            <Editor
                                                key={task.id}
                                                ref={editor}
                                                id={"import-" + task.id}
                                                spaceId={space}
                                                source={body}
                                                initialMode={richDraft ? "source" : "rich"}
                                                restoredRich={richDraft}
                                                disabled={actions.busy || Boolean(actions.pending)}
                                                onChange={(value) => {
                                                    rich.current = undefined;
                                                    setBody(value);
                                                }}
                                                onComposition={() => {}}
                                                onWiki={() => {}}
                                                onRichDraft={(content) => {
                                                    rich.current = content;
                                                    void drafts.setItem(actor + ":" + space + ":" + task.id, { title, body: bodyRef.current, folder: target, rich: content }).catch(() => setError("富文本草稿保存失败，请勿关闭页面"));
                                                }}
                                            />
                                        </Suspense>
                                        {task.duplicateDocumentId && !task.reparse_document_id && (
                                            <Checkbox checked={duplicate} onChange={(e) => setDuplicate(e.target.checked)}>
                                                此文件已导入，仍创建一个独立副本
                                            </Checkbox>
                                        )}
                                        <Button
                                            type="primary"
                                            loading={actions.busy}
                                            disabled={!title.trim() || !actions.ready || Boolean(actions.pending) || Boolean(task.duplicateDocumentId && !task.reparse_document_id && !duplicate)}
                                            onClick={() => void confirm()}
                                        >
                                            确认保存知识文档
                                        </Button>
                                    </>
                                )}
                            </section>
                        </div>
                    )}
                </div>
            </Drawer>
        </>
    );
}
