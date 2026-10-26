import { platformRequest, PlatformApiError, PLATFORM_SESSION_EXPIRED_EVENT } from "./platform";
const base = "/api/native-agent";
export type AgentMode = "advice" | "execute";
export type AgentSession = { id: string; project_id: string; title: string; mode: AgentMode; closed_at: string | null };
export type ActiveAgentRun = { accessible: false } | { accessible: true; runId: string; sessionId: string; projectId: string; status: string };
export const getActiveAgentRun = (signal?: AbortSignal) => platformRequest<ActiveAgentRun | null>(base + "/active-run", { signal });
export type AgentRun = {
    id: string;
    operation_id: string;
    session_id: string;
    project_id: string;
    status: string;
    revision: number;
    mode: AgentMode;
    model_id: string;
    policy_snapshot?: { version: number };
    error_code: string | null;
    error_message: string | null;
    rounds: number;
    tool_count: number;
    input_tokens: number;
    output_tokens: number;
    budget_cents: number;
    spent_cents: number;
    reserved_cents: number;
    plan_protocol?: number;
    budget_limits?: Record<string, number>;
};
export type AgentMessage = { run_id: string; turn_id: string; item_id: string; role: "user" | "assistant"; content: string };
export type AgentApproval = { id: string; run_id: string; payload_hash: string; revision: number; status: string; preview: { tool: string; summary?: string; operationId: string; parameters: unknown }[] };
export type AgentPlan = {
    id: string;
    run_id: string;
    revision: number;
    status: string;
    goal: string;
    steps: { stepId: string; toolName: string; input: unknown; dependencies: string[]; dedupeOf?: string }[];
    approval_scope: Record<string, unknown>;
    expected_outputs: { nodes: { id: string; title: string; type: string }[]; edges: { id: string }[] };
    outputs: unknown;
};
export type AgentTaskPresentation = {
    runId: string;
    status: string;
    statusLabel: string;
    displayTitle: string;
    summary: string;
    safeErrorMessage: string;
    plan: null | { title: string; consequence: string; items: { key: string; title: string; description: string }[]; nodeCount: number; edgeCount: number };
    progressItems: { key: string; title: string; status: string; statusLabel: string }[];
    result: null | { saved: boolean; updatedNodes?: { id: string; title: string }[]; nodes: { id: string; title: string; type: string }[]; knowledgeCount: number; textCount: number; edgeCount: number; revision: number | null };
    technicalTraceRef: string;
};
export const getAgentTrace = (id: string) => platformRequest<unknown>(base + "/admin/sessions/" + id + "/trace");
export type AgentSnapshot = {
    presentation?: { version: 1; tasks: AgentTaskPresentation[]; messages: AgentMessage[] };
    session: AgentSession;
    runs: AgentRun[];
    messages: AgentMessage[];
    steps: { id: string; run_id: string; kind: string; tool_name: string | null; status: string; ordinal: number; input?: unknown; output?: unknown; error_code?: string; error_message?: string }[];
    plans?: AgentPlan[];
    usage?: { run_id: string; step_id: string; input_tokens: number; output_tokens: number; supplier_cents: number; job_id: string | null; meter_status: string }[];
    sources?: { runId: string; title: string; documentId: string; revision: number; contentHash: string; ranges?: { start: number; end: number }[] }[];
    approvals: AgentApproval[];
};
export type AgentEvent = { id: number; run_id: string; turn_id: string; item_id: string; type: string; data: Record<string, unknown> };
export const nativeAgentStatus = (signal?: AbortSignal) =>
    platformRequest<{
        enabled: boolean;
        limits: Record<string, number>;
        limitsHash: string;
        defaultModelId: string | null;
        userModelSelectionEnabled: boolean;
        maxBudgetCents: number | null;
        policyVersion: number | null;
        models: { id: string; name: string; substitute: boolean }[];
    }>(base + "/status", { signal });
