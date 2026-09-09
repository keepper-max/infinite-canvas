export type PlatformUser = { id: string; email: string };

export type Workspace = {
    projectId: string;
    projectTitle: string;
    projectDescription: string;
    canvasId: string;
    isDefault: boolean;
    updatedAt: string;
};

export type ProjectSummary = Workspace & { role: string };

export type ApiStatus = 400 | 401 | 403 | 404 | 409 | 415 | 422 | 500 | 503;

export class DomainError extends Error {
    constructor(
        public readonly code: string,
        message: string,
        public readonly status: ApiStatus,
        public readonly retryable = false,
        options?: { cause?: unknown },
    ) {
        super(message, options);
        this.name = "DomainError";
    }
}

export interface PlatformRepository {
    createUserWithWorkspace(email: string, passwordHash: string): Promise<{ user: PlatformUser; workspace: Workspace }>;
    findUserByEmail(email: string): Promise<(PlatformUser & { passwordHash: string }) | null>;
    createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
    findUserBySession(tokenHash: string, now: Date): Promise<PlatformUser | null>;
    deleteSession(tokenHash: string): Promise<void>;
    ensureDefaultWorkspace(userId: string): Promise<Workspace>;
    listProjects(userId: string): Promise<ProjectSummary[]>;
    getProjectForUser(projectId: string, userId: string): Promise<ProjectSummary | null>;
    isReady(): Promise<boolean>;
}
