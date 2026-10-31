import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const { chromium } = createRequire(new URL("../../plugins/canvas/markdown/package.json", import.meta.url))("playwright");
const output = process.env.POSE_COSTUME_TEST_OUTPUT || "H:/CodexStorage/pose-costume-verification";
await mkdir(output, { recursive: true });
const root = fileURLToPath(new URL("../", import.meta.url));
const { createHash } = await import("node:crypto");
const catalog = process.env.POSE_COSTUME_TEST_CATALOG
    ? await readFile(process.env.POSE_COSTUME_TEST_CATALOG)
    : Buffer.from(await (await fetch("https://raw.githubusercontent.com/hongye007/open-pose-costume/0cc039e096ac4ec2e2a24c2972e5e9c930235cb1/public/data/catalog.json")).arrayBuffer());
assert.equal(createHash("sha256").update(catalog).digest("hex"), "de5480fb921115055e6eb69896dfa103f43149dfaaed05961042ca2d9076a5a1");
const items = JSON.parse(catalog).items;
const portrait = items.find((item) => item.kind === "character");
const pose = items.find((item) => item.kind === "pose" && !item.extended && item.variants.length > 1);
// One CC0 fixture image serves browser image requests; upstream pose/costume images are not downloaded by this test.
const image = process.env.POSE_COSTUME_TEST_IMAGE ? await readFile(process.env.POSE_COSTUME_TEST_IMAGE) : Buffer.from(await (await fetch(portrait.variants[0].thumbnail)).arrayBuffer());
const refs = Object.fromEntries(
    ["character", "pose", "costume"].map((role, index) => [
        role,
        { assetId: `00000000-0000-4000-8000-00000000000${index}`, assetVersionId: `00000000-0000-4000-9000-00000000000${index}`, name: `自有${role}`, mimeType: "image/png", width: 300, height: 400 },
    ]),
);
let draft = { nodes: [{ id: "library-b", type: "reference:pose-costume", title: "参考库", position: { x: 0, y: 0 }, width: 420, height: 230, metadata: { poseCostume: { slots: refs, model: "managed::test.image" } } }] };
let role = "editor";
const calls = [];
let taskStatus = "completed";
let cancelCalls = 0;
let retryCalls = 0;
const errors = [];
const trialImageRequests = [];
const server = await createServer({
    root,
    server: { port: 0, open: false, hmr: false, watch: null },
    plugins: [
        {
            name: "pose-costume-browser-fixture",
            configureServer(server) {
                server.middlewares.use(async (req, res, next) => {
                    if (req.url?.startsWith("/__pose-test-state")) {
                        if (req.method === "PUT") {
                            const chunks = [];
                            for await (const chunk of req) chunks.push(chunk);
                            draft = JSON.parse(Buffer.concat(chunks).toString());
                        }
                        res.setHeader("Content-Type", "application/json");
                        res.end(JSON.stringify(draft));
                        return;
                    }
                    if (req.url?.split("?")[0] === "/__pose-test") {
                        const html = await server.transformIndexHtml(req.url, '<html><body><div id="root"></div><script type="module" src="/tests/fixtures/pose-costume-harness.tsx"></script></body></html>');
                        res.end(html);
                        return;
                    }
                    next();
                });
            },
        },
    ],
});
await server.listen();
console.log("Browser fixture server ready");
const browser = await chromium.launch({ headless: true, executablePath: process.env.POSE_COSTUME_TEST_CHROME || "H:/CodexStorage/aishenhe-playwright/chromium-1234/chrome-win64/chrome.exe" });
console.log("Isolated browser launched");
const context = await browser.newContext({ viewport: { width: 1450, height: 1100 } });
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (value) => {
    if (value.type() === "error") console.error(value.text());
});
await page.route("https://raw.githubusercontent.com/**/catalog.json", (route) => route.fulfill({ body: catalog, contentType: "application/json", headers: { "access-control-allow-origin": "*" } }));
await page.route("https://ai-portrait-gallery.pages.dev/**", (route) => route.fulfill({ body: image, contentType: "image/webp", headers: { "access-control-allow-origin": "*" } }));
await page.route(/https:\/\/ai-(?:pose|costume|pose-depth)-gallery\.pages\.dev\/.*\.(?:png|jpg|webp)/, (route) => {
    trialImageRequests.push(route.request().url());
    return route.fulfill({ body: image, contentType: "image/webp", headers: { "access-control-allow-origin": "*" } });
});
await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
        const request = route.request(),
            url = new URL(request.url());
        const reply = (data) => route.fulfill({ json: { data } });
        if (url.pathname === "/api/auth/me") return reply({ user: { id: "test-editor" }, workspace: { projectId: "project-b" } });
        if (url.pathname === "/api/projects/project-b") return reply({ project: { projectId: "project-b", role } });
        if (url.pathname === "/api/asset-versions/downloads") return reply({ versions: Object.fromEntries(JSON.parse(request.postData()).versionIds.map((id) => [id, { url: `/api/test-image/${id}` }])) });
        if (/^\/api\/asset-versions\/[^/]+\/download$/.test(url.pathname)) return reply({ url: `/api/test-image/${url.pathname.split("/")[3]}` });
        if (url.pathname.startsWith("/api/test-image/")) return route.fulfill({ body: image, contentType: "image/webp" });
        if (url.pathname === "/api/projects/project-b/jobs") {
            calls.push(JSON.parse(request.postData()));
            return reply({ job: { id: `test-job-${calls.length}`, projectId: "project-b", nodeId: "library-b", status: "queued", progress: 0 } });
        }
        if (/^\/api\/jobs\/test-job-[\w-]+\/cancel$/.test(url.pathname)) {
            cancelCalls++;
            taskStatus = "cancelled";
            return reply({ job: { id: url.pathname.split("/")[3], projectId: "project-b", nodeId: "library-b", status: taskStatus, progress: 0 } });
        }
        if (/^\/api\/jobs\/test-job-[\w-]+\/retry$/.test(url.pathname)) {
            retryCalls++;
            taskStatus = "completed";
            return reply({ job: { id: "test-job-retry", projectId: "project-b", nodeId: "library-b", status: "queued", progress: 0 } });
        }
        if (/^\/api\/jobs\/test-job-[\w-]+$/.test(url.pathname))
            return reply({
                job: {
                    id: url.pathname.split("/")[3],
                    projectId: "project-b",
                    nodeId: "library-b",
                    status: taskStatus,
                    progress: taskStatus === "completed" ? 100 : 0,
                    ...(taskStatus === "failed" ? { error: { message: "模拟可重试失败", code: "TEST_FAILURE", retryable: true } } : {}),
                    artifacts: taskStatus === "completed" ? [{ id: "output", assetId: "generated-asset", assetVersionId: "generated-version", mimeType: "image/webp" }] : [],
                },
            });
        if (url.pathname === "/api/projects/project-b/assets")
            return reply({
                assets: [
                    {
                        id: "pose-asset",
                        name: "已选姿势",
                        versions: pose.variants.map((variant, index) => ({
                            id: `00000000-0000-4000-a000-00000000000${index}`,
                            mimeType: "image/png",
                            width: 300,
                            height: 400,
                            provenance: {
                                referenceCatalogId: pose.id,
                                referenceVariantId: variant.id,
                                referenceCommit: "0cc039e096ac4ec2e2a24c2972e5e9c930235cb1",
                                originalUrl: variant.original,
                                source: pose.source,
                                license: "individual-creative-reference-only",
                            },
                        })),
                    },
                ],
            });
        return route.fulfill({ status: 500, json: { error: { message: `Unexpected browser fixture request ${url.pathname}` } } });
    },
);
const checks = [];
try {
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__pose-test`);
    console.log("Browser fixture page loaded");
    await page.getByText("已核验目录", { exact: false }).waitFor();
    await page.getByRole("tab", { name: "人物 1499", exact: true }).waitFor();
    await page.getByLabel("参考库搜索", { exact: true }).fill(`${portrait.code} ${portrait.title.en.split(" ")[0]}`);
    await page.getByText("筛选结果 1 项", { exact: true }).waitFor();
    await page.getByRole("button", { name: `收藏 ${portrait.code}`, exact: true }).click();
    await page.getByRole("button", { name: `取消收藏 ${portrait.code}`, exact: true }).waitFor();
    checks.push("Full pinned catalog loads; bilingual multiword ID search and favorites work");
    console.log(checks.at(-1));
    await page.getByRole("tab", { name: "姿势 288", exact: true }).click();
    await page.getByLabel("参考库搜索", { exact: true }).fill(pose.id);
    await page.locator("article").first().locator("button").first().click();
    const detailDialog = page.getByRole("dialog").last();
    await detailDialog.getByLabel("参考视角").click();
    await detailDialog.getByLabel("参考视角").press("ArrowDown");
    await detailDialog.getByLabel("参考视角").press("Enter");
    assert.equal(await detailDialog.getByRole("button", { name: "添加图片节点", exact: true }).isDisabled(), false);
    await detailDialog.getByLabel("深度图参考", { exact: true }).check();
    await detailDialog.locator("img").first().waitFor();
    await detailDialog.getByLabel("深度图参考", { exact: true }).uncheck();
    await detailDialog.getByRole("button", { name: "加入姿势位置", exact: true }).click();
    await page.getByText("已选姿势", { exact: true }).waitFor();
    const imported = draft.nodes[0].metadata.poseCostume.slots.pose;
    assert.equal(imported.catalogId, pose.id);
    assert.equal(imported.source, pose.source);
    refs.pose = imported;
    await detailDialog.getByRole("button", { name: "Close", exact: true }).click();
    assert.ok(trialImageRequests.length > 0);
    checks.push("Local personal trial previews pose views/depth and selects the original reference into the pairing slot");
    console.log(checks.at(-1));
    await page.getByRole("button", { name: "保存搭配", exact: true }).click();
    await page.getByLabel("组合名称", { exact: true }).fill("测试搭配");
    await page.getByRole("button", { name: /^保\s*存$/ }).click();
    await page.getByRole("button", { name: "测试搭配", exact: true }).waitFor();
    await page.getByRole("button", { name: "参考生成", exact: true }).click();
    await page.getByRole("button", { name: "我已了解，开始生成", exact: true }).click();
    await page.getByText("参考与结果", { exact: true }).waitFor();
    await page.getByRole("button", { name: "测试搭配", exact: true }).waitFor();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].nodeId, "library-b");
    assert.deepEqual(
        calls[0].references.map((item) => item.assetVersionId),
        [refs.character.assetVersionId, refs.pose.assetVersionId, refs.costume.assetVersionId],
    );
    assert.equal(draft.nodes.filter((node) => node.type === "image").length, 1);
    assert.equal(draft.nodes.find((node) => node.type === "image").metadata.assetVersionId, "generated-version");
    checks.push("Actual service submits three ordered references with project URL/node; mocked result becomes an image node");
    await page.getByLabel("叠加对照", { exact: true }).check();
    await page.getByRole("slider").waitFor();
    await page.screenshot({ path: `${output}/library-and-comparison.png`, fullPage: true });
    await page.reload();
    await page.getByText("参考与结果", { exact: true }).waitFor();
    assert.equal(calls.length, 1);
    assert.equal(draft.nodes.filter((node) => node.type === "image").length, 1);
    checks.push("Refresh restores the saved run/result without another submission or duplicate node; overlay is available");
    taskStatus = "running";
    await page.getByRole("button", { name: "参考生成", exact: true }).click();
    await page.getByRole("button", { name: "我已了解，开始生成", exact: true }).click();
    await page.getByRole("button", { name: "申请取消任务", exact: true }).click();
    await page.getByText(/任务：\s*已取消/).waitFor();
    assert.equal(cancelCalls, 1);
    taskStatus = "failed";
    await page.getByRole("button", { name: "参考生成", exact: true }).click();
    await page.getByRole("button", { name: "我已了解，开始生成", exact: true }).click();
    await page.getByRole("button", { name: "重试原任务（可能产生积分）", exact: true }).click();
    await page.getByRole("button", { name: "我已了解，开始生成", exact: true }).click();
    await page.getByText(/任务：\s*已完成/).waitFor();
    assert.equal(retryCalls, 1);
    assert.equal(calls.length, 3);
    checks.push("Saved combinations restore; cancellation and retry use existing server endpoints without a duplicate create request");
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__pose-test?theme=dark`);
    await page.getByRole("tab", { name: "人物 1499", exact: true }).waitFor();
    await page.screenshot({ path: `${output}/library-dark.png`, fullPage: true });
    checks.push("Existing dark theme renders the reference library");
    role = "viewer";
    await page.reload();
    await page.getByText("当前项目仅可查看。", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "参考生成", exact: true }).isDisabled(), true);
    checks.push("Viewer project role disables mutations and generation");
    assert.deepEqual(errors, []);
    assert.ok(trialImageRequests.length > 0);
    await writeFile(`${output}/browser-results.json`, JSON.stringify({ checks, errors, paidGenerationCalls: 0, fixtureSubmissionCount: calls.length, trialImageRequests: trialImageRequests.length }, null, 2));
    console.log(JSON.stringify({ checks, output, errors }, null, 2));
} catch (error) {
    await page.screenshot({ path: `${output}/failure.png`, fullPage: true, timeout: 5000 }).catch(() => {});
    console.error(JSON.stringify({ checks, errors, body: (await page.locator("body").innerText()).slice(0, 3500) }, null, 2));
    throw error;
} finally {
    await browser.close();
    await server.close();
}
