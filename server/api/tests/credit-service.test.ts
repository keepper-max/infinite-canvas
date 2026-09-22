import assert from "node:assert/strict";
import test from "node:test";

import { decimalProductCeil } from "../src/credit-service.js";

test("credit charge applies 100 points per CNY and 1.2 markup", () => {
  assert.equal(decimalProductCeil(["10", "1", "120"]), BigInt(1200));
});

test("credit charge converts USD and rounds fractional points upward", () => {
  assert.equal(decimalProductCeil(["0.01", "7.2", "120"]), BigInt(9));
  assert.equal(decimalProductCeil(["3.19946585", "7.2", "120"]), BigInt(2765));
});

test("credit charge keeps exact integer boundaries", () => {
  assert.equal(decimalProductCeil(["1.25", "1", "120"]), BigInt(150));
  assert.equal(decimalProductCeil(["0", "7.2", "120"]), BigInt(0));
});
