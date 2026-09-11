import { App, Button, Input, Tooltip } from "antd";
import { ArrowDown, BookMarked, Copy, ImagePlus, LoaderCircle, MessageSquareText, Plus, RotateCcw, Sparkles, Square, Trash2, Video } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { ModelPicker } from "@/components/model-picker";
import { cn } from "@/lib/utils";
import { cancelManagedJob, retryManagedJob } from "@/services/api/jobs";
import { createTextConversation, deleteTextConversation, generateTextMessage, listTextConversations, listTextMessages, updateTextConversation, type TextConversation, type TextMessage, type TextWorkbenchMode } from "@/services/api/text-workbench";
import { modelOptionLabel, normalizeModelOptionValue, useEffectiveConfig } from "@/stores/use-config-store";
import { useAssetStore } from "@/stores/use-asset-store";

const MODES: Array<{ id: TextWorkbenchMode; label: string; description: string; starter: string }> = [
    { id: "chat", label: "自由对话", description: "问问题、整理思路或处理任意文本", starter: "直接说说你现在想解决什么。" },
    { id: "prompt", label: "提示词生成", description: "把零散想法整理成可直接使用的提示词", starter: "描述目标、使用模型和你希望保留的细节。" },
    { id: "script", label: "剧本创作", description: "设计人物、冲突、场次和对白", starter: "给我一个故事梗概，我会把它发展成可拍摄剧本。" },
    { id: "storyboard", label: "分镜规划", description: "拆解景别、机位、动作和镜头衔接", starter: "粘贴一段剧本，我会按镜头拆解。" },
    { id: "seedance", label: "Seedance 优化", description: "强化运镜、动作、连续性与声音设计", starter: "粘贴画面或分镜描述，我会整理成 Seedance 漫剧提示词。" },
];

