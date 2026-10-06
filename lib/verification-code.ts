import type IORedis from "ioredis";
import { createHmac, randomInt } from "node:crypto";
import { accountDigest, type VerificationChannel, type VerificationScene } from "@/lib/account-identifiers";
import { getRedis } from "@/lib/redis";

type LimitConfig = {
  expires: number;
  resend: number;
  accountHour: number;
  accountDay: number;
  ipHour: number;
  maxAttempts: number;
};

export class VerificationError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function positiveEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function getVerificationConfig(): LimitConfig {
  return {
    expires: positiveEnv("VERIFY_CODE_EXPIRE_SECONDS", 300),
    resend: positiveEnv("VERIFY_CODE_RESEND_SECONDS", 60),
    accountHour: positiveEnv("VERIFY_CODE_ACCOUNT_HOURLY_LIMIT", 5),
    accountDay: positiveEnv("VERIFY_CODE_ACCOUNT_DAILY_LIMIT", 10),
    ipHour: positiveEnv("VERIFY_CODE_IP_HOURLY_LIMIT", 30),
    maxAttempts: positiveEnv("VERIFY_CODE_MAX_ATTEMPTS", 5),
  };
}

export function generateVerificationCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function secret() {
  const value = process.env.VERIFICATION_CODE_SECRET ?? process.env.SESSION_SECRET;
  if (!value || value.length < 16) throw new VerificationError(503, "验证码服务暂不可用");
  return value;
}

export function hashVerificationCode(channel: VerificationChannel, scene: VerificationScene, account: string, code: string) {
  return createHmac("sha256", secret()).update(`${channel}:${scene}:${account}:${code}`).digest("hex");
}

function keys(channel: VerificationChannel, scene: VerificationScene, account: string, ip: string) {
  const accountKey = accountDigest(account);
  const ipKey = accountDigest(ip);
  const prefix = `verify:${channel}:${scene}:${accountKey}`;
  return {
    code: prefix,
    attempts: `${prefix}:attempts`,
    cooldown: `limit:${channel}:${accountKey}:cooldown`,
    hour: `limit:${channel}:${accountKey}:hour`,
    day: `limit:${channel}:${accountKey}:day`,
    ip: `limit:verify:ip:${ipKey}:hour`,
  };
}

const RESERVE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 1 end
if tonumber(redis.call('GET', KEYS[2]) or '0') >= tonumber(ARGV[1]) then return 2 end
if tonumber(redis.call('GET', KEYS[3]) or '0') >= tonumber(ARGV[2]) then return 3 end
if tonumber(redis.call('GET', KEYS[4]) or '0') >= tonumber(ARGV[3]) then return 4 end
redis.call('SET', KEYS[1], '1', 'EX', ARGV[4])
local hour = redis.call('INCR', KEYS[2]); if hour == 1 then redis.call('EXPIRE', KEYS[2], 3600) end
local day = redis.call('INCR', KEYS[3]); if day == 1 then redis.call('EXPIRE', KEYS[3], 86400) end
local ip = redis.call('INCR', KEYS[4]); if ip == 1 then redis.call('EXPIRE', KEYS[4], 3600) end
return 0`;

const RELEASE_SCRIPT = `
redis.call('DEL', KEYS[1])
for index = 2, 4 do
  local count = tonumber(redis.call('GET', KEYS[index]) or '0')
  if count > 1 then redis.call('DECR', KEYS[index]) else redis.call('DEL', KEYS[index]) end
end
return 1`;

const VERIFY_SCRIPT = `
local expected = redis.call('GET', KEYS[1])
if expected and expected == ARGV[1] then
  redis.call('DEL', KEYS[1], KEYS[2])
  return 1
end
local attempts = redis.call('INCR', KEYS[2])
if attempts == 1 then redis.call('EXPIRE', KEYS[2], ARGV[2]) end
if attempts >= tonumber(ARGV[3]) then redis.call('DEL', KEYS[1], KEYS[2]) end
return 0`;

export class VerificationCodeService {
  constructor(private readonly redis: IORedis = getRedis()) {}

  async send(input: {
    channel: VerificationChannel;
    scene: VerificationScene;
    account: string;
    ip: string;
    deliver: (code: string) => Promise<void>;
  }) {
    const config = getVerificationConfig();
    const key = keys(input.channel, input.scene, input.account, input.ip);
    const limit = Number(await this.redis.eval(
      RESERVE_SCRIPT, 4, key.cooldown, key.hour, key.day, key.ip,
      config.accountHour, config.accountDay, config.ipHour, config.resend,
    ));
    if (limit !== 0) throw new VerificationError(429, "验证码发送过于频繁，请稍后再试");
    const code = generateVerificationCode();
    try {
      await input.deliver(code);
      await this.redis.multi()
        .set(key.code, hashVerificationCode(input.channel, input.scene, input.account, code), "EX", config.expires)
        .del(key.attempts)
        .exec();
    } catch (error) {
      await this.redis.eval(RELEASE_SCRIPT, 4, key.cooldown, key.hour, key.day, key.ip).catch(() => undefined);
      console.error("[verification] delivery failed", { type: error instanceof Error ? error.name : "UnknownError" });
      throw new VerificationError(503, "验证码发送失败，请稍后重试");
    }
  }

  async verify(input: { channel: VerificationChannel; scene: VerificationScene; account: string; code: string }) {
    if (!/^\d{6}$/.test(input.code)) throw new VerificationError(400, "验证码错误或已失效");
    const config = getVerificationConfig();
    const key = keys(input.channel, input.scene, input.account, "verification");
    const actual = hashVerificationCode(input.channel, input.scene, input.account, input.code);
    const matches = Number(await this.redis.eval(VERIFY_SCRIPT, 2, key.code, key.attempts, actual, config.expires, config.maxAttempts));
    if (matches === 1) return;
    throw new VerificationError(400, "验证码错误或已失效");
  }
}
