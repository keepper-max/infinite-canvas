import type { Pool } from "pg";

import type { ProviderConfig } from "./config.js";
import type { CreditService } from "./credit-service.js";
import { DomainError } from "./domain.js";

const TERMINAL_JOB_STATUSES = ["completed", "failed", "cancelled"];
const RECONCILE_DELAYS_SECONDS = [30, 120, 300, 900];
const MAX_RECONCILE_AGE_MS = 24 * 60 * 60 * 1_000;

export class BillingService {
  constructor(
    private readonly pool: Pool,
    private readonly config: ProviderConfig,
    private readonly credits?: CreditService,
  ) {}

  async recordTrace(
    jobId: string,
    traceId?: string,
    usage?: Record<string, unknown>,
  ) {
    const effectiveTrace = traceId || jobId;
    await this.pool.query(
      `update generation_jobs set billing_trace_id=$2,
        billing_status=case when $2<>id::text then 'mismatch' else 'pending' end,
        billing_next_check_at=coalesce(billing_next_check_at,now()),
        billing_meter_usage=billing_meter_usage||$3::jsonb,updated_at=now()
       where id=$1`,
      [jobId, effectiveTrace, JSON.stringify(usage || {})],
    );
  }

  async recordMeterUsage(jobId: string, usage?: Record<string, unknown>) {
    if (!usage || !Object.keys(usage).length) return;
    await this.pool.query(
      `update generation_jobs set billing_meter_usage=billing_meter_usage||$2::jsonb,updated_at=now()
       where id=$1`,
      [jobId, JSON.stringify(usage)],
    );
  }

  async finalizeProviderUsage(jobId: string) {
    const result = await this.pool.query(
      "select * from generation_jobs where id=$1",
      [jobId],
    );
    const job = result.rows[0];
    if (!job) return { status: "missing" };
    if (!isRunningHubProvider(job.provider))
      return { status: String(job.billing_status || "pending") };
    return this.settleRunningHub(job);
  }

  async runDue(limit = 20) {
    const due = await this.pool.query(
      `select id from generation_jobs where status=any($1::text[]) and billing_trace_id is not null
        and (billing_status in ('pending','reconciling') or (billing_status='mismatch' and billing_next_check_at is not null))
        and coalesce(billing_next_check_at,now())<=now()
        order by coalesce(billing_next_check_at,created_at),created_at limit $2`,
      [TERMINAL_JOB_STATUSES, limit],
    );
    for (const row of due.rows) await this.reconcileJob(String(row.id));
    await this.credits?.runPending(limit);
    return due.rowCount || 0;
  }