export default function TextWorkbenchPage() {
    const { message, modal } = App.useApp();
    const navigate = useNavigate();
    const effectiveConfig = useEffectiveConfig();
    const addAsset = useAssetStore((state) => state.addAsset);
    const defaultModel = effectiveConfig.textModel || effectiveConfig.model;
    const [conversations, setConversations] = useState<TextConversation[]>([]);
    const [activeId, setActiveId] = useState("");
    const [messages, setMessages] = useState<TextMessage[]>([]);
    const [mode, setMode] = useState<TextWorkbenchMode>("chat");
    const [model, setModel] = useState(defaultModel);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const feedRef = useRef<HTMLDivElement>(null);
    const activeConversation = conversations.find((item) => item.id === activeId);
    const activeMode = MODES.find((item) => item.id === mode) || MODES[0];
    const pendingMessage = messages.findLast((item) => item.role === "assistant" && item.status === "pending");

    const refreshConversations = useCallback(async () => {
        const items = await listTextConversations();
        setConversations(items);
        return items;
    }, []);

    const refreshMessages = useCallback(async (conversationId: string) => {
        const items = await listTextMessages(conversationId);
        setMessages(items);
        return items;
    }, []);

    useEffect(() => {
        let live = true;
        void (async () => {
            try {
                let items = await refreshConversations();
                if (!items.length) items = [await createTextConversation({ mode: "chat", modelId: defaultModel })];
                if (!live) return;
                setConversations(items);
                setActiveId(items[0]!.id);
            } catch (error) {
                message.error(error instanceof Error ? error.message : "文本工作台加载失败");
            } finally {
                if (live) setLoading(false);
            }
        })();
        return () => {
            live = false;
        };
    }, [defaultModel, message, refreshConversations]);

    useEffect(() => {
        if (!activeId) return;
        const conversation = conversations.find((item) => item.id === activeId);
        if (conversation) {
            setMode(conversation.mode);
            setModel(normalizeModelOptionValue(conversation.modelId, effectiveConfig.channels) || defaultModel);
        }
        void refreshMessages(activeId).catch((error) => message.error(error instanceof Error ? error.message : "对话加载失败"));
    }, [activeId, conversations, defaultModel, effectiveConfig.channels, message, refreshMessages]);

    useEffect(() => {
        if (!activeId || !messages.some((item) => item.status === "pending")) return;
        const timer = window.setInterval(() => void refreshMessages(activeId), 1_800);
        return () => window.clearInterval(timer);
    }, [activeId, messages, refreshMessages]);

    useEffect(() => {
        feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
    }, [messages]);

    const createConversation = async (nextMode: TextWorkbenchMode = mode) => {
        try {
            const created = await createTextConversation({ mode: nextMode, modelId: model || defaultModel });
            setConversations((items) => [created, ...items]);
            setActiveId(created.id);
            setMessages([]);
            setMode(nextMode);
            setInput("");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "新建对话失败");
        }
    };

    const sendMessage = async (content = input) => {
        const text = content.trim();
        if (!text || sending) return;
        setSending(true);
        setInput("");
        try {
            let conversationId = activeId;
            if (!conversationId) conversationId = (await createTextConversation({ mode, modelId: model || defaultModel })).id;
            await generateTextMessage(conversationId, { content: text, modelId: model || defaultModel, mode });
            setActiveId(conversationId);
            await Promise.all([refreshMessages(conversationId), refreshConversations()]);
        } catch (error) {
            setInput(text);
            message.error(error instanceof Error ? error.message : "发送失败");
        } finally {
            setSending(false);
        }
    };

    const changeMode = async (nextMode: TextWorkbenchMode) => {
        setMode(nextMode);
        if (activeId) {
            await updateTextConversation(activeId, { mode: nextMode }).catch(() => undefined);
            setConversations((items) => items.map((item) => (item.id === activeId ? { ...item, mode: nextMode } : item)));
        }
    };

    const changeModel = async (nextModel: string) => {
        setModel(nextModel);
        if (activeId) await updateTextConversation(activeId, { modelId: nextModel }).catch(() => undefined);
    };

    const removeConversation = (conversation: TextConversation) => {
        modal.confirm({
            title: "删除这段对话？",
            content: "删除后不再出现在历史记录中。正在执行的生成任务不会被删除。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                await deleteTextConversation(conversation.id);
                const next = conversations.filter((item) => item.id !== conversation.id);
                setConversations(next);
                setActiveId(next[0]?.id || "");
                if (!next.length) await createConversation();
            },
        });
    };

    const savePrompt = (content: string) => {
        addAsset({
            kind: "text",
            title: activeConversation?.title || "AI 文本结果",
            coverUrl: "",
            tags: [activeMode.label, modelOptionLabel(effectiveConfig, model)],
            source: "AI 文本工作台",
            data: { content },
            metadata: { source: "text-workbench", mode, model },
        });
        message.success("已保存到提示词素材");
    };

    const handoff = (path: "/image" | "/video" | "/canvas", content: string) => {
        if (path === "/canvas") savePrompt(content);
        navigate(path === "/canvas" ? "/canvas?mode=recent" : path, { state: { workbenchPrompt: content } });
    };

    const stop = async () => {
        if (!pendingMessage?.jobId) return;
        try {
            await cancelManagedJob(pendingMessage.jobId);
            await refreshMessages(activeId);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "取消失败");
        }
    };

    if (loading)
        return (
            <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">
                <LoaderCircle className="mr-2 size-4 animate-spin" />
                正在打开文本工作台
            </main>
        );

    return (
        <main className="h-full overflow-hidden bg-[#f4f3ef] text-stone-950 dark:bg-[#11110f] dark:text-stone-100">
            <div className="mx-auto grid h-full max-w-[1680px] grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_292px]">
                <aside className="hidden min-h-0 border-r border-black/10 bg-[#ebe9e3] p-4 md:flex md:flex-col dark:border-white/10 dark:bg-[#171715]">
                    <Button type="primary" icon={<Plus className="size-4" />} className="!h-10 !rounded-lg" onClick={() => void createConversation()}>
                        新建对话
                    </Button>
                    <p className="mb-2 mt-6 px-2 text-[11px] font-medium uppercase tracking-[0.18em] text-stone-500">历史对话</p>
                    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                        {conversations.map((conversation) => (
                            <button
                                key={conversation.id}
                                type="button"
                                onClick={() => setActiveId(conversation.id)}
                                className={cn("group flex w-full items-start gap-2 rounded-lg px-3 py-3 text-left transition", activeId === conversation.id ? "bg-white shadow-sm dark:bg-stone-800" : "hover:bg-black/5 dark:hover:bg-white/5")}
                            >
                                <MessageSquareText className="mt-0.5 size-4 shrink-0 text-stone-500" />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium">{conversation.title}</span>
                                    <span className="mt-1 block truncate text-xs text-stone-500">{conversation.preview || MODES.find((item) => item.id === conversation.mode)?.label}</span>
                                </span>
                                <Tooltip title="删除">
                                    <span
                                        role="button"
                                        tabIndex={0}
                                        className="mt-0.5 hidden text-stone-400 hover:text-red-500 group-hover:block"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            removeConversation(conversation);
                                        }}
                                    >
                                        <Trash2 className="size-4" />
                                    </span>
                                </Tooltip>
                            </button>
                        ))}
                    </div>
                </aside>

                <section className="flex min-w-0 flex-col bg-[#faf9f6] dark:bg-[#131311]">
                    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-black/10 px-5 dark:border-white/10">
                        <div className="min-w-0">
                            <h1 className="truncate text-base font-semibold">{activeConversation?.title || "AI 文本工作台"}</h1>
                            <p className="mt-0.5 text-xs text-stone-500">{activeMode.label} · 对话自动保存</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <ModelPicker config={effectiveConfig} value={model} capability="text" onChange={(value) => void changeModel(value)} className="max-w-[240px]" />
                            <Button className="md:hidden" icon={<Plus className="size-4" />} onClick={() => void createConversation()} />
                        </div>
                    </header>

                    <div ref={feedRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-8">
                        <div className="mx-auto w-full max-w-3xl">
                            {!messages.length ? (
                                <div className="flex min-h-[52vh] flex-col justify-center">
                                    <div className="mb-8">
                                        <div className="mb-4 flex size-11 items-center justify-center rounded-xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-stone-800">
                                            <Sparkles className="size-5" />
                                        </div>
                                        <h2 className="text-2xl font-semibold tracking-tight">从一段文字开始</h2>
                                        <p className="mt-2 max-w-xl text-sm leading-6 text-stone-500">它既是提示词生成器，也是编剧、分镜助手和日常文本对话空间。结果可以继续送到画布、生图或视频工作台。</p>
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-2">
                                        {MODES.slice(1).map((item) => (
                                            <button
                                                key={item.id}
                                                type="button"
                                                onClick={() => {
                                                    void changeMode(item.id);
                                                    setInput(item.starter);
                                                }}
                                                className="rounded-xl border border-black/10 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-black/25 hover:shadow-sm dark:border-white/10 dark:bg-stone-900 dark:hover:border-white/25"
                                            >
                                                <span className="text-sm font-medium">{item.label}</span>
                                                <span className="mt-1 block text-xs leading-5 text-stone-500">{item.description}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-7">
                                    {messages.map((item) => (
                                        <MessageBlock
                                            key={item.id}
                                            item={item}
                                            modelLabel={modelOptionLabel(effectiveConfig, normalizeModelOptionValue(item.modelId, effectiveConfig.channels) || model)}
                                            onCopy={() => {
                                                void navigator.clipboard.writeText(item.content);
                                                message.success("已复制");
                                            }}
                                            onSave={() => savePrompt(item.content)}
                                            onHandoff={(path) => handoff(path, item.content)}
                                            onRetry={
                                                item.jobId
                                                    ? async () => {
                                                          await retryManagedJob(item.jobId!);
                                                          await refreshMessages(activeId);
                                                      }
                                                    : undefined
                                            }
                                        />
                                    ))}
                                    <div aria-hidden className="h-2" />
                                </div>
                            )}
                        </div>
                    </div>

                    <footer className="shrink-0 px-4 pb-5 sm:px-8">
                        <div className="mx-auto max-w-3xl rounded-2xl border border-black/15 bg-white p-2 shadow-[0_18px_60px_rgba(0,0,0,0.09)] focus-within:border-black/30 dark:border-white/15 dark:bg-[#1c1c19] dark:focus-within:border-white/30">
                            <Input.TextArea
                                value={input}
                                onChange={(event) => setInput(event.target.value)}
                                onPressEnter={(event) => {
                                    if (!event.shiftKey) {
                                        event.preventDefault();
                                        void sendMessage();
                                    }
                                }}
                                autoSize={{ minRows: 2, maxRows: 8 }}
                                variant="borderless"
                                placeholder={activeMode.starter}
                                className="!resize-none !px-3 !py-2 !text-[15px]"
                            />
                            <div className="flex items-center justify-between gap-3 px-2 pb-1">
                                <span className="text-[11px] text-stone-400">Enter 发送 · Shift + Enter 换行</span>
                                {pendingMessage ? (
                                    <Button danger type="text" icon={<Square className="size-3.5" />} onClick={() => void stop()}>
                                        停止
                                    </Button>
                                ) : (
                                    <Button type="primary" shape="circle" icon={sending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowDown className="size-4" />} disabled={!input.trim() || sending} onClick={() => void sendMessage()} />
                                )}
                            </div>
                        </div>
                    </footer>
                </section>

                <aside className="hidden min-h-0 border-l border-black/10 bg-[#ebe9e3] p-5 xl:block dark:border-white/10 dark:bg-[#171715]">
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-stone-500">创作模式</p>
                    <div className="mt-4 space-y-2">
                        {MODES.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => void changeMode(item.id)}
                                className={cn(
                                    "w-full rounded-xl border p-3 text-left transition",
                                    mode === item.id ? "border-stone-900 bg-white shadow-sm dark:border-stone-100 dark:bg-stone-800" : "border-transparent hover:bg-black/5 dark:hover:bg-white/5",
                                )}
                            >
                                <span className="text-sm font-medium">{item.label}</span>
                                <span className="mt-1 block text-xs leading-5 text-stone-500">{item.description}</span>
                            </button>
                        ))}
                    </div>
                    <div className="mt-8 border-t border-black/10 pt-5 text-xs leading-5 text-stone-500 dark:border-white/10">
                        <p className="font-medium text-stone-700 dark:text-stone-300">工作台连接</p>
                        <p className="mt-2">每条 AI 结果都可以保存为提示词素材，或直接带到画布、生图和视频创作台。</p>
                    </div>
                </aside>
            </div>
        </main>
    );
}

