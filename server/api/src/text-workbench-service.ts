import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

import { DomainError } from "./domain.js";
import type { JobService } from "./job-service.js";
import { assertProjectAccess } from "./project-access.js";

export type TextWorkbenchMode =
  "chat" | "prompt" | "script" | "storyboard" | "seedance";

type CreateConversationInput = {
  title?: string;
  mode: TextWorkbenchMode;
  modelId: string;
};
type GenerateMessageInput = {
  content: string;
  modelId: string;
  mode: TextWorkbenchMode;
  reasoningEffort?: string;
};

const MODE_INSTRUCTIONS: Record<TextWorkbenchMode, string> = {
  chat: "你是一名可靠、直接的中文 AI 助手。根据上下文回答用户问题；信息不足时明确指出，不要编造。",
  prompt:
    "你是一名提示词设计师。把用户目标整理成可直接使用、结构清晰、约束明确的高质量提示词，并保留用户真正需要的细节。",
  script:
    "你是一名短剧编剧。围绕冲突、人物动机、节奏和可拍摄性输出剧本；需要时使用场次、动作和对白结构。",
  storyboard:
    "你是一名分镜导演。把内容拆成可执行镜头，明确景别、机位、人物动作、环境、运镜、时长与镜头衔接。",
  seedance:
    "你是一名 Seedance 漫剧提示词导演。输出可直接用于视频生成的提示词，重点约束角色一致性、动作节奏、镜头运动、场景连续性、光线、声音与负面约束；不要堆砌空泛画质词。",
};

export class TextWorkbenchService {
  constructor(
    private readonly pool: Pool,
    private readonly jobs: JobService,
  ) {}

  async list(projectId: string, userId: string) {
    await assertProjectAccess(this.pool, projectId, userId);
    const result = await this.pool.query(
      `select c.*,
        (select content from text_messages where conversation_id=c.id order by created_at desc limit 1) as preview,
        (select count(*)::int from text_messages where conversation_id=c.id) as message_count
       from text_conversations c
       where c.project_id=$1 and c.created_by=$2 and c.archived_at is null
       order by c.updated_at desc`,
      [projectId, userId],
    );
    return result.rows.map(serializeConversation);
  }

  async create(
    projectId: string,
    userId: string,
    input: CreateConversationInput,
  ) {
    await assertProjectAccess(this.pool, projectId, userId, "edit");
    const result = await this.pool.query(
      `insert into text_conversations(project_id,created_by,title,mode,model_id)
       values($1,$2,$3,$4,$5) returning *`,
      [
        projectId,
        userId,
        input.title?.trim() || "新对话",
        input.mode,
        input.modelId,
      ],
    );
    return serializeConversation(result.rows[0]);
  }

  async update(
    conversationId: string,
    userId: string,
    input: Partial<CreateConversationInput>,
  ) {
    const conversation = await this.requireConversation(
      conversationId,
      userId,
      true,
    );
    const result = await this.pool.query(
      `update text_conversations set
        title=coalesce($2,title), mode=coalesce($3,mode), model_id=coalesce($4,model_id), updated_at=now()
       where id=$1 returning *`,
      [
        conversationId,
        input.title?.trim() || null,
        input.mode || null,
        input.modelId || null,
      ],
    );
    return serializeConversation(result.rows[0]);
  }

  async archive(conversationId: string, userId: string) {
    await this.requireConversation(conversationId, userId, true);
    await this.pool.query(
      "update text_conversations set archived_at=now(),updated_at=now() where id=$1",
      [conversationId],
    );
    return { archivedConversationId: conversationId };
  }

  async messages(conversationId: string, userId: string) {
    await this.requireConversation(conversationId, userId);
    await this.reconcileMessages(conversationId);
    const result = await this.pool.query(
      "select * from text_messages where conversation_id=$1 order by created_at asc",
      [conversationId],
    );
    return result.rows.map(serializeMessage);
  }

