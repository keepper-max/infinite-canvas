import argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";

export const passwordPolicy = { minLength: 8, maxLength: 128 } as const;

export function normalizeEmail(value: string) {
    return value.trim().toLowerCase();
}

export async function hashPassword(password: string) {
    return argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 19_456,
        timeCost: 2,
        parallelism: 1,
    });
}

export async function verifyPassword(hash: string, password: string) {
    try {
        return await argon2.verify(hash, password);
    } catch {
        return false;
    }
}

export function createSessionToken() {
    return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
}
