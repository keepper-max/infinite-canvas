import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { stat } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  assets,
  canvasEdges,
  canvasNodes,
  canvasSnapshots,
  generationJobs,
  modelConfigs,
  projectMembers,
  projects,
} from "@/db/schema";
import { db, pool } from "@/lib/db";
import { runChatModel } from "@/lib/model-runner";
import { getMockQueue } from "@/lib/queue";
import { recordJobEvent } from "@/lib/job-events";
import { deleteAsset, putAssetFile } from "@/lib/storage";
import {
  buildVibeCanvasBundle,
  buildVibeTextPrompt,
  resolveAllowedImportPath,
  VIBE_MODEL_API_KEY_ENV,
  VIBE_MODEL_BASE_URL,
  VIBE_MODEL_ID,
  VIBE_MODEL_NAME,
  VIBE_PROJECT_DESCRIPTION,
  VIBE_PROJECT_NAME,
  type VibeStoryboardInput,
} from "@/lib/vibe-video";

const projectAllowlist = new Set(
  (process.env.SHOUSHOU_MCP_PROJECT_IDS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);

const importRoots = (process.env.SHOUSHOU_MCP_IMPORT_ROOTS ?? "H:\\CodexStorage")
  .split(";")
  .map((item) => item.trim())
  .filter(Boolean);

let resolvedUserId: string | undefined;

async function getMcpUserId() {
  if (resolvedUserId) return resolvedUserId;
  const configuredId = process.env.SHOUSHOU_MCP_USER_ID?.trim();
  const configuredAccount = process.env.SHOUSHOU_MCP_ACCOUNT?.trim();
  if (!configuredId && !configuredAccount) {
    throw new Error("请在 .env 配置 SHOUSHOU_MCP_USER_ID 或 SHOUSHOU_MCP_ACCOUNT");
  }
  const selector = configuredId ? "id::text = $1" : "(email = $1 or phone = $1)";
  const { rows } = await pool.query<{ id: string; accountStatus: string }>(
    `select id::text as id, coalesce(to_jsonb(users)->>'status', to_jsonb(users)->>'account_status', 'active') as "accountStatus" from users where ${selector} limit 1`,
    [configuredId ?? configuredAccount],
  );
  const user = rows[0];
  if (!user || user.accountStatus !== "active") throw new Error("守守画布 MCP 身份不存在或已停用");
  resolvedUserId = user.id;
  return user.id;
}

async function requireProject(projectId: string, write = false) {
  if (projectAllowlist.size > 0 && !projectAllowlist.has(projectId)) {
    throw new Error("该项目不在 SHOUSHOU_MCP_PROJECT_IDS 白名单内");
  }
  const userId = await getMcpUserId();
  const [project] = await db
    .select({ id: projects.id, name: projects.name, ownerId: projects.ownerId, role: projectMembers.role })
    .from(projects)
    .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(and(eq(projects.id, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  if (!project) throw new Error("项目不存在或 MCP 身份无权访问");
  if (write && project.role === "viewer") throw new Error("只读成员不能修改项目");
  return project;
}

async function snapshotCanvas(projectId: string) {
  const [nodes, edges, latest] = await Promise.all([
    db.select().from(canvasNodes).where(eq(canvasNodes.projectId, projectId)),
    db.select().from(canvasEdges).where(eq(canvasEdges.projectId, projectId)),
    db
      .select({ version: canvasSnapshots.version })
      .from(canvasSnapshots)
      .where(eq(canvasSnapshots.projectId, projectId))
      .orderBy(desc(canvasSnapshots.version))
      .limit(1),
  ]);
  const version = (latest[0]?.version ?? 0) + 1;
  await db.insert(canvasSnapshots).values({
    projectId,
    version,
    nodes: nodes.map((item) => ({
      id: item.id,
      type: item.nodeType,
      position: item.position,
      data: item.data,
    })),
    edges: edges.map((item) => ({
      id: item.id,
      source: item.sourceNodeId,
      target: item.targetNodeId,
      label: item.edgeType,
      data: item.data,
    })),
  });
  return version;
}

function result(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

const server = new McpServer(
  { name: "shoushou-canvas", version: "0.2.0" },
  {
    instructions:
      "守守画布的私有 Vibe 视频工具。先 ensure_vibe_project，再 get_project_context；可通过 generate_vibe_text 调用项目专用 Claude Opus 5.5，确认脚本与分镜后再创建画布节点；在允许目录完成本机渲染，最后用 import_rendered_video 登记成片。所有调用都受项目成员权限和可选项目白名单约束。",
    maxToolInputElements: 500,
  },
);

server.registerTool(
  "ensure_vibe_project",
  {
    title: "创建或取得 Vibe 视频专用项目",
    description:
      "为当前 MCP 身份幂等创建独立的 Vibe 知识视频管理项目，并配置只引用服务器环境变量的 Claude Opus 5.5 文字模型。不会保存明文密钥。",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async () => {
    const userId = await getMcpUserId();
    let [project] = await db
      .select({ id: projects.id, name: projects.name, description: projects.description, ownerId: projects.ownerId })
      .from(projects)
      .where(and(eq(projects.ownerId, userId), eq(projects.name, VIBE_PROJECT_NAME)))
      .orderBy(desc(projects.updatedAt))
      .limit(1);
    if (projectAllowlist.size > 0 && (!project || !projectAllowlist.has(project.id))) {
      throw new Error("Vibe 专用项目不在 SHOUSHOU_MCP_PROJECT_IDS 白名单内");
    }
    let created = false;
    if (!project) {
      project = await db.transaction(async (tx) => {
        const [newProject] = await tx
          .insert(projects)
          .values({ ownerId: userId, name: VIBE_PROJECT_NAME, description: VIBE_PROJECT_DESCRIPTION })
          .returning({ id: projects.id, name: projects.name, description: projects.description, ownerId: projects.ownerId });
        await tx.insert(projectMembers).values({ projectId: newProject.id, userId, role: "owner" });
        return newProject;
      });
      created = true;
    }
    const [existingModel] = await db
      .select()
      .from(modelConfigs)
      .where(
        and(
          eq(modelConfigs.projectId, project.id),
          eq(modelConfigs.model, VIBE_MODEL_ID),
          eq(modelConfigs.baseUrl, VIBE_MODEL_BASE_URL),
          eq(modelConfigs.apiKeyEnv, VIBE_MODEL_API_KEY_ENV),
          eq(modelConfigs.enabled, 1),
        ),
      )
      .orderBy(desc(modelConfigs.updatedAt))
      .limit(1);
    const model =
      existingModel ??
      (
        await db
          .insert(modelConfigs)
          .values({
            projectId: project.id,
            name: VIBE_MODEL_NAME,
            baseUrl: VIBE_MODEL_BASE_URL,
            model: VIBE_MODEL_ID,
            apiKeyEnv: VIBE_MODEL_API_KEY_ENV,
            script: "Vibe 知识视频文字策划、脚本、分镜与 Canvas 代码生成",
          })
          .returning()
      )[0];
    return result({
      project: { id: project.id, name: project.name, description: project.description },
      created,
      model: { id: model.id, name: model.name, model: model.model, enabled: model.enabled },
      secretStorage: "server_environment_reference",
    });
  },
);

server.registerTool(
  "generate_vibe_text",
  {
    title: "通过守守画布调用 Opus 5.5",
    description:
      "使用 Vibe 专用项目中配置的 Claude Opus 5.5 生成 Brief、脚本、分镜、Canvas 代码或修订稿。它是文字模型调用，不负责渲染 MP4。",
    inputSchema: {
      projectId: z.string().uuid(),
      stage: z.enum(["brief", "script", "storyboard", "canvas_code", "revision"]),
      instructions: z.string().min(1).max(20000),
      context: z.string().max(50000).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  async ({ projectId, stage, instructions, context }) => {
    await requireProject(projectId, true);
    const [config] = await db
      .select()
      .from(modelConfigs)
      .where(
        and(
          eq(modelConfigs.projectId, projectId),
          eq(modelConfigs.model, VIBE_MODEL_ID),
          eq(modelConfigs.baseUrl, VIBE_MODEL_BASE_URL),
          eq(modelConfigs.apiKeyEnv, VIBE_MODEL_API_KEY_ENV),
          eq(modelConfigs.enabled, 1),
        ),
      )
      .orderBy(desc(modelConfigs.updatedAt))
      .limit(1);
    if (!config) throw new Error("Vibe 项目尚未配置 Claude Opus 5.5，请先调用 ensure_vibe_project");
    const prompt = buildVibeTextPrompt(stage, instructions, context);
    const generated = await runChatModel(config, prompt, {
      systemPrompt:
        "你是 Vibe 知识大赏视频的资深导演、研究编辑和 Canvas 动画工程师。严格区分已核验事实、创作表达和待确认内容，遵循用户给出的资料与当前制作阶段。",
      temperature: null,
      maxCompletionTokens: stage === "canvas_code" ? 16000 : 8000,
    });
    if (!generated.configured) throw new Error(generated.text);
    return result({ projectId, stage, provider: config.name, model: config.model, text: generated.text });
  },
);

server.registerTool(
  "list_projects",
  {
    title: "列出可访问的守守画布项目",
    description: "在读取或修改画布前，用它找到当前 MCP 身份可访问的项目。",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async () => {
    const userId = await getMcpUserId();
    const rows = await db
      .select({ id: projects.id, name: projects.name, description: projects.description, role: projectMembers.role, updatedAt: projects.updatedAt })
      .from(projects)
      .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
      .where(eq(projectMembers.userId, userId))
      .orderBy(desc(projects.updatedAt));
    const filtered = projectAllowlist.size > 0 ? rows.filter((item) => projectAllowlist.has(item.id)) : rows;
    return result({ projects: filtered });
  },
);

server.registerTool(
  "get_project_context",
  {
    title: "读取守守画布项目上下文",
    description: "读取项目的画布节点、连线和最近任务，为脚本、分镜和续作提供上下文。",
    inputSchema: { projectId: z.string().uuid() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ projectId }) => {
    const project = await requireProject(projectId);
    const [nodes, edges, jobs] = await Promise.all([
      db.select().from(canvasNodes).where(eq(canvasNodes.projectId, projectId)),
      db.select().from(canvasEdges).where(eq(canvasEdges.projectId, projectId)),
      db.select().from(generationJobs).where(eq(generationJobs.projectId, projectId)).orderBy(desc(generationJobs.createdAt)).limit(20),
    ]);
    return result({ project, nodes, edges, jobs });
  },
);

const sceneSchema = z.object({
  title: z.string().min(1).max(120),
  narration: z.string().min(1).max(2000),
  visual: z.string().min(1).max(3000),
  onScreenText: z.string().max(500).optional(),
  durationSeconds: z.number().positive().max(60),
});

server.registerTool(
  "create_vibe_storyboard",
  {
    title: "创建 Vibe 知识视频分镜",
    description: "把已经确认的脚本和分镜新增到守守画布；每次调用创建独立版本，不覆盖既有节点。",
    inputSchema: {
      projectId: z.string().uuid(),
      title: z.string().min(1).max(160),
      summary: z.string().min(1).max(5000),
      aspectRatio: z.enum(["9:16", "16:9", "1:1"]),
      style: z.string().max(1000).optional(),
      scenes: z.array(sceneSchema).min(1).max(30),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ projectId, title, summary, aspectRatio, style, scenes }) => {
    await requireProject(projectId, true);
    const storyboardId = randomUUID();
    const bundle = buildVibeCanvasBundle(projectId, storyboardId, {
      title,
      summary,
      aspectRatio,
      style,
      scenes,
    } satisfies VibeStoryboardInput);
    await db.transaction(async (tx) => {
      await tx.insert(canvasNodes).values(bundle.nodes);
      await tx.insert(canvasEdges).values(bundle.edges);
      await tx.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
    });
    const version = await snapshotCanvas(projectId);
    return result({
      storyboardId,
      outputNodeId: bundle.outputId,
      canvasVersion: version,
      sceneCount: scenes.length,
      totalDurationSeconds: scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0),
    });
  },
);

server.registerTool(
  "queue_vibe_preview",
  {
    title: "提交 Vibe 分镜预览任务",
    description: "把指定 Vibe 分镜的场景节点提交到现有守守画布队列。当前生成的是流程预览，不等同于最终 MP4。",
    inputSchema: { projectId: z.string().uuid(), storyboardId: z.string().uuid() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ projectId, storyboardId }) => {
    await requireProject(projectId, true);
    const rows = await db.select().from(canvasNodes).where(eq(canvasNodes.projectId, projectId));
    const sceneNodes = rows.filter((node) => {
      const data = node.data as { source?: string; storyboardId?: string };
      return data.source === "codex-vibe" && data.storyboardId === storyboardId && node.nodeType === "scene";
    });
    if (sceneNodes.length === 0) throw new Error("未找到该 Vibe 分镜的场景节点");
    const existing = await db
      .select({ nodeId: generationJobs.nodeId })
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.projectId, projectId),
          inArray(generationJobs.nodeId, sceneNodes.map((node) => node.id)),
          inArray(generationJobs.status, ["pending", "running"]),
        ),
      );
    const activeIds = new Set(existing.map((item) => item.nodeId));
    const queue = getMockQueue();
    const jobs = [];
    for (const node of sceneNodes) {
      if (activeIds.has(node.id)) continue;
      const data = node.data as { narration?: string; visual?: string; durationSeconds?: number };
      const [job] = await db
        .insert(generationJobs)
        .values({
          projectId,
          nodeId: node.id,
          provider: "mock",
          modelId: "vibe-preview",
          mode: "vibe-preview",
          prompt: data.visual ?? "",
          input: { node, storyboardId, narration: data.narration ?? "" },
          parameters: { durationSeconds: data.durationSeconds ?? 5 },
        })
        .returning();
      await recordJobEvent({ jobId: job.id, projectId, status: "pending", progress: 0, message: `Vibe 预览已排队：${node.label}` });
      await queue.add("mock-generation", { jobId: job.id, projectId, nodeId: node.id }, { jobId: job.id, removeOnComplete: 100, removeOnFail: 100 });
      jobs.push(job);
    }
    return result({ storyboardId, queued: jobs.length, jobs });
  },
);

server.registerTool(
  "get_vibe_status",
  {
    title: "查询 Vibe 视频任务状态",
    description: "查询指定分镜的节点状态和最近任务，不修改数据。",
    inputSchema: { projectId: z.string().uuid(), storyboardId: z.string().uuid() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ projectId, storyboardId }) => {
    await requireProject(projectId);
    const nodes = (await db.select().from(canvasNodes).where(eq(canvasNodes.projectId, projectId))).filter(
      (node) => (node.data as { storyboardId?: string }).storyboardId === storyboardId,
    );
    const jobs = nodes.length
      ? await db
          .select()
          .from(generationJobs)
          .where(and(eq(generationJobs.projectId, projectId), inArray(generationJobs.nodeId, nodes.map((node) => node.id))))
          .orderBy(desc(generationJobs.createdAt))
      : [];
    return result({ storyboardId, nodes, jobs });
  },
);

server.registerTool(
  "import_rendered_video",
  {
    title: "把渲染完成的视频导入守守画布",
    description: "从允许的本地目录读取 MP4、WebM 或 MOV，上传到守守画布资产库并更新该分镜的成片节点。",
    inputSchema: {
      projectId: z.string().uuid(),
      storyboardId: z.string().uuid(),
      filePath: z.string().min(1),
      title: z.string().min(1).max(160),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ projectId, storyboardId, filePath, title }) => {
    await requireProject(projectId, true);
    const projectNodes = await db.select().from(canvasNodes).where(eq(canvasNodes.projectId, projectId));
    const outputNode = projectNodes.find((node) => {
      const data = node.data as { storyboardId?: string; source?: string };
      return data.storyboardId === storyboardId && data.source === "codex-vibe" && node.nodeType === "output";
    });
    if (!outputNode) throw new Error("未找到该分镜的成片节点");
    const target = resolveAllowedImportPath(filePath, importRoots);
    const file = await stat(target);
    const maxBytes = Number(process.env.SHOUSHOU_MCP_MAX_IMPORT_BYTES ?? 1024 * 1024 * 1024);
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error("SHOUSHOU_MCP_MAX_IMPORT_BYTES 配置无效");
    if (!file.isFile()) throw new Error("成片路径不是文件");
    if (file.size > maxBytes) throw new Error("成片超过 SHOUSHOU_MCP_MAX_IMPORT_BYTES 限制");
    const extension = extname(target).toLowerCase();
    const mimeTypes: Record<string, string> = { ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime" };
    const mimeType = mimeTypes[extension];
    if (!mimeType) throw new Error("仅支持 MP4、WebM 或 MOV 成片");
    const assetId = randomUUID();
    const objectKey = `projects/${projectId}/vibe/${assetId}${extension}`;
    await putAssetFile(objectKey, target, mimeType);
    let asset: typeof assets.$inferSelect;
    try {
      asset = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(assets)
          .values({
            id: assetId,
            projectId,
            kind: "video",
            name: `${title}${extension}`,
            objectKey,
            uri: `/api/assets/${assetId}/content`,
            mimeType,
            size: file.size,
            metadata: { source: "codex-vibe", storyboardId },
          })
          .returning();
        await tx
          .update(canvasNodes)
          .set({
            status: "completed",
            data: { ...(outputNode.data as object), status: "completed", output: created.uri, assetId },
            updatedAt: new Date(),
          })
          .where(and(eq(canvasNodes.projectId, projectId), eq(canvasNodes.id, outputNode.id)));
        return created;
      });
    } catch (error) {
      await deleteAsset(objectKey).catch(() => undefined);
      throw error;
    }
    const version = await snapshotCanvas(projectId);
    return result({ asset, outputNodeId: outputNode.id, canvasVersion: version });
  },
);

const shutdown = async () => {
  await server.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[shoushou-mcp] ready on stdio");
}

main().catch((error) => {
  console.error("[shoushou-mcp] server failed", error);
  process.exit(1);
});
