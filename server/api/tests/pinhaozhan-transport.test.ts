import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import type { lookup } from "node:dns";
import { createPinhaozhanTransport } from "../src/pinhaozhan-transport.js";
const fetchWith = (url: string, dispatcher: unknown, init: RequestInit = {}) =>
  fetch(url, { ...init, dispatcher } as RequestInit);
test("real sockets: readonly GET changes DNS address once; POST uses healthy address without resubmission", async () => {
  let requests = 0,
    posts = 0,
    lookups = 0;
  const server = createServer((req, res) => {
    requests++;
    if (req.method === "POST") posts++;
    res.setHeader("Connection", "close");
    res.end('{"success":true}');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const resolver = ((_h: unknown, _o: unknown, cb: any) => {
    lookups++;
    cb(null, [
      { address: "127.0.0.2", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
  }) as typeof lookup;
  const transport = createPinhaozhanTransport(resolver),
    url = `http://provider.test:${(server.address() as any).port}`;
  try {
    assert.equal(
      (await (await fetchWith(url, transport.readonly)).json()).success,
      true,
    );
    assert.equal(lookups, 2);
    assert.equal(requests, 1);
    await (
      await fetchWith(url, transport.agent, {
        method: "POST",
        body: "synthetic",
      })
    ).text();
    assert.equal(posts, 1);
    assert.equal(lookups, 3);
    assert.equal(requests, 2);
  } finally {
    await transport.agent.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("all routes unavailable: GET capped at two connections, inference POST one connection; abort never retries", async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as any).port;
  await new Promise<void>((r) => server.close(() => r()));
  let n = 0;
  const resolver = ((_h: unknown, _o: unknown, cb: any) => {
    n++;
    cb(null, [
      { address: "127.0.0.2", family: 4 },
      { address: "127.0.0.3", family: 4 },
    ]);
  }) as typeof lookup;
  const t = createPinhaozhanTransport(resolver),
    url = `http://provider.test:${port}`;
  try {
    await assert.rejects(fetchWith(url, t.readonly));
    assert.equal(n, 2);
    await assert.rejects(
      fetchWith(url, t.agent, { method: "POST", body: "synthetic" }),
    );
    assert.equal(n, 3);
    await assert.rejects(
      fetchWith(url, t.readonly, { signal: AbortSignal.abort() }),
    );
    assert.equal(n, 3);
  } finally {
    await t.agent.destroy();
  }
});
test("HTTP errors are returned once, not retried or treated as an address failure", async () => {
  let n = 0;
  const s = createServer((_q, r) => {
    n++;
    r.writeHead(503);
    r.end("unavailable");
  });
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const resolver = ((_h: unknown, _o: unknown, cb: any) =>
      cb(null, [{ address: "127.0.0.1", family: 4 }])) as typeof lookup,
    t = createPinhaozhanTransport(resolver);
  try {
    const r = await fetchWith(
      `http://provider.test:${(s.address() as any).port}`,
      t.readonly,
    );
    assert.equal(r.status, 503);
    await r.text();
    assert.equal(n, 1);
  } finally {
    await t.agent.destroy();
    await new Promise<void>((r) => s.close(() => r()));
  }
});
