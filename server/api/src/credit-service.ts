import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import { generateActivationCode, hashActivationCode, isActivationCode } from "./activation-code.js";
import { DomainError } from "./domain.js";

const POINTS_PER_CNY = 100n;
const MARKUP = "1.2";
const POINTS_MULTIPLIER = "120";

type Queryable = Pick<PoolClient, "query">;

export type CreditPricing = {
  pointsPerCny: 100;
  markup: "1.2";
  rounding: "ceil";
  usdCnyRate?: string;
};

export type CreditGrantInput = {
  credits: number;
  source: "purchase" | "promotion" | "compensation";
  note: string;
  expiresAt?: string;
  idempotencyKey: string;
};

export class CreditService {
  constructor(private readonly pool: Pool, private readonly adminEmails: string[] = []) {}

  async issueActivationCode(actorId: string, credits: number, expiresAt: string, requestId: string) {
    if (!Number.isSafeInteger(credits) || credits <= 0 || new Date(expiresAt).getTime() <= Date.now() || Number.isNaN(new Date(expiresAt).getTime()))
      throw new DomainError("ACTIVATION_INPUT_INVALID", "请输入正整数积分和未来的到期时间", 400);
    return transaction(this.pool, async (client) => {
      await assertActiveAdmin(client, actorId, this.adminEmails);
      const code = generateActivationCode();
      const [record] = (await client.query(
        `insert into activation_codes(code_hash,code_hint,credits,expires_at,created_by)
         values($1,$2,$3,$4,$5) returning id,code_hint,credits,expires_at,created_at`,
        [hashActivationCode(code), code.slice(-4), credits, expiresAt, actorId],
      )).rows;
      await audit(client, actorId, "credits.activation.issue", "activation_code", record.id,
        { credits: String(credits), expiresAt }, requestId);
      return { ...serializeCode(record), code };
    });
  }

  async listActivationCodes(actorId: string) {
    await assertActiveAdmin(this.pool, actorId, this.adminEmails);
    const result = await this.pool.query(
      `select id,code_hint,credits,expires_at,created_at,redeemed_at,revoked_at
       from activation_codes order by created_at desc limit 20`,
    );
    return result.rows.map(serializeCode);
  }

  async redeemActivationCode(userId: string, code: string) {
    if (!isActivationCode(code))
      throw new DomainError("ACTIVATION_INVALID", "激活码无效或已使用", 400);
    return transaction(this.pool, async (client) => {
      const [claimed] = (await client.query(
        `update activation_codes set redeemed_by=$2,redeemed_at=now()
         where code_hash=$1 and redeemed_at is null and revoked_at is null and expires_at>now()
         returning id,credits`,
        [hashActivationCode(code), userId],
      )).rows;
      if (!claimed) throw new DomainError("ACTIVATION_INVALID", "激活码无效或已使用", 400);
      const account = await ensureAccount(client, userId, true);
      await expireLots(client, account);
      const current = await accountRow(client, userId);
      const credits = BigInt(String(claimed.credits));
      const balance = BigInt(String(current.balance));
      const debtCovered = balance < 0n ? min(credits, -balance) : 0n;
      const [lot] = (await client.query(
        `insert into credit_lots(account_id,source,credits,remaining,reference_type,reference_id,expires_at,metadata)
         values($1,'activation',$2,$3,'activation_code',$4,null,$5) returning id`,
        [current.id, credits.toString(), (credits - debtCovered).toString(), claimed.id,
          JSON.stringify({ debtCovered: debtCovered.toString() })],
      )).rows;
      const [updated] = (await client.query(
        "update credit_accounts set balance=balance+$2::bigint,updated_at=now() where id=$1 returning balance",
        [current.id, credits.toString()],
      )).rows;
      await client.query(
        `insert into credit_ledger(account_id,entry_type,delta,balance_after,reference_type,reference_id,idempotency_key,metadata)
         values($1,'grant',$2,$3,'credit_lot',$4,$5,$6)`,
        [current.id, credits.toString(), String(updated.balance), lot.id,
          `activation:${claimed.id}`, JSON.stringify({ source: "activation", activationCodeId: claimed.id })],
      );
      return { credits: credits.toString(), balance: String(updated.balance) };
    });
  }

