export type PlatformUser = { id: string; email: string };

export type Workspace = {
    projectId: string;
    projectTitle: string;
    projectDescription: string;
    canvasId: string;
    isDefault: boolean;
    updatedAt: string;
};

export type AuthSession = { user: PlatformUser; workspace: Workspace; sessionExpiresAt?: string };
export type ProjectSummary = Workspace & { role: string };

type ApiSuccess<T> = { data: T; meta?: { requestId?: string } };
type ApiFailure = { error?: { code?: string; message?: string; retryable?: boolean; details?: Record<string, unknown> }; meta?: { requestId?: string } };

export class PlatformApiError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly code: string,
        public readonly retryable: boolean,
        public readonly details?: Record<string, unknown>,
    ) {
        super(message);
        this.name = "PlatformApiError";
    }
}

export function register(email: string, password: string) {
    return platformRequest<AuthSession>("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password }) });
}

export function login(email: string, password: string) {
    return platformRequest<AuthSession>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
}

export function getCurrentSession(signal?: AbortSignal) {
    return platformRequest<AuthSession>("/api/auth/me", { signal });
}

export function logout() {
    return platformRequest<{ ok: true }>("/api/auth/logout", { method: "POST" });
}

export async function listProjects(signal?: AbortSignal) {
    return (await platformRequest<{ projects: ProjectSummary[] }>("/api/projects", { signal })).projects;
}

export async function getProject(projectId: string, signal?: AbortSignal) {
    return (await platformRequest<{ project: ProjectSummary }>(`/api/projects/${encodeURIComponent(projectId)}`, { signal })).project;
}

export async function createProject(name: string, description = "") {
    return (await platformRequest<{ project: ProjectSummary }>("/api/projects", { method: "POST", body: JSON.stringify({ name, description }) })).project;
}

export async function updateProject(projectId: string, input: { name?: string; description?: string }) {
    return (await platformRequest<{ project: ProjectSummary }>(`/api/projects/${encodeURIComponent(projectId)}`, { method: "PATCH", body: JSON.stringify(input) })).project;
}

export async function deleteProject(projectId: string) {
    return platformRequest<{ deletedProjectId: string; workspace: Workspace }>(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
}

export async function platformRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
        response = await fetch(path, {
            ...init,
            credentials: "same-origin",
            headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
        });
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new PlatformApiError("账号服务暂时不可用", 0, "NETWORK_ERROR", true);
    }
    const payload = (await response.json().catch(() => null)) as ApiSuccess<T> | ApiFailure | null;
    if (!response.ok) {
        if (response.status === 413) throw new PlatformApiError("请求内容过大，请减少参考素材后重试", 413, "REQUEST_TOO_LARGE", false);
        const failure = payload as ApiFailure | null;
        throw new PlatformApiError(failure?.error?.message || "请求失败", response.status, failure?.error?.code || "REQUEST_FAILED", Boolean(failure?.error?.retryable), failure?.error?.details);
    }
    if (!payload || !("data" in payload)) throw new PlatformApiError("服务返回了无法识别的数据", response.status, "INVALID_RESPONSE", false);
    return payload.data;
}
