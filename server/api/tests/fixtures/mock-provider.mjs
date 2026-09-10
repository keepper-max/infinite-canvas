import http from "node:http";

const port = Number(process.env.PORT || 18787);
const jobs = new Map();
const failures = new Map();

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  if (request.method === "GET" && url.pathname === "/public/models") {
    return json(response, 200, {
      data: [{ id: "seedance-2.5", modelType: "Video Generation" }],
    });
  }
  if (request.method === "POST" && url.pathname === "/v1/videos") {
    const body = await readJson(request);
    const prompt = String(body.prompt || "");
    const failureLimit = prompt.includes("手动重试隔离验收") ? 3 : 0;
    const failureCount = failures.get(prompt) || 0;
    if (failureCount < failureLimit) {
      failures.set(prompt, failureCount + 1);
      return json(response, 503, { message: "temporary validation failure" });
    }
    const id = `validation-${jobs.size + 1}`;
    jobs.set(id, { polls: 0 });
    return json(response, 202, { id, status: "queued", progress: 0 });
  }
  const match = url.pathname.match(/^\/v1\/videos\/([^/]+)$/);
  if (request.method === "GET" && match) {
    const job = jobs.get(match[1]);
    if (!job) return json(response, 404, { message: "not found" });
    job.polls += 1;
    return json(response, 200, {
      id: match[1],
      status: job.polls > 1 ? "completed" : "running",
      progress: job.polls > 1 ? 100 : 50,
    });
  }
  const content = url.pathname.match(/^\/v1\/videos\/([^/]+)\/content$/);
  if (request.method === "GET" && content && jobs.has(content[1])) {
    response.writeHead(200, { "content-type": "video/mp4" });
    return response.end(Buffer.from("00000018667479706d703432", "hex"));
  }
  response.writeHead(404).end();
});

server.listen(port, "0.0.0.0", () => {
  console.log(`mock-provider-ready:${port}`);
});

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}
