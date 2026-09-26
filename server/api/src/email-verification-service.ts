import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import DmClientModule, { SingleSendMailRequest } from "@alicloud/dm20151123";
import { $OpenApiUtil } from "@alicloud/openapi-core";
import type { Pool, PoolClient } from "pg";

import type { EmailVerificationConfig } from "./config.js";
import { DomainError } from "./domain.js";

export type VerifiedEmailCode = { id: string; email: string };

export interface EmailVerificationServicePort {
  requestCode(email: string, requestIp: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<VerifiedEmailCode>;
  consumeCode(verification: VerifiedEmailCode): Promise<void>;
}

export class EmailVerificationService implements EmailVerificationServicePort {
  private readonly mailClient: InstanceType<typeof DmClientModule.default>;

  constructor(
    private readonly pool: Pool,
    private readonly config: EmailVerificationConfig,
  ) {
    this.mailClient = new DmClientModule.default(
      new $OpenApiUtil.Config({
        accessKeyId: config.accessKeyId,
        accessKeySecret: config.accessKeySecret,
        regionId: "cn-hangzhou",
        endpoint: "dm.aliyuncs.com",
      }),
    );
  }

  async requestCode(email: string, requestIp: string) {
    const code = String(randomInt(100_000, 1_000_000));
    const requestIpHash = this.digest(`ip:${requestIp || "unknown"}`);
    const client = await this.pool.connect();
    let verificationId = "";
    try {
      await client.query("begin");
      await client.query(
        "delete from email_verification_codes where created_at < now() - interval '30 days'",
      );
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [email]);
      await this.enforceSendLimits(client, email, requestIpHash);
      await client.query(
        `update email_verification_codes
         set status = 'superseded'
         where email = $1 and purpose = 'register' and status = 'pending'`,
        [email],
      );
      const inserted = await client.query<{ id: string }>(
        `insert into email_verification_codes
           (email, code_hash, request_ip_hash, expires_at)
         values ($1, '', $2, now() + ($3 * interval '1 second'))
         returning id`,
        [email, requestIpHash, this.config.codeTtlSeconds],
      );
      verificationId = inserted.rows[0]!.id;
      await client.query(
        "update email_verification_codes set code_hash = $1 where id = $2",
        [this.codeHash(verificationId, email, code), verificationId],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    try {
      await this.sendCode(email, code);
    } catch (error) {
      await this.pool
        .query(
          "update email_verification_codes set status = 'send_failed' where id = $1",
          [verificationId],
        )
        .catch(() => undefined);
      throw new DomainError(
        "VERIFICATION_EMAIL_UNAVAILABLE",
        "验证码暂时无法发送，请稍后重试",
        503,
        true,
        { cause: error },
      );
    }
  }

  async verifyCode(email: string, code: string): Promise<VerifiedEmailCode> {
    const result = await this.pool.query<{
      id: string;
      code_hash: string;
      attempts: number;
      expires_at: Date;
    }>(
      `select id, code_hash, attempts, expires_at
       from email_verification_codes
       where email = $1 and purpose = 'register' and status = 'pending'
       order by created_at desc
       limit 1`,
      [email],
    );
    const record = result.rows[0];
    if (!record)
      throw invalidVerificationCode();
    if (record.expires_at.getTime() <= Date.now()) {
      await this.pool.query(
        "update email_verification_codes set status = 'expired' where id = $1 and status = 'pending'",
        [record.id],
      );
      throw invalidVerificationCode();
    }
    if (record.attempts >= this.config.maxAttempts) {
      await this.failCode(record.id);
      throw invalidVerificationCode();
    }

    const actual = Buffer.from(record.code_hash, "hex");
    const expected = Buffer.from(this.codeHash(record.id, email, code), "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      const attempts = record.attempts + 1;
      await this.pool.query(
        `update email_verification_codes
         set attempts = $2, status = case when $2 >= $3 then 'failed' else status end
         where id = $1 and status = 'pending'`,
        [record.id, attempts, this.config.maxAttempts],
      );
      throw invalidVerificationCode();
    }
    return { id: record.id, email };
  }

  async consumeCode(verification: VerifiedEmailCode) {
    await this.pool.query(
      `update email_verification_codes
       set status = 'consumed', consumed_at = now()
       where id = $1 and email = $2 and status = 'pending'`,
      [verification.id, verification.email],
    );
  }

  private async enforceSendLimits(
    client: PoolClient,
    email: string,
    requestIpHash: string,
  ) {
    const latest = await client.query<{ created_at: Date }>(
      `select created_at from email_verification_codes
       where email = $1 and purpose = 'register' and status = 'pending'
       order by created_at desc limit 1`,
      [email],
    );
    if (
      latest.rows[0] &&
      Date.now() - latest.rows[0].created_at.getTime() <
        this.config.resendCooldownSeconds * 1_000
    )
      throw rateLimitError(this.config.resendCooldownSeconds);

    const counts = await client.query<{ email_count: string; ip_count: string }>(
      `select
         count(*) filter (where email = $1)::text as email_count,
         count(*) filter (where request_ip_hash = $2)::text as ip_count
       from email_verification_codes
       where created_at > now() - interval '1 hour'
         and status <> 'send_failed'`,
      [email, requestIpHash],
    );
    if (
      Number(counts.rows[0]?.email_count || 0) >= this.config.maxSendsPerHour ||
      Number(counts.rows[0]?.ip_count || 0) >= this.config.maxSendsPerIpHour
    )
      throw rateLimitError(3_600);
  }

  private async failCode(id: string) {
    await this.pool.query(
      "update email_verification_codes set status = 'failed' where id = $1 and status = 'pending'",
      [id],
    );
  }

  private async sendCode(email: string, code: string) {
    const minutes = Math.ceil(this.config.codeTtlSeconds / 60);
    await this.mailClient.singleSendMail(
      new SingleSendMailRequest({
        accountName: this.config.accountName,
        addressType: 1,
        replyToAddress: false,
        toAddress: email,
        fromAlias: this.config.fromAlias,
        subject: "守守画布注册验证码",
        clickTrace: "0",
        textBody: `你的守守画布注册验证码是：${code}。验证码 ${minutes} 分钟内有效，请勿转发给他人。`,
        htmlBody: `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#222;line-height:1.7"><h2>守守画布注册验证码</h2><p>你的验证码是：</p><p style="font-size:30px;font-weight:700;letter-spacing:6px">${code}</p><p>验证码 ${minutes} 分钟内有效，请勿转发给他人。</p><p style="color:#777">如非本人操作，请忽略此邮件。</p></div>`,
      }),
    );
  }

  private codeHash(id: string, email: string, code: string) {
    return this.digest(`code:${id}:${email}:${code}`);
  }

  private digest(value: string) {
    return createHmac("sha256", this.config.hashSecret)
      .update(value)
      .digest("hex");
  }
}

function invalidVerificationCode() {
  return new DomainError(
    "INVALID_VERIFICATION_CODE",
    "验证码无效或已过期，请重新获取",
    422,
  );
}

function rateLimitError(retryAfterSeconds: number) {
  return new DomainError(
    "VERIFICATION_RATE_LIMITED",
    "验证码发送过于频繁，请稍后重试",
    429,
    true,
    { details: { retryAfterSeconds } },
  );
}
