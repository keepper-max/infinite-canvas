import { normalize, resolve } from "node:path";

const port = Number(process.env.PORT || 3000);
const apiKey = process.env.TOKEN360_API_KEY?.trim() || "";
const upstream = (process.env.TOKEN360_UPSTREAM?.trim() || "https://api.token360.ai").replace(/\/+$/, "");
const catalogUrl = process.env.TOKEN360_CATALOG_URL?.trim() || "https://api.token360.ai/public/models?size=200&current=1";
const staticRoot = "/usr/share/infinite-canvas/html";
const proxyPrefix = "/api/token360";

function analyticsId(value) {
    return String(value || "").replace(/[^A-Za-z0-9-]/g, "");
}

function runtimeConfig() {
    const config = {
        ANALYTICS_GA4_ID: analyticsId(process.env.ANALYTICS_GA4_ID),
        ANALYTICS_BAIDU_ID: analyticsId(process.env.ANALYTICS_BAIDU_ID),
    };
    return new Response(`window.__RUNTIME_CONFIG__ = ${JSON.stringify(config)};`, {
        headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" },
    });
}

function jsonError(status, message) {
    return Response.json({ error: { message } }, { status });
}

async function proxyRequest(request, url) {
    if (!apiKey) return jsonError(503, "内置模型服务尚未配置");
    const apiPath = url.pathname.slice(proxyPrefix.length) || "/";
    const target = `${upstream}${apiPath}${url.search}`;
    const headers = new Headers({
        Authorization: `Bearer ${apiKey}`,
        Accept: request.headers.get("accept") || "application/json",
    });
    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
    try {
        const response = await fetch(target, {
            method: request.method,
            headers,
            body,
            redirect: "follow",
        });
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
        });
    } catch {
        return jsonError(502, "模型服务暂时不可用");
    }
}

function catalogCapability(modelType) {
    if (modelType === "IMAGE_GENERATION") return "image";
    if (modelType === "VIDEO_GENERATION") return "video";
    if (modelType === "AUDIO_TEXT_TO_SPEECH" || modelType === "AUDIO_SPEECH_TO_TEXT") return "audio";
    return "text";
}

async function modelCatalog() {
    try {
        const response = await fetch(catalogUrl, { headers: { Accept: "application/json" } });
        if (!response.ok) return jsonError(response.status, "读取模型目录失败");
        const payload = await response.json();
        const list = Array.isArray(payload?.data?.list) ? payload.data.list : [];
        return Response.json({
            data: list
                .filter((item) => typeof item?.name === "string" && item.name)
                .map((item) => ({
                    id: item.name,
                    capability: catalogCapability(item.modelType),
                    supportedParameters: Array.isArray(item.supported_parameters)
                        ? item.supported_parameters
                        : String(item.supported_parameters || "").split(/\s+/).filter(Boolean),
                })),
        });
    } catch {
        return jsonError(502, "模型目录暂时不可用");
    }
}

async function staticResponse(url) {
    const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const filePath = resolve(staticRoot, `.${normalize(requestedPath)}`);
    if (!filePath.startsWith(`${staticRoot}/`) && filePath !== staticRoot) return new Response("Not found", { status: 404 });
    const file = Bun.file(filePath);
    if (await file.exists()) return new Response(file);
    return new Response(Bun.file(`${staticRoot}/index.html`));
}

Bun.serve({
    port,
    async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/healthz") return Response.json({ ok: true, modelsConfigured: Boolean(apiKey) });
        if (url.pathname === "/config.js") return runtimeConfig();
        if (url.pathname === `${proxyPrefix}/v1/models`) return modelCatalog();
        if (url.pathname.startsWith(`${proxyPrefix}/`)) return proxyRequest(request, url);
        return staticResponse(url);
    },
});