  async pricing(client: Queryable = this.pool): Promise<CreditPricing> {
    const result = await client.query(
      "select value from platform_settings where key='credit_pricing'",
    );
    const value = asRecord(result.rows[0]?.value);
    const usdCnyRate = positiveDecimal(value.usdCnyRate);
    return {
      pointsPerCny: 100,
      markup: MARKUP,
      rounding: "ceil",
      ...(usdCnyRate ? { usdCnyRate } : {}),
    };
  }

  async setUsdCnyRate(actorId: string, rate: string, requestId: string) {
    const normalized = positiveDecimal(rate);
    if (!normalized)
      throw new DomainError(
        "CREDIT_RATE_INVALID",
        "请输入大于 0 的 USD/CNY 结算汇率",
        400,
      );
    return transaction(this.pool, async (client) => {
      await client.query(
        `insert into platform_settings(key,value,updated_by) values('credit_pricing',$1,$2)
         on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=now()`,
        [
          JSON.stringify({
            pointsPerCny: Number(POINTS_PER_CNY),
            markup: MARKUP,
            rounding: "ceil",
            usdCnyRate: normalized,
          }),
          actorId,
        ],
      );
      await audit(
        client,
        actorId,
        "credits.pricing.update",
        "platform_setting",
        "credit_pricing",
        { usdCnyRate: normalized },
        requestId,
      );
      return this.pricing(client);
    });
  }

  async account(userId: string) {
    return transaction(this.pool, async (client) => {
      const account = await ensureAccount(client, userId, true);
      await expireLots(client, account);
      const refreshed = await accountRow(client, userId);
      const [ledger, lots, pending] = await Promise.all([
        client.query(
          `select id,entry_type,delta,balance_after,reference_type,reference_id,metadata,created_at
           from credit_ledger where account_id=$1 order by id desc limit 100`,
          [refreshed.id],
        ),
        client.query(
          `select id,source,credits,remaining,reference_type,reference_id,expires_at,metadata,created_at
           from credit_lots where account_id=$1 order by expires_at asc nulls last,created_at asc limit 100`,
          [refreshed.id],
        ),
        client.query(
          `select count(*)::int total from generation_usage
           where user_id=$1 and credit_status in ('pending','pending_rate','pending_currency')`,
          [userId],
        ),
      ]);
      return {
        account: serializeAccount(refreshed),
        ledger: ledger.rows.map(serializeLedger),
        lots: lots.rows.map(serializeLot),
        pendingCharges: Number(pending.rows[0]?.total || 0),
        pricing: await this.pricing(client),
        enabled: true,
      };
    });
  }

  async assertCanCreate(userId: string) {
    return transaction(this.pool, async (client) => {
      const account = await ensureAccount(client, userId, true);
      await expireLots(client, account);
      const refreshed = await accountRow(client, userId);
      if (BigInt(String(refreshed.balance)) <= 0n)
        throw new DomainError(
          "INSUFFICIENT_CREDITS",
          "积分余额不足，请充值或联系管理员补充积分",
          409,
        );
    });
  }

