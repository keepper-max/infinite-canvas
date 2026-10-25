import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { registry, parseTool } from "../src/native-agent/tools.js";
test("node tool exposes an object schema and preserves conditional validation", () => {
  const schema = z.toJSONSchema(registry.create_canvas_node.inputSchema);
  assert.equal(schema.type, "object");
  assert.ok(schema.properties);
  assert.equal(schema.anyOf, undefined);
  const base = { position: { x: 0, y: 0 }, expectedCanvasRevision: 0 };
  assert.equal(
    (
      parseTool("create_canvas_node", {
        ...base,
        type: "text",
        title: "测试",
        content: "正文",
      }) as any
    ).type,
    "text",
  );
  assert.throws(() =>
    parseTool("create_canvas_node", {
      ...base,
      type: "text",
      content: "缺标题",
    }),
  );
  assert.throws(() =>
    parseTool("create_canvas_node", {
      ...base,
      type: "knowledge:document",
      title: "不复制正文",
    }),
  );
  assert.throws(() =>
    parseTool("create_canvas_node", {
      ...base,
      type: "text",
      title: "测试",
      content: "正文",
      unknown: true,
    }),
  );
});
