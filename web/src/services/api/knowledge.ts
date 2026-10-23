import { platformRequest, PlatformApiError } from "./platform";
async function knowledgeRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const segment = path.slice("/api/knowledge/".length).split(/[/?]/)[0];
    if (!segment || (!['spaces', 'reference-summary', 'canvas'].includes(segment) && !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(segment)))
        throw new PlatformApiError("知识空间尚未就绪，请选择知识库或重新加载", 0, "KNOWLEDGE_SPACE_REQUIRED", false);
    try { return await platformRequest<T>(path, init); }
    catch (error) {
        if (error instanceof PlatformApiError) {
            const diagnostic = { method: init.method || 'GET', path, status: error.status, code: error.code, spaceId: segment, context: window.location.search, stack: new Error().stack };
            window.dispatchEvent(new CustomEvent('knowledge:request-error', { detail: diagnostic }));
            if (error.code === 'NOT_FOUND') error.message = '知识接口不存在，请重试；若持续出现，请联系管理员核对服务版本';
        }
        throw error;
    }
}
export type KnowledgeSpace = { id: string; kind: "personal" | "project"; project_id: string | null; name: string; role: string };
export type KnowledgeFolder = { id: string; parent_id: string | null; name: string; revision: number };
export type KnowledgeDocument = { id: string; spaceId: string; folderId: string | null; title: string; markdown: string; revision: number; contentHash: string; deletedAt: string | null; updatedAt: string; createdAt: string };
export type KnowledgeSummary = Omit<KnowledgeDocument, "markdown"> & { excerpt: string };
export type KnowledgeReceipt = KnowledgeDocument & { operationId: string; persisted: true; replayed: boolean; importedExisting?: boolean; alreadyLinked?: boolean };
export type KnowledgeAction = { operationId: string; action: string; payload: Record<string, unknown> };
export type KnowledgeRelations = {
    outgoing: { ordinal: number; target_text: string; display_text: string | null; target_id: string | null; status: string; target_title: string | null; choices: { id: string; title: string; folder_id: string | null }[] }[];
    backlinks: { id: string; title: string; folder_id: string | null }[];
};
const base = "/api/knowledge";
export type KnowledgeGraphNode = { id: string; title: string; folderId: string | null; tags: string[]; degree: number; unresolvedCount: number };
export type KnowledgeGraphEdge = { source: string; target: string; references: number };
export type KnowledgeGraphPage = { nodes: KnowledgeGraphNode[]; edges: KnowledgeGraphEdge[]; totalNodes: number; totalEdges: number | null; nextCursor: string | null; nextEdgeCursor: string | null; centerId: string | null };
export const getKnowledgeGraph = (space: string, input: Record<string, string | number | undefined> = {}, signal?: AbortSignal) =>
    knowledgeRequest<KnowledgeGraphPage>(
        `${base}/${space}/graph?` +
            new URLSearchParams(
                Object.entries(input)
                    .filter(([, v]) => v !== undefined && v !== "")
                    .map(([k, v]) => [k, String(v)]),
            ),
        { signal },
    );
export const getKnowledgeSpaces = (signal?: AbortSignal) => knowledgeRequest<KnowledgeSpace[]>(base + "/spaces", { signal });
export const ensureKnowledgeSpace = (kind: "personal" | "project", projectId: string | null = null) => knowledgeRequest<KnowledgeSpace>(base + "/spaces", { method: "POST", body: JSON.stringify({ kind, projectId, operationId: crypto.randomUUID() }) });
export const listKnowledge = (space: string, input: Record<string, string | number | boolean | undefined> = {}, signal?: AbortSignal) =>
    knowledgeRequest<{ items: KnowledgeSummary[]; total: number; page: number; pageSize: number }>(
        `${base}/${space}/documents?` +
            new URLSearchParams(
                Object.entries(input)
                    .filter(([, v]) => v !== undefined && v !== "")
                    .map(([k, v]) => [k, String(v)]),
            ),
        { signal },
    );
export const getKnowledgeDocument = (space: string, id: string) => knowledgeRequest<KnowledgeDocument>(`${base}/${space}/documents/${id}`);
export const getKnowledgeFolders = (space: string, signal?: AbortSignal) => knowledgeRequest<KnowledgeFolder[]>(`${base}/${space}/folders`, { signal });
export const getKnowledgeTags = (space: string, signal?: AbortSignal) => knowledgeRequest<{ tag: string; count: number }[]>(`${base}/${space}/tags`, { signal });
export const getKnowledgeRelations = (space: string, id: string) => knowledgeRequest<KnowledgeRelations>(`${base}/${space}/documents/${id}/relations`);
export const knowledgeAction = async <T = KnowledgeReceipt>(space: string, input: KnowledgeAction, signal?: AbortSignal) => { const result = await knowledgeRequest<T>(`${base}/${space}/actions`, { method: "POST", body: JSON.stringify(input), signal }); window.dispatchEvent(new Event("knowledge:changed")); return result; };
export const getKnowledgeReceipt = (space: string, op: string, signal?: AbortSignal) => knowledgeRequest<KnowledgeReceipt>(`${base}/${space}/operations/${op}`, { signal });
export const getKnowledgeHistory = (space: string, id: string) => knowledgeRequest<{ revision: number; title: string; content_hash: string; deleted_at: string | null; created_at: string }[]>(`${base}/${space}/documents/${id}/history`);
export const getKnowledgeVersion = (space: string, id: string, revision: number) => knowledgeRequest<{ revision: number; title: string; markdown: string; content_hash: string }>(`${base}/${space}/documents/${id}/history/${revision}`);
export type KnowledgeLinkPreview = { sourceId: string; targetId: string; sourceTitle: string; targetTitle: string; expectedRevision: number; beforeMarkdown: string; markdown: string; alreadyLinked?: boolean; existingReference?: boolean; requiresEditor: boolean; ordinal?: number; occurrences?: { ordinal: number; start: number | null; end: number | null; text: string; target: string }[] };
export const previewKnowledgeLink = (space: string, source: string, target: string, action: 'add' | 'remove') => knowledgeRequest<KnowledgeLinkPreview>(`${base}/${space}/documents/${source}/link-preview?` + new URLSearchParams({ targetId: target, action }));
