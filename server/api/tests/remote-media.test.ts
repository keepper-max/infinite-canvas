import assert from "node:assert/strict";
import test from "node:test";
import { assertPublicMediaAddress, createPublicMediaConnector, fetchRemoteMedia } from "../src/remote-media.js";

test("media policy blocks private, mapped, reserved and metadata addresses", () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "172.16.1.1", "192.168.0.1", "169.254.169.254", "100.64.1.1", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1", "64:ff9b::a00:1"])
    assert.throws(() => assertPublicMediaAddress(ip), { code: "UNSAFE_MEDIA_URL" });
  for (const ip of ["8.8.8.8", "2606:4700:4700::1111"]) assert.doesNotThrow(() => assertPublicMediaAddress(ip));
});

test("media URL rejects alternate loopback notation and unsafe schemes before fetch", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => { requests++; return new Response("inert"); }) as typeof fetch;
  try {
    for (const url of ["http://2130706433/a", "http://0x7f000001/a", "http://127.1/a", "http://[::ffff:127.0.0.1]/a", "file:///etc/hosts", "ftp://example.com/a", "https://user:pass@example.com/a"])
      await assert.rejects(fetchRemoteMedia(url), { code: "UNSAFE_MEDIA_URL" });
    assert.equal(requests, 0);
    await fetchRemoteMedia("https://media.example/reference.png");
    assert.equal(requests, 1);
    assert.equal(await (await fetchRemoteMedia("data:text/plain,inert")).text(), "inert");
  } finally { globalThis.fetch = original; }
});

test("socket DNS lookup rejects any private answer without connecting", async () => {
  for (const addresses of [[{ address: "127.0.0.1", family: 4 }], [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }]]) {
    const resolve = ((_host: string, _options: unknown, callback: Function) => callback(null, addresses)) as any;
    const connector = createPublicMediaConnector(resolve);
    const error = await new Promise<Error | null>((done) => connector({ hostname: "media.example", host: "media.example", protocol: "http:", port: "80" }, (error) => done(error)));
    assert.equal((error as any)?.code, "UNSAFE_MEDIA_URL");
  }
});

test("connector revalidates literal redirect destinations", async () => {
  const connector = createPublicMediaConnector();
  const error = await new Promise<Error | null>((done) => connector({ hostname: "169.254.169.254", protocol: "http:", port: "80" }, (error) => done(error)));
  assert.equal((error as any)?.code, "UNSAFE_MEDIA_URL");
});
