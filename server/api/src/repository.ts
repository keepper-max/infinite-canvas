import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { normalizeCanvasHistory } from "./canvas-compat.js";
import type {
  NodePgDatabase,
  NodePgTransaction,
} from "drizzle-orm/node-postgres";
import type { ExtractTablesWithRelations } from "drizzle-orm";

import { hasKnowledgeFeature, requireKnowledgeFeature } from "./knowledge-feature.js";
import { issueWriteCapability, validateKnowledgeCanvasWrite } from "./canvas-write-capability.js";
import {
  parseCanvasWrite,
  type CanvasDocument,
  type CanvasEdge,
  type CanvasMigrationReport,
  type CanvasNode,
  type CanvasSettings,
  type CanvasSnapshotSummary,
  type CanvasViewport,
  type CanvasWrite,
} from "./canvas-contract.js";
import {
  DomainError,
  type PlatformRepository,
  type ProjectSummary,
  type RegistrationContext,
  type VerifiedIdentity,
  type Workspace,
} from "./domain.js";
import * as tables from "./db/schema.js";

type Database = NodePgDatabase<typeof tables>;
type Transaction = NodePgTransaction<
  typeof tables,
  ExtractTablesWithRelations<typeof tables>
>;
type Executor = Database | Transaction;

export type CanvasOperationRequest = {
  operationId: string; expectedCanvasRevision: number;
  kind: "vibe.storyboard.create" | "vibe.video.import" | "canvas.repair" | "canvas.repair.restore" | "knowledge.reference.add";
  payload: unknown;
};
export type CanvasOperationReceipt = {
  operationId: string; projectId: string; canvasId: string; revision: number;
  nodeIds: string[]; edgeIds: string[]; result: Record<string, unknown>; replayed: boolean;
};
export type CanvasMutation = { nodes: unknown[]; edges: unknown[]; viewport: CanvasViewport; settings: CanvasSettings; result: Record<string, unknown> };

type LegacyAssetVersionMatch = {
  id: string;
  assetId: string;
  storageKey: string;
  localStorageKey: string;
  sha256: string;
};

export function resolveLegacyAssetVersionMatches<
  T extends LegacyAssetVersionMatch,
>(versions: T[]) {
  const matches = new Map<string, T | null>();
  versions.forEach((version) => {
    if (!matches.has(version.localStorageKey)) {
      matches.set(version.localStorageKey, version);
      return;
    }
    const existing = matches.get(version.localStorageKey);
    if (
      !existing ||
      existing.sha256 !== version.sha256 ||
      !isReliableSha256(existing.sha256)
    )
      matches.set(version.localStorageKey, null);
  });
  return matches;
}

function isReliableSha256(value: string) {
  return /^[a-f\d]{64}$/i.test(value) && !/^0{64}$/.test(value);
}

export class PostgresPlatformRepository implements PlatformRepository {
  constructor(private readonly db: Database) {}

  async createUserWithWorkspace(
    email: string,
    passwordHash: string,
    registration: RegistrationContext = {},
  ) {
    return this.createIdentityUserWithWorkspace({ email, passwordHash }, registration);
  }

