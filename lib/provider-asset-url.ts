import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNED_URL_TTL_SECONDS = 24 * 60 * 60;

function signingSecret() {
  return process.env.PROVIDER_ASSET_SIGNING_SECRET ?? process.env.SESSION_SECRET;
}

function signature(assetId: string, expires: number, secret: string) {
  return createHmac("sha256", secret)
    .update(`provider-asset:v1:${assetId}:${expires}`)
    .digest("hex");
}

export function createProviderAssetUrl(assetId: string, now = Date.now()) {
  const baseUrl = process.env.PUBLIC_BASE_URL;
  const secret = signingSecret();
  if (!baseUrl?.startsWith("https://") || !secret) {
    throw new Error("真实供应商参考素材需要 HTTPS 公网地址和签名密钥");
  }
  const expires = Math.floor(now / 1000) + SIGNED_URL_TTL_SECONDS;
  const url = new URL(`/api/assets/${assetId}/content`, baseUrl);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signature(assetId, expires, secret));
  return url.toString();
}

export function isValidProviderAssetSignature(
  assetId: string,
  expiresValue: string | null,
  signatureValue: string | null,
  now = Date.now(),
) {
  const secret = signingSecret();
  if (!secret || !expiresValue || !signatureValue || !/^\d+$/.test(expiresValue) || !/^[0-9a-f]{64}$/i.test(signatureValue)) {
    return false;
  }
  const expires = Number(expiresValue);
  const nowSeconds = Math.floor(now / 1000);
  if (!Number.isSafeInteger(expires) || expires < nowSeconds || expires > nowSeconds + SIGNED_URL_TTL_SECONDS) {
    return false;
  }
  const expected = Buffer.from(signature(assetId, expires, secret), "hex");
  const actual = Buffer.from(signatureValue, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
