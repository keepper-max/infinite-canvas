import assert from "node:assert/strict";
import test from "node:test";

import { generateActivationCode, hashActivationCode, isActivationCode } from "../src/activation-code.js";

test("activation codes have high entropy and normalize before hashing", () => {
  const first = generateActivationCode();
  const second = generateActivationCode();
  assert.notEqual(first, second);
  assert.equal(isActivationCode(first), true);
  assert.equal(hashActivationCode(first), hashActivationCode(first.toLowerCase().replaceAll("-", "")));
  assert.equal(isActivationCode("bad"), false);
});