  async createIdentityUserWithWorkspace(
    identity: VerifiedIdentity,
    registration: RegistrationContext = {},
  ) {
    try {
      return await this.db.transaction(async (tx) => {
        const settings = (await tx.execute(
          sql`select value from platform_settings where key='registration_invite'`,
        )) as unknown as { rows: Array<{ value?: { mode?: string } }> };
        const mode = String(settings.rows[0]?.value?.mode || "optional");
        const inviteCode = registration.inviteCode?.trim().toUpperCase();
        if (mode === "required" && !inviteCode)
          throw new DomainError("INVITE_CODE_REQUIRED", "请输入邀请码", 422);
        if (mode === "disabled" && inviteCode)
          throw new DomainError(
            "INVITE_CODE_DISABLED",
            "当前注册不使用邀请码",
            422,
          );
        let attribution: {
          inviteCodeId: string | null;
          channelId: string;
          campaignId: string | null;
          batchId: string | null;
        };
        let invite: typeof tables.inviteCodes.$inferSelect | undefined;
        if (inviteCode) {
          [invite] = await tx
            .select()
            .from(tables.inviteCodes)
            .where(
              sql`upper(${tables.inviteCodes.code}) = upper(${inviteCode})`,
            )
            .for("update")
            .limit(1);
          validateRegistrationInvite(invite);
          attribution = {
            inviteCodeId: invite!.id,
            channelId: invite!.channelId,
            campaignId: invite!.campaignId,
            batchId: invite!.batchId,
          };
        } else {
          const [organic] = await tx
            .select({ id: tables.channels.id })
            .from(tables.channels)
            .where(eq(tables.channels.systemKey, "organic"))
            .limit(1);
          if (!organic)
            throw new DomainError(
              "ORGANIC_CHANNEL_MISSING",
              "自然注册渠道未初始化",
              503,
              true,
            );
          attribution = {
            inviteCodeId: null,
            channelId: organic.id,
            campaignId: null,
            batchId: null,
          };
        }
        const [user] = await tx
          .insert(tables.users)
          .values({
            email: identity.email || null,
            emailVerified: Boolean(identity.email && !identity.passwordHash),
            phone: identity.phone || null,
            phoneVerified: Boolean(identity.phone),
            passwordHash: identity.passwordHash || null,
            ...attribution,
            sourceRegisteredAt: new Date(),
            registrationIp: registration.registrationIp || null,
          })
          .returning({
            id: tables.users.id,
            email: tables.users.email,
            phone: tables.users.phone,
            emailVerified: tables.users.emailVerified,
            phoneVerified: tables.users.phoneVerified,
            isAdmin: tables.users.isAdmin,
            accountStatus: tables.users.accountStatus,
          });
        const workspace = await createDefaultWorkspace(tx, user.id);
        if (invite)
          await tx
            .update(tables.inviteCodes)
            .set({
              usedCount: sql`${tables.inviteCodes.usedCount} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(tables.inviteCodes.id, invite.id));
        let verificationConsumed = false;
        if (registration.verificationCodeId) {
          const consumed = (await tx.execute(sql`
            update email_verification_codes set status='consumed',consumed_at=now()
            where id=${registration.verificationCodeId} and email=${identity.email} and purpose='register' and status='pending'
            returning id
          `)) as unknown as { rowCount: number };
          if (consumed.rowCount !== 1)
            throw new DomainError(
              "INVALID_VERIFICATION_CODE",
              "验证码无效或已过期，请重新获取",
              422,
            );
          verificationConsumed = true;
        }
        return {
          user: normalizePlatformUser(user),
          workspace,
          verificationConsumed,
        };
      });
    } catch (error) {
      if (isUniqueViolation(error) && identity.phone)
        throw new DomainError("PHONE_ALREADY_REGISTERED", "手机号已注册", 409, false, { cause: error });
      if (isUniqueViolation(error))
        throw new DomainError(
          "EMAIL_ALREADY_REGISTERED",
          "邮箱已注册",
          409,
          false,
          { cause: error },
        );
      throw error;
    }
  }

  async findUserByEmail(email: string) {
    const [user] = await this.db
      .select({
        id: tables.users.id,
        email: tables.users.email,
        phone: tables.users.phone,
        emailVerified: tables.users.emailVerified,
        phoneVerified: tables.users.phoneVerified,
        passwordHash: tables.users.passwordHash,
        isAdmin: tables.users.isAdmin,
        accountStatus: tables.users.accountStatus,
      })
      .from(tables.users)
      .where(eq(tables.users.email, email))
      .limit(1);
    return user
      ? { ...normalizePlatformUser(user), passwordHash: user.passwordHash }
      : null;
  }

  async findUserByPhone(phone: string) {
    const [user] = await this.db.select({
      id: tables.users.id,
      email: tables.users.email,
      phone: tables.users.phone,
      emailVerified: tables.users.emailVerified,
      phoneVerified: tables.users.phoneVerified,
      passwordHash: tables.users.passwordHash,
      isAdmin: tables.users.isAdmin,
      accountStatus: tables.users.accountStatus,
    }).from(tables.users).where(eq(tables.users.phone, phone)).limit(1);
    return user ? { ...normalizePlatformUser(user), passwordHash: user.passwordHash } : null;
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date) {
    await this.db
      .insert(tables.sessions)
      .values({ userId, tokenHash, expiresAt });
  }

  async markLogin(userId: string) {
    await this.db
      .update(tables.users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(tables.users.id, userId));
  }

  async findUserBySession(tokenHash: string, now: Date) {
    const [user] = await this.db
      .select({
        id: tables.users.id,
        email: tables.users.email,
        phone: tables.users.phone,
        emailVerified: tables.users.emailVerified,
        phoneVerified: tables.users.phoneVerified,
        isAdmin: tables.users.isAdmin,
        accountStatus: tables.users.accountStatus,
      })
      .from(tables.sessions)
      .innerJoin(tables.users, eq(tables.sessions.userId, tables.users.id))
      .where(
        and(
          eq(tables.sessions.tokenHash, tokenHash),
          gt(tables.sessions.expiresAt, now),
          eq(tables.users.accountStatus, "active"),
        ),
      )
      .limit(1);
    return user ? normalizePlatformUser(user) : null;
  }

  async deleteSession(tokenHash: string) {
    await this.db
      .delete(tables.sessions)
      .where(eq(tables.sessions.tokenHash, tokenHash));
  }

  async updatePasswordAndRevokeSessions(
    userId: string,
    passwordHash: string,
  ) {
    await this.db.transaction(async (tx) => {
      await tx
        .update(tables.users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(tables.users.id, userId));
      await tx
        .delete(tables.sessions)
        .where(eq(tables.sessions.userId, userId));
    });
  }

  async ensureDefaultWorkspace(userId: string) {
    return this.db.transaction(async (tx) => {
      const [recent] = await tx
        .select({ id: tables.projects.id })
        .from(tables.projects)
        .innerJoin(
          tables.projectMembers,
          eq(tables.projectMembers.projectId, tables.projects.id),
        )
        .where(
          and(
            eq(tables.projectMembers.userId, userId),
            isNull(tables.projects.deletedAt),
          ),
        )
        .orderBy(
          desc(tables.projects.lastOpenedAt),
          desc(tables.projects.updatedAt),
        )
        .limit(1);
      if (recent) return ensureCanvasForProject(tx, recent.id, userId);
      return createDefaultWorkspace(tx, userId);
    });
  }

  async createProjectForUser(
    userId: string,
    input: { name: string; description: string },
  ) {
    return this.db.transaction(async (tx) => {
      const [project] = await tx
        .insert(tables.projects)
        .values({
          ownerId: userId,
          name: input.name,
          description: input.description,
        })
        .returning({ id: tables.projects.id });
      if (!project)
        throw new DomainError(
          "PROJECT_CREATE_FAILED",
          "无法创建项目",
          500,
          true,
        );
      await tx
        .insert(tables.projectMembers)
        .values({ projectId: project.id, userId, role: "owner" });
      await tx.insert(tables.canvases).values({ projectId: project.id });
      const summary = await readProjectForUser(tx, project.id, userId, false);
      if (!summary)
        throw new DomainError(
          "PROJECT_CREATE_FAILED",
          "无法读取新项目",
          500,
          true,
        );
      return summary;
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
      .innerJoin(
        tables.projectMembers,
        eq(tables.projectMembers.projectId, tables.projects.id),
      )
      .innerJoin(
        tables.canvases,
        eq(tables.canvases.projectId, tables.projects.id),
      )
      .where(
        and(
          eq(tables.projectMembers.userId, userId),
          isNull(tables.projects.deletedAt),
        ),
      )
      .orderBy(
        desc(tables.projects.lastOpenedAt),
        desc(tables.projects.updatedAt),
      );
    return rows.map(serializeProject);
  }

  async getProjectForUser(projectId: string, userId: string) {
    return readProjectForUser(this.db, projectId, userId, true);
  }

  async updateProjectForUser(
    projectId: string,
    userId: string,
    input: { name?: string; description?: string },
  ) {
    return this.db.transaction(async (tx) => {
      if (!(await hasProjectAccess(tx, projectId, userId))) return null;
      if (!(await hasProjectEditAccess(tx, projectId, userId)))
        throw new DomainError("PROJECT_READ_ONLY", "当前成员只有查看权限", 403);
      await tx
        .update(tables.projects)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(
            eq(tables.projects.id, projectId),
            isNull(tables.projects.deletedAt),
          ),
        );
      return readProjectForUser(tx, projectId, userId, false);
    });
  }

  async deleteProjectForUser(projectId: string, userId: string) {
    return this.db.transaction(async (tx) => {
      const [project] = await tx
        .select({ ownerId: tables.projects.ownerId })
        .from(tables.projects)
        .where(
          and(
            eq(tables.projects.id, projectId),
            isNull(tables.projects.deletedAt),
          ),
        )
        .limit(1);
      if (!project) return null;
      if (project.ownerId !== userId)
        throw new DomainError(
          "PROJECT_DELETE_FORBIDDEN",
          "只有项目所有者可以删除项目",
          403,
        );
      const now = new Date();
      await tx
        .update(tables.projects)
        .set({ deletedAt: now, isDefault: false, updatedAt: now })
        .where(eq(tables.projects.id, projectId));
      await tx.execute(
        sql`update generation_jobs set status='cancel_requested',cancel_requested_at=${now},updated_at=${now} where project_id=${projectId} and status in ('pending','queued','submitting','retrying','running','downloading','persisting')`,
      );
      await tx.execute(
        sql`update composition_jobs set status='cancel_requested',cancel_requested_at=${now},updated_at=${now} where project_id=${projectId} and status in ('pending','queued','preparing','rendering','uploading','retrying')`,
      );
      const [recent] = await tx
        .select({ id: tables.projects.id })
        .from(tables.projects)
        .innerJoin(
          tables.projectMembers,
          eq(tables.projectMembers.projectId, tables.projects.id),
        )
        .where(
          and(
            eq(tables.projectMembers.userId, userId),
            isNull(tables.projects.deletedAt),
          ),
        )
        .orderBy(
          desc(tables.projects.lastOpenedAt),
          desc(tables.projects.updatedAt),
        )
        .limit(1);
      const workspace = recent
        ? await ensureCanvasForProject(tx, recent.id, userId)
        : await createDefaultWorkspace(tx, userId);
      return { deletedProjectId: projectId, workspace };
    });
  }

  async getCanvasForUser(projectId: string, userId: string) {
    return this.db.transaction(async tx => {
      const value = await readCanvas(tx, projectId, userId);
      if (value?.nodes.some(n=>n.type==='knowledge:document') && !await hasKnowledgeFeature(tx,userId,false))
        return {...value,nodes:value.nodes.map(n=>n.type==='knowledge:document'?{...n,title:'知识文档（未开放）',metadata:{knowledgeUnavailable:true}}:n)};
      return value;
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }
  async issueCanvasWriteCapability(projectId: string,userId: string,expectedRevision: number,acknowledgedKnowledgeNodes: unknown) {
    return this.db.transaction(async tx=>{
      await lockCanvasWriteContext(tx,projectId,userId);
      const [canvas]=await tx.select().from(tables.canvases).where(eq(tables.canvases.projectId,projectId));
      if(canvas.revision!==expectedRevision) throw new DomainError('CANVAS_REVISION_CONFLICT','画布版本已变化，请保留草稿后刷新',409);
      return issueWriteCapability(tx,userId,projectId,expectedRevision,acknowledgedKnowledgeNodes);
    });
  }

  async saveCanvasForUser(
    projectId: string,
    userId: string,
    write: CanvasWrite,
    source: "save" | "migration" | "restore" = "save",
    restoredFromVersion?: number,
  ) {
    return this.db.transaction((tx) =>
      saveCanvasInTransaction(
        tx,
        projectId,
        userId,
        write,
        source,
        restoredFromVersion,
      ),
    );
  }

  async applyCanvasOperationForUser(
    projectId: string, userId: string, input: CanvasOperationRequest,
    mutate: (canvas: CanvasDocument, tx: Transaction) => Promise<CanvasMutation>,
  ) {
    z.enum(["vibe.storyboard.create", "vibe.video.import", "knowledge.reference.add"]).parse(input.kind);
    return this.commitCanvasOperation(projectId, userId, input, mutate);
  }

  private async commitCanvasOperation(
    projectId: string, userId: string, input: CanvasOperationRequest,
    mutate: (canvas: CanvasDocument, tx: Transaction) => Promise<CanvasMutation>,
    repair?: { expectedStateHash: string; reason: string },
  ): Promise<CanvasOperationReceipt> {
    z.string().uuid().parse(input.operationId);
    z.number().int().nonnegative().parse(input.expectedCanvasRevision);
    return this.db.transaction(async tx => {
      await lockCanvasWriteContext(tx, projectId, userId, Boolean(repair), input.kind.startsWith("canvas.repair"));
        if (input.kind === "knowledge.reference.add") await requireKnowledgeFeature(tx, userId);
      // JSONB canonicalization is PostgreSQL's, not a second hand-written JSON serializer.
      const digest = await tx.execute(sql`select encode(sha256(convert_to(${JSON.stringify({ kind: input.kind, expectedCanvasRevision: input.expectedCanvasRevision, payload: input.payload })}::jsonb::text,'UTF8')),'hex') as hash`);
      const payloadHash = String(digest.rows[0].hash);
      const [existing] = await tx.select().from(tables.canvasOperations).where(and(
        eq(tables.canvasOperations.projectId, projectId), eq(tables.canvasOperations.actorId, userId), eq(tables.canvasOperations.operationId, input.operationId),
      ));
      // Authorization precedes replay, but replay precedes current-revision/health checks.
      if (existing) {
        if (existing.payloadHash !== payloadHash)
          throw new DomainError("CANVAS_OPERATION_MISMATCH", "operationId 已用于不同请求", 409, false, { details: { operationId: input.operationId } });
        return { ...(existing.receipt as CanvasOperationReceipt), replayed: true };
      }
      const health = await inspectCanvasConsistency(tx, projectId);
      if (!repair) assertCanvasConsistent(health);
      const originalState = repair ? await captureCanvasState(tx, projectId) : undefined;
      if (repair && originalState!.hash !== repair.expectedStateHash)
        throw new DomainError("CANVAS_REPAIR_PLAN_STALE", "旧状态已变化，请重新核查修复计划", 409);
      if (repair && health.reasons.includes("CANVAS_MISSING"))
        await tx.insert(tables.canvases).values({ projectId });
      const current = (await readCanvas(tx, projectId, userId))!;
      if (current.revision !== input.expectedCanvasRevision)
        throw canvasRevisionConflict(current.revision);
      let archiveId: string | undefined;
      let baseRevision = current.revision;
      if (repair) {
        const state = originalState!;
        const [member] = await tx.select({ role: tables.projectMembers.role }).from(tables.projectMembers).where(and(eq(tables.projectMembers.projectId, projectId), eq(tables.projectMembers.userId, userId)));
        if (!["owner", "admin"].includes(member.role)) throw new DomainError("PROJECT_FORBIDDEN", "只有项目所有者或管理员可确认历史修复", 403);
        baseRevision = Math.max(current.revision, health.maxSnapshotVersion);
        archiveId = randomUUID();
        await tx.insert(tables.canvasRepairArchives).values({ id: archiveId, projectId, actorId: userId, operationId: input.operationId,
          reason: repair.reason, stateHash: state.hash, beforeState: state.state, resultingRevision: baseRevision + 1 });
        // Forward only: historical snapshots are never renumbered or overwritten.
        await tx.update(tables.canvases).set({ revision: baseRevision }).where(eq(tables.canvases.projectId, projectId));
      }
      const mutation = await mutate(current, tx);
      const { write } = parseCanvasWrite({ expectedRevision: baseRevision, contractVersion: current.contractVersion,
        nodes: mutation.nodes, edges: mutation.edges, viewport: mutation.viewport, settings: mutation.settings });
      const saved = await saveCanvasInTransaction(tx, projectId, userId, write, input.kind.startsWith("canvas.repair") ? "repair" : input.kind === "knowledge.reference.add" ? "save" : "mcp", undefined, true);
      const receipt: CanvasOperationReceipt = { operationId: input.operationId, projectId, canvasId: saved.canvasId,
        revision: saved.revision, nodeIds: saved.nodes.map(node => node.id), edgeIds: saved.edges.map(edge => edge.id),
        result: { ...mutation.result, ...(archiveId ? { archiveId } : {}) }, replayed: false };
      await tx.insert(tables.canvasOperations).values({ projectId, actorId: userId, operationId: input.operationId,
        kind: input.kind, payloadHash, receipt });
      await tx.insert(tables.adminAuditLogs).values({ actorUserId: userId, action: "canvas.operation", targetType: "canvas", targetId: saved.canvasId,
        metadata: { operationId: input.operationId, kind: input.kind, payloadHash, fromRevision: current.revision, revision: saved.revision, archiveId: archiveId ?? null } });
      return receipt;
    });
  }

  async inspectCanvasForRepair(projectId: string, userId: string) {
    return this.db.transaction(async tx => {
      const actor = await tx.execute(sql`select id from users where id=${userId} and account_status='active'`);
      if (!actor.rows.length) throw new DomainError("UNAUTHENTICATED", "用户不存在或已停用", 401);
      if (!(await hasProjectEditAccess(tx, projectId, userId))) throw new DomainError("PROJECT_FORBIDDEN", "无权核查该项目", 403);
      const duplicates = await tx.execute(sql`select node_type,label,array_agg(id order by id) as ids from canvas_nodes
        where project_id=${projectId} group by node_type,label,coalesce(data->'metadata'->>'content',data->>'description',data->>'narration','') having count(*)>1`);
      return { ...(await inspectCanvasConsistency(tx, projectId)), ...(await captureCanvasState(tx, projectId)), duplicateCandidates: duplicates.rows };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }

  async getCanvasOperationReceiptForUser(projectId: string, userId: string, operationId: string) {
    z.string().uuid().parse(operationId);
    return this.db.transaction(async tx => {
      const actor = await tx.execute(sql`select id from users where id=${userId} and account_status='active'`);
      if (!actor.rows.length) throw new DomainError("UNAUTHENTICATED", "用户不存在或已停用", 401);
      if (!(await hasProjectEditAccess(tx, projectId, userId))) throw new DomainError("PROJECT_FORBIDDEN", "无权核查该操作回执", 403);
        const [operation] = await tx.select({ receipt: tables.canvasOperations.receipt, kind: tables.canvasOperations.kind }).from(tables.canvasOperations).where(and(
        eq(tables.canvasOperations.projectId, projectId), eq(tables.canvasOperations.actorId, userId), eq(tables.canvasOperations.operationId, operationId),
      ));
      if (!operation) throw new DomainError("CANVAS_OPERATION_NOT_FOUND", "该操作者在此项目下没有这项操作的已提交回执", 404);
        if (operation.kind === "knowledge.reference.add" && !await hasKnowledgeFeature(tx, userId, false))
          throw new DomainError("KNOWLEDGE_NOT_ENABLED", "此账号尚未开放知识功能", 403);
      return operation.receipt as CanvasOperationReceipt;
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }

  async repairCanvasForUser(projectId: string, userId: string, input: {
    operationId: string; expectedCanvasRevision: number; expectedStateHash: string; reason: string;
  }) {
    z.string().regex(/^[a-f0-9]{64}$/).parse(input.expectedStateHash);
    z.string().trim().min(1).parse(input.reason);
    return this.commitCanvasOperation(projectId, userId, { ...input, kind: "canvas.repair", payload: { expectedStateHash: input.expectedStateHash, reason: input.reason } }, async (current, tx) => {
      const nodes = await tx.select().from(tables.canvasNodes).where(eq(tables.canvasNodes.projectId, projectId)).orderBy(asc(tables.canvasNodes.sortOrder));
      const edges = await tx.select().from(tables.canvasEdges).where(eq(tables.canvasEdges.projectId, projectId)).orderBy(asc(tables.canvasEdges.sortOrder));
      const assetLinks = await tx.select().from(tables.assetLinks).where(eq(tables.assetLinks.projectId, projectId));
      const { write, report } = normalizeCanvasHistory({ ...current, nodes, edges, assetLinks, expectedRevision: current.revision });
      return { ...write, result: { repaired: true, originalRevision: current.revision, duplicatesRemoved: 0, normalizedExclusions: report.excludedPaths } };
    }, input);
  }

  async restoreCanvasRepairArchiveForUser(projectId: string, userId: string, input: {
    operationId: string; expectedCanvasRevision: number; archiveId: string; reason: string;
  }) {
    z.string().uuid().parse(input.archiveId);
    z.string().trim().min(1).parse(input.reason);
    return this.commitCanvasOperation(projectId, userId, { ...input, kind: "canvas.repair.restore", payload: { archiveId: input.archiveId, reason: input.reason } }, async (current, tx) => {
      const [member] = await tx.select({ role: tables.projectMembers.role }).from(tables.projectMembers).where(and(eq(tables.projectMembers.projectId, projectId), eq(tables.projectMembers.userId, userId)));
      if (!["owner", "admin"].includes(member.role)) throw new DomainError("PROJECT_FORBIDDEN", "只有项目所有者或管理员可回滚历史修复", 403);
      const archive = await tx.execute(sql`select before_state from canvas_repair_archives where id=${input.archiveId} and project_id=${projectId}
        and state_hash=encode(sha256(convert_to(before_state::text,'UTF8')),'hex') for share`);
      if (!archive.rows.length) throw new DomainError("CANVAS_ARCHIVE_INVALID", "修复归档不存在或完整性校验失败", 409);
      const before = archive.rows[0].before_state as { nodes: unknown; edges: unknown; assetLinks: Array<Record<string, unknown>>; canvas: { viewport: CanvasViewport; settings: CanvasSettings } | null };
      const { write, report } = normalizeCanvasHistory({ expectedRevision: current.revision, nodes: before.nodes, edges: before.edges,
        viewport: before.canvas?.viewport ?? current.viewport, settings: before.canvas?.settings ?? current.settings, assetLinks: before.assetLinks });
      return { ...write, result: { restoredArchiveId: input.archiveId, normalizedExclusions: report.excludedPaths, duplicatesRemoved: 0 } };
    });
  }

  async listCanvasSnapshots(
    projectId: string,
    userId: string,
  ): Promise<CanvasSnapshotSummary[] | null> {
    if (!(await hasProjectAccess(this.db, projectId, userId))) return null;
    const rows = await this.db
      .select({
        version: tables.canvasSnapshots.version,
        source: tables.canvasSnapshots.source,
        restoredFromVersion: tables.canvasSnapshots.restoredFromVersion,
        createdAt: tables.canvasSnapshots.createdAt,
        nodes: tables.canvasSnapshots.nodes,
        edges: tables.canvasSnapshots.edges,
        viewport: tables.canvasSnapshots.viewport,
        settings: tables.canvasSnapshots.settings,
      })
      .from(tables.canvasSnapshots)
      .where(eq(tables.canvasSnapshots.projectId, projectId))
      .orderBy(desc(tables.canvasSnapshots.version))
      .limit(100);
    return rows.map(({ nodes, edges, viewport, settings, ...row }) => {
      let restorable = false;
      try { restorable = normalizeCanvasHistory({ nodes, edges, viewport, settings, expectedRevision: 0 }).report.excludedPaths.length === 0; } catch { /* Unknown history remains immutable and cannot be restored. */ }
      return { ...row, createdAt: row.createdAt.toISOString(), restorable, ...(!restorable ? { restoreReason: "历史版本不兼容，暂不可恢复" } : {}) };
    });
  }

  async restoreCanvasSnapshot(
    projectId: string,
    userId: string,
    version: number,
    expectedRevision: number,
  ) {
    return this.db.transaction(async (tx) => {
      if (!(await hasProjectAccess(tx, projectId, userId))) return null;
      if (!(await hasProjectEditAccess(tx, projectId, userId)))
        throw new DomainError("PROJECT_READ_ONLY", "当前成员只有查看权限", 403);
      const [snapshot] = await tx
        .select({
          contractVersion: tables.canvasSnapshots.contractVersion,
          nodes: tables.canvasSnapshots.nodes,
          edges: tables.canvasSnapshots.edges,
          viewport: tables.canvasSnapshots.viewport,
          settings: tables.canvasSnapshots.settings,
        })
        .from(tables.canvasSnapshots)
        .where(
          and(
            eq(tables.canvasSnapshots.projectId, projectId),
            eq(tables.canvasSnapshots.version, version),
          ),
        )
        .limit(1);
      if (!snapshot)
        throw new DomainError(
          "CANVAS_SNAPSHOT_NOT_FOUND",
          "找不到该画布历史版本",
          404,
        );
      let normalized;
      try { normalized = normalizeCanvasHistory({
        expectedRevision,
        contractVersion: snapshot.contractVersion,
        nodes: snapshot.nodes,
        edges: snapshot.edges,
        viewport: snapshot.viewport,
        settings: snapshot.settings,
      });
        if (normalized.report.excludedPaths.length) throw new Error("History would lose content");
      } catch {
        throw new DomainError("CANVAS_SNAPSHOT_INCOMPATIBLE", "历史版本不兼容，暂不可恢复", 422);
      }
      const { write } = normalized;
      return saveCanvasInTransaction(
        tx,
        projectId,
        userId,
        write,
        "restore",
        version,
      );
    });
  }

  async migrateCanvasForUser(
    projectId: string,
    userId: string,
    migrationKey: string,
    write: CanvasWrite,
    report: CanvasMigrationReport,
  ) {
    return this.db.transaction(async (tx) => {
      if (!(await hasProjectAccess(tx, projectId, userId)))
        throw new DomainError("PROJECT_FORBIDDEN", "无权访问该项目", 403);
      const [existing] = await tx
        .select({ report: tables.canvasMigrations.report })
        .from(tables.canvasMigrations)
        .where(
          and(
            eq(tables.canvasMigrations.projectId, projectId),
            eq(tables.canvasMigrations.userId, userId),
            eq(tables.canvasMigrations.migrationKey, migrationKey),
          ),
        )
        .limit(1);
      if (existing) {
        const canvas = await readCanvas(tx, projectId, userId);
        if (!canvas)
          throw new DomainError("PROJECT_FORBIDDEN", "无权访问该项目", 403);
        return {
          canvas,
          report: existing.report as CanvasMigrationReport,
          alreadyMigrated: true,
        };
      }
      const canvas = await saveCanvasInTransaction(
        tx,
        projectId,
        userId,
        write,
        "migration",
      );
      await tx.insert(tables.canvasMigrations).values({
        projectId,
        userId,
        migrationKey,
        fromRevision: write.expectedRevision,
        toRevision: canvas.revision,
        report,
      });
      return { canvas, report, alreadyMigrated: false };
    });
  }

  async isReady() {
    await this.db.select({ id: tables.users.id }).from(tables.users).limit(1);
    return true;
  }
}

function validateRegistrationInvite(
  invite?: typeof tables.inviteCodes.$inferSelect,
) {
  if (!invite)
    throw new DomainError(
      "INVITE_CODE_NOT_FOUND",
      "邀请码不存在，请检查后重新输入",
      422,
    );
  if (invite.status !== "active")
    throw new DomainError("INVITE_CODE_DISABLED", "该邀请码当前不可使用", 422);
  const now = Date.now();
  if (invite.startAt && invite.startAt.getTime() > now)
    throw new DomainError("INVITE_CODE_NOT_STARTED", "该邀请码尚未生效", 422);
  if (invite.expireAt && invite.expireAt.getTime() < now)
    throw new DomainError("INVITE_CODE_EXPIRED", "该邀请码已过期", 422);
  if (invite.maxUses !== null && invite.usedCount >= invite.maxUses)
    throw new DomainError("INVITE_CODE_FULL", "该邀请码可使用名额已满", 422);
}

function normalizePlatformUser(user: {
  id: string;
  email: string | null;
  phone?: string | null;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  isAdmin: boolean;
  accountStatus: string;
}) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone || null,
    emailVerified: Boolean(user.emailVerified),
    phoneVerified: Boolean(user.phoneVerified),
    isAdmin: user.isAdmin,
    accountStatus:
      user.accountStatus === "disabled"
        ? ("disabled" as const)
        : ("active" as const),
  };
}

async function hasProjectAccess(
  db: Executor,
  projectId: string,
  userId: string,
) {
  const [member] = await db
    .select({ projectId: tables.projectMembers.projectId })
    .from(tables.projectMembers)
    .innerJoin(
      tables.projects,
      eq(tables.projects.id, tables.projectMembers.projectId),
    )
    .where(
      and(
        eq(tables.projectMembers.projectId, projectId),
        eq(tables.projectMembers.userId, userId),
        isNull(tables.projects.deletedAt),
      ),
    )
    .limit(1);
  return Boolean(member);
}

async function hasProjectEditAccess(
  db: Executor,
  projectId: string,
  userId: string,
) {
  const [member] = await db
    .select({ role: tables.projectMembers.role })
    .from(tables.projectMembers)
    .innerJoin(
      tables.projects,
      eq(tables.projects.id, tables.projectMembers.projectId),
    )
    .where(
      and(
        eq(tables.projectMembers.projectId, projectId),
        eq(tables.projectMembers.userId, userId),
        inArray(tables.projectMembers.role, ["owner", "admin", "editor"]),
        isNull(tables.projects.deletedAt),
      ),
    )
    .limit(1);
  return Boolean(member);
}

async function readCanvas(
  db: Executor,
  projectId: string,
  userId: string,
): Promise<CanvasDocument | null> {
  const [canvas] = await db
    .select({
      canvasId: tables.canvases.id,
      revision: tables.canvases.revision,
      contractVersion: tables.canvases.contractVersion,
      viewport: tables.canvases.viewport,
      settings: tables.canvases.settings,
      updatedAt: tables.canvases.updatedAt,
    })
    .from(tables.canvases)
    .innerJoin(
      tables.projectMembers,
      eq(tables.projectMembers.projectId, tables.canvases.projectId),
    )
    .innerJoin(
      tables.projects,
      eq(tables.projects.id, tables.canvases.projectId),
    )
    .where(
      and(
        eq(tables.canvases.projectId, projectId),
        eq(tables.projectMembers.userId, userId),
        isNull(tables.projects.deletedAt),
      ),
    )
    .limit(1);
  if (!canvas) return null;
  const [nodeRows, edgeRows] = await Promise.all([
    db
      .select()
      .from(tables.canvasNodes)
      .where(eq(tables.canvasNodes.projectId, projectId))
      .orderBy(asc(tables.canvasNodes.sortOrder)),
    db
      .select()
      .from(tables.canvasEdges)
      .where(eq(tables.canvasEdges.projectId, projectId))
      .orderBy(asc(tables.canvasEdges.sortOrder)),
  ]);
  const nodes = await enrichLegacyAssetBindings(
    db,
    projectId,
    nodeRows.map(deserializeNode),
  );
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

async function enrichLegacyAssetBindings(
  db: Executor,
  projectId: string,
  nodes: CanvasNode[],
) {
  const localStorageKeys = [
    ...new Set(
      nodes
        .map((node) => node.metadata?.storageKey)
        .filter(
          (value): value is string =>
            typeof value === "string" && /^(?:image|video|audio):/.test(value),
        ),
    ),
  ];
  if (!localStorageKeys.length) return nodes;
  const keyExpression = sql<string>`${tables.assetVersions.provenance}->>'localStorageKey'`;
  const versions = await db
    .select({
      id: tables.assetVersions.id,
      assetId: tables.assetVersions.assetId,
      storageKey: tables.assetVersions.storageKey,
      localStorageKey: keyExpression,
      sha256: tables.assetVersions.sha256,
    })
    .from(tables.assetVersions)
    .innerJoin(
      tables.assets,
      eq(tables.assets.id, tables.assetVersions.assetId),
    )
    .where(
      and(
        eq(tables.assets.projectId, projectId),
        eq(tables.assets.status, "active"),
        inArray(keyExpression, localStorageKeys),
      ),
    );
  const matches = resolveLegacyAssetVersionMatches(versions);
  return nodes.map((node) => {
    if (node.metadata?.assetVersionId) return node;
    const localStorageKey =
      typeof node.metadata?.storageKey === "string"
        ? node.metadata.storageKey
        : null;
    const version = localStorageKey ? matches.get(localStorageKey) : null;
    if (!version) return node;
    return {
      ...node,
      metadata: {
        ...node.metadata,
        assetId: version.assetId,
        assetVersionId: version.id,
        storageKey: version.storageKey,
      },
    };
  });
}

function canvasRevisionConflict(currentRevision: number) {
  return new DomainError("CANVAS_REVISION_CONFLICT", "画布已更新，请重读后明确重放操作", 409, false, { details: { currentRevision } });
}

async function lockCanvasWriteContext(db: Transaction, projectId: string, userId: string, allowMissing = false, repairOperation = false) {
  const mode = process.env.CANVAS_WRITE_MODE ?? "enabled";
  if (mode !== "enabled" && !(mode === "repair-only" && repairOperation))
    throw new DomainError("CANVAS_WRITES_DISABLED", "画布处于维护只读状态，草稿保留，请稍后核查回执", 503);
  // All formal writers use actor -> canvas -> project/member, including Web saves.
  const actor = await db.execute(sql`select id from users where id=${userId} and account_status='active' for share`);
  if (!actor.rows.length) throw new DomainError("UNAUTHENTICATED", "用户不存在或已停用", 401);
  if (!(await hasProjectAccess(db, projectId, userId))) throw new DomainError("PROJECT_FORBIDDEN", "无权访问该项目", 403);
  if (allowMissing) await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`canvas-init:${projectId}`},0))`);
  const canvas = await db.execute(sql`select id from canvases where project_id=${projectId} for update`);
  if (!canvas.rows.length && !allowMissing) throw new DomainError("CANVAS_NOT_INITIALIZED", "旧项目缺少画布，请先执行显式兼容核查", 409);
  const membership = await db.execute(sql`select m.role from project_members m join projects p on p.id=m.project_id
    where p.id=${projectId} and m.user_id=${userId} and p.deleted_at is null for share of p,m`);
  if (!membership.rows.length) throw new DomainError("PROJECT_FORBIDDEN", "无权访问该项目", 403);
  if (!(await hasProjectEditAccess(db, projectId, userId))) throw new DomainError("PROJECT_READ_ONLY", "当前成员只有查看权限", 403);
}

type CanvasHealth = { revision: number; maxSnapshotVersion: number; reasons: string[] };
async function inspectCanvasConsistency(db: Transaction, projectId: string): Promise<CanvasHealth> {
  const response = await db.execute(sql`
    select coalesce(c.revision,0) as revision,c.id is null as missing_canvas,
      coalesce((select max(version) from canvas_snapshots where project_id=p.id),0) as max_version,
      s.id is not null as has_snapshot,
      exists(select 1 from canvas_nodes n where n.project_id=p.id and (not (n.data ? 'metadata') or not (n.data ? 'type'))) as legacy_nodes,
      exists(select 1 from canvas_edges e where e.project_id=p.id and not (e.data ? 'fromNodeId')) as legacy_edges,
      exists(select 1 from canvas_nodes n where n.project_id=p.id) as has_nodes,
      (coalesce((select jsonb_agg(n.data order by n.id) from canvas_nodes n where n.project_id=p.id),'[]'::jsonb)
        is distinct from coalesce((select jsonb_agg(v order by v->>'id') from jsonb_array_elements(case when jsonb_typeof(s.nodes)='array' then s.nodes else '[]'::jsonb end) v),'[]'::jsonb)
       or coalesce((select jsonb_agg(e.data order by e.id) from canvas_edges e where e.project_id=p.id),'[]'::jsonb)
        is distinct from coalesce((select jsonb_agg(v order by v->>'id') from jsonb_array_elements(case when jsonb_typeof(s.edges)='array' then s.edges else '[]'::jsonb end) v),'[]'::jsonb)
       or c.viewport is distinct from s.viewport or c.settings is distinct from s.settings) as snapshot_differs
    from projects p left join canvases c on c.project_id=p.id
    left join canvas_snapshots s on s.project_id=p.id and s.version=coalesce(c.revision,0)
    where p.id=${projectId}`);
  const row = response.rows[0];
  const reasons: string[] = [];
  if (row.missing_canvas) reasons.push("CANVAS_MISSING");
  if (Number(row.max_version) > Number(row.revision)) reasons.push("SNAPSHOT_AHEAD");
  if (!row.has_snapshot && (Number(row.revision) > 0 || row.has_nodes)) reasons.push("CURRENT_SNAPSHOT_MISSING");
  if (row.legacy_nodes || row.legacy_edges) reasons.push("LEGACY_GRAPH_SHAPE");
  if (row.has_snapshot && row.snapshot_differs) reasons.push("CURRENT_SNAPSHOT_DIFFERS");
  return { revision: Number(row.revision), maxSnapshotVersion: Number(row.max_version), reasons };
}

function assertCanvasConsistent(health: CanvasHealth) {
  if (health.reasons.length) throw new DomainError("CANVAS_REPAIR_REQUIRED", "旧画布与快照不一致，禁止自动覆盖，请核查修复计划", 409, false,
    { details: { currentRevision: health.revision, maxSnapshotVersion: health.maxSnapshotVersion, reasons: health.reasons } });
}

async function captureCanvasState(db: Transaction, projectId: string) {
  const result = await db.execute(sql`with state as (select jsonb_build_object(
    'canvas',(select to_jsonb(c) from canvases c where c.project_id=${projectId}),
    'nodes',coalesce((select jsonb_agg(to_jsonb(n) order by n.id) from canvas_nodes n where n.project_id=${projectId}),'[]'::jsonb),
    'edges',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from canvas_edges e where e.project_id=${projectId}),'[]'::jsonb),
    'assetLinks',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from asset_links a where a.project_id=${projectId}),'[]'::jsonb),
    'snapshots',coalesce((select jsonb_agg(to_jsonb(s) order by s.version) from canvas_snapshots s where s.project_id=${projectId}),'[]'::jsonb)) as value)
    select value as state,encode(sha256(convert_to(value::text,'UTF8')),'hex') as hash from state`);
  return { state: result.rows[0].state, hash: String(result.rows[0].hash) };
}

async function saveCanvasInTransaction(
  db: Transaction,
  projectId: string,
  userId: string,
  write: CanvasWrite,
  source: "save" | "migration" | "restore" | "mcp" | "repair",
  restoredFromVersion?: number,
  contextValidated = false,
): Promise<CanvasDocument> {
  if (!contextValidated) {
    await lockCanvasWriteContext(db, projectId, userId);
    assertCanvasConsistent(await inspectCanvasConsistency(db, projectId));
  }
  if (!(await hasProjectAccess(db, projectId, userId)))
    throw new DomainError("PROJECT_FORBIDDEN", "无权访问该项目", 403);
  if (!(await hasProjectEditAccess(db, projectId, userId)))
    throw new DomainError("PROJECT_READ_ONLY", "当前成员只有查看权限", 403);
  await validateKnowledgeCanvasWrite(db,userId,projectId,write,source==='mcp'||(contextValidated&&source==='save')?'append':source==='repair'||source==='restore'?'restore':false);
  const now = new Date();
  const [canvas] = await db
    .update(tables.canvases)
    .set({
      revision: write.expectedRevision + 1,
      contractVersion: write.contractVersion,
      viewport: write.viewport,
      settings: write.settings,
      updatedAt: now,
    })
    .where(
      and(
        eq(tables.canvases.projectId, projectId),
        eq(tables.canvases.revision, write.expectedRevision),
      ),
    )
    .returning({
      canvasId: tables.canvases.id,
      revision: tables.canvases.revision,
    });
  if (!canvas) {
    const [current] = await db
      .select({ revision: tables.canvases.revision })
      .from(tables.canvases)
      .where(eq(tables.canvases.projectId, projectId))
      .limit(1);
    throw new DomainError(
      "CANVAS_REVISION_CONFLICT",
      "云端画布已被其他页面更新，请选择保留本地或载入云端版本",
      409,
      false,
      { details: { currentRevision: current?.revision ?? 0 } },
    );
  }
  await db
    .delete(tables.canvasEdges)
    .where(eq(tables.canvasEdges.projectId, projectId));
  await db
    .delete(tables.canvasNodes)
    .where(eq(tables.canvasNodes.projectId, projectId));
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
        // The canvas keeps precise dimensions in `data`; these legacy helper
        // columns are integers and must not reject freely resized nodes.
        width: Math.round(node.width),
        height: Math.round(node.height),
        locked: node.locked,
        groupId:
          typeof node.metadata?.groupId === "string"
            ? node.metadata.groupId
            : null,
        sortOrder: index,
        data: node,
        status:
          typeof node.metadata?.status === "string"
            ? node.metadata.status
            : "idle",
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
  await syncAssetLinks(db, projectId, write.nodes, write.edges);
  await db.insert(tables.canvasSnapshots).values({
    projectId,
    version: canvas.revision,
    contractVersion: write.contractVersion,
    nodes: write.nodes,
    edges: write.edges,
    viewport: write.viewport,
    settings: write.settings,
    source,
    restoredFromVersion,
  });
  await db
    .update(tables.projects)
    .set({ updatedAt: now, lastOpenedAt: now })
    .where(
      and(eq(tables.projects.id, projectId), isNull(tables.projects.deletedAt)),
    );
  await db.insert(tables.adminAuditLogs).values({ actorUserId: userId, action: "canvas.save", targetType: "canvas", targetId: canvas.canvasId,
    metadata: { revision: canvas.revision, source, nodeCount: write.nodes.length, edgeCount: write.edges.length } });
  return {
    projectId,
    canvasId: canvas.canvasId,
    revision: canvas.revision,
    contractVersion: write.contractVersion,
    nodes: write.nodes,
    edges: write.edges,
    viewport: write.viewport,
    settings: write.settings,
    updatedAt: now.toISOString(),
  };
}

async function syncAssetLinks(
  db: Transaction,
  projectId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
) {
  const links = [
    ...nodes.flatMap((node) =>
      collectAssetVersionReferences(node.metadata).map((reference) => ({
        ...reference,
        nodeId: node.id,
      })),
    ),
    ...edges.flatMap((edge) =>
      collectAssetVersionReferences(edge.metadata).map((reference) => ({
        ...reference,
        nodeId: edge.toNodeId,
        role: edge.role || reference.role,
      })),
    ),
  ];
  const unique = [
    ...new Map(
      links.map((link) => [
        `${link.nodeId}:${link.assetVersionId}:${link.role}`,
        link,
      ]),
    ).values(),
  ];
  if (unique.length) {
    const ids = [...new Set(unique.map((link) => link.assetVersionId))];
    const owned = await db
      .select({ id: tables.assetVersions.id })
      .from(tables.assetVersions)
      .innerJoin(
        tables.assets,
        eq(tables.assets.id, tables.assetVersions.assetId),
      )
      .where(
        and(
          eq(tables.assets.projectId, projectId),
          inArray(tables.assetVersions.id, ids),
        ),
      );
    if (owned.length !== ids.length)
      throw new DomainError(
        "ASSET_VERSION_FORBIDDEN",
        "画布引用了不属于当前项目的素材版本",
        422,
      );
  }
  await db
    .delete(tables.assetLinks)
    .where(
      and(
        eq(tables.assetLinks.projectId, projectId),
        sql`${tables.assetLinks.nodeId} is not null`,
      ),
    );
  if (unique.length)
    await db.insert(tables.assetLinks).values(
      unique.map((link) => ({
        projectId,
        assetVersionId: link.assetVersionId,
        nodeId: link.nodeId,
        role: link.role,
      })),
    );
}

function collectAssetVersionReferences(
  value: unknown,
  role = "reference",
  output: Array<{ assetVersionId: string; role: string }> = [],
) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    value.forEach((item) => collectAssetVersionReferences(item, role, output));
    return output;
  }
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.replace(/[-_\s]/g, "").toLowerCase();
    if (normalized === "legacyassetreferences") {
      if (!Array.isArray(item)) throw new DomainError("INVALID_ASSET_REFERENCE", "旧素材引用格式无效", 422);
      for (const reference of item) {
        if (!isRecord(reference) || typeof reference.assetVersionId !== "string" || !/^[0-9a-f-]{36}$/i.test(reference.assetVersionId)
          || typeof reference.role !== "string" || !reference.role)
          throw new DomainError("INVALID_ASSET_REFERENCE", "旧素材引用格式无效", 422);
        output.push({ assetVersionId: reference.assetVersionId, role: reference.role });
      }
      continue;
    }
    const nextRole = normalized.includes("firstframe")
      ? "first_frame"
      : normalized.includes("lastframe")
        ? "last_frame"
        : normalized.includes("audio")
          ? "audio_input"
          : normalized.includes("identity") || normalized.includes("character")
            ? "identity"
            : normalized.includes("scene") || normalized.includes("environment")
              ? "environment"
              : role;
    if (
      normalized === "assetversionid" &&
      typeof item === "string" &&
      /^[0-9a-f-]{36}$/i.test(item)
    )
      output.push({ assetVersionId: item, role: nextRole });
    else if (normalized === "assetversionids" && Array.isArray(item))
      item
        .filter(
          (id): id is string =>
            typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id),
        )
        .forEach((assetVersionId) =>
          output.push({ assetVersionId, role: nextRole }),
        );
    else collectAssetVersionReferences(item, nextRole, output);
  }
  return output;
}

function deserializeNode(
  row: typeof tables.canvasNodes.$inferSelect,
): CanvasNode {
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
    definitionId:
      typeof data.definitionId === "string"
        ? data.definitionId
        : row.definitionId,
    definitionVersion:
      typeof data.definitionVersion === "number"
        ? data.definitionVersion
        : row.definitionVersion,
    workflowKind:
      typeof data.workflowKind === "string"
        ? data.workflowKind
        : row.workflowKind,
    locked: typeof data.locked === "boolean" ? data.locked : row.locked,
  };
}

