import assert from "node:assert/strict";
import test from "node:test";
import { readConfig } from "../src/config.js";
import { ModelGateway, type CompiledGenerationRequest } from "../src/model-gateway.js";
import { BillingService } from "../src/billing-service.js";
import { VolcengineArkProvider } from "../src/volcengine-ark-provider.js";
import { ProviderError } from "../src/provider.js";

const config = {
  baseUrl: "https://api.edgecloudapp.com/v2/llm/doubao",
  apiKey: "test-only",
  catalogUrl: "",
};
const request: CompiledGenerationRequest = {
  modelId: "wangsu.video.doubao-seedance-2-5-260628",
  upstreamModel: "doubao-seedance-2-5-260628",
  providerId: "wangsu",
  capability: "video",
  mode: "t2v",
  prompt: "猫在舞台弹钢琴",
  upstreamParameters: { duration: 5, resolution: "720p", ratio: "16:9", generate_audio: true },
};
const provider = () => new VolcengineArkProvider(config, 0, undefined, "wangsu_model_catalog", false);

test("网宿凭据只从服务端环境读取，原生接口地址不重复拼接版本", () => {
  const env = {
    DATABASE_URL: "postgres://test.invalid/test",
    OBJECT_STORAGE_ENDPOINT: "http://storage.invalid",
    OBJECT_STORAGE_BUCKET: "test",
    OBJECT_STORAGE_ACCESS_KEY_ID: "test-only",
    OBJECT_STORAGE_SECRET_ACCESS_KEY: "test-only",
  };
  assert.equal(readConfig(env).wangsu?.apiKey, "");
  assert.equal(readConfig({ ...env, AIGATEWAY_TOKEN: " test-only " }).wangsu?.apiKey, "test-only");
  assert.equal(readConfig(env).wangsu?.baseUrl, config.baseUrl);
});

test("网宿目录只新增 Seedance 2.5，保留已有启停状态与原生视频模式", async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const gateway = new ModelGateway({ async query(sql: string, values?: unknown[]) {
    calls.push({ sql, values });
    return { rows: [], rowCount: 1 };
  } } as never);
  assert.equal(await gateway.refreshWangsuCatalog(), 1);
  const model = calls.find((call) => call.sql.includes("insert into model_catalog"));
  assert.equal(model?.values?.[0], request.modelId);
  assert.equal(model?.values?.[3], request.upstreamModel);
  assert.equal(model?.values?.[4], "wangsu");
  assert.doesNotMatch(model!.sql.split("on conflict(id)")[1], /enabled\s*=/);
  const profile = calls.find((call) => call.sql.includes("insert into model_capabilities"));
  assert.deepEqual(JSON.parse(String(profile?.values?.[1])), ["t2v", "i2v", "flf2v", "multiref"]);
  assert.ok(JSON.parse(String(profile?.values?.[2])).includes("omniReferenceTaskType"));
});

test("刷新 Token360 同名模型不会覆盖网宿或火山方舟的协议参数", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ data: [{
    id: request.upstreamModel, modelType: "Video Generation",
  }] }));
  const queries: string[] = [];
  await new ModelGateway({ async query(sql: string) {
    queries.push(sql);
    return { rows: [], rowCount: 0 };
  } } as never).refreshCatalog("https://catalog.invalid/models");
  const update = queries.find((sql) => sql.includes("where upstream_model=$1"));
  assert.match(update || "", /and provider_id='token360'/);
});

test("网宿创建与查询走官方豆包原生端点，并保存真实用量与费用来源", async (t) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Response.json(init?.method === "POST"
      ? { id: "task-1", status: "queued" }
      : { id: "task-1", status: "succeeded", content: { video_url: "https://media.invalid/result.mp4" }, usage: { completion_tokens: 108_000, total_tokens: 108_000 } });
  });
  const client = provider();
  const submitted = await client.create(request);
  assert.equal(submitted.providerJobId, "task-1");
  const result = await client.get("task-1");
  assert.equal(calls[0].url, `${config.baseUrl}/contents/generations/tasks`);
  assert.equal(calls[1].url, `${config.baseUrl}/contents/generations/tasks/task-1`);
  const body = JSON.parse(String(calls[0].init?.body));
  assert.deepEqual(body.content, [{ type: "text", text: request.prompt }]);
  assert.equal(body.model, request.upstreamModel);
  assert.equal(body.duration, 5);
  assert.equal(result.status, "completed");
  assert.equal(result.artifacts?.[0]?.url, "https://media.invalid/result.mp4");
  assert.equal(result.usage?.completion_tokens, 108_000);
  assert.equal(result.usage?.billing_amount_source, "wangsu_model_catalog");
});

