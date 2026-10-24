import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { convert } from "../convert.mjs";
const dir = process.env.R12_FIXTURES;
test("literal Markdown preserves frontmatter/wiki/callout and unknown syntax", async () => {
  const text =
    "\ufeff---\r\ntitle: 原文\r\n---\r\n[[李白|显示]]\r\n> [!NOTE]\r\n:::custom\r\n";
  assert.equal((await convert(Buffer.from(text), "md")).markdown, text);
});
test("spoofed and unsupported input rejected", async () => {
  await assert.rejects(convert(Buffer.from("%PDF-1.7"), "txt"), /不一致/);
  await assert.rejects(convert(Buffer.from("bad"), "pdf"), /不是 PDF/);
  await assert.rejects(convert(Buffer.from([255]), "txt"), /UTF-8/);
  await assert.rejects(convert(Buffer.from("bad"), "docx"), /损坏/);
});
test("fixed Chinese DOCX corpus", { skip: !dir }, async () => {
  for (const name of ["basic", "headings", "table", "image"]) {
    const r = await convert(await readFile(dir + "/" + name + ".docx"), "docx");
    assert.match(r.markdown, /李白/);
    assert.match(r.markdown, /\*\*加粗内容\*\*/);
    assert.match(r.markdown, /https:\/\/example.com/);
    if (name === "table") assert.match(r.markdown, /\| 姓名 \| 领域 \|/);
    if (name === "image") assert.equal(r.assets.length, 1);
    if (name === "headings") assert.match(r.markdown, /# 一级标题/);
  }
});
