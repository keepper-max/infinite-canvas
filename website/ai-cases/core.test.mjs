import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { presentCases } from "./present.mjs";
import {
  findCases,
  readState,
  queryString,
  safeSource,
  PAGE_SIZE,
} from "./core.mjs";

const records = JSON.parse(
  fs.readFileSync(new URL("./cases.json", import.meta.url), "utf8"),
);
const cases = presentCases(records);
test("原始数据与固定上游版本的字节摘要一致", () => {
  const snapshot = JSON.parse(
    fs.readFileSync(new URL("./upstream.json", import.meta.url), "utf8"),
  );
  const hash = createHash("sha256")
    .update(fs.readFileSync(new URL("./cases.json", import.meta.url)))
    .digest("hex");
  assert.equal(hash, snapshot.sha256);
  assert.equal(
    new Set(records.map((record) => record.id)).size,
    records.length,
  );
});
test("展示别名保持全部原始字段和值，不修改摘要和成果", () => {
  const before = JSON.stringify(records);
  const views = presentCases(records);
  assert.equal(views.length, records.length);
  for (const [index, view] of views.entries()) {
    assert.deepEqual(view.record, records[index]);
    assert.equal(view.problem, records[index].problem);
    assert.equal(view.solution, records[index].solution);
    assert.equal(view.outcome, records[index].result);
    assert.deepEqual(view.technology, records[index].architecture);
    assert.deepEqual(view.conditions, records[index].reusable);
  }
  assert.equal(JSON.stringify(records), before);
});
test("组合筛选采用交集，搜索覆盖公司、痛点与 AI 能力", () => {
  assert.equal(
    findCases(cases, readState("?q=包装&industry=消费品%2F食品", cases)).length,
    1,
  );
  assert.equal(
    findCases(cases, readState("?q=MORGAN", cases))[0].id,
    "openai-020",
  );
  assert.equal(
    findCases(cases, readState("?q=库存 不存在词", cases)).length,
    0,
  );
});
test("空值、异常页码及未知标签恢复为合法状态", () => {
  for (const page of [
    "-1",
    "NaN",
    "Infinity",
    "2.5",
    "99999999999999999999",
    "0",
  ])
    assert.equal(readState("?page=" + page, cases).page, 1);
  const state = readState(
    "?q=%20%20&industry=unknown&capability=bad&page=2",
    cases,
  );
  assert.equal(state.industry, "");
  assert.equal(state.capability, "");
  assert.equal(findCases(cases, state).length, cases.length);
  assert.ok(cases.length > PAGE_SIZE, "数据实际覆盖分页");
});
test("URL 状态往返保持一致，注入输入只当作文本检索", () => {
  const state = readState("?q=%3Cscript%3E&scenario=知识管理&page=2", cases);
  assert.deepEqual(readState(queryString(state), cases), state);
  assert.equal(findCases(cases, state).length, 0);
});
test("来源只接受无凭据的 HTTPS 地址", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,bad",
    "http://example.com",
    "https://user:pass@example.com",
    "//example.com",
    null,
  ])
    assert.equal(safeSource(url), null);
  assert.equal(
    safeSource("https://example.com/report#page=7"),
    "https://example.com/report#page=7",
  );
});
