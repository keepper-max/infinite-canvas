import { randomUUID } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  normalizeEmail,
  passwordPolicy,
  verifyPassword,
} from "./auth.js";
import {
  beginAssetUploadSchema,
  completeAssetUploadSchema,
  setCurrentVersionSchema,
  trashAssetSchema,
} from "./asset-contract.js";
import type { AssetServicePort } from "./asset-service.js";
import { parseCanvasWrite } from "./canvas-contract.js";
import { createCompositionJobSchema } from "./composition-contract.js";
import type { CompositionService } from "./composition-service.js";
import type { ApiConfig } from "./config.js";
import {
  DomainError,
  type PlatformRepository,
  type PlatformUser,
} from "./domain.js";
import { createJobSchema } from "./job-contract.js";
import type { JobService } from "./job-service.js";
import type { ModelGateway } from "./model-gateway.js";
import {
  paymentOrderSchema,
  smsRequestSchema,
  smsVerifySchema,
  teamCreateSchema,
  teamMemberSchema,
  teamProjectSchema,
} from "./operations-contract.js";
import type { OperationsServicePort } from "./operations-service.js";
import type { TextWorkbenchService } from "./text-workbench-service.js";

type Variables = { requestId: string };
type AppEnv = { Variables: Variables };

export function createApp(
  repository: PlatformRepository,
  config: ApiConfig,
  assetService?: AssetServicePort,
  jobService?: JobService,
  modelGateway?: ModelGateway,
  compositionService?: CompositionService,
  operationsService?: OperationsServicePort,
  textWorkbenchService?: TextWorkbenchService,
) {
  const app = new Hono<AppEnv>();

  app.use("*", async (context, next) => {
    const requestId =
      context.req.header("x-request-id")?.slice(0, 128) || randomUUID();
    context.set("requestId", requestId);
    context.header("x-request-id", requestId);
    context.header("x-content-type-options", "nosniff");
    context.header("x-frame-options", "DENY");
    context.header("referrer-policy", "same-origin");
    context.header(
      "permissions-policy",
      "camera=(), microphone=(), geolocation=()",
    );
    if (config.cookieSecure)
      context.header(
        "strict-transport-security",
        "max-age=31536000; includeSubDomains",
      );
    await next();
  });

  app.use("/api/*", async (context, next) => {
    context.header("cache-control", "no-store");
    if (
      isUnsafeMethod(context.req.method) &&
      !isTrustedRequest(context.req.raw, config.trustedOrigins)
    ) {
      return apiError(
        context,
        new DomainError("UNTRUSTED_ORIGIN", "请求来源不受信任", 403),
      );
    }
    await next();
  });

  app.get("/api/health/live", (context) =>
    context.json({
      data: { ok: true },
      meta: { requestId: context.get("requestId") },
    }),
  );
  app.get("/api/health/ready", async (context) => {
    await repository.isReady();
    return context.json({
      data: { ok: true },
      meta: { requestId: context.get("requestId") },
    });
  });

  app.post("/api/auth/register", async (context) => {
    const input = authInput.parse(await readJson(context.req.raw));
    const email = normalizeEmail(input.email);
    const passwordHash = await hashPassword(input.password);
    const result = await repository.createUserWithWorkspace(
      email,
      passwordHash,
    );
    const expiresAt = await issueSession(
      context,
      repository,
      config,
      result.user.id,
    );
    return context.json(
      success(context, {
        ...result,
        sessionExpiresAt: expiresAt.toISOString(),
      }),
      201,
    );
  });

  app.post("/api/auth/login", async (context) => {
    const input = loginInput.parse(await readJson(context.req.raw));
    const user = await repository.findUserByEmail(normalizeEmail(input.email));
    if (!user || !(await verifyPassword(user.passwordHash, input.password)))
      throw new DomainError("INVALID_CREDENTIALS", "邮箱或密码错误", 401);
    const workspace = await repository.ensureDefaultWorkspace(user.id);
    const expiresAt = await issueSession(context, repository, config, user.id);
    return context.json(
      success(context, {
        user: publicUser(user),
        workspace,
        sessionExpiresAt: expiresAt.toISOString(),
      }),
    );
  });

  app.get("/api/auth/me", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const workspace = await repository.ensureDefaultWorkspace(user.id);
    return context.json(success(context, { user, workspace }));
  });

  app.post("/api/auth/logout", async (context) => {
    const token = getCookie(context, config.cookieName);
    if (token) await repository.deleteSession(hashSessionToken(token));
    deleteCookie(context, config.cookieName, {
      path: "/",
      secure: config.cookieSecure,
      sameSite: "Lax",
    });
    return context.json(success(context, { ok: true }));
  });

  app.get("/api/operations/capabilities", async (context) => {
    await requireUser(context.req.raw, repository, config);
    return context.json(
      success(
        context,
        requireOperationsService(operationsService).capabilities(),
      ),
    );
  });

  app.post("/api/auth/sms/request", async (context) => {
    await requireOperationsService(operationsService).requestSms(
      smsRequestSchema.parse(await readJson(context.req.raw)),
    );
  });

  app.post("/api/auth/sms/verify", async (context) => {
    await requireOperationsService(operationsService).verifySms(
      smsVerifySchema.parse(await readJson(context.req.raw)),
    );
  });

  app.get("/api/billing/account", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    return context.json(
      success(
        context,
        await requireOperationsService(operationsService).account(user.id),
      ),
    );
  });

  app.get("/api/billing/plans", async (context) => {
    await requireUser(context.req.raw, repository, config);
    return context.json(
      success(context, {
        plans: await requireOperationsService(operationsService).plans(),
      }),
    );
  });

  app.post("/api/payments/orders", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    await requireOperationsService(operationsService).createPaymentOrder(
      user.id,
      paymentOrderSchema.parse(await readJson(context.req.raw)),
    );
  });

  app.post("/api/payments/callbacks/:provider", async (context) => {
    await requireOperationsService(operationsService).receivePaymentCallback(
      z
        .string()
        .regex(/^[a-z0-9_-]{1,50}$/i)
        .parse(context.req.param("provider")),
    );
  });

  app.get("/api/teams", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    return context.json(
      success(context, {
        teams: await requireOperationsService(operationsService).listTeams(
          user.id,
        ),
      }),
    );
  });

  app.post("/api/teams", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const team = await requireOperationsService(operationsService).createTeam(
      user.id,
      teamCreateSchema.parse(await readJson(context.req.raw)),
    );
    return context.json(success(context, { team }), 201);
  });

  app.get("/api/teams/:teamId/members", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const members = await requireOperationsService(
      operationsService,
    ).listTeamMembers(context.req.param("teamId"), user.id);
    return context.json(success(context, { members }));
  });

  app.post("/api/teams/:teamId/members", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const member = await requireOperationsService(
      operationsService,
    ).addTeamMember(
      context.req.param("teamId"),
      user.id,
      teamMemberSchema.parse(await readJson(context.req.raw)),
    );
    return context.json(success(context, { member }), 201);
  });

  app.post("/api/teams/:teamId/projects", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const input = teamProjectSchema.parse(await readJson(context.req.raw));
    const project = await requireOperationsService(
      operationsService,
    ).attachTeamProject(context.req.param("teamId"), user.id, input.projectId);
    return context.json(success(context, { project }), 201);
  });

  app.get("/api/admin/overview", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    return context.json(
      success(
        context,
        await requireOperationsService(operationsService).adminOverview(
          user.id,
        ),
      ),
    );
  });

  app.get("/api/admin/failures", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    return context.json(
      success(context, {
        failures: await requireOperationsService(
          operationsService,
        ).adminFailures(user.id),
      }),
    );
  });

  app.get("/api/admin/models", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    return context.json(
      success(context, {
        models: await requireOperationsService(operationsService).adminModels(
          user.id,
        ),
      }),
    );
  });

  app.get("/api/projects", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    return context.json(
      success(context, { projects: await repository.listProjects(user.id) }),
    );
  });

  app.post("/api/projects", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const input = projectCreateInput.parse(await readJson(context.req.raw));
    const project = await repository.createProjectForUser(user.id, input);
    return context.json(success(context, { project }), 201);
  });

  app.get("/api/projects/:projectId", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const project = await repository.getProjectForUser(
      context.req.param("projectId"),
      user.id,
    );
    if (!project)
      throw new DomainError("PROJECT_FORBIDDEN", "无权访问该项目", 403);
    return context.json(success(context, { project }));
  });

  app.patch("/api/projects/:projectId", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const input = projectUpdateInput.parse(await readJson(context.req.raw));
    const project = await repository.updateProjectForUser(
      context.req.param("projectId"),
      user.id,
      input,
    );
    if (!project)
      throw new DomainError("PROJECT_FORBIDDEN", "无权访问该项目", 403);
    return context.json(success(context, { project }));
  });

  app.delete("/api/projects/:projectId", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const result = await repository.deleteProjectForUser(
      context.req.param("projectId"),
      user.id,
    );
    if (!result)
      throw new DomainError("PROJECT_FORBIDDEN", "无权访问该项目", 403);
    return context.json(success(context, result));
  });

  app.get("/api/projects/:projectId/canvas", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const canvas = await repository.getCanvasForUser(
      context.req.param("projectId"),
      user.id,
    );
    if (!canvas)
      throw new DomainError("PROJECT_FORBIDDEN", "无权访问该项目", 403);
    return context.json(success(context, { canvas }));
  });

  app.put("/api/projects/:projectId/canvas", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const { write } = parseCanvasWrite(await readJson(context.req.raw));
    const canvas = await repository.saveCanvasForUser(
      context.req.param("projectId"),
      user.id,
      write,
    );
    return context.json(success(context, { canvas }));
  });

  app.get("/api/projects/:projectId/canvas/snapshots", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const snapshots = await repository.listCanvasSnapshots(
      context.req.param("projectId"),
      user.id,
    );
    if (!snapshots)
      throw new DomainError("PROJECT_FORBIDDEN", "无权访问该项目", 403);
    return context.json(success(context, { snapshots }));
  });

  app.post(
    "/api/projects/:projectId/canvas/snapshots/:version/restore",
    async (context) => {
      const user = await requireUser(context.req.raw, repository, config);
      const version = positiveInteger.parse(context.req.param("version"));
      const { expectedRevision } = restoreInput.parse(
        await readJson(context.req.raw),
      );
      const canvas = await repository.restoreCanvasSnapshot(
        context.req.param("projectId"),
        user.id,
        version,
        expectedRevision,
      );
      if (!canvas)
        throw new DomainError("PROJECT_FORBIDDEN", "无权访问该项目", 403);
      return context.json(success(context, { canvas }));
    },
  );

  app.post(
    "/api/projects/:projectId/canvas/migrations/indexeddb",
    async (context) => {
      const user = await requireUser(context.req.raw, repository, config);
      const raw = migrationInput.parse(await readJson(context.req.raw));
      const { migrationKey, ...canvasInput } = raw;
      const { write, report } = parseCanvasWrite(canvasInput);
      const result = await repository.migrateCanvasForUser(
        context.req.param("projectId"),
        user.id,
        migrationKey,
        write,
        report,
      );
      return context.json(success(context, result));
    },
  );

  app.get("/api/projects/:projectId/assets", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const assets = await requireAssetService(assetService).list(
      context.req.param("projectId"),
      user.id,
      context.req.query("status") === "all",
    );
    if (!assets)
      throw new DomainError("PROJECT_FORBIDDEN", "无权访问该项目", 403);
    return context.json(success(context, { assets }));
  });

  app.get("/api/models", async (context) => {
    await requireUser(context.req.raw, repository, config);
    return context.json(
      success(context, {
        models: await requireModelGateway(modelGateway).listPublicModels(),
      }),
    );
  });

  app.get("/api/projects/:projectId/text-conversations", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const conversations = await requireTextWorkbenchService(
      textWorkbenchService,
    ).list(context.req.param("projectId"), user.id);
    return context.json(success(context, { conversations }));
  });

  app.post("/api/projects/:projectId/text-conversations", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const input = textConversationCreateInput.parse(
      await readJson(context.req.raw),
    );
    const conversation = await requireTextWorkbenchService(
      textWorkbenchService,
    ).create(context.req.param("projectId"), user.id, input);
    return context.json(success(context, { conversation }), 201);
  });

  app.patch("/api/text-conversations/:conversationId", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const input = textConversationUpdateInput.parse(
      await readJson(context.req.raw),
    );
    const conversation = await requireTextWorkbenchService(
      textWorkbenchService,
    ).update(context.req.param("conversationId"), user.id, input);
    return context.json(success(context, { conversation }));
  });

  app.delete("/api/text-conversations/:conversationId", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const result = await requireTextWorkbenchService(
      textWorkbenchService,
    ).archive(context.req.param("conversationId"), user.id);
    return context.json(success(context, result));
  });

  app.get(
    "/api/text-conversations/:conversationId/messages",
    async (context) => {
      const user = await requireUser(context.req.raw, repository, config);
      const messages = await requireTextWorkbenchService(
        textWorkbenchService,
      ).messages(context.req.param("conversationId"), user.id);
      return context.json(success(context, { messages }));
    },
  );

  app.post(
    "/api/text-conversations/:conversationId/generate",
    async (context) => {
      const user = await requireUser(context.req.raw, repository, config);
      const input = textMessageGenerateInput.parse(
        await readJson(context.req.raw),
      );
      const result = await requireTextWorkbenchService(
        textWorkbenchService,
      ).generate(context.req.param("conversationId"), user.id, input);
      return context.json(success(context, result), 202);
    },
  );

  app.get("/api/projects/:projectId/jobs", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    return context.json(
      success(context, {
        jobs: await requireJobService(jobService).list(
          context.req.param("projectId"),
          user.id,
        ),
      }),
    );
  });

  app.post("/api/projects/:projectId/jobs", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const input = createJobSchema.parse(await readJson(context.req.raw));
    const job = await requireJobService(jobService).create(
      context.req.param("projectId"),
      user.id,
      input,
    );
    return context.json(success(context, { job }), 202);
  });

  app.get("/api/jobs/:jobId", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const job = await requireJobService(jobService).get(
      context.req.param("jobId"),
      user.id,
    );
    if (!job) throw new DomainError("JOB_NOT_FOUND", "找不到该任务", 404);
    return context.json(success(context, { job }));
  });

  app.post("/api/jobs/:jobId/retry", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const job = await requireJobService(jobService).retry(
      context.req.param("jobId"),
      user.id,
    );
    if (!job) throw new DomainError("JOB_NOT_FOUND", "找不到该任务", 404);
    return context.json(success(context, { job }), 202);
  });

  app.post("/api/jobs/:jobId/cancel", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const job = await requireJobService(jobService).cancel(
      context.req.param("jobId"),
      user.id,
    );
    if (!job) throw new DomainError("JOB_NOT_FOUND", "找不到该任务", 404);
    return context.json(success(context, { job }), 202);
  });

  app.get("/api/projects/:projectId/events", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const service = requireJobService(jobService);
    const projectId = context.req.param("projectId");
    let cursor = Number(
      context.req.header("last-event-id") || context.req.query("after") || 0,
    );
    await service.events(projectId, user.id, cursor);
    return streamSSE(context, async (stream) => {
      while (!stream.aborted) {
        const events = await service.events(projectId, user.id, cursor);
        for (const event of events) {
          cursor = event.id;
          await stream.writeSSE({
            id: String(event.id),
            event: event.type,
            data: JSON.stringify(event),
          });
        }
        if (!events.length)
          await stream.writeSSE({
            event: "heartbeat",
            data: JSON.stringify({ at: new Date().toISOString() }),
          });
        await stream.sleep(events.length ? 50 : 1_000);
      }
    });
  });

  app.get("/api/projects/:projectId/compositions", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const jobs = await requireCompositionService(compositionService).list(
      context.req.param("projectId"),
      user.id,
    );
    return context.json(success(context, { jobs }));
  });

  app.post("/api/projects/:projectId/compositions", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const input = createCompositionJobSchema.parse(
      await readJson(context.req.raw),
    );
    const job = await requireCompositionService(compositionService).create(
      context.req.param("projectId"),
      user.id,
      input,
    );
    return context.json(success(context, { job }), 202);
  });

  app.get("/api/compositions/:jobId", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const job = await requireCompositionService(compositionService).get(
      context.req.param("jobId"),
      user.id,
    );
    if (!job)
      throw new DomainError("COMPOSITION_NOT_FOUND", "找不到成片任务", 404);
    return context.json(success(context, { job }));
  });

  app.post("/api/compositions/:jobId/retry", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const job = await requireCompositionService(compositionService).retry(
      context.req.param("jobId"),
      user.id,
    );
    if (!job)
      throw new DomainError("COMPOSITION_NOT_FOUND", "找不到成片任务", 404);
    return context.json(success(context, { job }), 202);
  });

  app.post("/api/compositions/:jobId/cancel", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const job = await requireCompositionService(compositionService).cancel(
      context.req.param("jobId"),
      user.id,
    );
    if (!job)
      throw new DomainError("COMPOSITION_NOT_FOUND", "找不到成片任务", 404);
    return context.json(success(context, { job }), 202);
  });

  app.get("/api/projects/:projectId/composition-events", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const service = requireCompositionService(compositionService);
    const projectId = context.req.param("projectId");
    let cursor = Number(
      context.req.header("last-event-id") || context.req.query("after") || 0,
    );
    await service.events(projectId, user.id, cursor);
    return streamSSE(context, async (stream) => {
      while (!stream.aborted) {
        const events = await service.events(projectId, user.id, cursor);
        for (const event of events) {
          cursor = event.id;
          await stream.writeSSE({
            id: String(event.id),
            event: event.type,
            data: JSON.stringify(event),
          });
        }
        if (!events.length)
          await stream.writeSSE({
            event: "heartbeat",
            data: JSON.stringify({ at: new Date().toISOString() }),
          });
        await stream.sleep(events.length ? 50 : 1_000);
      }
    });
  });

  app.post("/api/projects/:projectId/assets/uploads", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const input = beginAssetUploadSchema.parse(await readJson(context.req.raw));
    const upload = await requireAssetService(assetService).beginUpload(
      context.req.param("projectId"),
      user.id,
      input,
    );
    return context.json(success(context, { upload }), 201);
  });

  app.post(
    "/api/projects/:projectId/assets/uploads/:uploadId/complete",
    async (context) => {
      const user = await requireUser(context.req.raw, repository, config);
      completeAssetUploadSchema.parse(await readJson(context.req.raw));
      const asset = await requireAssetService(assetService).completeUpload(
        context.req.param("projectId"),
        context.req.param("uploadId"),
        user.id,
      );
      if (!asset)
        throw new DomainError("PROJECT_FORBIDDEN", "无权访问该项目", 403);
      return context.json(success(context, { asset }));
    },
  );

  app.get("/api/asset-versions/:versionId/download", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const download = await requireAssetService(assetService).createDownloadUrl(
      context.req.param("versionId"),
      user.id,
    );
    if (!download)
      throw new DomainError("ASSET_VERSION_NOT_FOUND", "找不到该素材版本", 404);
    return context.json(success(context, download));
  });

  app.patch("/api/assets/:assetId/current-version", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const input = setCurrentVersionSchema.parse(
      await readJson(context.req.raw),
    );
    const asset = await requireAssetService(assetService).setCurrentVersion(
      context.req.param("assetId"),
      input.versionId,
      user.id,
    );
    if (!asset) throw new DomainError("ASSET_NOT_FOUND", "找不到该素材", 404);
    return context.json(success(context, { asset }));
  });

  app.post("/api/assets/:assetId/trash", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    const input = trashAssetSchema.parse(await readJson(context.req.raw));
    const asset = await requireAssetService(assetService).trash(
      context.req.param("assetId"),
      user.id,
      input.reason,
    );
    if (!asset) throw new DomainError("ASSET_NOT_FOUND", "找不到该素材", 404);
    return context.json(success(context, { asset }));
  });

  app.post("/api/assets/:assetId/restore", async (context) => {
    const user = await requireUser(context.req.raw, repository, config);
    completeAssetUploadSchema.parse(await readJson(context.req.raw));
    const asset = await requireAssetService(assetService).restore(
      context.req.param("assetId"),
      user.id,
    );
    if (!asset) throw new DomainError("ASSET_NOT_FOUND", "找不到该素材", 404);
    return context.json(success(context, { asset }));
  });

  app.notFound((context) =>
    apiError(context, new DomainError("NOT_FOUND", "接口不存在", 404)),
  );
  app.onError((error, context) => {
    if (error instanceof z.ZodError) {
      const fieldErrors = Object.fromEntries(
        error.issues.map((issue) => [
          issue.path.join(".") || "body",
          issue.message,
        ]),
      );
      return context.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "提交内容格式不正确",
            retryable: false,
            fieldErrors,
          },
          meta: { requestId: context.get("requestId") },
        },
        422,
      );
    }
    if (error instanceof SyntaxError)
      return apiError(
        context,
        new DomainError("INVALID_JSON", "请求内容不是有效 JSON", 400),
      );
    return apiError(
      context,
      error instanceof DomainError
        ? error
        : new DomainError("INTERNAL_ERROR", "服务暂时不可用", 500, true, {
            cause: error,
          }),
    );
  });

  return app;
}

