const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { webcrypto } = require("node:crypto");

function load(file, dependencies = {}, globals = {}) {
    const exports = {};
    const source = fs.readFileSync(require.resolve(file), "utf8");
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    vm.runInNewContext(outputText, {
        exports,
        URL,
        TextDecoder,
        crypto: webcrypto,
        fetch,
        require: (name) => {
            if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`);
            return dependencies[name];
        },
        ...globals,
    });
    return exports;
}
const helpers = load("../src/lib/canvas/pose-costume.ts");
function client(assets = {}, jobs = {}, globals = {}, personalTrial = false) {
    return load("../src/services/api/pose-costume.ts", { "@/constant/env": { PERSONAL_REFERENCE_TRIAL: personalTrial }, "@/lib/canvas/pose-costume": helpers, "./assets": assets, "./jobs": jobs }, globals);
}
const ref = (id) => ({ assetId: `asset-${id}`, assetVersionId: `version-${id}`, name: id, mimeType: "image/png" });
const model = { name: "test", capability: "image", modes: ["i2i"], limits: { maxImages: 3 } };

test("three-reference order agrees with the prompt and survives JSON persistence", () => {
    const slots = { costume: ref("outfit"), character: ref("person"), pose: ref("pose") };
    const restored = JSON.parse(JSON.stringify(slots));
    const run = { operationId: "operation", slots: restored, model: "managed::test", prompt: helpers.buildOutfitPrompt(restored), parameters: {} };
    const input = client().outfitJobInput(run, model);
    assert.deepEqual(
        Array.from(input.references, (item) => item.assetVersionId),
        ["version-person", "version-pose", "version-outfit"],
    );
    assert.deepEqual(Array.from(input.trace.inputSnapshot.referenceOrder), ["character", "pose", "costume"]);
    assert.match(input.prompt, /图 1（人物/);
    assert.match(input.prompt, /图 2（姿势/);
    assert.match(input.prompt, /图 3（服装/);
    assert.match(input.prompt, /不复制人偶关节/);
    assert.match(input.prompt, /不复制服装模特身份/);
});

test("two-reference mode renumbers the actual inputs", () => {
    const prompt = helpers.buildOutfitPrompt({ costume: ref("outfit"), pose: ref("pose") });
    assert.match(prompt, /图 1（姿势/);
    assert.match(prompt, /图 2（服装/);
    assert.doesNotMatch(prompt, /图 3|图 1（人物/);
});

test("unsupported or undeclared reference capacity rejects instead of dropping inputs", () => {
    assert.match(helpers.outfitModelError({ ...model, limits: { maxImages: 2 } }, 3), /最多支持 2/);
    assert.match(helpers.outfitModelError({ ...model, limits: {} }, 3), /未声明/);
    assert.ok(helpers.outfitModelError({ ...model, modes: ["t2i"] }, 3));
    assert.equal(helpers.outfitModelError(model, 3), null);
    assert.throws(() => client().outfitJobInput({ slots: { pose: ref("pose") }, prompt: "x" }, model), /补齐/);
});

test("search combines bilingual names, code and keywords, with width normalization", () => {
    const item = {
        id: "full_std_P047",
        code: "P047",
        title: { zh: "单腿站立", en: "Standing pose" },
        keywords: { zh: "重心 左腿", en: "balance left leg grey" },
        category: { id: "standing", zh: "站立", en: "Stand" },
        series: { zh: "全身", en: "Full body" },
    };
    assert.equal(helpers.matchesLibraryQuery(item, "Ｐ０４７ left 重心"), true);
    assert.equal(helpers.matchesLibraryQuery(item, "standing gray"), true);
    assert.equal(helpers.matchesLibraryQuery(item, "站立 missing"), false);
    assert.equal(helpers.matchesLibraryQuery(item, ""), true);
});

test("restricted references cannot trigger image downloads or uploads", async () => {
    let requests = 0;
    const api = client(
        {},
        {},
        {
            fetch: () => {
                requests++;
                throw new Error("not allowed");
            },
        },
    );
    for (const kind of ["pose", "costume"]) await assert.rejects(api.importLibraryReference("project", { kind }, {}), /授权/);
    assert.equal(requests, 0);
    assert.equal(helpers.libraryImagePolicy({ kind: "character" }).license, "CC0-1.0");
});

test("existing library assets reuse their immutable version within the current project", async () => {
    const version = { id: "v-existing", mimeType: "image/png", provenance: { referenceCatalogId: "portrait-a", referenceVariantId: "a", referenceCommit: helpers.POSE_COSTUME_COMMIT } };
    let project;
    const api = client(
        {
            listCloudAssets: async (id) => {
                project = id;
                return [{ id: "a-existing", name: "portrait", versions: [version] }];
            },
        },
        {},
        {
            fetch: () => {
                throw new Error("No repeat image fetch");
            },
        },
    );
    const result = await api.importLibraryReference("project-B", { id: "portrait-a", kind: "character", code: "a", source: "source" }, { id: "a", angle: "front" });
    assert.equal(project, "project-B");
    assert.equal(result.assetVersionId, "v-existing");
    assert.equal(result.variantId, "a");
});

test("submission explicitly carries project, node and durable operation context", async () => {
    const calls = [];
    const api = client(
        {},
        {
            createManagedJob: async (...args) => {
                calls.push(args);
                return { id: "job" };
            },
        },
    );
    const run = { operationId: "pose-costume:stable-operation", slots: { pose: ref("pose"), costume: ref("outfit") }, prompt: "prompt", model: "managed::test", parameters: { count: 1 } };
    await api.submitOutfitJob("project-B", "node-B", run, model);
    await api.submitOutfitJob("project-B", "node-B", JSON.parse(JSON.stringify(run)), model);
    assert.equal(calls[0][1].projectId, "project-B");
    assert.equal(calls[0][1].nodeId, "node-B");
    assert.equal(calls[0][1].idempotencyKey, calls[1][1].idempotencyKey);
    assert.equal(calls[0][0].trace.inputSnapshot.catalogCommit, helpers.POSE_COSTUME_COMMIT);
    assert.equal(calls[0][0].references.length, 2);
});

test("catalog checksum rejects unreviewed or replaced metadata", async () => {
    const api = client({}, {}, { fetch: async () => new Response(JSON.stringify({ items: [] })) });
    await assert.rejects(api.loadReferenceCatalog(), /已核验版本不一致/);
});

test("personal trial permits one selected reference and retains source-use restrictions", async () => {
    const originals = [],
        uploads = [];
    const api = client(
        {
            listCloudAssets: async () => [],
            currentVersion: (asset) => asset.versions[0],
            uploadCloudAsset: async (project, blob, options) => {
                uploads.push({ project, options });
                return { id: "asset", name: "pose", versions: [{ id: "version", mimeType: blob.type, provenance: options.provenance }] };
            },
        },
        {},
        {
            fetch: async (url) => {
                originals.push(url);
                return new Response(new Blob(["fixture"], { type: "image/png" }));
            },
        },
        true,
    );
    const result = await api.importLibraryReference(
        "project-B",
        { id: "pose", code: "P001", kind: "pose", title: { zh: "姿势" }, source: "https://ai-pose-gallery.pages.dev/" },
        { id: "pose_front", angle: "front", label: { zh: "正面" }, original: "https://ai-pose-gallery.pages.dev/img/pose_front.png" },
    );
    assert.equal(originals.length, 1);
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].project, "project-B");
    assert.equal(result.license, "individual-creative-reference-only");
    assert.equal(uploads[0].options.provenance.originalUrl, originals[0]);
    assert.equal(helpers.libraryImagePolicy({ kind: "pose" }).allowed, false);
});

test("depth references preserve real IDs and use a distinct image source", () => {
    const item = {
        kind: "pose",
        source: "https://ai-pose-gallery.pages.dev/",
        variants: [{ id: "full_single_P001_front", angle: "front", original: "https://ai-pose-gallery.pages.dev/img/full_single_P001_front.png", thumbnail: "https://ai-pose-gallery.pages.dev/thumbs/full_single_P001_front.jpg" }],
    };
    const depth = helpers.poseDepthReference(item);
    assert.equal(depth.variants[0].id, item.variants[0].id);
    assert.equal(depth.variants[0].original, "https://ai-pose-depth-gallery.pages.dev/img/full_single_P001_front.png");
    assert.equal(item.source, "https://ai-pose-gallery.pages.dev/");
});

test("trial is confined to loopback development and excluded from production", () => {
    const source = fs.readFileSync(require.resolve("../src/constant/env.ts"), "utf8");
    const expression = source.match(/export const PERSONAL_REFERENCE_TRIAL = (.*);/)[1].replace("import.meta.env.DEV", "development");
    for (const [development, hostname, expected] of [
        [true, "localhost", true],
        [true, "127.0.0.1", true],
        [true, "[::1]", true],
        [false, "localhost", false],
        [true, "shoumiren.online", false],
    ]) {
        assert.equal(vm.runInNewContext(expression, { development, window: { location: { hostname } } }), expected);
    }
});