  async grant(
    actorId: string,
    targetUserId: string,
    input: CreditGrantInput,
    requestId: string,
  ) {
    return transaction(this.pool, async (client) => {
      const credits = BigInt(input.credits);
      const account = await ensureAccount(client, targetUserId, true);
      await expireLots(client, account);
      const current = await accountRow(client, targetUserId);
      const idempotencyKey = `admin-grant:${input.idempotencyKey}`;
      const existing = await client.query(
        `select l.*,cl.id lot_id,cl.source,cl.credits lot_credits,cl.remaining,cl.expires_at,cl.metadata lot_metadata,cl.created_at lot_created_at
         from credit_ledger l left join credit_lots cl on cl.id::text=l.reference_id
         where l.idempotency_key=$1`,
        [idempotencyKey],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (String(row.account_id) !== String(current.id))
          throw new DomainError(
            "CREDIT_IDEMPOTENCY_CONFLICT",
            "该积分发放请求已用于其他账号",
            409,
          );
        return {
          account: serializeAccount(current),
          ledger: serializeLedger(row),
          lot: serializeLot({
            id: row.lot_id,
            source: row.source,
            credits: row.lot_credits,
            remaining: row.remaining,
            expires_at: row.expires_at,
            metadata: row.lot_metadata,
            created_at: row.lot_created_at,
          }),
        };
      }
      const currentBalance = BigInt(String(current.balance));
      const debtCovered =
        currentBalance < 0n ? min(credits, -currentBalance) : 0n;
      const remaining = credits - debtCovered;
      const expiresAt = input.expiresAt || null;
      if (expiresAt && new Date(expiresAt).getTime() <= Date.now())
        throw new DomainError(
          "CREDIT_EXPIRY_INVALID",
          "积分到期时间必须晚于当前时间",
          400,
        );
      const referenceId = randomUUID();
      const lot = await client.query(
        `insert into credit_lots(account_id,source,credits,remaining,reference_type,reference_id,expires_at,metadata,created_by)
         values($1,$2,$3,$4,'admin_grant',$5,coalesce($6::timestamptz,now()+interval '12 months'),$7,$8) returning *`,
        [
          current.id,
          input.source,
          credits.toString(),
          remaining.toString(),
          referenceId,
          expiresAt,
          JSON.stringify({
            note: input.note,
            debtCovered: debtCovered.toString(),
          }),
          actorId,
        ],
      );
      const updated = await client.query(
        "update credit_accounts set balance=balance+$2::bigint,updated_at=now() where id=$1 returning *",
        [current.id, credits.toString()],
      );
      const ledger = await client.query(
        `insert into credit_ledger(account_id,entry_type,delta,balance_after,reference_type,reference_id,idempotency_key,metadata)
         values($1,'grant',$2,$3,'credit_lot',$4,$5,$6) returning *`,
        [
          current.id,
          credits.toString(),
          String(updated.rows[0].balance),
          lot.rows[0].id,
          idempotencyKey,
          JSON.stringify({
            source: input.source,
            note: input.note,
            debtCovered: debtCovered.toString(),
          }),
        ],
      );
      await audit(
        client,
        actorId,
        "credits.grant",
        "user",
        targetUserId,
        {
          credits: credits.toString(),
          source: input.source,
          lotId: lot.rows[0].id,
          note: input.note,
        },
        requestId,
      );
      return {
        account: serializeAccount(updated.rows[0]),
        ledger: serializeLedger(ledger.rows[0]),
        lot: serializeLot(lot.rows[0]),
      };
    });
  }

  async settleUsage(jobId: string) {
    return transaction(this.pool, async (client) => {
      const result = await client.query(
        `select * from generation_usage where job_id=$1 for update`,
        [jobId],
      );
      const usage = result.rows[0];
      if (!usage) return { status: "missing" };
      if (["charged", "free", "historical"].includes(String(usage.credit_status)))
        return {
          status: String(usage.credit_status),
          points: usage.credit_points,
        };
      const amount = positiveOrZeroDecimal(
        usage.total_amount ?? usage.amount_final,
      );
      if (!usage.billed || amount === undefined) {
        await setCreditStatus(client, jobId, "unavailable");
        return { status: "unavailable" };
      }
      const currency = String(usage.currency || "").toUpperCase();
      const pricing = await this.pricing(client);
      const exchangeRate =
        currency === "CNY"
          ? "1"
          : currency === "USD"
            ? pricing.usdCnyRate
            : undefined;
      if (!currency) {
        await setCreditStatus(client, jobId, "pending_currency");
        return { status: "pending_currency" };
      }
      if (!exchangeRate) {
        await setCreditStatus(
          client,
          jobId,
          currency === "USD" ? "pending_rate" : "unsupported_currency",
        );
        return {
          status: currency === "USD" ? "pending_rate" : "unsupported_currency",
        };
      }
      const points = decimalProductCeil([
        amount,
        exchangeRate,
        POINTS_MULTIPLIER,
      ]);
      if (points === 0n) {
        await client.query(
          `update generation_usage set credit_status='free',credit_points=0,cost_cny=$2::numeric*$3::numeric,
           exchange_rate=$3,markup=$4,points_per_cny=$5,updated_at=now() where job_id=$1`,
          [jobId, amount, exchangeRate, MARKUP, POINTS_PER_CNY.toString()],
        );
        return { status: "free", points: "0" };
      }
      const idempotencyKey = `generation:${jobId}`;
      const existing = await client.query(
        "select * from credit_ledger where idempotency_key=$1",
        [idempotencyKey],
      );
      if (existing.rows[0]) {
        await linkUsageCharge(
          client,
          usage,
          existing.rows[0],
          amount,
          exchangeRate,
          points,
        );
        return { status: "charged", points: points.toString() };
      }
      const account = await ensureAccount(client, String(usage.user_id), true);
      await expireLots(client, account);
      const current = await accountRow(client, String(usage.user_id));
      const updated = await client.query(
        "update credit_accounts set balance=balance-$2::bigint,updated_at=now() where id=$1 returning *",
        [current.id, points.toString()],
      );
      const ledger = await client.query(
        `insert into credit_ledger(account_id,entry_type,delta,balance_after,reference_type,reference_id,idempotency_key,metadata)
         values($1,'generation',-$2::bigint,$3,'generation_job',$4,$5,$6) returning *`,
        [
          current.id,
          points.toString(),
          String(updated.rows[0].balance),
          jobId,
          idempotencyKey,
          JSON.stringify({
            amount,
            currency,
            exchangeRate,
            costCny: "calculated",
            pointsPerCny: 100,
            markup: MARKUP,
            rounding: "ceil",
            modelId: usage.model_id,
            capability: usage.capability,
          }),
        ],
      );
      await allocateLots(client, current.id, String(ledger.rows[0].id), points);
      await linkUsageCharge(
        client,
        usage,
        ledger.rows[0],
        amount,
        exchangeRate,
        points,
      );
      return {
        status: "charged",
        points: points.toString(),
        balance: String(updated.rows[0].balance),
      };
    });
  }

