import { createHash, randomUUID } from "node:crypto";
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
let vibeTextJobsReady: Promise<void> | undefined;

const VIBE_TEXT_JOB_TABLE = "shoushou_mcp_text_jobs";

type VibeTextJobRow = {
  id: string;
  project_id: string;
  created_by: string;
  model_config_id: string;
  stage: "brief" | "script" | "storyboard" | "canvas_code" | "revision";
  instructions: string;
  context: string | null;
  status: "pending" | "running" | "completed" | "failed";
  output_text: string | null;
  error_reason: string | null;
  created_at: Date;
  updated_at: Date;
  finished_at: Date | null;
};

type VibeModelConfig = typeof modelConfigs.$inferSelect;

function ensureVibeTextJobsTable() {
  vibeTextJobsReady ??= pool
    .query(`
      create table if not exists ${VIBE_TEXT_JOB_TABLE} (
        id uuid primary key,
        project_id uuid not null,
        created_by uuid not null,
        model_config_id uuid not null,
        stage text not null,
        request_key text not null,
        instructions text not null,
        context text,
        status text not null default 'pending',
        output_text text,
        error_reason text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        finished_at timestamptz,
        unique(project_id, created_by, request_key)
      )
    `)
    .then(() => undefined);
  return vibeTextJobsReady;
}

async function vibeTextJobsTableExists() {
  const response = await pool.query<{ exists: boolean }>(
    "select to_regclass($1) is not null as exists",
    [`public.${VIBE_TEXT_JOB_TABLE}`],
  );
  return response.rows[0]?.exists === true;
}

