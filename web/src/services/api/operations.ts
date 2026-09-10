import { PlatformApiError, platformRequest } from "./platform";

export type OperationsCapabilities = { sms: boolean; credits: boolean; payments: boolean; teams: boolean; admin: boolean };
export type CreditAccount = { account: { id: string; balance: number; reserved: number }; ledger: Array<{ id: number; type: string; delta: number; balanceAfter: number; createdAt: string }>; enabled: boolean };
export type Team = { id: string; name: string; ownerId: string; role: string; createdAt: string; updatedAt: string };
export type TeamMember = { userId: string; email: string; role: "owner" | "admin" | "editor" | "viewer"; createdAt: string };
export type AdminOverview = { users: number; projects: number; assets: number; assetBytes: number; activeJobs: number; failedJobs: number; activeCompositions: number; failedCompositions: number };
export type AdminFailure = { id: string; kind: string; status: string; error: { code?: string; message: string; retryable: boolean }; updatedAt: string };
export type AdminModel = { id: string; displayName: string; capability: string; enabled: boolean; healthy: boolean; discovered: boolean; checkedAt?: string };

export function getOperationsCapabilities(signal?: AbortSignal) {
    return platformRequest<OperationsCapabilities>("/api/operations/capabilities", { signal });
}
export function getCreditAccount(signal?: AbortSignal) {
    return platformRequest<CreditAccount>("/api/billing/account", { signal });
}
export async function listTeams(signal?: AbortSignal) {
    return (await platformRequest<{ teams: Team[] }>("/api/teams", { signal })).teams;
}
export async function createTeam(name: string) {
    return (await platformRequest<{ team: Team }>("/api/teams", { method: "POST", body: JSON.stringify({ name }) })).team;
}
export async function listTeamMembers(teamId: string) {
    return (await platformRequest<{ members: TeamMember[] }>(`/api/teams/${encodeURIComponent(teamId)}/members`)).members;
}
export async function addTeamMember(teamId: string, email: string, role: "admin" | "editor" | "viewer") {
    return (await platformRequest<{ member: TeamMember }>(`/api/teams/${encodeURIComponent(teamId)}/members`, { method: "POST", body: JSON.stringify({ email, role }) })).member;
}
export function attachTeamProject(teamId: string, projectId: string) {
    return platformRequest<{ teamProject: { teamId: string; projectId: string } }>(`/api/teams/${encodeURIComponent(teamId)}/projects`, { method: "POST", body: JSON.stringify({ projectId }) });
}
export function getAdminOverview(signal?: AbortSignal) {
    return platformRequest<AdminOverview>("/api/admin/overview", { signal });
}
export async function getAdminFailures(signal?: AbortSignal) {
    return (await platformRequest<{ failures: AdminFailure[] }>("/api/admin/failures", { signal })).failures;
}
export async function getAdminModels(signal?: AbortSignal) {
    return (await platformRequest<{ models: AdminModel[] }>("/api/admin/models", { signal })).models;
}
export function isAdminForbidden(error: unknown) {
    return error instanceof PlatformApiError && error.code === "ADMIN_FORBIDDEN";
}
