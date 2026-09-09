import assert from "node:assert/strict";
import test from "node:test";

import { createSessionToken, hashPassword, hashSessionToken, normalizeEmail, verifyPassword } from "../src/auth.js";

test("passwords use a verifiable Argon2id hash", async () => {
    const hash = await hashPassword("correct-horse-battery");
    assert.match(hash, /^\$argon2id\$/);
    assert.equal(await verifyPassword(hash, "correct-horse-battery"), true);
    assert.equal(await verifyPassword(hash, "wrong-password"), false);
});

test("session tokens are random and only stable after hashing", () => {
    const first = createSessionToken();
    const second = createSessionToken();
    assert.notEqual(first, second);
    assert.equal(hashSessionToken(first), hashSessionToken(first));
    assert.notEqual(hashSessionToken(first), first);
});

test("email normalization is stable", () => {
    assert.equal(normalizeEmail("  User@Example.COM "), "user@example.com");
});
