import type { Pool, PoolClient } from "pg";

import type { OperationsConfig } from "./config.js";
import type { BillingService } from "./billing-service.js";
import { DomainError } from "./domain.js";
import type {
  PaymentOrderInput,
  SmsRequestInput,
  SmsVerifyInput,
  TeamCreateInput,
  TeamMemberInput,
} from "./operations-contract.js";

export interface OperationsServicePort {
  capabilities(): Record<string, boolean>;
  account(userId: string): Promise<unknown>;
  plans(): Promise<unknown[]>;
  requestSms(input: SmsRequestInput): Promise<never>;
  verifySms(input: SmsVerifyInput): Promise<never>;
  createPaymentOrder(userId: string, input: PaymentOrderInput): Promise<never>;
  receivePaymentCallback(provider: string): Promise<never>;
  listTeams(userId: string): Promise<unknown[]>;
  createTeam(userId: string, input: TeamCreateInput): Promise<unknown>;
  listTeamMembers(teamId: string, userId: string): Promise<unknown[]>;
  addTeamMember(
    teamId: string,
    userId: string,
    input: TeamMemberInput,
  ): Promise<unknown>;
  attachTeamProject(
    teamId: string,
    userId: string,
    projectId: string,
  ): Promise<unknown>;
  adminOverview(userId: string): Promise<unknown>;
  adminFailures(userId: string): Promise<unknown>;
  adminModels(userId: string): Promise<unknown>;
  adminUsers(userId: string, query: AdminListQuery): Promise<unknown>;
  adminUser(userId: string, targetUserId: string): Promise<unknown>;
  setUserStatus(
    userId: string,
    targetUserId: string,
    status: "active" | "disabled",
    reason: string | undefined,
    requestId: string,
  ): Promise<unknown>;
  revokeUserSessions(
    userId: string,
    targetUserId: string,
    requestId: string,
  ): Promise<unknown>;
  setUserAdmin(
    userId: string,
    targetUserId: string,
    isAdmin: boolean,
    requestId: string,
  ): Promise<unknown>;
  adminUsage(userId: string, query: AdminListQuery): Promise<unknown>;
  adminJobs(userId: string, query: AdminListQuery): Promise<unknown>;
  adminAuditLogs(userId: string, query: AdminListQuery): Promise<unknown>;
  adminProjectContent(
    userId: string,
    projectId: string,
    requestId: string,
  ): Promise<unknown>;
  reconcileUsage(
    userId: string,
    jobId: string,
    requestId: string,
  ): Promise<unknown>;
  auditAdminAccess(
    userId: string,
    action: string,
    targetType: string,
    targetId: string,
    requestId: string,
  ): Promise<void>;
}

export type AdminListQuery = {
  page: number;
  pageSize: number;
  q?: string;
  status?: string;
  userId?: string;
  projectId?: string;
  modelId?: string;
  capability?: string;
  isAdmin?: boolean;
  createdFrom?: string;
  createdTo?: string;
};

export class OperationsService implements OperationsServicePort {
  constructor(
    private readonly pool: Pool,
    private readonly config: OperationsConfig,
    private readonly billing?: BillingService,
  ) {}

  capabilities() {
    return {
      sms: false,
      credits: false,
      payments: false,
      teams: true,
      admin: true,
    };
  }

  async account(userId: string) {
    const result = await this.pool.query(
      `insert into credit_accounts(user_id) values($1) on conflict(user_id) do update set user_id=excluded.user_id
       returning id,user_id,balance,reserved,created_at,updated_at`,
      [userId],
    );
    const account = result.rows[0];
    const ledger = await this.pool.query(
      "select id,entry_type,delta,balance_after,reference_type,reference_id,metadata,created_at from credit_ledger where account_id=$1 order by id desc limit 100",
      [account.id],
    );
    return {
      account: serializeAccount(account),
      ledger: ledger.rows.map(serializeLedger),
      enabled: false,
    };
  }