  async generate(
    conversationId: string,
    userId: string,
    input: GenerateMessageInput,
  ) {
    const conversation = await this.requireConversation(
      conversationId,
      userId,
      true,
    );
    const client = await this.pool.connect();
    const userMessageId = randomUUID();
    const assistantMessageId = randomUUID();
    try {
      await client.query("begin");
      await client.query(
        "insert into text_messages(id,conversation_id,role,content,status,model_id,mode) values($1,$3,'user',$4,'completed',null,$6),($2,$3,'assistant','','pending',$5,$6)",
        [
          userMessageId,
          assistantMessageId,
          conversationId,
          input.content.trim(),
          input.modelId,
          input.mode,
        ],
      );
      await client.query(
        `update text_conversations set
          title=case when not exists(select 1 from text_messages where conversation_id=$1 and id<>$2 and role='user') then $3 else title end,
          mode=$4, model_id=$5, updated_at=now() where id=$1`,
        [
          conversationId,
          userMessageId,
          titleFrom(input.content),
          input.mode,
          input.modelId,
        ],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    const history = await this.pool.query(
      "select role,content from text_messages where conversation_id=$1 and status='completed' order by created_at desc limit 30",
      [conversationId],
    );
    const prompt = compilePrompt(input.mode, history.rows.reverse());
    try {
      const job = await this.jobs.create(
        String(conversation.project_id),
        userId,
        {
          nodeRevision: 0,
          modelId: input.modelId,
          capability: "text",
          mode: "chat",
          prompt,
          parameters: input.reasoningEffort
            ? { reasoningEffort: input.reasoningEffort }
            : {},
          references: [],
          trace: {
            workflowKind: `text-workbench:${input.mode}`,
            inputSnapshot: { conversationId, assistantMessageId },
          },
          idempotencyKey: `text:${conversationId}:${assistantMessageId}`,
        },
      );
      await this.pool.query(
        "update text_messages set generation_job_id=$2,updated_at=now() where id=$1",
        [assistantMessageId, job.id],
      );
      return { userMessageId, assistantMessageId, job };
    } catch (error) {
      await this.pool.query(
        "update text_messages set status='failed',error_message=$2,updated_at=now() where id=$1",
        [
          assistantMessageId,
          error instanceof Error ? error.message : "任务提交失败",
        ],
      );
      throw error;
    }
  }

  private async requireConversation(
    conversationId: string,
    userId: string,
    edit = false,
  ) {
    const result = await this.pool.query(
      "select * from text_conversations where id=$1 and created_by=$2 and archived_at is null",
      [conversationId, userId],
    );
    const conversation = result.rows[0];
    if (!conversation)
      throw new DomainError("TEXT_CONVERSATION_NOT_FOUND", "找不到该对话", 404);
    await assertProjectAccess(
      this.pool,
      conversation.project_id,
      userId,
      edit ? "edit" : "read",
    );
    return conversation;
  }

  private async reconcileMessages(conversationId: string) {
    const result = await this.pool.query(
      `select m.id,j.status,j.user_error_message,
        (select metadata->>'text' from job_artifacts where job_id=j.id order by sort_order limit 1) as output_text
       from text_messages m join generation_jobs j on j.id=m.generation_job_id
       where m.conversation_id=$1 and m.role='assistant' and m.status in ('pending','failed')`,
      [conversationId],
    );
    for (const row of result.rows) {
      const next = messageStatusFromJob(row.status);
      if (!next) continue;
      await this.pool.query(
        "update text_messages set status=$2,content=coalesce(nullif($3,''),content),error_message=$4,updated_at=now() where id=$1",
        [
          row.id,
          next,
          row.output_text || "",
          next === "failed" ? row.user_error_message || "生成失败" : null,
        ],
      );
    }
  }
}

function compilePrompt(
  mode: TextWorkbenchMode,
  messages: Array<{ role: string; content: string }>,
) {
  const transcript = messages
    .map(
      (message) =>
        `${message.role === "assistant" ? "助手" : "用户"}：${message.content}`,
    )
    .join("\n\n");
  const prefix = `${MODE_INSTRUCTIONS[mode]}\n\n以下是对话记录，请直接继续回应最后一条用户消息：\n\n`;
  return `${prefix}${transcript.slice(-(120_000 - prefix.length))}`;
}

function messageStatusFromJob(
  status: string,
): "pending" | "completed" | "failed" | "cancelled" | null {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (
    [
      "pending",
      "queued",
      "submitting",
      "retrying",
      "running",
      "downloading",
      "persisting",
      "cancel_requested",
    ].includes(status)
  )
    return "pending";
  return null;
}

function titleFrom(content: string) {
  const title = content.trim().replace(/\s+/g, " ").slice(0, 28);
  return title || "新对话";
}

function serializeConversation(row: Record<string, any>) {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    mode: row.mode,
    modelId: row.model_id,
    preview: row.preview || "",
    messageCount: Number(row.message_count || 0),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function serializeMessage(row: Record<string, any>) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    status: row.status,
    jobId: row.generation_job_id || undefined,
    modelId: row.model_id || undefined,
    mode: row.mode || undefined,
    error: row.error_message || undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
