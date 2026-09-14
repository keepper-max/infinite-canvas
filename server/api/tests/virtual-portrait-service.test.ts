import assert from "node:assert/strict";
import test from "node:test";

import { Token360VirtualPortraitClient } from "../src/virtual-portrait-service.js";

const config = {
  baseUrl: "https://example.invalid",
  apiKey: "test-only",
  catalogUrl: "https://example.invalid/models",
};

test("virtual portrait client creates the documented group and multipart asset", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return calls.length === 1
      ? Response.json({
          data: { id: "66062", assetGroupId: "legacy_rf_65723" },
        })
      : Response.json({
          data: {
            id: "record-1",
            assetId: "ta_portrait_1",
            status: "processing",
          },
        });
  };
  try {
    const client = new Token360VirtualPortraitClient(config);
    const group = await client.createGroup("角色库");
    const asset = await client.uploadAsset(
      group.id,
      "角色.png",
      new Uint8Array([1, 2, 3]),
      "image/png",
    );
    assert.deepEqual(group, { id: "legacy_rf_65723", status: "active" });
    assert.equal(asset.assetId, "ta_portrait_1");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
      name: "角色库",
      groupKind: "VIRTUAL_PORTRAIT",
    });
    const form = calls[1]?.init?.body;
    assert.ok(form instanceof FormData);
    assert.equal(form.get("groupId"), "legacy_rf_65723");
    assert.equal(form.get("name"), "角色.png");
    assert.ok(form.get("file") instanceof Blob);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("virtual portrait client repairs a stored internal group record ID", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({
      data: {
        items: [
          {
            id: "66062",
            assetGroupId: "legacy_rf_65723",
            groupKind: "VIRTUAL_PORTRAIT",
          },
        ],
      },
    });
  };
  try {
    const client = new Token360VirtualPortraitClient(config);
    assert.equal(await client.resolveGroupId("66062"), "legacy_rf_65723");
    assert.equal(
      await client.resolveGroupId("legacy_rf_65723"),
      "legacy_rf_65723",
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("virtual portrait client rejects ordinary upload asset IDs", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ data: { assetId: "ua_ordinary", status: "active" } });
  try {
    const client = new Token360VirtualPortraitClient(config);
    await assert.rejects(
      client.uploadAsset(
        "group-1",
        "角色.png",
        new Uint8Array([1]),
        "image/png",
      ),
      /没有返回可用的 Asset ID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
