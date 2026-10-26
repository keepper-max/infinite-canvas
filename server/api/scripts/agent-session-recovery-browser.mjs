import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { serve } from "@hono/node-server";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
export async function verifySessionRecoveryBrowser(
  app,
  { token, actor, project, first, second, original, service, pool, counters },
) {
  const root = "H:/CodexStorage/shoushou-agent-session-hotfix/artifacts";
  await mkdir(root, { recursive: true });
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  if (!server.listening) await once(server, "listening");
  const api = "http://127.0.0.1:" + server.address().port;
  const { chromium } = createRequire(
    "H:/CodexStorage/infinite-canvas-auth-upgrade/plugins/canvas/markdown/package.json",
  )("playwright");
  const b = await chromium.launch({
      headless: true,
      executablePath:
        "H:/CodexStorage/aishenhe-playwright/chromium-1234/chrome-win64/chrome.exe",
    }),
    context = await b.newContext({ viewport: { width: 1440, height: 1000 } }),
    page = await context.newPage();
  const errors = [],
    checks = [];
  let failNext = false,
    loseNext = false;
  const submitted = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.addCookies([
    { name: "session_hotfix", value: token, domain: "127.0.0.1", path: "/" },
  ]);
  let releaseRejected, sawRejected;
  const rejectedGate = new Promise((resolve) => { releaseRejected = resolve; });
  const rejectionReturned = new Promise((resolve) => { sawRejected = resolve; });
  let heldRejection = false;
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (
      req.method() === "POST" &&
      /\/sessions\/[^/]+\/runs$/.test(url.pathname)
    ) {
      submitted.push({
        ...req.postDataJSON(),
        sessionId: url.pathname.split("/")[4],
      });
      if (failNext) {
        failNext = false;
        return route.abort("failed");
      }
      if (loseNext) {
        loseNext = false;
        await route.fetch({ url: api + url.pathname + url.search });
        return route.abort("failed");
      }
    }
    const response = await route.fetch({
      url: api + url.pathname + url.search,
    });
    if (!heldRejection && response.status() === 409 && /\/sessions\/[^/]+\/runs$/.test(url.pathname)) { heldRejection = true; sawRejected(); await rejectedGate; }
    await route.fulfill({ response });
  });
  try {
    await page.goto(
      "http://127.0.0.1:5231/canvas/" + project + "?agentSession=" + second.id,
      { waitUntil: "domcontentloaded" },
    );
    await page
      .getByRole("button", { name: "原生创作助手", exact: true })
      .last()
      .click();
    const panel = page.getByRole("complementary", { name: "原生创作助手面板" }),
      input = panel.getByLabel("给创作助手的指令"),
      send = panel.getByRole("button", { name: "发送", exact: true });
    await input.waitFor();
    await panel
      .getByRole("button", { name: "查看未结束任务", exact: true })
      .waitFor();
    await input.fill("原始输入草稿");
    await send.click();
    await rejectionReturned;
    await input.fill("保留这段输入草稿");
    releaseRejected();
    await panel
      .getByText(/本次请求尚未受理/)
      .first()
      .waitFor();
    assert.equal(await input.inputValue(), "保留这段输入草稿");
    assert.equal(await panel.getByText(/内容或计划已变化/).count(), 0);
    checks.push("真实409被明确识别为旧任务占用，发送期间新增草稿保留且解除pending锁");
    await panel
      .getByRole("button", { name: "查看未结束任务", exact: true })
      .click();
    await panel
      .getByRole("button", { name: "核查原模型回执", exact: true })
      .waitFor();
    assert.equal(await input.inputValue(), "保留这段输入草稿");
    checks.push("从空会话直接跳转真实旧任务，未重新发送草稿");
    await panel
      .getByRole("button", { name: "结束任务，保留核查记录", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "结束任务并保留核查记录" })
      .getByRole("button", { name: "确认结束任务" })
      .click();
    await panel.getByText(/任务已结束，消息和账单仍保留/).waitFor();
    await service.close(actor, first.id);
    await panel.getByLabel("历史会话").click();
    await page
      .locator(".ant-select-dropdown")
      .getByText("被拒绝的新会话", { exact: true })
      .click();
    failNext = true;
    await send.click();
    await panel
      .getByText(/重试会查询同一个操作/)
      .first()
      .waitFor();
    await service.close(actor, second.id);
    checks.push("复现旧版遗留pending请求并由服务端确认原会话已关闭");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .getByRole("button", { name: "原生创作助手", exact: true })
      .last()
      .click();
    await input.waitFor();
    await page.waitForFunction(() => {
      const e = document.querySelector(
        'textarea[aria-label="给创作助手的指令"]',
      );
      return e && !e.disabled;
    });
    assert.equal(await input.inputValue(), "保留这段输入草稿");
    await panel
      .getByRole("button", { name: "已归档记录", exact: true })
      .waitFor();
    checks.push("原会话归档后刷新恢复草稿，默认不回到已归档会话");
    await panel.getByLabel("历史会话").click();
    assert.equal(
      await page
        .locator(".ant-select-dropdown")
        .getByText("待核查旧任务（已归档）", { exact: true })
        .count(),
      0,
    );
    await page.keyboard.press("Escape");
    checks.push("默认会话列表隐藏旧归档，归档数据仍可显式查看");
    failNext = true;
    await input.fill("网络失败后同一操作继续核对");
    await send.click();
    await panel
      .getByText(/重试会查询同一个操作/)
      .first()
      .waitFor();
    const lostOperation = submitted.at(-1).operationId;
    await panel
      .getByRole("button", { name: "已归档记录", exact: true })
      .click();
    await panel.getByLabel("历史会话").click();
    await page
      .locator(".ant-select-dropdown")
      .getByText("待核查旧任务（已归档）", { exact: true })
      .click();
    await panel
      .getByRole("button", { name: "返回原请求", exact: true })
      .waitFor();
    assert.equal(await input.inputValue(), "网络失败后同一操作继续核对");
    checks.push("未知网络结果保留原operationId，同时允许只读查看其他历史");
    await panel
      .getByRole("button", { name: "返回原请求", exact: true })
      .click();
    await send.waitFor();
    loseNext = true;
    await send.click();
    await panel
      .getByText(/重试会查询同一个操作/)
      .first()
      .waitFor();
    assert.equal(submitted.at(-1).operationId, lostOperation);
    await panel.getByRole("button", { name: "重新查询", exact: true }).click();
    await page.waitForFunction(() => {
      const e = document.querySelector(
        'textarea[aria-label="给创作助手的指令"]',
      );
      return e && e.value === "";
    });
    const snapshot = await service.snapshot(actor, submitted.at(-1).sessionId);
    assert.equal(snapshot.runs.length, 1);
    assert.equal(snapshot.runs[0].operation_id, lostOperation);
    assert.equal(counters().modelsCalled, 1);
    checks.push(
      "响应丢失后查询原任务恢复，原operationId保持一致且不重复入队/推理",
    );
    await page.screenshot({ path: root + "/session-recovered.png" });
    assert.deepEqual(errors, []);
    await writeFile(
      root + "/session-browser.json",
      JSON.stringify({ checks, errors, supplierCalls: 0 }, null, 2),
    );
    console.log(
      JSON.stringify({
        browserChecks: checks.length,
        pageErrors: errors.length,
      }),
    );
  } catch (e) {
    await page.screenshot({ path: root + "/session-browser-failure.png" });
    await writeFile(
      root + "/session-browser-failure.txt",
      (await page.locator("body").innerText()).slice(-18000),
    );
    throw e;
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await context.close();
    await b.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}
