import { useEffect, useRef, useState } from "react";
import localforage from "localforage";
import { getKnowledgeDocument, getKnowledgeReceipt, knowledgeAction, type KnowledgeAction, type KnowledgeDocument } from "@/services/api/knowledge";
import type { JSONContent } from "@tiptap/core";
import { PlatformApiError } from "@/services/api/platform";
const storage = localforage.createInstance({ name: "infinite-canvas", storeName: "knowledge_drafts" });
type RichDraft = { schema: "p1-tiptap-3.32"; content: JSONContent };
type Draft = { document: KnowledgeDocument; pending?: KnowledgeAction; rich?: RichDraft; updatedAt: number };
const tab = () => {
    let id = sessionStorage.getItem("knowledge-tab");
    if (!id) {
        id = crypto.randomUUID();
        sessionStorage.setItem("knowledge-tab", id);
    }
    return id;
};
export function useKnowledgeDocument(actor: string, space: string, id: string, onSaved: () => void) {
    const [document, setDocument] = useState<KnowledgeDocument | null>(null),
        [status, setStatus] = useState(""),
        [dirty, setDirty] = useState(false),
        [conflict, setConflict] = useState(false),
        [loading, setLoading] = useState(false),
        [error, setError] = useState(""),
        [otherDrafts, setOtherDrafts] = useState<{ key: string; draft: Draft }[]>([]),
        [restoredRich, setRestoredRich] = useState<{ id: string; content: JSONContent } | undefined>(), [loadAttempt, retryLoad] = useState(0);
    const current = useRef<KnowledgeDocument | null>(null),
        pending = useRef<KnowledgeAction | undefined>(undefined),
        busy = useRef(false),
        changed = useRef(false),
        generation = useRef(0),
        draftWrites = useRef(Promise.resolve()),
        key = useRef(""),
        composing = useRef(false),
        idle = useRef<number | undefined>(undefined),
        conflicted = useRef(false),
        richDraft = useRef<RichDraft | undefined>(undefined);
    const persist = () => {
        const d = current.current;
        if (!d || !key.current) return Promise.resolve();
        const k = key.current,
            value: Draft = { document: { ...d }, pending: pending.current, rich: richDraft.current, updatedAt: Date.now() };
        const task = draftWrites.current
            .catch(() => {})
            .then(() => storage.setItem(k, value))
            .then(() => {});
        draftWrites.current = task;
        return task;
    };
    const saveRef = useRef<() => Promise<void>>(async () => {});
    const schedule = () => {
        if (idle.current !== undefined) cancelIdleCallback(idle.current);
        if (typeof requestIdleCallback === "function")
            idle.current = requestIdleCallback(() => {
                idle.current = undefined;
                if (globalThis.document.activeElement?.closest(".knowledge-writing-surface, .knowledge-title")) return;
                void saveRef.current();
            });
    };
    const setCurrent = (d: KnowledgeDocument | null) => {
        current.current = d;
        setDocument(d);
    };
    useEffect(() => {
        const g = ++generation.current;
        current.current = null;
        pending.current = undefined;
        richDraft.current = undefined;
        setRestoredRich(undefined);
        changed.current = false;
        conflicted.current = false;
        busy.current = false;
        setDocument(null);
        setDirty(false);
        setConflict(false);
        setError("");
        setOtherDrafts([]);
        setLoading(false);
        setStatus("");
        key.current = "";
        if (!space || !id) return;
        key.current = `${actor}:${id}:${tab()}`;
        setLoading(true);
        const loadKey = key.current;
        void Promise.all([getKnowledgeDocument(space, id), draftWrites.current.then(() => storage.getItem<Draft>(loadKey))])
            .then(async ([remote, draft]) => {
                if (g !== generation.current) return;
                if (draft && (draft.rich || draft.pending || draft.document.title !== remote.title || draft.document.markdown !== remote.markdown || draft.document.folderId !== remote.folderId)) {
                    setCurrent(draft.document);
                    pending.current = draft.pending;
                    richDraft.current = draft.rich;
                    if (draft.rich?.schema === "p1-tiptap-3.32") setRestoredRich({ id: crypto.randomUUID(), content: draft.rich.content });
                    changed.current = true;
                    setDirty(true);
                    setStatus("已恢复本机草稿，尚未提交");
                    if (draft.document.revision !== remote.revision && !draft.pending) {
                        conflicted.current = true;
                        setConflict(true);
                    }
                } else {
                    setCurrent(remote);
                    setStatus(remote.deletedAt ? "已移入回收站" : "已保存");
                }
                const alternatives: { key: string; draft: Draft }[] = [];
                await storage.iterate<Draft, void>((value, k) => {
                    if (k.startsWith(`${actor}:${id}:`) && k !== key.current) alternatives.push({ key: k, draft: value });
                });
                if (g === generation.current) setOtherDrafts(alternatives);
            })
            .catch((e) => {
                if (g === generation.current) setError(e.message);
            })
            .finally(() => {
                if (g === generation.current) setLoading(false);
            });
        return () => {
            if (changed.current || pending.current || richDraft.current) void persist();
            generation.current++;
            if (idle.current !== undefined) cancelIdleCallback(idle.current);
        };
    }, [actor, space, id, loadAttempt]);
    const change = (patch: Partial<KnowledgeDocument>) => {
        if (!current.current) return;
        if (patch.markdown !== undefined) richDraft.current = undefined;
        setCurrent({ ...current.current, ...patch });
        changed.current = true;
        setDirty(true);
        setStatus("本机草稿保存中");
        if (!composing.current)
            void persist()
                .then(() => setStatus((s) => (s === "本机草稿保存中" ? "草稿已保护，等待空闲保存" : s)))
                .catch(() => {
                    setError("本机草稿保存失败，请导出Markdown后再离开");
                    setStatus("草稿保护失败");
                });
        schedule();
    };
    const save = async () => {
        const d = current.current;
        if (!d || busy.current || composing.current || richDraft.current || conflicted.current || d.deletedAt || (!changed.current && !pending.current)) return;
        const g = generation.current,
            k = key.current;
        let completed = false;
        busy.current = true;
        setError("");
        setStatus("正在保存");
        try {
            const operation = pending.current ?? { operationId: crypto.randomUUID(), action: "document.save", payload: { id: d.id, expectedRevision: d.revision, title: d.title, markdown: d.markdown, folderId: d.folderId } };
            const retry = Boolean(pending.current);
            pending.current = operation;
            await persist();
            if (g !== generation.current) return;
            let result;
            if (retry) {
                try {
                    result = await getKnowledgeReceipt(space, operation.operationId);
                } catch (e) {
                    if (!(e instanceof PlatformApiError && e.code === "KNOWLEDGE_OPERATION_NOT_FOUND")) throw e;
                }
            }
            if (!result) {
                result = await knowledgeAction(space, operation);
            }
            if (g !== generation.current) {
                return;
            } // Original per-tab draft remains available after navigation.
            const sent = operation.payload;
            pending.current = undefined;
            completed = true;
            const latest = current.current!;
            const more = Boolean(richDraft.current) || latest.title !== sent.title || latest.markdown !== sent.markdown || latest.folderId !== sent.folderId;
            setCurrent({ ...latest, revision: result.revision, contentHash: result.contentHash, updatedAt: result.updatedAt });
            changed.current = more;
            setDirty(more);
            setStatus(more ? "草稿已保护，等待空闲保存" : "已保存");
            if (more) {
                await persist();
            } else {
                draftWrites.current = draftWrites.current
                    .catch(() => {})
                    .then(async () => {
                        if (g === generation.current && !changed.current && !pending.current) await storage.removeItem(k);
                    });
                await draftWrites.current;
            }
            onSaved();
        } catch (e) {
            if (g !== generation.current) return;
            const err = e as PlatformApiError;
            if (err.code === "KNOWLEDGE_REVISION_CONFLICT") {
                // A definite CAS rejection was not committed. Preserve the draft, not a retryable write.
                pending.current = undefined;
                conflicted.current = true;
                setConflict(true);
                setStatus("版本冲突，草稿已保留");
            } else {
                setStatus("保存未确认，草稿已保留");
                if (err.status >= 400 && err.status < 500 && err.code !== "KNOWLEDGE_OPERATION_MISMATCH") pending.current = undefined;
            }
            setError(err.message);
            await persist().catch(() => {});
        } finally {
            if (g === generation.current) {
                busy.current = false;
                if (completed && changed.current && !pending.current && !conflicted.current) schedule();
            }
        }
    };
    saveRef.current = save;
    useEffect(() => {
        const before = (e: BeforeUnloadEvent) => {
            if (changed.current || pending.current || composing.current) {
                e.preventDefault();
                e.returnValue = "";
            }
        };
        window.addEventListener("beforeunload", before);
        return () => window.removeEventListener("beforeunload", before);
    }, []);
    const prepareLeave = async () => {
        if (changed.current || pending.current) await persist();
        await draftWrites.current;
    };
    const rebase = async (reviewedRevision: number) => {
        if (!current.current) return;
        const g = generation.current;
        const remote = await getKnowledgeDocument(space, id);
        if (g !== generation.current) return;
        if (remote.deletedAt) throw new Error("服务器文档已删除，请从历史恢复");
        if (remote.revision !== reviewedRevision) {
            setError("服务器在比较期间再次更新，请关闭对话框后重新比较");
            throw new Error("服务器在比较期间再次更新，请关闭对话框后重新比较");
        }
        pending.current = undefined;
        setCurrent({ ...current.current, revision: remote.revision });
        conflicted.current = false;
        setConflict(false);
        changed.current = true;
        setDirty(true);
        await persist();
        await saveRef.current();
    };
    const loadServer = async () => {
        const g = generation.current, k = key.current;
        await archiveDraft();
        await prepareLeave();
        const remote = await getKnowledgeDocument(space, id);
        if (g !== generation.current) return;
        await storage.removeItem(k);
        if (g !== generation.current) return;
        richDraft.current = undefined;
        setRestoredRich(undefined);
        pending.current = undefined;
        changed.current = false;
        conflicted.current = false;
        setCurrent(remote);
        setDirty(false);
        setConflict(false);
        setStatus("服务器版本（原草稿副本仍保留）");
    };
    const reload = async () => {
        const g = generation.current, k = key.current, initial = current.current, initialRich = richDraft.current;
        const remote = await getKnowledgeDocument(space, id);
        if (g !== generation.current) return;
        // A late refresh must never discard edits typed while the request was in flight.
        if (current.current !== initial || richDraft.current !== initialRich) return;
        await storage.removeItem(k);
        if (g !== generation.current) return;
        pending.current = undefined;
        richDraft.current = undefined;
        setRestoredRich(undefined);
        changed.current = false;
        conflicted.current = false;
        setCurrent(remote);
        setDirty(false);
        setConflict(false);
        setStatus("已保存");
    };
    const adopt = async (draft: Draft) => {
        pending.current = undefined;
        richDraft.current = draft.rich;
        if (draft.rich?.schema === "p1-tiptap-3.32") setRestoredRich({ id: crypto.randomUUID(), content: draft.rich.content });
        setCurrent(draft.document);
        changed.current = true;
        conflicted.current = true;
        setDirty(true);
        setConflict(true);
        setStatus("其他页面草稿已复制到本页，请比较后保存");
        await persist();
    };
    const archiveDraft = async () => {
        if (!current.current) return;
        const k = key.current + ":preserved:" + crypto.randomUUID(),
            draft = { document: { ...current.current }, pending: pending.current, rich: richDraft.current, updatedAt: Date.now() };
        await storage.setItem(k, draft);
        setOtherDrafts((v) => [...v, { key: k, draft }]);
    };
    const protectRich = (content: JSONContent) => {
        richDraft.current = { schema: "p1-tiptap-3.32", content };
        changed.current = true;
        setDirty(true);
        setStatus("富文本本机草稿保存中");
        void persist()
            .then(() => setStatus((s) => (s === "富文本本机草稿保存中" ? "富文本草稿已保护，离开编辑区自动保存" : s)))
            .catch(() => setError("富文本草稿保护失败，请保存或导出后再离开"));
    };
    return {
        restoredRich,
        protectRich,
        document,
        status,
        dirty,
        conflict,
        loading,
        retryLoad: () => retryLoad(n => n + 1),
        error,
        otherDrafts,
        change,
        save,
        prepareLeave,
        rebase,
        loadServer,
        reload,
        adopt,
        archiveDraft,
        setComposing: (v: boolean) => {
            composing.current = v;
            if (!v) {
                if (changed.current && !richDraft.current)
                    void persist()
                        .then(() => setStatus((s) => (s === "本机草稿保存中" ? "草稿已保护，离开编辑区自动保存" : s)))
                        .catch(() => setError("草稿保护失败，请导出后再离开"));
                schedule();
            }
        },
    };
}
