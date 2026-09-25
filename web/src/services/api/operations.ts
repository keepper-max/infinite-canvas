import { PlatformApiError, platformRequest } from "./platform";

export type OperationsCapabilities = { sms: boolean; credits: boolean; payments: boolean; teams: boolean; admin: boolean };
export type CreditPricing = { pointsPerCny: 100; markup: "1.2"; rounding: "ceil"; usdCnyRate?: string };
export type CreditLedgerItem = {
    id: string;
    type: string;
    delta: string;
    balanceAfter: string;
    referenceType?: string;
    referenceId?: string;
    metadata: Record<string, unknown>;
    createdAt: string;
};
export type CreditLot = {
    id: string;
    source: string;
    credits: string;
    remaining: string;
    expiresAt?: string;
    metadata: Record<string, unknown>;
    createdAt: string;
};
export type CreditAccount = {
    account: { id: string; balance: string; reserved: string };
    ledger: CreditLedgerItem[];
    lots: CreditLot[];
    pendingCharges: number;
    pricing: CreditPricing;
    enabled: boolean;
};
export type BillingPlan = { id: string; name: string; credits: number; priceCents: number; currency: "CNY"; enabled: boolean; metadata: Record<string, unknown>; createdAt?: string; updatedAt?: string };
export type PaymentPlanInput = Pick<BillingPlan, "name" | "credits" | "priceCents" | "enabled">;
export type AdminPaymentSettings = {
    publicRechargeEnabled: boolean;
    totalUserCredits: string;
    providerReserveCny: string;
    pointsPerProviderCny: 120;
};
export type ProviderBillingRule = {
    id: string;
    ruleKey: string;
    version: number;
    provider: "runninghub" | "runninghub_global";
    modelPattern: string;
    matchType: "exact" | "contains";
    discountRate: string;
    priority: number;
    enabled: boolean;
    note: string;
    createdAt: string;
};
export type ProviderBillingRuleInput = Pick<ProviderBillingRule, "provider" | "modelPattern" | "matchType" | "discountRate" | "priority" | "enabled" | "note">;
export type PaymentOrder = {
    id: string;
    userId: string;
    userEmail?: string;
    planId?: string;
    amountCents: number;
    credits: string;
    currency: "CNY";
    provider: "alipay";
    status: "pending" | "paid" | "closed";
    failureCode?: string;
    failureMessage?: string;
    paidAt?: string;
    expiresAt?: string;
    closedAt?: string;
    lastSyncedAt?: string;
    createdAt: string;
    updatedAt: string;
};
export type ActivationCodeRecord = { id: string; codeHint: string; credits: string; expiresAt: string; createdAt: string; redeemedAt?: string; revokedAt?: string };
export type Team = { id: string; name: string; ownerId: string; role: string; createdAt: string; updatedAt: string };
export type TeamMember = { userId: string; email: string; role: "owner" | "admin" | "editor" | "viewer"; createdAt: string };
export type UsageSummary = { currency: string; calls: number; totalTokens: string; generatedImages: string; videoDurationSeconds: string; audioDurationSeconds: string; totalAmount: string };
export type AdminOverview = {
    users: number;
    range: { from: string; to: string };
    userActivity: { new24h: number; new7d: number; new30d: number; active24h: number; active7d: number; active30d: number; newInRange: number; activeInRange: number; activeSessionUsers: number };
    projects: number;
    assets: number;
    assetBytes: number;
    activeJobs: number;
    failedJobs: number;
    activeCompositions: number;
    failedCompositions: number;
    totalJobs: number;
    successRate: number;
    jobActivity: { jobs24h: number; jobs7d: number; jobs30d: number; failed24h: number; successRate30d: number; avgCompletionSeconds30d: number; jobsInRange: number; failedInRange: number; successRateInRange: number; avgCompletionSecondsInRange: number };
    creditActivity: { consumed24h: string; consumed7d: string; consumed30d: string; consumedInRange: string };
    alerts: { pendingBillingJobs: number; pendingCreditCharges: number };
    usage: UsageSummary[];
    usage30d: UsageSummary[];
    usageRange: UsageSummary[];
    trends: Array<{ day: string; newUsers: number; activeUsers: number; jobs: number; completedJobs: number; creditPoints: string }>;
};
export type AdminFailure = { id: string; kind: string; status: string; error: { code?: string; message: string; retryable: boolean }; updatedAt: string };
export type AdminModel = { id: string; displayName: string; capability: string; providerId: string; enabled: boolean; configurable: boolean; healthy: boolean; discovered: boolean; checkedAt?: string };
export type AdminProvider = { id: "token360" | "runninghub" | "runninghub_global"; displayName: string; enabled: boolean; configured: boolean; updatedAt?: string };
export type AdminProviders = { activeProviderId: AdminProvider["id"]; providers: AdminProvider[] };
export type AdminUser = {
    id: string;
    email: string;
    isAdmin: boolean;
    status: "active" | "disabled";
    disabledReason?: string;
    disabledAt?: string;
    createdAt: string;
    lastLoginAt?: string;
    projectCount: number;
    jobCount: number;
    storageBytes: number;
    activeSessions: number;
    usageAmounts: Record<string, string>;
    creditBalance: string;
};
export type AdminUsage = {
    jobId: string;
    projectId: string;
    projectName: string;
    userId: string;
    userEmail: string;
    billingRequestId: string;
    provider: string;
    modelId: string;
    capability: string;
    status?: string;
    billed?: boolean;
    totalTokens?: string;
    generatedImages?: number;
    videoDurationSeconds?: string;
    audioDurationSeconds?: string;
    totalAmount?: string;
    providerPaidAmount?: string;
    walletAmount?: string;
    voucherAmount?: string;
    currency?: string;
    providerRequestId?: string;
    creditStatus?: string;
    creditPoints?: string;
    costCny?: string;
    exchangeRate?: string;
    reconciledAt: string;
};
export type AdminJob = {
    id: string;
    projectId: string;
    projectName: string;
    userId: string;
    userEmail: string;
    modelId: string;
    capability: string;
    mode: string;
    status: string;
    progress: number;
    retryable: boolean;
    error?: { code: string; message: string; details?: string };
    providerJobId?: string;
    retryOfJobId?: string;
    billingTraceId?: string;
    billingStatus: string;
    billingError?: string;
    createdAt: string;
    updatedAt: string;
    finishedAt?: string;
};
export type AdminAuditLog = { id: number; action: string; targetType?: string; targetId?: string; requestId?: string; metadata: Record<string, unknown>; actorEmail?: string; createdAt: string };
export type PageResult<T> = { items: T[]; total: number; page: number; pageSize: number };
export type UsageBreakdown = Record<"model" | "project" | "capability" | "day", Array<{ key: string; currency: string; calls: number; totalTokens: string; totalAmount: string }>>;
export type AdminUserDetail = {
    user: AdminUser;
    projects: Array<{ id: string; name: string; description: string; jobCount: number; assetCount: number; createdAt: string; updatedAt: string }>;
    usage: UsageSummary[];
    usageBreakdowns: UsageBreakdown;
    credits: CreditAccount | null;
};

