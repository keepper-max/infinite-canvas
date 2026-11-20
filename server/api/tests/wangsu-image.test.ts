import assert from "node:assert/strict";
import test from "node:test";
import { WangsuProvider } from "../src/wangsu-provider.js";
import { wangsuAmount } from "../src/wangsu-pricing.js";
import { ModelGateway, runningHubModelProfile, wangsuCatalogItems, type CompiledGenerationRequest } from "../src/model-gateway.js";
import { BillingService } from "../src/billing-service.js";
import { ProviderError } from "../src/provider.js";

const config = { baseUrl: "https://api.edgecloudapp.com/v2/llm/doubao", apiKey: "test-only", catalogUrl: "" };
const usage = { input_tokens: 300, input_tokens_details: { text_tokens: 100, image_tokens: 200 }, output_tokens: 1000 };
const request: CompiledGenerationRequest = { modelId: "wangsu.image.gpt-image-2-5-flare", upstreamModel: "gpt-image-2.5-flare", providerId: "wangsu", capability: "image", mode: "t2i", prompt: "水墨锦鲤", upstreamParameters: { size: "1024x1024", quality: "high", background: "transparent" } };

test("两个网宿图片型号公开文生图/参考图模式及质量选项，不继承视频参数", async () => {
  for (const item of wangsuCatalogItems().filter((item) => item.output_type === "image")) {
    const profile = runningHubModelProfile(item)!;
    assert.deepEqual(profile.modes, ["t2i", "i2i"]);
    assert.deepEqual(profile.requiredParametersByMode.i2i, ["references"]);
    assert.ok(profile.acceptedParameters.includes("background"));
    assert.equal(profile.acceptedParameters.includes("duration"), false);
    const row = { id: request.modelId, capability: "image", provider_id: "wangsu", upstream_model: item.endpoint, modes: profile.modes, accepted_parameters: profile.acceptedParameters, required_parameters_by_mode: profile.requiredParametersByMode, limits: profile.limits, parameter_map: profile.parameterMap };
    const gateway = new ModelGateway({ query: async () => ({ rows: [row] }) } as never);
    const compiled = await gateway.compile({ ...request, parameters: { quality: "max", background: "transparent", n: 2 } });
    assert.equal(compiled.upstreamParameters.quality, "max");
    assert.equal(compiled.upstreamParameters.n, 2);
    await assert.rejects(gateway.compile({ ...request, mode: "i2i", references: [] }), /参考素材/);
  }
});

test("图片生成使用兼容JSON路径，base64仅生成一个资产并保留USD用量", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    assert.equal(String(input), "https://api.edgecloudapp.com/v2/llm/images/generations");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, request.upstreamModel);
    assert.equal(body.background, "transparent");
    assert.equal(body.references, undefined);
    return Response.json({ data: [{ b64_json: Buffer.from("test-image").toString("base64"), url: "https://media.invalid/duplicate.png" }], usage }, { headers: { "x-request-id": "image-request-1" } });
  });
  const result = await new WangsuProvider(config, 0).create(request, "job-1");
  assert.equal(result.artifacts?.length, 1);
  assert.equal(Buffer.from(result.artifacts![0].bytes!).toString(), "test-image");
  assert.equal(result.billingTraceId, "image-request-1");
  assert.equal(result.usage?.currency, "USD");
  assert.equal(result.usage?.generated_images, 1);
});

test("单张及多张编辑从受权对象存储读取文件，以multipart发送而不泄露内部存储键", async (t) => {
  const images = ["first", "second"];
  let submitted = 0;
  const storage = { async openDownload(key: string, _range?: string, signal?: AbortSignal) {
    assert.ok(images.includes(key));
    assert.equal(signal?.aborted, false);
    return { body: new Response(new Uint8Array([1, 2, 3])).body!, mimeType: "image/png" };
  } };
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    submitted++;
    assert.equal(String(input), "https://api.edgecloudapp.com/v2/llm/images/edits");
    assert.ok(init?.body instanceof FormData);
    assert.equal(new Headers(init.headers).has("content-type"), false);
    assert.equal(init.body.get("model"), "gpt-image-2.5-sunburst");
    const entries = submitted === 1 ? [init.body.get("image")] : init.body.getAll("image[]");
    assert.equal(entries.length, submitted);
    assert.ok(entries.every((entry) => entry instanceof Blob && entry.size === 3));
    assert.equal(init.body.has("references"), false);
    return Response.json({ data: [{ url: "https://media.invalid/output.png" }], usage });
  });
  const client = new WangsuProvider(config, 1000, storage as never);
  for (const count of [1, 2]) {
    await client.create({ ...request, upstreamModel: "gpt-image-2.5-sunburst", mode: "i2i", references: images.slice(0, count).map((storageKey) => ({ storageKey, role: "reference", mimeType: "image/png" })) });
  }
});

