import { and, asc, desc, eq, gt } from "drizzle-orm";
import type { NodePgDatabase, NodePgTransaction } from "drizzle-orm/node-postgres";
import type { ExtractTablesWithRelations } from "drizzle-orm";

import { parseCanvasWrite, type CanvasDocument, type CanvasEdge, type CanvasMigrationReport, type CanvasNode, type CanvasSettings, type CanvasSnapshotSummary, type CanvasViewport, type CanvasWrite } from "./canvas-contract.js";
import { DomainError, type PlatformRepository, type ProjectSummary, type Workspace } from "./domain.js";
import * as tables from "./db/schema.js";

type Database = NodePgDatabase<typeof tables>;
type Transaction = NodePgTransaction<typeof tables, ExtractTablesWithRelations<typeof tables>>;
type Executor = Database | Transaction;

export class PostgresPlatformRepository implements PlatformRepository {
    constructor(private readonly db: Database) {}

    async createUserWithWorkspace(email: string, passwordHash: string) {
        try {
            return await this.db.transaction(async (tx) => {
                const [user] = await tx.insert(tables.users).values({ email, passwordHash }).returning({ id: tables.users.id, email: tables.users.email });
                const workspace = await createDefaultWorkspace(tx, user.id);
                return { user, workspace };
            });
        } catch (error) {
            if (isUniqueViolation(error)) throw new DomainError("EMAIL_ALREADY_REGISTERED", "邮箱已注册", 409, false, { cause: error });
            throw error;
        }
    }

    async findUserByEmail(email: string) {
        const [user] = await this.db.select({ id: tables.users.id, email: tables.users.email, passwordHash: tables.users.passwordHash }).from(tables.users).where(eq(tables.users.email, email)).limit(1);
        return user || null;
    }

    async createSession(userId: string, tokenHash: string, expiresAt: Date) {
        await this.db.insert(tables.sessions).values({ userId, tokenHash, expiresAt });
    }

    async findUserBySession(tokenHash: string, now: Date) {
        const [user] = await this.db
            .select({ id: tables.users.id, email: tables.users.email })
            .from(tables.sessions)
            .innerJoin(tables.users, eq(tables.sessions.userId, tables.users.id))
            .where(and(eq(tables.sessions.tokenHash, tokenHash), gt(tables.sessions.expiresAt, now)))
            .limit(1);
        return user || null;
    }

    async deleteSession(tokenHash: string) {
        await this.db.delete(tables.sessions).where(eq(tables.sessions.tokenHash, tokenHash));
    }

    async ensureDefaultWorkspace(userId: string) {
        return this.db.transaction(async (tx) => {
            const [recent] = await tx
                .select({ id: tables.projects.id })
                .from(tables.projects)
                .innerJoin(tables.projectMembers, eq(tables.projectMembers.projectId, tables.projects.id))
                .where(eq(tables.projectMembers.userId, userId))
                .orderBy(desc(tables.projects.lastOpenedAt), desc(tables.projects.updatedAt))
                .limit(1);
            if (recent) return ensureCanvasForProject(tx, recent.id, userId);
            return createDefaultWorkspace(tx, userId);
        });
    }

    async listProjects(userId: string) {
        const rows = await this.db
            .select({
                projectId: tables.projects.id,
                projectTitle: tables.projects.name,
                projectDescription: tables.projects.description,
                canvasId: tables.canvases.id,
                isDefault: tables.projects.isDefault,
                updatedAt: tables.projects.updatedAt,
                role: tables.projectMembers.role,
            })
            .from(tables.projects)
            .innerJoin(tables.projectMembers, eq(tables.projectMembers.projectId, tables.projects.id))
            .innerJoin(tables.canvases, eq(tables.canvases.projectId, tables.projects.id))
            .where(eq(tables.projectMembers.userId, userId))
            .orderBy(desc(tables.projects.lastOpenedAt), desc(tables.projects.updatedAt));
        return rows.map(serializeProject);
    }

    async getProjectForUser(projectId: string, userId: string) {
        const [row] = await this.db
            .select({
                projectId: tables.projects.id,
                projectTitle: tables.projects.name,
                projectDescription: tables.projects.description,
                canvasId: tables.canvases.id,
                isDefault: tables.projects.isDefault,
                updatedAt: tables.projects.updatedAt,
                role: tables.projectMembers.role,
            })
            .from(tables.projects)
            .innerJoin(tables.projectMembers, eq(tables.projectMembers.projectId, tables.projects.id))
            .innerJoin(tables.canvases, eq(tables.canvases.projectId, tables.projects.id))
            .where(and(eq(tables.projects.id, projectId), eq(tables.projectMembers.userId, userId)))
            .limit(1);
        if (!row) return null;
        await this.db.update(tables.projects).set({ lastOpenedAt: new Date() }).where(eq(tables.projects.id, projectId));
        return serializeProject(row);
    }

