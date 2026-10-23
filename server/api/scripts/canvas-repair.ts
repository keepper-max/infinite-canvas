import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { createDatabase } from "../src/db/client.js";
import { resolveActiveUser } from "../src/project-access.js";
import { PostgresPlatformRepository } from "../src/repository.js";

let poolToClose: ReturnType<typeof createDatabase>["pool"] | undefined;
try {
// No dotenv/default DATABASE_URL. Production plans are read-only; this unreleased
// implementation can apply only against the explicitly isolated S0-3 test target.
const { values } = parseArgs({ options: {
  "database-url-env": { type: "string" }, "project-id": { type: "string" }, output: { type: "string" },
  apply: { type: "string" }, "archive-id": { type: "string" },
} });
const key = z.string().regex(/^[A-Z][A-Z0-9_]*$/).parse(values["database-url-env"]);
const connection = z.string().min(1).parse(process.env[key]);
const address = new URL(connection);
const target = { host: address.hostname, port: address.port || "5432", database: address.pathname.slice(1) };
if (values.apply && (target.host !== "127.0.0.1" || target.port !== "55441" || target.database !== "s03_isolated"))
  throw Object.assign(new Error("只允许隔离库应用修复"), { code: "CANVAS_REPAIR_LOCAL_ONLY" });
const { db, pool } = createDatabase(connection);
poolToClose = pool;
  const actorId = await resolveActiveUser(pool, { userId: process.env.SHOUSHOU_MCP_USER_ID, account: process.env.SHOUSHOU_MCP_ACCOUNT });
  const repository = new PostgresPlatformRepository(db);
  if (values.apply) {
    const plan = z.object({ version: z.literal(1), action: z.enum(["repair", "restoreArchive"]), projectId: z.string().uuid(), actorId: z.string().uuid(),
      operationId: z.string().uuid(), expectedCanvasRevision: z.number().int().nonnegative(), expectedStateHash: z.string().regex(/^[a-f0-9]{64}$/),
      reason: z.string().trim().min(1), archiveId: z.string().uuid().optional(), target: z.object({ host: z.string(), port: z.string(), database: z.string() }) }).parse(JSON.parse(await readFile(values.apply, "utf8")));
    if (actorId !== plan.actorId || JSON.stringify(target) !== JSON.stringify(plan.target)) throw new Error("计划的操作者或数据库目标不匹配");
    let result;
    if (plan.action === "restoreArchive") {
      if (!plan.archiveId) throw new Error("回滚计划缺少archiveId");
      result = await repository.restoreCanvasRepairArchiveForUser(plan.projectId, actorId, { ...plan, archiveId: plan.archiveId });
    } else result = await repository.repairCanvasForUser(plan.projectId, actorId, plan);
    console.log(JSON.stringify(result));
  } else {
    const projectId = z.string().uuid().parse(values["project-id"]);
    const output = z.string().min(1).parse(values.output);
    const inspection = await repository.inspectCanvasForRepair(projectId, actorId);
    const plan = { version: 1, action: values["archive-id"] ? "restoreArchive" : "repair", target, actorId, projectId,
      operationId: randomUUID(), expectedCanvasRevision: inspection.revision, expectedStateHash: inspection.hash,
      archiveId: values["archive-id"], reason: "", maxSnapshotVersion: inspection.maxSnapshotVersion,
      reasons: inspection.reasons, duplicateCandidates: inspection.duplicateCandidates };
    await writeFile(output, JSON.stringify(plan, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ output, target, requiresReview: true, reasons: inspection.reasons }));
  }
} catch (error) {
  const known = error as { code?: string; message?: string };
  // Do not print pg errors/connection URLs, raw archived content or SQL parameters.
  console.error(JSON.stringify({ error: known.code && !/^\d/.test(known.code) ? known.code : "CANVAS_REPAIR_FAILED", message: "计划未应用或回执状态待核查；使用原operationId复核，禁止盲目新建修复" }));
  process.exitCode = 1;
} finally { await poolToClose?.end(); }
