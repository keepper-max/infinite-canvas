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
 await page.goto('http://127.0.0.1:5196/__p251/real-demo',{waitUntil:'networkidle',timeout:90000});
 await page.getByRole('button',{name:'原生创作助手',exact:true}).last().click();const panel=page.getByRole('complementary',{name:'原生创作助手面板'});await panel.getByText('已完成',{exact:true}).waitFor();await panel.getByText(/Token 63089/).waitFor();await panel.getByRole('button',{name:'定位新节点'}).click();await page.waitForTimeout(250);await panel.getByText('已使用知识来源',{exact:true}).click();await panel.getByText(/林岚人物设定/).last().waitFor();await page.screenshot({path:root+'/artifacts/real-model-canvas.png'});assert.deepEqual(errors,[]);console.log('REAL_SAVED_RESULT_BROWSER_PASS',page.url());
}catch(e){await page.screenshot({path:root+'/artifacts/real-model-browser-failure.png'});throw e;}finally{await context.close();await browser.close();}
