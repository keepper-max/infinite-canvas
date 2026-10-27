import { p1Enabled, requireP1, p1JsonSchema } from "./p1/contract.js";
import type { Hono } from "hono";
import { z } from "zod";
import { AUTOCUT_LIMITS, timelineJsonSchema } from "./contract.js";
import type { AutoCutService } from "./service.js";
export function registerAutoCutRoutes(
  app: Hono<any>,
  service: AutoCutService,
  identity: (r: Request) => Promise<{ id: string }>,
) {
  const root = "/api/autocut";
  const uuid = z.string().uuid();
  app.get(root + "/status", async (c) => {
    await identity(c.req.raw);
    return c.json({
      data: {
        p1Enabled: p1Enabled(),
        enabled: service.enabled,
        accepting: await service.acceptingTasks(),
        limits: AUTOCUT_LIMITS,
      },
    });
  });
  app.get(root + "/p1/capabilities", async (c) => {
    await identity(c.req.raw);
    return c.json({
      data: {
        enabled: p1Enabled(),
        formats: ["otio", "fcp7", "jianying", "capcut", "srt"].map(
          (format) => ({
            format,
            experimental: true,
            verifiedVersions: [],
            enabled:
              !!process.env.AUTOCUT_P1_EXPORT_PYTHON &&
              (format !== "capcut" ||
                process.env.AUTOCUT_P1_CAPCUT_LICENSE_APPROVED === "true"),
            reason:
              format === "capcut"
                ? "依赖许可和客户端兼容性尚未验证"
                : "未做目标客户端验收，不承诺无损兼容",
          }),
        ),
        schema: p1Enabled() ? p1JsonSchema : undefined,
      },
    });
  });
  app.put(root + "/p1/projects/:id/timeline", async (c) => {
    requireP1();
    const p = z
      .object({ expectedRevision: uuid.nullable(), timeline: z.unknown() })
      .strict()
      .parse(await c.req.json());
    return c.json({
      data: await service.saveP1(
        uuid.parse(c.req.param("id")),
        (await identity(c.req.raw)).id,
        p.expectedRevision,
        p.timeline,
      ),
    });
  });
  app.post(root + "/p1/projects/:id/assets", async (c) => {
    requireP1();
    const p = z
      .object({
        expectedRevision: uuid.nullable(),
        assetVersionIds: z.array(uuid).min(1).max(20),
      })
      .strict()
      .parse(await c.req.json());
    return c.json({
      data: await service.addP1Assets(
        uuid.parse(c.req.param("id")),
        (await identity(c.req.raw)).id,
        p.expectedRevision,
        p.assetVersionIds,
      ),
    });
  });
  app.get(root + "/timeline-schema", async (c) => {
    await identity(c.req.raw);
    return c.json({ data: timelineJsonSchema });
  });
  app.get(root + "/workspaces/:id/projects", async (c) =>
    c.json({
      data: await service.list(
        uuid.parse(c.req.param("id")),
        (await identity(c.req.raw)).id,
      ),
    }),
  );
  app.post(root + "/workspaces/:id/projects", async (c) =>
    c.json({
      data: await service.create(
        uuid.parse(c.req.param("id")),
        (await identity(c.req.raw)).id,
        await c.req.json(),
      ),
    }),
  );
  app.get(root + "/projects/:id", async (c) =>
    c.json({
      data: await service.get(
        uuid.parse(c.req.param("id")),
        (await identity(c.req.raw)).id,
      ),
    }),
  );
  app.post(root + "/projects/:id/archive", async (c) => {
    await service.archive(
      uuid.parse(c.req.param("id")),
      (await identity(c.req.raw)).id,
    );
    return c.json({ data: { archived: true } });
  });
  app.put(root + "/projects/:id/timeline", async (c) => {
    const p = z
      .object({ expectedRevision: uuid.nullable(), timeline: z.unknown() })
      .strict()
      .parse(await c.req.json());
    return c.json({
      data: await service.save(
        uuid.parse(c.req.param("id")),
        (await identity(c.req.raw)).id,
        p.expectedRevision,
        p.timeline,
      ),
    });
  });
  app.post(root + "/projects/:id/restore", async (c) => {
    const p = z
      .object({ expectedRevision: uuid.nullable(), revisionId: uuid })
      .strict()
      .parse(await c.req.json());
    return c.json({
      data: await service.restore(
        uuid.parse(c.req.param("id")),
        (await identity(c.req.raw)).id,
        p.expectedRevision,
        p.revisionId,
      ),
    });
  });
  app.post(root + "/projects/:id/tasks", async (c) =>
    c.json({
      data: await service.start(
        uuid.parse(c.req.param("id")),
        (await identity(c.req.raw)).id,
        await c.req.json(),
      ),
    }),
  );
  app.post(root + "/projects/:id/tasks/:taskId/cancel", async (c) => {
    await service.cancel(
      uuid.parse(c.req.param("id")),
      uuid.parse(c.req.param("taskId")),
      (await identity(c.req.raw)).id,
    );
    return c.json({ data: { accepted: true } });
  });
  app.post(root + "/projects/:id/tasks/:taskId/retry", async (c) =>
    c.json({
      data: await service.retry(
        uuid.parse(c.req.param("id")),
        uuid.parse(c.req.param("taskId")),
        (await identity(c.req.raw)).id,
      ),
    }),
  );
}
