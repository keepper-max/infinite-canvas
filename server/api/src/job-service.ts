import { bindNativeModelJob, assertNativeJobVisible, nativeModelRoute, type NativeModelJobInput } from "./native-agent/model-job-policy.js";
import { createHash, randomUUID } from "node:crypto";
import { prepareKnowledgeJob } from "./knowledge-job-input.js";
import { KnowledgeService } from "./knowledge-service.js";
import { assertKnowledgeGenerationEnabled, requireKnowledgeFeaturePg } from "./knowledge-feature.js";
import { hasUnconfirmedSubmission, canReleaseUnsubmittedReservation } from "./provider-submission.js";
import { drizzle } from "drizzle-orm/node-postgres";
import * as knowledgeTables from "./db/schema.js";
import type { Pool, PoolClient } from "pg";

import type { JobConfig } from "./config.js";
import type { BillingService } from "./billing-service.js";
import type { CreditService } from "./credit-service.js";
import { DomainError } from "./domain.js";
import type { CreateJobInput } from "./job-contract.js";
import { ModelGateway, type GenerationInput } from "./model-gateway.js";
import type { ObjectStorage } from "./object-storage.js";
import { assertProjectAccess, resolveActiveUser } from "./project-access.js";
import {
  ProviderError,
  providerUserMessage,
  type GenerationProvider,
  type ProviderArtifact,
} from "./provider.js";
import { ProviderRouter } from "./provider-router.js";
import { createVideoThumbnail, readVideoMetadata, type VideoMetadata } from "./video-thumbnail.js";
import { fetchRemoteMedia } from "./remote-media.js";
import type { StorageQuotaService } from "./storage-quota-service.js";

export type JobQueuePort = {
  add(jobId: string, maxAttempts: number): Promise<void>;
  remove(jobId: string): Promise<boolean>;
};
export type JobEventPublisher = (projectId: string) => Promise<unknown>;
export type TransferQueuePort = {
  add(jobId: string): Promise<void>;
};
type RetryOperation = { operationId: string; payloadHash: string };
function assertRetrySubmissionKnown(job: Record<string, any>) {
  const state=job.provider_submission_state ?? 'legacy';
  if (hasUnconfirmedSubmission(job))
    throw new DomainError('PROVIDER_SUBMISSION_UNCONFIRMED','供应商提交状态不明，已停止重试，请先核查原任务和账单',409);
  if ((job.provider_job_id || ['accepted','resolved'].includes(state)) && !['not_billed','settled'].includes(job.billing_status))
    throw new DomainError('JOB_BILLING_UNCONFIRMED','原任务账单尚未核验，不能发起新的付费重试',409);
}

export class JobService {
  constructor(
    private readonly pool: Pool,
    private readonly queue: JobQueuePort,
    private readonly gateway: ModelGateway,
    private readonly config: JobConfig,
    private readonly publish: JobEventPublisher = async () => undefined,
    private readonly credits?: CreditService,
    private readonly billing?: BillingService,
    private readonly storageQuota?: StorageQuotaService,
  ) {}

