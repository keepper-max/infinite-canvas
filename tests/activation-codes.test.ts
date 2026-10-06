import assert from "node:assert/strict";
import test from "node:test";
import { generateActivationCode, hashActivationCode, isActivationAdmin, isValidActivationCode, normalizeActivationCode } from "@/lib/activation-codes";

test("激活码随机生成、格式校验及规范化哈希", () => {
  const first = generateActivationCode();
  const second = generateActivationCode();
  assert.match(first, /^JJ-(?:[0-9A-F]{8}-){3}[0-9A-F]{8}$/);
  assert.notEqual(first, second);
  assert.ok(isValidActivationCode(first));
  assert.equal(normalizeActivationCode(first.toLowerCase()), first.replaceAll("-", ""));
  assert.equal(hashActivationCode(first), hashActivationCode(first.toLowerCase().replaceAll("-", " ")));
  assert.equal(isValidActivationCode("JJ-0000"), false);
});

test("管理员白名单默认关闭", () => {
  const previous = process.env.ACTIVATION_ADMIN_USER_IDS;
  try {
    delete process.env.ACTIVATION_ADMIN_USER_IDS;
    assert.equal(isActivationAdmin("11111111-1111-4111-8111-111111111111"), false);
    process.env.ACTIVATION_ADMIN_USER_IDS = " 11111111-1111-4111-8111-111111111111, 22222222-2222-4222-8222-222222222222 ";
    assert.equal(isActivationAdmin("11111111-1111-4111-8111-111111111111"), true);
    assert.equal(isActivationAdmin("33333333-3333-4333-8333-333333333333"), false);
  } finally {
    if (previous === undefined) delete process.env.ACTIVATION_ADMIN_USER_IDS;
    else process.env.ACTIVATION_ADMIN_USER_IDS = previous;
  }
});
