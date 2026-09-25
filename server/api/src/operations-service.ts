import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import type { OperationsConfig } from "./config.js";
import type { BillingService } from "./billing-service.js";
import type { CreditGrantInput, CreditService } from "./credit-service.js";
import { DomainError } from "./domain.js";
import type { PaymentService } from "./payment-service.js";
import type {
  PaymentOrderInput,
  PaymentPlanInput,
  ProviderBillingRuleInput,
  SmsRequestInput,
  SmsVerifyInput,
  TeamCreateInput,
  TeamMemberInput,
} from "./operations-contract.js";

export interface OperationsServicePort {
  capabilities(isAdmin?: boolean): Promise<Record<string, boolean>>;
  account(userId: string): Promise<unknown>;
  creditPricing(userId: string): Promise<unknown>;
  setCreditPricing(
    userId: string,
    usdCnyRate: string,
    requestId: string,
  ): Promise<unknown>;
  grantCredits(
    userId: string,
    targetUserId: string,
    input: CreditGrantInput,
    requestId: string,
  ): Promise<unknown>;
  listActivationCodes(userId: string): Promise<unknown>;
  issueActivationCode(userId: string, credits: number, expiresAt: string, requestId: string): Promise<unknown>;
  redeemActivationCode(userId: string, code: string): Promise<unknown>;
  plans(isAdmin?: boolean): Promise<unknown[]>;
  requestSms(input: SmsRequestInput): Promise<never>;
  verifySms(input: SmsVerifyInput): Promise<never>;
  createPaymentOrder(userId: string, isAdmin: boolean, input: PaymentOrderInput): Promise<unknown>;
  listPaymentOrders(userId: string): Promise<unknown>;
  syncPaymentOrder(userId: string, orderId: string): Promise<unknown>;
  receivePaymentCallback(fields: Record<string, string>): Promise<boolean>;
  adminPaymentOrders(userId: string): Promise<unknown>;
  adminSyncPaymentOrder(userId: string, orderId: string): Promise<unknown>;
  adminPaymentPlans(userId: string): Promise<unknown[]>;
  createAdminPaymentPlan(userId: string, input: PaymentPlanInput, requestId: string): Promise<unknown>;
  updateAdminPaymentPlan(userId: string, planId: string, input: PaymentPlanInput, requestId: string): Promise<unknown>;
  adminPaymentSettings(userId: string): Promise<unknown>;
  setAdminPaymentSettings(userId: string, publicRechargeEnabled: boolean, requestId: string): Promise<unknown>;
  adminBillingRules(userId: string): Promise<unknown[]>;
  createAdminBillingRule(userId: string, input: ProviderBillingRuleInput, requestId: string): Promise<unknown>;
  updateAdminBillingRule(userId: string, ruleKey: string, input: ProviderBillingRuleInput, requestId: string): Promise<unknown>;
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
  adminOverview(userId: string, range?: AdminOverviewRange): Promise<unknown>;
  adminFailures(userId: string): Promise<unknown>;
  adminModels(userId: string, providerId?: string): Promise<unknown>;
  setModelEnabled(
    userId: string,
    modelId: string,
    enabled: boolean,
    requestId: string,
  ): Promise<unknown>;
  adminProviders(userId: string): Promise<unknown>;
  setManagedProvider(
    userId: string,
    providerId: "token360" | "runninghub" | "runninghub_global",
    requestId: string,
  ): Promise<unknown>;
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

export type AdminOverviewRange = {
  dateFrom?: string;
  dateTo?: string;
};

export class OperationsService implements OperationsServicePort {
  constructor(
    private readonly pool: Pool,
    private readonly config: OperationsConfig,
    private readonly billing?: BillingService,
    private readonly credits?: CreditService,
    private readonly providerAvailability: Record<string, boolean> = {},
    private readonly payments?: PaymentService,
  ) {}

