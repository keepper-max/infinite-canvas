import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
const require = createRequire(
  new URL("../../../plugins/canvas/markdown/package.json", import.meta.url),
);
const { chromium } = require("playwright");
const output = "H:/CodexStorage/ziwei-website-verification" + (process.env.ZIWEI_TEST_ORIGIN ? "/public" : "");
await mkdir(`${output}/tmp`, { recursive: true });
process.env.TMP = process.env.TEMP = `${output}/tmp`;
const probe = createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const host = process.env.ZIWEI_TEST_ORIGIN || `http://127.0.0.1:${port}`;
const server = process.env.ZIWEI_TEST_ORIGIN ? null : spawn(process.execPath, ["preview.cjs"], {
  cwd: fileURLToPath(new URL("../../", import.meta.url)),
  env: { ...process.env, WEBSITE_PREVIEW_PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
if (server) await new Promise((resolve, reject) => {
  server.stdout.on("data", () => resolve());
  server.once("error", reject);
  server.once("exit", (code) => reject(new Error(`Preview exited ${code}`)));
});
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.ZIWEI_TEST_CHROME ||
    "H:/CodexStorage/aishenhe-playwright/chromium-1234/chrome-win64/chrome.exe",
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  acceptDownloads: true,
});
const errors = [],
  outbound = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (/^https?:/.test(request.url()) && !request.url().startsWith(host))
    outbound.push(request.url());
});
// Isolate clipboard QA from the user's real system clipboard.
await page.addInitScript(() => {
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: async (value) => {
        window.__copied = value;
      },
    },
  });
});
try {
  await page.goto(host, { waitUntil: "domcontentloaded" });
  await page.locator('#primary-nav a[href="/ziwei/"]').click();
  assert.equal(new URL(page.url()).pathname, "/ziwei/");
  await page.locator("#birth-fields").waitFor({ state: "visible" });
  await page.waitForFunction(
    () => !document.querySelector("#birth-fields").disabled,
  );
  await page
    .getByRole("button", { name: /生成十二宫命盘/ })
    .evaluate((button) => {
      button.click();
      button.click();
    });
  await page
    .getByRole("alert")
    .filter({ hasText: "请填写有效的公历出生日期" })
    .waitFor();
  await page.getByLabel("出生日期", { exact: false }).fill("1990-06-15");
  await page.getByLabel("出生时间", { exact: false }).fill("12:30");
  await page.getByLabel("性别", { exact: true }).selectOption("female");
  await page.getByLabel("出生地", { exact: true }).fill("北京市海淀区");
  await page.getByRole("button", { name: /生成十二宫命盘/ }).click();
  await page.getByText("命盘已生成", { exact: true }).waitFor();
  assert.equal(await page.locator(".palace").count(), 12);
  await page.getByRole("button", { name: "保存本机", exact: true }).click();
  await page.getByText(/已保存到本机浏览器/).waitFor();
  await page.reload();
  await page
    .getByText("已恢复本机保存的出生资料与命盘。", { exact: true })
    .waitFor();
  assert.equal(await page.locator("#birth-date").inputValue(), "1990-06-15");
  assert.equal(await page.locator("#birth-time").inputValue(), "12:30");
  assert.equal(await page.locator("#gender").inputValue(), "female");
  assert.equal(await page.locator("#birthplace").inputValue(), "北京市海淀区");
  assert.equal(await page.locator(".palace").count(), 12);
  await page
    .getByRole("button", { name: "复制 AI 解读资料", exact: true })
    .click();
  const copied = await page.evaluate(() => window.__copied);
  assert.match(copied, /palaces|紫微斗数命盘/);
  assert.doesNotMatch(copied, /1990-06-15|12:30|海淀/);
  assert.match(copied, /relationshipFramework/);
  assert.match(copied, /breaking|成立条件/);
  assert.equal(await page.locator("#pattern-clues").isVisible(), true);
  await page.locator("#birth-date").fill("1991-01-01");
  await page.getByText("旧结果 · 请重新排盘", { exact: true }).waitFor();
  assert.equal(await page.locator("#copy").isDisabled(), true);
  assert.equal(await page.locator("#export").isDisabled(), true);
  assert.equal(await page.locator("#pattern-clues").isVisible(), false);
  await page.getByRole("button", { name: /重新生成命盘/ }).click();
  await page.getByText("命盘已生成", { exact: true }).waitFor();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON", exact: true }).click();
  const exported = await downloading;
  await exported.saveAs(`${output}/chart.json`);
  const record = JSON.parse(await readFile(`${output}/chart.json`, "utf8"));
  assert.equal(record.state.input.date, "1991-01-01");
  assert.equal(record.state.result.chart.palaces.length, 12);
  let submitted = 0;
  let releaseFirst;
  let notifyFirst;
  const firstArrived = new Promise(resolve => {notifyFirst=resolve;});
  await page.route('**/api/website/ziwei/interpret', async route => {
    const request = route.request().postDataJSON();
    assert.doesNotMatch(JSON.stringify(request), /海淀|1991-01-01|12:30|sk-/);
    submitted++;
    if (submitted === 1) await new Promise(resolve => {releaseFirst=resolve;notifyFirst();});
    const payload = submitted < 3 ? {data:{schemaVersion:1,requestId:request.requestId,chartFingerprint:request.chartFingerprint,text:'浏览器测试解读：结合当前命盘的星曜证据。',model:'deepseek-v4.1-flash-1017',remainingCalls:2-submitted}} : {error:{code:'ZIWEI_RATE_LIMITED',message:'同一 IP 在滚动 24 小时内最多解读 2 次，请稍后再试'}};
    await route.fulfill({status:submitted < 3 ? 200 : 429,contentType:'application/json',body:JSON.stringify(payload)});
  });
  await page.locator('#interpret').click();
  await page.waitForFunction(() => document.querySelector('#interpret').disabled);
  await page.locator('#interpret').evaluate(button => button.click());
  // Wait on the intercepted request, without allowing a second model submission.
  await firstArrived;
  await page.locator('#birth-time').fill('13:00');
  releaseFirst();
  await page.getByText(/先前命盘的解读已返回/).waitFor();
  assert.equal(await page.locator('#interpretation').isVisible(),false);
  assert.equal(submitted,1);
  await page.locator('#generate').click();
  await page.getByText('命盘已生成',{exact:true}).waitFor();
  await page.locator('#interpret').click();
  await page.locator('#interpretation').getByText(/浏览器测试解读/).waitFor();
  await page.locator('#save').click();
  await page.getByText(/已保存到本机浏览器/).waitFor();
  await page.reload();
  await page.getByText('已恢复本机保存的出生资料与命盘。',{exact:true}).waitFor();
  assert.match(await page.locator('#interpretation').innerText(), /浏览器测试解读/);
  await page.locator('#interpret').click();
  await page.locator('#interpretation-status').getByText(/最多解读 2 次/).waitFor();
  assert.equal(submitted,3);
  await page.unroute('**/api/website/ziwei/interpret');
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.equal(
    await page
      .locator('a[href="https://canvas.shoumiren.online/text"]')
      .count(),
    0,
  );
  assert.equal(
    await page.locator('a[href="https://ouranic.cn/chart"]').count(),
    1,
  );
  await page.getByRole("button", { name: "清除本机记录", exact: true }).click();
  await page.getByText(/本机记录已清除/).waitFor();
  await page.reload();
  await page.waitForFunction(
    () => !document.querySelector("#birth-fields").disabled,
  );
  assert.equal(await page.locator("#birth-date").inputValue(), "");
  assert.equal(await page.locator(".palace").count(), 0);
  for (const path of [
    "/ziwei/src/app.ts",
    "/ziwei/package.json",
    "/ziwei/node_modules/iztro/package.json",
  ])
    assert.equal((await page.request.get(host + path)).status(), 404);
  assert.equal(
    (await page.request.get(host + "/ziwei/credits.html")).status(),
    200,
  );
  assert.equal(
    (
      await page.request.get(host + "/ziwei/licenses/ziwei-doushu.txt")
    ).status(),
    200,
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  const contract = await page.request.get(host + '/ziwei/api-contract.json');
  assert.equal(contract.status(), 200);
  assert.equal((await contract.json()).status, 'enabled');
  const invalid = await page.request.post(host + '/api/website/ziwei/interpret', {headers:{Origin:host},data:{schemaVersion:1}});
  assert.equal(invalid.status(), process.env.ZIWEI_TEST_ORIGIN ? 422 : 503);
  assert.equal(outbound.length, 0, outbound.join("\n"));
  console.log(
    "PASS: homepage entry → invalid/repeated click → chart → save/reload → copy → stale block → regenerate → JSON export → mobile → clear → public allowlist. No external requests.",
  );
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  await writeFile(
    `${output}/failure.txt`,
    await page.locator("body").innerText(),
  );
  throw error;
} finally {
  await writeFile(
    `${output}/diagnostics.json`,
    JSON.stringify({ errors, outbound }, null, 2),
  );
  await browser.close();
  server?.kill();
}
