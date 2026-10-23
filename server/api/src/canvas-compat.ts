import { DomainError } from "./domain.js";
import { parseCanvasWrite } from "./canvas-contract.js";

type RecordValue = Record<string, any>;
const record = (value: unknown): RecordValue => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new DomainError("LEGACY_CANVAS_INVALID", "旧画布包含无法识别的数据，拒绝覆盖", 422);
  return value as RecordValue;
};

// Raw history is kept in snapshots/repair archives. Normalize only a new revision.
export function normalizeCanvasHistory(input: {
  nodes: unknown; edges: unknown; viewport: unknown; settings: unknown;
  expectedRevision: number; contractVersion?: number;
  assetLinks?: Array<{ nodeId?: unknown; node_id?: unknown; assetVersionId?: unknown; asset_version_id?: unknown; role?: unknown }>;
}) {
  if (!Array.isArray(input.nodes) || !Array.isArray(input.edges))
    throw new DomainError("LEGACY_CANVAS_INVALID", "旧画布节点或连线不是数组", 422);
  const nodes = input.nodes.map(raw => {
    const node = record(raw);
    const data = node.data === undefined ? node : record(node.data);
    if (data.id !== undefined && data.id !== node.id)
      throw new DomainError("LEGACY_CANVAS_FIELD_CONFLICT", "节点 id 与正文中的 id 冲突，拒绝覆盖", 422);
    const originalType = node.nodeType ?? node.node_type ?? node.type ?? data.type;
    const legacy = !data.metadata || !data.type;
    const type = legacy ? ({ prompt: "text", scene: "text", output: "video" }[originalType as string] ?? originalType) : data.type;
    const metadata: RecordValue = legacy ? {
      ...data, legacyNodeType: originalType, legacyCanvasData: data,
      content: data.content ?? data.output ?? data.description ?? data.narration ?? "",
      ...(data.source === "codex-vibe" ? { vibeRole: originalType } : {}),
    } : { ...record(data.metadata) };
    const references = input.assetLinks?.filter(link => (link.nodeId ?? link.node_id) === node.id)
      .map(link => ({ assetVersionId: link.assetVersionId ?? link.asset_version_id, role: link.role }));
    if (references?.length) metadata.legacyAssetReferences = references;
    return {
      id: node.id, type, title: data.title ?? node.label ?? data.label ?? "",
      position: node.position ?? data.position,
      width: data.width ?? node.width ?? 360, height: data.height ?? node.height ?? 240,
      metadata, definitionId: legacy ? undefined : data.definitionId,
      definitionVersion: data.definitionVersion,
      workflowKind: legacy ? node.workflowKind ?? node.workflow_kind : data.workflowKind,
      locked: data.locked ?? node.locked ?? false,
    };
  });
  const edges = input.edges.map(raw => {
    const edge = record(raw);
    const data = edge.data === undefined ? edge : record(edge.data);
    const legacy = !data.fromNodeId;
    // Database rows (Drizzle camelCase or archived SQL snake_case) are authoritative.
    // A second declaration must agree; never let parseCanvasWrite infer row fields.
    const databaseRow = edge.sourceNodeId !== undefined || edge.source_node_id !== undefined;
    const field = (name: string, aliases: string[], required: boolean) => {
      const values = [...aliases.map(key => edge[key]), data[name]].filter(value => value !== undefined);
      if (values.some(value => value !== values[0]))
        throw new DomainError("LEGACY_CANVAS_FIELD_CONFLICT", `连线字段 ${name} 冲突，拒绝覆盖`, 422);
      if ((required && !values.length) || values.some(value => value === null))
        throw new DomainError("LEGACY_CANVAS_FIELD_MISSING", `连线字段 ${name} 缺失，拒绝推断`, 422);
      return values[0];
    };
    const required = databaseRow || legacy;
    const id = field("id", ["id"], true);
    const fromNodeId = field("fromNodeId", ["fromNodeId", "sourceNodeId", "source_node_id", "source"], true);
    const toNodeId = field("toNodeId", ["toNodeId", "targetNodeId", "target_node_id", "target"], true);
    const sourcePortId = field("sourcePortId", ["sourcePortId", "source_port_id"], required);
    const targetPortId = field("targetPortId", ["targetPortId", "target_port_id"], required);
    const resourceType = field("resourceType", ["resourceType", "resource_type"], required);
    const role = field("role", ["role"], required);
    const order = field("order", ["order", "sortOrder", "sort_order"], required);
    const edgeType = field("edgeType", ["edgeType", "edge_type"], false);
    if (edgeType !== undefined && edgeType !== "reference" && edgeType !== role)
      throw new DomainError("LEGACY_CANVAS_INVALID", "无法识别历史连线类型，拒绝覆盖", 422);
    return {
      id, fromNodeId, toNodeId, sourcePortId, targetPortId, resourceType, role, order,
      metadata: legacy ? { legacyCanvasData: edge } : data.metadata,
    };
  });
  return parseCanvasWrite({ expectedRevision: input.expectedRevision,
    contractVersion: input.contractVersion, nodes, edges, viewport: input.viewport, settings: input.settings });
}
