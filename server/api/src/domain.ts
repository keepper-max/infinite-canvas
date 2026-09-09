import type { CanvasDocument, CanvasMigrationReport, CanvasSnapshotSummary, CanvasWrite } from "./canvas-contract.js";

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
    public readonly details?: Record<string, unknown>;

    constructor(
        public readonly code: string,
        message: string,
        public readonly status: ApiStatus,
        public readonly retryable = false,
        options?: { cause?: unknown; details?: Record<string, unknown> },
    ) {
        super(message, options);
        this.name = "DomainError";
        this.details = options?.details;
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
    getCanvasForUser(projectId: string, userId: string): Promise<CanvasDocument | null>;
    saveCanvasForUser(projectId: string, userId: string, write: CanvasWrite, source?: "save" | "migration" | "restore", restoredFromVersion?: number): Promise<CanvasDocument>;
    listCanvasSnapshots(projectId: string, userId: string): Promise<CanvasSnapshotSummary[] | null>;
    restoreCanvasSnapshot(projectId: string, userId: string, version: number, expectedRevision: number): Promise<CanvasDocument | null>;
    migrateCanvasForUser(projectId: string, userId: string, migrationKey: string, write: CanvasWrite, report: CanvasMigrationReport): Promise<{ canvas: CanvasDocument; report: CanvasMigrationReport; alreadyMigrated: boolean }>;
    isReady(): Promise<boolean>;
}
