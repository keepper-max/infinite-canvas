import assert from "node:assert/strict";
import test from "node:test";
import { createProviderAssetUrl, isValidProviderAssetSignature } from "@/lib/provider-asset-url";

test("供应商素材签名只在有效期内授权指定素材", () => {
  const previousBase = process.env.PUBLIC_BASE_URL;
  const previousSecret = process.env.PROVIDER_ASSET_SIGNING_SECRET;
  try {
    process.env.PUBLIC_BASE_URL = "https://studio.example.test";
    process.env.PROVIDER_ASSET_SIGNING_SECRET = "test-secret";
    const now = Date.UTC(2026, 8, 25, 0, 0, 0);
    const url = new URL(createProviderAssetUrl("asset-a", now));
    const expires = url.searchParams.get("expires");
    const signature = url.searchParams.get("signature");
    assert.equal(url.origin, "https://studio.example.test");
    assert.equal(isValidProviderAssetSignature("asset-a", expires, signature, now), true);
    assert.equal(isValidProviderAssetSignature("asset-b", expires, signature, now), false);
    assert.equal(isValidProviderAssetSignature("asset-a", expires, signature, now + 24 * 60 * 60 * 1000 + 1000), false);
  } finally {
    if (previousBase === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousBase;
    if (previousSecret === undefined) delete process.env.PROVIDER_ASSET_SIGNING_SECRET;
    else process.env.PROVIDER_ASSET_SIGNING_SECRET = previousSecret;
  }
});

test("供应商素材签名缺少 HTTPS 公网地址或密钥时拒绝生成", () => {
  const previousBase = process.env.PUBLIC_BASE_URL;
  const previousSecret = process.env.PROVIDER_ASSET_SIGNING_SECRET;
  const previousSession = process.env.SESSION_SECRET;
  try {
    process.env.PUBLIC_BASE_URL = "http://localhost:3000";
    delete process.env.PROVIDER_ASSET_SIGNING_SECRET;
    delete process.env.SESSION_SECRET;
    assert.throws(() => createProviderAssetUrl("asset-a"));
  } finally {
    if (previousBase === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousBase;
    if (previousSecret === undefined) delete process.env.PROVIDER_ASSET_SIGNING_SECRET;
    else process.env.PROVIDER_ASSET_SIGNING_SECRET = previousSecret;
    if (previousSession === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSession;
  }
});
