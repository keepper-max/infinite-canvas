import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import type { JobConfig } from "./config.js";
import type { BillingService } from "./billing-service.js";
import { DomainError } from "./domain.js";
import type { CreateJobInput } from "./job-contract.js";
import { ModelGateway, type GenerationInput } from "./model-gateway.js";
import type { ObjectStorage } from "./object-storage.js";
import { assertProjectAccess } from "./project-access.js";
import {
  ProviderError,
  providerUserMessage,
  type GenerationProvider,
  type ProviderArtifact,
} from "./provider.js";
import { ProviderRouter } from "./provider-router.js";

export type JobQueuePort = {
  add(jobId: string, maxAttempts: number): Promise<void>;
  remove(jobId: string): Promise<boolean>;
};
export type JobEventPublisher = (projectId: string) => Promise<unknown>;
export type TransferQueuePort = {
  add(jobId: string): Promise<void>;
};

export class JobService {
  constructor(
    private readonly pool: Pool,
    private readonly queue: JobQueuePort,
    private readonly gateway: ModelGateway,
    private readonly config: JobConfig,
    private readonly publish: JobEventPublisher = async () => undefined,
  ) {}

  async create(
    projectId: string,
    userId: string,
    input: CreateJobInput,
    retryOfJobId?: string,
  ) {
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ ...input, idempotencyKey: undefined }))
      .digest("hex");
    await assertProjectAccess(this.pool, projectId, userId, "edit");
    const duplicate = await this.pool.query(
      "select * from generation_jobs where project_id = $1 and idempotency_key = $2",
      [projectId, input.idempotencyKey],
    );
    if (duplicate.rows[0]) {
      if (duplicate.rows[0].request_fingerprint !== fingerprint)
        throw new DomainError(
          "IDEMPOTENCY_CONFLICT",
          "重复请求的内容不一致",
          409,
        );
      return serializeJob(duplicate.rows[0]);
    }
    const compiled = await this.gateway.compile(input);
    const maxAttempts = generationJobAttempts();
    const client = await this.pool.connect();
    let job: Record<string, unknown>;
    try {
      await client.query("begin");
      await assertProjectAccess(client, projectId, userId, "edit");
      if (input.nodeId) {
        const node = await client.query(
          "select 1 from canvas_nodes where project_id = $1 and id = $2",
          [projectId, input.nodeId],
        );
        if (!node.rowCount)
          throw new DomainError(
            "NODE_NOT_FOUND",
            "找不到要执行的画布节点",
            404,
          );
      }
      const existing = await client.query(
        "select * from generation_jobs where project_id = $1 and idempotency_key = $2",
        [projectId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].request_fingerprint !== fingerprint)
          throw new DomainError(
            "IDEMPOTENCY_CONFLICT",
            "重复请求的内容不一致",
            409,
          );
        await client.query("commit");
        return serializeJob(existing.rows[0]);
      }
      const jobId = randomUUID();
      const result = await client.query(
        `insert into generation_jobs(id,project_id,node_key,created_by,provider,model_id,mode,capability,input,parameters,input_snapshot,compiled_request,status,progress,max_attempts,idempotency_key,request_fingerprint,bullmq_job_id,queued_at,retry_of_job_id,billing_trace_id,billing_status,billing_next_check_at)
                values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',0,$13,$14,$15,$16,now(),$17,$18,'pending',now()) on conflict(project_id,idempotency_key) where idempotency_key is not null do nothing returning *`,
        [
          jobId,
          projectId,
          input.nodeId || null,
          userId,
          compiled.providerId,
          input.modelId,
          input.mode,
          input.capability,
          { prompt: input.prompt, references: input.references },
          input.parameters,
          input,
          compiled,
          maxAttempts,
          input.idempotencyKey,
          fingerprint,
          randomUUID(),
          retryOfJobId || null,
          jobId,
        ],
      );
      if (!result.rows[0]) {
        const raced = await client.query(
          "select * from generation_jobs where project_id=$1 and idempotency_key=$2",
          [projectId, input.idempotencyKey],
        );
        if (!raced.rows[0] || raced.rows[0].request_fingerprint !== fingerprint)
          throw new DomainError(
            "IDEMPOTENCY_CONFLICT",
            "重复请求的内容不一致",
            409,
          );
        await client.query("commit");
        return serializeJob(raced.rows[0]);
      }
      job = result.rows[0];
      await appendEvent(
        client,
        job.id as string,
        projectId,
        input.nodeId || null,
        "created",
        "pending",
        0,
        "任务已创建",
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    try {
      await this.queue.add(job.id as string, Number(job.max_attempts));
      await this.pool.query(
        "update generation_jobs set status='queued',updated_at=now() where id=$1",
        [job.id],
      );
      await this.pool.query(
        "insert into job_events(job_id,project_id,node_key,sequence,event_type,status,progress,message) select id,project_id,node_key,coalesce((select max(sequence)+1 from job_events where job_id=$1),1),'job.queued','queued',0,'任务已进入队列' from generation_jobs where id=$1",
        [job.id],
      );
      await this.publish(String(job.project_id)).catch(() => undefined);
      job.status = "queued";
    } catch (error) {
      await this.pool.query(
        "update generation_jobs set status='failed', user_error_code='QUEUE_UNAVAILABLE', user_error_message='任务队列暂时不可用', retryable=true, finished_at=now(), updated_at=now() where id=$1",
        [job.id],
      );
      await this.pool.query(
        "insert into job_events(job_id,project_id,node_key,sequence,event_type,status,progress,message) select id,project_id,node_key,coalesce((select max(sequence)+1 from job_events where job_id=$1),1),'job.failed','failed',0,'任务队列暂时不可用' from generation_jobs where id=$1",
        [job.id],
      );
      throw new DomainError(
        "QUEUE_UNAVAILABLE",
        "任务队列暂时不可用",
        503,
        true,
        { cause: error },
      );
    }
    return serializeJob(job);
  }

  async list(projectId: string, userId: string) {
    await assertProjectAccess(this.pool, projectId, userId);
    const result = await this.pool.query(
      "select * from generation_jobs where project_id=$1 order by created_at desc limit 200",
      [projectId],
    );
    return result.rows.map(serializeJob);
  }
  async get(jobId: string, userId: string) {
    const result = await this.pool.query(
      `select j.* from generation_jobs j join project_members m on m.project_id=j.project_id join projects p on p.id=j.project_id where j.id=$1 and m.user_id=$2 and p.deleted_at is null`,
      [jobId, userId],
    );
    if (!result.rows[0]) return null;
    const artifacts = await this.pool.query(
      "select id,asset_id,asset_version_id,role,sort_order,mime_type,metadata from job_artifacts where job_id=$1 order by sort_order",
      [jobId],
    );
    return {
      ...serializeJob(result.rows[0]),
      artifacts: artifacts.rows.map((row) => ({
        id: row.id,
        assetId: row.asset_id,
        assetVersionId: row.asset_version_id,
        role: row.role,
        mimeType: row.mime_type,
        ...(row.metadata || {}),
      })),
    };
  }
  async events(projectId: string, userId: string, after = 0) {
    await assertProjectAccess(this.pool, projectId, userId);
    const result = await this.pool.query(
      "select id,job_id,sequence,event_type,status,progress,message,node_key,data,created_at from job_events where project_id=$1 and id>$2 order by id asc limit 200",
      [projectId, after],
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      jobId: row.job_id,
      sequence: row.sequence,
      type: row.event_type,
      status: row.status,
      progress: row.progress,
      message: row.message,
      nodeId: row.node_key,
      data: row.data,
      createdAt: row.created_at.toISOString(),
    }));
  }
  async cancel(jobId: string, userId: string) {
    const result = await this.pool.query(
      `update generation_jobs j set status='cancel_requested',cancel_requested_at=now(),updated_at=now() from project_members m, projects p where j.id=$1 and m.project_id=j.project_id and p.id=j.project_id and p.deleted_at is null and m.user_id=$2 and m.role in ('owner','admin','editor') and j.status in ('pending','queued','submitting','retrying','running','downloading','persisting') returning j.*`,
      [jobId, userId],
    );
    const row = result.rows[0];
    if (!row) {
      const current = await this.get(jobId, userId);
      if (!current) return null;
      return current;
    }
    await this.pool.query(
      "insert into job_events(job_id,project_id,node_key,sequence,event_type,status,progress,message) values($1,$2,$3,coalesce((select max(sequence)+1 from job_events where job_id=$1),1),'job.cancel_requested','cancel_requested',$4,'正在取消任务')",
      [jobId, row.project_id, row.node_key, row.progress],
    );
    await this.publish(String(row.project_id)).catch(() => undefined);
    if (await this.queue.remove(jobId)) await this.markCancelled(jobId);
    return this.get(jobId, userId);
  }
  async retry(jobId: string, userId: string) {
    const result = await this.pool.query(
      `select j.* from generation_jobs j
         join project_members m on m.project_id=j.project_id
         join projects p on p.id=j.project_id
        where j.id=$1 and m.user_id=$2 and p.deleted_at is null`,
      [jobId, userId],
    );
    const current = result.rows[0];
    if (!current) return null;
    await assertProjectAccess(
      this.pool,
      String(current.project_id),
      userId,
      "edit",
    );
    if (current.status !== "failed" || !current.retryable)
      throw new DomainError("JOB_NOT_RETRYABLE", "当前任务不能重试", 409);
    await this.queue.remove(jobId);
    const snapshot = current.input_snapshot as CreateJobInput | null;
    if (!snapshot)
      throw new DomainError("JOB_SNAPSHOT_MISSING", "任务缺少可重试参数", 409);
    const retried = await this.create(
      String(current.project_id),
      userId,
      { ...snapshot, idempotencyKey: `retry:${jobId}:${randomUUID()}` },
      jobId,
    );
    await this.pool.query(
      "update text_messages set generation_job_id=$2,updated_at=now() where generation_job_id=$1",
      [jobId, retried.id],
    );
    return retried;
  }
  private async markCancelled(jobId: string) {
    const updated = await this.pool.query(
      "update generation_jobs set status='cancelled',finished_at=now(),updated_at=now() where id=$1 and status='cancel_requested' returning project_id",
      [jobId],
    );
    if (!updated.rows[0]) return;
    const result = await this.pool.query(
      "insert into job_events(job_id,project_id,node_key,sequence,event_type,status,progress,message) select id,project_id,node_key,coalesce((select max(sequence)+1 from job_events where job_id=$1),1),'job.cancelled','cancelled',progress,'任务已取消' from generation_jobs where id=$1 returning project_id",
      [jobId],
    );
    if (result.rows[0])
      await this.publish(String(result.rows[0].project_id)).catch(
        () => undefined,
      );
  }
}

