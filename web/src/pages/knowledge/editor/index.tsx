import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Editor, type JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
import { Button, Alert, Tooltip } from "antd";
import { Bold, Italic, Heading2, List, Code2, ShieldCheck, Undo2, Redo2, Link2 } from "lucide-react";
import { editorExtensions } from "./extensions";
import { guardRoundTrip } from "./content-policy";
import { listKnowledge } from "@/services/api/knowledge";
import { useThemeStore } from "@/stores/use-theme-store";

export type EditorHandle = { flush: () => string | undefined; isDirty: () => boolean };
type Props = {
    id: string;
    spaceId: string;
    source: string;
    disabled: boolean;
    onChange: (source: string) => void;
    onComposition: (value: boolean) => void;
    onWiki: (target: string) => void;
    onRichDraft: (content: JSONContent) => void;
    restoredRich?: { id: string; content: JSONContent };
    locate?: { start: number; end: number; token: string };
    initialMode?: 'source' | 'rich';
};
const KnowledgeEditor = forwardRef<EditorHandle, Props>(function KnowledgeEditor({ id, spaceId, source, disabled, onChange, onComposition, onWiki, onRichDraft, restoredRich, locate, initialMode = 'source' }, ref) {
    const sourceView = useRef<EditorView | null>(null);
    const locateSource = (view: EditorView) => { if (!locate || !view.dom.isConnected) return; const from = Math.max(0, Math.min(locate.start, view.state.doc.length)), to = Math.max(0, Math.min(locate.end, view.state.doc.length)); view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from) }); view.focus(); };
    const dark = useThemeStore((s) => s.theme) === "dark",
        [mode, setMode] = useState<"source" | "rich">("source"),
        [reasons, setReasons] = useState<string[]>([]),
        [composing, setComposing] = useState(false),
        [richQuery, setRichQuery] = useState<string | null>(null),
        [choices, setChoices] = useState<{ id: string; title: string }[]>([]);
    const compose = useRef(false),
        edited = useRef(false),
        syncing = useRef(false),
        activeMode = useRef(mode),
        lastMarkdown = useRef(source),
        restoredId = useRef<string | undefined>(undefined),
        idle = useRef<number | undefined>(undefined),
        change = useRef(onChange),
        flushRef = useRef(() => {});
    activeMode.current = mode;
    change.current = onChange;
    const editor = useEditor({
        extensions: editorExtensions(),
        content: "",
        contentType: "markdown",
        editable: !disabled,
        immediatelyRender: false,
        editorProps: {
            attributes: { "aria-label": "富文本文档编辑器", role: "textbox", "aria-multiline": "true", class: "knowledge-prose" },
            handleDOMEvents: {
                compositionstart: () => {
                    compose.current = true;
                    setComposing(true);
                    onComposition(true);
                    return false;
                },
                compositionend: () => {
                    compose.current = false;
                    setComposing(false);
                    onComposition(false);
                    requestAnimationFrame(() => flushRef.current());
                    return false;
                },
                click: (_v, event) => {
                    const target = (event.target as HTMLElement).closest("[data-wiki-link]")?.getAttribute("data-wiki-link");
                    if (target) {
                        onWiki(target);
                        return true;
                    }
                    return false;
                },
            },
        },
        onUpdate: ({ editor: e }) => {
            if (syncing.current || activeMode.current !== "rich") return;
            edited.current = true;
            onComposition(true);
            const pos = e.state.selection.from,
                text = e.state.doc.textBetween(Math.max(0, pos - 100), pos, "\n"),
                match = /\[\[([^\]\n]*)$/.exec(text);
            setRichQuery(match?.[1] ?? null);
            if (!compose.current) onRichDraft(e.getJSON());
        },
    });
    useEffect(() => { if (locate) { setMode('source'); if (sourceView.current) locateSource(sourceView.current); } }, [locate?.token]);
    const flush = () => {
        if (compose.current) throw new Error("请先完成中文输入再保存、导出或离开");
        if (!editor || !edited.current) return mode === "source" ? source : undefined;
        const next = editor.getMarkdown();
        edited.current = false;
        lastMarkdown.current = next;
        change.current(next);
        onComposition(false);
        return next;
    };
    flushRef.current = flush;
    useImperativeHandle(ref, () => ({ flush, isDirty: () => edited.current || compose.current }));
    useEffect(() => {
        editor?.setEditable(!disabled, false);
    }, [disabled, editor]);
    useEffect(() => {
        if (!editor || !restoredRich || restoredId.current === restoredRich.id) return;
        restoredId.current = restoredRich.id;
        syncing.current = true;
        try {
            editor.commands.setContent(restoredRich.content, { emitUpdate: false });
            const candidate = editor.getMarkdown();
            const check = guardRoundTrip(candidate, (input) => {
                editor.commands.setContent(input, { contentType: "markdown", emitUpdate: false });
                return editor.getMarkdown();
            });
            edited.current = false;
            lastMarkdown.current = candidate;
            setMode("source");
            if (check.protected) setReasons(check.reasons);
            change.current(candidate);
            onComposition(false);
        } catch {
            setReasons(["富文本本机草稿不能自动转换，原副本仍保留；请不要覆盖它"]);
        } finally {
            syncing.current = false;
        }
    }, [editor, restoredRich]);
    useEffect(() => {
        if (!editor || source === lastMarkdown.current) return;
        if (activeMode.current === "rich") {
            syncing.current = true;
            const result = guardRoundTrip(source, (input) => {
                editor.commands.setContent(input, { contentType: "markdown", emitUpdate: false });
                return editor.getMarkdown();
            });
            syncing.current = false;
            edited.current = false;
            if (result.protected) {
                setReasons(result.reasons);
                setMode("source");
            }
        }
        lastMarkdown.current = source;
    }, [source, editor]);
    useEffect(() => {
        setMode("source");
        setReasons([]);
        edited.current = false;
        setRichQuery(null);
        return () => {
            flushRef.current();
            if (idle.current !== undefined) cancelIdleCallback(idle.current);
        };
    }, [id]);
    useEffect(() => {
        if (richQuery === null) {
            setChoices([]);
            return;
        }
        const abort = new AbortController();
        void listKnowledge(spaceId, { q: richQuery }, abort.signal)
            .then((r) => setChoices(r.items))
            .catch(() => {});
        return () => abort.abort();
    }, [richQuery, spaceId]);
    const enterRich = () => {
        if (!editor || compose.current) return;
        syncing.current = true;
        const result = guardRoundTrip(source, (input) => {
            editor.commands.setContent(input, { contentType: "markdown", emitUpdate: false });
            return editor.getMarkdown();
        });
        syncing.current = false;
        if (result.protected) {
            setReasons(result.reasons);
            setMode("source");
            return;
        }
        edited.current = false;
        lastMarkdown.current = source;
        setReasons([]);
        setMode("rich");
    };
    const autoRich = useRef('');
    useEffect(() => { if (editor && initialMode === 'rich' && autoRich.current !== id) { autoRich.current = id; enterRich(); } }, [editor, id, initialMode]);
    const sourceExtensions = useMemo(
        () => [
            markdown(),
            EditorView.lineWrapping,
            autocompletion({
                override: [
                    async (ctx: CompletionContext) => {
                        const match = ctx.matchBefore(/\[\[[^\]\n]*/);
                        if (!match) return null;
                        const q = match.text.slice(2);
                        if (q.includes("|")) return null;
                        const data = await listKnowledge(spaceId, { q });
                        if (ctx.aborted) return null;
                        return { from: match.from + 2, options: data.items.map((d) => ({ label: d.title, detail: d.id.slice(0, 8), type: "text", apply: d.title + "]]" })) };
                    },
                ],
            }),
            EditorView.domEventHandlers({
                click: (event, view) => {
                    if (!event.ctrlKey && !event.metaKey) return false;
                    const at = view.posAtCoords({ x: event.clientX, y: event.clientY });
                    if (at === null) return false;
                    const line = view.state.doc.lineAt(at);
                    for (const m of line.text.matchAll(/\[\[([^\]\n|]+)(?:\|[^\]\n]+)?\]\]/g)) {
                        const start = line.from + (m.index ?? 0);
                        if (at >= start && at <= start + m[0].length) {
                            onWiki(m[1]);
                            return true;
                        }
                    }
                    return false;
                },
            }),
        ],
        [spaceId, onWiki],
    );
    return (
        <div className="knowledge-editor" onBlur={flush}>
            <div className="knowledge-editor-toolbar">
                <div className="knowledge-mode" role="group" aria-label="编辑模式">
                    <Button type={mode === "rich" ? "text" : "default"} className={mode === "rich" ? "selected" : ""} disabled={composing} onClick={enterRich}>
                        富文本
                    </Button>
                    <Button
                        type="text"
                        className={mode === "source" ? "selected" : ""}
                        disabled={composing}
                        onClick={() => {
                            flush();
                            setMode("source");
                        }}
                    >
                        <Code2 size={14} /> Markdown
                    </Button>
                </div>
                <span className="knowledge-toolbar-rule" />
                {mode === "rich" && editor && (
                    <>
                        {[
                            { label: "加粗", Icon: Bold, act: () => editor.chain().focus().toggleBold().run() },
                            { label: "斜体", Icon: Italic, act: () => editor.chain().focus().toggleItalic().run() },
                            { label: "二级标题", Icon: Heading2, act: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
                            { label: "列表", Icon: List, act: () => editor.chain().focus().toggleBulletList().run() },
                            { label: "撤销", Icon: Undo2, act: () => editor.chain().focus().undo().run() },
                            { label: "重做", Icon: Redo2, act: () => editor.chain().focus().redo().run() },
                        ].map(({ label, Icon, act }) => (
                            <Tooltip title={label} key={label}>
                                <button type="button" aria-label={label} disabled={disabled || composing} onMouseDown={(e) => e.preventDefault()} onClick={act}>
                                    <Icon size={15} />
                                </button>
                            </Tooltip>
                        ))}
                    </>
                )}
                {mode === "source" && <span className="knowledge-muted knowledge-shortcut">输入 [[ 补全引用 · Ctrl/⌘ 点击跳转</span>}
                {composing && <span role="status">中文输入中，暂缓切换与保存</span>}
            </div>
            {!!reasons.length && <Alert className="knowledge-protection" type="info" showIcon icon={<ShieldCheck size={16} />} title="源码保护" description={reasons.join("；") + "。原文完整保留，可继续源码编辑。"} />}
            <div className="knowledge-writing-surface">
                {mode === "source" ? (
                    <CodeMirror
                        onCreateEditor={view => { sourceView.current = view; locateSource(view); }}
                        aria-label="Markdown源码编辑器"
                        value={source}
                        theme={dark ? "dark" : "light"}
                        editable={!disabled}
                        basicSetup={{ lineNumbers: false, foldGutter: true, highlightActiveLine: false }}
                        extensions={sourceExtensions}
                        onChange={(value) => change.current(value)}
                        onCompositionStart={() => {
                            compose.current = true;
                            setComposing(true);
                            onComposition(true);
                        }}
                        onCompositionEnd={() => {
                            compose.current = false;
                            setComposing(false);
                            onComposition(false);
                        }}
                    />
                ) : (
                    <EditorContent editor={editor} />
                )}
            </div>
            {mode === "rich" && richQuery !== null && (
                <div className="knowledge-completions" aria-label="文档引用补全">
                    <Link2 size={14} />
                    {choices.length ? (
                        choices.map((c) => (
                            <Button
                                type="text"
                                key={c.id}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                    if (!editor) return;
                                    const pos = editor.state.selection.from;
                                    editor
                                        .chain()
                                        .focus()
                                        .deleteRange({ from: pos - richQuery.length - 2, to: pos })
                                        .insertContent({ type: "wikiLink", attrs: { target: c.title, alias: null } } as JSONContent)
                                        .run();
                                    setRichQuery(null);
                                    flush();
                                }}
                            >
                                {c.title} <small>{c.id.slice(0, 8)}</small>
                            </Button>
                        ))
                    ) : (
                        <span>没有匹配文档</span>
                    )}
                </div>
            )}
        </div>
    );
});
export default KnowledgeEditor;