export const listAgentSessions = (projectId: string, signal?: AbortSignal) => platformRequest<AgentSession[]>(base + "/sessions?projectId=" + encodeURIComponent(projectId), { signal });
export const getAgentSession = (id: string, signal?: AbortSignal) => platformRequest<AgentSnapshot>(base + "/sessions/" + id + "/presentation", { signal });
export const createAgentSession = (projectId: string, mode: AgentMode, operationId: string) => platformRequest<AgentSession>(base + "/sessions", { method: "POST", body: JSON.stringify({ projectId, mode, operationId, title: "创作助手" }) });
export const startAgentRun = (sessionId: string, prompt: string, modelId: string, mode: AgentMode, operationId: string, budgetCents = 0, conversationVersion?: 1, interaction?: "auto") =>
    platformRequest<AgentRun>(`${base}/sessions/${sessionId}/runs`, { method: "POST", body: JSON.stringify({ prompt, modelId, mode, operationId, budgetCents, ...(conversationVersion ? { conversationVersion } : {}), ...(interaction ? { interaction } : {}) }) });
export const cancelAgentRun = (id: string) => platformRequest(`${base}/runs/${id}/cancel`, { method: "POST" });
export const closeAgentSession = (id: string) => platformRequest(`${base}/sessions/${id}/close`, { method: "POST" });
export const decideAgentPlan = (a: AgentApproval, decision: "approve" | "revise" | "cancel", operationId: string, instruction?: string) =>
    platformRequest(`${base}/approvals/${a.id}`, { method: "POST", body: JSON.stringify({ operationId, expectedRevision: a.revision, payloadHash: a.payload_hash, decision, instruction }) });
export async function readAgentEvents(id: string, after: number, signal: AbortSignal): Promise<AgentEvent[]> {
    const response = await fetch(`${base}/runs/${id}/presentation-events?after=${after}`, { credentials: "same-origin", signal });
    if (!response.ok) {
        const p = await response.json().catch(() => null);
        if (response.status === 401) window.dispatchEvent(new Event(PLATFORM_SESSION_EXPIRED_EVENT));
        throw new PlatformApiError(p?.error?.message || "执行事件读取失败，请重连", response.status, p?.error?.code || "AGENT_EVENTS_FAILED", false);
    }
    const text = await response.text();
    return text.split(/\r?\n\r?\n/).flatMap((block) => {
        const value = block.split(/\r?\n/).find((line) => line.startsWith("data:"));
        return value ? [JSON.parse(value.slice(5).trim()) as AgentEvent] : [];
    });
}

// A slow HTTP snapshot must never replace a newer committed run state from event reconciliation.
export function acceptAgentSnapshot(previous: AgentSnapshot | null, next: AgentSnapshot): AgentSnapshot {
    if (previous?.session.id === next.session.id && previous.runs.some((run) => run.revision > (next.runs.find((candidate) => candidate.id === run.id)?.revision ?? 0))) return previous;
    return next;
}

export const reconcileAgentRun = (id: string) => platformRequest<{ runId: string; status: string; message?: string }>(`${base}/runs/${id}/reconcile`, { method: "POST" });

export const resumeAgentRun = (id: string, expectedRevision: number, modelId: string, additionalBudgetCents: number, operationId: string, limitsHash: string) =>
    platformRequest(`${base}/runs/${id}/resume`, { method: "POST", body: JSON.stringify({ operationId, expectedRevision, modelId, additionalBudgetCents, limitsHash }) });

export type CreativeDecision = { id: string; text: string; available: boolean; source?: { runId: string; sessionId: string; evidence: string; runRevision: number } };
export type CreativeDecisions = { enabled: boolean; revision: number; decisions: CreativeDecision[] };
export const getCreativeDecisions = (projectId: string, signal?: AbortSignal) => platformRequest<CreativeDecisions>(`${base}/projects/${projectId}/decisions`, { signal });
export const changeCreativeDecisions = (projectId: string, value: Record<string, unknown>) =>
    platformRequest<{ persisted: boolean; revision: number; enabled: boolean }>(`${base}/projects/${projectId}/decisions`, { method: "POST", body: JSON.stringify(value) });