function requireAssetService(service?: AssetServicePort) {
  if (!service)
    throw new DomainError(
      "ASSET_SERVICE_UNAVAILABLE",
      "素材服务暂时不可用",
      503,
      true,
    );
  return service;
}

function requireJobService(service?: JobService) {
  if (!service)
    throw new DomainError(
      "JOB_SERVICE_UNAVAILABLE",
      "任务服务暂时不可用",
      503,
      true,
    );
  return service;
}

function requireCompositionService(service?: CompositionService) {
  if (!service)
    throw new DomainError(
      "COMPOSITION_SERVICE_UNAVAILABLE",
      "成片服务暂时不可用",
      503,
      true,
    );
  return service;
}

function requireModelGateway(service?: ModelGateway) {
  if (!service)
    throw new DomainError(
      "MODEL_SERVICE_UNAVAILABLE",
      "模型目录暂时不可用",
      503,
      true,
    );
  return service;
}

function requireOperationsService(service?: OperationsServicePort) {
  if (!service)
    throw new DomainError(
      "OPERATIONS_SERVICE_UNAVAILABLE",
      "运营服务暂时不可用",
      503,
      true,
    );
  return service;
}

function requireTextWorkbenchService(service?: TextWorkbenchService) {
  if (!service)
    throw new DomainError(
      "TEXT_WORKBENCH_UNAVAILABLE",
      "文本工作台暂时不可用",
      503,
      true,
    );
  return service;
}

