import { readConfig } from "../src/config.js";
import { CreditService } from "../src/credit-service.js";
import { BillingService } from "../src/billing-service.js";
import { S3ObjectStorage } from "../src/object-storage.js";
import { PaidAgentModel } from "../src/native-agent/paid-model.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { createDatabase } from "../src/db/client.js";
import { applyMigrations } from "../src/db/migrate.js";
import { PostgresPlatformRepository } from "../src/repository.js";
import { KnowledgeService } from "../src/knowledge-service.js";
import { ModelGateway } from "../src/model-gateway.js";
import { createApp } from "../src/app.js";
import { hashSessionToken } from "../src/auth.js";
import { JobService } from "../src/job-service.js";
import { NativeAgentService } from "../src/native-agent/service.js";
import { CompatibleAgentModel } from "../src/native-agent/model.js";
import {
  createNativeAgentQueue,
  startNativeAgentWorker,
} from "../src/native-agent/queue.js";
const root = process.env.NATIVE_AGENT_LAB_ROOT||"H:/CodexStorage/shoushou-p25",
  repoRoot = "H:/CodexStorage/infinite-canvas-auth-upgrade";
const url=process.env.NATIVE_AGENT_LAB_DATABASE_URL||"postgres://p25@127.0.0.1:55485/p25_isolated";
const port=Number(process.env.NATIVE_AGENT_LAB_PORT||3195),webPort=Number(process.env.NATIVE_AGENT_LAB_WEB_PORT||5195),redis=process.env.NATIVE_AGENT_LAB_REDIS||"redis://127.0.0.1:56385",cookieName=port===3196?'p251_session':'p25_session';
const address=new URL(url);if(address.hostname!=='127.0.0.1'||address.port!=='55485'||!['/p25_isolated','/p251_isolated'].includes(address.pathname))throw new Error('LAB_MUST_USE_ISOLATED_DATABASE');
process.env.NATIVE_AGENT_ENABLED = "true";
process.env.NATIVE_AGENT_DEFAULT_ENABLED = "true";
process.env.KNOWLEDGE_DEFAULT_ENABLED = "true";
process.env.KNOWLEDGE_GENERATION_ENABLED = process.env.P25_USE_PAID_MODEL==="true"?"true":"false";
process.env.NATIVE_AGENT_FIXTURE_URL = process.env.NATIVE_AGENT_LAB_FIXTURE_URL||"http://127.0.0.1:3295/v1";
const { db, pool } = createDatabase(url),
  knowledge = new KnowledgeService(db),
  repository = new PostgresPlatformRepository(db);
await mkdir(root + "/migrations", { recursive: true });
const { readdir } = await import("node:fs/promises");
for (const file of await readdir(repoRoot + "/server/api/db/migrations")) {
  if (!file.endsWith(".sql")) continue;
  // Preserve frozen LF Git bytes; only the new untracked migration is normalized in the isolated copy.
  const bytes = /^005[0-9]/.test(file)
    ? Buffer.from(
        (
          await readFile(repoRoot + "/server/api/db/migrations/" + file, "utf8")
        ).replace(/\r\n/g, "\n"),
      )
    : execFileSync("git", ["show", "HEAD:server/api/db/migrations/" + file], {
        cwd: repoRoot,
      });
  await writeFile(root + "/migrations/" + file, bytes);
}
await applyMigrations(pool, root + "/migrations");
const queue = createNativeAgentQueue(redis),
  gateway = new ModelGateway(pool);
const labConfig = readConfig({
  DATABASE_URL: url,
  REDIS_URL: redis,
  OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:59000",
  OBJECT_STORAGE_BUCKET: "p25-unused-text-only",
  OBJECT_STORAGE_ACCESS_KEY_ID: "synthetic",
  OBJECT_STORAGE_SECRET_ACCESS_KEY: "synthetic",
});
const paidEnabled = process.env.P25_USE_PAID_MODEL === "true";
process.env.NATIVE_AGENT_PAID_ENABLED = paidEnabled ? "true" : "false";
const tokenRoute = process.env.NATIVE_AGENT_PAID_ROUTE === "token360";
const readProvider = async (file: string) =>
  JSON.parse(
    (await readFile(root + "/private/" + file, "utf8")).replace(/^\uFEFF/, ""),
  );
const provider =
  paidEnabled && !tokenRoute
    ? await readProvider("ark-development-reference.json")
    : { baseUrl: "http://127.0.0.1:3295/v1", apiKey: "" };
const tokenProvider =
  paidEnabled && tokenRoute
    ? await readProvider("token360-development-reference.json")
    : labConfig.provider;
const credits = new CreditService(pool),
  billing = new BillingService(pool, tokenProvider, credits),
  storage = new S3ObjectStorage(labConfig.objectStorage);