    async getCanvasForUser(projectId: string, userId: string) {
        return readCanvas(this.db, projectId, userId);
    }

    async saveCanvasForUser(projectId: string, userId: string, write: CanvasWrite, source: "save" | "migration" | "restore" = "save", restoredFromVersion?: number) {
        return this.db.transaction((tx) => saveCanvasInTransaction(tx, projectId, userId, write, source, restoredFromVersion));
    }

    async listCanvasSnapshots(projectId: string, userId: string): Promise<CanvasSnapshotSummary[] | null> {
        if (!(await hasProjectAccess(this.db, projectId, userId))) return null;
        const rows = await this.db
            .select({ version: tables.canvasSnapshots.version, source: tables.canvasSnapshots.source, restoredFromVersion: tables.canvasSnapshots.restoredFromVersion, createdAt: tables.canvasSnapshots.createdAt })
            .from(tables.canvasSnapshots)
            .where(eq(tables.canvasSnapshots.projectId, projectId))
            .orderBy(desc(tables.canvasSnapshots.version))
            .limit(100);
        return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
    }

    async restoreCanvasSnapshot(projectId: string, userId: string, version: number, expectedRevision: number) {
        return this.db.transaction(async (tx) => {
            if (!(await hasProjectAccess(tx, projectId, userId))) return null;
            const [snapshot] = await tx
                .select({ contractVersion: tables.canvasSnapshots.contractVersion, nodes: tables.canvasSnapshots.nodes, edges: tables.canvasSnapshots.edges, viewport: tables.canvasSnapshots.viewport, settings: tables.canvasSnapshots.settings })
                .from(tables.canvasSnapshots)
                .where(and(eq(tables.canvasSnapshots.projectId, projectId), eq(tables.canvasSnapshots.version, version)))
                .limit(1);
            if (!snapshot) throw new DomainError("CANVAS_SNAPSHOT_NOT_FOUND", "找不到该画布历史版本", 404);
            const { write } = parseCanvasWrite({ expectedRevision, contractVersion: snapshot.contractVersion, nodes: snapshot.nodes, edges: snapshot.edges, viewport: snapshot.viewport, settings: snapshot.settings });
            return saveCanvasInTransaction(tx, projectId, userId, write, "restore", version);
        });
    }

    async migrateCanvasForUser(projectId: string, userId: string, migrationKey: string, write: CanvasWrite, report: CanvasMigrationReport) {
        return this.db.transaction(async (tx) => {
            if (!(await hasProjectAccess(tx, projectId, userId))) throw new DomainError("PROJECT_FORBIDDEN", "无权访问该项目", 403);
            const [existing] = await tx
                .select({ report: tables.canvasMigrations.report })
                .from(tables.canvasMigrations)
                .where(and(eq(tables.canvasMigrations.projectId, projectId), eq(tables.canvasMigrations.userId, userId), eq(tables.canvasMigrations.migrationKey, migrationKey)))
                .limit(1);
            if (existing) {
                const canvas = await readCanvas(tx, projectId, userId);
                if (!canvas) throw new DomainError("PROJECT_FORBIDDEN", "无权访问该项目", 403);
                return { canvas, report: existing.report as CanvasMigrationReport, alreadyMigrated: true };
            }
            const canvas = await saveCanvasInTransaction(tx, projectId, userId, write, "migration");
            await tx.insert(tables.canvasMigrations).values({ projectId, userId, migrationKey, fromRevision: write.expectedRevision, toRevision: canvas.revision, report });
            return { canvas, report, alreadyMigrated: false };
        });
    }

    async isReady() {
        await this.db.select({ id: tables.users.id }).from(tables.users).limit(1);
        return true;
    }
}

async function hasProjectAccess(db: Executor, projectId: string, userId: string) {
    const [member] = await db
        .select({ projectId: tables.projectMembers.projectId })
        .from(tables.projectMembers)
        .where(and(eq(tables.projectMembers.projectId, projectId), eq(tables.projectMembers.userId, userId)))
        .limit(1);
    return Boolean(member);
}

