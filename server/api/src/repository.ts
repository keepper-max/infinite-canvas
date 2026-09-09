import { and, desc, eq, gt } from "drizzle-orm";
import type { NodePgDatabase, NodePgTransaction } from "drizzle-orm/node-postgres";
import type { ExtractTablesWithRelations } from "drizzle-orm";

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

    async isReady() {
        await this.db.select({ id: tables.users.id }).from(tables.users).limit(1);
        return true;
    }
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
