import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/server", { recursive: true });
await mkdir("dist/assets/_next", { recursive: true });
await cp(".next/static", "dist/assets/_next/static", { recursive: true });
await cp("public", "dist/assets", { recursive: true });
const html = await readFile(".next/server/app/index.html", "utf8");
await writeFile("dist/assets/index.html", html, "utf8");
await writeFile("dist/server/index.js", `export default { async fetch(request, env) { const url = new URL(request.url); if (url.pathname === "/") return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request)); return env.ASSETS.fetch(request); } };\n`, "utf8");
console.log("[jingjie-site] static worker bundle ready");
