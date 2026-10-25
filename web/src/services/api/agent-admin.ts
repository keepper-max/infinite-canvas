import { platformRequest } from "./platform";
export type AgentAdminPolicy = { version: number; enabled: boolean; defaultModelId: string | null; allowedModelIds: string[]; userModelSelectionEnabled: boolean; maxBudgetCents: number; knowledgeReasoningEnabled: boolean; limits: Record<string, number> };
export type AgentAdminSnapshot = {
    settings: AgentAdminPolicy;
    models: {
        id: string;
        display_name: string;
        provider_id: string;
        enabled: boolean;
        healthy: boolean;
        supported: boolean;
        credentialConfigured: boolean;
        verified: boolean;
        reason: string;
        agentEnabled: boolean;
        verification: { id: string; finished_at: string; capabilities: Record<string, unknown> } | null;
        context_limit_tokens: string | null;
        limits: Record<string, unknown>;
    }[];
    usage: { model_id: string; runs: number; failures: number; input_tokens: string; output_tokens: string; supplier_cny: string; charged_points: string }[];
    runs: {
        id: string;
        operation_id: string;
        actor_id: string;
        project_id: string;
        model_id: string;
        status: string;
        purpose: string;
        rounds: number;
        input_tokens: string;
        output_tokens: string;
        spent_cents: number;
        reserved_cents: number;
        error_code: string | null;
        created_at: string;
    }[];
    verifications: { id: string; run_id: string; model_id: string; status: string; metrics: Record<string, unknown>; capabilities: Record<string, unknown>; finished_at: string | null }[];
};
const base = "/api/native-agent/admin";
export const getAgentAdmin = () => platformRequest<AgentAdminSnapshot>(base + "/models");
export const saveAgentAdmin = (policy: AgentAdminPolicy, operationId: string, reason: string) => {
    const { version, ...settings } = policy;
    return platformRequest<AgentAdminPolicy>(base + "/policy", { method: "PATCH", body: JSON.stringify({ ...settings, expectedVersion: version, operationId, reason }) });
};
export const verifyAgentModel = (projectId: string, modelId: string, budgetCents: number, operationId: string) =>
    platformRequest<{ id: string; session_id: string }>(base + "/model-verifications", { method: "POST", body: JSON.stringify({ projectId, modelId, budgetCents, operationId }) });