function deserializeEdge(
  row: typeof tables.canvasEdges.$inferSelect,
): CanvasEdge {
  const data = isRecord(row.data) ? row.data : {};
  return {
    id: row.id,
    fromNodeId:
      typeof data.fromNodeId === "string" ? data.fromNodeId : row.sourceNodeId,
    toNodeId:
      typeof data.toNodeId === "string" ? data.toNodeId : row.targetNodeId,
    sourcePortId:
      typeof data.sourcePortId === "string"
        ? data.sourcePortId
        : row.sourcePortId,
    targetPortId:
      typeof data.targetPortId === "string"
        ? data.targetPortId
        : row.targetPortId,
    resourceType: (typeof data.resourceType === "string"
      ? data.resourceType
      : row.resourceType) as CanvasEdge["resourceType"],
    role: (typeof data.role === "string"
      ? data.role
      : row.role) as CanvasEdge["role"],
    order: typeof data.order === "number" ? data.order : row.sortOrder,
    metadata: isRecord(data.metadata) ? data.metadata : {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function createDefaultWorkspace(
  db: Executor,
  userId: string,
): Promise<Workspace> {
  const [created] = await db
    .insert(tables.projects)
    .values({
      ownerId: userId,
      name: "未命名项目",
      description: "",
      isDefault: true,
    })
    .onConflictDoNothing()
    .returning({ id: tables.projects.id });
  const projectId =
    created?.id ||
    (
      await db
        .select({ id: tables.projects.id })
        .from(tables.projects)
        .where(
          and(
            eq(tables.projects.ownerId, userId),
            eq(tables.projects.isDefault, true),
            isNull(tables.projects.deletedAt),
          ),
        )
        .limit(1)
    )[0]?.id;
  if (!projectId)
    throw new DomainError(
      "WORKSPACE_CREATE_FAILED",
      "无法创建默认工作区",
      500,
      true,
    );
  await db
    .insert(tables.projectMembers)
    .values({ projectId, userId, role: "owner" })
    .onConflictDoNothing();
  return ensureCanvasForProject(db, projectId, userId);
}

async function ensureCanvasForProject(
  db: Executor,
  projectId: string,
  userId: string,
): Promise<Workspace> {
  // Serialize first initialization with explicit legacy repair; ordinary saves lock the existing canvas row.
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`canvas-init:${projectId}`},0))`);
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
    .innerJoin(
      tables.projectMembers,
      eq(tables.projectMembers.projectId, tables.projects.id),
    )
    .innerJoin(
      tables.canvases,
      eq(tables.canvases.projectId, tables.projects.id),
    )
    .where(
      and(
        eq(tables.projects.id, projectId),
        eq(tables.projectMembers.userId, userId),
        isNull(tables.projects.deletedAt),
      ),
    )
    .limit(1);
  if (!row)
    throw new DomainError(
      "WORKSPACE_CREATE_FAILED",
      "无法读取默认工作区",
      500,
      true,
    );
  await db
    .update(tables.projects)
    .set({ lastOpenedAt: new Date() })
    .where(
      and(eq(tables.projects.id, projectId), isNull(tables.projects.deletedAt)),
    );
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

async function readProjectForUser(
  db: Executor,
  projectId: string,
  userId: string,
  touch: boolean,
): Promise<ProjectSummary | null> {
  const [row] = await db
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
    .innerJoin(
      tables.projectMembers,
      eq(tables.projectMembers.projectId, tables.projects.id),
    )
    .innerJoin(
      tables.canvases,
      eq(tables.canvases.projectId, tables.projects.id),
    )
    .where(
      and(
        eq(tables.projects.id, projectId),
        eq(tables.projectMembers.userId, userId),
        isNull(tables.projects.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (touch)
    await db
      .update(tables.projects)
      .set({ lastOpenedAt: new Date() })
      .where(eq(tables.projects.id, projectId));
  return serializeProject(row);
}

function serializeProject(
  row: Omit<ProjectSummary, "updatedAt"> & { updatedAt: Date },
): ProjectSummary {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}
