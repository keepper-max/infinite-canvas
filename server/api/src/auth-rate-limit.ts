import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import type { Redis } from "ioredis";
import { DomainError } from "./domain.js";

export type AuthAttemptKind = "password" | "code" | "send";
export type AuthAttempt = { keys: string[]; member: string; kind: AuthAttemptKind };
export interface AuthRateLimiterPort {
  reserve(kind: AuthAttemptKind, account: string, ip: string): Promise<AuthAttempt>;
  finish(attempt: AuthAttempt, retain: boolean): Promise<void>;
}

// In-flight reservations prevent parallel guesses bypassing the failure budget.
export const AUTH_RESERVE_SCRIPT = `
local blocked=redis.call('TTL',KEYS[3]); if blocked>0 then return blocked end
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ARGV[1]-300000)
redis.call('ZREMRANGEBYSCORE',KEYS[2],'-inf',ARGV[1]-900000)
if redis.call('ZCARD',KEYS[1])>=5 then
 local first=redis.call('ZRANGE',KEYS[1],0,0,'WITHSCORES'); return math.max(1,math.ceil((tonumber(first[2])+300000-ARGV[1])/1000))
end
if ARGV[3]~='send' and redis.call('ZCARD',KEYS[2])>=10 then return 1 end
redis.call('ZADD',KEYS[1],ARGV[1],ARGV[2]); redis.call('EXPIRE',KEYS[1],300)
if ARGV[3]~='send' then redis.call('ZADD',KEYS[2],ARGV[1],ARGV[2]); redis.call('EXPIRE',KEYS[2],900) end
return 0`;
export const AUTH_FINISH_SCRIPT = `
if ARGV[2]=='0' then redis.call('ZREM',KEYS[1],ARGV[1]); redis.call('ZREM',KEYS[2],ARGV[1])
elseif ARGV[3]~='send' then
 redis.call('ZREMRANGEBYSCORE',KEYS[4],'-inf',ARGV[4]-900000)
 redis.call('ZADD',KEYS[4],ARGV[4],ARGV[1]); redis.call('EXPIRE',KEYS[4],900)
 if redis.call('ZCARD',KEYS[4])>=10 then redis.call('SET',KEYS[3],'1','EX',10800,'NX') end
end
return 1`;

export class AuthRateLimiter implements AuthRateLimiterPort {
  constructor(private readonly redis: Redis) {}
  async reserve(kind: AuthAttemptKind, account: string, ip: string): Promise<AuthAttempt> {
    const digest = (value: string) => createHash("sha256").update(value).digest("hex");
    const keys = [`auth-limit:${kind}:${digest(account)}`, `auth-limit:ip:${digest(ip)}`, `auth-limit:blocked:${digest(ip)}`, `auth-limit:ip-failures:${digest(ip)}`];
    const member = randomUUID();
    let retryAfterSeconds: number;
    try { retryAfterSeconds = Number(await this.redis.eval(AUTH_RESERVE_SCRIPT, 4, ...keys, Date.now(), member, kind)); }
    catch { throw new DomainError("AUTH_GUARD_UNAVAILABLE", "登录安全服务暂时不可用，请稍后重试", 503, true); }
    if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds < 0)
      throw new DomainError("AUTH_GUARD_UNAVAILABLE", "登录安全服务暂时不可用，请稍后重试", 503, true);
    if (retryAfterSeconds > 0)
      throw new DomainError("AUTH_RATE_LIMITED", `尝试过于频繁，请在 ${Math.ceil(retryAfterSeconds / 60)} 分钟后重试`, 429, true, { details: { retryAfterSeconds } });
    return { keys, member, kind };
  }
  async finish(attempt: AuthAttempt, retain: boolean) {
    try { await this.redis.eval(AUTH_FINISH_SCRIPT, 4, ...attempt.keys, attempt.member, retain ? "1" : "0", attempt.kind, Date.now()); }
    catch { throw new DomainError("AUTH_GUARD_UNAVAILABLE", "登录安全服务暂时不可用，请稍后重试", 503, true); }
  }
}

export function authAttemptInput(path: string, body: Record<string, unknown>): { kind: AuthAttemptKind; account: string } | null {
  let kind: AuthAttemptKind;
  if (["/api/auth/login", "/api/auth/login/password"].includes(path)) kind = "password";
  else if (["/api/auth/email/send", "/api/auth/sms/send", "/api/auth/email-verification/request", "/api/auth/password-reset/request"].includes(path)) kind = "send";
  else if (["/api/auth/login/email", "/api/auth/login/phone", "/api/auth/register/email", "/api/auth/register/phone", "/api/auth/password-reset/confirm"].includes(path) || (path === "/api/auth/register" && body.verificationCode !== undefined)) kind = "code";
  else return null;
  const legacyEmailEntry = ["/api/auth/login", "/api/auth/register", "/api/auth/email-verification/request", "/api/auth/password-reset/request", "/api/auth/password-reset/confirm"].includes(path);
  const value = legacyEmailEntry ? body.email : body.account;
  if (typeof value !== "string" || !value.trim() || value.length > 320) return null;
  const normalized = value.includes("@") ? value.trim().toLowerCase() : value.replace(/[\s-]/g, "").replace(/^\+?86/, "");
  return { kind, account: normalized.includes("@") ? `email:${normalized}` : `phone:${normalized}` };
}

// XFF is appended by each proxy. Ignore attacker-supplied CF/X-Real-IP and the
// leftmost XFF value; use the nearest public hop, behind private tunnel hops.
export function forwardedClientIp(request: Request, peerAddress?: string) {
  if (peerAddress && isIP(peerAddress)) {
    const peer = ipaddr.process(peerAddress);
    if (peer.range() === "unicast") return peer.toString();
    if (!["private", "loopback", "uniqueLocal"].includes(peer.range())) return "unknown";
  } else return "unknown";
  const values = (request.headers.get("x-forwarded-for") || "").split(",").map((value) => value.trim());
  for (const value of values.reverse()) {
    if (isIP(value) && ipaddr.process(value).range() === "unicast") return ipaddr.process(value).toString();
  }
  return "unknown";
}
