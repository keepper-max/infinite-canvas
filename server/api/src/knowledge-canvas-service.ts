import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PostgresPlatformRepository } from "./repository.js";
import { knowledgeReferenceSchema } from "./knowledge-reference.js";
import type { KnowledgeService } from "./knowledge-service.js";

export const addKnowledgeNodeSchema = z
  .object({
    operationId: z.string().uuid(),
    expectedCanvasRevision: z.number().int().nonnegative(),
    reference: knowledgeReferenceSchema,
    position: z
      .object({ x: z.number().finite(), y: z.number().finite() })
      .strict(),
  })
  .strict();

export class KnowledgeCanvasService {
  private repository: PostgresPlatformRepository;
  constructor(private knowledge: KnowledgeService) {
    this.repository = new PostgresPlatformRepository(knowledge.db);
  }
  async add(projectId: string, actor: string, raw: unknown) {
    const { operationId, expectedCanvasRevision, ...payload } =
      addKnowledgeNodeSchema.parse(raw);
    return this.repository.applyCanvasOperationForUser(
      projectId,
      actor,
      {
        operationId,
        expectedCanvasRevision,
        kind: "knowledge.reference.add",
        payload,
      },
      async (canvas, tx) => {
        const value = await this.knowledge.referenceInTransaction(
          tx,
          actor,
          projectId,
          payload.reference,
          true,
        );
        const nodeId = randomUUID();
        return {
          nodes: [
            ...canvas.nodes,
            {
              id: nodeId,
              type: "knowledge:document",
              definitionId: "builtin.knowledge:document",
              definitionVersion: 1,
              workflowKind: "knowledge.reference",
              title: value.title,
              position: payload.position,
              width: 340,
              height: 230,
              metadata: { knowledgeReference: payload.reference },
            },
          ],
          edges: canvas.edges,
          viewport: canvas.viewport,
          settings: canvas.settings,
          result: {
            createdNodeId: nodeId,
            documentId: payload.reference.documentId,
            sourceRevision: value.revision,
          },
        };
      },
    );
  }
  receipt(projectId: string, actor: string, operationId: string) {
    return this.repository.getCanvasOperationReceiptForUser(
      projectId,
      actor,
      operationId,
    );
  }
}
