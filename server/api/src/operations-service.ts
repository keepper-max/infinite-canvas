import type { Pool, PoolClient } from "pg";

import type { OperationsConfig } from "./config.js";
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
}

export class OperationsService implements OperationsServicePort {
  constructor(
    private readonly pool: Pool,
    private readonly config: OperationsConfig,
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
      "select 1 from projects where id=$1 and owner_id=$2",
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
        (select count(*)::int from projects) projects,
        (select count(*)::int from assets where status='active') assets,
        (select coalesce(sum(bytes),0)::bigint from asset_versions) asset_bytes,
        (select count(*)::int from generation_jobs where status not in ('completed','failed','cancelled')) active_jobs,
        (select count(*)::int from generation_jobs where status='failed') failed_jobs,
        (select count(*)::int from composition_jobs where status not in ('completed','failed','cancelled')) active_compositions,
        (select count(*)::int from composition_jobs where status='failed') failed_compositions`,
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
        message: sanitizeError(row.error_message),
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
  return String(value || "任务失败")
    .replace(/(bearer\s+|sk-)[a-z0-9._-]+/gi, "$1***")
    .replace(/((?:api[_-]?key|token|authorization)\s*[:=]\s*)["']?[^\s,"'}]+/gi, "$1***")
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
) {
  await client.query(
    "insert into admin_audit_logs(actor_user_id,action,target_type,target_id,metadata) values($1,$2,$3,$4,$5)",
    [actorUserId, action, targetType, targetId, metadata],
  );
}