const emailSchema = z
  .string()
  .trim()
  .email("请输入有效邮箱")
  .max(254, "邮箱过长");
const passwordSchema = z
  .string()
  .min(passwordPolicy.minLength, `密码至少 ${passwordPolicy.minLength} 位`)
  .max(passwordPolicy.maxLength, `密码最多 ${passwordPolicy.maxLength} 位`);
const authInput = z
  .object({ email: emailSchema, password: passwordSchema })
  .strict();
const loginInput = z
  .object({
    email: emailSchema,
    password: z
      .string()
      .min(1, "请输入密码")
      .max(passwordPolicy.maxLength, "密码过长"),
  })
  .strict();
const projectName = z
  .string()
  .trim()
  .min(1, "请输入项目名称")
  .max(100, "项目名称最多 100 个字符");
const projectDescription = z
  .string()
  .trim()
  .max(1000, "项目说明最多 1000 个字符");
const projectCreateInput = z
  .object({ name: projectName, description: projectDescription.default("") })
  .strict();
const projectUpdateInput = z
  .object({
    name: projectName.optional(),
    description: projectDescription.optional(),
  })
  .strict()
  .refine(
    (input) => input.name !== undefined || input.description !== undefined,
    { message: "至少提交一个要修改的字段" },
  );
const positiveInteger = z.coerce.number().int().min(1);
const restoreInput = z
  .object({ expectedRevision: z.number().int().min(0) })
  .strict();
