const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, dependencies) {
    const exports = {};
    const source = fs.readFileSync(require.resolve(file), "utf8");
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
    vm.runInNewContext(outputText, { exports, require: name => dependencies[name] ?? require(name) });
    return exports;
}

const navigation = load("../src/constant/navigation-tools.ts", { "lucide-react": new Proxy({}, { get: () => () => null }) });

test("navigation exposes the reference library between the 3D desk and image workbench", () => {
    const slugs = Array.from(navigation.navigationTools, tool => tool.slug);
    assert.equal(slugs.indexOf("pose-costume"), slugs.indexOf("director-desk") + 1);
    assert.ok(slugs.indexOf("pose-costume") < slugs.indexOf("image"));
});

test("reference navigation preserves the current project without navigating away from its canvas", () => {
    assert.equal(navigation.navigationToolHref("pose-costume", "/canvas/project-B"), "/canvas/project-B?open=pose-costume");
    assert.equal(navigation.navigationToolHref("pose-costume", "/canvas/project-B/"), "/canvas/project-B?open=pose-costume");
    assert.equal(navigation.navigationToolHref("pose-costume", "/image"), "/pose-costume");
    assert.equal(navigation.navigationToolHref("canvas", "/canvas/project-B"), "/canvas");
});

test("the shared entry opens references in the authenticated default project and leaves the home redirect intact", () => {
    let pathname = "/pose-costume";
    const entry = load("../src/pages/workspace-entry.tsx", { "react-router-dom": { Navigate: () => null, useLocation: () => ({ pathname }) }, "@/components/auth/auth-context": { useAuth: () => ({ workspace: { projectId: "default-project" } }) } });
    assert.equal(entry.default().props.to, "/canvas/default-project?open=pose-costume");
    assert.equal(entry.default().props.replace, true);
    pathname = "/";
    assert.equal(entry.default().props.to, "/canvas/default-project");
});