  async reconcileJob(jobId: string, force = false) {
    const claimed = await this.pool.query(
      `update generation_jobs set billing_status='reconciling',billing_last_checked_at=now(),
        billing_attempt_count=billing_attempt_count+1,billing_started_at=coalesce(billing_started_at,now()),
        billing_next_check_at=now()+interval '5 minutes',updated_at=now()
       where id=$1 and billing_trace_id is not null
         and ($2::boolean or (
           (billing_status in ('pending','reconciling') or (billing_status='mismatch' and billing_next_check_at is not null))
           and coalesce(billing_next_check_at,now())<=now()
         )) returning *`,
      [jobId, force],
    );
    const job = claimed.rows[0];
    if (!job) {
      const existing = await this.pool.query(
        "select id,billing_status from generation_jobs where id=$1",
        [jobId],
      );
      if (existing.rows[0])
        return { status: String(existing.rows[0].billing_status) };
      throw new DomainError("BILLING_JOB_NOT_FOUND", "找不到可对账任务", 404);
    }
    if (isRunningHubProvider(job.provider)) return this.settleRunningHub(job);
    if (job.provider !== "token360") {
      await this.finishUnavailable(jobId, "外部渠道无法进行 Token360 对账");
      return { status: "unavailable" };
    }
    try {
      const response = await fetch(
        `${this.config.baseUrl}/v1/billing/requests/${encodeURIComponent(String(job.billing_trace_id))}`,
        {
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            Accept: "application/json",
          },
        },
      );
      if (response.status === 404) return this.reschedule(job);
      if (!response.ok) {
        await this.markFailed(jobId, `账单接口返回 HTTP ${response.status}`);
        return { status: "failed" };
      }
      const envelope = asRecord(await response.json());
      const data = asRecord(envelope.data || envelope);
      const requestId =
        stringValue(data.request_id) || String(job.billing_trace_id);
      const usage = {
        ...asRecord(job.billing_meter_usage),
        ...asRecord(data.usage),
      };
      const billed = booleanValue(data.billed);
      const amountFinal = decimalValue(data.amount_final);
      const totalAmount = decimalValue(data.total_amount);
      const currency = stringValue(data.currency)?.toUpperCase();
      if (
        billed !== true ||
        !currency ||
        (amountFinal === null && totalAmount === null)
      ) {
        return this.reschedule(job);
      }
      const mismatch =
        requestId !== String(job.id) ||
        String(job.billing_trace_id) !== String(job.id);
      await this.pool.query(
        `insert into generation_usage(job_id,project_id,user_id,billing_request_id,provider,model_id,capability,status,billed,credit_status,
          prompt_tokens,completion_tokens,input_tokens,output_tokens,total_tokens,generated_images,audio_duration_seconds,
          video_duration_seconds,requested_seconds,amount_base,amount_final,total_amount,wallet_amount,voucher_amount,price,
          currency,provider_request_id,usage,reconciled_at,updated_at)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,now(),now())
         on conflict(job_id) do update set billing_request_id=excluded.billing_request_id,status=excluded.status,billed=excluded.billed,
          credit_status=case when generation_usage.credit_status in ('charged','free','historical') then generation_usage.credit_status else 'pending' end,
          prompt_tokens=excluded.prompt_tokens,completion_tokens=excluded.completion_tokens,input_tokens=excluded.input_tokens,
          output_tokens=excluded.output_tokens,total_tokens=excluded.total_tokens,generated_images=excluded.generated_images,
          audio_duration_seconds=excluded.audio_duration_seconds,video_duration_seconds=excluded.video_duration_seconds,
          requested_seconds=excluded.requested_seconds,amount_base=excluded.amount_base,amount_final=excluded.amount_final,
          total_amount=excluded.total_amount,wallet_amount=excluded.wallet_amount,voucher_amount=excluded.voucher_amount,
          price=excluded.price,currency=excluded.currency,provider_request_id=excluded.provider_request_id,usage=excluded.usage,
          reconciled_at=now(),updated_at=now()`,
        [
          job.id,
          job.project_id,
          job.created_by,
          requestId,
          job.provider,
          job.model_id,
          job.capability,
          stringValue(data.bill_record_status) || stringValue(data.status),
          billed,
          integerValue(usage.prompt_tokens),
          integerValue(usage.completion_tokens),
          integerValue(usage.input_tokens),
          integerValue(usage.output_tokens),
          integerValue(usage.total_tokens),
          integerValue(
            usage.generated_images ||
              usage.image_count ||
              (job.capability === "image" ? usage.sample_count : undefined),
          ),
          decimalValue(
            usage.audio_duration_seconds ||
              (job.capability === "audio" ? usage.seconds : undefined),
          ),
          decimalValue(
            usage.video_duration_seconds ||
              (job.capability === "video" ? usage.seconds : undefined),
          ),
          decimalValue(usage.requested_seconds),
          decimalValue(data.amount_base),
          amountFinal,
          totalAmount,
          decimalValue(data.wallet_amount),
          decimalValue(data.voucher_amount),
          decimalValue(data.price),
          currency,
          stringValue(usage.provider_request_id) || stringValue(data.id),
          JSON.stringify(usage),
        ],
      );
      await this.pool.query(
        "update generation_jobs set billing_status=$2,billing_error=null,billing_next_check_at=null,billing_last_checked_at=now(),updated_at=now() where id=$1",
        [jobId, mismatch ? "mismatch" : "settled"],
      );
      await this.credits?.settleUsage(jobId).catch(() => undefined);
      return { status: mismatch ? "mismatch" : "settled", requestId };
    } catch (error) {
      await this.markFailed(
        jobId,
        error instanceof Error ? error.message : "账单对账失败",
      );
      return { status: "failed" };
    }
  }

  private async reschedule(job: Record<string, unknown>) {
    const started =
      dateValue(job.billing_started_at) ||
      dateValue(job.finished_at) ||
      new Date();
    if (Date.now() - started.getTime() >= MAX_RECONCILE_AGE_MS) {
      await this.pool.query(
        "update generation_jobs set billing_status='not_billed',billing_error='24 小时内未查询到账单',billing_next_check_at=null,updated_at=now() where id=$1",
        [job.id],
      );
      return { status: "not_billed" };
    }
    const attempt = Number(job.billing_attempt_count || 1);
    const delay = RECONCILE_DELAYS_SECONDS[Math.max(0, attempt - 1)] || 3600;
    await this.pool.query(
      `update generation_jobs set billing_status=case when billing_trace_id<>id::text then 'mismatch' else 'pending' end,
        billing_error=null,billing_next_check_at=now()+($2::text||' seconds')::interval,updated_at=now() where id=$1`,
      [job.id, delay],
    );
    return { status: "pending", retryAfterSeconds: delay };
  }

  private async markFailed(jobId: string, message: string) {
    await this.pool.query(
      "update generation_jobs set billing_status='failed',billing_error=$2,billing_next_check_at=null,updated_at=now() where id=$1",
      [jobId, sanitize(message)],
    );
  }

  private async settleRunningHub(job: Record<string, unknown>) {
    const usage = asRecord(job.billing_meter_usage);
    const providerPaidAmount =
      decimalValue(usage.third_party_consume_money) ||
      decimalValue(usage.consume_money);
    const originalAmount = runningHubOriginalAmount(job.model_id, providerPaidAmount);
    const normalizedUsage =
      providerPaidAmount !== null && originalAmount !== providerPaidAmount
        ? {
            ...usage,
            provider_paid_amount: providerPaidAmount,
            original_amount: originalAmount,
            billing_discount_rate: "0.8",
            billing_amount_source: "seedance_2_5_discount_restore",
          }
        : usage;
    const promptTokens = integerValue(usage.prompt_tokens);
    const completionTokens = integerValue(usage.completion_tokens);
    const totalTokens = integerValue(usage.total_tokens);
    const billingSeconds = decimalValue(usage.billing_seconds);
    const consumedCoins = decimalValue(usage.consume_coins);
    if (
      providerPaidAmount === null &&
      promptTokens === null &&
      completionTokens === null &&
      totalTokens === null &&
      billingSeconds === null &&
      consumedCoins === null
    ) {
      await this.finishUnavailable(
        String(job.id),
        "海马云终态未返回可记录的实际用量",
      );
      return { status: "unavailable" };
    }
    const providerRequestId =
      stringValue(usage.provider_request_id) ||
      stringValue(job.provider_job_id) ||
      String(job.id);
    const billingRequestId = `${String(job.provider)}:${providerRequestId}`;
    const parameters = asRecord(job.parameters);
    // RunningHub's consume-money fields are denominated in CNY. Do not let an
    // incidental currency label route these charges through USD conversion.
    const currency = "CNY";
    await this.pool.query(
      `insert into generation_usage(job_id,project_id,user_id,billing_request_id,provider,model_id,capability,status,billed,credit_status,
        prompt_tokens,completion_tokens,total_tokens,audio_duration_seconds,video_duration_seconds,requested_seconds,
        amount_final,total_amount,currency,provider_request_id,usage,reconciled_at,updated_at)
       values($1,$2,$3,$4,$5,$6,$7,'settled',$8,'pending',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,now(),now())
       on conflict(job_id) do update set billing_request_id=excluded.billing_request_id,status=excluded.status,
        credit_status=case when generation_usage.credit_status in ('charged','free','historical') then generation_usage.credit_status else 'pending' end,
        billed=excluded.billed,prompt_tokens=excluded.prompt_tokens,completion_tokens=excluded.completion_tokens,
        total_tokens=excluded.total_tokens,audio_duration_seconds=excluded.audio_duration_seconds,
        video_duration_seconds=excluded.video_duration_seconds,requested_seconds=excluded.requested_seconds,
        amount_final=excluded.amount_final,total_amount=excluded.total_amount,currency=excluded.currency,provider_request_id=excluded.provider_request_id,
        usage=excluded.usage,reconciled_at=now(),updated_at=now()`,
      [
        job.id,
        job.project_id,
        job.created_by,
        billingRequestId,
        job.provider,
        job.model_id,
        job.capability,
        providerPaidAmount !== null,
        promptTokens,
        completionTokens,
        totalTokens,
        job.capability === "audio" ? billingSeconds : null,
        job.capability === "video" ? billingSeconds : null,
        decimalValue(parameters.duration),
        providerPaidAmount,
        originalAmount,
        currency,
        providerRequestId,
        JSON.stringify(normalizedUsage),
      ],
    );
    await this.pool.query(
      "update generation_jobs set billing_status='settled',billing_error=null,billing_next_check_at=null,billing_last_checked_at=now(),updated_at=now() where id=$1",
      [job.id],
    );
    await this.credits?.settleUsage(String(job.id)).catch(() => undefined);
    return { status: "settled", requestId: billingRequestId };
  }

  private async finishUnavailable(jobId: string, message: string) {
    await this.pool.query(
      "update generation_jobs set billing_status='unavailable',billing_error=$2,billing_next_check_at=null,updated_at=now() where id=$1",
      [jobId, message],
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function isRunningHubProvider(value: unknown) {
  return value === "runninghub" || value === "runninghub_global";
}
export function runningHubOriginalAmount(modelId: unknown, providerPaidAmount: string | null) {
  if (providerPaidAmount === null || !isSeedance25Model(modelId)) return providerPaidAmount;
  return multiplyDecimalRatio(providerPaidAmount, 5n, 4n);
}
function isSeedance25Model(value: unknown) {
  const modelId = String(value || "").toLowerCase();
  return (
    modelId.includes("seedance-2.5") ||
    modelId.includes("seedance-2-5") ||
    modelId.includes("seedance_2_5")
  );
}
function multiplyDecimalRatio(value: string, numerator: bigint, denominator: bigint) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const fraction = match[2] || "";
  const scale = 10n ** BigInt(fraction.length);
  const scaled = BigInt(match[1]!) * scale + BigInt(fraction || "0");
  let product = scaled * numerator;
  let places = fraction.length;
  while (product % denominator !== 0n && places < 8) {
    product *= 10n;
    places += 1;
  }
  const result = product / denominator;
  const digits = result.toString().padStart(places + 1, "0");
  if (!places) return digits;
  const whole = digits.slice(0, -places) || "0";
  const decimal = digits.slice(-places).replace(/0+$/, "");
  return decimal ? `${whole}.${decimal}` : whole;
}
function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function integerValue(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
function decimalValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? String(value) : null;
}
function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : null;
}
function dateValue(value: unknown) {
  if (value instanceof Date) return value;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function sanitize(value: string) {
  return value
    .replace(/(bearer\s+|sk-)[a-z0-9._-]+/gi, "$1***")
    .replace(/https?:\/\/\S+/gi, "[URL]")
    .slice(0, 1_000);
}