  async create(
    projectId: string,
    userId: string,
    input: CreateJobInput,
    retryOfJobId?: string,
    retryOperation?: RetryOperation,
    nativeModel?: NativeModelJobInput,
  ) {
    if (!retryOfJobId && input.trace?.inputSnapshot) {
      const { knowledgeSources: _ignored, ...snapshot } = input.trace.inputSnapshot;
      input = { ...input, trace: { ...input.trace, inputSnapshot: snapshot } };
    }
    if (!retryOfJobId && input.trace?.workflowKind === "director.workflow") {
      const settings = await this.directorSettings();
      if (!settings.enabled)
        throw new DomainError(
          "DIRECTOR_DISABLED",
          "AI 漫剧导演台已由管理员停用",
          403,
        );
      if (settings.modelId) input = { ...input, modelId: settings.modelId };
    }
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ ...input, idempotencyKey: undefined, ...(nativeModel ? {nativeModelPayloadHash:nativeModel.payloadHash}: {}) }))
      .digest("hex");
    await assertProjectAccess(this.pool, projectId, userId, nativeModel?.mode==='advice'?"read":"edit");
    const duplicate = await this.pool.query(
      "select * from generation_jobs where project_id = $1 and idempotency_key = $2",
      [projectId, input.idempotencyKey],
    );
    if (duplicate.rows[0]) {
      if(Array.isArray(duplicate.rows[0].input_snapshot?.trace?.inputSnapshot?.knowledgeSources)&&duplicate.rows[0].input_snapshot.trace.inputSnapshot.knowledgeSources.length)await requireKnowledgeFeaturePg(this.pool,userId);
      if (duplicate.rows[0].request_fingerprint !== fingerprint)
        throw new DomainError(
          "IDEMPOTENCY_CONFLICT",
          "重复请求的内容不一致",
          409,
        );
      return serializeJob(duplicate.rows[0]);
    }
    if (input.capability !== "text")
      await this.storageQuota?.assertHasCapacity(userId);
    let compiled = await this.gateway.compile(input);
    if(nativeModel && (!this.credits || !this.billing || compiled.providerId!==nativeModelRoute(nativeModel.modelId).providerId || compiled.upstreamModel!==nativeModelRoute(nativeModel.modelId).upstreamModel)) throw new DomainError("AGENT_BILLING_ROUTE_INVALID","原生推理必须使用已核验模型、积分及计费服务",409);
    const maxAttempts = generationJobAttempts();
    const client = await this.pool.connect();
    let job: Record<string, unknown>;
    try {
      await client.query("begin");
      await assertProjectAccess(client, projectId, userId, nativeModel?.mode==='advice'?"read":"edit");
      if (retryOperation && retryOfJobId) {
        await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[userId+':retry:'+retryOperation.operationId]);
        const receipt=(await client.query("select * from job_retry_operations where actor_id=$1 and operation_id=$2",[userId,retryOperation.operationId])).rows[0];
        if(receipt){
          if(receipt.payload_hash!==retryOperation.payloadHash)throw new DomainError('RETRY_OPERATION_MISMATCH','重试操作ID已用于不同参数',409);
          const prior=(await client.query('select * from generation_jobs where id=$1',[receipt.result_job_id])).rows[0];
          await client.query('commit');return serializeJob(prior);
        }
        const ancestors = await client.query(`with recursive ancestors(id,retry_of_job_id) as (
          select id,retry_of_job_id from generation_jobs where id=$1 and project_id=$2
          union select j.id,j.retry_of_job_id from generation_jobs j join ancestors a on j.id=a.retry_of_job_id where j.project_id=$2
        ) select id from ancestors where retry_of_job_id is null`, [retryOfJobId, projectId]);
        const rootId = ancestors.rows[0]?.id;
        if (!rootId) throw new DomainError('RETRY_HISTORY_INVALID', '重试历史不完整，请核查原任务', 409);
        await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', ['retry-family:'+rootId]);
        const parent=(await client.query('select * from generation_jobs where id=$1 and project_id=$2 for update',[retryOfJobId,projectId])).rows[0];
        assertRetrySubmissionKnown(parent);
        if(parent.status!=='failed'||!parent.retryable)throw new DomainError('JOB_NOT_RETRYABLE','当前任务不能重试',409);
        const previousRetries = await client.query(`with recursive family(id) as (
          select $1::uuid union select j.id from generation_jobs j join family f on j.retry_of_job_id=f.id where j.project_id=$2
        ) select j.* from generation_jobs j join family f on f.id=j.id`, [rootId, projectId]);
        for (const previous of previousRetries.rows) assertRetrySubmissionKnown(previous);
        if(previousRetries.rows.some(row=>!['completed','failed','cancelled'].includes(row.status)))throw new DomainError('RETRY_ALREADY_PENDING','该任务已有进行中的重试，请查询原重试任务',409);
      }
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
      const prepared = await prepareKnowledgeJob(client, userId, projectId, input, retryOfJobId);
      assertKnowledgeGenerationEnabled(prepared.trace?.inputSnapshot?.knowledgeSources);
      if (prepared !== input) { input = prepared; compiled = await this.gateway.compile(input, client); }
      if(nativeModel) compiled={...compiled,providerMetadata:{...compiled.providerMetadata,nativeAgentStepId:nativeModel.stepId}};
      const inheritedBillingRule = retryOfJobId
        ? (
            await client.query(
              "select billing_rule_snapshot from generation_jobs where id=$1 and project_id=$2",
              [retryOfJobId, projectId],
            )
          ).rows[0]?.billing_rule_snapshot
        : undefined;
      const billingRuleSnapshot = retryOfJobId
        ? inheritedBillingRule || {}
        : (await this.billing?.resolveRuleSnapshot(
            compiled.providerId,
            input.modelId,
            client,
          )) || {};
      const result = await client.query(
        `insert into generation_jobs(id,project_id,node_key,created_by,provider,model_id,mode,capability,input,parameters,input_snapshot,compiled_request,status,progress,max_attempts,idempotency_key,request_fingerprint,bullmq_job_id,queued_at,retry_of_job_id,billing_rule_snapshot,billing_trace_id,billing_status,billing_next_check_at,credit_delivery_status)
                values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',0,$13,$14,$15,$16,now(),$17,$18,$19,'pending',now(),'pending') on conflict(project_id,idempotency_key) where idempotency_key is not null do nothing returning *`,
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
          billingRuleSnapshot,
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
      await client.query("update generation_jobs set provider_submission_state='not_started' where id=$1",[job.id]);
      job.provider_submission_state='not_started';
      const reserved = await this.credits?.reserveForJob(
        client,
        userId,
        input.capability,
        nativeModel ? BigInt(nativeModel.quoteCents) : undefined,
      );
      if (reserved !== undefined) {
        const updated = await client.query(
          "update generation_jobs set credits_reserved=$2,updated_at=now() where id=$1 returning *",
          [job.id, reserved.toString()],
        );
        job = updated.rows[0];
      }
      if(nativeModel) await bindNativeModelJob(client,String(job.id),nativeModel);
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
      if (retryOperation && retryOfJobId) {
        job=(await client.query('update generation_jobs set retry_operation_id=$2 where id=$1 returning *',[job.id,retryOperation.operationId])).rows[0];
        await client.query('insert into job_retry_operations(actor_id,operation_id,original_job_id,payload_hash,result_job_id) values($1,$2,$3,$4,$5)',[userId,retryOperation.operationId,retryOfJobId,retryOperation.payloadHash,job.id]);
        await client.query("insert into admin_audit_logs(actor_user_id,action,target_type,target_id,metadata) values($1,'job.retry','generation_job',$2,$3)",[userId,job.id,{operationId:retryOperation.operationId,originalJobId:retryOfJobId,payloadHash:retryOperation.payloadHash}]);
        await client.query('update text_messages set generation_job_id=$2,updated_at=now() where generation_job_id=$1',[retryOfJobId,job.id]);
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    if(nativeModel) return serializeJob(job);
    try {
      await this.queue.add(job.id as string, Number(job.max_attempts));
      await this.pool.query(
        "update generation_jobs set status='queued',updated_at=now() where id=$1 and status='pending'",
        [job.id],
      );
      await this.pool.query(
        "insert into job_events(job_id,project_id,node_key,sequence,event_type,status,progress,message) select id,project_id,node_key,coalesce((select max(sequence)+1 from job_events where job_id=$1),1),'job.queued','queued',0,'任务已进入队列' from generation_jobs where id=$1",
        [job.id],
      );
      await this.publish(String(job.project_id)).catch(() => undefined);
      job.status = "queued";
    } catch (error) {
      const notDispatched = await this.pool.query(
        "update generation_jobs set status='failed', user_error_code='QUEUE_UNAVAILABLE', user_error_message='任务队列暂时不可用', retryable=true, finished_at=now(), updated_at=now() where id=$1 and status='pending' and provider_submission_state='not_started' returning id",
        [job.id],
      );
      // An enqueue acknowledgement can be lost after a Worker has already taken
      // the job. Preserve its execution and reservation instead of marking it free.
      if (!notDispatched.rowCount) {
        return serializeJob((await this.pool.query('select * from generation_jobs where id=$1', [job.id])).rows[0]);
      }
      await this.pool.query(
        "insert into job_events(job_id,project_id,node_key,sequence,event_type,status,progress,message) select id,project_id,node_key,coalesce((select max(sequence)+1 from job_events where job_id=$1),1),'job.failed','failed',0,'任务队列暂时不可用' from generation_jobs where id=$1",
        [job.id],
      );
      await this.credits?.releaseReservation(String(job.id)).catch(() => undefined);
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

  async directorSettings() {
    const result = await this.pool.query(
      `select coalesce(s.value->>'enabled','true') enabled,s.value->>'modelId' model_id,c.display_name
       from (select value from platform_settings where key='director_settings') s
       left join model_catalog c on c.id=s.value->>'modelId'`,
    );
    const row = result.rows[0];
    return {
      enabled: row ? row.enabled !== "false" : true,
      modelId: row?.model_id || null,
      modelDisplayName: row?.display_name || null,
    };
  }

  async pendingDirectorJob(userId: string) {
    const result = await this.pool.query(
      `select id,status,
         input_snapshot->'trace'->'inputSnapshot'->>'idea' idea,
         input_snapshot->'trace'->'inputSnapshot'->>'profile' profile
       from generation_jobs
       where created_by=$1
         and input_snapshot->'trace'->>'workflowKind'='director.workflow'
         and status not in ('failed','cancelled','payment_required')
         and created_at>=now()-interval '24 hours'
       order by created_at desc limit 1`,
      [userId],
    );
    return result.rows[0]
      ? {
          id: String(result.rows[0].id),
          status: String(result.rows[0].status),
          idea: String(result.rows[0].idea || ""),
          profile: String(result.rows[0].profile || "auto"),
        }
      : null;
  }

  async directorHistory(userId: string) {
    const result = await this.pool.query(
      `select j.*,
         j.input_snapshot->'trace'->'inputSnapshot'->>'idea' idea,
         j.input_snapshot->'trace'->'inputSnapshot'->>'profile' profile
       from generation_jobs j
       join projects p on p.id=j.project_id and p.deleted_at is null
       where j.created_by=$1
         and j.input_snapshot->'trace'->>'workflowKind'='director.workflow'
       order by j.created_at desc
       limit 200`,
      [userId],
    );
    return result.rows.map((row) => {
      const job = serializeJob(row);
      return {
        id: String(job.id),
        status: String(job.status),
        idea: String(row.idea || ""),
        profile: String(row.profile || "auto"),
        retryable: Boolean(job.retryable),
        error: job.error,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      };
    });
  }

  async list(projectId: string, userId: string) {
    await assertProjectAccess(this.pool, projectId, userId);
    const result = await this.pool.query(
      "select * from generation_jobs where project_id=$1 and not (coalesce(compiled_request->'providerMetadata','{}'::jsonb) ? 'nativeAgentStepId') order by created_at desc limit 200",
      [projectId],
    );
    if(result.rows.some(r=>r.input_snapshot?.trace?.inputSnapshot?.knowledgeSources?.length))await requireKnowledgeFeaturePg(this.pool,userId);
    return result.rows.map(serializeJob);
  }
  async get(jobId: string, userId: string) {
    const result = await this.pool.query(
      `select j.* from generation_jobs j join project_members m on m.project_id=j.project_id join projects p on p.id=j.project_id where j.id=$1 and m.user_id=$2 and p.deleted_at is null`,
      [jobId, userId],
    );
    if (!result.rows[0]) return null;
    if(result.rows[0].compiled_request?.providerMetadata?.nativeAgentStepId) await assertNativeJobVisible(this.pool,jobId,userId);
    if(result.rows[0].input_snapshot?.trace?.inputSnapshot?.knowledgeSources?.length)await requireKnowledgeFeaturePg(this.pool,userId);
    const artifacts = String(result.rows[0].credit_delivery_status) === "released"
      ? await this.pool.query(
          "select id,asset_id,asset_version_id,role,sort_order,mime_type,metadata from job_artifacts where job_id=$1 order by sort_order",
          [jobId],
        )
      : { rows: [] };
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
    if (result.rows.length) {
      const knowledge = await this.pool.query(
        "select 1 from generation_jobs where id=any($1::uuid[]) and jsonb_array_length(coalesce(input_snapshot #> '{trace,inputSnapshot,knowledgeSources}','[]'::jsonb))>0 limit 1",
        [result.rows.map(row => row.job_id)],
      );
      if (knowledge.rowCount) await requireKnowledgeFeaturePg(this.pool, userId);
    }
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
    const native=(await this.pool.query("select id from generation_jobs where id=$1 and coalesce(compiled_request->'providerMetadata','{}'::jsonb) ? 'nativeAgentStepId'",[jobId])).rows.length;
    if(native)await assertNativeJobVisible(this.pool,jobId,userId);

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
  async retryReceipt(jobId: string,userId: string,operationId: string) {
    await resolveActiveUser(this.pool,{userId});
    if(!await this.get(jobId,userId))return null;
    const found=await this.pool.query('select result_job_id,original_job_id from job_retry_operations where actor_id=$1 and operation_id=$2',[userId,operationId]);
    if(!found.rows.length)return null;
    if(found.rows[0].original_job_id!==jobId)throw new DomainError('RETRY_OPERATION_MISMATCH','重试操作属于另一任务',409);
    return this.get(found.rows[0].result_job_id,userId);
  }
  async retry(jobId: string, userId: string, operation?: { retryOperationId: string; expectedInputFingerprint?: string }) {
    await resolveActiveUser(this.pool,{userId});
    const result = await this.pool.query(
      `select j.* from generation_jobs j
         join project_members m on m.project_id=j.project_id
         join projects p on p.id=j.project_id
        where j.id=$1 and m.user_id=$2 and p.deleted_at is null`,
      [jobId, userId],
    );
    const current = result.rows[0];
    if(current?.compiled_request?.providerMetadata?.nativeAgentStepId) throw new DomainError("AGENT_RETRY_RESTRICTED","原生推理请核查原Run与模型步骤，不通过普通任务重试重新收费",409);
    if (!current) return null;
    await assertProjectAccess(
      this.pool,
      String(current.project_id),
      userId,
      "edit",
    );
    const snapshot = current.input_snapshot as CreateJobInput | null;
    if (!snapshot)
      throw new DomainError("JOB_SNAPSHOT_MISSING", "任务缺少可重试参数", 409);
    const sources=snapshot.trace?.inputSnapshot?.knowledgeSources;
    if(Array.isArray(sources)&&sources.length)await new KnowledgeService(drizzle(this.pool,{schema:knowledgeTables})).validateJobSources(userId,String(current.project_id),sources as any);
    const operationId=operation?.retryOperationId ?? `legacy:${jobId}`;
    const payloadHash=createHash('sha256').update(JSON.stringify({jobId,inputFingerprint:current.request_fingerprint,expectedInputFingerprint:operation?.expectedInputFingerprint??null})).digest('hex');
    const receipt=(await this.pool.query('select * from job_retry_operations where actor_id=$1 and operation_id=$2',[userId,operationId])).rows[0];
    if(receipt){
      if(receipt.payload_hash!==payloadHash)throw new DomainError('RETRY_OPERATION_MISMATCH','重试操作ID已用于不同参数',409);
      return serializeJob((await this.pool.query('select * from generation_jobs where id=$1',[receipt.result_job_id])).rows[0]);
    }
    if(operation?.expectedInputFingerprint && operation.expectedInputFingerprint!==current.request_fingerprint)throw new DomainError('RETRY_INPUT_CHANGED','任务输入校验不匹配',409);
    assertRetrySubmissionKnown(current);
    if (current.status !== "failed" || !current.retryable)throw new DomainError("JOB_NOT_RETRYABLE", "当前任务不能重试", 409);
    return this.create(
      String(current.project_id),
      userId,
      { ...snapshot, idempotencyKey: `retry:${userId}:${operationId}:${jobId}` },
      jobId,
      {operationId,payloadHash},
    );
  }
  private async markCancelled(jobId: string) {
    const updated = await this.pool.query(
      "update generation_jobs set status='cancelled',finished_at=now(),updated_at=now() where id=$1 and status='cancel_requested' returning *",
      [jobId],
    );
    if (!updated.rows[0]) return;
    if(canReleaseUnsubmittedReservation(updated.rows[0]))await this.credits?.releaseReservation(jobId).catch(() => undefined);
    else await this.billing?.finalizeProviderUsage(jobId).catch(()=>undefined);
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
    private readonly storageQuota?: StorageQuotaService,
    private readonly credits?: CreditService,
    private readonly nativeAgentExecution = false,
  ) {}
  async execute(jobId: string, attempt: number, signal?: AbortSignal) {
    const row = (
      await this.pool.query("select * from generation_jobs where id=$1", [
        jobId,
      ])
    ).rows[0];
    if (!row) return;
    if (row.compiled_request?.providerMetadata?.nativeAgentStepId && !this.nativeAgentExecution) return {managedBy:"native-agent"};
    if (["completed", "failed", "cancelled", "billing_pending", "payment_required"].includes(row.status)) return;
    if (row.status === "cancel_requested") return this.cancel(row, signal);
    const submitting = await this.pool.query(
      "update generation_jobs set status='submitting',progress=greatest(progress,1),attempt_count=$2,started_at=coalesce(started_at,now()),heartbeat_at=now(),updated_at=now() where id=$1 and status not in ('cancel_requested','cancelled','completed','failed','billing_pending','payment_required') returning id",
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
    let dispatched = false;
    let providerResponded = false;
    try {
      const knowledgeSources = row.input_snapshot?.trace?.inputSnapshot?.knowledgeSources;
      assertKnowledgeGenerationEnabled(knowledgeSources);
      if (!row.provider_job_id && Array.isArray(knowledgeSources) && knowledgeSources.length)
        await new KnowledgeService(drizzle(this.pool, { schema: knowledgeTables })).validateJobSources(String(row.created_by), String(row.project_id), knowledgeSources);
      const provider = this.providerFor(String(row.provider));
      const compiled = row.provider_job_id
        ? undefined
        : await this.gateway.compile(
            await this.resolveAssetReferences(
              row.input_snapshot as GenerationInput,
              String(row.project_id),
              String(row.provider),
            ),
          );
      if(!row.provider_job_id){
        const claimed=await this.pool.query("update generation_jobs set provider_submission_state='dispatching' where id=$1 and (provider_submission_state in ('not_started','rejected') or (provider_submission_state='legacy' and $2::int=0)) returning id",[jobId,Number(row.attempt_count||0)]);
        if(!claimed.rowCount)throw new DomainError('PROVIDER_SUBMISSION_UNCONFIRMED','供应商提交状态不明，请核查原任务与账单，禁止盲重试',409);
        dispatched=true;
      }
      let result = row.provider_job_id
        ? await provider.get(
            String(row.provider_job_id),
            providerSignal,
            row.capability as GenerationInput["capability"],
          )
        : await provider.create(compiled!, jobId, providerSignal);
      providerResponded=true;
      if(dispatched)await this.pool.query("update generation_jobs set provider_submission_state=$2 where id=$1",[jobId,result.providerJobId?'accepted':'resolved']);
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
      if(dispatched && !providerResponded && !activeProviderJobId){
        const status=error instanceof ProviderError?Number(error.safeDetails.status):0;
        const rejected=[400,401,403,404,422,429].includes(status);
        await this.pool.query("update generation_jobs set provider_submission_state=$2 where id=$1",[jobId,rejected?'rejected':'unknown']);
      }
      if (error instanceof ProviderError && isRecord(error.safeDetails.usage))
        await this.billing
          ?.recordMeterUsage(jobId, error.safeDetails.usage)
          .catch(() => undefined);
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
      if ((dispatched && !activeProviderJobId && !(error instanceof ProviderError && [400,401,403,404,422,429].includes(Number(error.safeDetails.status)))) || (error instanceof DomainError && error.code==='PROVIDER_SUBMISSION_UNCONFIRMED')) {
        mapped.retryable=false;
        mapped.code='PROVIDER_SUBMISSION_UNCONFIRMED';
        mapped.message='供应商提交状态不明，请先核查原任务和账单，已停止自动重试';
      }
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
    if (!row || ["completed", "failed", "cancelled", "billing_pending", "payment_required"].includes(row.status))
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
      if (result.usage)
        await this.billing
          ?.recordMeterUsage(jobId, result.usage)
          .catch(() => undefined);
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
      if (error instanceof ProviderError && isRecord(error.safeDetails.usage))
        await this.billing
          ?.recordMeterUsage(jobId, error.safeDetails.usage)
          .catch(() => undefined);
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
    await this.pool.query(
      `update generation_jobs set status='billing_pending',credit_delivery_status='billing_pending',
       progress=100,output_asset_version_ids='[]'::jsonb,finished_at=now(),heartbeat_at=now(),updated_at=now()
       where id=$1 and status <> 'cancel_requested'`,
      [jobId],
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
    await this.billing?.finalizeProviderUsage(jobId).catch(() => undefined);
    const delivered = (
      await this.pool.query(
        "select status,credit_delivery_status from generation_jobs where id=$1",
        [jobId],
      )
    ).rows[0];
    if (delivered?.credit_delivery_status === "billing_pending")
      await this.event(
        row,
        "job.billing_pending",
        "billing_pending",
        100,
        "生成已完成，正在核对实际费用",
      );
    return {
      artifacts: delivered?.credit_delivery_status === "released" ? artifacts : [],
    };
  }
  async markAttemptFailed(jobId: string, final: boolean) {
    const row = (
      await this.pool.query("select * from generation_jobs where id=$1", [
        jobId,
      ])
    ).rows[0];
    if (
      !row ||
      ["cancel_requested", "cancelled", "completed", "failed", "billing_pending", "payment_required"].includes(
        row.status,
      )
    )
      return;
    const status = final ? "failed" : "retrying";
    await this.pool.query(
      "update generation_jobs set status=$2,finished_at=case when $3 then now() else null end,updated_at=now() where id=$1",
      [jobId, status, final],
    );
    if (final)
      await this.billing?.finalizeProviderUsage(jobId).catch(() => undefined);
    if (final && !this.billing && canReleaseUnsubmittedReservation(row))
      await this.credits?.closeTerminalWithoutCharge(jobId).catch(() => undefined);
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
    await this.billing
      ?.finalizeProviderUsage(String(row.id))
      .catch(() => undefined);
    const submission=(await this.pool.query('select * from generation_jobs where id=$1',[row.id])).rows[0];
    if (submission && canReleaseUnsubmittedReservation(submission))
      await this.credits?.closeTerminalWithoutCharge(String(row.id)).catch(() => undefined);
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
      const assetKind = generatedAssetKind(artifact.kind, trace.assetKind);
      let thumbnail:
        | { storageKey: string; mimeType: string; bytes: Uint8Array }
        | undefined;
      let videoMetadata: VideoMetadata | undefined;
      if (assetKind === "video") {
        try {
          videoMetadata = await readVideoMetadata(bytes, this.config.ffmpegPath, `video.${extension}`);
        } catch {
          console.warn(`[generation-worker] video metadata unavailable for job ${row.id}`);
        }
        try {
          const thumbnailBytes = await createVideoThumbnail(bytes, this.config.ffmpegPath, `video.${extension}`);
          const thumbnailStorageKey = `projects/${row.project_id}/generated/${row.id}/${index}.thumbnail.jpg`;
          thumbnail = { storageKey: thumbnailStorageKey, mimeType: "image/jpeg", bytes: thumbnailBytes };
        } catch (error) {
          console.warn(`[generation-worker] video thumbnail skipped for job ${row.id}:`, error instanceof Error ? error.message : "unknown error");
        }
      }
      const reservationKey = `generation:${row.id}:${index}`;
      await this.storageQuota?.reserve(
        String(row.created_by),
        bytes.byteLength + (thumbnail?.bytes.byteLength || 0),
        reservationKey,
      );
      const uploadedKeys: string[] = [];
      try {
        await markPersisting();
        await this.storage.put(storageKey, bytes, artifact.mimeType, sha256);
        uploadedKeys.push(storageKey);
        if (thumbnail) {
          await this.storage.put(
            thumbnail.storageKey,
            thumbnail.bytes,
            thumbnail.mimeType,
            createHash("sha256").update(thumbnail.bytes).digest("hex"),
          );
          uploadedKeys.push(thumbnail.storageKey);
        }
        const client = await this.pool.connect();
        try {
          await client.query("begin");
          const asset = await client.query(
            "insert into assets(project_id,kind,name,status,created_by) values($1,$2,$3,'payment_locked',$4) returning id",
            [
              row.project_id,
              assetKind,
              trace.assetName ||
                `${assetKind}-${String(row.id).slice(0, 8)}-${index + 1}.${extension}`,
              row.created_by,
            ],
          );
          const version = await client.query(
            "insert into asset_versions(asset_id,version,storage_key,mime_type,bytes,sha256,source,source_job_id,provenance,created_by,thumbnail_storage_key,thumbnail_mime_type,thumbnail_bytes,width,height,duration_ms) values($1,1,$2,$3,$4,$5,'generation',$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id",
            [
              asset.rows[0].id,
              storageKey,
              artifact.mimeType,
              bytes.byteLength,
              sha256,
              row.id,
              buildArtifactProvenance(row),
              row.created_by,
              thumbnail?.storageKey || null,
              thumbnail?.mimeType || null,
              thumbnail?.bytes.byteLength || null,
              videoMetadata?.width ?? null,
              videoMetadata?.height ?? null,
              videoMetadata?.durationMs ?? null,
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
          await client.query("rollback").catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
      } catch (error) {
        await Promise.allSettled(uploadedKeys.map((key) => this.storage.delete(key)));
        throw error;
      } finally {
        await this.storageQuota?.release(reservationKey).catch(() => undefined);
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
    providerId: string,
  ): Promise<GenerationInput> {
    const references = await Promise.all(
      (input.references || []).map(async (reference) => {
        if (reference.virtualPortraitId) {
          const result = await this.pool.query(
            `select vp.provider_asset_id, v.storage_key, v.mime_type
               from virtual_portraits vp
               join virtual_portrait_libraries vpl on vpl.id=vp.library_id
               join asset_versions v on v.id=vp.source_asset_version_id
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
            url:
              providerId === "token360"
                ? `asset://${portrait.provider_asset_id}`
                : await this.storage.createDownloadUrl(portrait.storage_key),
            ...(providerId === "token360"
              ? {}
              : { storageKey: portrait.storage_key }),
            mimeType: reference.mimeType || portrait.mime_type || "image/png",
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
        if (!(await this.storage.stat(version.storage_key)))
          throw new DomainError("OBJECT_NOT_FOUND", "参考素材不可用，原文件缺失；未向供应商提交", 422);
        return {
          ...reference,
          url: await this.storage.createDownloadUrl(version.storage_key),
          storageKey: version.storage_key,
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
    retryOperationId: row.retry_operation_id,
    providerSubmissionState: row.provider_submission_state,
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
    creditDeliveryStatus: row.credit_delivery_status,
    creditsReserved: String(row.credits_reserved || 0),
    creditsDue: String(row.credits_due || 0),
    billingLastCheckedAt:
      row.billing_last_checked_at?.toISOString?.() ||
      row.billing_last_checked_at,
    outputAssetVersionIds: row.output_asset_version_ids || [],
    knowledgeSources: (Array.isArray(row.input_snapshot?.trace?.inputSnapshot?.knowledgeSources) ? row.input_snapshot.trace.inputSnapshot.knowledgeSources : []).map(({ text, ...source }: Record<string, unknown>) => source),
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
  if (error instanceof DomainError)
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: error.details || {},
    };
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
          : await fetchRemoteMedia(currentUrl, {
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
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
