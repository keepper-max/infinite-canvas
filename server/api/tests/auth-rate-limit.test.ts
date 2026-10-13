import assert from "node:assert/strict";
import test from "node:test";
import { AuthRateLimiter, authAttemptInput, forwardedClientIp, type AuthRateLimiterPort } from "../src/auth-rate-limit.js";
import { createApp } from "../src/app.js";
import { DomainError } from "../src/domain.js";

test("new and legacy auth entries share normalized account budgets", () => {
  assert.deepEqual(authAttemptInput("/api/auth/login", { email: "USER@example.com" }), authAttemptInput("/api/auth/login/password", { account: " user@example.com " }));
  assert.deepEqual(authAttemptInput("/api/auth/login/phone", { account: "+86 13800138000" }), authAttemptInput("/api/auth/login/phone", { account: "13800138000" }));
  assert.equal(authAttemptInput("/api/auth/password-reset/request", { email: "a@example.com" })?.kind, "send");
  assert.equal(authAttemptInput("/api/auth/register", { email: "a@example.com", verificationCode: "000000" })?.kind, "code");
  assert.equal(authAttemptInput("/api/auth/password/change", { email: "a@example.com" }), null);
  assert.equal(authAttemptInput("/api/auth/login", { email: "a@example.com", account: "other@example.com" })?.account, "email:a@example.com");
});

test("IP selection ignores spoofed headers and untrusted direct public peers", () => {
  const request = new Request("https://shoumiren.online", { headers: { "cf-connecting-ip": "1.1.1.1", "x-real-ip": "1.1.1.1", "x-forwarded-for": "1.1.1.1, 8.8.8.8, 127.0.0.1" } });
  assert.equal(forwardedClientIp(request, "172.18.0.4"), "8.8.8.8");
  assert.equal(forwardedClientIp(request, "9.9.9.9"), "9.9.9.9");
  assert.equal(forwardedClientIp(request), "unknown");
});

test("Redis limiter returns cooldown without leaking account identifiers and fails closed", async () => {
  let args: unknown[] = [];
  const limiter = new AuthRateLimiter({ eval: async (...input: unknown[]) => { args = input; return 10800; } } as any);
  await assert.rejects(limiter.reserve("password", "email:user@example.com", "8.8.8.8"), (error: any) => error.code === "AUTH_RATE_LIMITED" && error.details.retryAfterSeconds === 10800);
  assert(!args.join(" ").includes("user@example.com"));
  const unavailable = new AuthRateLimiter({ eval: async () => { throw new Error("offline"); } } as any);
  await assert.rejects(unavailable.reserve("code", "email:a@example.com", "8.8.8.8"), { code: "AUTH_GUARD_UNAVAILABLE" });
});

test("Hono auth middleware retains credential failures, shares aliases, and returns Retry-After", async () => {
  let count = 0;
  const retained: boolean[] = [];
  const limiter: AuthRateLimiterPort = {
    async reserve(kind) {
      if (count >= 5) throw new DomainError("AUTH_RATE_LIMITED", "限流", 429, true, { details: { retryAfterSeconds: 300 } });
      count++;
      return { kind, keys: [], member: "local-test" };
    },
    async finish(_attempt, retain) { retained.push(retain); if (!retain) count--; },
  };
  const app = createApp({ findUserByEmail: async () => null } as any, { trustedOrigins: [], cookieName: "local", cookieSecure: true } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, limiter);
  for (let i = 0; i < 5; i++) {
    const response = await app.request("https://shoumiren.online/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "a@example.com", password: "wrong-password" }) });
    assert.equal(response.status, 401);
  }
  assert.deepEqual(retained, [true, true, true, true, true]);
  const response = await app.request("https://shoumiren.online/api/auth/login/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: "email", account: "a@example.com", password: "wrong-password" }) });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "300");
});

test("verification sends and code errors use separate budgets and release non-credential errors", async () => {
  const calls: { kind: string; retain?: boolean }[] = [];
  const limiter: AuthRateLimiterPort = {
    async reserve(kind) { calls.push({ kind }); return { kind, keys: [], member: "local-test" }; },
    async finish(attempt, retain) { calls.push({ kind: attempt.kind, retain }); },
  };
  const repository = { findUserByEmail: async () => ({ id: "local", accountStatus: "active" }) } as any;
  const email = { requestCode: async () => {}, verifyCode: async () => { throw new DomainError("INVALID_VERIFICATION_CODE", "错误", 422); } } as any;
  const config = { trustedOrigins: [], cookieName: "local", emailVerification: { enabled: true, resendCooldownSeconds: 60 } } as any;
  const app = createApp(repository, config, undefined, undefined, undefined, undefined, undefined, undefined, undefined, email, undefined, undefined, limiter);
  const post = (path: string, body: object) => app.request(`https://shoumiren.online${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await post("/api/auth/email/send", { account: "a@example.com", purpose: "login" })).status, 200);
  assert.equal((await post("/api/auth/login/email", { account: "a@example.com", code: "123456" })).status, 422);
  assert.equal((await post("/api/auth/login/password", { channel: "invalid", account: "a@example.com", password: "x" })).status, 422);
  assert.deepEqual(calls, [{ kind: "send" }, { kind: "send", retain: true }, { kind: "code" }, { kind: "code", retain: true }, { kind: "password" }, { kind: "password", retain: false }]);
});
