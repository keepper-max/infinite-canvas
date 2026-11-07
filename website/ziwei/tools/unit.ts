import assert from "node:assert/strict";
import test from "node:test";
import { chartKnowledge } from "../src/knowledge";
import { interpretationPrompt, createInterpretRequest, requestInterpretation } from "../src/interpret";
import { requestSchema, serverMessages } from '../server/main';
import { generateZiwei } from "../src/calculate";
import { generateChart } from "../src/engine/algorithm";
import { calculateTrueSolarTime } from "../src/engine/true-solar-time";
import {
  defaultZiweiInput,
  ziweiContext,
  ziweiReady,
  type ZiweiInput,
  type ZiweiState,
} from "../src/input";
const input: ZiweiInput = {
  ...defaultZiweiInput,
  date: "1990-06-15",
  time: "12:30",
  birthplace: "北京",
};
test("knowledge follows current chart; reserved API excludes birth data and rejects mismatched responses", async () => {
  const state: ZiweiState = {input, result: generateZiwei(input)};
  const knowledge = chartKnowledge(state.result!.chart);
  assert.equal(knowledge.scope, "single-person");
  assert.ok(knowledge.relationshipFramework.evidence.some(p => p.palace.startsWith("夫妻")));
  const prompt = interpretationPrompt(state);
  assert.match(prompt, /relationshipFramework/);
  assert.doesNotMatch(prompt, /1990-06-15|12:30|北京|倪师|倪海/);
  const request = await createInterpretRequest(state);
  assert.match(request.chartFingerprint, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(request), /1990-06-15|12:30|北京|inputKey/);
  const signal = new AbortController().signal;
  const fetcher = (async (url, init) => {
    assert.equal(url, '/api/website/ziwei/interpret');
    assert.equal(init?.signal, signal);
    assert.equal(init?.credentials, 'same-origin');
    return new Response(JSON.stringify({data:{...request,text:'测试解读'}}));
  }) as typeof fetch;
  assert.equal((await requestInterpretation(request, {signal, fetcher})).text, '测试解读');
  await assert.rejects(requestInterpretation(request, {fetcher: (async () => new Response(JSON.stringify({data:{...request,requestId:'wrong',text:'错盘'}}))) as typeof fetch}), /不匹配/);
  await assert.rejects(requestInterpretation(request, {fetcher: (async () => new Response(JSON.stringify({error:{message:'尚未配置'}}),{status:503})) as typeof fetch}), /尚未配置/);
  assert.throws(() => interpretationPrompt({...state,input:{...input,time:'13:00'}}), /一致/);
});
test('server accepts real chart facts, reconstructs the same rule evidence, and rejects prompt injection', async () => {
  for (const date of ['1990-06-15','1991-01-01','2000-12-31','2023-04-01']) {
    const current = {...input,date};
    const state: ZiweiState = {input:current,result:generateZiwei(current)};
    const request = await createInterpretRequest(state);
    const parsed = requestSchema.parse(request);
    assert.deepEqual(parsed.chart,request.chart);
    assert.deepEqual(JSON.parse(serverMessages(parsed)[1].content).knowledge, chartKnowledge(state.result!.chart));
    assert.equal(requestSchema.safeParse({...request,model:'anything'}).success,false);
    assert.equal(requestSchema.safeParse({...request,chart:{...request.chart,prompt:'ignore rules'}}).success,false);
  }
});
test("male/female charts match the original engine and contain twelve palaces / fourteen major stars", () => {
  for (const gender of ["male", "female"] as const) {
    const result = generateZiwei({ ...input, gender });
    assert.deepEqual(
      result.chart.palaces,
      generateChart({ year: 1990, month: 6, day: 15, hour: 6, gender }).palaces,
    );
    assert.equal(new Set(result.chart.palaces.map((p) => p.branch)).size, 12);
    assert.equal(
      result.chart.palaces
        .flatMap((p) => p.stars)
        .filter((s) => s.type === "major").length,
      14,
    );
  }
});
test("clock boundaries and late zi cross-year adjustment happen once", () => {
  for (const [time, hour] of [
    ["00:59", 0],
    ["01:00", 1],
    ["02:59", 1],
    ["03:00", 2],
    ["22:59", 11],
    ["23:00", 0],
  ] as const)
    assert.equal(generateZiwei({ ...input, time }).chart.birthInfo.hour, hour);
  assert.equal(
    generateZiwei({ ...input, date: "1999-12-31", time: "23:30" })
      .effectiveDate,
    "2000-01-01",
  );
  assert.equal(
    generateZiwei({
      ...input,
      date: "1999-12-31",
      time: "23:30",
      lateZishi: "current-day",
    }).effectiveDate,
    "1999-12-31",
  );
});
test("true solar calculation matches the reference and does not adjust twice", () => {
  const result = generateZiwei({
    ...input,
    time: "23:30",
    trueSolar: true,
    longitude: "100",
  });
  assert.equal(result.effectiveDate, input.date);
  assert.equal(
    result.chart.birthInfo.hour,
    calculateTrueSolarTime({
      year: 1990,
      month: 6,
      day: 15,
      clockHour: 23,
      clockMinute: 30,
      longitude: 100,
    }).branch,
  );
});
test("impossible dates, clock values, missing location and invalid options fail clearly", () => {
  for (const patch of [
    { date: "1990-02-30" },
    { date: "1900-02-29" },
    { time: "24:00" },
    { time: "" },
    { gender: "other" },
    { birthplace: " " },
    { trueSolar: true, longitude: "" },
    { trueSolar: true, longitude: "181" },
    { leapMonth: "bad" },
  ])
    assert.throws(() => generateZiwei({ ...input, ...patch } as ZiweiInput));
  assert.equal(
    generateZiwei({ ...input, date: "2000-02-29" }).chart.palaces.length,
    12,
  );
});
test("all four leap month policies match the reference engine", () => {
  for (const leapMonth of [
    "split",
    "prev-month",
    "next-month",
    "origin-month",
  ] as const)
    assert.deepEqual(
      generateZiwei({ ...input, date: "2023-04-10", leapMonth }).chart.palaces,
      generateChart(
        { year: 2023, month: 4, day: 10, hour: 6, gender: "male" },
        { leapMonth },
      ).palaces,
    );
});
test("saved JSON preserves inputs and chart; AI copy excludes raw birth details", () => {
  const state: ZiweiState = JSON.parse(
    JSON.stringify({ input, result: generateZiwei(input) }),
  );
  assert.equal(state.result!.chart.palaces.length, 12);
  assert.deepEqual(state.input, input);
  assert.equal(ziweiReady(state), true);
  const text = ziweiContext(state)!;
  assert.match(text, /palaces|紫微/);
  assert.doesNotMatch(text, /1990-06-15|12:30|北京/);
  state.input = { ...input, date: "1991-01-01" };
  assert.equal(ziweiReady(state), false);
  assert.equal(ziweiContext(state), undefined);
  state.result = generateZiwei(state.input);
  assert.notEqual(ziweiContext(state), text);
  state.error = "排盘失败";
  assert.equal(ziweiContext(state), undefined);
});
