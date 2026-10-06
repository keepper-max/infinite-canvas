import { createHash, createHmac, randomInt } from "node:crypto";

import type { Redis } from "ioredis";

import type { EmailVerificationConfig, SmsVerificationConfig } from "./config.js";
import { DomainError } from "./domain.js";

export type VerificationChannel = "email" | "sms";
export type VerificationPurpose = "register" | "login" | "password_reset";
export type VerificationConfig = Pick<
  EmailVerificationConfig | SmsVerificationConfig,
  "hashSecret" | "codeTtlSeconds" | "resendCooldownSeconds" | "maxSendsPerHour" | "maxSendsPerDay" | "maxSendsPerIpHour" | "maxAttempts"
>;
export type VerifiedCode = { channel: VerificationChannel; purpose: VerificationPurpose; account: string; fingerprint: string };

const RESERVE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 1 end
if tonumber(redis.call('GET', KEYS[2]) or '0') >= tonumber(ARGV[1]) then return 2 end
if tonumber(redis.call('GET', KEYS[3]) or '0') >= tonumber(ARGV[2]) then return 3 end
if tonumber(redis.call('GET', KEYS[4]) or '0') >= tonumber(ARGV[3]) then return 4 end
redis.call('SET', KEYS[1], '1', 'EX', ARGV[4])
local h=redis.call('INCR',KEYS[2]); if h==1 then redis.call('EXPIRE',KEYS[2],3600) end
local d=redis.call('INCR',KEYS[3]); if d==1 then redis.call('EXPIRE',KEYS[3],86400) end
local i=redis.call('INCR',KEYS[4]); if i==1 then redis.call('EXPIRE',KEYS[4],3600) end
return 0`;
const RELEASE_SCRIPT = `
redis.call('DEL',KEYS[1])
for i=2,4 do local n=tonumber(redis.call('GET',KEYS[i]) or '0'); if n>1 then redis.call('DECR',KEYS[i]) else redis.call('DEL',KEYS[i]) end end
return 1`;
const VERIFY_SCRIPT = `
local expected=redis.call('GET',KEYS[1]); if not expected then return 0 end
if expected==ARGV[1] then return 1 end
local n=redis.call('INCR',KEYS[2]); if n==1 then redis.call('EXPIRE',KEYS[2],ARGV[2]) end
if n>=tonumber(ARGV[3]) then redis.call('DEL',KEYS[1],KEYS[2]) end
return 0`;
const CONSUME_SCRIPT = `
local expected=redis.call('GET',KEYS[1]); if expected==ARGV[1] then redis.call('DEL',KEYS[1],KEYS[2]); return 1 end; return 0`;

export class VerificationCodeStore {
  constructor(private readonly redis: Redis) {}

  async request(input: { channel: VerificationChannel; purpose: VerificationPurpose; account: string; ip: string; config: VerificationConfig; deliver: (code: string) => Promise<void> }) {
    const keys = this.keys(input.channel, input.purpose, input.account, input.ip);
    const reserved = Number(await this.redis.eval(RESERVE_SCRIPT, 4, keys.cooldown, keys.hour, keys.day, keys.ip, input.config.maxSendsPerHour, input.config.maxSendsPerDay ?? 10, input.config.maxSendsPerIpHour, input.config.resendCooldownSeconds));
    if (reserved !== 0)
      throw new DomainError("VERIFICATION_RATE_LIMITED", "验证码发送过于频繁，请稍后重试", 429, true, { details: { retryAfterSeconds: reserved === 1 ? input.config.resendCooldownSeconds : 3_600 } });
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const hash = this.codeHash(input.config.hashSecret, input.channel, input.purpose, input.account, code);
    try {
      await input.deliver(code);
      await this.redis.multi().set(keys.code, hash, "EX", input.config.codeTtlSeconds).del(keys.attempts).exec();
    } catch (error) {
      await this.redis.eval(RELEASE_SCRIPT, 4, keys.cooldown, keys.hour, keys.day, keys.ip).catch(() => undefined);
      console.error("[verification] delivery failed", { channel: input.channel, type: error instanceof Error ? error.name : "UnknownError" });
      throw new DomainError("VERIFICATION_DELIVERY_FAILED", "验证码发送失败，请稍后重试", 503, true, { cause: error });
    }
  }

  async verify(channel: VerificationChannel, purpose: VerificationPurpose, account: string, code: string, config: VerificationConfig): Promise<VerifiedCode> {
    if (!/^\d{6}$/.test(code)) throw invalidCode();
    const keys = this.keys(channel, purpose, account, "verify");
    const hash = this.codeHash(config.hashSecret, channel, purpose, account, code);
    const valid = Number(await this.redis.eval(VERIFY_SCRIPT, 2, keys.code, keys.attempts, hash, config.codeTtlSeconds, config.maxAttempts));
    if (valid !== 1) throw invalidCode();
    return { channel, purpose, account, fingerprint: hash };
  }

  async consume(verified: VerifiedCode) {
    const keys = this.keys(verified.channel, verified.purpose, verified.account, "verify");
    return Number(await this.redis.eval(CONSUME_SCRIPT, 2, keys.code, keys.attempts, verified.fingerprint)) === 1;
  }

  private keys(channel: VerificationChannel, purpose: VerificationPurpose, account: string, ip: string) {
    const accountHash = createHash("sha256").update(account).digest("hex").slice(0, 32);
    const ipHash = createHash("sha256").update(ip || "unknown").digest("hex").slice(0, 32);
    const prefix = `verify:${channel}:${purpose}:${accountHash}`;
    return { code: prefix, attempts: `${prefix}:attempts`, cooldown: `limit:${channel}:${accountHash}:cooldown`, hour: `limit:${channel}:${accountHash}:hour`, day: `limit:${channel}:${accountHash}:day`, ip: `limit:verify:ip:${ipHash}:hour` };
  }

  private codeHash(secret: string, channel: string, purpose: string, account: string, code: string) {
    return createHmac("sha256", secret).update(`${channel}:${purpose}:${account}:${code}`).digest("hex");
  }
}

function invalidCode() {
  return new DomainError("INVALID_VERIFICATION_CODE", "验证码错误或已失效", 422);
}
