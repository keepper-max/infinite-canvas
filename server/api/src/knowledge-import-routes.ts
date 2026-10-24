import type { Hono } from "hono";
import { z } from "zod";
import { bodyLimit } from "hono/body-limit";
import { DomainError } from "./domain.js";
import type { KnowledgeImportService } from "./knowledge-import-service.js";
const uuid = z.string().uuid();
export function registerKnowledgeImportRoutes(
  app: Hono<any>,
  imports: KnowledgeImportService | undefined,
  identity: (r: Request) => Promise<{ id: string }>,
) {
  const base = "/api/knowledge/:spaceId/imports";
  app.use(base + "/*", async (c, next) => {
    if (!imports)
      throw new DomainError(
        "KNOWLEDGE_IMPORT_UNAVAILABLE",
        "资料转换服务尚未启用，请联系管理员；当前文档仍可编辑",
        503,
      );
    await next();
  });
  app.use(base, async (c, next) => {
    if (!imports)
      throw new DomainError(
        "KNOWLEDGE_IMPORT_UNAVAILABLE",
        "资料转换服务尚未启用",
        503,
      );
    await next();
  });
  app.post(
    base,
    bodyLimit({
      maxSize: 10 * 1024 * 1024,
      onError: (c) =>
        c.json(
          {
            error: {
              code: "KNOWLEDGE_IMPORT_SIZE",
              message: "文件超过10MiB试运行上限",
            },
          },
          413,
        ),
    }),
    async (c) => {
      const user = await identity(c.req.raw),
        space = uuid.parse(c.req.param("spaceId"));
      // Authorize before reading an untrusted body.
      await imports!.knowledge.run(user.id, space, true, async () => {});
      let decoded: string;
      try {
        decoded = decodeURIComponent(c.req.header("x-file-name") || "");
      } catch {
        throw new DomainError(
          "KNOWLEDGE_IMPORT_NAME",
          "文件名编码无效，请重新选择文件",
          422,
        );
      }
      const name = z
        .string()
        .min(1)
        .max(255)
        .refine((n) => !/[\x00-\x1f/\\]/.test(n))
        .parse(decoded);
      return c.json({
        data: await imports!.upload(
          user.id,
          space,
          uuid.parse(c.req.header("x-operation-id")),
          name,
          new Uint8Array(await c.req.arrayBuffer()),
          uuid.nullable().parse(c.req.header("x-folder-id") || null),
        ),
      });
    },
  );
  app.get(base, async (c) =>
    c.json({
      data: await imports!.list(
        (await identity(c.req.raw)).id,
        uuid.parse(c.req.param("spaceId")),
      ),
    }),
  );
  app.get(base + "/operations/:operationId", async (c) =>
    c.json({
      data: await imports!.operation(
        (await identity(c.req.raw)).id,
        uuid.parse(c.req.param("spaceId")),
        uuid.parse(c.req.param("operationId")),
      ),
    }),
  );
  app.get(base + "/:id", async (c) =>
    c.json({
      data: await imports!.get(
        (await identity(c.req.raw)).id,
        uuid.parse(c.req.param("spaceId")),
        uuid.parse(c.req.param("id")),
      ),
    }),
  );
  app.post(base + "/:id/:action", async (c) => {
    const u = await identity(c.req.raw),
      s = uuid.parse(c.req.param("spaceId")),
      id = uuid.parse(c.req.param("id")),
      action = z
        .enum(["cancel", "retry", "reparse", "confirm"])
        .parse(c.req.param("action"));
    if (action === "confirm") {
      const p = z
        .object({
          operationId: uuid,
          title: z.string().trim().min(1),
          markdown: z.string(),
          folderId: uuid.nullable(),
          allowDuplicate: z.boolean().default(false),
        })
        .parse(await c.req.json());
      return c.json({
        data: await imports!.knowledge.write(u.id, s, {
          operationId: p.operationId,
          action: "document.importConfirm",
          payload: {
            taskId: id,
            title: p.title,
            markdown: p.markdown,
            folderId: p.folderId,
            allowDuplicate: p.allowDuplicate,
          },
        }),
      });
    }
    if (action === "reparse")
      return c.json({
        data: await imports!.reparse(
          u.id,
          s,
          id,
          uuid.parse((await c.req.json()).operationId),
        ),
      });
    return c.json({ data: await imports!.change(u.id, s, id, action) });
  });
  for (const path of ["/original", "/assets/:assetId"])
    app.get(base + "/:id" + path, async (c) => {
      const asset = c.req.param("assetId");
      if (asset && !/^\d+$/.test(asset))
        throw new DomainError("NOT_FOUND", "附件不存在", 404);
      const { stream, filename } = await imports!.original(
        (await identity(c.req.raw)).id,
        uuid.parse(c.req.param("spaceId")),
        uuid.parse(c.req.param("id")),
        asset,
      );
      return new Response(stream.body, {
        status: stream.status,
        headers: {
          "Content-Type": stream.mimeType,
          "Content-Length": String(stream.bytes),
          "Content-Disposition": `${asset ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      });
    });
  app.get("/api/knowledge/:spaceId/documents/:id/sources", async (c) => {
    if (!imports)
      throw new DomainError(
        "KNOWLEDGE_IMPORT_UNAVAILABLE",
        "资料转换服务尚未启用",
        503,
      );
    return c.json({
      data: await imports.sources(
        (await identity(c.req.raw)).id,
        uuid.parse(c.req.param("spaceId")),
        uuid.parse(c.req.param("id")),
      ),
    });
  });
}