function serializeVibeTextJob(row: VibeTextJobRow, includeText = false) {
  return {
    id: row.id,
    projectId: row.project_id,
    stage: row.stage,
    status: row.status,
    ...(includeText && row.status === "completed" ? { text: row.output_text ?? "" } : {}),
    error: row.status === "failed" ? row.error_reason : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

async function executeVibeTextJob(jobId: string) {
  const client = await pool.connect();
  let locked = false;
  try {
    const lockResult = await client.query<{ acquired: boolean }>(
      "select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired",
      [`shoushou-vibe-text:${jobId}`],
    );
    if (!lockResult.rows[0]?.acquired) return;
    locked = true;
    const current = await client.query<VibeTextJobRow>(
      `select * from ${VIBE_TEXT_JOB_TABLE}
        where id=$1 and status in ('pending','running')
        limit 1`,
      [jobId],
    );
    let job = current.rows[0];
    if (!job) return;
    const claimed = await client.query<VibeTextJobRow>(
      `update ${VIBE_TEXT_JOB_TABLE}
          set status='running', error_reason=null, updated_at=now(), finished_at=null
        where id=$1
        returning *`,
      [jobId],
    );
    job = claimed.rows[0];
    try {
      const configResult = await client.query<VibeModelConfig>(
        `select id, project_id as "projectId", name, base_url as "baseUrl",
                model, script, api_key_env as "apiKeyEnv", enabled,
                updated_at as "updatedAt"
           from model_configs
          where id=$1
          limit 1`,
        [job.model_config_id],
      );
      const config = configResult.rows[0];
      if (!config || config.enabled !== 1) throw new Error("Vibe 文字模型已停用或不存在");
      const prompt = buildVibeTextPrompt(job.stage, job.instructions, job.context ?? undefined);
      const generated = await runChatModel(config, prompt, {
        systemPrompt:
          "你是 Vibe 知识大赏视频的资深导演、研究编辑和 Canvas 动画工程师。严格区分已核验事实、创作表达和待确认内容，遵循用户给出的资料与当前制作阶段。",
        temperature: null,
        maxCompletionTokens: job.stage === "canvas_code" ? 16000 : 8000,
      });
      if (!generated.configured) throw new Error(generated.text);
      await client.query(
        `update ${VIBE_TEXT_JOB_TABLE}
            set status='completed', output_text=$2, error_reason=null,
                updated_at=now(), finished_at=now()
          where id=$1 and status='running'`,
        [jobId, generated.text],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "文字生成失败";
      await client.query(
        `update ${VIBE_TEXT_JOB_TABLE}
            set status='failed', error_reason=$2, updated_at=now(), finished_at=now()
          where id=$1 and status='running'`,
        [jobId, message.slice(0, 2000)],
      );
    }
  } finally {
    if (locked) {
      await client
        .query("select pg_advisory_unlock(hashtextextended($1, 0))", [
          `shoushou-vibe-text:${jobId}`,
        ])
        .catch(() => undefined);
    }
    client.release();
  }
}

function startVibeTextJob(jobId: string) {
  queueMicrotask(() => {
    void executeVibeTextJob(jobId).catch((error) =>
      console.error(
        `[shoushou-mcp] vibe text job ${jobId} failed to start:`,
        error instanceof Error ? error.message : "unknown error",
      ),
    );
  });
}

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
  { name: "shoushou-canvas", version: "0.3.0" },
  {
    instructions:
      "守守画布的私有 Vibe 视频工具。先 ensure_vibe_project，再 get_project_context；generate_vibe_text 会快速返回任务号，随后用 get_vibe_text_status 查询 Claude Opus 5.5 结果。确认脚本与分镜后再创建画布节点；在允许目录完成本机渲染，最后用 import_rendered_video 登记成片。所有调用都受项目成员权限和可选项目白名单约束。",
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
    title: "提交 Opus 5.5 文字生成任务",
    description:
      "异步提交 Claude Opus 5.5 文字任务并立即返回任务号；用 get_vibe_text_status 查询结果。相同项目、阶段、指令和上下文会复用原任务，避免超时重试造成重复计费。",
    inputSchema: {
      projectId: z.string().uuid(),
      stage: z.enum(["brief", "script", "storyboard", "canvas_code", "revision"]),
      instructions: z.string().min(1).max(20000),
      context: z.string().max(50000).optional(),
      retryFailed: z.boolean().optional().default(false),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  async ({ projectId, stage, instructions, context, retryFailed }) => {
    const project = await requireProject(projectId, true);
    const userId = await getMcpUserId();
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
    await ensureVibeTextJobsTable();
    const requestKey = createHash("sha256")
      .update(JSON.stringify({ userId, projectId, stage, instructions, context: context ?? "" }))
      .digest("hex");
    const id = randomUUID();
    const inserted = await pool.query<VibeTextJobRow>(
      `insert into ${VIBE_TEXT_JOB_TABLE}
         (id, project_id, created_by, model_config_id, stage, request_key, instructions, context)
       values($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict(project_id, created_by, request_key) do nothing
       returning *`,
      [id, projectId, userId, config.id, stage, requestKey, instructions, context ?? null],
    );
    let job = inserted.rows[0];
    let reused = false;
    if (!job) {
      reused = true;
      const existing = await pool.query<VibeTextJobRow>(
        `select * from ${VIBE_TEXT_JOB_TABLE}
          where project_id=$1 and request_key=$2 and created_by=$3
          limit 1`,
        [projectId, requestKey, userId],
      );
      job = existing.rows[0];
    }
    if (!job) throw new Error("文字任务创建失败，请稍后重试");
    if (job.status === "failed" && retryFailed) {
      const retried = await pool.query<VibeTextJobRow>(
        `update ${VIBE_TEXT_JOB_TABLE}
            set status='pending', output_text=null, error_reason=null,
                updated_at=now(), finished_at=null
          where id=$1 and created_by=$2 and status='failed'
          returning *`,
        [job.id, userId],
      );
      job = retried.rows[0] ?? job;
    }
    if (job.status === "pending" || job.status === "running") startVibeTextJob(job.id);
    return result({
      project: { id: project.id, name: project.name },
      provider: config.name,
      model: config.model,
      job: serializeVibeTextJob(job, true),
      reused,
      next:
        job.status === "completed"
          ? "结果已返回"
          : job.status === "failed"
            ? "任务失败；确认上游未产生有效结果后，将 retryFailed 设为 true 再提交同一请求"
            : "调用 get_vibe_text_status 查询任务结果",
    });
  },
);

server.registerTool(
  "get_vibe_text_status",
  {
    title: "查询 Opus 5.5 文字任务",
    description: "按任务号查询 Vibe 文字任务；完成后返回完整文本，失败时返回可读错误。",
    inputSchema: { projectId: z.string().uuid(), jobId: z.string().uuid() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ projectId, jobId }) => {
    await requireProject(projectId);
    const userId = await getMcpUserId();
    if (!(await vibeTextJobsTableExists())) throw new Error("文字任务不存在或无权访问");
    const response = await pool.query<VibeTextJobRow>(
      `select * from ${VIBE_TEXT_JOB_TABLE}
        where id=$1 and project_id=$2 and created_by=$3
        limit 1`,
      [jobId, projectId, userId],
    );
    const job = response.rows[0];
    if (!job) throw new Error("文字任务不存在或无权访问");
    return result({
      job: serializeVibeTextJob(job, true),
      done: job.status === "completed" || job.status === "failed",
    });
  },
);

server.registerTool(
  "list_vibe_text_jobs",
  {
    title: "列出 Vibe 文字生成记录",
    description: "列出项目最近的文字生成记录，便于找回长任务；列表不返回大段正文。",
    inputSchema: { projectId: z.string().uuid() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ projectId }) => {
    await requireProject(projectId);
    const userId = await getMcpUserId();
    if (!(await vibeTextJobsTableExists())) return result({ jobs: [] });
    const response = await pool.query<VibeTextJobRow>(
      `select * from ${VIBE_TEXT_JOB_TABLE}
        where project_id=$1 and created_by=$2
        order by created_at desc
        limit 50`,
      [projectId, userId],
    );
    return result({ jobs: response.rows.map((job) => serializeVibeTextJob(job)) });
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
    const [nodes, edges, jobsResult] = await Promise.all([
      db.select().from(canvasNodes).where(eq(canvasNodes.projectId, projectId)),
      db.select().from(canvasEdges).where(eq(canvasEdges.projectId, projectId)),
      pool.query(
        `select id::text as id,
                coalesce(to_jsonb(j)->>'node_id', to_jsonb(j)->>'node_key') as "nodeId",
                provider, model_id as "modelId", mode, status, progress,
                coalesce(to_jsonb(j)->>'error_reason', to_jsonb(j)->>'user_error_message') as error,
                created_at as "createdAt", updated_at as "updatedAt"
           from generation_jobs j
          where project_id=$1
          order by created_at desc
          limit 20`,
        [projectId],
      ),
    ]);
    return result({ project, nodes, edges, jobs: jobsResult.rows });
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
