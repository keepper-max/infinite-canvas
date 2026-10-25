import { DomainError } from "../domain.js";
import type { KnowledgeService } from "../knowledge-service.js";
import { PostgresPlatformRepository } from "../repository.js";
import type { AgentActor, ToolCall } from "./contracts.js";
import { parseTool } from "./tools.js";
import { guardWrite, type AgentTx } from "./guard.js";
import { parseCanvasWrite, type CanvasDocument } from "../canvas-contract.js";
import { requireKnowledgeFeature } from "../knowledge-feature.js";
const fail = (message: string): never => {
  throw new DomainError("AGENT_CANVAS_INVALID", message, 422);
};
export class AgentCanvasService {
  readonly repository: PostgresPlatformRepository;
  constructor(private knowledge: KnowledgeService) {
    this.repository = new PostgresPlatformRepository(knowledge.db);
  }
  async state(actor: AgentActor) {
    const c = await this.repository.getCanvasForUser(
      actor.projectId,
      actor.actorId,
    );
    if (!c) throw new DomainError("PROJECT_FORBIDDEN", "无法读取画布", 403);
    return c;
  }
  async apply(actor: AgentActor, operationId: string, calls: ToolCall[]) {
    const parsed = calls.map((c) => ({
      ...c,
      input: parseTool(c.toolName, c.input) as any,
    }));
    const expected = parsed[0]?.input.expectedCanvasRevision;
    if (
      !Number.isInteger(expected) ||
      parsed.some((c) => c.input.expectedCanvasRevision !== expected)
    )
      fail("同一审批批次必须使用相同的画布revision，请重新读取状态并制定计划");
    return this.repository.applyCanvasOperationForUser(
      actor.projectId,
      actor.actorId,
      {
        operationId,
        expectedCanvasRevision: expected,
        kind: "agent.canvas.mutate",
        payload: { calls: parsed },
      },
      (canvas, tx) => this.mutate(actor, canvas, tx, parsed),
    );
  }
  async preview(actor: AgentActor, calls: ToolCall[]) {
    const canvas = await this.state(actor);
    const parsed = calls.map((c) => ({
      ...c,
      input: parseTool(c.toolName, c.input) as any,
    }));
    if (parsed.some((c) => c.input.expectedCanvasRevision !== canvas.revision))
      throw new DomainError(
        "CANVAS_REVISION_CONFLICT",
        "画布已变化，请重新读取并确认完整计划",
        409,
      );
    return this.knowledge.db.transaction(async (tx) => {
      const mutation = await this.mutate(actor, canvas, tx, parsed);
      parseCanvasWrite({
        expectedRevision: canvas.revision,
        contractVersion: canvas.contractVersion,
        nodes: mutation.nodes,
        edges: mutation.edges,
        viewport: mutation.viewport,
        settings: mutation.settings,
      });
      return mutation;
    });
  }
  private async mutate(
    actor: AgentActor,
    canvas: CanvasDocument,
    tx: AgentTx,
    parsed: Array<ToolCall & { input: any }>,
  ) {
    await guardWrite(tx, actor);
    const nodes = structuredClone(canvas.nodes),
      edges = structuredClone(canvas.edges),
      results: Record<string, unknown> = {};
    for (const c of parsed) {
      const p = c.input;
      if (c.toolName === "create_canvas_node") {
        const id = c.stepId;
        if (nodes.some((n) => n.id === id)) fail("节点ID已存在");
        if (p.type === "knowledge:document") {
          const d = await this.knowledge.referenceInTransaction(
            tx,
            actor.actorId,
            actor.projectId,
            p.reference,
            true,
          );
          nodes.push({
            id,
            type: p.type,
            definitionId: "builtin.knowledge:document",
            definitionVersion: 1,
            workflowKind: "knowledge.reference",
            locked: false,
            title: d.title,
            position: p.position,
            width: 340,
            height: 230,
            metadata: { knowledgeReference: p.reference },
          });
          results[c.toolCallId] = {
            nodeId: id,
            sourceRevision: d.revision,
            sourceHash: d.contentHash,
            documentId: p.reference.documentId,
          };
        } else {
          nodes.push({
            id,
            type: "text",
            definitionId: "builtin.text",
            definitionVersion: 1,
            workflowKind: "text",
            locked: false,
            title: p.title,
            position: p.position,
            width: 400,
            height: 300,
            metadata: { content: p.content },
          });
          results[c.toolCallId] = { nodeId: id };
        }
      } else if (c.toolName === "update_canvas_node") {
        const node = nodes.find((n) => n.id === p.nodeId);
        if (!node || node.type !== "text" || node.locked)
          fail("仅可修改未锁定的文本节点");
        if (p.title !== undefined) node!.title = p.title;
        if (p.position !== undefined) node!.position = p.position;
        if (p.content !== undefined)
          node!.metadata = { ...node!.metadata, content: p.content };
        results[c.toolCallId] = { nodeId: p.nodeId };
      } else if (c.toolName === "connect_canvas_nodes") {
        const from = nodes.find((n) => n.id === p.fromNodeId),
          to = nodes.find((n) => n.id === p.toNodeId);
        if (from?.type === "knowledge:document")
          await requireKnowledgeFeature(tx, actor.actorId);
        if (
          !from ||
          !to ||
          from.id === to.id ||
          to.type !== "text" ||
          to.locked
        )
          fail("连接节点不存在、目标不支持文本输入或被锁定");
        if (
          !(
            (from!.type === "knowledge:document" &&
              p.sourcePortId === "knowledge.output") ||
            (from!.type === "text" && p.sourcePortId === "text.output")
          ) ||
          p.targetPortId !== "text.input"
        )
          fail("端口与节点协议不匹配");
        const same = edges.find(
          (e) =>
            e.fromNodeId === from!.id &&
            e.toNodeId === to!.id &&
            e.sourcePortId === p.sourcePortId &&
            e.targetPortId === p.targetPortId,
        );
        if (same) {
          results[c.toolCallId] = { edgeId: same.id, alreadyExists: true };
          continue;
        }
        const seen = new Set<string>(),
          todo = [to!.id];
        while (todo.length) {
          const id = todo.pop()!;
          if (id === from!.id) fail("连接会形成执行环路");
          if (seen.has(id)) continue;
          seen.add(id);
          for (const e of edges) if (e.fromNodeId === id) todo.push(e.toNodeId);
        }
        const order = edges
          .filter(
            (e) =>
              e.toNodeId === p.toNodeId && e.targetPortId === p.targetPortId,
          )
          .reduce((n, e) => Math.max(n, e.order + 1), 0);
        edges.push({
          id: c.stepId,
          fromNodeId: p.fromNodeId,
          toNodeId: p.toNodeId,
          sourcePortId: p.sourcePortId,
          targetPortId: p.targetPortId,
          resourceType: "text",
          role: "data",
          order,
          metadata: {},
        });
        results[c.toolCallId] = { edgeId: c.stepId };
      } else fail("此工具不属于画布事务");
    }
    return {
      nodes,
      edges,
      viewport: canvas.viewport,
      settings: canvas.settings,
      result: {
        calls: results,
        createdNodeIds: parsed
          .filter((c) => c.toolName === "create_canvas_node")
          .map((c) => c.stepId),
      },
    };
  }
}
