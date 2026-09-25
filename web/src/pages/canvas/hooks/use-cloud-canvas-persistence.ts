import { useCallback, useEffect, useRef, useState } from "react";

import { getCanvas, migrateIndexedDbCanvas, saveCanvas, type CanvasDocument, type CanvasDraft, type CanvasMigrationReport } from "@/services/api/canvas";
import { backupLegacyCanvas, getCanvasCloudCache, recordPendingCanvas, recordSuccessfulCanvas } from "@/services/canvas-cloud-cache";
import { PlatformApiError } from "@/services/api/platform";

export type CanvasSyncStatus = "loading" | "synced" | "dirty" | "saving" | "unsynced" | "conflict";

const AUTO_SAVE_INTERVAL_MS = 10 * 60 * 1000;

export function useCloudCanvasPersistence(projectId: string, applyCanvas: (canvas: CanvasDraft) => Promise<void> | void, onCachedCanvasApplied?: () => void) {
    const [status, setStatus] = useState<CanvasSyncStatus>("loading");
    const [migrationDraft, setMigrationDraft] = useState<CanvasDraft | null>(null);
    const [migrationReport, setMigrationReport] = useState<CanvasMigrationReport | null>(null);
    const [conflictDraft, setConflictDraft] = useState<CanvasDraft | null>(null);
    const revisionRef = useRef(0);
    const readyRef = useRef(false);
    const latestDraftRef = useRef<CanvasDraft | null>(null);
    const migrationCandidateRef = useRef<CanvasDraft | null>(null);
    const migrationBlockedRef = useRef(false);
    const lastFingerprintRef = useRef("");
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const savingRef = useRef(false);
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
        lastFingerprintRef.current = "";
        savingRef.current = false;
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
        async (canvas: CanvasDocument) => {
            revisionRef.current = canvas.revision;
            lastFingerprintRef.current = fingerprint(canvas);
            await applyCanvas(canvas);
            await recordSuccessfulCanvas(projectId, canvas);
            readyRef.current = true;
            if (mountedRef.current) setStatus("synced");
        },
        [applyCanvas, projectId],
    );

    const load = useCallback(
        async (legacyDraft: CanvasDraft, legacyView: CanvasDraft = legacyDraft) => {
            readyRef.current = false;
            setStatus("loading");
            let appliedCachedFingerprint = "";
            try {
                const cached = await getCanvasCloudCache(projectId);
                if (!cached.pendingDraft && cached.lastSuccessful) {
                    const cachedFingerprint = fingerprint(cached.lastSuccessful);
                    if (cachedFingerprint === fingerprint(legacyDraft)) {
                        revisionRef.current = cached.lastSuccessful.revision;
                        lastFingerprintRef.current = cachedFingerprint;
                        await applyCanvas(legacyView);
                        appliedCachedFingerprint = cachedFingerprint;
                        onCachedCanvasApplied?.();
                    }
                }
                const remote = await getCanvas(projectId);
                revisionRef.current = remote.revision;
                if (cached.pendingDraft) {
                    lastFingerprintRef.current = fingerprint(cached.pendingDraft);
                    await applyCanvas(cached.pendingDraft);
                    readyRef.current = true;
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
                if (appliedCachedFingerprint && appliedCachedFingerprint === remoteFingerprint) {
                    lastFingerprintRef.current = remoteFingerprint;
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
                setConflictDraft(pendingDraft);
                setStatus("conflict");
            } else {
                setStatus("unsynced");
            }
            return false;
        } finally {
            savingRef.current = false;
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

    const discardPendingChanges = useCallback(() => {
        latestDraftRef.current = null;
        clearAutoSaveTimer();
    }, [clearAutoSaveTimer]);

    const confirmMigration = useCallback(async () => {
        if (!migrationDraft) return;
        setStatus("saving");
        try {
            const result = await migrateIndexedDbCanvas(projectId, `indexeddb-v7-${projectId}`, migrationDraft, revisionRef.current);
            revisionRef.current = result.canvas.revision;
            lastFingerprintRef.current = fingerprint(result.canvas);
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
                    setConflictDraft(null);
                    await applyRemote(remote);
                    return;
                }
                const canvas = await saveCanvas(projectId, conflictDraft, remote.revision);
                setConflictDraft(null);
                latestDraftRef.current = null;
                await applyRemote(canvas);
            } catch {
                setStatus("unsynced");
            }
        },
        [applyRemote, conflictDraft, projectId],
    );

    const hasUnsavedChanges = status === "dirty" || (status === "unsynced" && Boolean(latestDraftRef.current));

    return {
        status,
        hasUnsavedChanges,
        load,
        queueSave,
        saveNow,
        discardPendingChanges,
        migrationDraft,
        migrationReport,
        dismissMigration,
        confirmMigration,
        reopenMigration,
        conflictDraft,
        resolveConflict,
    };
}

function fingerprint(draft: CanvasDraft) {
    return JSON.stringify({ nodes: draft.nodes, edges: draft.edges, viewport: draft.viewport, settings: draft.settings }, function (key, value) {
        const normalized = key.replace(/[-_\s]/g, "").toLowerCase();
        if (normalized === "thumbnailurl") return undefined;
        if (normalized === "images" && Array.isArray(value) && value.length === 0) return undefined;
        if (normalized === "content" && this && typeof this === "object" && "assetVersionId" in this && typeof this.assetVersionId === "string" && this.assetVersionId) return undefined;
        return value;
    });
}

function hasContent(draft: CanvasDraft) {
    return draft.nodes.length > 0 || draft.edges.length > 0;
}