const jobReader = new JobService(
  pool,
  {
    add: async () => {
      throw new Error(
        "Native model jobs are owned by the native worker, never the normal queue",
      );
    },
    remove: async () => false,
  },
  gateway,
  labConfig.jobs,
  async () => undefined,
  credits,
  billing,
);
if (paidEnabled && !process.argv.includes("--worker")) {
  if (tokenRoute) await gateway.refreshCatalog(tokenProvider.catalogUrl);
  else await gateway.refreshVolcengineArkCatalog();
}
const paid = new PaidAgentModel(
  pool,
  gateway,
  jobReader,
  credits,
  billing,
  storage,
  labConfig.jobs,
  { ...provider, catalogUrl: "" },
  tokenProvider,
);
const agent = new NativeAgentService(
  knowledge,
  pool,
  new CompatibleAgentModel(gateway, paid),
  queue.enqueue,
  jobReader,
);
if (process.argv.includes("--worker")) {
  const worker = await startNativeAgentWorker(agent, redis);
  console.log("P25 isolated durable worker ready");
  const close = async () => {
    await worker.close();
    await queue.close();
    await pool.end();
  };
  process.once("SIGTERM", () => void close());
  process.once("SIGINT", () => void close());
} else {
  let f: any;
  try {
    f = JSON.parse(await readFile(root + "/private/fixture-v2.json", "utf8"));
  } catch {
    const owner = await repository.createUserWithWorkspace(
        "p25-v2-owner-"+randomUUID()+"@example.test",
        "synthetic",
      ),
      other = await repository.createUserWithWorkspace(
        "p25-v2-other-"+randomUUID()+"@example.test",
        "synthetic",
      );
    await repository.updateProjectForUser(
      owner.workspace.projectId,
      owner.user.id,
      { name: "雾港 AI 漫剧" },
    );
    const space = await knowledge.createSpace(
      owner.user.id,
      "project",
      owner.workspace.projectId,
      randomUUID(),
    );
    const docs = [];
    for (const [title, markdown] of [
      ["雾港世界观", "# 雾港\n海雾封锁的港城，旧灯塔掌握通行的秘密。"],
      [
        "林岚人物设定",
        "# 林岚\n调查员，冷静谨慎。她试图寻找失踪的父亲。[[雾港世界观]]",
      ],
      [
        "周可人物设定",
        "# 周可\n灯塔维修师，幽默而敏锐。与[[林岚人物设定]]共同调查。",
      ],
    ])
      docs.push(
        (
          await knowledge.write(owner.user.id, space.id, {
            operationId: randomUUID(),
            action: "document.create",
            payload: { title, markdown, folderId: null },
          })
        ).id,
      );
    f = {
      ownerId: owner.user.id,
      otherId: other.user.id,
      projectId: owner.workspace.projectId,
      spaceId: space.id,
      docs,
      token: randomUUID(),
      otherToken: randomUUID(),
    };
    await repository.createSession(
      f.ownerId,
      hashSessionToken(f.token),
      new Date(Date.now() + 7 * 86400000),
    );
    await repository.createSession(
      f.otherId,
      hashSessionToken(f.otherToken),
      new Date(Date.now() + 7 * 86400000),
    );
    f.cookieName=cookieName;await writeFile(root + "/private/fixture-v2.json", JSON.stringify(f));
  }
  await pool.query(
    `insert into model_catalog(id,display_name,capability,upstream_model,provider_id,enabled,healthy,catalog_metadata) values('native-agent-fixture','原生Agent协议替身','text','fixture-tool-model','token360',true,true,'{}') on conflict(id) do update set enabled=true,healthy=true`,
  );
  await pool.query(
    `insert into model_capabilities(model_id,modes,accepted_parameters,required_parameters_by_mode,limits,parameter_map) values('native-agent-fixture','["chat"]','[]','{}','{}','{}') on conflict(model_id) do nothing`,
  );
  const config = {
    cookieName,
    cookieSecure: false,
    trustedOrigins: ["http://127.0.0.1:"+webPort, "http://127.0.0.1:"+port],
    databaseUrl: url,
    adminEmails: [],
    sessionDays: 7,
  } as any;
  const app = createApp(
    repository,
    config,
    undefined,
    undefined,
    gateway,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    knowledge,
    undefined,
    agent,
  );
  // Explicit synthetic-only entry points in this loopback lab, never imported by production.
  if(root.endsWith('shoushou-p251')) for(const [path,artifact,identity] of [['/__p251/demo','user-demo.json','fixture-v2.json'],['/__p251/real-demo','real-continuous-check.json','paid-fixture.json']]) app.get(path,async()=>{
    const demo=JSON.parse(await readFile(root+'/artifacts/'+artifact,'utf8')),account=JSON.parse(await readFile(root+'/private/'+identity,'utf8'));
    if(!/^[0-9a-f-]{36}$/.test(demo.projectId))throw new Error('Invalid owned lab project');
    return new Response(null,{status:302,headers:{'set-cookie':cookieName+'='+account.token+'; Path=/; HttpOnly; SameSite=Lax',location:'/canvas/'+demo.projectId}});
  });
  // Dedicated loopback-only test login for synthetic accounts, absent from the production app/router.
  app.get(
    "/__p25/login",
    (c) =>
      new Response(null, {
        status: 302,
        headers: {
          "set-cookie":
            cookieName+"=" + f.token + "; Path=/; HttpOnly; SameSite=Lax",
          location: "/canvas/" + f.projectId,
        },
      }),
  );
  serve({ fetch: app.fetch, hostname: "127.0.0.1", port });
  console.log(
    "Isolated API http://127.0.0.1:"+port+"; synthetic accounts only",
  );
}
