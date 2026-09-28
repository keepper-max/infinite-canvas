import { createHash, randomInt } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import type { OperationsConfig } from "./config.js";
import { DomainError } from "./domain.js";
import type {
  AttributionListQuery,
  BatchInput,
  CampaignInput,
  ChannelInput,
  InviteBatchInput,
  InviteCodeInput,
} from "./channel-attribution-contract.js";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ENTITY_TABLES = {
  channel: "channels",
  campaign: "campaigns",
  batch: "batches",
  invite: "invite_codes",
} as const;
type EntityKind = keyof typeof ENTITY_TABLES;

export class ChannelAttributionService {
  constructor(
    private readonly pool: Pool,
    private readonly config: OperationsConfig,
  ) {}

  async registrationConfig() {
    const result = await this.pool.query(
      "select value from platform_settings where key='registration_invite'",
    );
    const mode = String(result.rows[0]?.value?.mode || "optional");
    return {
      inviteMode: ["required", "optional", "disabled"].includes(mode)
        ? mode
        : "optional",
    };
  }

  deviceHash(deviceId?: string) {
    return deviceId
      ? createHash("sha256")
          .update(`registration-device:${deviceId}`)
          .digest("hex")
      : null;
  }

  async beginRegistration(ipAddress: string | null, deviceHash: string | null) {
    await this.cleanupRiskEvents();
    const counts = await this.pool.query(
      `select
        count(*) filter(where event_type='attempt' and ip_address=$1::inet)::int ip_attempts,
        count(*) filter(where event_type='attempt' and device_hash=$2)::int device_attempts,
        count(*) filter(where event_type='success' and ip_address=$1::inet and created_at>now()-interval '24 hours')::int ip_successes
       from registration_risk_events
       where created_at>now()-interval '10 minutes' or
         (event_type='success' and created_at>now()-interval '24 hours')`,
      [ipAddress, deviceHash],
    );
    const row = counts.rows[0];
    if (
      Number(row.ip_attempts) >= 5 ||
      (deviceHash && Number(row.device_attempts) >= 5)
    )
      throw new DomainError(
        "REGISTRATION_RATE_LIMITED",
        "注册操作过于频繁，请10分钟后重试",
        429,
        true,
      );
    if (ipAddress && Number(row.ip_successes) >= 50)
      throw new DomainError(
        "REGISTRATION_DAILY_LIMITED",
        "该网络今日注册账号数量已达上限，请明日再试",
        429,
        true,
      );
    await this.recordRiskEvent("attempt", ipAddress, deviceHash);
  }

  async validateInvite(
    code: string,
    ipAddress: string | null,
    deviceHash: string | null,
  ) {
    const failures = await this.pool.query(
      `select count(*)::int count from registration_risk_events
       where event_type='invite_failure' and created_at>now()-interval '10 minutes'
         and (($1::inet is not null and ip_address=$1::inet) or ($2::text is not null and device_hash=$2))`,
      [ipAddress, deviceHash],
    );
    if (Number(failures.rows[0]?.count || 0) >= 5)
      throw new DomainError(
        "INVITE_ATTEMPTS_LIMITED",
        "邀请码尝试次数过多，请10分钟后重试",
        429,
        true,
      );
    try {
      const result = await this.pool.query(
        `select id,status,start_at,expire_at,max_uses,used_count from invite_codes where upper(code)=upper($1)`,
        [code],
      );
      validateInviteRow(result.rows[0]);
      return { valid: true as const };
    } catch (error) {
      await this.recordRiskEvent("invite_failure", ipAddress, deviceHash);
      throw error;
    }
  }

  async finishRegistration(
    ipAddress: string | null,
    deviceHash: string | null,
  ) {
    await this.recordRiskEvent("success", ipAddress, deviceHash);
  }

  async setInviteMode(
    actorId: string,
    mode: string,
    requestId: string,
    actorIp: string | null,
  ) {
    await this.requireAdmin(actorId);
    return this.transaction(async (client) => {
      const previous = await client.query(
        "select value from platform_settings where key='registration_invite' for update",
      );
      await client.query(
        `insert into platform_settings(key,value,updated_by) values('registration_invite',$1,$2)
         on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=now()`,
        [{ mode }, actorId],
      );
      await audit(
        client,
        actorId,
        "registration.invite_mode.update",
        "platform_setting",
        "registration_invite",
        { previous: previous.rows[0]?.value || null, next: { mode } },
        requestId,
        actorIp,
      );
      return { inviteMode: mode };
    });
  }

