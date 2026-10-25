import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  registry,
  parseTool,
  modelTools,
  currentCanvasProbeSchema,
} from "../src/native-agent/tools.js";
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

test("admin model probe exposes only an empty-argument current-canvas tool; receipt UUIDs are never discarded", () => {
  const probe = modelTools(true);
  assert.deepEqual(Object.keys(probe), ["get_canvas_state"]);
  const schema = z.toJSONSchema(currentCanvasProbeSchema);
  assert.deepEqual(schema.properties, {});
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(currentCanvasProbeSchema.parse({}), {});
  assert.throws(() =>
    currentCanvasProbeSchema.parse({
      operationId: "00000000-0000-0000-0000-000000000000",
    }),
  );
  assert.deepEqual(
    parseTool("get_canvas_state", {
      operationId: "00000000-0000-0000-0000-000000000000",
    }),
    { operationId: "00000000-0000-0000-0000-000000000000" },
  );
  assert.equal(Object.keys(modelTools()).length, 13);
});
