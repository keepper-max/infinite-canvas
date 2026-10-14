const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function createClient(status, code) {
    const events = [];
    const exports = {};
    const source = fs.readFileSync(require.resolve("../src/services/api/platform.ts"), "utf8");
    const { outputText } = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    vm.runInNewContext(outputText, {
        exports,
        Event,
        DOMException,
        window: { dispatchEvent: (event) => events.push(event.type) },
        fetch: async () => new Response(JSON.stringify(status === 200 ? { data: { ok: true } } : { error: { code } }), { status }),
    });
    return { ...exports, events };
}

test("revoked platform session notifies the auth gate and still rejects the request", async () => {
    const client = createClient(401, "UNAUTHENTICATED");
    await assert.rejects(client.getCurrentSession(), (error) => error.status === 401 && error.code === "UNAUTHENTICATED");
    assert.deepEqual(client.events, [client.PLATFORM_SESSION_EXPIRED_EVENT]);
});

test("wrong credentials, permission denial and service failures do not sign out a valid session", async () => {
    for (const [status, code] of [[401, "INVALID_CREDENTIALS"], [403, "FORBIDDEN"], [503, "UNAVAILABLE"], [0, "NETWORK_ERROR"]]) {
        const client = createClient(status, code);
        await assert.rejects(client.getCurrentSession());
        assert.deepEqual(client.events, []);
    }
});

test("successful requests preserve the session", async () => {
    const client = createClient(200);
    const result = await client.getCurrentSession();
    assert.equal(result.ok, true);
    assert.deepEqual(client.events, []);
});