  async listChannels(actorId: string, query: AttributionListQuery) {
    await this.requireAdmin(actorId);
    const { where, values } = listFilters(query, "c", [
      "c.channel_name",
      "c.channel_type",
      "c.code_prefix",
    ]);
    const count = await this.pool.query(
      `select count(*)::int total from channels c ${where}`,
      values,
    );
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const rows = await this.pool.query(
      `select c.*,
        (select count(*)::int from invite_codes i where i.channel_id=c.id) invite_count,
        (select count(*)::int from users u where u.channel_id=c.id) registered_users,
        (select count(*)::int from users u where u.channel_id=c.id and (u.last_login_at>=now()-interval '30 days' or exists(select 1 from generation_jobs j where j.created_by=u.id and j.created_at>=now()-interval '30 days'))) active_users,
        (select count(distinct p.user_id)::int from payment_orders p join users u on u.id=p.user_id where u.channel_id=c.id and p.status='paid') paid_users,
        (select coalesce(sum(p.amount_cents),0)::bigint from payment_orders p join users u on u.id=p.user_id where u.channel_id=c.id and p.status='paid') recharge_cents,
        (select coalesce(-sum(l.delta) filter(where l.entry_type='generation'),0)::bigint from credit_ledger l join credit_accounts a on a.id=l.account_id join users u on u.id=a.user_id where u.channel_id=c.id) consumed_points
       from channels c ${where} order by c.created_at desc limit $${values.length - 1} offset $${values.length}`,
      values,
    );
    return page(rows.rows.map(serializeChannel), count.rows[0].total, query);
  }

