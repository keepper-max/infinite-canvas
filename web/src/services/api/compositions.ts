import { nanoid } from "nanoid";

import { artifactUrl } from "./jobs";
import { platformRequest } from "./platform";
import type { DramaTimeline } from "@/types/drama";

export type CompositionJob = {
    id: string;
    projectId: string;
    nodeId: string;
    timelineVersionId: string;
    status: "pending" | "queued" | "preparing" | "rendering" | "uploading" | "retrying" | "cancel_requested" | "cancelled" | "failed" | "completed";
    progress: number;
    retryable: boolean;
    error?: { code: string; message: string; retryable: boolean } | null;
    outputAssetId?: string;
    outputAssetVersionId?: string;
};

export async function createCompositionJob(projectId: string, nodeId: string, name: string, timeline: DramaTimeline, idempotencyKey = `${nodeId}:${nanoid()}`) {
    return (
        await platformRequest<{ job: CompositionJob }>(`/api/projects/${encodeURIComponent(projectId)}/compositions`, {
            method: "POST",
            body: JSON.stringify({ nodeId, name, timeline, idempotencyKey }),
        })
    ).job;
}

export async function getCompositionJob(jobId: string, signal?: AbortSignal) {
    return (await platformRequest<{ job: CompositionJob }>(`/api/compositions/${encodeURIComponent(jobId)}`, { signal })).job;
}

export async function retryCompositionJob(jobId: string) {
    return (await platformRequest<{ job: CompositionJob }>(`/api/compositions/${encodeURIComponent(jobId)}/retry`, { method: "POST" })).job;
}

export async function cancelCompositionJob(jobId: string) {
    return (await platformRequest<{ job: CompositionJob }>(`/api/compositions/${encodeURIComponent(jobId)}/cancel`, { method: "POST" })).job;
}

export async function waitForCompositionJob(jobId: string, signal?: AbortSignal, onUpdate?: (job: CompositionJob) => void) {
    for (;;) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const job = await getCompositionJob(jobId, signal);
        onUpdate?.(job);
        if (job.status === "completed") return job;
        if (job.status === "failed" || job.status === "cancelled") throw new Error(job.error?.message || (job.status === "cancelled" ? "成片任务已取消" : "成片合成失败"));
        await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
}

export async function compositionOutputUrl(job: CompositionJob, signal?: AbortSignal) {
    if (!job.outputAssetVersionId) throw new Error("成片任务没有返回素材版本");
    return artifactUrl({ id: job.id, assetId: job.outputAssetId, assetVersionId: job.outputAssetVersionId, mimeType: "video/mp4" }, signal);
}