  async capabilities(isAdmin = false) {
    const publicRechargeEnabled = await this.payments?.publicRechargeEnabled();
    return {
      sms: false,
      credits: Boolean(this.credits),
      payments: Boolean(this.payments?.enabled() && (publicRechargeEnabled || isAdmin)),
      teams: true,
      admin: true,
    };
  }

  async account(userId: string) {
    if (this.credits) return this.credits.account(userId);
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

  async creditPricing(userId: string) {
    await this.requireAdmin(userId);
    return this.requireCredits().pricing();
  }

  async setCreditPricing(
    userId: string,
    usdCnyRate: string,
    requestId: string,
  ) {
    await this.requireAdmin(userId);
    return this.requireCredits().setUsdCnyRate(userId, usdCnyRate, requestId);
  }

  async grantCredits(
    userId: string,
    targetUserId: string,
    input: CreditGrantInput,
    requestId: string,
  ) {
    await this.requireAdmin(userId);
    return this.requireCredits().grant(userId, targetUserId, input, requestId);
  }

  async listActivationCodes(userId: string) {
    await this.requireAdmin(userId);
    return this.requireCredits().listActivationCodes(userId);
  }

  async issueActivationCode(userId: string, credits: number, expiresAt: string, requestId: string) {
    await this.requireAdmin(userId);
    return this.requireCredits().issueActivationCode(userId, credits, expiresAt, requestId);
  }

  async redeemActivationCode(userId: string, code: string) {
    return this.requireCredits().redeemActivationCode(userId, code);
  }

  async plans(isAdmin = false) {
    const result = await this.pool.query(
      `select id,name,credits,price_cents,currency,enabled,metadata from billing_plans
       where enabled=true and (coalesce(metadata->>'adminOnly','false')<>'true' or $1)
       order by price_cents,id`,
      [isAdmin],
    );
    return result.rows.map(serializeBillingPlan);
  }

  async requestSms(_input: SmsRequestInput): Promise<never> {
    throw disabled("SMS_DISABLED", "短信服务尚未启用");
  }

  async verifySms(_input: SmsVerifyInput): Promise<never> {
    throw disabled("SMS_DISABLED", "短信服务尚未启用");
  }

  async createPaymentOrder(
    userId: string,
    isAdmin: boolean,
    input: PaymentOrderInput,
  ) {
    return this.requirePayments().createOrder(userId, isAdmin, input);
  }

  async listPaymentOrders(userId: string) {
    return this.requirePayments().listOrders(userId);
  }

  async syncPaymentOrder(userId: string, orderId: string) {
    return this.requirePayments().syncOrder(orderId, userId);
  }

  async receivePaymentCallback(fields: Record<string, string>) {
    return this.requirePayments().receiveNotify(fields);
  }

  async adminPaymentOrders(userId: string) {
    await this.requireAdmin(userId);
    return this.requirePayments().listAdminOrders();
  }

  async adminSyncPaymentOrder(userId: string, orderId: string) {
    await this.requireAdmin(userId);
    return this.requirePayments().syncOrder(orderId);
  }

  async adminPaymentPlans(userId: string) {
    await this.requireAdmin(userId);
    const result = await this.pool.query(
      `select id,name,credits,price_cents,currency,enabled,metadata,created_at,updated_at
       from billing_plans
       where metadata->>'paymentProvider'='alipay'
         and coalesce(metadata->>'experimental','false')<>'true'
       order by enabled desc,price_cents,id`,
    );
    return result.rows.map(serializeBillingPlan);
  }

  async createAdminPaymentPlan(
    userId: string,
    input: PaymentPlanInput,
    requestId: string,
  ) {
    await this.requireAdmin(userId);
    return inTransaction(this.pool, async (client) => {
      const created = await client.query(
        `insert into billing_plans(id,name,credits,price_cents,currency,enabled,metadata)
         values($1,$2,$3,$4,'CNY',$5,$6)
         returning id,name,credits,price_cents,currency,enabled,metadata,created_at,updated_at`,
        [
          `alipay-plan-${randomUUID()}`,
          input.name,
          input.credits,
          input.priceCents,
          input.enabled,
          { paymentProvider: "alipay", managedBy: "admin" },
        ],
      );
      const plan = serializeBillingPlan(created.rows[0]);
      await audit(client, userId, "payment.plan.create", "billing_plan", String(plan.id), { next: plan }, requestId);
      return plan;
    });
  }

  async updateAdminPaymentPlan(
    userId: string,
    planId: string,
    input: PaymentPlanInput,
    requestId: string,
  ) {
    await this.requireAdmin(userId);
    return inTransaction(this.pool, async (client) => {
      const existing = await client.query(
        `select id,name,credits,price_cents,currency,enabled,metadata,created_at,updated_at
         from billing_plans where id=$1 for update`,
        [planId],
      );
      const row = existing.rows[0];
      if (!row || row.metadata?.paymentProvider !== "alipay")
        throw new DomainError("PAYMENT_PLAN_NOT_FOUND", "充值套餐不存在", 404);
      if (row.metadata?.experimental === true)
        throw new DomainError("PAYMENT_PLAN_LOCKED", "验收套餐已锁定，不能修改", 409);
      const previous = serializeBillingPlan(row);
      const updated = await client.query(
        `update billing_plans
         set name=$2,credits=$3,price_cents=$4,enabled=$5,updated_at=now()
         where id=$1
         returning id,name,credits,price_cents,currency,enabled,metadata,created_at,updated_at`,
        [planId, input.name, input.credits, input.priceCents, input.enabled],
      );
      const plan = serializeBillingPlan(updated.rows[0]);
      await audit(client, userId, "payment.plan.update", "billing_plan", planId, { previous, next: plan }, requestId);
      return plan;
    });
  }

  async adminPaymentSettings(userId: string) {
    await this.requireAdmin(userId);
    const balances = await this.pool.query(
      `select coalesce(sum(greatest(balance,0)),0)::text total_credits,
        (coalesce(sum(greatest(balance,0)),0)::numeric/120)::text provider_reserve_cny
       from credit_accounts`,
    );
    const row = balances.rows[0];
    return {
      publicRechargeEnabled: await this.requirePayments().publicRechargeEnabled(),
      totalUserCredits: String(row.total_credits),
      providerReserveCny: String(row.provider_reserve_cny),
      pointsPerProviderCny: 120,
    };
  }

  async setAdminPaymentSettings(
    userId: string,
    publicRechargeEnabled: boolean,
    requestId: string,
  ) {
    await this.requireAdmin(userId);
    return inTransaction(this.pool, async (client) => {
      const previous = await client.query(
        "select value from platform_settings where key='payment_access' for update",
      );
      await client.query(
        `insert into platform_settings(key,value,updated_by) values('payment_access',$1,$2)
         on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=now()`,
        [JSON.stringify({ publicRechargeEnabled }), userId],
      );
      await audit(
        client,
        userId,
        "payment.access.update",
        "platform_setting",
        "payment_access",
        {
          previous: previous.rows[0]?.value || null,
          next: { publicRechargeEnabled },
        },
        requestId,
      );
      const balances = await client.query(
        `select coalesce(sum(greatest(balance,0)),0)::text total_credits,
          (coalesce(sum(greatest(balance,0)),0)::numeric/120)::text provider_reserve_cny
         from credit_accounts`,
      );
      return {
        publicRechargeEnabled,
        totalUserCredits: String(balances.rows[0].total_credits),
        providerReserveCny: String(balances.rows[0].provider_reserve_cny),
        pointsPerProviderCny: 120,
      };
    });
  }

  async adminBillingRules(userId: string) {
    await this.requireAdmin(userId);
    const result = await this.pool.query(
      `select distinct on(rule_key) id,rule_key,version,provider,model_pattern,match_type,
        discount_rate::text,priority,enabled,note,created_at
       from provider_billing_rules order by rule_key,version desc`,
    );
    return result.rows.map(serializeProviderBillingRule);
  }

  async createAdminBillingRule(
    userId: string,
    input: ProviderBillingRuleInput,
    requestId: string,
  ) {
    await this.requireAdmin(userId);
    return inTransaction(this.pool, async (client) => {
      const ruleKey = `provider-billing-${randomUUID()}`;
      const created = await client.query(
        `insert into provider_billing_rules(rule_key,version,provider,model_pattern,match_type,discount_rate,priority,enabled,note,created_by)
         values($1,1,$2,$3,$4,$5,$6,$7,$8,$9)
         returning id,rule_key,version,provider,model_pattern,match_type,discount_rate::text,priority,enabled,note,created_at`,
        [ruleKey, input.provider, input.modelPattern, input.matchType, input.discountRate, input.priority, input.enabled, input.note, userId],
      );
      const rule = serializeProviderBillingRule(created.rows[0]);
      await audit(client, userId, "billing.rule.create", "provider_billing_rule", ruleKey, { next: rule }, requestId);
      return rule;
    });
  }

  async updateAdminBillingRule(
    userId: string,
    ruleKey: string,
    input: ProviderBillingRuleInput,
    requestId: string,
  ) {
    await this.requireAdmin(userId);
    return inTransaction(this.pool, async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [ruleKey]);
      const existing = await client.query(
        `select id,rule_key,version,provider,model_pattern,match_type,discount_rate::text,priority,enabled,note,created_at
         from provider_billing_rules where rule_key=$1 order by version desc limit 1`,
        [ruleKey],
      );
      if (!existing.rows[0])
        throw new DomainError("BILLING_RULE_NOT_FOUND", "计费规则不存在", 404);
      const previous = serializeProviderBillingRule(existing.rows[0]);
      const created = await client.query(
        `insert into provider_billing_rules(rule_key,version,provider,model_pattern,match_type,discount_rate,priority,enabled,note,created_by)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         returning id,rule_key,version,provider,model_pattern,match_type,discount_rate::text,priority,enabled,note,created_at`,
        [ruleKey, Number(existing.rows[0].version) + 1, input.provider, input.modelPattern, input.matchType, input.discountRate, input.priority, input.enabled, input.note, userId],
      );
      const rule = serializeProviderBillingRule(created.rows[0]);
      await audit(client, userId, "billing.rule.update", "provider_billing_rule", ruleKey, { previous, next: rule }, requestId);
      return rule;
    });
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

