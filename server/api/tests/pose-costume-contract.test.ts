import assert from "node:assert/strict";
import test from "node:test";
import { parseCanvasWrite } from "../src/canvas-contract.js";
import { createJobSchema } from "../src/job-contract.js";
import { assertProjectAccess } from "../src/project-access.js";

const reference = (index: number) => ({ assetId: `00000000-0000-4000-8000-00000000000${index}`, assetVersionId: `00000000-0000-4000-9000-00000000000${index}`, name: `reference-${index}`, mimeType: "image/png", catalogId: `id-${index}`, code: `code-${index}`, variantId: `view-${index}`, angle: "front", source: "https://example.test/source", license: "CC0-1.0" });

test("pose-costume favorites, combinations and immutable run references survive canvas roundtrip", () => {
    const slots = { character: reference(1), pose: reference(2), costume: reference(3) };
    const state = { slots, favorites: ["pose-1", "portrait-1"], combinations: [{ id: "saved", name: "组合", slots, prompt: "editable", model: "image.test" }], run: { operationId: "pose-costume:operation", jobId: "job", slots, prompt: "editable", model: "image.test", parameters: { count: 1 }, status: "queued" } };
    const input = { expectedRevision: 0, nodes: [{ id: "library", type: "reference:pose-costume", position: { x: 0, y: 0 }, width: 420, height: 230, metadata: { poseCostume: state } }], edges: [], viewport: { x: 0, y: 0, k: 1 }, settings: { backgroundMode: "lines", showImageInfo: false } };
    const first = parseCanvasWrite(input).write;
    const restored = parseCanvasWrite(JSON.parse(JSON.stringify(first))).write;
    assert.deepEqual(restored.nodes[0].metadata.poseCostume, state);
});

test("pose-costume trace preserves input roles and source metadata independently of model parameters", () => {
    const slots = { character: reference(1), pose: reference(2), costume: reference(3) };
    const input = createJobSchema.parse({ nodeId: "library", modelId: "image.test", capability: "image", mode: "i2i", prompt: "图1人物，图2姿势，图3服装", parameters: { count: 1 }, references: [slots.character, slots.pose, slots.costume].map((item, index) => ({ assetVersionId: item.assetVersionId, role: index === 1 ? "composition_reference" : "identity_reference", mimeType: item.mimeType })), trace: { workflowKind: "reference.pose-costume", inputSnapshot: { slots, referenceOrder: ["character", "pose", "costume"] }, assetKind: "image" }, idempotencyKey: "pose-costume:operation" });
    assert.deepEqual(input.trace?.inputSnapshot?.slots, slots);
    assert.deepEqual(input.references.map(item => item.assetVersionId), [reference(1).assetVersionId, reference(2).assetVersionId, reference(3).assetVersionId]);
    assert.equal(input.parameters.trace, undefined);
});

test("project permission checks reject nonmembers and read-only members before mutation", async () => {
    const pool = { query: async (_sql: string, args: unknown[]) => ({ rows: args[0] === "project-b" && args[1] === "editor-b" ? [{ role: "editor" }] : args[0] === "project-b" && args[1] === "viewer-b" ? [{ role: "viewer" }] : [] }) };
    assert.equal(await assertProjectAccess(pool as never, "project-b", "editor-b", "edit"), "editor");
    await assert.rejects(assertProjectAccess(pool as never, "project-a", "editor-b", "edit"), (error: any) => error.code === "PROJECT_FORBIDDEN");
    await assert.rejects(assertProjectAccess(pool as never, "project-b", "viewer-b", "edit"), (error: any) => error.code === "PROJECT_READ_ONLY");
    assert.equal(await assertProjectAccess(pool as never, "project-b", "viewer-b", "read"), "viewer");
});
