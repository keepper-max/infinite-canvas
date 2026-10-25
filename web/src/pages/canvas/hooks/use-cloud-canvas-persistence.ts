import { useCallback, useEffect, useRef, useState } from "react";

import { getCanvas, migrateIndexedDbCanvas, restoreCanvasSnapshot, saveCanvas, type CanvasDocument, type CanvasDraft, type CanvasMigrationReport } from "@/services/api/canvas";
import { backupLegacyCanvas, clearPendingCanvas, getCanvasCloudCache, recordPendingCanvas, recordSuccessfulCanvas } from "@/services/canvas-cloud-cache";
import { PlatformApiError } from "@/services/api/platform";

export type CanvasSyncStatus = "loading" | "synced" | "dirty" | "saving" | "unsynced" | "conflict";

const AUTO_SAVE_INTERVAL_MS = 10 * 60 * 1000;

export function useCloudCanvasPersistence(projectId: string, applyCanvas: (canvas: CanvasDraft, options?:{preserveViewport?:boolean}) => Promise<CanvasDraft|void> | CanvasDraft | void, onCachedCanvasApplied?: () => void) {
    const [status, setStatus] = useState<CanvasSyncStatus>("loading");
    const [migrationDraft, setMigrationDraft] = useState<CanvasDraft | null>(null);
    const [migrationReport, setMigrationReport] = useState<CanvasMigrationReport | null>(null);
    const [conflictDraft, setConflictDraft] = useState<CanvasDraft | null>(null);
    const revisionRef = useRef(0);
    const readyRef = useRef(false);
    const latestDraftRef = useRef<CanvasDraft | null>(null);
    const migrationCandidateRef = useRef<CanvasDraft | null>(null);
    const migrationBlockedRef = useRef(false);
    const conflictBlockedRef = useRef(false);
    const lastFingerprintRef = useRef("");
    const lastSuccessfulRef = useRef<CanvasDocument | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const savingRef = useRef(false);
    const saveWaitersRef = useRef<Array<() => void>>([]);
    const mountedRef = useRef(true);

    const clearAutoSaveTimer = useCallback(() => {
        if (!timerRef.current) return;
        clearTimeout(timerRef.current);
        timerRef.current = null;
    }, []);

    useEffect(() => {
        readyRef.current = false;
        latestDraftRef.current = null;
        migrationCandidateRef.current = null;
        migrationBlockedRef.current = false;
        conflictBlockedRef.current = false;
        lastFingerprintRef.current = "";
        lastSuccessfulRef.current = null;
        savingRef.current = false;
        saveWaitersRef.current.splice(0).forEach((resolve) => resolve());
        clearAutoSaveTimer();
        setMigrationDraft(null);
        setMigrationReport(null);
        setConflictDraft(null);
        setStatus("loading");
    }, [clearAutoSaveTimer, projectId]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            clearAutoSaveTimer();
        };
    }, [clearAutoSaveTimer]);

    const applyRemote = useCallback(
        async (canvas: CanvasDocument,options?:{preserveViewport?:boolean}) => {
            revisionRef.current = canvas.revision;
            lastSuccessfulRef.current = canvas;
            const applied=await applyCanvas(canvas,options);
            lastFingerprintRef.current = fingerprint(applied??canvas);
            await recordSuccessfulCanvas(projectId, canvas);
            readyRef.current = true;
            if (mountedRef.current&&!latestDraftRef.current) setStatus("synced");
        },
        [applyCanvas, projectId],
    );

    const load = useCallback(
        async (legacyDraft: CanvasDraft, legacyView: CanvasDraft = legacyDraft) => {
            readyRef.current = false;
            setStatus("loading");
            let appliedCachedFingerprint = "";
            let restoredLocalDraft = false;
            try {
                const cached = await getCanvasCloudCache(projectId);
                if (!cached.pendingDraft && cached.lastSuccessful) {
                    const cachedFingerprint = fingerprint(cached.lastSuccessful);
                    const legacyFingerprint = fingerprint(legacyDraft);
                    revisionRef.current = cached.lastSuccessful.revision;
                    lastFingerprintRef.current = cachedFingerprint;
                    lastSuccessfulRef.current = cached.lastSuccessful;
                    restoredLocalDraft = hasContent(legacyDraft) && cachedFingerprint !== legacyFingerprint;
                    if (restoredLocalDraft) latestDraftRef.current = legacyDraft;
                    await applyCanvas(cachedFingerprint === legacyFingerprint || restoredLocalDraft ? legacyView : cached.lastSuccessful);
                    appliedCachedFingerprint = cachedFingerprint;
                    readyRef.current = true;
                    onCachedCanvasApplied?.();
                    if (mountedRef.current) setStatus(restoredLocalDraft ? "dirty" : "synced");
                }
                const remote = await getCanvas(projectId);
                revisionRef.current = remote.revision;
                if (cached.pendingDraft) {
                    lastFingerprintRef.current = fingerprint(cached.pendingDraft);
                    await applyCanvas(cached.pendingDraft);
                    readyRef.current = true;
                    conflictBlockedRef.current = true;
                    setConflictDraft(cached.pendingDraft);
                    setStatus("conflict");
                    return;
                }
                if (remote.revision === 0 && hasContent(legacyDraft)) {
                    await backupLegacyCanvas(projectId, legacyDraft);
                    migrationCandidateRef.current = legacyDraft;
                    migrationBlockedRef.current = true;
                    lastFingerprintRef.current = fingerprint(legacyDraft);
                    await applyCanvas(legacyView);
                    readyRef.current = true;
                    setMigrationDraft(legacyDraft);
                    setStatus("unsynced");
                    return;
                }
                const remoteFingerprint = fingerprint(remote);
                if (appliedCachedFingerprint && latestDraftRef.current) {
                    if (appliedCachedFingerprint !== remoteFingerprint) {
                        conflictBlockedRef.current = true;
                        setConflictDraft(latestDraftRef.current);
                        setStatus("conflict");
                        return;
                    }
                    await recordSuccessfulCanvas(projectId, remote);
                    lastSuccessfulRef.current = remote;
                    if (mountedRef.current) setStatus("dirty");
                    return;
                }
                if (appliedCachedFingerprint && appliedCachedFingerprint === remoteFingerprint) {
                    lastFingerprintRef.current = remoteFingerprint;
                    lastSuccessfulRef.current = remote;
                    await recordSuccessfulCanvas(projectId, remote);
                    readyRef.current = true;
                    if (mountedRef.current) setStatus("synced");
                    return;
                }
                await applyRemote(remote);
            } catch (error) {
                if (error instanceof DOMException && error.name === "AbortError") throw error;
                if (error instanceof PlatformApiError && error.status > 0 && error.status < 500) throw error;
                const cached = await getCanvasCloudCache(projectId);
                const fallback = cached.pendingDraft || cached.lastSuccessful || legacyView;
                if (cached.lastSuccessful) revisionRef.current = cached.lastSuccessful.revision;
                lastFingerprintRef.current = fingerprint(cached.pendingDraft || cached.lastSuccessful || legacyDraft);
                if (!appliedCachedFingerprint || appliedCachedFingerprint !== fingerprint(fallback)) await applyCanvas(fallback);
                readyRef.current = true;
                setStatus("unsynced");
            }
        },
        [applyCanvas, applyRemote, onCachedCanvasApplied, projectId],
    );

    const flush = useCallback(async () => {
        if (!readyRef.current || savingRef.current || !latestDraftRef.current) return false;
        clearAutoSaveTimer();
        const draft = latestDraftRef.current;
        latestDraftRef.current = null;
        savingRef.current = true;
        setStatus("saving");
        try {
            const canvas = await saveCanvas(projectId, draft, revisionRef.current);
            revisionRef.current = canvas.revision;
            lastFingerprintRef.current = fingerprint(draft);
            lastSuccessfulRef.current = canvas;
            await recordSuccessfulCanvas(projectId, canvas);
            if (latestDraftRef.current) {
                if (!timerRef.current) timerRef.current = setTimeout(() => void flush(), AUTO_SAVE_INTERVAL_MS);
                if (mountedRef.current) setStatus("dirty");
            } else if (mountedRef.current) {
                setStatus("synced");
            }
            return true;
        } catch (error) {
            const pendingDraft = latestDraftRef.current || draft;
            latestDraftRef.current = pendingDraft;
            await recordPendingCanvas(projectId, pendingDraft);
            if (error instanceof PlatformApiError && error.code === "CANVAS_REVISION_CONFLICT") {
                conflictBlockedRef.current = true;
                setConflictDraft(pendingDraft);
                setStatus("conflict");
            } else {
                setStatus("unsynced");
            }
            return false;
        } finally {
            savingRef.current = false;
            saveWaitersRef.current.splice(0).forEach((resolve) => resolve());
        }
    }, [clearAutoSaveTimer, projectId]);

    const queueSave = useCallback(
        (draft: CanvasDraft) => {
            if (!readyRef.current || migrationBlockedRef.current || migrationDraft || conflictDraft) return;
            const nextFingerprint = fingerprint(draft);
            if (nextFingerprint === lastFingerprintRef.current) {
                latestDraftRef.current = null;
                clearAutoSaveTimer();
                setStatus("synced");
                return;
            }
            latestDraftRef.current = draft;
            setStatus("dirty");
            if (!timerRef.current) timerRef.current = setTimeout(() => void flush(), AUTO_SAVE_INTERVAL_MS);
        },
        [clearAutoSaveTimer, conflictDraft, flush, migrationDraft],
    );

    const saveNow = useCallback(async () => {
        if (savingRef.current) return false;
        return flush();
    }, [flush]);

    const saveDraftNow = useCallback(
        async (draft: CanvasDraft) => {
            if (!readyRef.current || migrationBlockedRef.current || conflictBlockedRef.current || migrationDraft || conflictDraft) return false;
            while (savingRef.current) await new Promise<void>((resolve) => saveWaitersRef.current.push(resolve));
            if (!readyRef.current || migrationBlockedRef.current || conflictBlockedRef.current || migrationDraft || conflictDraft) return false;
            if (fingerprint(draft) === lastFingerprintRef.current) return true;
            latestDraftRef.current = draft;
            return flush();
        },
        [conflictDraft, flush, migrationDraft],
    );

    const discardPendingChanges = useCallback(() => {
        const lastSuccessful = lastSuccessfulRef.current;
        latestDraftRef.current = null;
        clearAutoSaveTimer();
        setStatus(lastFingerprintRef.current ? "synced" : "unsynced");
        void clearPendingCanvas(projectId);
        return lastSuccessful;
    }, [clearAutoSaveTimer, projectId]);

    const confirmMigration = useCallback(async () => {
        if (!migrationDraft) return;
        setStatus("saving");
        try {
            const result = await migrateIndexedDbCanvas(projectId, `indexeddb-v7-${projectId}`, migrationDraft, revisionRef.current);
            revisionRef.current = result.canvas.revision;
            lastFingerprintRef.current = fingerprint(result.canvas);
            lastSuccessfulRef.current = result.canvas;
            await recordSuccessfulCanvas(projectId, result.canvas);
            migrationCandidateRef.current = null;
            migrationBlockedRef.current = false;
            setMigrationDraft(null);
            setMigrationReport(result.report);
            setStatus("synced");
        } catch {
            await recordPendingCanvas(projectId, migrationDraft);
            setStatus("unsynced");
        }
    }, [migrationDraft, projectId]);

    const dismissMigration = useCallback(() => {
        setMigrationDraft(null);
        setStatus("unsynced");
    }, []);

    const reopenMigration = useCallback(() => {
        if (migrationCandidateRef.current) setMigrationDraft(migrationCandidateRef.current);
    }, []);

    const resolveConflict = useCallback(
        async (choice: "cloud" | "local") => {
            if (!conflictDraft) return;
            setStatus("loading");
            try {
                const remote = await getCanvas(projectId);
                revisionRef.current = remote.revision;
                if (choice === "cloud") {
                    latestDraftRef.current = null;
                    conflictBlockedRef.current = false;
                    setConflictDraft(null);
                    await applyRemote(remote);
                    return;
                }
                const canvas = await saveCanvas(projectId, conflictDraft, remote.revision);
                conflictBlockedRef.current = false;
                setConflictDraft(null);
                latestDraftRef.current = null;
                await applyRemote(canvas);
            } catch {
                setStatus("unsynced");
            }
        },
        [applyRemote, conflictDraft, projectId],
    );

    const restoreSnapshot = useCallback(async (version: number) => {
        if (savingRef.current || latestDraftRef.current || conflictBlockedRef.current || migrationBlockedRef.current) throw new Error("请先保存当前画布，再恢复历史版本");
        clearAutoSaveTimer();
        readyRef.current = false;
        try { await applyRemote(await restoreCanvasSnapshot(projectId, version, revisionRef.current)); }
        finally { readyRef.current = true; }
    }, [applyRemote, clearAutoSaveTimer, projectId]);
    const refreshExternal = useCallback(async () => {
        const assertClean = () => {
            if (!readyRef.current || savingRef.current || latestDraftRef.current || conflictBlockedRef.current || migrationBlockedRef.current)
                throw new Error("当前画布有未保存内容或冲突，请先保留草稿并处理，再同步助手结果");
        };
        assertClean();
        const remote = await getCanvas(projectId);
        assertClean(); // Edits made while the HTTP request was in flight must also survive.
        await applyRemote(remote,{preserveViewport:true});
        return {revision:remote.revision,nodeCount:remote.nodes.length,edgeCount:remote.edges.length};
    }, [applyRemote, projectId]);
    const compareExternal=useCallback(async()=>{
        const remote=await getCanvas(projectId),local=latestDraftRef.current??lastSuccessfulRef.current;
        return {revision:remote.revision,hasDraft:!!latestDraftRef.current,localNodeCount:local?.nodes.length??0,remoteNodeCount:remote.nodes.length,addedNodes:remote.nodes.filter(n=>!local?.nodes.some(l=>l.id===n.id)).map(({id,title,type})=>({id,title,type})),changedNodes:remote.nodes.filter(n=>local?.nodes.some(l=>l.id===n.id&&JSON.stringify(l)!==JSON.stringify(n))).map(({id,title})=>({id,title}))};
    },[projectId]);
    const keepDraft=useCallback(async()=>{if(latestDraftRef.current)await recordPendingCanvas(projectId,latestDraftRef.current);},[projectId]);
    const hasUnsavedChanges = status === "dirty" || (status === "unsynced" && Boolean(latestDraftRef.current));

    return {
        status,
        refreshExternal,
        compareExternal,keepDraft,
        hasUnsavedChanges,
        load,
        queueSave,
        saveNow,
        saveDraftNow,
        discardPendingChanges,
        migrationDraft,
        migrationReport,
        dismissMigration,
        confirmMigration,
        reopenMigration,
        conflictDraft,
        resolveConflict,
        restoreSnapshot,
    };
}

function fingerprint(draft: CanvasDraft) {
    return JSON.stringify(canonicalizeFingerprintValue({ nodes: draft.nodes, edges: draft.edges, viewport: draft.viewport, settings: draft.settings }));
}

function canonicalizeFingerprintValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => canonicalizeFingerprintValue(item));
    if (!value || typeof value !== "object") return value;
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    const cloudBacked = typeof source.assetVersionId === "string" && Boolean(source.assetVersionId);
    for (const key of Object.keys(source).sort()) {
        const normalized = key.replace(/[-_\s]/g, "").toLowerCase();
        if (normalized === "thumbnailurl") continue;
        if (normalized === "images" && Array.isArray(source[key]) && source[key].length === 0) continue;
        if (normalized === "content" && cloudBacked) continue;
        const item = canonicalizeFingerprintValue(source[key]);
        if (item !== undefined) output[key] = item;
    }
    return output;
}

function hasContent(draft: CanvasDraft) {
    return draft.nodes.length > 0 || draft.edges.length > 0;
}