  async adminOverview(userId: string, range: AdminOverviewRange = {}) {
    await this.requireAdmin(userId);
    const result = await this.pool.query(
      `select
        coalesce($1::date,current_date-29)::text range_from,
        coalesce($2::date,current_date)::text range_to,
        (select count(*)::int from users) users,
        (select count(*)::int from users where created_at>=now()-interval '24 hours') new_users_24h,
        (select count(*)::int from users where created_at>=now()-interval '7 days') new_users_7d,
        (select count(*)::int from users where created_at>=now()-interval '30 days') new_users_30d,
        (select count(*)::int from users u where u.last_login_at>=now()-interval '24 hours' or exists(select 1 from generation_jobs j where j.created_by=u.id and j.created_at>=now()-interval '24 hours')) active_users_24h,
        (select count(*)::int from users u where u.last_login_at>=now()-interval '7 days' or exists(select 1 from generation_jobs j where j.created_by=u.id and j.created_at>=now()-interval '7 days')) active_users_7d,
        (select count(*)::int from users u where u.last_login_at>=now()-interval '30 days' or exists(select 1 from generation_jobs j where j.created_by=u.id and j.created_at>=now()-interval '30 days')) active_users_30d,
        (select count(*)::int from users where created_at>=coalesce($1::date,current_date-29) and created_at<coalesce($2::date,current_date)+1) new_users_range,
        (select count(*)::int from users u where (u.last_login_at>=coalesce($1::date,current_date-29) and u.last_login_at<coalesce($2::date,current_date)+1) or exists(select 1 from generation_jobs j where j.created_by=u.id and j.created_at>=coalesce($1::date,current_date-29) and j.created_at<coalesce($2::date,current_date)+1)) active_users_range,
        (select count(distinct user_id)::int from sessions where expires_at>now()) active_session_users,
        (select count(*)::int from projects where deleted_at is null) projects,
        (select count(*)::int from assets where status='active') assets,
        (select coalesce(sum(bytes),0)::bigint from asset_versions) asset_bytes,
        (select count(*)::int from generation_jobs where status not in ('completed','failed','cancelled')) active_jobs,
        (select count(*)::int from generation_jobs where status='failed') failed_jobs,
        (select count(*)::int from generation_jobs where created_at>=now()-interval '24 hours') jobs_24h,
        (select count(*)::int from generation_jobs where created_at>=now()-interval '7 days') jobs_7d,
        (select count(*)::int from generation_jobs where created_at>=now()-interval '30 days') jobs_30d,
        (select count(*)::int from generation_jobs where status='failed' and created_at>=now()-interval '24 hours') failed_jobs_24h,
        (select count(*)::int from generation_jobs where status='completed' and created_at>=now()-interval '30 days') completed_jobs_30d,
        (select count(*)::int from generation_jobs where status='failed' and created_at>=now()-interval '30 days') failed_jobs_30d,
        (select coalesce(avg(extract(epoch from (finished_at-coalesce(started_at,created_at)))) filter(where status='completed' and finished_at is not null and created_at>=now()-interval '30 days'),0)::float8 from generation_jobs) avg_completion_seconds_30d,
        (select count(*)::int from generation_jobs where created_at>=coalesce($1::date,current_date-29) and created_at<coalesce($2::date,current_date)+1) jobs_range,
        (select count(*)::int from generation_jobs where status='failed' and created_at>=coalesce($1::date,current_date-29) and created_at<coalesce($2::date,current_date)+1) failed_jobs_range,
        (select count(*)::int from generation_jobs where status='completed' and created_at>=coalesce($1::date,current_date-29) and created_at<coalesce($2::date,current_date)+1) completed_jobs_range,
        (select coalesce(avg(extract(epoch from (finished_at-coalesce(started_at,created_at)))) filter(where status='completed' and finished_at is not null and created_at>=coalesce($1::date,current_date-29) and created_at<coalesce($2::date,current_date)+1),0)::float8 from generation_jobs) avg_completion_seconds_range,
        (select count(*)::int from generation_jobs where billing_status in ('pending','reconciling')) pending_billing_jobs,
        (select count(*)::int from generation_usage where credit_status in ('pending','pending_rate','pending_currency')) pending_credit_charges,
        (select coalesce(-sum(delta) filter(where entry_type='generation' and created_at>=now()-interval '24 hours'),0)::bigint from credit_ledger) credits_consumed_24h,
        (select coalesce(-sum(delta) filter(where entry_type='generation' and created_at>=now()-interval '7 days'),0)::bigint from credit_ledger) credits_consumed_7d,
        (select coalesce(-sum(delta) filter(where entry_type='generation' and created_at>=now()-interval '30 days'),0)::bigint from credit_ledger) credits_consumed_30d,
        (select coalesce(-sum(delta) filter(where entry_type='generation' and created_at>=coalesce($1::date,current_date-29) and created_at<coalesce($2::date,current_date)+1),0)::bigint from credit_ledger) credits_consumed_range,
        (select count(*)::int from composition_jobs where status not in ('completed','failed','cancelled')) active_compositions,
        (select count(*)::int from composition_jobs where status='failed') failed_compositions,
        (select count(*)::int from generation_jobs) total_jobs,
        (select count(*)::int from generation_jobs where status='completed') completed_jobs`,
      [range.dateFrom || null, range.dateTo || null],
    );
    const row = result.rows[0];
    return {
      users: row.users,
      range: { from: row.range_from, to: row.range_to },
      userActivity: {
        new24h: row.new_users_24h,
        new7d: row.new_users_7d,
        new30d: row.new_users_30d,
        active24h: row.active_users_24h,
        active7d: row.active_users_7d,
        active30d: row.active_users_30d,
        newInRange: row.new_users_range,
        activeInRange: row.active_users_range,
        activeSessionUsers: row.active_session_users,
      },
      projects: row.projects,
      assets: row.assets,
      assetBytes: Number(row.asset_bytes),
      activeJobs: row.active_jobs,
      failedJobs: row.failed_jobs,
      activeCompositions: row.active_compositions,
      failedCompositions: row.failed_compositions,
      totalJobs: row.total_jobs,
      successRate: row.total_jobs ? row.completed_jobs / row.total_jobs : 0,
      jobActivity: {
        jobs24h: row.jobs_24h,
        jobs7d: row.jobs_7d,
        jobs30d: row.jobs_30d,
        failed24h: row.failed_jobs_24h,
        successRate30d:
          row.completed_jobs_30d + row.failed_jobs_30d
            ? row.completed_jobs_30d /
              (row.completed_jobs_30d + row.failed_jobs_30d)
            : 0,
        avgCompletionSeconds30d: Number(row.avg_completion_seconds_30d || 0),
        jobsInRange: row.jobs_range,
        failedInRange: row.failed_jobs_range,
        successRateInRange:
          row.completed_jobs_range + row.failed_jobs_range
            ? row.completed_jobs_range /
              (row.completed_jobs_range + row.failed_jobs_range)
            : 0,
        avgCompletionSecondsInRange: Number(row.avg_completion_seconds_range || 0),
      },
      creditActivity: {
        consumed24h: String(row.credits_consumed_24h),
        consumed7d: String(row.credits_consumed_7d),
        consumed30d: String(row.credits_consumed_30d),
        consumedInRange: String(row.credits_consumed_range),
      },
      alerts: {
        pendingBillingJobs: row.pending_billing_jobs,
        pendingCreditCharges: row.pending_credit_charges,
      },
      usage: await this.usageSummary(),
      usage30d: await this.usageSummary(undefined, 30),
      usageRange: await this.usageSummary(undefined, undefined, row.range_from, row.range_to),
      trends: await this.adminTrends(row.range_from, row.range_to),
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

  async adminModels(userId: string, providerId?: string) {
    await this.requireAdmin(userId);
    const result = await this.pool.query(
      `select c.id,c.display_name,c.capability,c.provider_id,c.enabled,c.healthy,c.discovered,c.checked_at,c.updated_at,
        exists(select 1 from model_capabilities p where p.model_id=c.id) configurable
       from model_catalog c where ($1::text is null or c.provider_id=$1) order by c.capability,c.display_name`,
      [providerId || null],
    );
    return result.rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      capability: row.capability,
      providerId: row.provider_id,
      enabled: row.enabled,
      configurable: row.configurable,
      healthy: row.healthy,
      discovered: row.discovered,
      checkedAt: iso(row.checked_at),
      updatedAt: iso(row.updated_at),
    }));
  }

