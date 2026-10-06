import { activationCodes, users } from "../db/schema";
import { db } from "../lib/db";
import { generateActivationCode, hashActivationCode, isActivationAdmin } from "../lib/activation-codes";
import { eq } from "drizzle-orm";

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function main() {
  const adminId = option("--admin-id");
  const credits = Number(option("--credits"));
  const days = Number(option("--days"));
  if (!adminId || !isActivationAdmin(adminId) || !Number.isSafeInteger(credits) || credits < 1 || credits > 10000 ||
      !Number.isSafeInteger(days) || days < 1 || days > 90) {
    throw new Error("参数无效：--admin-id 必须为授权管理员，--credits 为 1–10000，--days 为 1–90");
  }
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.id, adminId)).limit(1);
  if (!admin) throw new Error("管理员账号不存在");
  const code = generateActivationCode();
  const expiresAt = new Date(Date.now() + days * 86400000);
  await db.insert(activationCodes).values({
    codeHash: hashActivationCode(code), codeHint: code.slice(-4), credits, expiresAt, createdBy: adminId,
  });
  process.stdout.write(`${code}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "生成失败"}\n`);
  process.exitCode = 1;
});
