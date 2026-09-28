import { platformRequest } from "./platform";

export type AttributionStatus = "active" | "disabled";
export type AttributionKind = "channel" | "campaign" | "batch" | "invite";
export type PageResult<T> = { items: T[]; total: number; page: number; pageSize: number };
export type Channel = {
    id: string;
    systemKey?: string;
    channelType: string;
    channelName: string;
    codePrefix?: string;
    contactName?: string;
    contactPhone?: string;
    remark: string;
    status: AttributionStatus;
    inviteCount: number;
    registeredUsers: number;
    activeUsers: number;
    paidUsers: number;
    rechargeCents: string;
    consumedPoints: string;
    createdAt: string;
    updatedAt: string;
};
export type Campaign = { id: string; channelId?: string; channelName?: string; name: string; description: string; startAt?: string; endAt?: string; status: AttributionStatus; createdAt: string; updatedAt: string };
export type Batch = { id: string; campaignId: string; campaignName?: string; name: string; description: string; startAt?: string; endAt?: string; status: AttributionStatus; createdAt: string; updatedAt: string };
export type InviteCode = {
    id: string;
    code: string;
    channelId: string;
    channelType?: string;
    channelName?: string;
    campaignId?: string;
    campaignName?: string;
    batchId?: string;
    batchName?: string;
    name: string;
    description: string;
    maxUses?: number;
    usedCount: number;
    registeredUsers: number;
    startAt?: string;
    expireAt?: string;
    status: AttributionStatus;
    effectiveStatus: "active" | "disabled" | "expired" | "pending" | "full";
    createdAt: string;
    updatedAt: string;
};
export type AttributionMetrics = {
    registered_users: number;
    today_users: number;
    users_7d: number;
    users_30d: number;
    active_users: number;
    paid_users: number;
    recharge_cents: string;
    current_balance: string;
    consumed_points: string;
    total_tokens: string;
    averageRechargeCents: number;
    averageConsumedPoints: number;
    channels?: number;
    invite_codes?: number;
    invite_users?: number;
    organic_users?: number;
};
export type AttributionDetail = { entity: Record<string, unknown>; metrics: AttributionMetrics; trends: Array<{ day: string; registrations: number; recharge_cents: string; consumed_points: string }>; inviteCodes?: Array<Record<string, unknown>> };
export type AttributedUser = {
    id: string;
    email: string;
    registrationIp?: string;
    createdAt: string;
    lastLoginAt?: string;
    status: string;
    rechargeCents: string;
    creditBalance: string;
    consumedPoints: string;
    imagePoints: string;
    videoPoints: string;
    otherPoints: string;
    totalTokens: string;
};
export type ChannelInput = Pick<Channel, "channelType" | "channelName" | "remark" | "status"> & { codePrefix?: string | null; contactName?: string | null; contactPhone?: string | null };
export type CampaignInput = Pick<Campaign, "name" | "description" | "status"> & { channelId?: string | null; startAt?: string | null; endAt?: string | null };
export type BatchInput = Pick<Batch, "campaignId" | "name" | "description" | "status"> & { startAt?: string | null; endAt?: string | null };
export type InviteInput = Pick<InviteCode, "channelId" | "name" | "description" | "status"> & { code?: string; campaignId?: string | null; batchId?: string | null; maxUses?: number | null; startAt?: string | null; expireAt?: string | null };

function query(input: Record<string, unknown> = {}) {
    const params = new URLSearchParams();
    Object.entries(input).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    });
    const text = params.toString();
    return text ? `?${text}` : "";
}
export const getAttributionSettings = () => platformRequest<{ inviteMode: "required" | "optional" | "disabled" }>("/api/admin/attribution/settings");
export const setAttributionSettings = (mode: "required" | "optional" | "disabled") => platformRequest<{ inviteMode: string }>("/api/admin/attribution/settings", { method: "PATCH", body: JSON.stringify({ mode }) });
export const getAttributionDashboard = (input: Record<string, unknown> = {}) =>
    platformRequest<{
        metrics: AttributionMetrics;
        rankings: Array<Record<string, unknown>>;
        registrationRankings: Array<Record<string, unknown>>;
        rechargeRankings: Array<Record<string, unknown>>;
        consumptionRankings: Array<Record<string, unknown>>;
    }>(`/api/admin/attribution/dashboard${query(input)}`);
export const getChannels = (input: Record<string, unknown> = {}) => platformRequest<PageResult<Channel>>(`/api/admin/channels${query(input)}`);
export const createChannel = (input: ChannelInput) => platformRequest<Channel>("/api/admin/channels", { method: "POST", body: JSON.stringify(input) });
export const updateChannel = (id: string, input: ChannelInput) => platformRequest<Channel>(`/api/admin/channels/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const getCampaigns = (input: Record<string, unknown> = {}) => platformRequest<PageResult<Campaign>>(`/api/admin/campaigns${query(input)}`);
export const createCampaign = (input: CampaignInput) => platformRequest<Campaign>("/api/admin/campaigns", { method: "POST", body: JSON.stringify(input) });
export const updateCampaign = (id: string, input: CampaignInput) => platformRequest<Campaign>(`/api/admin/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const getBatches = (input: Record<string, unknown> = {}) => platformRequest<PageResult<Batch>>(`/api/admin/batches${query(input)}`);
export const createBatch = (input: BatchInput) => platformRequest<Batch>("/api/admin/batches", { method: "POST", body: JSON.stringify(input) });
export const updateBatch = (id: string, input: BatchInput) => platformRequest<Batch>(`/api/admin/batches/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const getInvites = (input: Record<string, unknown> = {}) => platformRequest<PageResult<InviteCode>>(`/api/admin/invite-codes${query(input)}`);
export const createInvite = (input: InviteInput) => platformRequest<InviteCode>("/api/admin/invite-codes", { method: "POST", body: JSON.stringify(input) });
export const createInviteBatch = (input: Omit<InviteInput, "name" | "code"> & { count: 1 | 5 | 10 | 20 | 50 | 100; namePrefix: string }) =>
    platformRequest<{ items: InviteCode[] }>("/api/admin/invite-codes/batch", { method: "POST", body: JSON.stringify(input) });
export const updateInvite = (id: string, input: InviteInput) => platformRequest<InviteCode>(`/api/admin/invite-codes/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const setAttributionStatus = (kind: AttributionKind, id: string, status: AttributionStatus) => platformRequest(`/api/admin/attribution/${kind}/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
export const deleteAttribution = (kind: AttributionKind, id: string) => platformRequest(`/api/admin/attribution/${kind}/${id}`, { method: "DELETE" });
export const getAttributionDetail = (kind: AttributionKind, id: string, input: Record<string, unknown> = {}) => platformRequest<AttributionDetail>(`/api/admin/attribution/${kind}/${id}${query(input)}`);
export const getAttributionUsers = (kind: AttributionKind, id: string, input: Record<string, unknown> = {}) => platformRequest<PageResult<AttributedUser>>(`/api/admin/attribution/${kind}/${id}/users${query(input)}`);
export function exportAttributionUsers(kind: AttributionKind, id: string, input: Record<string, unknown> = {}) {
    window.location.assign(`/api/admin/attribution/${kind}/${id}/users.csv${query(input)}`);
}
export const updateUserAttribution = (userId: string, input: { inviteCodeId?: string | null; channelId: string; campaignId?: string | null; batchId?: string | null; reason: string }) =>
    platformRequest(`/api/admin/users/${userId}/attribution`, { method: "PATCH", body: JSON.stringify(input) });