  async setModelEnabled(
    userId: string,
    modelId: string,
    enabled: boolean,
    requestId: string,
  ) {
    await this.requireAdmin(userId);
    const current = await this.pool.query(
      `select c.id,c.provider_id,c.enabled,
        exists(select 1 from model_capabilities p where p.model_id=c.id) configurable
       from model_catalog c where c.id=$1`,
      [modelId],
    );
    const model = current.rows[0];
    if (!model)
      throw new DomainError("MODEL_NOT_FOUND", "模型不存在", 404);
    if (enabled && !model.configurable)
      throw new DomainError(
        "MODEL_NOT_CONFIGURABLE",
        "该模型能力暂未接入画布，不能启用",
        422,
      );
    await this.pool.query(
      "update model_catalog set enabled=$2,updated_at=now() where id=$1",
      [modelId, enabled],
    );
    await this.auditDirect(
      userId,
      "model.enabled.update",
      "model",
      modelId,
      { enabled, providerId: model.provider_id },
      requestId,
    );
    return { id: modelId, enabled };
  }

  async adminProviders(userId: string) {
    await this.requireAdmin(userId);
    const active = await this.pool.query(
      "select value->>'providerId' provider_id from platform_settings where key='managed_provider'",
    );
    const providers = await this.pool.query(
      "select provider_id,display_name,enabled,updated_at from provider_configs where provider_id=any($1::text[]) order by provider_id",
      [["token360", "runninghub", "runninghub_global"]],
    );
    return {
      activeProviderId: String(active.rows[0]?.provider_id || "token360"),
      providers: providers.rows.map((row) => ({
        id: row.provider_id,
        displayName: row.display_name,
        enabled: row.enabled,
        configured: Boolean(this.providerAvailability[row.provider_id]),
        updatedAt: iso(row.updated_at),
      })),
    };
  }