const migrationInput = z
  .object({ migrationKey: z.string().min(8).max(200) })
  .catchall(z.unknown());
const textWorkbenchMode = z.enum([
  "chat",
  "prompt",
  "script",
  "storyboard",
  "seedance",
]);
const textConversationCreateInput = z
  .object({
    title: z.string().trim().min(1).max(100).optional(),
    mode: textWorkbenchMode.default("chat"),
    modelId: z.string().trim().min(1).max(200),
  })
  .strict();
const textConversationUpdateInput = textConversationCreateInput
  .partial()
  .refine((input) => Object.keys(input).length > 0, {
    message: "至少提交一个要修改的字段",
  });
const textMessageGenerateInput = z
  .object({
    content: z.string().trim().min(1).max(100_000),
    modelId: z.string().trim().min(1).max(200),
    mode: textWorkbenchMode.default("chat"),
    reasoningEffort: z
      .enum(["none", "minimal", "low", "medium", "high", "xhigh"])
      .optional(),
  })
  .strict();

async function issueSession(
  context: Context<AppEnv>,
  repository: PlatformRepository,
  config: ApiConfig,
  userId: string,
) {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + config.sessionDays * 86_400_000);
  await repository.createSession(userId, hashSessionToken(token), expiresAt);
  setCookie(context, config.cookieName, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "Lax",
    path: "/",
    expires: expiresAt,
  });
  return expiresAt;
}