  async plans() {
    const result = await this.pool.query(
      "select id,name,credits,price_cents,currency,enabled,metadata from billing_plans order by price_cents,id",
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      credits: Number(row.credits),
      priceCents: row.price_cents,
      currency: row.currency,
      enabled: row.enabled,
      metadata: row.metadata,
    }));
  }

  async requestSms(_input: SmsRequestInput): Promise<never> {
    throw disabled("SMS_DISABLED", "短信服务尚未启用");
  }

  async verifySms(_input: SmsVerifyInput): Promise<never> {
    throw disabled("SMS_DISABLED", "短信服务尚未启用");
  }

  async createPaymentOrder(
    _userId: string,
    _input: PaymentOrderInput,
  ): Promise<never> {
    throw disabled("PAYMENTS_DISABLED", "支付服务尚未启用");
  }

  async receivePaymentCallback(_provider: string): Promise<never> {
    throw disabled("PAYMENTS_DISABLED", "支付服务尚未启用");
  }

  async listTeams(userId: string) {
    const result = await this.pool.query(
      `select t.id,t.name,t.owner_id,m.role,t.created_at,t.updated_at
       from teams t join team_members m on m.team_id=t.id where m.user_id=$1 order by t.updated_at desc`,
      [userId],
    );
    return result.rows.map(serializeTeam);
  }

  async createTeam(userId: string, input: TeamCreateInput) {
    return inTransaction(this.pool, async (client) => {
      const created = await client.query(
        "insert into teams(name,owner_id) values($1,$2) returning *",
        [input.name, userId],
      );
      await client.query(
        "insert into team_members(team_id,user_id,role) values($1,$2,'owner')",
        [created.rows[0].id, userId],
      );
      await audit(client, userId, "team.create", "team", created.rows[0].id);
      return serializeTeam({ ...created.rows[0], role: "owner" });
    });
  }

  async listTeamMembers(teamId: string, userId: string) {
    await this.requireTeamMember(teamId, userId);
    const result = await this.pool.query(
      `select m.user_id,u.email,m.role,m.created_at from team_members m join users u on u.id=m.user_id
       where m.team_id=$1 order by m.created_at`,
      [teamId],
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      role: row.role,
      createdAt: iso(row.created_at),
    }));
  }

  async addTeamMember(teamId: string, userId: string, input: TeamMemberInput) {
    await this.requireTeamOwner(teamId, userId);
    return inTransaction(this.pool, async (client) => {
      const target = await client.query(
        "select id,email from users where lower(email)=lower($1)",
        [input.email],
      );
      if (!target.rows[0])
        throw new DomainError("TEAM_USER_NOT_FOUND", "该用户尚未注册", 404);
      const result = await client.query(
        `insert into team_members(team_id,user_id,role) values($1,$2,$3)
         on conflict(team_id,user_id) do update set role=excluded.role returning user_id,role,created_at`,
        [teamId, target.rows[0].id, input.role],
      );
      await client.query(
        `insert into project_members(project_id,user_id,role)
         select tp.project_id,$2,case when $3='viewer' then 'viewer' else 'editor' end from team_projects tp where tp.team_id=$1
         on conflict(project_id,user_id) do update set role=case when project_members.role='owner' then 'owner' else excluded.role end`,
        [teamId, target.rows[0].id, input.role],
      );
      await audit(
        client,
        userId,
        "team.member.upsert",
        "user",
        target.rows[0].id,
        { teamId, role: input.role },
      );
      return {
        userId: result.rows[0].user_id,
        email: target.rows[0].email,
        role: result.rows[0].role,
        createdAt: iso(result.rows[0].created_at),
      };
    });
  }

  async attachTeamProject(teamId: string, userId: string, projectId: string) {
    await this.requireTeamOwner(teamId, userId);
    const project = await this.pool.query(
      "select 1 from projects where id=$1 and owner_id=$2 and deleted_at is null",
      [projectId, userId],
    );
    if (!project.rowCount)
      throw new DomainError(
        "PROJECT_FORBIDDEN",
        "只有项目所有者可以加入团队",
        403,
      );
    return inTransaction(this.pool, async (client) => {
      const existing = await client.query(
        "select team_id from team_projects where project_id=$1 for update",
        [projectId],
      );
      if (existing.rows[0] && existing.rows[0].team_id !== teamId)
        throw new DomainError(
          "PROJECT_ALREADY_IN_TEAM",
          "项目已属于另一个团队，请先完成成员交接",
          409,
        );
      await client.query(
        "insert into team_projects(team_id,project_id) values($1,$2) on conflict(project_id) do nothing",
        [teamId, projectId],
      );
      await client.query(
        `insert into project_members(project_id,user_id,role)
         select $2,user_id,case when role='viewer' then 'viewer' else 'editor' end from team_members where team_id=$1
         on conflict(project_id,user_id) do update set role=case when project_members.role='owner' then 'owner' else excluded.role end`,
        [teamId, projectId],
      );
      await audit(client, userId, "team.project.attach", "project", projectId, {
        teamId,
      });
      return { teamId, projectId };
    });
  }

  async adminOverview(userId: string) {
    await this.requireAdmin(userId);
    const result = await this.pool.query(
      `select
        (select count(*)::int from users) users,
        (select count(*)::int from projects where deleted_at is null) projects,
        (select count(*)::int from assets where status='active') assets,
        (select coalesce(sum(bytes),0)::bigint from asset_versions) asset_bytes,
        (select count(*)::int from generation_jobs where status not in ('completed','failed','cancelled')) active_jobs,
        (select count(*)::int from generation_jobs where status='failed') failed_jobs,
        (select count(*)::int from composition_jobs where status not in ('completed','failed','cancelled')) active_compositions,
        (select count(*)::int from composition_jobs where status='failed') failed_compositions,
        (select count(*)::int from generation_jobs) total_jobs,
        (select count(*)::int from generation_jobs where status='completed') completed_jobs`,
    );
    const row = result.rows[0];
    return {
      users: row.users,
      projects: row.projects,
      assets: row.assets,
      assetBytes: Number(row.asset_bytes),
      activeJobs: row.active_jobs,
      failedJobs: row.failed_jobs,
      activeCompositions: row.active_compositions,
      failedCompositions: row.failed_compositions,
      totalJobs: row.total_jobs,
      successRate: row.total_jobs ? row.completed_jobs / row.total_jobs : 0,
      usage: await this.usageSummary(),
      trends: await this.adminTrends(),
    };
  }

  async adminFailures(userId: string) {
    await this.requireAdmin(userId);
    const result = await this.pool.query(
      `select id,'generation' kind,status,user_error_code error_code,user_error_message error_message,retryable,updated_at from generation_jobs where status='failed'
       union all select id,'composition' kind,status,error_code,error_message,retryable,updated_at from composition_jobs where status='failed'
       order by updated_at desc limit 100`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      error: {
        code: row.error_code,
        message: sanitizeError(row.error_message) || "任务失败",
        retryable: row.retryable,
      },
      updatedAt: iso(row.updated_at),
    }));
  }

  async adminModels(userId: string) {
    await this.requireAdmin(userId);
    const result = await this.pool.query(
      `select id,display_name,capability,enabled,healthy,discovered,checked_at,updated_at
       from model_catalog order by capability,display_name`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      capability: row.capability,
      enabled: row.enabled,
      healthy: row.healthy,
      discovered: row.discovered,
      checkedAt: iso(row.checked_at),
      updatedAt: iso(row.updated_at),
    }));
  }

  async adminUsers(userId: string, query: AdminListQuery) {
    await this.requireAdmin(userId);
    const filters: string[] = [];
    const values: unknown[] = [];
    if (query.q) {
      values.push(`%${query.q.toLowerCase()}%`);
      filters.push(`lower(u.email) like $${values.length}`);
    }
    if (query.status) {
      values.push(query.status);
      filters.push(`u.account_status=$${values.length}`);
    }
    if (query.isAdmin !== undefined) {
      values.push(query.isAdmin);
      filters.push(`u.is_admin=$${values.length}`);
    }
    if (query.createdFrom) {
      values.push(query.createdFrom);
      filters.push(`u.created_at >= $${values.length}::timestamptz`);
    }
    if (query.createdTo) {
      values.push(query.createdTo);
      filters.push(
        `u.created_at < $${values.length}::timestamptz + interval '1 day'`,
      );
    }
    const where = filters.length ? `where ${filters.join(" and ")}` : "";
    const count = await this.pool.query(
      `select count(*)::int total from users u ${where}`,
      values,
    );
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const rows = await this.pool.query(
      `select u.id,u.email,u.is_admin,u.account_status,u.disabled_reason,u.disabled_at,u.created_at,u.last_login_at,
        (select count(*)::int from projects p where p.owner_id=u.id and p.deleted_at is null) project_count,
        (select count(*)::int from generation_jobs j where j.created_by=u.id) job_count,
        (select coalesce(sum(v.bytes),0)::bigint from asset_versions v where v.created_by=u.id) storage_bytes,
        (select count(*)::int from sessions s where s.user_id=u.id and s.expires_at>now()) active_sessions,
        (select coalesce(jsonb_object_agg(x.currency,x.amount),'{}'::jsonb) from
          (select coalesce(gu.currency,'UNKNOWN') currency,sum(coalesce(gu.total_amount,gu.amount_final,0))::text amount
           from generation_usage gu where gu.user_id=u.id group by coalesce(gu.currency,'UNKNOWN')) x) usage_amounts
       from users u ${where} order by u.created_at desc limit $${values.length - 1} offset $${values.length}`,
      values,
    );
    return {
      items: rows.rows.map(serializeAdminUser),
      total: count.rows[0].total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async adminUser(userId: string, targetUserId: string) {
    await this.requireAdmin(userId);
    const user = await this.pool.query(
      `select u.id,u.email,u.is_admin,u.account_status,u.disabled_reason,u.disabled_at,u.created_at,u.last_login_at,
        (select count(*)::int from projects p where p.owner_id=u.id and p.deleted_at is null) project_count,
        (select count(*)::int from generation_jobs j where j.created_by=u.id) job_count,
        (select coalesce(sum(v.bytes),0)::bigint from asset_versions v where v.created_by=u.id) storage_bytes,
        (select count(*)::int from sessions s where s.user_id=u.id and s.expires_at>now()) active_sessions,
        (select coalesce(jsonb_object_agg(x.currency,x.amount),'{}'::jsonb) from
          (select coalesce(gu.currency,'UNKNOWN') currency,sum(coalesce(gu.total_amount,gu.amount_final,0))::text amount
           from generation_usage gu where gu.user_id=u.id group by coalesce(gu.currency,'UNKNOWN')) x) usage_amounts
       from users u where u.id=$1`,
      [targetUserId],
    );
    if (!user.rows[0])
      throw new DomainError("ADMIN_USER_NOT_FOUND", "用户不存在", 404);
    const projects = await this.pool.query(
      `select p.id,p.name,p.description,p.created_at,p.updated_at,
        (select count(*)::int from generation_jobs j where j.project_id=p.id) job_count,
        (select count(*)::int from assets a where a.project_id=p.id and a.status='active') asset_count
       from projects p where p.owner_id=$1 and p.deleted_at is null order by p.updated_at desc limit 100`,
      [targetUserId],
    );
    return {
      user: serializeAdminUser(user.rows[0]),
      projects: projects.rows.map(serializeProject),
      usage: await this.usageSummary(targetUserId),
      usageBreakdowns: await this.usageBreakdowns(targetUserId),
    };
  }

  async setUserStatus(
    actorId: string,
    targetUserId: string,
    status: "active" | "disabled",
    reason: string | undefined,
    requestId: string,
  ) {
    await this.requireAdmin(actorId);
    await this.assertMutableAdminTarget(
      actorId,
      targetUserId,
      status === "disabled",
    );
    return inTransaction(this.pool, async (client) => {
      const result = await client.query(
        `update users set account_status=$2,disabled_reason=case when $2='disabled' then $3 else null end,
          disabled_at=case when $2='disabled' then now() else null end,disabled_by=case when $2='disabled' then $4 else null end,updated_at=now()
         where id=$1 returning id,email,is_admin,account_status,disabled_reason,disabled_at,created_at,last_login_at`,
        [targetUserId, status, reason || null, actorId],
      );
      if (!result.rows[0])
        throw new DomainError("ADMIN_USER_NOT_FOUND", "用户不存在", 404);
      if (status === "disabled")
        await client.query("delete from sessions where user_id=$1", [
          targetUserId,
        ]);
      await audit(
        client,
        actorId,
        `user.${status}`,
        "user",
        targetUserId,
        { reason: reason || null },
        requestId,
      );
      return serializeAdminUser(result.rows[0]);
    });
  }

  async revokeUserSessions(
    actorId: string,
    targetUserId: string,
    requestId: string,
  ) {
    await this.requireAdmin(actorId);
    if (actorId === targetUserId)
      throw new DomainError(
        "ADMIN_SELF_PROTECTED",
        "不能强制下线当前管理员",
        409,
      );
    await this.assertMutableAdminTarget(actorId, targetUserId, false);
    return inTransaction(this.pool, async (client) => {
      const result = await client.query(
        "delete from sessions where user_id=$1",
        [targetUserId],
      );
      await audit(
        client,
        actorId,
        "user.sessions.revoke",
        "user",
        targetUserId,
        { revoked: result.rowCount || 0 },
        requestId,
      );
      return { revoked: result.rowCount || 0 };
    });
  }

  async setUserAdmin(
    actorId: string,
    targetUserId: string,
    isAdmin: boolean,
    requestId: string,
  ) {
    await this.requireAdmin(actorId);
    await this.assertMutableAdminTarget(actorId, targetUserId, !isAdmin);
    return inTransaction(this.pool, async (client) => {
      const result = await client.query(
        "update users set is_admin=$2,updated_at=now() where id=$1 returning id,email,is_admin,account_status,disabled_reason,disabled_at,created_at,last_login_at",
        [targetUserId, isAdmin],
      );
      if (!result.rows[0])
        throw new DomainError("ADMIN_USER_NOT_FOUND", "用户不存在", 404);
      await audit(
        client,
        actorId,
        "user.admin.set",
        "user",
        targetUserId,
        { isAdmin },
        requestId,
      );
      return serializeAdminUser(result.rows[0]);
    });
  }

  async adminUsage(userId: string, query: AdminListQuery) {
    await this.requireAdmin(userId);
    const { where, values } = adminUsageFilters(query, "gu");
    const count = await this.pool.query(
      `select count(*)::int total from generation_usage gu ${where}`,
      values,
    );
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const result = await this.pool.query(
      `select gu.*,u.email,p.name project_name from generation_usage gu join users u on u.id=gu.user_id join projects p on p.id=gu.project_id
       ${where} order by gu.reconciled_at desc limit $${values.length - 1} offset $${values.length}`,
      values,
    );
    return {
      items: result.rows.map(serializeUsage),
      total: count.rows[0].total,
      summary: await this.usageSummary(query.userId),
      breakdowns: await this.usageBreakdowns(query.userId),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async adminJobs(userId: string, query: AdminListQuery) {
    await this.requireAdmin(userId);
    const { where, values } = adminJobFilters(query, "j");
    const count = await this.pool.query(
      `select count(*)::int total from generation_jobs j ${where}`,
      values,
    );
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const result = await this.pool.query(
      `select j.id,j.project_id,j.created_by,j.model_id,j.capability,j.mode,j.status,j.progress,j.retryable,j.user_error_code,
        j.user_error_message,j.provider_error_sanitized,j.provider_job_id,j.retry_of_job_id,j.billing_trace_id,j.billing_status,
        j.billing_error,j.created_at,j.updated_at,j.finished_at,u.email,p.name project_name
       from generation_jobs j join users u on u.id=j.created_by join projects p on p.id=j.project_id ${where}
       order by j.created_at desc limit $${values.length - 1} offset $${values.length}`,
      values,
    );
    return {
      items: result.rows.map(serializeAdminJob),
      total: count.rows[0].total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async adminAuditLogs(userId: string, query: AdminListQuery) {
    await this.requireAdmin(userId);
    const values: unknown[] = [];
    const filter = query.q
      ? (values.push(`%${query.q.toLowerCase()}%`),
        `where lower(coalesce(u.email,'')||' '||l.action||' '||coalesce(l.target_id,'')) like $1`)
      : "";
    const count = await this.pool.query(
      `select count(*)::int total from admin_audit_logs l left join users u on u.id=l.actor_user_id ${filter}`,
      values,
    );
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const result = await this.pool.query(
      `select l.id,l.action,l.target_type,l.target_id,l.request_id,l.metadata,l.created_at,u.email actor_email
       from admin_audit_logs l left join users u on u.id=l.actor_user_id ${filter} order by l.id desc limit $${values.length - 1} offset $${values.length}`,
      values,
    );
    return {
      items: result.rows.map((row) => ({
        id: Number(row.id),
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        requestId: row.request_id,
        metadata: row.metadata,
        actorEmail: row.actor_email,
        createdAt: iso(row.created_at),
      })),
      total: count.rows[0].total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async adminProjectContent(
    userId: string,
    projectId: string,
    requestId: string,
  ) {
    await this.requireAdmin(userId);
    const project = await this.pool.query(
      "select id,name,description,owner_id,created_at,updated_at from projects where id=$1 and deleted_at is null",
      [projectId],
    );
    if (!project.rows[0])
      throw new DomainError("PROJECT_NOT_FOUND", "项目不存在", 404);
    const [canvas, assets, conversations] = await Promise.all([
      this.pool.query(
        `select c.id,c.revision,c.updated_at,
        coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'type',n.node_type,'title',n.label,'status',n.status,'data',n.data,'createdAt',n.created_at)) from canvas_nodes n where n.project_id=c.project_id),'[]'::jsonb) nodes
        from canvases c where c.project_id=$1`,
        [projectId],
      ),
      this.pool.query(
        `select a.id,a.kind,a.name,a.status,a.current_version_id,a.created_at,v.mime_type,v.bytes
        from assets a left join asset_versions v on v.id=a.current_version_id where a.project_id=$1 order by a.created_at desc limit 200`,
        [projectId],
      ),
      this.pool.query(
        `select tc.id,tc.title,tc.mode,tc.created_at,tc.updated_at,
        (select count(*)::int from text_messages tm where tm.conversation_id=tc.id) message_count,
        coalesce((select jsonb_agg(jsonb_build_object('id',tm.id,'role',tm.role,'content',tm.content,'status',tm.status,
          'modelId',tm.model_id,'createdAt',tm.created_at) order by tm.created_at)
          from text_messages tm where tm.conversation_id=tc.id),'[]'::jsonb) messages
        from text_conversations tc where tc.project_id=$1 order by tc.updated_at desc limit 100`,
        [projectId],
      ),
    ]);
    await this.auditDirect(
      userId,
      "project.content.view",
      "project",
      projectId,
      {},
      requestId,
    );
    return {
      project: serializeProject(project.rows[0]),
      canvases: canvas.rows.map((row) => ({
        id: row.id,
        revision: row.revision,
        updatedAt: iso(row.updated_at),
        nodes: row.nodes || [],
      })),
      assets: assets.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        name: row.name,
        status: row.status,
        currentVersionId: row.current_version_id,
        mimeType: row.mime_type,
        bytes: Number(row.bytes || 0),
        createdAt: iso(row.created_at),
      })),
      conversations: conversations.rows.map((row) => ({
        id: row.id,
        title: row.title,
        mode: row.mode,
        messageCount: row.message_count,
        messages: row.messages,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
      })),
    };
  }

  async reconcileUsage(userId: string, jobId: string, requestId: string) {
    await this.requireAdmin(userId);
    if (!this.billing)
      throw new DomainError("BILLING_UNAVAILABLE", "账单服务未配置", 503, true);
    const result = await this.billing.reconcileJob(jobId, true);
    await this.auditDirect(
      userId,
      "billing.reconcile",
      "generation_job",
      jobId,
      { result },
      requestId,
    );
    return result;
  }

  async auditAdminAccess(
    userId: string,
    action: string,
    targetType: string,
    targetId: string,
    requestId: string,
  ) {
    await this.requireAdmin(userId);
    await this.auditDirect(userId, action, targetType, targetId, {}, requestId);
  }

  private async usageSummary(userId?: string) {
    const result = await this.pool.query(
      `select coalesce(currency,'UNKNOWN') currency,count(*)::int calls,
        coalesce(sum(total_tokens),0)::bigint total_tokens,
        coalesce(sum(generated_images),0)::bigint generated_images,
        coalesce(sum(video_duration_seconds),0)::text video_duration_seconds,
        coalesce(sum(audio_duration_seconds),0)::text audio_duration_seconds,
        coalesce(sum(coalesce(total_amount,amount_final,0)),0)::text total_amount
       from generation_usage where ($1::uuid is null or user_id=$1) group by coalesce(currency,'UNKNOWN') order by currency`,
      [userId || null],
    );
    return result.rows.map((row) => ({
      currency: row.currency,
      calls: row.calls,
      totalTokens: String(row.total_tokens),
      generatedImages: String(row.generated_images),
      videoDurationSeconds: row.video_duration_seconds,
      audioDurationSeconds: row.audio_duration_seconds,
      totalAmount: row.total_amount,
    }));
  }

  private async adminTrends() {
    const result = await this.pool.query(
      `with days as (select generate_series(current_date-29,current_date,interval '1 day')::date as day)
       select d.day::text,
        (select count(*)::int from users u where u.created_at>=d.day and u.created_at<d.day+1) new_users,
        (select count(*)::int from generation_jobs j where j.created_at>=d.day and j.created_at<d.day+1) jobs,
        (select count(*)::int from generation_jobs j where j.status='completed' and j.created_at>=d.day and j.created_at<d.day+1) completed_jobs
       from days d order by d.day`,
    );
    return result.rows.map((row) => ({
      day: row.day,
      newUsers: row.new_users,
      jobs: row.jobs,
      completedJobs: row.completed_jobs,
    }));
  }

  private async usageBreakdowns(userId?: string) {
    const dimensions = {
      model: "gu.model_id",
      project: "p.id::text||' · '||p.name",
      capability: "gu.capability",
      day: "gu.reconciled_at::date::text",
    } as const;
    const entries = await Promise.all(
      Object.entries(dimensions).map(async ([name, expression]) => {
        const result = await this.pool.query(
          `select ${expression} key,coalesce(gu.currency,'UNKNOWN') currency,count(*)::int calls,
            coalesce(sum(gu.total_tokens),0)::text total_tokens,
            coalesce(sum(coalesce(gu.total_amount,gu.amount_final,0)),0)::text total_amount
           from generation_usage gu join projects p on p.id=gu.project_id
           where ($1::uuid is null or gu.user_id=$1)
           group by ${expression},coalesce(gu.currency,'UNKNOWN') order by sum(coalesce(gu.total_amount,gu.amount_final,0)) desc limit 100`,
          [userId || null],
        );
        return [
          name,
          result.rows.map((row) => ({
            key: row.key,
            currency: row.currency,
            calls: row.calls,
            totalTokens: row.total_tokens,
            totalAmount: row.total_amount,
          })),
        ];
      }),
    );
    return Object.fromEntries(entries);
  }

  private async assertMutableAdminTarget(
    actorId: string,
    targetUserId: string,
    destructive: boolean,
  ) {
    if (actorId === targetUserId && destructive)
      throw new DomainError(
        "ADMIN_SELF_PROTECTED",
        "不能停用或降级当前管理员",
        409,
      );
    const result = await this.pool.query(
      "select email from users where id=$1",
      [targetUserId],
    );
    if (!result.rows[0])
      throw new DomainError("ADMIN_USER_NOT_FOUND", "用户不存在", 404);
    if (
      destructive &&
      this.config.adminEmails.includes(
        String(result.rows[0].email).toLowerCase(),
      )
    )
      throw new DomainError(
        "ADMIN_CONFIG_PROTECTED",
        "配置文件管理员不能被停用或降级",
        409,
      );
  }

  private async auditDirect(
    actorId: string,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, unknown>,
    requestId: string,
  ) {
    await this.pool.query(
      "insert into admin_audit_logs(actor_user_id,action,target_type,target_id,request_id,metadata) values($1,$2,$3,$4,$5,$6)",
      [actorId, action, targetType, targetId, requestId, metadata],
    );
  }

  private async requireTeamMember(teamId: string, userId: string) {
    const result = await this.pool.query(
      "select role from team_members where team_id=$1 and user_id=$2",
      [teamId, userId],
    );
    if (!result.rowCount)
      throw new DomainError("TEAM_FORBIDDEN", "无权访问该团队", 403);
    return result.rows[0].role as string;
  }

  private async requireTeamOwner(teamId: string, userId: string) {
    const role = await this.requireTeamMember(teamId, userId);
    if (!["owner", "admin"].includes(role))
      throw new DomainError(
        "TEAM_FORBIDDEN",
        "只有团队管理员可以执行该操作",
        403,
      );
  }

  private async requireAdmin(userId: string) {
    const result = await this.pool.query(
      "select email,is_admin from users where id=$1",
      [userId],
    );
    const row = result.rows[0];
    if (
      !row ||
      (!row.is_admin &&
        !this.config.adminEmails.includes(String(row.email).toLowerCase()))
    )
      throw new DomainError("ADMIN_FORBIDDEN", "需要管理员权限", 403);
  }
}

function disabled(code: string, message: string) {
  return new DomainError(code, message, 503, false, {
    details: { configured: false },
  });
}
function serializeAccount(row: Record<string, unknown>) {
  return {
    id: row.id,
    userId: row.user_id,
    balance: Number(row.balance),
    reserved: Number(row.reserved),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
function serializeLedger(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    type: row.entry_type,
    delta: Number(row.delta),
    balanceAfter: Number(row.balance_after),
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    metadata: row.metadata,
    createdAt: iso(row.created_at),
  };
}
function serializeTeam(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    role: row.role,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : value;
}
function sanitizeError(value: unknown) {
  return String(value || "")
    .replace(/(bearer\s+|sk-)[a-z0-9._-]+/gi, "$1***")
    .replace(
      /((?:api[_-]?key|token|authorization)\s*[:=]\s*)["']?[^\s,"'}]+/gi,
      "$1***",
    )
    .replace(/([?&](?:api[_-]?key|token)=)[^&\s]+/gi, "$1***")
    .slice(0, 1_000);
}
async function inTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function audit(
  client: PoolClient,
  actorUserId: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown> = {},
  requestId?: string,
) {
  await client.query(
    "insert into admin_audit_logs(actor_user_id,action,target_type,target_id,request_id,metadata) values($1,$2,$3,$4,$5,$6)",
    [actorUserId, action, targetType, targetId, requestId || null, metadata],
  );
}

function serializeAdminUser(row: Record<string, unknown>) {
  return {
    id: row.id,
    email: row.email,
    isAdmin: Boolean(row.is_admin),
    status: row.account_status,
    disabledReason: row.disabled_reason,
    disabledAt: iso(row.disabled_at),
    createdAt: iso(row.created_at),
    lastLoginAt: iso(row.last_login_at),
    projectCount: Number(row.project_count || 0),
    jobCount: Number(row.job_count || 0),
    storageBytes: Number(row.storage_bytes || 0),
    activeSessions: Number(row.active_sessions || 0),
    usageAmounts: row.usage_amounts || {},
  };
}

function serializeProject(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ownerId: row.owner_id,
    jobCount: Number(row.job_count || 0),
    assetCount: Number(row.asset_count || 0),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function serializeUsage(row: Record<string, unknown>) {
  const money = (value: unknown) =>
    value === null || value === undefined ? null : String(value);
  return {
    jobId: row.job_id,
    projectId: row.project_id,
    projectName: row.project_name,
    userId: row.user_id,
    userEmail: row.email,
    billingRequestId: row.billing_request_id,
    provider: row.provider,
    modelId: row.model_id,
    capability: row.capability,
    status: row.status,
    billed: row.billed,
    promptTokens: row.prompt_tokens === null ? null : String(row.prompt_tokens),
    completionTokens:
      row.completion_tokens === null ? null : String(row.completion_tokens),
    totalTokens: row.total_tokens === null ? null : String(row.total_tokens),
    generatedImages: row.generated_images,
    videoDurationSeconds: money(row.video_duration_seconds),
    audioDurationSeconds: money(row.audio_duration_seconds),
    totalAmount: money(row.total_amount ?? row.amount_final),
    walletAmount: money(row.wallet_amount),
    voucherAmount: money(row.voucher_amount),
    currency: row.currency,
    providerRequestId: row.provider_request_id,
    reconciledAt: iso(row.reconciled_at),
  };
}

function serializeAdminJob(row: Record<string, unknown>) {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    userId: row.created_by,
    userEmail: row.email,
    modelId: row.model_id,
    capability: row.capability,
    mode: row.mode,
    status: row.status,
    progress: row.progress,
    retryable: row.retryable,
    error: row.user_error_code
      ? {
          code: row.user_error_code,
          message: sanitizeError(row.user_error_message) || "任务失败",
          details: sanitizeError(
            JSON.stringify(row.provider_error_sanitized || {}),
          ),
        }
      : null,
    providerJobId: row.provider_job_id,
    retryOfJobId: row.retry_of_job_id,
    billingTraceId: row.billing_trace_id,
    billingStatus: row.billing_status,
    billingError: sanitizeError(row.billing_error || ""),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    finishedAt: iso(row.finished_at),
  };
}

function adminUsageFilters(query: AdminListQuery, alias: string) {
  const filters: string[] = [];
  const values: unknown[] = [];
  for (const [value, column] of [
    [query.userId, "user_id"],
    [query.projectId, "project_id"],
    [query.modelId, "model_id"],
    [query.capability, "capability"],
  ] as const) {
    if (value) {
      values.push(value);
      filters.push(`${alias}.${column}=$${values.length}`);
    }
  }
  if (query.status) {
    values.push(query.status);
    filters.push(`${alias}.status=$${values.length}`);
  }
  return {
    where: filters.length ? `where ${filters.join(" and ")}` : "",
    values,
  };
}

function adminJobFilters(query: AdminListQuery, alias: string) {
  const filters: string[] = [];
  const values: unknown[] = [];
  for (const [value, column] of [
    [query.userId, "created_by"],
    [query.projectId, "project_id"],
    [query.modelId, "model_id"],
    [query.capability, "capability"],
    [query.status, "status"],
  ] as const) {
    if (value) {
      values.push(value);
      filters.push(`${alias}.${column}=$${values.length}`);
    }
  }
  if (query.q) {
    values.push(`%${query.q.toLowerCase()}%`);
    filters.push(
      `lower(${alias}.id::text||' '||coalesce(${alias}.provider_job_id,'')||' '||coalesce(${alias}.billing_trace_id,'')) like $${values.length}`,
    );
  }
  return {
    where: filters.length ? `where ${filters.join(" and ")}` : "",
    values,
  };
}
