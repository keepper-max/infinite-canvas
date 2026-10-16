import { platformRequest } from "./platform";

export type WebsiteInquiry = {
    id: string; content: string; contact: string; status: "open" | "closed";
    note: string; createdAt: string; updatedAt: string;
};
export function getWebsiteInquiries(page: number, signal?: AbortSignal) {
    return platformRequest<{ items: WebsiteInquiry[]; total: number }>(`/api/admin/website-inquiries?page=${page}&pageSize=20`, { signal });
}
export function updateWebsiteInquiry(id: string, input: Pick<WebsiteInquiry, "status" | "note">) {
    return platformRequest<{ id: string }>(`/api/admin/website-inquiries/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
}