  async setManagedProvider(
    userId: string,
    providerId: "token360" | "runninghub" | "runninghub_global",
    requestId: string,
  ) {
    await this.requireAdmin(userId);
    if (!this.providerAvailability[providerId])
      throw new DomainError(
        "PROVIDER_NOT_CONFIGURED",
        `${providerId === "token360" ? "Token360" : providerId === "runninghub_global" ? "海马云国际区" : "海马云中国区"} API Key 尚未配置`,
        422,
      );
    await this.pool.query(
      `insert into platform_settings(key,value,updated_by) values('managed_provider',$1,$2)
       on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=now()`,
      [{ providerId }, userId],
    );
    await this.auditDirect(
      userId,
      "provider.active.update",
      "provider",
      providerId,
      { providerId },
      requestId,
    );
    return this.adminProviders(userId);
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
        (select balance from credit_accounts ca where ca.user_id=u.id) credit_balance,
        (select coalesce(jsonb_object_agg(x.currency,x.amount),'{}'::jsonb) from
          (select ${usageCurrencySql("gu")} currency,sum(coalesce(gu.total_amount,gu.amount_final,0))::text amount
           from generation_usage gu where gu.user_id=u.id group by ${usageCurrencySql("gu")}) x) usage_amounts
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
        (select balance from credit_accounts ca where ca.user_id=u.id) credit_balance,
        (select coalesce(jsonb_object_agg(x.currency,x.amount),'{}'::jsonb) from
          (select ${usageCurrencySql("gu")} currency,sum(coalesce(gu.total_amount,gu.amount_final,0))::text amount
           from generation_usage gu where gu.user_id=u.id group by ${usageCurrencySql("gu")}) x) usage_amounts
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
      credits: this.credits ? await this.credits.account(targetUserId) : null,
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
      `select gu.*,${usageCurrencySql("gu")} display_currency,u.email,p.name project_name from generation_usage gu join users u on u.id=gu.user_id join projects p on p.id=gu.project_id
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

  private async usageSummary(userId?: string, sinceDays?: number, dateFrom?: string, dateTo?: string) {
    const result = await this.pool.query(
      `select ${usageCurrencySql("gu")} currency,count(*)::int calls,
        coalesce(sum(total_tokens),0)::bigint total_tokens,
        coalesce(sum(generated_images),0)::bigint generated_images,
        coalesce(sum(video_duration_seconds),0)::text video_duration_seconds,
        coalesce(sum(audio_duration_seconds),0)::text audio_duration_seconds,
        coalesce(sum(coalesce(total_amount,amount_final,0)),0)::text total_amount
       from generation_usage gu where ($1::uuid is null or gu.user_id=$1)
        and ($2::int is null or gu.reconciled_at>=now()-($2::int*interval '1 day'))
        and ($3::date is null or gu.reconciled_at>=$3::date)
        and ($4::date is null or gu.reconciled_at<$4::date+1)
       group by ${usageCurrencySql("gu")} order by currency`,
      [userId || null, sinceDays || null, dateFrom || null, dateTo || null],
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

  private async adminTrends(dateFrom?: string, dateTo?: string) {
    const result = await this.pool.query(
      `with days as (select generate_series(coalesce($1::date,current_date-29),coalesce($2::date,current_date),interval '1 day')::date as day)
       select d.day::text,
        (select count(*)::int from users u where u.created_at>=d.day and u.created_at<d.day+1) new_users,
        (select count(*)::int from users u where (u.last_login_at>=d.day and u.last_login_at<d.day+1) or exists(select 1 from generation_jobs j where j.created_by=u.id and j.created_at>=d.day and j.created_at<d.day+1)) active_users,
        (select count(*)::int from generation_jobs j where j.created_at>=d.day and j.created_at<d.day+1) jobs,
        (select count(*)::int from generation_jobs j where j.status='completed' and j.created_at>=d.day and j.created_at<d.day+1) completed_jobs,
        (select coalesce(-sum(l.delta) filter(where l.entry_type='generation'),0)::bigint from credit_ledger l where l.created_at>=d.day and l.created_at<d.day+1) credit_points
       from days d order by d.day`,
      [dateFrom || null, dateTo || null],
    );
    return result.rows.map((row) => ({
      day: row.day,
      newUsers: row.new_users,
      activeUsers: row.active_users,
      jobs: row.jobs,
      completedJobs: row.completed_jobs,
      creditPoints: String(row.credit_points),
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
          `select ${expression} key,${usageCurrencySql("gu")} currency,count(*)::int calls,
            coalesce(sum(gu.total_tokens),0)::text total_tokens,
            coalesce(sum(coalesce(gu.total_amount,gu.amount_final,0)),0)::text total_amount
           from generation_usage gu join projects p on p.id=gu.project_id
           where ($1::uuid is null or gu.user_id=$1)
           group by ${expression},${usageCurrencySql("gu")} order by sum(coalesce(gu.total_amount,gu.amount_final,0)) desc limit 100`,
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

  private requireCredits() {
    if (!this.credits)
      throw new DomainError("CREDITS_DISABLED", "积分服务尚未启用", 503);
    return this.credits;
  }

  private requirePayments() {
    if (!this.payments)
      throw new DomainError("PAYMENTS_DISABLED", "支付宝充值尚未开放", 503);
    return this.payments;
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
function serializeBillingPlan(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    credits: Number(row.credits),
    priceCents: Number(row.price_cents),
    currency: row.currency,
    enabled: Boolean(row.enabled),
    metadata: row.metadata || {},
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
function serializeProviderBillingRule(row: Record<string, unknown>) {
  return {
    id: row.id,
    ruleKey: row.rule_key,
    version: Number(row.version),
    provider: row.provider,
    modelPattern: row.model_pattern,
    matchType: row.match_type,
    discountRate: String(row.discount_rate),
    priority: Number(row.priority),
    enabled: Boolean(row.enabled),
    note: row.note,
    createdAt: iso(row.created_at),
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
    creditBalance: String(row.credit_balance || 0),
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
    providerPaidAmount: money(row.amount_final),
    walletAmount: money(row.wallet_amount),
    voucherAmount: money(row.voucher_amount),
    currency: row.display_currency ?? row.currency,
    providerRequestId: row.provider_request_id,
    creditStatus: row.credit_status,
    creditPoints:
      row.credit_points === null || row.credit_points === undefined
        ? null
        : String(row.credit_points),
    costCny: money(row.cost_cny),
    exchangeRate: money(row.exchange_rate),
    reconciledAt: iso(row.reconciled_at),
  };
}

function usageCurrencySql(alias: string) {
  return `case when ${alias}.provider in ('runninghub','runninghub_global')
    and (${alias}.currency is null or upper(${alias}.currency)='UNKNOWN')
    then 'CNY' else coalesce(${alias}.currency,'UNKNOWN') end`;
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
  if (query.createdFrom) {
    values.push(query.createdFrom);
    filters.push(`${alias}.created_at>=$${values.length}::date`);
  }
  if (query.createdTo) {
    values.push(query.createdTo);
    filters.push(`${alias}.created_at<($${values.length}::date+interval '1 day')`);
  }
  return {
    where: filters.length ? `where ${filters.join(" and ")}` : "",
    values,
  };
}