async function readCanvas(db: Executor, projectId: string, userId: string): Promise<CanvasDocument | null> {
    const [canvas] = await db
        .select({ canvasId: tables.canvases.id, revision: tables.canvases.revision, contractVersion: tables.canvases.contractVersion, viewport: tables.canvases.viewport, settings: tables.canvases.settings, updatedAt: tables.canvases.updatedAt })
        .from(tables.canvases)
        .innerJoin(tables.projectMembers, eq(tables.projectMembers.projectId, tables.canvases.projectId))
        .where(and(eq(tables.canvases.projectId, projectId), eq(tables.projectMembers.userId, userId)))
        .limit(1);
    if (!canvas) return null;
    const [nodeRows, edgeRows] = await Promise.all([
        db.select().from(tables.canvasNodes).where(eq(tables.canvasNodes.projectId, projectId)).orderBy(asc(tables.canvasNodes.sortOrder)),
        db.select().from(tables.canvasEdges).where(eq(tables.canvasEdges.projectId, projectId)).orderBy(asc(tables.canvasEdges.sortOrder)),
    ]);
    const nodes = nodeRows.map(deserializeNode);
    const edges = edgeRows.map(deserializeEdge);
    return {
        projectId,
        canvasId: canvas.canvasId,
        revision: canvas.revision,
        contractVersion: canvas.contractVersion,
        nodes,
        edges,
        viewport: canvas.viewport as CanvasViewport,
        settings: canvas.settings as CanvasSettings,
        updatedAt: canvas.updatedAt.toISOString(),
    };
}

async function saveCanvasInTransaction(db: Transaction, projectId: string, userId: string, write: CanvasWrite, source: "save" | "migration" | "restore", restoredFromVersion?: number): Promise<CanvasDocument> {
    if (!(await hasProjectAccess(db, projectId, userId))) throw new DomainError("PROJECT_FORBIDDEN", "无权访问该项目", 403);
    const now = new Date();
    const [canvas] = await db
        .update(tables.canvases)
        .set({ revision: write.expectedRevision + 1, contractVersion: write.contractVersion, viewport: write.viewport, settings: write.settings, updatedAt: now })
        .where(and(eq(tables.canvases.projectId, projectId), eq(tables.canvases.revision, write.expectedRevision)))
        .returning({ canvasId: tables.canvases.id, revision: tables.canvases.revision });
    if (!canvas) {
        const [current] = await db.select({ revision: tables.canvases.revision }).from(tables.canvases).where(eq(tables.canvases.projectId, projectId)).limit(1);
        throw new DomainError("CANVAS_REVISION_CONFLICT", "云端画布已被其他页面更新，请选择保留本地或载入云端版本", 409, false, { details: { currentRevision: current?.revision ?? 0 } });
    }
    await db.delete(tables.canvasEdges).where(eq(tables.canvasEdges.projectId, projectId));
    await db.delete(tables.canvasNodes).where(eq(tables.canvasNodes.projectId, projectId));
    if (write.nodes.length) {
        await db.insert(tables.canvasNodes).values(
            write.nodes.map((node, index) => ({
                id: node.id,
                projectId,
                definitionId: node.definitionId,
                definitionVersion: node.definitionVersion,
                nodeType: node.type,
                workflowKind: node.workflowKind,
                label: node.title,
                position: node.position,
                width: node.width,
                height: node.height,
                locked: node.locked,
                groupId: typeof node.metadata?.groupId === "string" ? node.metadata.groupId : null,
                sortOrder: index,
                data: node,
                status: typeof node.metadata?.status === "string" ? node.metadata.status : "idle",
                updatedAt: now,
            })),
        );
    }
    if (write.edges.length) {
        await db.insert(tables.canvasEdges).values(
            write.edges.map((edge) => ({
                id: edge.id,
                projectId,
                sourceNodeId: edge.fromNodeId,
                sourcePortId: edge.sourcePortId,
                targetNodeId: edge.toNodeId,
                targetPortId: edge.targetPortId,
                resourceType: edge.resourceType,
                role: edge.role,
                sortOrder: edge.order,
                edgeType: edge.role,
                data: edge,
            })),
        );
    }
    await db.insert(tables.canvasSnapshots).values({ projectId, version: canvas.revision, contractVersion: write.contractVersion, nodes: write.nodes, edges: write.edges, viewport: write.viewport, settings: write.settings, source, restoredFromVersion });
    await db.update(tables.projects).set({ updatedAt: now, lastOpenedAt: now }).where(eq(tables.projects.id, projectId));
    return { projectId, canvasId: canvas.canvasId, revision: canvas.revision, contractVersion: write.contractVersion, nodes: write.nodes, edges: write.edges, viewport: write.viewport, settings: write.settings, updatedAt: now.toISOString() };
}

