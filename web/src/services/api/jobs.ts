import { nanoid } from "nanoid";

import { getCurrentSession, platformRequest } from "./platform";

export type ManagedCapability = "text" | "image" | "video" | "audio";
export type ManagedMode = "chat" | "t2i" | "i2i" | "tts" | "t2v" | "i2v" | "flf2v" | "multiref";
export type ManagedReference = {
    role: "first_frame" | "last_frame" | "identity_reference" | "environment_reference" | "composition_reference" | "motion_reference" | "video_input" | "audio_reference";
    dataUrl?: string;
    url?: string;
    assetVersionId?: string;
    mimeType?: string;
};
export type ManagedJobTrace = {
    workflowKind?: string;
    skillId?: string;
    skillVersion?: string;
    inputHash?: string;
    outputRevision?: number;
    userModified?: boolean;
    inputSnapshot?: Record<string, unknown>;
    assetKind?: "character" | "scene" | "prop" | "image" | "video" | "audio";
    assetName?: string;
};
export type ManagedJob = {
    id: string;
    projectId: string;
    nodeId?: string;
    modelId: string;
    capability: ManagedCapability;
    mode: ManagedMode;
    status: "pending" | "queued" | "submitting" | "retrying" | "running" | "downloading" | "persisting" | "cancel_requested" | "cancelled" | "failed" | "completed";
    progress: number;
    error?: { code: string; message: string; retryable: boolean } | null;
    outputAssetVersionIds: string[];
    artifacts?: Array<{ id: string; assetId?: string; assetVersionId?: string; mimeType?: string; text?: string }>;
};

type Context = { projectId?: string; nodeId?: string; nodeRevision?: number; idempotencyKey?: string; signal?: AbortSignal };

export async function createManagedJob(input: { model: string; capability: ManagedCapability; mode: ManagedMode; prompt: string; parameters?: Record<string, unknown>; references?: ManagedReference[]; trace?: ManagedJobTrace }, context: Context = {}) {
    const projectId = context.projectId || (await getCurrentSession(context.signal)).workspace.projectId;
    const requestHash = stableHash(JSON.stringify(input));
    const idempotencyKey = context.idempotencyKey || (context.nodeId ? `${context.nodeId}:${context.nodeRevision || 0}:${input.capability}:${input.mode}:${requestHash}` : `workbench:${nanoid()}`);
    return (
        await platformRequest<{ job: ManagedJob }>(`/api/projects/${encodeURIComponent(projectId)}/jobs`, {
            method: "POST",
            signal: context.signal,
            body: JSON.stringify({
                nodeId: context.nodeId,
                nodeRevision: context.nodeRevision || 0,
                modelId: normalizeManagedModelId(input.model),
                capability: input.capability,
                mode: input.mode,
                prompt: input.prompt,
                parameters: input.parameters || {},
                references: input.references || [],
                trace: input.trace,
                idempotencyKey,
            }),
        })
    ).job;
}

export async function getManagedJob(jobId: string, signal?: AbortSignal) {
    return (await platformRequest<{ job: ManagedJob }>(`/api/jobs/${encodeURIComponent(jobId)}`, { signal })).job;
}

export async function cancelManagedJob(jobId: string) {
    return (await platformRequest<{ job: ManagedJob }>(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" })).job;
}

export async function retryManagedJob(jobId: string) {
    return (await platformRequest<{ job: ManagedJob }>(`/api/jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST" })).job;
}

export async function waitForManagedJob(jobId: string, signal?: AbortSignal) {
    for (;;) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const job = await getManagedJob(jobId, signal);
        if (job.status === "completed") return job;
        if (job.status === "failed" || job.status === "cancelled") throw new Error(job.error?.message || (job.status === "cancelled" ? "任务已取消" : "生成失败"));
        await delay(1_500, signal);
    }
}

export async function artifactUrl(artifact: NonNullable<ManagedJob["artifacts"]>[number], signal?: AbortSignal) {
    if (!artifact.assetVersionId) throw new Error("生成结果缺少素材版本");
    return (await platformRequest<{ url: string }>(`/api/asset-versions/${encodeURIComponent(artifact.assetVersionId)}/download`, { signal })).url;
}

export type ManagedJobEvent = { id: number; jobId: string; nodeId?: string; type: string; status: ManagedJob["status"]; progress: number; message?: string };

export function subscribeProjectJobEvents(projectId: string, onEvent: (event: ManagedJobEvent) => void) {
    const source = new EventSource(`/api/projects/${encodeURIComponent(projectId)}/events`, { withCredentials: true });
    const types = ["job.created", "job.queued", "job.started", "job.progress", "job.downloading", "job.persisting", "job.completed", "job.failed", "job.retrying", "job.cancel_requested", "job.cancelled"];
    const listener = (message: MessageEvent<string>) => {
        try {
            onEvent(JSON.parse(message.data) as ManagedJobEvent);
        } catch {
            /* Ignore malformed events; the next snapshot remains authoritative. */
        }
    };
    types.forEach((type) => source.addEventListener(type, listener as EventListener));
    return () => source.close();
}

export function normalizeManagedModelId(value: string) {
    const name = value.includes("::") ? value.split("::").slice(1).join("::") : value;
    const aliases: Record<string, string> = { "gpt-5.5": "text.gpt-5-5", "nano-banana-2": "image.nano-banana-2", "seedance-2.5": "video.seedance-2-5", "seed-audio-1.0": "audio.seed-audio-1" };
    return aliases[name] || name;
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}
function stableHash(value: string) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
    return (hash >>> 0).toString(36);
}
