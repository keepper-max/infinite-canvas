const key = process.env.TOKEN360_API_KEY;
const upstream = "https://api.token360.ai";
const root = "/usr/share/nginx/html";
async function proxy(request, url) {
  const target = `${upstream}${url.pathname.replace(/^\/api\/token360/, "")}${url.search}`;
  const headers = new Headers({
    Authorization: `Bearer ${key}`,
    "Content-Type": request.headers.get("content-type") || "application/json",
    Accept: "application/json",
    "User-Agent": "curl/8.0",
  });
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
  if (body) headers.set("content-length", String(body.byteLength));
  const response = await fetch(target, { method: request.method, headers, body });
  return new Response(response.body, { status: response.status, headers: response.headers });
}
Bun.serve({ port: 3000, async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/token360/")) {
    if (!key) return Response.json({ error: { message: "Token360 is not configured" } }, { status: 503 });
    try { return await proxy(request, url); } catch (error) { return Response.json({ error: { message: error instanceof Error ? error.message : "Upstream request failed" } }, { status: 502 }); }
  }
  if (url.pathname === "/config.js") return new Response("window.__RUNTIME_CONFIG__ = {};", { headers: { "Content-Type": "application/javascript", "Cache-Control": "no-store" } });
  const path = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = Bun.file(`${root}${path}`);
  if (await file.exists()) return new Response(file);
  return new Response(Bun.file(`${root}/index.html`));
}});