async function requireUser(
  request: Request,
  repository: PlatformRepository,
  config: ApiConfig,
) {
  const cookie = request.headers.get("cookie") || "";
  const token = readCookie(cookie, config.cookieName);
  if (!token) throw new DomainError("UNAUTHENTICATED", "请先登录", 401);
  const user = await repository.findUserBySession(
    hashSessionToken(token),
    new Date(),
  );
  if (!user)
    throw new DomainError("UNAUTHENTICATED", "登录已失效，请重新登录", 401);
  return user;
}

function readCookie(cookieHeader: string, name: string) {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function success<T>(context: Context<AppEnv>, data: T) {
  return { data, meta: { requestId: context.get("requestId") } };
}

function apiError(context: Context<AppEnv>, error: DomainError) {
  return context.json(
    {
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        ...(error.details ? { details: error.details } : {}),
      },
      meta: { requestId: context.get("requestId") },
    },
    error.status,
  );
}

function publicUser(
  user: PlatformUser & { passwordHash?: string },
): PlatformUser {
  return { id: user.id, email: user.email };
}

function isUnsafeMethod(method: string) {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function isTrustedRequest(request: Request, trustedOrigins: string[]) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  if (trustedOrigins.includes(origin)) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function readJson(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json"))
    throw new DomainError("UNSUPPORTED_MEDIA_TYPE", "请使用 JSON 提交", 415);
  return request.json();
}
