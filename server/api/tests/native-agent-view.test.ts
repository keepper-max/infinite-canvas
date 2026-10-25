import test from "node:test";
import assert from "node:assert/strict";
import {
  agentPanelLayout,
  preserveCanvasCenter,
  mergeHydratedNodes,
} from "../../../web/src/lib/canvas/native-agent-view.js";
test("panel dock preserves minimum drawable width; narrow screens overlay", () => {
  assert.equal(agentPanelLayout(760, 1200).overlay, true);
  assert.equal(agentPanelLayout(760, 1440).width, 520);
  assert.equal(agentPanelLayout(Number.NaN, 390).width, 390);
});
test("resize preserves world center and zoom", () => {
  const v = { x: -120, y: 30, k: 0.75 },
    a = { width: 700, height: 900 },
    b = { width: 1140, height: 800 },
    n = preserveCanvasCenter(v, a, b);
  assert.equal((a.width / 2 - v.x) / v.k, (b.width / 2 - n.x) / n.k);
  assert.equal((a.height / 2 - v.y) / v.k, (b.height / 2 - n.y) / n.k);
  assert.equal(v.k, n.k);
});
test("late media hydration preserves edited fields and changed sources", () => {
  const old: any = {
      id: "image",
      type: "image",
      title: "old",
      position: { x: 1, y: 2 },
      metadata: {
        assetVersionId: "v1",
        storageKey: "k",
        content: "placeholder",
      },
    },
    ready = {
      ...old,
      metadata: { ...old.metadata, content: "resolved", thumbnailUrl: "thumb" },
    },
    edited = { ...old, title: "edited", position: { x: 33, y: 44 } };
  const result = mergeHydratedNodes(
    [edited, { ...old, id: "new" }] as any,
    [old],
    [ready],
  );
  assert.equal(result[0].title, "edited");
  assert.deepEqual(result[0].position, { x: 33, y: 44 });
  assert.equal(result[0].metadata!.content, "resolved");
  assert.equal(result[1].id, "new");
  assert.equal(mergeHydratedNodes([], [old], [ready]).length, 0);
  assert.equal(
    mergeHydratedNodes(
      [
        {
          ...old,
          metadata: { ...old.metadata, assetVersionId: "v2", content: "new" },
        },
      ],
      [old],
      [ready],
    )[0].metadata!.content,
    "new",
  );
});
