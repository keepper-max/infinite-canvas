import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { MEDIA_SANDBOX_CSP } from "../src/media-security.js";

test("media responses isolate active documents while retaining MIME and video Range", async () => {
  assert.match(MEDIA_SANDBOX_CSP, /sandbox allow-downloads/);
  assert.doesNotMatch(MEDIA_SANDBOX_CSP, /allow-scripts|allow-same-origin/);
  for (const mimeType of ["image/svg+xml", "image/png", "video/mp4"]) {
    const app = createApp({ findUserBySession: async () => ({ id: "local-user", accountStatus: "active" }) } as any,
      { cookieName: "local", cookieSecure: true, trustedOrigins: [] } as any,
      { openMediaDownload: async (_id: string, _user: string, _thumbnail: boolean, range?: string) => ({ body: new Response("safe").body, status: range ? 206 : 200, bytes: 4, mimeType, contentRange: range ? "bytes 0-3/8" : undefined }) } as any);
    const response = await app.request("https://shoumiren.online/api/media/asset-versions/00000000-0000-4000-8000-000000000000", { headers: { cookie: "local=dummy", range: "bytes=0-3" } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-type"), mimeType);
    assert.equal(response.headers.get("content-range"), "bytes 0-3/8");
    assert.equal(response.headers.get("content-security-policy"), MEDIA_SANDBOX_CSP);
  }
});
