import { platformRequest, PlatformApiError } from "./platform";
export type KnowledgeReference = { spaceId: string; documentId: string } & ({ mode: "latest" } | { mode: "pinned"; revision: number });
export type KnowledgeReferenceSummary = { reference: KnowledgeReference; title: string; excerpt: string; revision: number; latestRevision: number; contentHash: string; characters: number };
export type KnowledgeCanvasReceipt = { operationId: string; revision: number; replayed: boolean; result: { createdNodeId: string } };
export type KnowledgeCanvasAdd = { operationId: string; expectedCanvasRevision: number; reference: KnowledgeReference; position: { x: number; y: number } };
export const knowledgeDragType = "application/x-shoushou-knowledge-reference";
export const referenceSummary = (projectId: string, reference: KnowledgeReference, signal?: AbortSignal) =>
    platformRequest<KnowledgeReferenceSummary>("/api/knowledge/reference-summary", { method: "POST", body: JSON.stringify({ projectId, reference }), signal });
export const addKnowledgeToCanvas = (projectId: string, input: KnowledgeCanvasAdd) => platformRequest<KnowledgeCanvasReceipt>(`/api/knowledge/canvas/${projectId}/nodes`, { method: "POST", body: JSON.stringify(input) });
export const knowledgeCanvasReceipt = async (projectId: string, operationId: string) => {
    try {
        return await platformRequest<KnowledgeCanvasReceipt>(`/api/knowledge/canvas/${projectId}/operations/${operationId}`);
    } catch (e) {
        if (e instanceof PlatformApiError && e.code === "CANVAS_OPERATION_NOT_FOUND") return null;
        throw e;
    }
};
