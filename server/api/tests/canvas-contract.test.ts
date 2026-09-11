import assert from "node:assert/strict";
import test from "node:test";

import { parseCanvasWrite } from "../src/canvas-contract.js";
import { DomainError } from "../src/domain.js";

test("canvas contract removes secrets and embedded media while preserving resource references", () => {
    const { write, report } = parseCanvasWrite({
        expectedRevision: 0,
        contractVersion: 1,
        nodes: [{ id: "config", type: "plugin:settings", title: "配置", position: { x: 0, y: 0 }, width: 300, height: 200, metadata: { token360ApiKey: "secret", authToken: "secret-too", baseUrl: "https://secret.example", preview: "data:image/png;base64,abc", storageKey: "image:123" } }],
        edges: [],
        viewport: { x: 0, y: 0, k: 1 },
        settings: { backgroundMode: "lines", showImageInfo: false },
    });
    assert.equal(write.nodes[0]?.metadata.token360ApiKey, undefined);
    assert.equal(write.nodes[0]?.metadata.authToken, undefined);
    assert.equal(write.nodes[0]?.metadata.baseUrl, undefined);
    assert.equal(write.nodes[0]?.metadata.preview, "");
    assert.deepEqual(report.pendingResourceRefs, ["image:123"]);
    assert.ok(report.excludedPaths.length >= 3);
});

test("legacy edges receive typed ports and are marked for review", () => {
    const { write, report } = parseCanvasWrite({
        expectedRevision: 0,
        nodes: [
            { id: "a", type: "image", title: "A", position: { x: 0, y: 0 }, width: 100, height: 100 },
            { id: "b", type: "video", title: "B", position: { x: 200, y: 0 }, width: 100, height: 100 },
        ],
        edges: [{ id: "a-b", fromNodeId: "a", toNodeId: "b" }],
        viewport: { x: 0, y: 0, k: 1 },
    });
    assert.equal(write.edges[0]?.resourceType, "image");
    assert.equal(write.edges[0]?.sourcePortId, "legacy.output");
    assert.deepEqual(report.needsReviewEdgeIds, ["a-b"]);
});

test("dangling and duplicate references are rejected", () => {
    const base = { expectedRevision: 0, nodes: [{ id: "a", type: "text", title: "A", position: { x: 0, y: 0 }, width: 100, height: 100 }], viewport: { x: 0, y: 0, k: 1 } };
    assert.throws(() => parseCanvasWrite({ ...base, edges: [{ id: "bad", fromNodeId: "a", toNodeId: "missing" }] }), (error) => error instanceof DomainError && error.code === "INVALID_CANVAS_EDGE");
    assert.throws(() => parseCanvasWrite({ ...base, nodes: [base.nodes[0], base.nodes[0]], edges: [] }), (error) => error instanceof DomainError && error.code === "DUPLICATE_NODE_ID");
});

test("canvas contract accepts fractional node sizes produced by free resize", () => {
    const { write } = parseCanvasWrite({
        expectedRevision: 0,
        nodes: [{ id: "image", type: "image", title: "Image", position: { x: 0.25, y: 1.5 }, width: 340.5, height: 191.25 }],
        edges: [],
        viewport: { x: 0, y: 0, k: 1 },
    });
    assert.equal(write.nodes[0]?.width, 340.5);
    assert.equal(write.nodes[0]?.height, 191.25);
});
