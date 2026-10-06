import argon2 from "argon2";
import { and, eq, gt } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { sessions, users } from "@/db/schema";

export const SESSION_COOKIE = "jingjie_session";
const SESSION_DAYS = 14;

function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }

export async function hashPassword(password: string) { return argon2.hash(password, { type: argon2.argon2id }); }
export async function verifyPassword(hash: string, password: string) { return argon2.verify(hash, password); }

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.COOKIE_SECURE === "true", expires: expiresAt, path: "/" });
}

export async function getCurrentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const result = await db.select({ id: users.id, email: users.email, phone: users.phone, status: users.status }).from(sessions).innerJoin(users, eq(sessions.userId, users.id)).where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date()), eq(users.status, "active"))).limit(1);
  return result[0] ?? null;
}

export async function destroyCurrentSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  store.delete(SESSION_COOKIE);
}
