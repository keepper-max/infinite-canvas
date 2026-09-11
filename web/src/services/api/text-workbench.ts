import { normalizeManagedModelId, type ManagedJob } from "./jobs";
import { getCurrentSession, platformRequest } from "./platform";

export type TextWorkbenchMode = "chat" | "prompt" | "script" | "storyboard" | "seedance";
export type TextConversation = {
    id: string;
    projectId: string;
    title: string;
    mode: TextWorkbenchMode;
    modelId: string;
    preview: string;
    messageCount: number;
    createdAt: string;
    updatedAt: string;
};
export type TextMessage = {
    id: string;
    conversationId: string;
    role: "user" | "assistant";
    content: string;
    status: "pending" | "completed" | "failed" | "cancelled";
    jobId?: string;
    modelId?: string;
    mode?: TextWorkbenchMode;
    error?: string;
    createdAt: string;
    updatedAt: string;
};

export async function listTextConversations(signal?: AbortSignal) {
    const projectId = (await getCurrentSession(signal)).workspace.projectId;
    return (await platformRequest<{ conversations: TextConversation[] }>(`/api/projects/${encodeURIComponent(projectId)}/text-conversations`, { signal })).conversations;
}

export async function createTextConversation(input: { title?: string; mode: TextWorkbenchMode; modelId: string }) {
    const projectId = (await getCurrentSession()).workspace.projectId;
    return (
        await platformRequest<{ conversation: TextConversation }>(`/api/projects/${encodeURIComponent(projectId)}/text-conversations`, {
            method: "POST",
            body: JSON.stringify({ ...input, modelId: normalizeManagedModelId(input.modelId) }),
        })
    ).conversation;
}

export async function updateTextConversation(conversationId: string, input: Partial<{ title: string; mode: TextWorkbenchMode; modelId: string }>) {
    return (
        await platformRequest<{ conversation: TextConversation }>(`/api/text-conversations/${encodeURIComponent(conversationId)}`, {
            method: "PATCH",
            body: JSON.stringify({ ...input, ...(input.modelId ? { modelId: normalizeManagedModelId(input.modelId) } : {}) }),
        })
    ).conversation;
}

export function deleteTextConversation(conversationId: string) {
    return platformRequest<{ archivedConversationId: string }>(`/api/text-conversations/${encodeURIComponent(conversationId)}`, { method: "DELETE" });
}

export async function listTextMessages(conversationId: string, signal?: AbortSignal) {
    return (await platformRequest<{ messages: TextMessage[] }>(`/api/text-conversations/${encodeURIComponent(conversationId)}/messages`, { signal })).messages;
}

export function generateTextMessage(conversationId: string, input: { content: string; modelId: string; mode: TextWorkbenchMode; reasoningEffort?: string }) {
    return platformRequest<{ userMessageId: string; assistantMessageId: string; job: ManagedJob }>(`/api/text-conversations/${encodeURIComponent(conversationId)}/generate`, {
        method: "POST",
        body: JSON.stringify({ ...input, modelId: normalizeManagedModelId(input.modelId) }),
    });
}
