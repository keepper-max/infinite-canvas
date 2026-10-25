import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const root = "H:/CodexStorage/shoushou-p251",
  f = JSON.parse(await readFile(root + "/private/fixture-v2.json", "utf8"));
process.env.PLAYWRIGHT_BROWSERS_PATH =
  "H:/CodexStorage/shoushou-p25/playwright";
const { chromium } = createRequire(
  "H:/CodexStorage/infinite-canvas-auth-upgrade/plugins/canvas/markdown/package.json",
)("playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "H:/CodexStorage/aishenhe-playwright/chromium-1234/chrome-win64/chrome.exe",
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: {
    dir: root + "/artifacts/video",
    size: { width: 1440, height: 1000 },
  },
});
await context.addCookies([
  {
    name: f.cookieName || "p251_session",
    value: f.token,
    domain: "127.0.0.1",
    path: "/",
  },
]);
const page = await context.newPage(),
  errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
context.setDefaultTimeout(60000);
const api = async (path, body) => {
  const r = await context.request.fetch("http://127.0.0.1:5196" + path, {
    method: body ? "POST" : "GET",
    data: body,
    headers: body ? { origin: "http://127.0.0.1:5196" } : undefined,
  });
  const p = await r.json();
  assert.ok(r.ok(), JSON.stringify(p));
  return p.data;
};
try {
  const ref = JSON.parse(
      await readFile(root + "/artifacts/continuous-current.json", "utf8"),
    ),
    projectId = ref.projectId;
  await page.goto("http://127.0.0.1:5196/canvas/" + projectId, {
    waitUntil: "networkidle",
    timeout: 90000,
  });
  const initial = (await api("/api/projects/" + projectId + "/canvas")).canvas,
    text = initial.nodes.find((n) => n.type === "text");
  assert.ok(text);
  assert.equal(initial.revision, 1);
  await page
    .getByRole("button", { name: "原生创作助手", exact: true })
    .last()
    .click();
  const panel = page.getByRole("complementary", { name: "原生创作助手面板" });
  await panel.getByText("已完成", { exact: true }).waitFor();
  await panel.getByRole("button", { name: "定位新节点" }).click();
  await page.waitForTimeout(250);
  await panel.getByRole("button", { name: "关闭助手" }).click();
  await page.route("**/api/projects/" + projectId + "/canvas", (route) =>
    route.request().method() === "PUT"
      ? route.abort("failed")
      : route.continue(),
  );
  const node = page.locator('[data-node-id="' + text.id + '"]');
  await node.getByText(text.metadata.content, { exact: true }).dblclick();
  await node.locator("textarea").fill("仅本地未保存草稿：林岚新剧情");
  await node.locator("textarea").press("Escape");
  await page.waitForTimeout(1000);
  assert.notEqual(
    await page
      .getByRole("button", { name: "画布保存状态", exact: true })
      .getAttribute("data-sync-status"),
    "synced",
  );
  const ack = initial.nodes
    .filter((n) => n.type === "knowledge:document")
    .map((n) => ({ id: n.id, reference: n.metadata.knowledgeReference }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const proof = await api(
    "/api/projects/" + projectId + "/canvas/write-capability",
    { expectedRevision: initial.revision, acknowledgedKnowledgeNodes: ack },
  );
  const remote = {
    contractVersion: 1,
    nodes: initial.nodes.map((n) =>
      n.id === text.id
        ? { ...n, metadata: { ...n.metadata, content: "另一个页面保存的版本" } }
        : n,
    ),
    edges: initial.edges,
    viewport: initial.viewport,
    settings: initial.settings,
    expectedRevision: initial.revision,
    writeCapability: { token: proof.token, deletedKnowledgeNodeIds: [] },
  };
  const response = await context.request.put(
    "http://127.0.0.1:5196/api/projects/" + projectId + "/canvas",
    { data: remote, headers: { origin: "http://127.0.0.1:5196" } },
  );
  assert.ok(response.ok(), await response.text());
  await page
    .getByRole("button", { name: "原生创作助手", exact: true })
    .last()
    .click();
  await panel.getByRole("button", { name: "同步画布结果" }).click();
  await panel
    .getByText(/当前画布有未保存内容或冲突/)
    .first()
    .waitFor();
  assert.ok(
    await node
      .getByText("仅本地未保存草稿：林岚新剧情", { exact: true })
      .isVisible(),
  );
  await panel.getByRole("button", { name: "查看本地与服务器差异" }).click();
  await page
    .getByRole("dialog")
    .getByText(/服务器 revision 2/)
    .waitFor();
  await page.getByRole("button", { name: "保留当前编辑并返回" }).click();
  await panel.getByRole("button", { name: "保留草稿", exact: true }).click();
  await page
    .getByText("本地草稿已保留，服务器未被覆盖", { exact: true })
    .waitFor();
  await page.screenshot({
    path: root + "/artifacts/dirty-draft-preserved.png",
  });
  await page.reload({ waitUntil: "networkidle" });
  await page
    .getByText("仅本地未保存草稿：林岚新剧情", { exact: true })
    .last()
    .waitFor();
  const actual = (await api("/api/projects/" + projectId + "/canvas")).canvas;
  assert.equal(actual.revision, 2);
  assert.equal(
    actual.nodes.find((n) => n.id === text.id).metadata.content,
    "另一个页面保存的版本",
  );
  assert.equal(actual.nodes.length, 4);
  assert.equal(actual.edges.length, 3);
  await writeFile(
    root + "/artifacts/browser-draft.json",
    JSON.stringify(
      {
        projectId,
        checks: [
          "真实文本编辑形成未保存草稿",
          "另一页面实际HTTP CAS保存revision2",
          "助手同步拒绝覆盖本地草稿",
          "差异面板只读显示服务器版本",
          "保留草稿后刷新恢复且服务器未覆盖",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log("DIRTY_DRAFT_BROWSER_PASS", projectId);
} catch (e) {
  await page.screenshot({ path: root + "/artifacts/dirty-draft-failure.png" });
  await writeFile(
    root + "/artifacts/dirty-draft-failure.txt",
    JSON.stringify(
      {
        error: String(e),
        stack: e.stack,
        body: await page.locator("body").innerText(),
      },
      null,
      2,
    ),
  );
  throw e;
} finally {
  await context.close();
  await browser.close();
}
