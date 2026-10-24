import { z } from "zod";
import type { Hono } from "hono";
import type { KnowledgeService } from "./knowledge-service.js";
import { KnowledgeCanvasService, addKnowledgeNodeSchema } from "./knowledge-canvas-service.js";
import { knowledgeReferenceSchema } from "./knowledge-reference.js";
const uuid = z.string().uuid(),
  name = z.string().trim().min(1),
  revision = z.number().int().nonnegative();
const op = z.object({ operationId: uuid });
const document = z.object({
  title: name,
  markdown: z.string(),
  folderId: uuid.nullable().default(null),
});
const action = z.discriminatedUnion("action", [
  op.extend({action:z.literal('document.importConfirm'),payload:document.extend({taskId:uuid,allowDuplicate:z.boolean().default(false)}).strict()}),
  op.extend({ action: z.literal("document.linkAdd"), payload: z.object({ id: uuid, expectedRevision: revision, targetId: uuid }).strict() }),
  op.extend({ action: z.literal("document.linkRemove"), payload: z.object({ id: uuid, expectedRevision: revision, targetId: uuid }).strict() }),
  op.extend({ action: z.literal("document.copyFrom"), payload: z.object({ sourceSpaceId: uuid, sourceDocumentId: uuid, sourceRevision: revision.positive() }).strict() }),
  op.extend({ action: z.literal("document.create"), payload: document }),
  op.extend({ action: z.literal("document.import"), payload: document }),
  op.extend({
    action: z.literal("document.save"),
    payload: document.extend({ id: uuid, expectedRevision: revision }),
  }),
  op.extend({
    action: z.literal("document.delete"),
    payload: z.object({ id: uuid, expectedRevision: revision }),
  }),
  op.extend({
    action: z.literal("document.restore"),
    payload: z.object({
      id: uuid,
      expectedRevision: revision,
      version: revision,
    }),
  }),
  op.extend({
    action: z.literal("document.resolveLink"),
    payload: z.object({
      id: uuid,
      expectedRevision: revision,
      ordinal: z.number().int().nonnegative(),
      targetId: uuid,
    }),
  }),
  op.extend({
    action: z.literal("folder.create"),
    payload: z.object({ name, parentId: uuid.nullable().default(null) }),
  }),
  op.extend({
    action: z.literal("folder.save"),
    payload: z.object({
      id: uuid,
      name,
      parentId: uuid.nullable().default(null),
      expectedRevision: revision,
    }),
  }),
  op.extend({
    action: z.literal("folder.delete"),
    payload: z.object({ id: uuid, expectedRevision: revision }),
  }),
]);
export function registerKnowledgeRoutes(
  app: Hono<any>,
  service: KnowledgeService,
  identity: (request: Request) => Promise<{ id: string }>,
) {
  const base = "/api/knowledge";
  const canvas = new KnowledgeCanvasService(service);
  app.post(base + "/reference-summary", async c => {
    const user = await identity(c.req.raw);
    const p = z.object({ projectId: uuid, reference: knowledgeReferenceSchema }).strict().parse(await c.req.json());
    return c.json({ data: await service.reference(user.id, p.projectId, p.reference) });
  });
  app.post(base + "/canvas/:projectId/nodes", async c => c.json({ data: await canvas.add(uuid.parse(c.req.param("projectId")), (await identity(c.req.raw)).id, addKnowledgeNodeSchema.parse(await c.req.json())) }));
  app.get(base + "/canvas/:projectId/operations/:operationId", async c => c.json({ data: await canvas.receipt(uuid.parse(c.req.param("projectId")), (await identity(c.req.raw)).id, uuid.parse(c.req.param("operationId"))) }));
  app.get(base + "/:spaceId/graph", async (c) => {
    const q = z
      .object({
        centerId: uuid.optional(),
        cursor: uuid.optional(),
        edgeCursor: z
          .string()
          .refine((v) => {
            const parts = v.split(":");
            return (
              parts.length === 2 &&
              parts.every((p) => uuid.safeParse(p).success)
            );
          })
          .optional(),
        pageSize: z.coerce.number().int().positive().default(20),
        folderId: uuid.optional(),
        tag: z.string().optional(),
      })
      .parse(c.req.query());
    return c.json({
      data: await service.graph(
        (await identity(c.req.raw)).id,
        uuid.parse(c.req.param("spaceId")),
        q,
      ),
    });
  });
  app.get(base + "/spaces", async (c) =>
    c.json({ data: await service.spaces((await identity(c.req.raw)).id) }),
  );
  app.post(base + "/spaces", async (c) => {
    const u = await identity(c.req.raw),
      p = op
        .extend({
          kind: z.enum(["personal", "project"]),
          projectId: uuid.nullable().default(null),
        })
        .parse(await c.req.json());
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("personal"), projectId: z.null() }),
      z.object({ kind: z.literal("project"), projectId: uuid }),
    ]).parse(p);
    return c.json({
      data: await service.createSpace(u.id, p.kind, p.projectId, p.operationId),
    });
  });
  app.get(base + "/:spaceId/documents", async (c) => {
    const u = await identity(c.req.raw),
      q = z
        .object({
          q: z.string().optional(),
          tag: z.string().optional(),
          folderId: uuid.optional(),
          deleted: z.enum(["true", "false"]).optional(),
          page: z.coerce.number().int().positive().default(1),
          pageSize: z.coerce.number().int().positive().default(20),
        })
        .parse(c.req.query());
    return c.json({
      data: await service.list(u.id, uuid.parse(c.req.param("spaceId")), {
        ...q,
        deleted: q.deleted === "true",
      }),
    });
  });
  app.get(base + "/:spaceId/folders", async (c) =>
    c.json({
      data: await service.folders(
        (await identity(c.req.raw)).id,
        uuid.parse(c.req.param("spaceId")),
      ),
    }),
  );
  app.get(base + "/:spaceId/tags", async (c) =>
    c.json({
      data: await service.tags(
        (await identity(c.req.raw)).id,
        uuid.parse(c.req.param("spaceId")),
      ),
    }),
  );
  app.post(base + "/:spaceId/actions", async (c) => {
    const u = await identity(c.req.raw),
      s = uuid.parse(c.req.param("spaceId")),
      p = action.parse(await c.req.json());
    return c.json({
      data: await (p.action.startsWith("folder.")
        ? service.folderWrite(u.id, s, p)
        : service.write(u.id, s, p)),
    });
  });
  app.get(base + "/:spaceId/operations/:operationId", async (c) =>
    c.json({
      data: await service.receipt(
        (await identity(c.req.raw)).id,
        uuid.parse(c.req.param("spaceId")),
        uuid.parse(c.req.param("operationId")),
      ),
    }),
  );
  app.get(base + "/:spaceId/documents/:id", async (c) =>
    c.json({
      data: await service.read(
        (await identity(c.req.raw)).id,
        uuid.parse(c.req.param("spaceId")),
        uuid.parse(c.req.param("id")),
      ),
    }),
  );
  app.get(base + "/:spaceId/documents/:id/link-preview", async c => {
    const input = z.object({ targetId: uuid, action: z.enum(["add", "remove"]) }).parse(c.req.query());
    return c.json({ data: await service.previewLink((await identity(c.req.raw)).id, uuid.parse(c.req.param("spaceId")), uuid.parse(c.req.param("id")), input.targetId, input.action) });
  });
  app.get(base + "/:spaceId/documents/:id/relations", async (c) =>
    c.json({
      data: await service.relations(
        (await identity(c.req.raw)).id,
        uuid.parse(c.req.param("spaceId")),
        uuid.parse(c.req.param("id")),
      ),
    }),
  );
  app.get(base + "/:spaceId/documents/:id/history", async (c) =>
    c.json({
      data: await service.history(
        (await identity(c.req.raw)).id,
        uuid.parse(c.req.param("spaceId")),
        uuid.parse(c.req.param("id")),
      ),
    }),
  );
  app.get(base + "/:spaceId/documents/:id/history/:revision", async (c) =>
    c.json({
      data: await service.version(
        (await identity(c.req.raw)).id,
        uuid.parse(c.req.param("spaceId")),
        uuid.parse(c.req.param("id")),
        z.coerce.number().int().positive().parse(c.req.param("revision")),
      ),
    }),
  );
}