  async runPending(limit = 50) {
    const due = await this.pool.query(
      `select job_id from generation_usage where credit_status in ('pending','pending_rate','pending_currency')
       order by reconciled_at asc limit $1`,
      [limit],
    );
    for (const row of due.rows) await this.settleUsage(String(row.job_id));
    return due.rowCount || 0;
  }
}

async function ensureAccount(client: Queryable, userId: string, lock = false) {
  await client.query(
    "insert into credit_accounts(user_id) values($1) on conflict(user_id) do nothing",
    [userId],
  );
  return accountRow(client, userId, lock);
}

async function accountRow(client: Queryable, userId: string, lock = false) {
  const result = await client.query(
    `select * from credit_accounts where user_id=$1${lock ? " for update" : ""}`,
    [userId],
  );
  return result.rows[0] as QueryResultRow;
}

async function expireLots(client: Queryable, account: QueryResultRow) {
  const lots = await client.query(
    `select * from credit_lots where account_id=$1 and remaining>0 and expires_at<=now()
     order by expires_at,created_at for update`,
    [account.id],
  );
  for (const lot of lots.rows) {
    const existing = await client.query(
      "select 1 from credit_ledger where idempotency_key=$1",
      [`expiry:${lot.id}`],
    );
    if (existing.rowCount) continue;
    const updated = await client.query(
      "update credit_accounts set balance=balance-$2::bigint,updated_at=now() where id=$1 returning balance",
      [account.id, String(lot.remaining)],
    );
    await client.query(
      `insert into credit_ledger(account_id,entry_type,delta,balance_after,reference_type,reference_id,idempotency_key,metadata)
       values($1,'expiry',-$2::bigint,$3,'credit_lot',$4,$5,$6)`,
      [
        account.id,
        String(lot.remaining),
        String(updated.rows[0].balance),
        lot.id,
        `expiry:${lot.id}`,
        JSON.stringify({ source: lot.source, expiresAt: lot.expires_at }),
      ],
    );
    await client.query(
      "update credit_lots set remaining=0,updated_at=now() where id=$1",
      [lot.id],
    );
  }
}

