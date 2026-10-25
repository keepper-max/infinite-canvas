import localforage from "localforage";
// A new document gets a new slot. Duplicated tabs may inherit sessionStorage, but never write the parent's slot.
const documentOwner = crypto.randomUUID();
const pending = new Map<string, Promise<unknown>>();
let failed = false;
const ownKey = (base: string) => base + ":draft:v1:" + documentOwner;
const ownerKey = (base: string) => base + ":draft-owner";
export function decodeAgentDraft<T>(raw: unknown): T | null {
    if (raw == null) return null;
    if (typeof raw !== "object") throw Error("本机草稿格式无法识别，原记录已保留，请先联系管理员核查。");
    const record = raw as Record<string, unknown>;
    const value = (Object.hasOwn(record, "version") ? (record.version === 1 ? record.value : null) : record) as Record<string, unknown> | null;
    if (!value || typeof value.sessionId !== "string" || typeof value.draft !== "string") throw Error("本机草稿格式无法识别，原记录已保留，请先联系管理员核查。");
    return value as T;
}
export async function readAgentDraft<T>(base: string): Promise<T | null> {
    const own = ownKey(base);
    await pending.get(own);
    const current = await localforage.getItem(own);
    if (current != null) return decodeAgentDraft<T>(current);
    const previous = sessionStorage.getItem(ownerKey(base));
    if (previous) {
        const prior = await localforage.getItem(base + ":draft:v1:" + previous);
        if (prior != null) return decodeAgentDraft<T>(prior);
    }
    // Existing project-level drafts are read, never overwritten or deleted.
    return decodeAgentDraft<T>(await localforage.getItem(base));
}
export function saveAgentDraft<T>(base: string, value: T): Promise<T> {
    const key = ownKey(base),
        prior = pending.get(key) ?? Promise.resolve();
    const next = prior
        .catch(() => undefined)
        .then(async () => {
            try {
                await localforage.setItem(key, { version: 1, value });
                sessionStorage.setItem(ownerKey(base), documentOwner);
                failed = false;
                return value;
            } catch {
                failed = true;
                throw Error("未能保存本机草稿，请先复制当前输入后再离开。");
            }
        });
    pending.set(key, next);
    void next
        .finally(() => {
            if (pending.get(key) === next) pending.delete(key);
        })
        .catch(() => undefined);
    return next;
}
window.addEventListener("beforeunload", (event) => {
    if (pending.size || failed) {
        event.preventDefault();
        event.returnValue = "";
    }
});
