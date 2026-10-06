import { createHash } from "node:crypto";

export type VerificationChannel = "sms" | "email";
export type VerificationScene = "register" | "login" | "bind_phone" | "bind_email";

export function normalizePhone(value: string) {
  const compact = value.trim().replace(/[\s()-]/g, "");
  const local = compact.startsWith("+86")
    ? compact.slice(3)
    : compact.startsWith("86") && compact.length === 13
      ? compact.slice(2)
      : compact;
  if (!/^1[3-9]\d{9}$/.test(local)) throw new Error("手机号格式不正确");
  return `+86${local}`;
}
export function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("邮箱格式不正确");
  return email;
}

export function normalizeAccount(channel: VerificationChannel, value: string) {
  return channel === "sms" ? normalizePhone(value) : normalizeEmail(value);
}

export function accountDigest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function maskPhone(value: string | null) {
  if (!value) return "—";
  const local = value.startsWith("+86") ? value.slice(3) : value;
  return `${local.slice(0, 3)}****${local.slice(-4)}`;
}

export function maskEmail(value: string | null) {
  if (!value) return "—";
  const [name, domain] = value.split("@");
  return `${name.slice(0, 1)}***@${domain}`;
}