export function generationJobAttempts() {
  return 1;
}

export class JobExecutor {
  constructor(
    private readonly pool: Pool,
    private readonly gateway: ModelGateway,
    private readonly providers: ProviderRouter | GenerationProvider,
    private readonly storage: ObjectStorage,
    private readonly config: JobConfig,
    private readonly publish: JobEventPublisher = async () => undefined,
    private readonly billing?: BillingService,
    private readonly transferQueue?: TransferQueuePort,
  ) {}
  async execute(jobId: string, attempt: number, signal?: AbortSignal) {
    const row = (
      await this.pool.query("select * from generation_jobs where id=$1", [
        jobId,
      ])
    ).rows[0];
    if (!row) return;
    if (["completed", "failed", "cancelled"].includes(row.status)) return;
    if (row.status === "cancel_requested") return this.cancel(row, signal);
    const submitting = await this.pool.query(
      "update generation_jobs set status='submitting',progress=greatest(progress,1),attempt_count=$2,started_at=coalesce(started_at,now()),heartbeat_at=now(),updated_at=now() where id=$1 and status not in ('cancel_requested','cancelled','completed','failed') returning id",
      [jobId, attempt],
    );
    if (!submitting.rowCount) {
      const fresh = (
        await this.pool.query("select * from generation_jobs where id=$1", [
          jobId,
        ])
      ).rows[0];
      return fresh?.status === "cancel_requested"
        ? this.cancel(fresh, signal)
        : undefined;
    }
    await this.pool.query(
      "insert into job_attempts(job_id,attempt,status) values($1,$2,'running') on conflict(job_id,attempt) do update set status='running',started_at=now(),finished_at=null",
      [jobId, attempt],
    );
    await this.event(row, "job.started", "submitting", 1, "正在提交模型");
    const cancellationController = new AbortController();
    const providerSignal = signal
      ? AbortSignal.any([signal, cancellationController.signal])
      : cancellationController.signal;
    const cancellationMonitor = setInterval(() => {
      void this.pool
        .query("select status from generation_jobs where id=$1", [jobId])
        .then((result) => {
          if (
            result.rows[0]?.status === "cancel_requested" &&
            !cancellationController.signal.aborted
          )
            cancellationController.abort(new Error("Job cancelled"));
        })
        .catch(() => undefined);
    }, this.config.videoPollIntervalMs);
    let activeProviderJobId = row.provider_job_id;
    try {
      const provider = this.providerFor(String(row.provider));
      const compiled = row.provider_job_id
        ? undefined
        : await this.gateway.compile(
            await this.resolveAssetReferences(
              row.input_snapshot as GenerationInput,
              String(row.project_id),
            ),
          );
      let result = row.provider_job_id
        ? await provider.get(
            String(row.provider_job_id),
            providerSignal,
            row.capability as GenerationInput["capability"],
          )
        : await provider.create(compiled!, jobId, providerSignal);
      if (!row.provider_job_id)
        await this.billing
          ?.recordTrace(jobId, result.billingTraceId, result.usage)
          .catch(() => undefined);
      if (result.providerJobId)
        await this.pool.query(
          "update generation_jobs set provider_job_id=$2,heartbeat_at=now(),updated_at=now() where id=$1",
          [jobId, result.providerJobId],
        );
      activeProviderJobId = result.providerJobId || activeProviderJobId;
      if (result.status !== "completed") {
        const running = await this.pool.query(
          "update generation_jobs set status='running',progress=greatest(progress,2),heartbeat_at=now(),updated_at=now() where id=$1 and status <> 'cancel_requested' returning id",
          [jobId],
        );
        if (!running.rowCount)
          return this.cancel(
            { ...row, provider_job_id: result.providerJobId },
            signal,
          );
      }
      const startedAt =
        row.started_at instanceof Date
          ? row.started_at.getTime()
          : row.started_at
            ? new Date(String(row.started_at)).getTime()
            : Date.now();
      const deadline = startedAt + this.config.maxRuntimeMs;
      while (result.status !== "completed") {
        const beforePoll = (
          await this.pool.query(
            "select status from generation_jobs where id=$1",
            [jobId],
          )
        ).rows[0];
        if (beforePoll?.status === "cancel_requested")
          return this.cancel(
            { ...row, provider_job_id: result.providerJobId },
            signal,
          );
        await delay(this.config.videoPollIntervalMs, signal);
        const fresh = (
          await this.pool.query(
            "select status from generation_jobs where id=$1",
            [jobId],
          )
        ).rows[0];
        if (fresh?.status === "cancel_requested")
          return this.cancel(
            { ...row, provider_job_id: result.providerJobId },
            signal,
          );
        if (this.config.maxRuntimeMs > 0 && Date.now() >= deadline)
          throw new ProviderError("PROVIDER_TIMEOUT", "生成任务等待超时", true);
        result = await provider.get(
          result.providerJobId!,
          providerSignal,
          row.capability as GenerationInput["capability"],
        );
        const afterPoll = (
          await this.pool.query(
            "select status from generation_jobs where id=$1",
            [jobId],
          )
        ).rows[0];
        if (afterPoll?.status === "cancel_requested")
          return this.cancel(
            { ...row, provider_job_id: result.providerJobId },
            signal,
          );
        const progress = Math.max(2, Math.min(95, result.progress || 10));
        await this.pool.query(
          "update generation_jobs set progress=$2,heartbeat_at=now(),updated_at=now() where id=$1",
          [jobId, progress],
        );
        await this.event(
          row,
          "job.progress",
          "running",
          progress,
          "模型正在生成",
        );
      }
      if (result.usage)
        await this.billing
          ?.recordMeterUsage(jobId, result.usage)
          .catch(() => undefined);
      const beforePersist = (
        await this.pool.query(
          "select status from generation_jobs where id=$1",
          [jobId],
        )
      ).rows[0];
      if (beforePersist?.status === "cancel_requested")
        return this.cancel(
          { ...row, provider_job_id: result.providerJobId },
          signal,
        );
      await this.pool.query(
        "update generation_jobs set status='downloading',progress=96,updated_at=now() where id=$1",
        [jobId],
      );
      await this.event(
        row,
        "job.downloading",
        "downloading",
        96,
        "正在转存生成结果",
      );
      if (
        row.capability === "video" &&
        activeProviderJobId &&
        this.transferQueue
      ) {
        await this.transferQueue.add(jobId);
        return { transferQueued: true };
      }
      return this.persistResult(
        row,
        result.artifacts || [],
        attempt,
        providerSignal,
        activeProviderJobId ? String(activeProviderJobId) : undefined,
      );
    } catch (error) {
      if (
        error instanceof ProviderError &&
        typeof error.safeDetails.billingTraceId === "string"
      )
        await this.billing
          ?.recordTrace(jobId, error.safeDetails.billingTraceId)
          .catch(() => undefined);
      const current = await this.pool.query(
        "select status from generation_jobs where id=$1",
        [jobId],
      );
      if (current.rows[0]?.status === "cancel_requested")
        return this.cancel(
          { ...row, provider_job_id: activeProviderJobId },
          signal,
        );
      const mapped = mapProviderError(error);
      await this.pool.query(
        "update job_attempts set status='failed',error_code=$3,error_sanitized=$4,finished_at=now() where job_id=$1 and attempt=$2",
        [jobId, attempt, mapped.code, mapped.details],
      );
      await this.pool.query(
        "update generation_jobs set retryable=$2,provider_error_code=$3,provider_error_sanitized=$4,user_error_code=$3,user_error_message=$5,heartbeat_at=now(),updated_at=now() where id=$1",
        [jobId, mapped.retryable, mapped.code, mapped.details, mapped.message],
      );
      throw error;
    } finally {
      clearInterval(cancellationMonitor);
    }
  }
  async executeTransfer(jobId: string, signal?: AbortSignal) {
    const row = (
      await this.pool.query("select * from generation_jobs where id=$1", [
        jobId,
      ])
    ).rows[0];
    if (!row || ["completed", "failed", "cancelled"].includes(row.status))
      return;
    if (row.status === "cancel_requested") return this.cancel(row, signal);
    if (!row.provider_job_id)
      throw new ProviderError(
        "PROVIDER_RESULT_MISSING",
        "生成结果缺少任务编号",
        true,
      );
    const cancellationController = new AbortController();
    const transferSignal = signal
      ? AbortSignal.any([signal, cancellationController.signal])
      : cancellationController.signal;
    const cancellationMonitor = setInterval(() => {
      void this.pool
        .query("select status from generation_jobs where id=$1", [jobId])
        .then((result) => {
          if (
            result.rows[0]?.status === "cancel_requested" &&
            !cancellationController.signal.aborted
          )
            cancellationController.abort(new Error("Job cancelled"));
        })
        .catch(() => undefined);
    }, this.config.videoPollIntervalMs);
    try {
      const provider = this.providerFor(String(row.provider));
      const result = await provider.get(
        String(row.provider_job_id),
        transferSignal,
        row.capability as GenerationInput["capability"],
      );
      if (result.status !== "completed")
        throw new ProviderError(
          "PROVIDER_RESULT_PENDING",
          "模型结果仍在准备中",
          true,
        );
      return await this.persistResult(
        row,
        result.artifacts || [],
        Number(row.attempt_count || 1),
        transferSignal,
        String(row.provider_job_id),
      );
    } catch (error) {
      const current = await this.pool.query(
        "select status from generation_jobs where id=$1",
        [jobId],
      );
      if (current.rows[0]?.status === "cancel_requested")
        return this.cancel(row, signal);
      const mapped = mapProviderError(error);
      await this.pool.query(
        "update generation_jobs set retryable=$2,provider_error_code=$3,provider_error_sanitized=$4,user_error_code=$3,user_error_message=$5,heartbeat_at=now(),updated_at=now() where id=$1",
        [jobId, mapped.retryable, mapped.code, mapped.details, mapped.message],
      );
      throw error;
    } finally {
      clearInterval(cancellationMonitor);
    }
  }

