import { randomUUID } from "node:crypto";

import { CreditService } from "../src/credit-service.js";
import { createDatabase } from "../src/db/client.js";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const databaseUrl = process.env.DATABASE_URL;
const adminId = argument("--admin-id");
const credits = Number(argument("--credits"));
const expiresAt = argument("--expires-at");
if (!databaseUrl || !adminId || !expiresAt) {
  throw new Error("需配置 DATABASE_URL，并传入 --admin-id、--credits、--expires-at（ISO 时间）");
}
const { pool } = createDatabase(databaseUrl);
try {
  const created = await new CreditService(pool).issueActivationCode(
    adminId, credits, expiresAt, randomUUID(),
  );
  process.stdout.write(`${created.code}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "生成失败"}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