function deserializeNode(row: typeof tables.canvasNodes.$inferSelect): CanvasNode {
    const data = isRecord(row.data) ? row.data : {};
    const metadata = isRecord(data.metadata) ? data.metadata : {};
    return {
        id: row.id,
        type: typeof data.type === "string" ? data.type : row.nodeType,
        title: typeof data.title === "string" ? data.title : row.label,
        position: row.position as CanvasNode["position"],
        width: typeof data.width === "number" ? data.width : row.width,
        height: typeof data.height === "number" ? data.height : row.height,
        metadata,
        definitionId: typeof data.definitionId === "string" ? data.definitionId : row.definitionId,
        definitionVersion: typeof data.definitionVersion === "number" ? data.definitionVersion : row.definitionVersion,
        workflowKind: typeof data.workflowKind === "string" ? data.workflowKind : row.workflowKind,
        locked: typeof data.locked === "boolean" ? data.locked : row.locked,
    };
}

function deserializeEdge(row: typeof tables.canvasEdges.$inferSelect): CanvasEdge {
    const data = isRecord(row.data) ? row.data : {};
    return {
        id: row.id,
        fromNodeId: typeof data.fromNodeId === "string" ? data.fromNodeId : row.sourceNodeId,
        toNodeId: typeof data.toNodeId === "string" ? data.toNodeId : row.targetNodeId,
        sourcePortId: typeof data.sourcePortId === "string" ? data.sourcePortId : row.sourcePortId,
        targetPortId: typeof data.targetPortId === "string" ? data.targetPortId : row.targetPortId,
        resourceType: (typeof data.resourceType === "string" ? data.resourceType : row.resourceType) as CanvasEdge["resourceType"],
        role: (typeof data.role === "string" ? data.role : row.role) as CanvasEdge["role"],
        order: typeof data.order === "number" ? data.order : row.sortOrder,
        metadata: isRecord(data.metadata) ? data.metadata : {},
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function createDefaultWorkspace(db: Executor, userId: string): Promise<Workspace> {
    const [created] = await db
        .insert(tables.projects)
        .values({ ownerId: userId, name: "未命名项目", description: "", isDefault: true })
        .onConflictDoNothing()
        .returning({ id: tables.projects.id });
    const projectId = created?.id || (await db.select({ id: tables.projects.id }).from(tables.projects).where(and(eq(tables.projects.ownerId, userId), eq(tables.projects.isDefault, true))).limit(1))[0]?.id;
    if (!projectId) throw new DomainError("WORKSPACE_CREATE_FAILED", "无法创建默认工作区", 500, true);
    await db.insert(tables.projectMembers).values({ projectId, userId, role: "owner" }).onConflictDoNothing();
    return ensureCanvasForProject(db, projectId, userId);
}

async function ensureCanvasForProject(db: Executor, projectId: string, userId: string): Promise<Workspace> {
    await db.insert(tables.canvases).values({ projectId }).onConflictDoNothing();
    const [row] = await db
        .select({
            projectId: tables.projects.id,
            projectTitle: tables.projects.name,
            projectDescription: tables.projects.description,
            canvasId: tables.canvases.id,
            isDefault: tables.projects.isDefault,
            updatedAt: tables.projects.updatedAt,
        })
        .from(tables.projects)
        .innerJoin(tables.projectMembers, eq(tables.projectMembers.projectId, tables.projects.id))
        .innerJoin(tables.canvases, eq(tables.canvases.projectId, tables.projects.id))
        .where(and(eq(tables.projects.id, projectId), eq(tables.projectMembers.userId, userId)))
        .limit(1);
    if (!row) throw new DomainError("WORKSPACE_CREATE_FAILED", "无法读取默认工作区", 500, true);
    await db.update(tables.projects).set({ lastOpenedAt: new Date() }).where(eq(tables.projects.id, projectId));
    return { ...row, updatedAt: row.updatedAt.toISOString() };
}

function serializeProject(row: Omit<ProjectSummary, "updatedAt"> & { updatedAt: Date }): ProjectSummary {
    return { ...row, updatedAt: row.updatedAt.toISOString() };
}

function isUniqueViolation(error: unknown) {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}
