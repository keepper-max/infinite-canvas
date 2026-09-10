import assert from "node:assert/strict";
import test from "node:test";

import { createCompositionJobSchema } from "../src/composition-contract.js";

test("composition contract fills safe output defaults", () => {
  const result = createCompositionJobSchema.parse({
    nodeId: "episode-output",
    idempotencyKey: "episode-output:1",
    timeline: {
      video: [
        {
          assetVersionId: "11111111-1111-4111-8111-111111111111",
          durationMs: 5_000,
        },
      ],
    },
  });
  assert.deepEqual(result.timeline.output, {
    width: 1280,
    height: 720,
    fps: 25,
    subtitleFontSize: 36,
  });
  assert.equal(result.timeline.video[0]?.transition, "cut");
});

test("composition contract rejects invalid subtitle timing", () => {
  assert.throws(() =>
    createCompositionJobSchema.parse({
      nodeId: "episode-output",
      idempotencyKey: "episode-output:2",
      timeline: {
        video: [
          {
            assetVersionId: "11111111-1111-4111-8111-111111111111",
            durationMs: 5_000,
          },
        ],
        subtitles: [{ startMs: 2_000, endMs: 1_000, text: "错误时间" }],
      },
    }),
  );
});

test("composition contract rejects odd yuv420p output dimensions", () => {
  assert.throws(() =>
    createCompositionJobSchema.parse({
      nodeId: "episode-output",
      idempotencyKey: "episode-output:3",
      timeline: {
        video: [
          {
            assetVersionId: "11111111-1111-4111-8111-111111111111",
            durationMs: 5_000,
          },
        ],
        output: { width: 1281, height: 720, fps: 25, subtitleFontSize: 36 },
      },
    }),
  );
});