export function getOperationsCapabilities(signal?: AbortSignal) {
    return platformRequest<OperationsCapabilities>("/api/operations/capabilities", { signal });
}
export function getCreditAccount(signal?: AbortSignal) {
    return platformRequest<CreditAccount>("/api/billing/account", { signal });
}
export function redeemActivationCode(code: string) {
    return platformRequest<{ credits: string; balance: string }>("/api/billing/activation-codes/redeem", { method: "POST", body: JSON.stringify({ code }) });
}
export async function getBillingPlans(signal?: AbortSignal) {
    return (await platformRequest<{ plans: BillingPlan[] }>("/api/billing/plans", { signal })).plans;
}
export async function getPaymentOrders(signal?: AbortSignal) {
    return (await platformRequest<{ orders: PaymentOrder[] }>("/api/payments/orders", { signal })).orders;
}
export function createPaymentOrder(planId: string, idempotencyKey: string) {
    return platformRequest<{ order: PaymentOrder; paymentUrl?: string }>("/api/payments/orders", {
        method: "POST",
        body: JSON.stringify({ planId, idempotencyKey }),
    });
}
export async function syncPaymentOrder(orderId: string) {
    return (await platformRequest<{ order: PaymentOrder }>(`/api/payments/orders/${encodeURIComponent(orderId)}/sync`, { method: "POST" })).order;
}
export async function getAdminPaymentOrders(signal?: AbortSignal) {
    return (await platformRequest<{ orders: PaymentOrder[] }>("/api/admin/payments/orders", { signal })).orders;
}
export async function syncAdminPaymentOrder(orderId: string) {
    return (await platformRequest<{ order: PaymentOrder }>(`/api/admin/payments/orders/${encodeURIComponent(orderId)}/sync`, { method: "POST" })).order;
}
export async function getAdminPaymentPlans(signal?: AbortSignal) {
    return (await platformRequest<{ plans: BillingPlan[] }>("/api/admin/payments/plans", { signal })).plans;
}
export async function getAdminPaymentSettings(signal?: AbortSignal) {
    return (await platformRequest<{ settings: AdminPaymentSettings }>("/api/admin/payments/settings", { signal })).settings;
}
export async function setAdminPaymentSettings(publicRechargeEnabled: boolean) {
    return (await platformRequest<{ settings: AdminPaymentSettings }>("/api/admin/payments/settings", {
        method: "PATCH",
        body: JSON.stringify({ publicRechargeEnabled }),
    })).settings;
}
export async function createAdminPaymentPlan(input: PaymentPlanInput) {
    return (await platformRequest<{ plan: BillingPlan }>("/api/admin/payments/plans", { method: "POST", body: JSON.stringify(input) })).plan;
}
export async function updateAdminPaymentPlan(planId: string, input: PaymentPlanInput) {
    return (await platformRequest<{ plan: BillingPlan }>(`/api/admin/payments/plans/${encodeURIComponent(planId)}`, { method: "PUT", body: JSON.stringify(input) })).plan;
}
export async function getAdminBillingRules(signal?: AbortSignal) {
    return (await platformRequest<{ rules: ProviderBillingRule[] }>("/api/admin/billing-rules", { signal })).rules;
}
export async function createAdminBillingRule(input: ProviderBillingRuleInput) {
    return (await platformRequest<{ rule: ProviderBillingRule }>("/api/admin/billing-rules", { method: "POST", body: JSON.stringify(input) })).rule;
}
export async function updateAdminBillingRule(ruleKey: string, input: ProviderBillingRuleInput) {
    return (await platformRequest<{ rule: ProviderBillingRule }>(`/api/admin/billing-rules/${encodeURIComponent(ruleKey)}`, { method: "PUT", body: JSON.stringify(input) })).rule;
}
export async function getAdminActivationCodes(signal?: AbortSignal) {
    return (await platformRequest<{ codes: ActivationCodeRecord[] }>("/api/admin/credits/activation-codes", { signal })).codes;
}
export function issueAdminActivationCode(credits: number, expiresAt: string) {
    return platformRequest<ActivationCodeRecord & { code: string }>("/api/admin/credits/activation-codes", { method: "POST", body: JSON.stringify({ credits, expiresAt }) });
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
export function getAdminOverview(input: { dateFrom?: string; dateTo?: string } = {}, signal?: AbortSignal) {
    return platformRequest<AdminOverview>(`/api/admin/overview${adminQuery(input)}`, { signal });
}
export async function getAdminFailures(signal?: AbortSignal) {
    return (await platformRequest<{ failures: AdminFailure[] }>("/api/admin/failures", { signal })).failures;
}
export async function getAdminModels(provider?: AdminProvider["id"], signal?: AbortSignal) {
    return (await platformRequest<{ models: AdminModel[] }>(`/api/admin/models${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`, { signal })).models;
}
export function setAdminModelEnabled(modelId: string, enabled: boolean) {
    return platformRequest<{ id: string; enabled: boolean }>(`/api/admin/models/${encodeURIComponent(modelId)}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
}
export function getAdminProviders(signal?: AbortSignal) {
    return platformRequest<AdminProviders>("/api/admin/providers", { signal });
}
export function setActiveAdminProvider(providerId: AdminProvider["id"]) {
    return platformRequest<AdminProviders>("/api/admin/providers/active", { method: "PATCH", body: JSON.stringify({ providerId }) });
}
export function getAdminCreditPricing(signal?: AbortSignal) {
    return platformRequest<CreditPricing>("/api/admin/credits/pricing", { signal });
}
export function setAdminCreditPricing(usdCnyRate: string) {
    return platformRequest<CreditPricing>("/api/admin/credits/pricing", { method: "PATCH", body: JSON.stringify({ usdCnyRate }) });
}
function adminQuery(input: Record<string, string | number | boolean | undefined>) {
    const params = new URLSearchParams();
    Object.entries(input).forEach(([key, value]) => {
        if (value !== undefined && value !== "") params.set(key, String(value));
    });
    const value = params.toString();
    return value ? `?${value}` : "";
}
export function getAdminUsers(input: Record<string, string | number | boolean | undefined> = {}, signal?: AbortSignal) {
    return platformRequest<PageResult<AdminUser>>(`/api/admin/users${adminQuery(input)}`, { signal });
}
export function getAdminUser(userId: string, signal?: AbortSignal) {
    return platformRequest<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(userId)}`, { signal });
}
export function setAdminUserStatus(userId: string, status: "active" | "disabled", reason?: string) {
    return platformRequest<AdminUser>(`/api/admin/users/${encodeURIComponent(userId)}/status`, { method: "PATCH", body: JSON.stringify({ status, ...(reason ? { reason } : {}) }) });
}
export function revokeAdminUserSessions(userId: string) {
    return platformRequest<{ revoked: number }>(`/api/admin/users/${encodeURIComponent(userId)}/revoke-sessions`, { method: "POST" });
}
export function setAdminUserRole(userId: string, isAdmin: boolean) {
    return platformRequest<AdminUser>(`/api/admin/users/${encodeURIComponent(userId)}/admin`, { method: "PATCH", body: JSON.stringify({ isAdmin }) });
}
export function grantAdminUserCredits(userId: string, input: { credits: number; source: "purchase" | "promotion" | "compensation"; note: string; expiresAt?: string; idempotencyKey: string }) {
    return platformRequest<{ account: CreditAccount["account"]; ledger: CreditLedgerItem; lot: CreditLot }>(`/api/admin/users/${encodeURIComponent(userId)}/credits`, {
        method: "POST",
        body: JSON.stringify(input),
    });
}
export function getAdminUsage(input: Record<string, string | number | boolean | undefined> = {}, signal?: AbortSignal) {
    return platformRequest<PageResult<AdminUsage> & { summary: UsageSummary[]; breakdowns: UsageBreakdown }>(`/api/admin/usage${adminQuery(input)}`, { signal });
}
export function getAdminJobs(input: Record<string, string | number | boolean | undefined> = {}, signal?: AbortSignal) {
    return platformRequest<PageResult<AdminJob>>(`/api/admin/jobs${adminQuery(input)}`, { signal });
}
export function reconcileAdminJob(jobId: string) {
    return platformRequest<{ status: string; requestId?: string }>(`/api/admin/jobs/${encodeURIComponent(jobId)}/reconcile`, { method: "POST" });
}
export function getAdminAuditLogs(input: Record<string, string | number | boolean | undefined> = {}, signal?: AbortSignal) {
    return platformRequest<PageResult<AdminAuditLog>>(`/api/admin/audit-logs${adminQuery(input)}`, { signal });
}
export function getAdminProjectContent(projectId: string, signal?: AbortSignal) {
    return platformRequest<Record<string, unknown>>(`/api/admin/projects/${encodeURIComponent(projectId)}/content`, { signal });
}
export function getAdminAssetDownload(versionId: string) {
    return platformRequest<{ url: string }>(`/api/admin/asset-versions/${encodeURIComponent(versionId)}/download`);
}
export function isAdminForbidden(error: unknown) {
    return error instanceof PlatformApiError && error.code === "ADMIN_FORBIDDEN";
}