function MessageBlock({ item, modelLabel, onCopy, onSave, onHandoff, onRetry }: { item: TextMessage; modelLabel: string; onCopy: () => void; onSave: () => void; onHandoff: (path: "/image" | "/video" | "/canvas") => void; onRetry?: () => Promise<void> }) {
    const assistant = item.role === "assistant";
    return (
        <article className={cn("group", !assistant && "flex justify-end")}>
            <div className={cn(assistant ? "w-full" : "max-w-[84%] rounded-2xl rounded-br-md bg-stone-200 px-4 py-3 dark:bg-stone-800")}>
                {assistant ? (
                    <div className="mb-2 flex items-center gap-2 text-xs text-stone-500">
                        <Sparkles className="size-3.5" />
                        <span>{modelLabel}</span>
                    </div>
                ) : null}
                {item.status === "pending" ? (
                    <div className="flex items-center gap-2 py-3 text-sm text-stone-500">
                        <LoaderCircle className="size-4 animate-spin" />
                        正在思考并生成
                    </div>
                ) : item.status === "failed" || item.status === "cancelled" ? (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-500">
                        <p>{item.error || (item.status === "cancelled" ? "任务已取消" : "生成失败")}</p>
                        {onRetry ? (
                            <Button danger type="text" size="small" className="!mt-2 !px-0" icon={<RotateCcw className="size-3.5" />} onClick={() => void onRetry()}>
                                重新生成
                            </Button>
                        ) : null}
                    </div>
                ) : (
                    <div className="whitespace-pre-wrap text-[15px] leading-7 text-stone-800 dark:text-stone-200">{item.content}</div>
                )}
                {assistant && item.status === "completed" ? (
                    <div className="mt-3 flex flex-wrap gap-1 opacity-0 transition group-hover:opacity-100">
                        <Action icon={<Copy className="size-3.5" />} label="复制" onClick={onCopy} />
                        <Action icon={<BookMarked className="size-3.5" />} label="保存" onClick={onSave} />
                        <Action icon={<MessageSquareText className="size-3.5" />} label="画布" onClick={() => onHandoff("/canvas")} />
                        <Action icon={<ImagePlus className="size-3.5" />} label="生图" onClick={() => onHandoff("/image")} />
                        <Action icon={<Video className="size-3.5" />} label="视频" onClick={() => onHandoff("/video")} />
                    </div>
                ) : null}
            </div>
        </article>
    );
}

function Action({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
    return (
        <Button type="text" size="small" icon={icon} onClick={onClick}>
            {label}
        </Button>
    );
}
