// Isolated security checks: no real repository, account, storage or provider calls.
import assert from "node:assert/strict";
import { createApp } from "../../server/api/src/app.js";
import { createJobSchema } from "../../server/api/src/job-contract.js";
import { beginAssetUploadSchema } from "../../server/api/src/asset-contract.js";
import { RunningHubProvider } from "../../server/api/src/runninghub-provider.js";
import { DomainError } from "../../server/api/src/domain.js";

async function main() {
  const config = { cookieName: "probe", cookieSecure: true, sessionDays: 1, trustedOrigins: [] } as any;
  let lookups = 0;
  const repository = { findUserByEmail: async () => { lookups++; return null; } } as any;
  const limiter = { reserve: async () => { throw new DomainError("AUTH_RATE_LIMITED", "local probe", 429, true, { details: { retryAfterSeconds: 300 } }); }, finish: async () => {} };
  const app = createApp(repository, config, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, limiter);
  for (const path of ["/api/auth/login", "/api/auth/login/password"]) {
    const statuses: number[] = [];
    for (let i = 0; i < 2; i++) {
      const body = path.endsWith("/password")
        ? { channel: "email", account: "probe@example.invalid", password: "invalid-password" }
        : { email: "probe@example.invalid", password: "invalid-password" };
      const response = await app.request(`https://shoumiren.online${path}`, {
        method: "POST", headers: { "content-type": "application/json", origin: "https://shoumiren.online" }, body: JSON.stringify(body),
      });
      statuses.push(response.status);
    }
    assert(statuses.every((status) => status === 429));
    console.log(JSON.stringify({ test: "local-password-guard-routing", path, attempts: statuses.length, all429: true }));
  }
  assert.equal(lookups, 0);
  const svg = beginAssetUploadSchema.safeParse({ kind: "image", name: "inert-probe.svg", mimeType: "image/svg+xml", bytes: 60, sha256: "a".repeat(64) });
  assert.equal(svg.success, true);
  console.log(JSON.stringify({ test: "svg-upload-contract", accepted: svg.success }));
  const input = createJobSchema.parse({ modelId: "local-probe", capability: "image", mode: "i2i", prompt: "local probe", idempotencyKey: "local-security-probe", references: [{ role: "first_frame", url: "http://127.0.0.1:9/inert-probe" }] });
  const realFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = (async () => { networkCalls++; throw new Error("network intentionally blocked by probe"); }) as any;
  try {
    const provider = new RunningHubProvider({ apiKey: "dummy-local-probe", baseUrl: "https://provider.example.invalid" } as any, 1000);
    await assert.rejects(provider.uploadReference(input.references[0] as any), { code: "UNSAFE_MEDIA_URL" });
    assert.equal(networkCalls, 0);
    console.log(JSON.stringify({ test: "private-reference-fetch", contractAccepted: true, attemptedFetch: false, realNetworkRequests: 0 }));
  } finally { globalThis.fetch = realFetch; }
  const mediaApp = createApp({ findUserBySession: async () => ({ id: "probe-user", accountStatus: "active" }) } as any, config, {
    openMediaDownload: async () => ({ body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')); controller.close(); } }), mimeType: "image/svg+xml", bytes: 41, status: 200 }),
  } as any);
  const media = await mediaApp.request("https://shoumiren.online/api/media/asset-versions/00000000-0000-4000-8000-000000000000", { headers: { cookie: "probe=dummy-local-session" } });
  assert.equal(media.status, 200);
  assert.match(media.headers.get("content-security-policy") || "", /sandbox/);
  console.log(JSON.stringify({ test: "svg-media-response", status: media.status, mimeType: media.headers.get("content-type"), disposition: media.headers.get("content-disposition"), csp: media.headers.get("content-security-policy") }));
}
void main().catch((error) => { console.error(error.message); process.exitCode = 1; });
