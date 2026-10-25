import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createDatabase } from "../src/db/client.js";
import { PostgresPlatformRepository } from "../src/repository.js";
const root = "H:/CodexStorage/shoushou-p25",
  require = createRequire("H:/代码相关/项目/漫剧工作流/package.json");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js"),
  {
    StdioClientTransport,
  } = require("@modelcontextprotocol/sdk/client/stdio.js");
const f = JSON.parse(await readFile(root + "/private/fixture-v2.json", "utf8")),
  { db, pool } = createDatabase("postgres://p25@127.0.0.1:55485/p25_isolated"),
  repo = new PostgresPlatformRepository(db);
const project = await repo.createProjectForUser(f.ownerId, {
  name: "P25 MCP回归专用项目",
  description: "synthetic stdio test",
});
const client = new Client({ name: "p25-isolated-check", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [root + "/artifacts/shoushou-mcp-isolated.cjs"],
  env: {
    PATH: process.env.PATH || "",
    SYSTEMROOT: process.env.SYSTEMROOT || "C:/Windows",
    DATABASE_URL: "postgres://p25@127.0.0.1:55485/p25_isolated",
    SHOUSHOU_MCP_USER_ID: f.ownerId,
    SHOUSHOU_MCP_PROJECT_IDS: project.projectId,
    SHOUSHOU_MCP_CANVAS_WRITE_PROTOCOL: "v2",
    SHOUSHOU_MCP_IMPORT_ROOTS: root + "/artifacts",
    TEMP: root + "/tmp",
    TMP: root + "/tmp",
  },
});
const checks: string[] = [];
const data = (r: any) =>
  r.structuredContent ??
  JSON.parse(r.content.find((c: any) => c.type === "text").text);
try {
  await client.connect(transport);
  const version = client.getServerVersion(),
    list = await client.listTools();
  assert.equal(version.version, "0.4.0");
  assert.equal(list.tools.length, 13);
  checks.push("真实stdio握手0.4.0/13工具");
  const args = {
    projectId: project.projectId,
    operationId: randomUUID(),
    expectedCanvasRevision: 0,
    title: "P25回归分镜",
    summary: "不触发供应商调用",
    aspectRatio: "9:16",
    scenes: [
      {
        title: "雾港",
        narration: "灯塔亮起",
        visual: "海雾",
        durationSeconds: 5,
      },
    ],
  };
  const first = data(
    await client.callTool({
      name: "create_vibe_storyboard_v2",
      arguments: args,
    }),
  );
  assert.equal(first.persisted, true);
  assert.equal(first.revision, 1);
  checks.push("MCPv2正式业务CAS保存成功");
  const retry = data(
    await client.callTool({
      name: "create_vibe_storyboard_v2",
      arguments: args,
    }),
  );
  assert.equal(retry.replayed, true);
  assert.deepEqual(retry.nodeIds, first.nodeIds);
  checks.push("同operationId复用已持久化结果");
  const conflict = data(
    await client.callTool({
      name: "create_vibe_storyboard_v2",
      arguments: { ...args, operationId: randomUUID() },
    }),
  );
  assert.equal(conflict.code, "CANVAS_REVISION_CONFLICT");
  checks.push("过期revision拒绝写入");
  const receipt = data(
    await client.callTool({
      name: "get_canvas_operation_receipt",
      arguments: {
        projectId: project.projectId,
        operationId: args.operationId,
      },
    }),
  );
  assert.equal(receipt.revision, first.revision);
  checks.push("原操作回执可查询");
  const legacy = await client.callTool({
    name: "create_vibe_storyboard",
    arguments: {
      projectId: project.projectId,
      title: args.title,
      summary: args.summary,
      aspectRatio: args.aspectRatio,
      scenes: args.scenes,
    },
  });
  assert.equal(data(legacy).code, "LEGACY_CANVAS_WRITE_DISABLED");
  checks.push("旧直库写工具保持禁用");
  await writeFile(
    root + "/artifacts/mcp-check.json",
    JSON.stringify(
      {
        version,
        checks,
        projectId: project.projectId,
        revision: first.revision,
      },
      null,
      2,
    ),
  );
  console.log("MCP_PASS", checks.length);
} finally {
  await client.close();
  await pool.end();
}