  private async persistResult(
    row: Record<string, unknown>,
    providerArtifacts: ProviderArtifact[],
    attempt: number,
    signal?: AbortSignal,
    providerJobId?: string,
  ) {
    const jobId = String(row.id);
    const artifacts = await this.persistArtifacts(
      row,
      providerArtifacts,
      signal,
      providerJobId,
    );
    const versionIds = artifacts
      .map((artifact) => artifact.assetVersionId)
      .filter(Boolean);
    await this.pool.query(
      "update generation_jobs set status='completed',progress=100,output_asset_version_ids=$2,finished_at=now(),heartbeat_at=now(),updated_at=now() where id=$1 and status <> 'cancel_requested'",
      [jobId, JSON.stringify(versionIds)],
    );
    const current = (
      await this.pool.query("select status from generation_jobs where id=$1", [
        jobId,
      ])
    ).rows[0];
    if (current?.status === "cancel_requested") return this.cancel(row, signal);
    await this.pool.query(
      "update job_attempts set status='completed',finished_at=now() where job_id=$1 and attempt=$2",
      [jobId, attempt],
    );
    await this.event(row, "job.completed", "completed", 100, "生成完成", {
      artifacts,
    });
    return { artifacts };
  }
  async markAttemptFailed(jobId: string, final: boolean) {
    const row = (
      await this.pool.query("select * from generation_jobs where id=$1", [
        jobId,
      ])
    ).rows[0];
    if (
      !row ||
      ["cancel_requested", "cancelled", "completed", "failed"].includes(
        row.status,
      )
    )
      return;
    const status = final ? "failed" : "retrying";
    await this.pool.query(
      "update generation_jobs set status=$2,finished_at=case when $3 then now() else null end,updated_at=now() where id=$1",
      [jobId, status, final],
    );
    await this.event(
      row,
      final ? "job.failed" : "job.retrying",
      status,
      row.progress,
      final ? row.user_error_message || "生成失败" : "任务将自动重试",
    );
  }
  private async cancel(row: Record<string, unknown>, signal?: AbortSignal) {
    if (row.provider_job_id)
      await this.providerFor(String(row.provider))
        .cancel(String(row.provider_job_id), signal)
        .catch(() => undefined);
    const updated = await this.pool.query(
      "update generation_jobs set status='cancelled',finished_at=now(),updated_at=now() where id=$1 and status='cancel_requested' returning id",
      [row.id],
    );
    if (!updated.rowCount) return;
    await this.event(
      row,
      "job.cancelled",
      "cancelled",
      Number(row.progress || 0),
      "任务已取消",
    );
  }
  private async persistArtifacts(
    row: Record<string, unknown>,
    artifacts: ProviderArtifact[],
    signal?: AbortSignal,
    providerJobId?: string,
  ) {
    const results: Array<Record<string, unknown>> = [];
    let persistenceStarted = false;
    const markPersisting = async () => {
      if (persistenceStarted) return;
      persistenceStarted = true;
      await this.pool.query(
        "update generation_jobs set status='persisting',progress=99,heartbeat_at=now(),updated_at=now() where id=$1 and status <> 'cancel_requested'",
        [row.id],
      );
      await this.event(
        row,
        "job.persisting",
        "persisting",
        99,
        "正在写入资产库",
      );
    };
    for (let index = 0; index < artifacts.length; index++) {
      const artifact = artifacts[index]!;
      const trace = ((row.input_snapshot || {}) as GenerationInput).trace || {};
      if (artifact.kind === "text") {
        await markPersisting();
        const id = randomUUID();
        await this.pool.query(
          "insert into job_artifacts(id,job_id,project_id,role,sort_order,mime_type,metadata) values($1,$2,$3,'output',$4,$5,$6)",
          [
            id,
            row.id,
            row.project_id,
            index,
            artifact.mimeType,
            {
              text: artifact.text,
              trace:
                (
                  row.input_snapshot as GenerationInput & {
                    trace?: Record<string, unknown>;
                  }
                )?.trace || {},
            },
          ],
        );
        results.push({ id, kind: artifact.kind, text: artifact.text });
        continue;
      }
      const bytes =
        artifact.bytes ||
        (await downloadBytes(
          artifact.url || "about:blank",
          signal,
          60_000,
          1_000,
          providerJobId
            ? async () => {
                const refreshed = await this.providerFor(
                  String(row.provider),
                ).get(
                  providerJobId,
                  signal,
                  row.capability as GenerationInput["capability"],
                );
                return refreshed.artifacts?.[index]?.url;
              }
            : undefined,
          providerJobId
            ? (range, downloadSignal) =>
                this.providerFor(String(row.provider)).fetchVideoContent(
                  providerJobId,
                  range,
                  downloadSignal,
                )
            : undefined,
          async (downloadedBytes, totalBytes) => {
            const progress = totalBytes
              ? Math.min(
                  98,
                  96 + Math.floor((downloadedBytes / totalBytes) * 2),
                )
              : 96;
            const message = totalBytes
              ? `正在下载 ${formatMegabytes(downloadedBytes)} / ${formatMegabytes(totalBytes)}`
              : `正在下载 ${formatMegabytes(downloadedBytes)}`;
            await this.pool.query(
              "update generation_jobs set status='downloading',progress=$2,heartbeat_at=now(),updated_at=now() where id=$1 and status <> 'cancel_requested'",
              [row.id, progress],
            );
            await this.event(
              row,
              "job.downloading",
              "downloading",
              progress,
              message,
              { downloadedBytes, totalBytes },
            );
          },
          30_000,
          64 * 1024,
          4 * 1024 * 1024,
          !artifact.url,
        ));
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const extension = extensionFor(artifact.mimeType);
      const storageKey = `projects/${row.project_id}/generated/${row.id}/${index}.${extension}`;
      await markPersisting();
      await this.storage.put(storageKey, bytes, artifact.mimeType, sha256);
      const client = await this.pool.connect();
      try {
        await client.query("begin");
        const assetKind = generatedAssetKind(artifact.kind, trace.assetKind);
        const asset = await client.query(
          "insert into assets(project_id,kind,name,status,created_by) values($1,$2,$3,'active',$4) returning id",
          [
            row.project_id,
            assetKind,
            trace.assetName ||
              `${assetKind}-${String(row.id).slice(0, 8)}-${index + 1}.${extension}`,
            row.created_by,
          ],
        );
        const version = await client.query(
          "insert into asset_versions(asset_id,version,storage_key,mime_type,bytes,sha256,source,source_job_id,provenance,created_by) values($1,1,$2,$3,$4,$5,'generation',$6,$7,$8) returning id",
          [
            asset.rows[0].id,
            storageKey,
            artifact.mimeType,
            bytes.byteLength,
            sha256,
            row.id,
            buildArtifactProvenance(row),
            row.created_by,
          ],
        );
        await client.query(
          "update assets set current_version_id=$2,updated_at=now() where id=$1",
          [asset.rows[0].id, version.rows[0].id],
        );
        const artifactId = randomUUID();
        await client.query(
          "insert into job_artifacts(id,job_id,project_id,asset_id,asset_version_id,role,sort_order,storage_key,mime_type,metadata) values($1,$2,$3,$4,$5,'output',$6,$7,$8,'{}')",
          [
            artifactId,
            row.id,
            row.project_id,
            asset.rows[0].id,
            version.rows[0].id,
            index,
            storageKey,
            artifact.mimeType,
          ],
        );
        await client.query("commit");
        results.push({
          id: artifactId,
          kind: artifact.kind,
          assetId: asset.rows[0].id,
          assetVersionId: version.rows[0].id,
        });
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    }
    return results;
  }

  private providerFor(providerId: string) {
    return this.providers instanceof ProviderRouter
      ? this.providers.for(providerId)
      : this.providers;
  }
  private async resolveAssetReferences(
    input: GenerationInput,
    projectId: string,
  ): Promise<GenerationInput> {
    const references = await Promise.all(
      (input.references || []).map(async (reference) => {
        if (reference.virtualPortraitId) {
          const result = await this.pool.query(
            `select vp.provider_asset_id
               from virtual_portraits vp
               join virtual_portrait_libraries vpl on vpl.id=vp.library_id
              where vp.id=$1 and vp.project_id=$2 and vp.status='active'
                and vp.archived_at is null and vpl.provider_status='active'`,
            [reference.virtualPortraitId, projectId],
          );
          const portrait = result.rows[0];
          if (
            !portrait ||
            !String(portrait.provider_asset_id).startsWith("ta_")
          )
            throw new DomainError(
              "VIRTUAL_PORTRAIT_NOT_READY",
              "角色资产尚未就绪或不属于当前项目",
              422,
            );
          return {
            ...reference,
            url: `asset://${portrait.provider_asset_id}`,
            mimeType: reference.mimeType || "image/png",
          };
        }
        if (!reference.assetVersionId) return reference;
        const result = await this.pool.query(
          `select v.storage_key, v.mime_type
             from asset_versions v join assets a on a.id=v.asset_id
            where v.id=$1 and a.project_id=$2 and a.status='active' and a.trashed_at is null`,
          [reference.assetVersionId, projectId],
        );
        const version = result.rows[0];
        if (!version)
          throw new DomainError(
            "ASSET_VERSION_NOT_FOUND",
            "参考素材版本不存在或不属于当前项目",
            422,
          );
        return {
          ...reference,
          url: await this.storage.createDownloadUrl(version.storage_key),
          mimeType: reference.mimeType || version.mime_type,
        };
      }),
    );
    return { ...input, references };
  }
  private async event(
    row: Record<string, unknown>,
    type: string,
    status: string,
    progress: number,
    message: string,
    data: Record<string, unknown> = {},
  ) {
    await this.pool.query(
      "insert into job_events(job_id,project_id,node_key,sequence,event_type,status,progress,message,data) values($1,$2,$3,coalesce((select max(sequence)+1 from job_events where job_id=$1),1),$4,$5,$6,$7,$8)",
      [
        row.id,
        row.project_id,
        row.node_key,
        type,
        status,
        progress,
        message,
        data,
      ],
    );
    await this.publish(String(row.project_id)).catch(() => undefined);
  }
}

async function appendEvent(
  client: PoolClient,
  jobId: string,
  projectId: string,
  nodeId: string | null,
  type: string,
  status: string,
  progress: number,
  message: string,
) {
  await client.query(
    "insert into job_events(job_id,project_id,node_key,sequence,event_type,status,progress,message) values($1,$2,$3,1,$4,$5,$6,$7)",
    [jobId, projectId, nodeId, `job.${type}`, status, progress, message],
  );
}
function serializeJob(row: Record<string, any>) {
  return {
    id: row.id,
    projectId: row.project_id,
    nodeId: row.node_key,
    modelId: row.model_id,
    capability: row.capability,
    mode: row.mode,
    status: row.status,
    progress: row.progress,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    retryable: row.retryable,
    error: row.user_error_code
      ? {
          code: row.user_error_code,
          message: serializedUserError(row),
          retryable: row.retryable,
        }
      : null,
    providerJobId: row.provider_job_id,
    retryOfJobId: row.retry_of_job_id,
    billingTraceId: row.billing_trace_id,
    billingStatus: row.billing_status,
    billingError: row.billing_error,
    billingLastCheckedAt:
      row.billing_last_checked_at?.toISOString?.() ||
      row.billing_last_checked_at,
    outputAssetVersionIds: row.output_asset_version_ids || [],
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
    startedAt: row.started_at?.toISOString?.() || row.started_at,
    finishedAt: row.finished_at?.toISOString?.() || row.finished_at,
  };
}
function serializedUserError(row: Record<string, any>) {
  const details = row.provider_error_sanitized;
  const upstreamMessage =
    details &&
    typeof details === "object" &&
    typeof details.upstreamMessage === "string"
      ? details.upstreamMessage
      : "";
  return providerUserMessage(
    upstreamMessage,
    row.user_error_message || "生成失败",
  );
}
function mapProviderError(error: unknown) {
  if (error instanceof ProviderError)
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: error.safeDetails,
    };
  return {
    code: "INTERNAL_ERROR",
    message: "生成服务暂时不可用",
    retryable: true,
    details: { name: error instanceof Error ? error.name : "UnknownError" },
  };
}
function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
export async function downloadBytes(
  url: string,
  signal?: AbortSignal,
  idleMs = 60_000,
  reconnectDelayMs = 1_000,
  refreshUrl?: () => Promise<string | undefined>,
  alternateFetch?: (range: string, signal?: AbortSignal) => Promise<Response>,
  onProgress?: (downloadedBytes: number, totalBytes?: number) => Promise<void>,
  lowSpeedWindowMs = 30_000,
  minimumBytesPerSecond = 64 * 1024,
  rangeChunkBytes = 4 * 1024 * 1024,
  preferAlternate = false,
) {
  let currentUrl = url;
  const chunks: Uint8Array[] = [];
  let size = 0;
  let totalBytes: number | undefined;
  let useAlternate = preferAlternate && Boolean(alternateFetch);
  for (;;) {
    if (totalBytes !== undefined && size >= totalBytes) break;
    if (signal?.aborted) throw signal.reason;
    const requestController = new AbortController();
    const requestSignal = signal
      ? AbortSignal.any([signal, requestController.signal])
      : requestController.signal;
    let idle = false;
    let slow = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let speedTimer: ReturnType<typeof setInterval> | undefined;
    let windowStartedAt = Date.now();
    let windowBytes = 0;
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idle = true;
        requestController.abort();
      }, idleMs);
    };
    try {
      resetIdleTimer();
      speedTimer = setInterval(() => {
        const elapsed = Date.now() - windowStartedAt;
        if (elapsed < lowSpeedWindowMs) return;
        if ((windowBytes * 1_000) / elapsed < minimumBytesPerSecond) {
          slow = true;
          requestController.abort();
          return;
        }
        windowStartedAt = Date.now();
        windowBytes = 0;
      }, 1_000);
      const range = `bytes=${size}-${size + rangeChunkBytes - 1}`;
      const response =
        useAlternate && alternateFetch
          ? await alternateFetch(range, requestSignal)
          : await fetch(currentUrl, {
              signal: requestSignal,
              headers: { Range: range },
            });
      if (!response.ok)
        throw new ProviderError(
          "ARTIFACT_DOWNLOAD_FAILED",
          "生成结果转存失败",
          true,
          { status: response.status },
        );
      if (size > 0 && response.status !== 206)
        throw new ProviderError(
          "ARTIFACT_DOWNLOAD_FAILED",
          "生成结果不支持断点续传",
          true,
          { status: response.status },
        );
      const contentRange = response.headers.get("content-range");
      const rangeTotal = contentRange?.match(/\/(\d+)$/)?.[1];
      const contentLengthHeader = response.headers.get("content-length");
      const contentLength = contentLengthHeader
        ? Number(contentLengthHeader)
        : Number.NaN;
      if (rangeTotal) totalBytes = Number(rangeTotal);
      else if (response.status === 200 && Number.isFinite(contentLength))
        totalBytes = contentLength;
      if (!response.body) {
        const value = new Uint8Array(await response.arrayBuffer());
        chunks.push(value);
        size += value.byteLength;
        await onProgress?.(size, totalBytes);
        continue;
      }
      const target = totalBytes
        ? Math.min(totalBytes, size + rangeChunkBytes)
        : size + rangeChunkBytes;
      const reader = response.body.getReader();
      let ended = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          ended = true;
          break;
        }
        if (value?.byteLength) {
          const remaining = target - size;
          const accepted =
            value.byteLength > remaining ? value.subarray(0, remaining) : value;
          chunks.push(accepted);
          size += accepted.byteLength;
          windowBytes += accepted.byteLength;
          resetIdleTimer();
          if (size >= target) {
            await reader.cancel().catch(() => undefined);
            break;
          }
        }
      }
      if (ended && totalBytes === undefined) totalBytes = size;
      await onProgress?.(size, totalBytes);
    } catch (error) {
      if (signal?.aborted) throw error;
      const downloadFailed =
        error instanceof ProviderError &&
        error.code === "ARTIFACT_DOWNLOAD_FAILED";
      if (!idle && !slow && !(error instanceof TypeError) && !downloadFailed)
        throw error;
      useAlternate = alternateFetch ? !useAlternate : false;
      if (refreshUrl) {
        try {
          currentUrl = (await refreshUrl()) || currentUrl;
        } catch (refreshError) {
          if (signal?.aborted) throw refreshError;
        }
      }
      await delay(reconnectDelayMs, signal);
    } finally {
      clearTimeout(idleTimer);
      clearInterval(speedTimer);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function formatMegabytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function extensionFor(mime: string) {
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg")) return "mp3";
  return mime.startsWith("video/") ? "mp4" : "bin";
}

function buildArtifactProvenance(row: Record<string, unknown>) {
  const snapshot = (row.input_snapshot || {}) as GenerationInput & {
    trace?: Record<string, unknown>;
  };
  return {
    modelId: row.model_id,
    mode: row.mode,
    ...(snapshot.trace || {}),
    inputAssetVersionIds: (snapshot.references || [])
      .map((reference) => reference.assetVersionId)
      .filter(Boolean),
    parameters: snapshot.parameters || {},
  };
}

function generatedAssetKind(
  kind: ProviderArtifact["kind"],
  requested: unknown,
) {
  if (
    kind === "image" &&
    ["character", "scene", "prop", "image"].includes(String(requested))
  )
    return String(requested);
  if (kind === "video" && requested === "video") return "video";
  if (kind === "audio" && requested === "audio") return "audio";
  return kind;
}