async function allocateLots(
  client: Queryable,
  accountId: string,
  ledgerId: string,
  points: bigint,
) {
  let remaining = points;
  const lots = await client.query(
    `select * from credit_lots where account_id=$1 and remaining>0 and (expires_at is null or expires_at>now())
     order by expires_at asc nulls last,created_at asc for update`,
    [accountId],
  );
  for (const lot of lots.rows) {
    if (remaining <= 0n) break;
    const available = BigInt(String(lot.remaining));
    const used = min(available, remaining);
    await client.query(
      "update credit_lots set remaining=remaining-$2::bigint,updated_at=now() where id=$1",
      [lot.id, used.toString()],
    );
    await client.query(
      "insert into credit_lot_allocations(ledger_id,lot_id,credits) values($1,$2,$3)",
      [ledgerId, lot.id, used.toString()],
    );
    remaining -= used;
  }
}

async function linkUsageCharge(
  client: Queryable,
  usage: QueryResultRow,
  ledger: QueryResultRow,
  amount: string,
  exchangeRate: string,
  points: bigint,
) {
  await client.query(
    `update generation_usage set credit_status='charged',credit_points=$2,
     cost_cny=$3::numeric*$4::numeric,exchange_rate=$4,markup=$5,points_per_cny=$6,
     credit_ledger_id=$7,updated_at=now() where job_id=$1`,
    [
      usage.job_id,
      points.toString(),
      amount,
      exchangeRate,
      MARKUP,
      POINTS_PER_CNY.toString(),
      ledger.id,
    ],
  );
}

async function setCreditStatus(
  client: Queryable,
  jobId: string,
  status: string,
) {
  await client.query(
    "update generation_usage set credit_status=$2,updated_at=now() where job_id=$1",
    [jobId, status],
  );
}

function serializeAccount(row: QueryResultRow) {
  return {
    id: row.id,
    userId: row.user_id,
    balance: String(row.balance),
    reserved: String(row.reserved),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function serializeCode(row: QueryResultRow) {
  return {
    id: String(row.id),
    codeHint: String(row.code_hint),
    credits: String(row.credits),
    expiresAt: iso(row.expires_at),
    createdAt: iso(row.created_at),
    redeemedAt: iso(row.redeemed_at),
    revokedAt: iso(row.revoked_at),
  };
}

async function assertActiveAdmin(client: Queryable, actorId: string, adminEmails: string[]) {
  const result = await client.query(
    "select is_admin,email from users where id=$1 and account_status='active'",
    [actorId],
  );
  const user = result.rows[0];
  if (!user || (!user.is_admin && !adminEmails.includes(String(user.email).toLowerCase())))
    throw new DomainError("ADMIN_FORBIDDEN", "无管理员权限", 403);
}

function serializeLedger(row: QueryResultRow) {
  return {
    id: String(row.id),
    type: row.entry_type,
    delta: String(row.delta),
    balanceAfter: String(row.balance_after),
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    metadata: row.metadata,
    createdAt: iso(row.created_at),
  };
}

function serializeLot(row: QueryResultRow) {
  return {
    id: row.id,
    source: row.source,
    credits: String(row.credits),
    remaining: String(row.remaining),
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    expiresAt: iso(row.expires_at),
    metadata: row.metadata,
    createdAt: iso(row.created_at),
  };
}

function positiveDecimal(value: unknown) {
  const normalized = decimal(value);
  return normalized && decimalProductCeil([normalized]) > 0n
    ? normalized
    : undefined;
}

function positiveOrZeroDecimal(value: unknown) {
  return decimal(value);
}

function decimal(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d+(?:\.\d+)?$/.test(text)
    ? text.replace(/^0+(?=\d)/, "")
    : undefined;
}

export function decimalProductCeil(values: string[]) {
  let numerator = 1n;
  let denominator = 1n;
  for (const value of values) {
    const [whole, fraction = ""] = value.split(".");
    numerator *= BigInt(`${whole}${fraction}`);
    denominator *= 10n ** BigInt(fraction.length);
  }
  return (numerator + denominator - 1n) / denominator;
}

function min(left: bigint, right: bigint) {
  return left < right ? left : right;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : value;
}

async function transaction<T>(
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
  client: Queryable,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown>,
  requestId: string,
) {
  await client.query(
    "insert into admin_audit_logs(actor_user_id,action,target_type,target_id,request_id,metadata) values($1,$2,$3,$4,$5,$6)",
    [actorId, action, targetType, targetId, requestId, metadata],
  );
}