  async createChannel(
    actorId: string,
    input: ChannelInput,
    requestId: string,
    actorIp: string | null,
  ) {
    await this.requireAdmin(actorId);
    return this.transaction(async (client) => {
      const result = await client.query(
        `insert into channels(channel_type,channel_name,code_prefix,contact_name,contact_phone,remark,status,created_by)
         values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [
          input.channelType,
          input.channelName,
          input.codePrefix || null,
          input.contactName || null,
          input.contactPhone || null,
          input.remark,
          input.status,
          actorId,
        ],
      );
      await audit(
        client,
        actorId,
        "channel.create",
        "channel",
        result.rows[0].id,
        { next: result.rows[0] },
        requestId,
        actorIp,
      );
      return serializeChannel(result.rows[0]);
    });
  }

  async updateChannel(
    actorId: string,
    id: string,
    input: ChannelInput,
    requestId: string,
    actorIp: string | null,
  ) {
    return this.updateEntity(
      actorId,
      "channel",
      id,
      input,
      requestId,
      actorIp,
      `channel_type=$2,channel_name=$3,code_prefix=$4,contact_name=$5,contact_phone=$6,remark=$7,status=$8`,
      [
        input.channelType,
        input.channelName,
        input.codePrefix || null,
        input.contactName || null,
        input.contactPhone || null,
        input.remark,
        input.status,
      ],
    );
  }

  async listCampaigns(actorId: string, query: AttributionListQuery) {
    await this.requireAdmin(actorId);
    const { where, values } = listFilters(
      query,
      "p",
      ["p.name", "p.description"],
      query.channelId ? ["p.channel_id", query.channelId] : undefined,
    );
    return this.simpleList(
      "campaigns",
      "p",
      where,
      values,
      query,
      `select p.*,c.channel_name from campaigns p left join channels c on c.id=p.channel_id`,
      serializeCampaign,
    );
  }

  async createCampaign(
    actorId: string,
    input: CampaignInput,
    requestId: string,
    actorIp: string | null,
  ) {
    return this.createTimedEntity(
      actorId,
      "campaign",
      input,
      requestId,
      actorIp,
      `insert into campaigns(channel_id,name,description,start_at,end_at,status,created_by) values($1,$2,$3,$4,$5,$6,$7) returning *`,
      [
        input.channelId || null,
        input.name,
        input.description,
        input.startAt || null,
        input.endAt || null,
        input.status,
        actorId,
      ],
      serializeCampaign,
    );
  }

  async updateCampaign(
    actorId: string,
    id: string,
    input: CampaignInput,
    requestId: string,
    actorIp: string | null,
  ) {
    return this.updateEntity(
      actorId,
      "campaign",
      id,
      input,
      requestId,
      actorIp,
      `channel_id=$2,name=$3,description=$4,start_at=$5,end_at=$6,status=$7`,
      [
        input.channelId || null,
        input.name,
        input.description,
        input.startAt || null,
        input.endAt || null,
        input.status,
      ],
      async (client, previous) => {
        if (
          previous.channel_id !== (input.channelId || null) &&
          (await referenceCount(client, "campaign", id)) > 0
        )
          throw new DomainError(
            "CAMPAIGN_ATTRIBUTION_LOCKED",
            "活动已有历史数据，不能修改所属渠道",
            409,
          );
      },
    );
  }

  async listBatches(actorId: string, query: AttributionListQuery) {
    await this.requireAdmin(actorId);
    const extra = query.campaignId
      ? (["b.campaign_id", query.campaignId] as [string, unknown])
      : undefined;
    const { where, values } = listFilters(
      query,
      "b",
      ["b.name", "b.description"],
      extra,
    );
    return this.simpleList(
      "batches",
      "b",
      where,
      values,
      query,
      `select b.*,p.name campaign_name from batches b join campaigns p on p.id=b.campaign_id`,
      serializeBatch,
    );
  }

  async createBatch(
    actorId: string,
    input: BatchInput,
    requestId: string,
    actorIp: string | null,
  ) {
    return this.createTimedEntity(
      actorId,
      "batch",
      input,
      requestId,
      actorIp,
      `insert into batches(campaign_id,name,description,start_at,end_at,status,created_by) values($1,$2,$3,$4,$5,$6,$7) returning *`,
      [
        input.campaignId,
        input.name,
        input.description,
        input.startAt || null,
        input.endAt || null,
        input.status,
        actorId,
      ],
      serializeBatch,
    );
  }

  async updateBatch(
    actorId: string,
    id: string,
    input: BatchInput,
    requestId: string,
    actorIp: string | null,
  ) {
    return this.updateEntity(
      actorId,
      "batch",
      id,
      input,
      requestId,
      actorIp,
      `campaign_id=$2,name=$3,description=$4,start_at=$5,end_at=$6,status=$7`,
      [
        input.campaignId,
        input.name,
        input.description,
        input.startAt || null,
        input.endAt || null,
        input.status,
      ],
      async (client, previous) => {
        if (
          previous.campaign_id !== input.campaignId &&
          (await referenceCount(client, "batch", id)) > 0
        )
          throw new DomainError(
            "BATCH_ATTRIBUTION_LOCKED",
            "批次已有历史数据，不能修改所属活动",
            409,
          );
      },
    );
  }

  async listInvites(actorId: string, query: AttributionListQuery) {
    await this.requireAdmin(actorId);
    const values: unknown[] = [];
    const filters: string[] = [];
    if (query.q) {
      values.push(`%${query.q.toLowerCase()}%`);
      filters.push(
        `lower(i.code||' '||i.name||' '||c.channel_name) like $${values.length}`,
      );
    }
    for (const [column, value] of [
      ["i.status", query.status],
      ["i.channel_id", query.channelId],
      ["i.campaign_id", query.campaignId],
      ["i.batch_id", query.batchId],
    ] as const) {
      if (value) {
        values.push(value);
        filters.push(`${column}=$${values.length}`);
      }
    }
    const where = filters.length ? `where ${filters.join(" and ")}` : "";
    const count = await this.pool.query(
      `select count(*)::int total from invite_codes i join channels c on c.id=i.channel_id ${where}`,
      values,
    );
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const rows = await this.pool.query(
      `select i.*,c.channel_type,c.channel_name,p.name campaign_name,b.name batch_name,
        (select count(*)::int from users u where u.invite_code_id=i.id) registered_users
       from invite_codes i join channels c on c.id=i.channel_id left join campaigns p on p.id=i.campaign_id left join batches b on b.id=i.batch_id
       ${where} order by i.created_at desc limit $${values.length - 1} offset $${values.length}`,
      values,
    );
    return page(rows.rows.map(serializeInvite), count.rows[0].total, query);
  }

  async createInvite(
    actorId: string,
    input: InviteCodeInput,
    requestId: string,
    actorIp: string | null,
  ) {
    await this.requireAdmin(actorId);
    return this.transaction(async (client) =>
      this.insertInvite(
        client,
        actorId,
        input,
        input.code || (await this.generateUniqueCode(client, input.channelId)),
        requestId,
        actorIp,
      ),
    );
  }

  async createInviteBatch(
    actorId: string,
    input: InviteBatchInput,
    requestId: string,
    actorIp: string | null,
  ) {
    await this.requireAdmin(actorId);
    return this.transaction(async (client) => {
      const items = [];
      for (let index = 0; index < input.count; index++)
        items.push(
          await this.insertInvite(
            client,
            actorId,
            {
              ...input,
              name: `${input.namePrefix}${input.count > 1 ? ` ${index + 1}` : ""}`,
            },
            await this.generateUniqueCode(client, input.channelId),
            requestId,
            actorIp,
          ),
        );
      return { items };
    });
  }

  async updateInvite(
    actorId: string,
    id: string,
    input: InviteCodeInput,
    requestId: string,
    actorIp: string | null,
  ) {
    await this.requireAdmin(actorId);
    return this.transaction(async (client) => {
      const previous = await lockEntity(client, "invite", id);
      const code = input.code || previous.code;
      if (
        Number(previous.used_count) > 0 &&
        (previous.code !== code.toUpperCase() ||
          previous.channel_id !== input.channelId ||
          previous.campaign_id !== (input.campaignId || null) ||
          previous.batch_id !== (input.batchId || null))
      )
        throw new DomainError(
          "INVITE_ATTRIBUTION_LOCKED",
          "邀请码已有注册用户，不能修改代码、所属渠道、活动或批次",
          409,
        );
      await validateHierarchy(
        client,
        input.channelId,
        input.campaignId || null,
        input.batchId || null,
      );
      const result = await client.query(
        `update invite_codes set code=upper($2),channel_id=$3,campaign_id=$4,batch_id=$5,name=$6,description=$7,max_uses=$8,start_at=$9,expire_at=$10,status=$11,updated_at=now() where id=$1 returning *`,
        [
          id,
          code,
          input.channelId,
          input.campaignId || null,
          input.batchId || null,
          input.name,
          input.description,
          input.maxUses || null,
          input.startAt || null,
          input.expireAt || null,
          input.status,
        ],
      );
      await audit(
        client,
        actorId,
        "invite.update",
        "invite_code",
        id,
        { previous, next: result.rows[0] },
        requestId,
        actorIp,
      );
      return serializeInvite(result.rows[0]);
    });
  }

  async setStatus(
    actorId: string,
    kind: EntityKind,
    id: string,
    status: "active" | "disabled",
    requestId: string,
    actorIp: string | null,
  ) {
    await this.requireAdmin(actorId);
    return this.transaction(async (client) => {
      const previous = await lockEntity(client, kind, id);
      const result = await client.query(
        `update ${ENTITY_TABLES[kind]} set status=$2,updated_at=now() where id=$1 returning *`,
        [id, status],
      );
      await audit(
        client,
        actorId,
        `${kind}.status.update`,
        ENTITY_TABLES[kind],
        id,
        { previous, next: result.rows[0] },
        requestId,
        actorIp,
      );
      return result.rows[0];
    });
  }

  async deleteUnused(
    actorId: string,
    kind: EntityKind,
    id: string,
    requestId: string,
    actorIp: string | null,
  ) {
    await this.requireAdmin(actorId);
    return this.transaction(async (client) => {
      const previous = await lockEntity(client, kind, id);
      if (previous.system_key)
        throw new DomainError(
          "SYSTEM_CHANNEL_PROTECTED",
          "系统渠道不能删除",
          409,
        );
      const references = await referenceCount(client, kind, id);
      if (references > 0)
        throw new DomainError(
          "ATTRIBUTION_IN_USE",
          "该记录已有历史数据，只能停用，不能删除",
          409,
        );
      await client.query(`delete from ${ENTITY_TABLES[kind]} where id=$1`, [
        id,
      ]);
      await audit(
        client,
        actorId,
        `${kind}.delete`,
        ENTITY_TABLES[kind],
        id,
        { previous },
        requestId,
        actorIp,
      );
      return { deletedId: id };
    });
  }

  async detail(
    actorId: string,
    kind: EntityKind,
    id: string,
    query: AttributionListQuery,
  ) {
    await this.requireAdmin(actorId);
    const table = ENTITY_TABLES[kind];
    const entity = await this.pool.query(`select * from ${table} where id=$1`, [
      id,
    ]);
    if (!entity.rows[0])
      throw new DomainError("ATTRIBUTION_NOT_FOUND", "记录不存在", 404);
    const inviteCodes =
      kind === "channel"
        ? (
            await this.pool.query(
              "select id,code,name,status,used_count,max_uses,expire_at from invite_codes where channel_id=$1 order by created_at desc limit 100",
              [id],
            )
          ).rows
        : [];
    return {
      entity: entity.rows[0],
      metrics: await this.metrics(kind, id, query),
      trends: await this.trends(kind, id, query),
      inviteCodes,
    };
  }

  async users(
    actorId: string,
    kind: EntityKind,
    id: string,
    query: AttributionListQuery,
  ) {
    await this.requireAdmin(actorId);
    const column = scopeColumn(kind, "u");
    const values: unknown[] = [id];
    const filters = [`${column}=$1`];
    if (query.q) {
      values.push(`%${query.q.toLowerCase()}%`);
      filters.push(`lower(u.email) like $${values.length}`);
    }
    if (query.status) {
      values.push(query.status);
      filters.push(`u.account_status=$${values.length}`);
    }
    const where = `where ${filters.join(" and ")}`;
    const count = await this.pool.query(
      `select count(*)::int total from users u ${where}`,
      values,
    );
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const rows = await this.pool.query(
      `select u.id,u.email,u.created_at,u.last_login_at,u.account_status,u.registration_ip,
        coalesce(ca.balance,0)::text credit_balance,
        coalesce((select sum(p.amount_cents) from payment_orders p where p.user_id=u.id and p.status='paid'),0)::bigint recharge_cents,
        coalesce((select -sum(l.delta) filter(where l.entry_type='generation') from credit_ledger l where l.account_id=ca.id),0)::bigint consumed_points,
        coalesce((select sum(gu.credit_points) from generation_usage gu where gu.user_id=u.id and gu.capability='image'),0)::bigint image_points,
        coalesce((select sum(gu.credit_points) from generation_usage gu where gu.user_id=u.id and gu.capability='video'),0)::bigint video_points,
        coalesce((select sum(gu.credit_points) from generation_usage gu where gu.user_id=u.id and gu.capability not in ('image','video')),0)::bigint other_points,
        coalesce((select sum(gu.total_tokens) from generation_usage gu where gu.user_id=u.id),0)::bigint total_tokens
       from users u left join credit_accounts ca on ca.user_id=u.id ${where}
       order by u.created_at desc limit $${values.length - 1} offset $${values.length}`,
      values,
    );
    return page(
      rows.rows.map(serializeAttributedUser),
      count.rows[0].total,
      query,
    );
  }

  async exportUsers(
    actorId: string,
    kind: EntityKind,
    id: string,
    query: AttributionListQuery,
  ) {
    const items: any[] = [];
    for (let pageNumber = 1; ; pageNumber++) {
      const result = await this.users(actorId, kind, id, {
        ...query,
        page: pageNumber,
        pageSize: 100,
      });
      items.push(...result.items);
      if (items.length >= result.total) break;
    }
    const header = [
      "用户ID",
      "邮箱",
      "注册IP",
      "注册时间",
      "最后登录",
      "充值金额(分)",
      "当前积分",
      "累计消耗",
      "图片消耗",
      "视频消耗",
      "其他消耗",
      "Token",
      "状态",
    ];
    const lines = [
      header,
      ...items.map((item) => [
        item.id,
        item.email,
        item.registrationIp || "",
        item.createdAt,
        item.lastLoginAt || "",
        item.rechargeCents,
        item.creditBalance,
        item.consumedPoints,
        item.imagePoints,
        item.videoPoints,
        item.otherPoints,
        item.totalTokens,
        item.status,
      ]),
    ];
    return (
      "\ufeff" + lines.map((row) => row.map(csvCell).join(",")).join("\r\n")
    );
  }

  async dashboard(actorId: string, query: AttributionListQuery) {
    await this.requireAdmin(actorId);
    const overall = await this.metrics("channel", null, query);
    const rankings = await this.pool.query(
      `select c.id,c.channel_name,
        count(u.id)::int registered_users,
        coalesce((select sum(p.amount_cents) from payment_orders p join users pu on pu.id=p.user_id where pu.channel_id=c.id and p.status='paid'),0)::bigint recharge_cents,
        coalesce((select -sum(l.delta) filter(where l.entry_type='generation') from credit_ledger l join credit_accounts a on a.id=l.account_id join users cu on cu.id=a.user_id where cu.channel_id=c.id),0)::bigint consumed_points
       from channels c left join users u on u.channel_id=c.id group by c.id,c.channel_name order by registered_users desc limit 20`,
    );
    const counts = await this.pool.query(`select
      (select count(*)::int from channels) channels,
      (select count(*)::int from invite_codes) invite_codes,
      (select count(*)::int from users where invite_code_id is not null) invite_users,
      (select count(*)::int from users u join channels c on c.id=u.channel_id where c.system_key='organic') organic_users`);
    const registrationRankings = [...rankings.rows].sort(
      (left, right) =>
        Number(right.registered_users) - Number(left.registered_users),
    );
    const rechargeRankings = [...rankings.rows].sort(
      (left, right) =>
        Number(right.recharge_cents) - Number(left.recharge_cents),
    );
    const consumptionRankings = [...rankings.rows].sort(
      (left, right) =>
        Number(right.consumed_points) - Number(left.consumed_points),
    );
    return {
      metrics: { ...overall, ...counts.rows[0] },
      rankings: registrationRankings,
      registrationRankings,
      rechargeRankings,
      consumptionRankings,
    };
  }

  async updateUserAttribution(
    actorId: string,
    userId: string,
    input: {
      inviteCodeId?: string | null;
      channelId: string;
      campaignId?: string | null;
      batchId?: string | null;
      reason: string;
    },
    requestId: string,
    actorIp: string | null,
  ) {
    await this.requireAdmin(actorId);
    return this.transaction(async (client) => {
      const previous = await client.query(
        "select invite_code_id,channel_id,campaign_id,batch_id from users where id=$1 for update",
        [userId],
      );
      if (!previous.rows[0])
        throw new DomainError("ADMIN_USER_NOT_FOUND", "用户不存在", 404);
      await validateHierarchy(
        client,
        input.channelId,
        input.campaignId || null,
        input.batchId || null,
      );
      if (input.inviteCodeId) {
        const invite = await client.query(
          "select channel_id,campaign_id,batch_id from invite_codes where id=$1",
          [input.inviteCodeId],
        );
        if (!invite.rows[0])
          throw new DomainError("INVITE_NOT_FOUND", "邀请码不存在", 404);
        const row = invite.rows[0];
        if (
          row.channel_id !== input.channelId ||
          row.campaign_id !== (input.campaignId || null) ||
          row.batch_id !== (input.batchId || null)
        )
          throw new DomainError(
            "INVITE_ATTRIBUTION_MISMATCH",
            "邀请码与所选渠道、活动或批次不一致",
            422,
          );
      }
      const result = await client.query(
        `update users set invite_code_id=$2,channel_id=$3,campaign_id=$4,batch_id=$5,updated_at=now() where id=$1 returning id,invite_code_id,channel_id,campaign_id,batch_id`,
        [
          userId,
          input.inviteCodeId || null,
          input.channelId,
          input.campaignId || null,
          input.batchId || null,
        ],
      );
      await audit(
        client,
        actorId,
        "user.attribution.update",
        "user",
        userId,
        {
          reason: input.reason,
          previous: previous.rows[0],
          next: result.rows[0],
        },
        requestId,
        actorIp,
      );
      return result.rows[0];
    });
  }

  private async metrics(
    kind: EntityKind,
    id: string | null,
    query: AttributionListQuery,
  ) {
    const scope = id ? `where ${scopeColumn(kind, "u")}=$1` : "";
    const params = id ? [id] : [];
    const result = await this.pool.query(
      `with scoped as (select u.* from users u ${scope}) select
        count(*)::int registered_users,
        count(*) filter(where created_at>=current_date)::int today_users,
        count(*) filter(where created_at>=now()-interval '7 days')::int users_7d,
        count(*) filter(where created_at>=now()-interval '30 days')::int users_30d,
        count(*) filter(where last_login_at>=now()-interval '30 days' or exists(select 1 from generation_jobs j where j.created_by=scoped.id and j.created_at>=now()-interval '30 days'))::int active_users,
        (select count(distinct p.user_id)::int from payment_orders p join scoped s on s.id=p.user_id where p.status='paid') paid_users,
        (select coalesce(sum(p.amount_cents),0)::bigint from payment_orders p join scoped s on s.id=p.user_id where p.status='paid') recharge_cents,
        (select coalesce(sum(greatest(a.balance,0)),0)::bigint from credit_accounts a join scoped s on s.id=a.user_id) current_balance,
        (select coalesce(-sum(l.delta) filter(where l.entry_type='generation'),0)::bigint from credit_ledger l join credit_accounts a on a.id=l.account_id join scoped s on s.id=a.user_id) consumed_points,
        (select coalesce(sum(g.total_tokens),0)::bigint from generation_usage g join scoped s on s.id=g.user_id) total_tokens
       from scoped`,
      params,
    );
    const row = result.rows[0];
    return {
      ...row,
      averageRechargeCents: row.registered_users
        ? Math.round(Number(row.recharge_cents) / row.registered_users)
        : 0,
      averageConsumedPoints: row.registered_users
        ? Math.round(Number(row.consumed_points) / row.registered_users)
        : 0,
    };
  }

  private async trends(
    kind: EntityKind,
    id: string,
    query: AttributionListQuery,
  ) {
    const from =
      query.dateFrom ||
      new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const to = query.dateTo || new Date().toISOString().slice(0, 10);
    const column = scopeColumn(kind, "u");
    const result = await this.pool.query(
      `with days as(
         select generated_at::date as trend_day
         from generate_series($2::date,$3::date,interval '1 day') as generated_at
       ), scoped as(select id,created_at from users u where ${column}=$1)
       select d.trend_day::text as day,
        (select count(*)::int from scoped s where s.created_at>=d.trend_day and s.created_at<d.trend_day+interval '1 day') registrations,
        (select coalesce(sum(p.amount_cents),0)::bigint from payment_orders p join scoped s on s.id=p.user_id where p.status='paid' and p.paid_at>=d.trend_day and p.paid_at<d.trend_day+interval '1 day') recharge_cents,
        (select coalesce(-sum(l.delta) filter(where l.entry_type='generation'),0)::bigint from credit_ledger l join credit_accounts a on a.id=l.account_id join scoped s on s.id=a.user_id where l.created_at>=d.trend_day and l.created_at<d.trend_day+interval '1 day') consumed_points
       from days d order by d.trend_day`,
      [id, from, to],
    );
    return result.rows;
  }

  private async insertInvite(
    client: PoolClient,
    actorId: string,
    input: InviteCodeInput,
    code: string,
    requestId: string,
    actorIp: string | null,
  ) {
    await validateHierarchy(
      client,
      input.channelId,
      input.campaignId || null,
      input.batchId || null,
    );
    const result = await client.query(
      `insert into invite_codes(code,channel_id,campaign_id,batch_id,name,description,max_uses,start_at,expire_at,status,created_by) values(upper($1),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [
        code,
        input.channelId,
        input.campaignId || null,
        input.batchId || null,
        input.name,
        input.description,
        input.maxUses || null,
        input.startAt || null,
        input.expireAt || null,
        input.status,
        actorId,
      ],
    );
    await audit(
      client,
      actorId,
      "invite.create",
      "invite_code",
      result.rows[0].id,
      { next: result.rows[0] },
      requestId,
      actorIp,
    );
    return serializeInvite(result.rows[0]);
  }

  private async generateUniqueCode(client: PoolClient, channelId: string) {
    const channel = await client.query(
      "select code_prefix from channels where id=$1",
      [channelId],
    );
    if (!channel.rows[0])
      throw new DomainError("CHANNEL_NOT_FOUND", "渠道不存在", 404);
    const prefix = String(channel.rows[0].code_prefix || "INV").toUpperCase();
    for (let attempt = 0; attempt < 10; attempt++) {
      let suffix = "";
      for (let i = 0; i < 6; i++)
        suffix += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      const code = `${prefix}-${suffix}`;
      const exists = await client.query(
        "select 1 from invite_codes where upper(code)=upper($1)",
        [code],
      );
      if (!exists.rowCount) return code;
    }
    throw new DomainError(
      "INVITE_CODE_GENERATION_FAILED",
      "邀请码生成失败，请重试",
      503,
      true,
    );
  }

  private async updateEntity(
    actorId: string,
    kind: EntityKind,
    id: string,
    input: unknown,
    requestId: string,
    actorIp: string | null,
    setSql: string,
    values: unknown[],
    guard?: (client: PoolClient, previous: any) => Promise<void>,
  ) {
    await this.requireAdmin(actorId);
    return this.transaction(async (client) => {
      const previous = await lockEntity(client, kind, id);
      await guard?.(client, previous);
      const result = await client.query(
        `update ${ENTITY_TABLES[kind]} set ${setSql},updated_at=now() where id=$1 returning *`,
        [id, ...values],
      );
      await audit(
        client,
        actorId,
        `${kind}.update`,
        ENTITY_TABLES[kind],
        id,
        { previous, next: result.rows[0], input },
        requestId,
        actorIp,
      );
      return result.rows[0];
    });
  }

  private async createTimedEntity<T>(
    actorId: string,
    kind: EntityKind,
    input: unknown,
    requestId: string,
    actorIp: string | null,
    sql: string,
    values: unknown[],
    serialize: (row: any) => T,
  ) {
    await this.requireAdmin(actorId);
    return this.transaction(async (client) => {
      const result = await client.query(sql, values);
      await audit(
        client,
        actorId,
        `${kind}.create`,
        ENTITY_TABLES[kind],
        result.rows[0].id,
        { next: result.rows[0], input },
        requestId,
        actorIp,
      );
      return serialize(result.rows[0]);
    });
  }

  private async simpleList<T>(
    table: string,
    alias: string,
    where: string,
    values: unknown[],
    query: AttributionListQuery,
    selectSql: string,
    serialize: (row: any) => T,
  ) {
    const count = await this.pool.query(
      `select count(*)::int total from ${table} ${alias} ${where}`,
      values,
    );
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const rows = await this.pool.query(
      `${selectSql} ${where} order by ${alias}.created_at desc limit $${values.length - 1} offset $${values.length}`,
      values,
    );
    return page(rows.rows.map(serialize), count.rows[0].total, query);
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
      throw new DomainError("ADMIN_FORBIDDEN", "需要超级管理员权限", 403);
  }
  private async recordRiskEvent(
    eventType: string,
    ipAddress: string | null,
    deviceHash: string | null,
  ) {
    await this.pool.query(
      "insert into registration_risk_events(ip_address,device_hash,event_type) values($1::inet,$2,$3)",
      [ipAddress, deviceHash, eventType],
    );
  }
  private async cleanupRiskEvents() {
    await this.pool.query(
      "delete from registration_risk_events where created_at<now()-interval '7 days'",
    );
  }
  private async transaction<T>(operation: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
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
}

function validateInviteRow(row: any) {
  if (!row)
    throw new DomainError(
      "INVITE_CODE_NOT_FOUND",
      "邀请码不存在，请检查后重新输入",
      422,
    );
  if (row.status !== "active")
    throw new DomainError("INVITE_CODE_DISABLED", "该邀请码当前不可使用", 422);
  if (row.start_at && new Date(row.start_at) > new Date())
    throw new DomainError("INVITE_CODE_NOT_STARTED", "该邀请码尚未生效", 422);
  if (row.expire_at && new Date(row.expire_at) < new Date())
    throw new DomainError("INVITE_CODE_EXPIRED", "该邀请码已过期", 422);
  if (row.max_uses !== null && Number(row.used_count) >= Number(row.max_uses))
    throw new DomainError("INVITE_CODE_FULL", "该邀请码可使用名额已满", 422);
  return row;
}
function listFilters(
  query: AttributionListQuery,
  alias: string,
  search: string[],
  extra?: [string, unknown],
) {
  const values: unknown[] = [];
  const filters: string[] = [];
  if (query.q) {
    values.push(`%${query.q.toLowerCase()}%`);
    filters.push(`lower(${search.join("||' '||")}) like $${values.length}`);
  }
  if (query.status) {
    values.push(query.status);
    filters.push(`${alias}.status=$${values.length}`);
  }
  if (extra) {
    values.push(extra[1]);
    filters.push(`${extra[0]}=$${values.length}`);
  }
  return {
    where: filters.length ? `where ${filters.join(" and ")}` : "",
    values,
  };
}
function page<T>(items: T[], total: number, query: AttributionListQuery) {
  return { items, total, page: query.page, pageSize: query.pageSize };
}
async function lockEntity(client: PoolClient, kind: EntityKind, id: string) {
  const result = await client.query(
    `select * from ${ENTITY_TABLES[kind]} where id=$1 for update`,
    [id],
  );
  if (!result.rows[0])
    throw new DomainError("ATTRIBUTION_NOT_FOUND", "记录不存在", 404);
  return result.rows[0];
}
async function validateHierarchy(
  client: PoolClient,
  channelId: string,
  campaignId: string | null,
  batchId: string | null,
) {
  const result = await client.query(
    `select c.id channel_id,p.id campaign_id,p.channel_id campaign_channel_id,b.id batch_id,b.campaign_id batch_campaign_id from channels c left join campaigns p on p.id=$2 left join batches b on b.id=$3 where c.id=$1`,
    [channelId, campaignId, batchId],
  );
  const row = result.rows[0];
  if (!row) throw new DomainError("CHANNEL_NOT_FOUND", "渠道不存在", 404);
  if (campaignId && !row.campaign_id)
    throw new DomainError("CAMPAIGN_NOT_FOUND", "活动不存在", 404);
  if (row.campaign_channel_id && row.campaign_channel_id !== channelId)
    throw new DomainError(
      "ATTRIBUTION_HIERARCHY_INVALID",
      "活动不属于所选渠道",
      422,
    );
  if (batchId && !row.batch_id)
    throw new DomainError("BATCH_NOT_FOUND", "批次不存在", 404);
  if (batchId && row.batch_campaign_id !== campaignId)
    throw new DomainError(
      "ATTRIBUTION_HIERARCHY_INVALID",
      "批次不属于所选活动",
      422,
    );
}
async function referenceCount(
  client: PoolClient,
  kind: EntityKind,
  id: string,
) {
  const sql =
    kind === "invite"
      ? "select count(*)::int count from users where invite_code_id=$1"
      : kind === "channel"
        ? "select ((select count(*) from users where channel_id=$1)+(select count(*) from invite_codes where channel_id=$1)+(select count(*) from campaigns where channel_id=$1))::int count"
        : kind === "campaign"
          ? "select ((select count(*) from users where campaign_id=$1)+(select count(*) from invite_codes where campaign_id=$1)+(select count(*) from batches where campaign_id=$1))::int count"
          : "select ((select count(*) from users where batch_id=$1)+(select count(*) from invite_codes where batch_id=$1))::int count";
  const result = await client.query(sql, [id]);
  return Number(result.rows[0]?.count || 0);
}
function scopeColumn(kind: EntityKind, alias: string) {
  return kind === "invite"
    ? `${alias}.invite_code_id`
    : kind === "channel"
      ? `${alias}.channel_id`
      : kind === "campaign"
        ? `${alias}.campaign_id`
        : `${alias}.batch_id`;
}
async function audit(
  client: PoolClient,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown>,
  requestId: string,
  actorIp: string | null,
) {
  await client.query(
    "insert into admin_audit_logs(actor_user_id,action,target_type,target_id,request_id,metadata,actor_ip) values($1,$2,$3,$4,$5,$6,$7::inet)",
    [actorId, action, targetType, targetId, requestId, metadata, actorIp],
  );
}
function serializeChannel(row: any) {
  return {
    id: row.id,
    systemKey: row.system_key,
    channelType: row.channel_type,
    channelName: row.channel_name,
    codePrefix: row.code_prefix,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    remark: row.remark,
    status: row.status,
    inviteCount: Number(row.invite_count || 0),
    registeredUsers: Number(row.registered_users || 0),
    activeUsers: Number(row.active_users || 0),
    paidUsers: Number(row.paid_users || 0),
    rechargeCents: String(row.recharge_cents || 0),
    consumedPoints: String(row.consumed_points || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function serializeCampaign(row: any) {
  return {
    id: row.id,
    channelId: row.channel_id,
    channelName: row.channel_name,
    name: row.name,
    description: row.description,
    startAt: row.start_at,
    endAt: row.end_at,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function serializeBatch(row: any) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    name: row.name,
    description: row.description,
    startAt: row.start_at,
    endAt: row.end_at,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function serializeInvite(row: any) {
  const now = Date.now();
  const effectiveStatus =
    row.status !== "active"
      ? "disabled"
      : row.expire_at && new Date(row.expire_at).getTime() < now
        ? "expired"
        : row.start_at && new Date(row.start_at).getTime() > now
          ? "pending"
          : row.max_uses !== null &&
              Number(row.used_count) >= Number(row.max_uses)
            ? "full"
            : "active";
  return {
    id: row.id,
    code: row.code,
    channelId: row.channel_id,
    channelType: row.channel_type,
    channelName: row.channel_name,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    batchId: row.batch_id,
    batchName: row.batch_name,
    name: row.name,
    description: row.description,
    maxUses: row.max_uses,
    usedCount: Number(row.used_count || 0),
    registeredUsers: Number(row.registered_users || 0),
    startAt: row.start_at,
    expireAt: row.expire_at,
    status: row.status,
    effectiveStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function serializeAttributedUser(row: any) {
  return {
    id: row.id,
    email: row.email,
    registrationIp: row.registration_ip,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    status: row.account_status,
    rechargeCents: String(row.recharge_cents || 0),
    creditBalance: String(row.credit_balance || 0),
    consumedPoints: String(row.consumed_points || 0),
    imagePoints: String(row.image_points || 0),
    videoPoints: String(row.video_points || 0),
    otherPoints: String(row.other_points || 0),
    totalTokens: String(row.total_tokens || 0),
  };
}
function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
