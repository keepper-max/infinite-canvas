import { createHash, randomBytes } from "node:crypto";

export function normalizeActivationCode(value: string) {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

export function hashActivationCode(value: string) {
  return createHash("sha256").update(normalizeActivationCode(value)).digest("hex");
}

export function generateActivationCode() {
  const chars = randomBytes(16).toString("hex").toUpperCase();
  return `JJ-${chars.match(/.{1,8}/g)!.join("-")}`;
}

export function isValidActivationCode(value: string) {
  return /^JJ[0-9A-F]{32}$/.test(normalizeActivationCode(value));
}

export function isActivationAdmin(userId: string) {
  const allowed = process.env.ACTIVATION_ADMIN_USER_IDS?.split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean) ?? [];
  return allowed.includes(userId.toLowerCase());
}