test("网宿首尾帧与多模态参考保留各自职责，续写参数不丢失", async (t) => {
  const bodies: Array<Record<string, unknown>> = [];
  t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ id: "task-refs", status: "queued" });
  });
  const frames = [
    { role: "first_frame", mimeType: "image/jpeg", url: "https://media.invalid/first.jpg" },
    { role: "last_frame", mimeType: "image/jpeg", url: "https://media.invalid/last.jpg" },
  ];
  await provider().create({ ...request, mode: "flf2v", references: frames });
  const content = bodies[0].content as Array<Record<string, unknown>>;
  assert.deepEqual(content.slice(1).map((item) => item.role), ["first_frame", "last_frame"]);
  assert.equal(bodies[0].ratio, "adaptive");
  await provider().create({ ...request, mode: "multiref", upstreamParameters: { omni_reference_task_type: "extend", ratio: "adaptive" }, references: [
    { role: "reference", mimeType: "image/jpeg", url: frames[0].url },
    { role: "video_extension", mimeType: "video/mp4", url: "https://media.invalid/input.mp4" },
    { role: "reference", mimeType: "audio/mpeg", url: "https://media.invalid/audio.mp3" },
  ] });
  assert.deepEqual((bodies[1].content as Array<Record<string, unknown>>).slice(1).map((item) => item.role), ["reference_image", "reference_video", "reference_audio"]);
  assert.equal(bodies[1].omni_reference_task_type, "extend");
  assert.equal(bodies[1].references, undefined);
});

test("网宿失败任务不冒充免费，成功无结果及鉴权失败不会冒充完成", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ status: "failed", error: { message: "rejected" } }));
  await assert.rejects(provider().get("task-failed"), (error: unknown) => error instanceof ProviderError && error.code === "PROVIDER_REJECTED" && (error.safeDetails.usage as Record<string, unknown>)?.billable === undefined);
  t.mock.method(globalThis, "fetch", async () => Response.json({ status: "succeeded" }));
  await assert.rejects(provider().get("task-empty"), (error: unknown) => error instanceof ProviderError && error.code === "PROVIDER_RESULT_MISSING");
  t.mock.method(globalThis, "fetch", async () => new Response("unauthorized", { status: 401 }));
  await assert.rejects(provider().create(request), (error: unknown) => error instanceof ProviderError && error.code === "PROVIDER_AUTH_FAILED");
});

test("网宿四档原价进入现有账本，缺失或非法用量保留预留待核账", async () => {
  for (const [resolution, video, amount] of [["720p", false, "7"], ["720p", true, "4.2"], ["1080p", false, "7.7"], ["1080p", true, "4.6"]] as const) {
    const { result, calls } = await settle({ completion_tokens: 100_000 }, resolution, video);
    assert.equal(result.status, "settled");
    const values = calls.find((call) => call.sql.includes("insert into generation_usage"))?.values;
    assert.equal(values?.[15], amount);
    assert.equal(values?.[16], "CNY");
    assert.equal(values?.[3], "wangsu:task-billing");
    assert.equal(JSON.parse(String(values?.[18])).billing_amount_source, "wangsu_model_catalog");
  }
  for (const tokens of [undefined, null, "", " ", true, -1, "invalid"]) {
    const { result, calls } = await settle({ completion_tokens: tokens });
    assert.equal(result.status, "manual_review");
    assert.equal(calls.some((call) => call.sql.includes("insert into generation_usage")), false);
    assert.equal(calls.some((call) => call.sql.includes("manual_review")), true);
  }
  const failed = await settle({ billable: false });
  assert.equal(failed.result.status, "settled");
  assert.equal(failed.calls.find((call) => call.sql.includes("insert into generation_usage"))?.values?.[15], "0");
});

async function settle(usage: Record<string, unknown>, resolution = "720p", video = false) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const pool = { async query(sql: string, values?: unknown[]) {
    calls.push({ sql, values });
    return { rows: sql.startsWith("select * from generation_jobs") ? [{
      id: "job-wangsu", project_id: "project-1", created_by: "user-1", provider: "wangsu",
      model_id: request.modelId, capability: "video", billing_status: "pending", compiled_request: request,
      parameters: { resolution }, input_snapshot: { references: video ? [{ mimeType: "video/mp4" }] : [] },
      billing_meter_usage: { ...usage, provider_request_id: "task-billing" },
    }] : [], rowCount: 1 };
  } };
  const result = await new BillingService(pool as never, config).finalizeProviderUsage("job-wangsu");
  return { result, calls };
}
