import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { normalizeCanvasHistory } from "../src/canvas-compat.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/canvas-history-row.json", import.meta.url), "utf8"));
const input = () => ({ ...structuredClone(fixture), expectedRevision: 0 });
const convert = (value: ReturnType<typeof input>) => {
  const { provenance: _, ...raw } = value;
  return normalizeCanvasHistory(raw);
};

test("archived SQL row preserves IDs, endpoints, ports, resource, role, zero order and raw content", () => {
  const raw = input(), { write, report } = convert(raw);
  assert.deepEqual(report.needsReviewEdgeIds, []);
  assert.deepEqual(report.excludedPaths, []);
  for (const [i, edge] of write.edges.entries()) {
    const before = raw.edges[i];
    assert.deepEqual([edge.id, edge.fromNodeId, edge.toNodeId, edge.sourcePortId, edge.targetPortId, edge.resourceType, edge.role, edge.order],
      [before.id, before.source_node_id, before.target_node_id, before.source_port_id, before.target_port_id, before.resource_type, before.role, before.sort_order]);
    assert.deepEqual(edge.metadata?.legacyCanvasData, before);
  }
  for (const [i, node] of write.nodes.entries()) {
    assert.equal(node.id, raw.nodes[i].id);
    assert.deepEqual(node.metadata?.legacyCanvasData, raw.nodes[i].data);
    assert.deepEqual(node.position, raw.nodes[i].position);
    assert.equal(node.workflowKind, raw.nodes[i].workflow_kind);
  }
});

test("Drizzle row names preserve business semantics with agreeing nested declarations", () => {
  const raw = input();
  raw.edges = raw.edges.map((edge: any) => {
    const { source_node_id, target_node_id, source_port_id, target_port_id, resource_type, sort_order, edge_type, ...rest } = edge;
    return { ...rest, sourceNodeId: source_node_id, targetNodeId: target_node_id, sourcePortId: source_port_id, targetPortId: target_port_id,
      resourceType: resource_type, sortOrder: sort_order, edgeType: edge_type,
      data: { fromNodeId: source_node_id, toNodeId: target_node_id, sourcePortId: source_port_id, targetPortId: target_port_id, resourceType: resource_type, role: edge.role, order: sort_order, metadata: { marker: true } } };
  });
  const { write } = convert(raw);
  assert.equal(write.edges[1].order, 0); assert.equal(write.edges[1].resourceType, "asset");
  assert.deepEqual(write.edges[1].metadata, { marker: true });
});

const fields = { id: "id", fromNodeId: "source_node_id", toNodeId: "target_node_id", sourcePortId: "source_port_id", targetPortId: "target_port_id", resourceType: "resource_type", role: "role", order: "sort_order" };
for (const [nested, outer] of Object.entries(fields)) {
  test(`conflicting ${nested} rejects instead of selecting a silent winner`, () => {
    const raw = input(); raw.edges[0].data[nested] = nested === "order" ? 9 : "conflict";
    assert.throws(() => convert(raw), { code: "LEGACY_CANVAS_FIELD_CONFLICT" });
  });
  test(`missing SQL field ${outer} rejects before inference`, () => {
    const raw = input(); delete raw.edges[0][outer];
    assert.throws(() => convert(raw), { code: "LEGACY_CANVAS_FIELD_MISSING" });
  });
}

test("unknown or null row values fail without coercion", () => {
  for (const [field, value] of [["resource_type", "unknown"], ["sort_order", -1], ["source_port_id", null], ["edge_type", "unrecognized"]]) {
    const raw = input(); raw.edges[0][field as string] = value;
    assert.throws(() => convert(raw));
  }
});

test("flat canonical snapshots and existing optional-field defaults remain supported", () => {
  const { write } = convert(input());
  const canonical = normalizeCanvasHistory(write).write;
  assert.deepEqual(canonical, write);
  const edge = { id: "canonical", fromNodeId: write.nodes[0].id, toNodeId: write.nodes[1].id };
  assert.equal(normalizeCanvasHistory({ ...write, edges: [edge] }).write.edges[0].resourceType, "text");
});

test("old source/target-only snapshots fail explicitly when their port semantics are missing", () => {
  const raw = input(); raw.edges = [{ id: "old", source: raw.nodes[0].id, target: raw.nodes[1].id, data: {}, label: "reference" }];
  assert.throws(() => convert(raw), { code: "LEGACY_CANVAS_FIELD_MISSING" });
});

test("node identity disagreement and endpoint absence reject", () => {
  const raw = input(); raw.nodes[0].data.id = "different";
  assert.throws(() => convert(raw), { code: "LEGACY_CANVAS_FIELD_CONFLICT" });
  const other = input(); other.edges[0].target_node_id = "missing-node";
  assert.throws(() => convert(other), { code: "INVALID_CANVAS_EDGE" });
});
