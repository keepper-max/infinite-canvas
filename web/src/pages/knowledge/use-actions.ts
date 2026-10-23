import { useEffect, useRef, useState } from "react";
import localforage from "localforage";
import { getKnowledgeReceipt, knowledgeAction, type KnowledgeAction, type KnowledgeReceipt } from "@/services/api/knowledge";
import { PlatformApiError } from "@/services/api/platform";
const journal = localforage.createInstance({ name: "infinite-canvas", storeName: "knowledge_actions" });
export function useKnowledgeActions(actor: string, space: string, onSuccess: (action: KnowledgeAction, result: KnowledgeReceipt, startedUrl?: string) => void, scope = "") {
    const [state, setState] = useState<{ key: string; pending: KnowledgeAction | null; busy: boolean; error: string; ready: boolean }>({ key: '', pending: null, busy: false, error: '', ready: false });
    const inFlight = useRef(new Map<string, AbortController>()), active = useRef(''), success = useRef(onSuccess);
    success.current = onSuccess;
    let tab = sessionStorage.getItem("knowledge-tab");
    if (!tab) {
        tab = crypto.randomUUID();
        sessionStorage.setItem("knowledge-tab", tab);
    }
    const key = `${actor}:${space}:${tab}${scope ? ":" + scope : ""}`;
    active.current = key;
    const current = state.key === key ? state : { key, pending: null, busy: false, error: '', ready: false };
    const { pending, busy, error, ready } = current;
    const update = (patch: Partial<typeof state>) => setState(old => active.current === key ? { ...(old.key === key ? old : current), ...patch, key } : old);
    useEffect(() => {
        active.current = key;
        let live = true;
        void journal.getItem<KnowledgeAction>(key).then((v) => {
            if (live && active.current === key) update({ pending: v, ready: true });
        }).catch(() => { if (live) update({ error: '本机操作记录无法读取，请恢复浏览器存储后重试', ready: false }); });
        return () => { live = false; inFlight.current.get(key)?.abort(); if (active.current === key) active.current = ''; };
    }, [key]);
    const run = async (action?: KnowledgeAction) => {
        if (inFlight.current.has(key) || !ready) return;
        const operation = pending ?? action;
        if (!operation || !space) return;
        const k = key;
        const startedUrl = window.location.href;
        const controller = new AbortController();
        inFlight.current.set(k, controller);
        update({ busy: true, error: '' });
        try {
            await journal.setItem(k, operation);
            update({ pending: operation });
            let result;
            if (pending) {
                try {
                    result = await getKnowledgeReceipt(space, operation.operationId, controller.signal);
                } catch (e) {
                    if (!(e instanceof PlatformApiError && e.code === "KNOWLEDGE_OPERATION_NOT_FOUND")) throw e;
                }
            }
            if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
            result ??= await knowledgeAction(space, operation, controller.signal);
            await journal.removeItem(k);
            if (active.current === k) {
                update({ pending: null });
                if (pending) window.dispatchEvent(new Event('knowledge:changed'));
                success.current(operation, result, startedUrl);
            }
            return result;
        } catch (e) {
            if (active.current === k) {
                const err = e as PlatformApiError;
                update({ error: controller.signal.aborted ? '已停止等待，原操作仍待确认。请查询原回执，不要重复导入。' : err.message });
                if ([400, 409, 422].includes(err.status) && err.code !== "KNOWLEDGE_OPERATION_MISMATCH") {
                    await journal.removeItem(k);
                    update({ pending: null });
                }
            }
        } finally {
            inFlight.current.delete(k);
            if (active.current === k) update({ busy: false });
        }
    };
    return { pending, busy, error, ready, run, stopWaiting: () => inFlight.current.get(key)?.abort() };
}
