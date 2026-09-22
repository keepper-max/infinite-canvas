import { createHash, randomBytes } from "node:crypto";

export function generateActivationCode() {
  const body = randomBytes(20).toString("hex").toUpperCase();
  return `JJ-${body.match(/.{1,8}/g)!.join("-")}`;
}

export function normalizeActivationCode(value: string) {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

export function hashActivationCode(value: string) {
  return createHash("sha256").update(normalizeActivationCode(value)).digest("hex");
}

export function isActivationCode(value: string) {
  return /^JJ[0-9A-F]{40}$/.test(normalizeActivationCode(value));
}
