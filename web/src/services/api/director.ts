import { platformRequest } from "./platform";

export type DirectorSettings = { enabled: boolean; modelId: string | null; modelDisplayName: string | null };
export type DirectorHistoryJob = {
    id: string;
    status: string;
    idea: string;
    profile: string;
    retryable: boolean;
    error?: { code: string; message: string; retryable: boolean } | null;
    createdAt: string;
    updatedAt: string;
};

export async function getDirectorSettings(signal?: AbortSignal) {
    return (await platformRequest<{ settings: DirectorSettings }>("/api/director/settings", { signal })).settings;
}

export async function getPendingDirectorJob(signal?: AbortSignal) {
    return (await platformRequest<{ job: { id: string; status: string; idea: string; profile: string } | null }>("/api/director/pending-job", { signal })).job;
}

export async function listDirectorHistory(signal?: AbortSignal) {
    return (await platformRequest<{ jobs: DirectorHistoryJob[] }>("/api/director/history", { signal })).jobs;
}
