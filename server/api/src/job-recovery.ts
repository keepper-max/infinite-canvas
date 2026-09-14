import type { Pool } from "pg";

type RecoverableQueueJob = {
  getState(): Promise<string>;
  remove(): Promise<void>;
};

export type ProviderRecoveryQueue = {
  getJob(jobId: string): Promise<RecoverableQueueJob | undefined>;
  add(
    name: string,
    data: { jobId: string },
    options: {
      jobId: string;
      attempts: number;
      backoff: { type: "exponential"; delay: number };
    },
  ): Promise<unknown>;
};

export function isStalledQueueJobError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("job stalled more than allowable limit")
  );
}

const ACTIVE_QUEUE_STATES = new Set([
  "active",
  "waiting",
  "delayed",
  "prioritized",
  "waiting-children",
]);

export async function recoverInterruptedProviderJobs(
  pool: Pool,
  queue: ProviderRecoveryQueue,
  attempts: number,
) {
  const candidates = await pool.query(
    `select id,project_id,node_key,progress
       from generation_jobs
      where capability='video'
        and provider_job_id is not null
        and status in ('submitting','running','downloading','persisting')
        and cancel_requested_at is null
      order by created_at`,
  );
  const recovered: string[] = [];
  for (const row of candidates.rows) {
    const versions = await pool.query(
      "select asset_version_id from job_artifacts where job_id=$1 and asset_version_id is not null order by sort_order",
      [row.id],
    );
    if (versions.rowCount) {
      const versionIds = versions.rows.map((item) => item.asset_version_id);
      await pool.query(
        "update generation_jobs set status='completed',progress=100,output_asset_version_ids=$2,finished_at=now(),heartbeat_at=now(),updated_at=now() where id=$1 and status in ('submitting','running','downloading','persisting')",
        [row.id, JSON.stringify(versionIds)],
      );
      continue;
    }
    const queued = await queue.getJob(String(row.id));
    if (queued) {
      const state = await queued.getState();
      if (ACTIVE_QUEUE_STATES.has(state)) continue;
      await queued.remove();
    }
    await queue.add(
      "generation",
      { jobId: String(row.id) },
      {
        jobId: String(row.id),
        attempts,
        backoff: { type: "exponential", delay: 2_000 },
      },
    );
    await pool.query(
      "update generation_jobs set status='retrying',retryable=true,user_error_code=null,user_error_message=null,error_reason=null,finished_at=null,heartbeat_at=now(),updated_at=now() where id=$1 and status in ('submitting','running','downloading','persisting')",
      [row.id],
    );
    await pool.query(
      "insert into job_events(job_id,project_id,node_key,sequence,event_type,status,progress,message) values($1,$2,$3,coalesce((select max(sequence)+1 from job_events where job_id=$1),1),'job.recovering','retrying',$4,'正在恢复已生成结果')",
      [row.id, row.project_id, row.node_key, Number(row.progress || 0)],
    );
    recovered.push(String(row.id));
  }
  return recovered;
}
