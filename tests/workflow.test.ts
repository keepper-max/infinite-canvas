import test from "node:test";
import assert from "node:assert/strict";
import { topologicalOrder } from "@/lib/workflow";

test("工作流按画布连线拓扑排序", () => {
  const nodes = [{ id: "video" }, { id: "prompt" }, { id: "scene" }];
  const order = topologicalOrder(nodes, [
    { sourceNodeId: "prompt", targetNodeId: "scene" },
    { sourceNodeId: "scene", targetNodeId: "video" },
  ]);
  assert.deepEqual(
    order.map((node) => node.id),
    ["prompt", "scene", "video"],
  );
});