test("图片输入缺失、内网素材和缺密钥均在向模型提交前拒绝", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Must not submit"); });
  const client = new WangsuProvider(config, 0);
  await assert.rejects(client.create({ ...request, mode: "i2i", references: [] }), /需要参考图片/);
  await assert.rejects(client.create({ ...request, mode: "i2i", references: [{ url: "http://127.0.0.1/private", role: "reference" }] }), (error: unknown) => error instanceof ProviderError && error.code === "UNSAFE_MEDIA_URL");
  await assert.rejects(new WangsuProvider({ ...config, apiKey: "" }, 0).create(request), /尚未配置/);
});

test("网宿图片异常不丢用量，鉴权错误不回显供应商正文", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ data: [], usage }, { headers: { "x-request-id": "missing-image" } }));
  await assert.rejects(new WangsuProvider(config, 0).create(request), (error: unknown) => error instanceof ProviderError && error.code === "PROVIDER_RESULT_MISSING" && error.safeDetails.billingTraceId === "missing-image" && Boolean(error.safeDetails.usage));
  t.mock.method(globalThis, "fetch", async () => new Response("private-upstream-details", { status: 401 }));
  await assert.rejects(new WangsuProvider(config, 0).create(request), (error: unknown) => error instanceof ProviderError && error.code === "PROVIDER_AUTH_FAILED" && !JSON.stringify(error).includes("private-upstream-details"));
});

test("新增图片适配仍将Seedance原样送到豆包原生端点", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: unknown) => {
    assert.equal(String(input), config.baseUrl + "/contents/generations/tasks");
    return Response.json({ id: "video-1", status: "queued" });
  });
  const result = await new WangsuProvider(config, 0).create({ ...request, capability: "video", mode: "t2v", upstreamModel: "doubao-seedance-2-5-260628" });
  assert.equal(result.providerJobId, "video-1");
  assert.equal(result.usage?.currency, "CNY");
});

test("图片金额按文字/图片输入及输出分档计算，未知或不完整用量不冒充免费", () => {
  for (const model of ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
    const input = { upstreamModel: model, capability: "image", usage };
    assert.equal(wangsuAmount(input), "0.0321");
    for (const bad of [{}, { ...usage, input_tokens: 999 }, { ...usage, output_tokens: 0 }, { ...usage, output_tokens: null }, { ...usage, output_tokens: -1 }, { ...usage, input_tokens_details: { ...usage.input_tokens_details, cached_tokens: 10 } }]) assert.equal(wangsuAmount({ ...input, usage: bad }), null);
    assert.equal(wangsuAmount({ ...input, usage: { billable: false } }), "0");
  }
});

test("图片金额写入USD账本并交给既有积分结算，缺细分用量保留预留", async () => {
  for (const complete of [true, false]) {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    let settled = 0;
    const pool = { async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      return { rows: sql.startsWith("select * from generation_jobs") ? [{ id: "image-job", provider: "wangsu", capability: "image", compiled_request: request, billing_meter_usage: complete ? { ...usage, currency: "CNY", provider_request_id: "image-request" } : { total_tokens: 1300 }, parameters: {}, input_snapshot: {} }] : [], rowCount: 1 };
    } };
    const result = await new BillingService(pool as never, config, { settleUsage: async () => { settled++; } } as never).finalizeProviderUsage("image-job");
    assert.equal(result.status, complete ? "settled" : "manual_review");
    assert.equal(settled, complete ? 1 : 0);
    const insert = calls.find((call) => call.sql.includes("insert into generation_usage"));
    if (complete) { assert.equal(insert?.values?.[15], "0.0321"); assert.equal(insert?.values?.[16], "USD"); assert.equal(insert?.values?.[8], 300); assert.equal(insert?.values?.[9], 1000); assert.equal(JSON.parse(String(insert?.values?.[18])).currency, "USD"); }
    else assert.equal(insert, undefined);
  }
});
