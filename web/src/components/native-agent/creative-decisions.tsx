import { PlatformApiError } from "@/services/api/platform";
import { useEffect, useRef, useState } from "react";
import { Button, Collapse, Input, Switch, Select } from "antd";
import { getCreativeDecisions, changeCreativeDecisions, type CreativeDecisions, type AgentSnapshot } from "@/services/api/native-agent";
export default function CreativeDecisionsPanel({ projectId, snapshot }: { projectId: string; snapshot: AgentSnapshot | null }) {
    const [value, setValue] = useState<CreativeDecisions | null>(null),
        [error, setError] = useState(""),
        [text, setText] = useState(""),
        [editing, setEditing] = useState<string>(),
        [busy, setBusy] = useState(false);
    const pending = useRef<Record<string, unknown> | null>(null),
        generation = useRef(0);
    const refresh = async () => {
        const n = generation.current;
        try {
            const next = await getCreativeDecisions(projectId);
            if (generation.current === n) setValue(next);
        } catch (e) {
            if (generation.current === n && e instanceof PlatformApiError && [401, 403, 404].includes(e.status)) setValue(null);
            throw e;
        }
    };
    useEffect(() => {
        const c = new AbortController();
        generation.current++;
        setValue(null);
        pending.current = null;
        setText("");
        setEditing(undefined);
        setError("");
        void getCreativeDecisions(projectId, c.signal)
            .then((next) => {
                if (!c.signal.aborted) setValue(next);
            })
            .catch(() => {
                if (!c.signal.aborted) setError("创作决定暂未载入，请重试。当前不会新增长期记忆。");
            });
        return () => {
            c.abort();
            generation.current++;
        };
    }, [projectId]);
    const [sourceKey, setSourceKey] = useState<string>();
    const sourceMessages = snapshot?.messages.filter((m) => m.role === "user" && snapshot.runs.some((r) => r.id === m.run_id && r.status === "completed")) ?? [];
    const source = sourceMessages.find((m) => m.run_id + ":" + m.item_id === sourceKey) ?? sourceMessages.at(-1);
    const latest = snapshot?.runs.find((r) => r.id === source?.run_id);
    const write = async (action: string, id?: string) => {
        const current = generation.current;
        setBusy(true);
        setError("");
        try {
            const request = pending.current ?? {
                operationId: crypto.randomUUID(),
                expectedRevision: value?.revision ?? 0,
                action,
                ...(id ? { id } : {}),
                ...(action === "save" ? { id: editing ?? crypto.randomUUID(), text, runId: latest?.id, runRevision: latest?.revision, evidence: source?.content } : {}),
            };
            pending.current = request;
            await changeCreativeDecisions(projectId, request);
            if (generation.current !== current) return;
            pending.current = null;
            setEditing(undefined);
            setText("");
            await refresh();
        } catch (e) {
            if (generation.current === current) {
                if (e instanceof PlatformApiError && e.status === 409) {
                    pending.current = null;
                    await refresh().catch(() => undefined);
                    setError("创作决定已变化，输入已保留。请核对当前内容后再次确认保存。");
                } else setError("保存结果未确认或权限已变化。先查询状态；重试将沿用原操作，未自动新增记录。");
            }
        } finally {
            if (generation.current === current) setBusy(false);
        }
    };
    return (
        <Collapse
            ghost
            items={[
                {
                    key: "decisions",
                    label: "已确认的创作决定",
                    children: (
                        <div className="space-y-3 text-xs">
                            <p className="leading-5 text-muted-foreground">仅本人、仅当前项目。默认关闭，只有你主动保存的决定会用于新会话；讨论建议不会自动成为长期记忆。</p>
                            {error && <p role="alert">{error}</p>}
                            <div className="flex items-center gap-2">
                                <Switch size="small" checked={value?.enabled ?? false} disabled={!value || busy || !!pending.current} onChange={(enabled) => void write(enabled ? "enable" : "disable")} aria-label="使用已确认创作决定" />
                                用于后续会话{" "}
                                <Button type="text" size="small" onClick={() => void refresh().catch(() => setError("查询失败，请保留输入后重试。"))}>
                                    查询状态
                                </Button>
                            </div>
                            {pending.current && (
                                <Button type="text" size="small" disabled={busy} onClick={() => void write(String(pending.current?.action))}>
                                    重试原保存
                                </Button>
                            )}
                            {value?.decisions.map((d) => (
                                <div key={d.id} className="space-y-1 py-2">
                                    <p className="whitespace-pre-wrap break-words">{d.text}</p>
                                    {d.source && <p className="break-words text-muted-foreground">确认来源：{d.source.evidence}</p>}
                                    <div className="flex gap-2">
                                        <Button
                                            type="text"
                                            size="small"
                                            disabled={!d.available || busy || !!pending.current}
                                            onClick={() => {
                                                setEditing(d.id);
                                                setText(d.text);
                                            }}
                                        >
                                            编辑
                                        </Button>
                                        <Button type="text" size="small" disabled={busy || !!pending.current} onClick={() => void write("remove", d.id)}>
                                            移除决定
                                        </Button>
                                    </div>
                                </div>
                            ))}
                            {!editing && (
                                <Select
                                    aria-label="创作决定的用户确认来源"
                                    className="w-full"
                                    value={source ? source.run_id + ":" + source.item_id : undefined}
                                    disabled={busy || !!pending.current}
                                    onChange={setSourceKey}
                                    options={sourceMessages.map((m) => ({ value: m.run_id + ":" + m.item_id, label: m.content }))}
                                    placeholder="选择一条用户确认原话"
                                />
                            )}
                            <Input.TextArea aria-label="要记住的创作决定" value={text} disabled={busy || !!pending.current} onChange={(e) => setText(e.target.value)} placeholder="例如：保留林岚的调查员身份" autoSize={{ minRows: 2, maxRows: 6 }} />
                            {!editing && source && <p className="leading-5 text-muted-foreground">本次将关联你最近的已完成对话：“{source.content}”。只保存上面明确输入的决定，不保存整段私人闲聊。</p>}
                            <Button type="text" size="small" disabled={!text.trim() || busy || !!pending.current || (!editing && !source)} onClick={() => void write("save")}>
                                确认保存决定
                            </Button>
                        </div>
                    ),
                },
            ]}
        />
    );
}
