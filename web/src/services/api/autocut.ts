import type { P1Timeline, V1Input } from "../../../../server/api/src/autocut/p1/runtime.js";
import { platformRequest } from "./platform";
export type AutoCutClip = { id: string; asset_id: string; asset_version_id: string; source_in: number; source_out: number; timeline_start: number; effects: { volume: number; muted: boolean }; transitions: { type: "cut" | "fade"; duration: number } };
export type AutoCutTimeline = {
    schema_version: 1;
    project_id: string;
    revision_id: string;
    target_duration: number;
    aspect_ratio: "16:9" | "9:16" | "1:1";
    fps: 25 | 30;
    tracks: { id: string; kind: "video" | "audio"; clips: AutoCutClip[] }[];
    subtitles: { id: string; start: number; end: number; text: string }[];
    audio_settings: { master_volume: number };
    export_settings: { codec: "h264"; format: "mp4"; resolution: 720 };
    warnings: string[];
};
export type AutoCutProject = { id: string; project_id: string; name: string; asset_version_ids: string[]; current_revision_id: string | null };
export type AutoCutTask = {
    input?: { kind: string; p1?: { previewClipId?: string } };
    id: string;
    status: string;
    stage: string;
    progress: number;
    error_message: string | null;
    output_asset_version_id: string | null;
    output_revision_id: string | null;
    budget_cents: number;
    reserved_cents: number;
    attempts: number;
    metrics: Record<string, number>;
    cancel_requested: boolean;
};
export type AutoCutDetail = {
    project: AutoCutProject;
    timeline: AutoCutTimeline | null;
    tasks: AutoCutTask[];
    assets: { id: string; assetId: string; name: string; mimeType: string; bytes: number }[];
    analyses: Record<
        string,
        {
            durationMs: number;
            width: number;
            height: number;
            fps: number;
            hasAudio: boolean;
            transcript: { segments: { start: number; end: number; text: string }[] };
            candidates: { start: number; end: number; summary: string; confidence: number; evidence: string }[];
        }
    >;
    revisions: { id: string; parent_id: string | null; created_at: string }[];
    calls: { task_id: string; quote_cents: number; credit_points?: string | null; credit_status?: string | null; billing_status: string; model_id: string }[];
};
export type AutoCutAudioOptions = {
    originalVolume?: number;
    narration?: { text: string; modelId: string; parameters: Record<string, unknown> };
};
export type NarrationModel = {
    id: string; displayName: string; limits: { maxPromptChars?: number };
    parameters: { key: string; description?: string; required?: boolean; type: string; defaultValue?: unknown; options?: (string | number | boolean)[] }[];
    defaults: Record<string, unknown>;
};
export type AutoCutRequest = AutoCutAudioOptions & {
    operationId: string;
    expectedRevision: string | null;
    kind: "edit" | "render";
    prompt: string;
    mode: "auto" | "highlights" | "speech" | "travel" | "product" | "custom";
    targetDurationMs: number;
    aspectRatio: AutoCutTimeline["aspect_ratio"];
    budgetCents: number;
    confirmed: boolean;
    scope?: "all" | "subtitles";
};
const root = "/api/autocut";
export const autoCutStatus = () => platformRequest<{ p1Enabled: boolean; enabled: boolean; accepting: boolean; limits: { fileBytes: number; assets: number; durationMs: number } }>(`${root}/status`);
export const listAutoCutProjects = (id: string) => platformRequest<AutoCutProject[]>(`${root}/workspaces/${encodeURIComponent(id)}/projects`);
export const createAutoCutProject = (id: string, name: string, assetVersionIds: string[]) => platformRequest<AutoCutProject>(`${root}/workspaces/${encodeURIComponent(id)}/projects`, { method: "POST", body: JSON.stringify({ name, assetVersionIds }) });
export const getAutoCutProject = (id: string, signal?: AbortSignal) => platformRequest<AutoCutDetail>(`${root}/projects/${encodeURIComponent(id)}`, { signal });
export const saveAutoCutTimeline = (id: string, expectedRevision: string | null, timeline: AutoCutTimeline) =>
    platformRequest<AutoCutTimeline>(`${root}/projects/${encodeURIComponent(id)}/timeline`, { method: "PUT", body: JSON.stringify({ expectedRevision, timeline }) });
export const restoreAutoCutRevision = (id: string, expectedRevision: string | null, revisionId: string) =>
    platformRequest<AutoCutTimeline>(`${root}/projects/${encodeURIComponent(id)}/restore`, { method: "POST", body: JSON.stringify({ expectedRevision, revisionId }) });
export const startAutoCutTask = (id: string, input: AutoCutRequest) => platformRequest<AutoCutTask>(`${root}/projects/${encodeURIComponent(id)}/tasks`, { method: "POST", body: JSON.stringify(input) });
export const cancelAutoCutTask = (id: string, task: string) => platformRequest(`${root}/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(task)}/cancel`, { method: "POST", body: "{}" });
export const retryAutoCutTask = (id: string, task: string) => platformRequest<AutoCutTask>(`${root}/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(task)}/retry`, { method: "POST", body: "{}" });
export const archiveAutoCutProject = (id: string) => platformRequest(`${root}/projects/${encodeURIComponent(id)}/archive`, { method: "POST", body: "{}" });

export type P1Detail = Omit<AutoCutDetail, "timeline"> & { timeline: P1Timeline | V1Input | null };
export type ExportFormat = "otio" | "fcp7" | "jianying" | "capcut" | "srt";
export const getP1Project = (id: string) => platformRequest<P1Detail>(`${root}/projects/${encodeURIComponent(id)}`);
export const p1Capabilities = () => platformRequest<{ enabled: boolean; formats: { format: ExportFormat; enabled: boolean; experimental: boolean; verifiedVersions: string[]; reason: string }[] }>(`${root}/p1/capabilities`);
export const saveP1Timeline = (id: string, expectedRevision: string | null, timeline: P1Timeline) =>
    platformRequest<P1Timeline>(`${root}/p1/projects/${encodeURIComponent(id)}/timeline`, { method: "PUT", body: JSON.stringify({ expectedRevision, timeline }) });
export const addP1Assets = (id: string, expectedRevision: string | null, assetVersionIds: string[]) =>
    platformRequest(`${root}/p1/projects/${encodeURIComponent(id)}/assets`, { method: "POST", body: JSON.stringify({ expectedRevision, assetVersionIds }) });
export const startP1Task = (
    id: string,
    input: Omit<AutoCutRequest, "kind"> & { kind: "render" | "prepare" | "export" | "effects"; p1: { version: 1; format?: ExportFormat; includeMedia?: boolean; acceptLossy?: boolean; clipIds?: string[]; previewClipId?: string } },
) => platformRequest<AutoCutTask>(`${root}/projects/${encodeURIComponent(id)}/tasks`, { method: "POST", body: JSON.stringify(input) });

export const autoCutNarrationModels = () => platformRequest<{ models: NarrationModel[]; quotePoints: number | null }>(`${root}/narration-models`);
