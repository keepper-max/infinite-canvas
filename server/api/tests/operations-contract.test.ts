import assert from "node:assert/strict";
import test from "node:test";

import {
  paymentOrderSchema,
  smsRequestSchema,
  teamCreateSchema,
  teamMemberSchema,
} from "../src/operations-contract.js";

test("operations contracts accept normalized interface payloads", () => {
  assert.deepEqual(
    smsRequestSchema.parse({ phone: "+8613314118218", purpose: "bind_phone" }),
    { phone: "+8613314118218", purpose: "bind_phone" },
  );
  assert.equal(teamCreateSchema.parse({ name: "  漫剧组  " }).name, "漫剧组");
  assert.equal(
    teamMemberSchema.parse({ email: "artist@example.com", role: "editor" })
      .role,
    "editor",
  );
  assert.equal(
    paymentOrderSchema.parse({
      planId: "creator",
      idempotencyKey: "order-key-001",
    }).planId,
    "creator",
  );
});

test("operations contracts reject ambiguous or unsafe payloads", () => {
  assert.throws(() =>
    smsRequestSchema.parse({ phone: "133", purpose: "login" }),
  );
  assert.throws(() =>
    teamMemberSchema.parse({ email: "bad-email", role: "owner" }),
  );
  assert.throws(() =>
    paymentOrderSchema.parse({
      planId: "creator",
      idempotencyKey: "short",
      amount: 1,
    }),
  );
  assert.throws(() =>
    paymentOrderSchema.parse({
      planId: "creator",
      provider: "alipay",
      idempotencyKey: "order-key-001",
    }),
  );
});
