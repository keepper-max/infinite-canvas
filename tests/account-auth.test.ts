import assert from "node:assert/strict";
import test from "node:test";
import type IORedis from "ioredis";
import { maskEmail, maskPhone, normalizeEmail, normalizePhone } from "../lib/account-identifiers";
import { generateVerificationCode, VerificationCodeService, VerificationError } from "../lib/verification-code";

class FakeRedis {
  data = new Map<string, string>();
  attempts = new Map<string, number>();
  evalCalls = 0;

  async eval(script: string, numberOfKeys: number, ...args: Array<string | number>) {
    this.evalCalls += 1;
    const keys = args.slice(0, numberOfKeys).map(String);
    const values = args.slice(numberOfKeys).map(String);
    if (script.includes("local expected")) {
      const expected = this.data.get(keys[0]);
      if (expected && expected === values[0]) {
        this.data.delete(keys[0]); this.attempts.delete(keys[1]);
        return 1;
      }
      const attempts = (this.attempts.get(keys[1]) ?? 0) + 1;
      this.attempts.set(keys[1], attempts);
      if (attempts >= Number(values[2])) { this.data.delete(keys[0]); this.attempts.delete(keys[1]); }
      return 0;
    }
    if (script.includes("for index = 2")) {
      this.data.delete(keys[0]);
      for (const key of keys.slice(1)) {
        const count = Number(this.data.get(key) ?? 0);
        if (count > 1) this.data.set(key, String(count - 1)); else this.data.delete(key);
      }
      return 1;
    }
    if (this.data.has(keys[0])) return 1;
    if (Number(this.data.get(keys[1]) ?? 0) >= Number(values[0])) return 2;
    if (Number(this.data.get(keys[2]) ?? 0) >= Number(values[1])) return 3;
    if (Number(this.data.get(keys[3]) ?? 0) >= Number(values[2])) return 4;
    this.data.set(keys[0], "1");
    for (const key of keys.slice(1)) this.data.set(key, String(Number(this.data.get(key) ?? 0) + 1));
    return 0;
  }

  multi() {
    const operations: Array<() => void> = [];
    const chain = {
      set: (key: string, value: string) => { operations.push(() => this.data.set(key, value)); return chain; },
      del: (key: string) => { operations.push(() => this.data.delete(key)); return chain; },
      exec: async () => { operations.forEach((operation) => operation()); return []; },
    };
    return chain;
  }
}

test("手机号与邮箱统一规范化并可安全脱敏", () => {
  assert.equal(normalizePhone("138 0013 8000"), "+8613800138000");
  assert.equal(normalizePhone("+86 13800138000"), "+8613800138000");
  assert.throws(() => normalizePhone("12800138000"), /手机号格式不正确/);
  assert.equal(normalizeEmail(" User@Example.COM "), "user@example.com");
  assert.equal(maskPhone("+8613800138000"), "138****8000");
  assert.equal(maskEmail("account@example.com"), "a***@example.com");
});

test("验证码使用安全随机六位数字", () => {
  for (let index = 0; index < 100; index += 1) assert.match(generateVerificationCode(), /^\d{6}$/);
});

test("验证码发送后哈希保存，成功校验后不可重复使用", async () => {
  const previous = process.env.VERIFICATION_CODE_SECRET;
  process.env.VERIFICATION_CODE_SECRET = "test-secret-at-least-16-characters";
  try {
    const redis = new FakeRedis();
    const service = new VerificationCodeService(redis as unknown as IORedis);
    let delivered = "";
    await service.send({ channel: "sms", scene: "register", account: "+8613800138000", ip: "127.0.0.1", deliver: async (code) => { delivered = code; } });
    assert.match(delivered, /^\d{6}$/);
    assert.equal([...redis.data.values()].includes(delivered), false);
    await service.verify({ channel: "sms", scene: "register", account: "+8613800138000", code: delivered });
    await assert.rejects(
      service.verify({ channel: "sms", scene: "register", account: "+8613800138000", code: delivered }),
      (error: unknown) => error instanceof VerificationError && error.message === "验证码错误或已失效",
    );
  } finally {
    if (previous === undefined) delete process.env.VERIFICATION_CODE_SECRET;
    else process.env.VERIFICATION_CODE_SECRET = previous;
  }
});

test("发送失败会撤销本次限流占用", async () => {
  const previous = process.env.VERIFICATION_CODE_SECRET;
  process.env.VERIFICATION_CODE_SECRET = "test-secret-at-least-16-characters";
  try {
    const redis = new FakeRedis();
    const service = new VerificationCodeService(redis as unknown as IORedis);
    await assert.rejects(
      service.send({ channel: "email", scene: "login", account: "a@example.com", ip: "127.0.0.1", deliver: async () => { throw new Error("provider down"); } }),
      (error: unknown) => error instanceof VerificationError && error.status === 503,
    );
    assert.equal(redis.evalCalls, 2);
  } finally {
    if (previous === undefined) delete process.env.VERIFICATION_CODE_SECRET;
    else process.env.VERIFICATION_CODE_SECRET = previous;
  }
});

test("同一账号在冷却时间内不能重复发送", async () => {
  const previous = process.env.VERIFICATION_CODE_SECRET;
  process.env.VERIFICATION_CODE_SECRET = "test-secret-at-least-16-characters";
  try {
    const redis = new FakeRedis();
    const service = new VerificationCodeService(redis as unknown as IORedis);
    const input = { channel: "email" as const, scene: "register" as const, account: "a@example.com", ip: "127.0.0.1", deliver: async () => undefined };
    await service.send(input);
    await assert.rejects(service.send(input), (error: unknown) => error instanceof VerificationError && error.status === 429);
  } finally {
    if (previous === undefined) delete process.env.VERIFICATION_CODE_SECRET;
    else process.env.VERIFICATION_CODE_SECRET = previous;
  }
});
