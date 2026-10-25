import assert from "node:assert/strict";
import { once } from "node:events";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
export async function verifyReceiptBrowser(
  app,
  { token, projectId, setUnavailable, setReceiptGate, submissions, verifyEnded },
) {
  const { chromium } = createRequire(
    "H:/CodexStorage/infinite-canvas-auth-upgrade/plugins/canvas/markdown/package.json",
  )("playwright");
  const root = "H:/CodexStorage/shoushou-agent-receipt-hotfix";
  await mkdir(root, { recursive: true });
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  if (!server.listening) await once(server, "listening");
  const api = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      "H:/CodexStorage/aishenhe-playwright/chromium-1234/chrome-win64/chrome.exe",
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  const errors = [],
    checks = [];
  let inspectionRequests = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  await context.addCookies([
    { name: "hotfix_session", value: token, domain: "127.0.0.1", path: "/" },
  ]);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (route.request().url().endsWith("/reconcile")) inspectionRequests++;
    const response = await route.fetch({
      url: api + url.pathname + url.search,
    });
    await route.fulfill({ response });
  });
  try {
    await page.goto("http://127.0.0.1:5230/canvas/" + projectId, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("button", { name: "原生创作助手", exact: true })
      .last()
      .click({ timeout: 45000 });
    const panel = page.getByRole("complementary", { name: "原生创作助手面板" }),
      button = panel.getByRole("button", {
        name: "核查原模型回执",
        exact: true,
      });
    await button.waitFor({ timeout: 30000 });
    const before = submissions();
    let release;
    setReceiptGate(new Promise((resolve) => { release = resolve; }));
    await button.evaluate((element) => { element.click(); element.click(); });
    await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some((element) => element.textContent.includes("核查原模型回执") && element.disabled));
    checks.push("重复点击仅提交一次核查，核查期间按钮显示忙碌且禁用");
    release(); setReceiptGate(undefined);
    await panel.getByText(/已查到原请求扣费账单/).waitFor();
    checks.push("真实页面点击核查，服务端查询原账单并展示结果");
    assert.equal(submissions(), before);
    checks.push("核查不触发新模型提交");
    setUnavailable(true);
    await button.click();
    await panel.getByText(/暂时无法连接供应商账单接口/).waitFor();
    checks.push("供应商503显示明确说明并允许再次核查");
    setUnavailable(false);
    await button.click();
    await panel.getByText(/已查到原请求扣费账单/).waitFor();
    assert.equal(inspectionRequests, 3);
    assert.equal(submissions(), before);
    checks.push("错误后再次核查成功，无重复提交和额外费用");
    await page.screenshot({ path: root + "/receipt-inspected.png" });
    await panel.getByRole("button", { name: "结束任务，保留核查记录", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "结束任务并保留核查记录" });
    await dialog.getByText(/未核清的积分预留不会自动释放或退款/).waitFor();
    await dialog.getByRole("button", { name: "继续保留任务" }).click();
    await button.waitFor();
    checks.push("结束任务前明确提示费用与历史影响，可以取消确认");
    await panel.getByRole("button", { name: "结束任务，保留核查记录", exact: true }).click();
    await dialog.getByRole("button", { name: "确认结束任务" }).click();
    await panel.getByText(/任务已结束，消息和账单仍保留/).waitFor();
    await verifyEnded();
    assert.equal(submissions(), before);
    checks.push("明确确认后结束原任务并解除输入阻塞，积分预留/账单不变且不自动重发");
    assert.deepEqual(errors, []);
    await writeFile(
      root + "/browser.json",
      JSON.stringify(
        { checks, errors, inspectionRequests, newPaidCalls: 0 },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        browserChecks: checks.length,
        browserErrors: errors.length,
      }),
    );
  } catch (e) {
    await writeFile(root + "/browser-errors.json", JSON.stringify(errors));
    await page.screenshot({ path: root + "/browser-failure.png" });
    await writeFile(
      root + "/browser-failure.txt",
      (await page.locator("body").innerText()).slice(-20000),
    );
    throw e;
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await context.close();
    await browser.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}
