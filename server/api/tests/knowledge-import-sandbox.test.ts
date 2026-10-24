import test from "node:test";
import assert from "node:assert/strict";
import { sandboxConvert } from "../src/knowledge-import-sandbox.js";
test("sandbox refuses mutable/unverified image references", async () => {
  await assert.rejects(
    sandboxConvert(Buffer.from("a"), "txt", "node:latest"),
    /SHA256/,
  );
});
test(
  "real network-isolated Linux converter protocol",
  { skip: !process.env.R12_CONVERTER_IMAGE },
  async () => {
    const r = await sandboxConvert(
      Buffer.from("中文原文 [[李白]]"),
      "md",
      process.env.R12_CONVERTER_IMAGE!,
    );
    assert.equal(r.markdown, "中文原文 [[李白]]");
    assert.ok(Number(r.metrics.maxRssKiB) > 0);
    const source = "中文资料\n".repeat(100000);
    const large = await sandboxConvert(
      Buffer.from(source),
      "markdown",
      process.env.R12_CONVERTER_IMAGE!,
    );
    assert.equal(
      large.markdown,
      source,
      "UTF-8 must survive stdout chunk boundaries",
    );
  },
);
