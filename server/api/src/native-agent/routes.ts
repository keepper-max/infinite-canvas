import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { NativeAgentService } from "./service.js";
import { uuid } from "./contracts.js";
export function registerNativeAgentRoutes(
  app: Hono<any>,
  service: NativeAgentService,
  identity: (request: Request) => Promise<{ id: string }>,
) {
  const base = "/api/native-agent";
  app.get(base + "/admin/models", async (c) => {
    const actor = await identity(c.req.raw);
    if (!service.policy) throw new Error("Agent policy not configured");
    return c.json({ data: await service.policy.admin(actor.id) });
  });
  app.patch(base + "/admin/policy", async (c) => {
    const actor = await identity(c.req.raw);
    if (!service.policy) throw new Error("Agent policy not configured");
    return c.json({
      data: await service.policy.save(actor.id, await c.req.json()),
    });
  });
  app.post(base + "/admin/model-verifications", async (c) =>
    c.json({
      data: await service.startProbe(
        (await identity(c.req.raw)).id,
        await c.req.json(),
      ),
    }),
  );

  app.post(base + "/admin/grants/:userId", async (c) => {
    const actor = await identity(c.req.raw),
      p = z
        .object({ enabled: z.boolean(), reason: z.string().trim().min(1) })
        .strict()
        .parse(await c.req.json());
    return c.json({
      data: await service.grant(
        actor.id,
        uuid.parse(c.req.param("userId")),
        p.enabled,
        p.reason,
      ),
    });
  });
  app.get(base + "/status", async (c) =>
    c.json({ data: await service.feature((await identity(c.req.raw)).id) }),
  );
  app.get(base + "/sessions", async (c) =>
    c.json({
      data: await service.sessions(
        (await identity(c.req.raw)).id,
        uuid.parse(c.req.query("projectId")),
      ),
    }),
  );
  app.post(base + "/sessions", async (c) =>
    c.json({
      data: await service.createSession(
        (await identity(c.req.raw)).id,
        await c.req.json(),
      ),
    }),
  );
  app.get(base + "/sessions/:id", async (c) =>
    c.json({
      data: await service.snapshot(
        (await identity(c.req.raw)).id,
        uuid.parse(c.req.param("id")),
      ),
    }),
  );
  app.post(base + "/sessions/:id/close", async (c) =>
    c.json({
      data: await service.close(
        (await identity(c.req.raw)).id,
        uuid.parse(c.req.param("id")),
      ),
    }),
  );
  app.post(base + "/sessions/:id/runs", async (c) =>
    c.json({
      data: await service.start(
        (await identity(c.req.raw)).id,
        uuid.parse(c.req.param("id")),
        await c.req.json(),
      ),
    }),
  );
  app.post(base + "/runs/:id/resume", async (c) =>
    c.json({
      data: await service.resume(
        (await identity(c.req.raw)).id,
        uuid.parse(c.req.param("id")),
        await c.req.json(),
      ),
    }),
  );
  app.post(base + "/runs/:id/reconcile", async (c) =>
    c.json({
      data: await service.reconcile(
        (await identity(c.req.raw)).id,
        uuid.parse(c.req.param("id")),
      ),
    }),
  );
  app.post(base + "/runs/:id/cancel", async (c) =>
    c.json({
      data: await service.cancel(
        (await identity(c.req.raw)).id,
        uuid.parse(c.req.param("id")),
      ),
    }),
  );
  app.post(base + "/approvals/:id", async (c) =>
    c.json({
      data: await service.decide(
        (await identity(c.req.raw)).id,
        uuid.parse(c.req.param("id")),
        await c.req.json(),
      ),
    }),
  );
  app.get(base + "/runs/:id/events", async (c) => {
    const actor = await identity(c.req.raw),
      runId = uuid.parse(c.req.param("id")),
      after = z.coerce
        .number()
        .int()
        .nonnegative()
        .parse(c.req.query("after") ?? c.req.header("last-event-id") ?? 0);
    const events = await service.events(actor.id, runId, after);
    return streamSSE(c, async (stream) => {
      for (const e of events) {
        if (stream.aborted) break;
        await stream.writeSSE({
          id: String(e.id),
          event: e.type,
          data: JSON.stringify(e),
        });
      }
    });
  });
}
