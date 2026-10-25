import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
const root = "H:/CodexStorage/shoushou-p25";
const real = process.env.P25_CAPTURE_REAL === "true";
const prefix = real ? "real-" : "";
const f = JSON.parse(
  await readFile(
    root + "/private/" + (real ? "paid-fixture.json" : "fixture-v2.json"),
    "utf8",
  ),
);
const check = JSON.parse(
  await readFile(
    root +
      "/artifacts/" +
      (real ? "real-model-check.json" : "browser-check.json"),
    "utf8",
  ),
);
const { chromium } = createRequire(
  "H:/CodexStorage/infinite-canvas-auth-upgrade/plugins/canvas/markdown/package.json",
)("playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "H:/CodexStorage/aishenhe-playwright/chromium-1234/chrome-win64/chrome.exe",
});
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addCookies([
    { name: "p25_session", value: f.token, domain: "127.0.0.1", path: "/" },
  ]);
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:5195/canvas/" + check.projectId, {
    waitUntil: "networkidle",
  });
  await page
    .getByRole("button", { name: "原生创作助手", exact: true })
    .last()
    .click();
  const panel = page.getByRole("complementary", { name: "原生创作助手面板" });
  await panel.getByText("已完成", { exact: true }).waitFor();
  if (await panel.getByRole("button", { name: "定位新节点" }).isEnabled())
    await panel.getByRole("button", { name: "定位新节点" }).click();
  await page.waitForTimeout(600);
  await page.screenshot({
    path: root + "/artifacts/" + prefix + "desktop-completed.png",
  });
  await page.getByRole("button", { name: "切换到浅色主题" }).last().click();
  await page.getByRole("button", { name: "切换到深色主题" }).last().waitFor();
  await page.waitForFunction(
    () =>
      !document.documentElement.style.getPropertyValue(
        "--magicui-theme-toggle-vt-duration",
      ),
  );
  await panel.getByText("已完成", { exact: true }).waitFor();
  await page.screenshot({
    path: root + "/artifacts/" + prefix + "light-completed.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: root + "/artifacts/" + prefix + "mobile-completed.png",
  });
  console.log("CAPTURE_PASS");
  await context.close();
} finally {
  await browser.close();
}
