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
  const created = await api("/api/projects", {
      name: "雾港 AI 漫剧 · 浏览器验收",
      description: "P251 isolated browser fixture",
    }),
    projectId = created.project.projectId;
  const space = await api("/api/knowledge/spaces", {
    kind: "project",
    projectId,
    operationId: crypto.randomUUID(),
  });
  for (const [title, markdown] of [
    ["雾港世界观", "# 雾港\n海雾封锁的港城，旧灯塔掌握秘密。"],
    ["林岚人物设定", "# 林岚\n调查员，寻找失踪父亲。[[雾港世界观]]"],
    ["周可人物设定", "# 周可\n灯塔维修师，与[[林岚人物设定]]一同调查。"],
  ])
    await api(`/api/knowledge/${space.id}/actions`, {
      operationId: crypto.randomUUID(),
      action: "document.create",
      payload: { title, markdown, folderId: null },
    });
  await page.goto("http://127.0.0.1:5196/canvas/" + projectId, {
    waitUntil: "networkidle",
    timeout: 90000,
  });
  await page
    .getByRole("button", { name: "原生创作助手", exact: true })
    .last()
    .click();
  const panel = page.getByRole("complementary", { name: "原生创作助手面板" });
  await panel.getByLabel("执行模式", { exact: true }).click();
  await page.getByText("执行模式", { exact: true }).last().click();
  await panel
    .getByLabel("给创作助手的指令")
    .fill("根据雾港世界观、林岚和周可的设定，搭建第一集漫剧创作流程。");
  let lostResponse = false;
  await page.route("**/api/native-agent/sessions/*/runs", async (route) => {
    if (route.request().method() === "POST" && !lostResponse) {
      lostResponse = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await panel.getByRole("button", { name: "发送", exact: true }).click();
  await panel.getByRole("button", { name: "重新查询" }).waitFor();
  await panel.getByRole("button", { name: "重新查询" }).click();
  checks.push("服务端已接受但响应丢失后查询原会话恢复任务");

  await panel
    .getByRole("button", { name: "确认执行", exact: true })
    .waitFor({ timeout: 60000 });
  await panel.getByLabel("给创作助手的指令").fill("运行中不允许额外提交");
  await panel.getByLabel("给创作助手的指令").press("Control+Enter");
  await panel.getByLabel("给创作助手的指令").fill("");
  const before = await api(`/api/projects/${projectId}/canvas`);
  assert.equal((before.canvas ?? before).nodes.length, 0);
  checks.push("审批前画布保持空白");
  await page.screenshot({ path: root + "/artifacts/desktop-approval.png" });
  await page.reload({ waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "原生创作助手", exact: true })
    .last()
    .click();
  await panel.getByRole("button", { name: "确认执行", exact: true }).waitFor();
  checks.push("刷新恢复等待审批及历史消息");
  const sessions = await api(
    "/api/native-agent/sessions?projectId=" + projectId,
  );
  const recovered = await api("/api/native-agent/sessions/" + sessions[0].id);
  assert.equal(recovered.runs.length, 1);
  assert.equal(
    await panel
      .getByLabel("执行模式", { exact: true })
      .evaluate((el) =>
        el.closest(".ant-select").textContent.includes("执行模式"),
      ),
    true,
  );
  checks.push("响应丢失和刷新未创建重复Run且模式正确");
  assert.equal(recovered.plans.at(-1).expected_outputs.nodes.length, 4);
  assert.equal(recovered.plans.at(-1).expected_outputs.edges.length, 3);
  await panel.getByRole("button", { name: "确认执行", exact: true }).click();
  await panel.getByText("已完成", { exact: true }).waitFor({ timeout: 60000 });
  await panel
    .getByText("本页已同步到 revision 1", { exact: true })
    .waitFor({ timeout: 25000 });
  const completed = await api("/api/native-agent/sessions/" + sessions[0].id);
  assert.equal(completed.approvals.length, 1);
  assert.equal(completed.runs[0].rounds, recovered.runs[0].rounds);
  assert.equal(
    await page
      .getByRole("button", { name: "画布保存状态", exact: true })
      .getAttribute("data-sync-status"),
    "synced",
  );
  checks.push(
    "单指令一次完整审批，审批后无新增模型轮次，自动同步显示真实已保存状态",
  );
  await page.waitForTimeout(1000);
  const saved = await api(`/api/projects/${projectId}/canvas`),
    canvas = saved.canvas ?? saved;
  assert.equal(canvas.nodes.length, 4);
  assert.equal(canvas.edges.length, 3);
  assert.equal(
    new Set(
      canvas.nodes
        .filter((n) => n.type === "knowledge:document")
        .map((n) => n.metadata.knowledgeReference.documentId),
    ).size,
    3,
  );
  checks.push("真实浏览器一次确认保存4节点3连线且3知识来源不同");
  await panel.getByRole("button", { name: "定位新节点" }).click();
  const positions = canvas.nodes.map((n) => ({
    id: n.id,
    position: n.position,
  }));
  const view = async () =>
    page.locator("[data-canvas-viewport]").evaluate((el) => {
      const m = new DOMMatrix(getComputedStyle(el).transform),
        r = el.parentElement.getBoundingClientRect();
      return {
        k: m.a,
        cx: (r.width / 2 - m.e) / m.a,
        cy: (r.height / 2 - m.f) / m.a,
      };
    });
  await page.waitForTimeout(200);
  const centered = await view();
  await panel.getByRole("button", { name: "关闭助手" }).click();
  await page.waitForTimeout(400);
  const closed = await view();
  console.log("CLOSE_VIEW", JSON.stringify({ centered, closed }));
  assert.ok(Math.abs(centered.cx - closed.cx) < 1);
  assert.ok(Math.abs(centered.cy - closed.cy) < 1);
  assert.equal(centered.k, closed.k);
  await page
    .getByRole("button", { name: "原生创作助手", exact: true })
    .last()
    .click();
  await panel.getByText("已完成", { exact: true }).waitFor();
  await page.waitForTimeout(400);
  const reopened = await view();
  console.log("OPEN_VIEW", JSON.stringify({ centered, reopened }));
  assert.ok(Math.abs(centered.cx - reopened.cx) < 1);
  assert.ok(Math.abs(centered.cy - reopened.cy) < 1);
  assert.equal(centered.k, reopened.k);
  const handle = await panel
    .getByRole("button", { name: "调整助手面板宽度" })
    .boundingBox();
  assert.ok(handle);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 200);
  await page.mouse.down();
  await page.mouse.move(handle.x - 45, handle.y + 200, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const resized = await view();
  assert.ok(Math.abs(centered.cx - resized.cx) < 1);
  assert.equal(centered.k, resized.k);
  const afterResize = (await api("/api/projects/" + projectId + "/canvas"))
    .canvas;
  assert.deepEqual(
    afterResize.nodes.map((n) => ({ id: n.id, position: n.position })),
    positions,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "画布保存状态", exact: true })
      .getAttribute("data-sync-status"),
    "synced",
  );
  checks.push(
    "面板开合及拖宽保持世界中心和缩放，不移动真实节点且不产生伪未保存状态",
  );
  const titleBounds=await page.locator('[data-canvas-title]').evaluate(el=>{const r=el.getBoundingClientRect(),b=el.querySelector('button').getBoundingClientRect();return {right:r.right,buttonRight:b.right};});
  const saveBounds=await page.getByRole('button',{name:'画布保存状态',exact:true}).boundingBox();assert.ok(titleBounds.buttonRight<=titleBounds.right+1);assert.ok(titleBounds.right<=saveBounds.x+1);checks.push('窄画布顶部标题不遮挡保存状态');
  await page.screenshot({ path: root + "/artifacts/desktop-completed.png" });
  await context.setOffline(true);
  await page.waitForTimeout(2200);
  await context.setOffline(false);
  if (await panel.getByRole("button", { name: "重新查询" }).isVisible())
    await panel.getByRole("button", { name: "重新查询" }).click();
  await page.reload({ waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "原生创作助手", exact: true })
    .last()
    .click();
  await panel.getByText("已完成", { exact: true }).waitFor();
  checks.push("断网重连和刷新保持实际保存结果");
  await panel.getByLabel("给创作助手的指令").fill("未发送草稿：林岚下一场戏");
  await panel.getByRole("button", { name: "关闭助手" }).click();
  await page
    .getByRole("button", { name: "原生创作助手", exact: true })
    .last()
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('textarea[aria-label="给创作助手的指令"]')
        ?.value === "未发送草稿：林岚下一场戏",
  );
  await page.reload({ waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "原生创作助手", exact: true })
    .last()
    .click();
  await panel.getByLabel("给创作助手的指令").waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector('textarea[aria-label="给创作助手的指令"]')
        ?.value === "未发送草稿：林岚下一场戏",
  );
  checks.push("关闭面板和刷新保留未发送草稿");
  await panel.getByText("已完成", { exact: true }).waitFor();
  await page.getByRole("button", { name: "切换到浅色主题" }).last().click();
  await page.getByRole("button", { name: "切换到深色主题" }).last().waitFor();
  await page.waitForFunction(
    () =>
      !document.documentElement.style.getPropertyValue(
        "--magicui-theme-toggle-vt-duration",
      ),
  );
  await page.screenshot({ path: root + "/artifacts/light-completed.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: root + "/artifacts/mobile-completed.png" });
  assert.ok(await panel.getByLabel("给创作助手的指令").isVisible());
  assert.equal(
    await panel.evaluate((el) => el.scrollWidth <= el.clientWidth),
    true,
  );
  checks.push("浅色和390px手机布局无横向溢出");
  await panel.getByRole("button", { name: "结束会话", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector("button") &&
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent.includes("结束会话") && b.disabled,
      ),
  );
  await panel.getByLabel("给创作助手的指令").fill("已结束会话不允许提交");
  await panel.getByLabel("给创作助手的指令").press("Control+Enter");
  const closedSnapshot = await api(
    "/api/native-agent/sessions/" + sessions[0].id,
  );
  assert.equal(closedSnapshot.runs.length, 1);
  checks.push("运行中及已结束会话的快捷键不能绕过提交约束");
  await panel.getByLabel("给创作助手的指令").fill("");
  await panel.getByRole("button", { name: "新建会话" }).click();
  assert.equal(await panel.getByText(/画布已保存 · revision/).count(), 0);
  checks.push("切换新会话清理上一会话保存与定位反馈");
  assert.deepEqual(errors, []);
  await writeFile(
    root + "/artifacts/browser-check.json",
    JSON.stringify(
      {
        checks,
        errors,
        projectId,
        spaceId: space.id,
        url: page.url(),
        revision: canvas.revision,
      },
      null,
      2,
    ),
  );
  console.log("BROWSER_PASS", checks.length, projectId);
} catch (e) {
  await page.screenshot({ path: root + "/artifacts/browser-failure.png" });
  await writeFile(
    root + "/artifacts/browser-failure.txt",
    JSON.stringify(
      {
        error: String(e),
        stack: e.stack,
        checks,
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
