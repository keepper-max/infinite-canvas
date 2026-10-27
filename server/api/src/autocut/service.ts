import { validateDocument, requireP1 } from "./p1/contract.js";
import type { P1Timeline } from "./p1/runtime.js";
import type { Timeline } from "./contract.js";
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DomainError } from "../domain.js";
import { assertProjectAccess, resolveActiveUser } from "../project-access.js";
import {
  analysisSchema,
  createProjectSchema,
  taskSchema,
  validateTimeline,
  type Analysis,
  type MediaAsset,
} from "./contract.js";

export type AutoCutQueue = {
  add(id: string): Promise<void>;
  remove(id: string): Promise<boolean>;
};
const active = ["queued", "running"];
type Db = Pick<Pool, "query"> | PoolClient;
export class AutoCutService {
  constructor(
    readonly pool: Pool,
    private queue: AutoCutQueue,
    readonly enabled: boolean,
  ) {}
  async acceptingTasks(db: Db = this.pool) {
    if (!this.enabled || process.env.AUTOCUT_ACCEPT_NEW_TASKS === "false")
      return false;
    const result = await db.query(
      "select value from platform_settings where key='autocut_admission'",
    );
    return result.rows[0]?.value?.accepting !== false;
  }
  private async admit(db: Db, actor: string, budget: number) {
    await db.query(
      "select pg_advisory_xact_lock(hashtextextended('autocut:admission',0))",
    );
    if (!(await this.acceptingTasks(db)))
      throw new DomainError(
        "AUTOCUT_PAUSED",
        "智能剪辑暂停接收新任务，已有工程和费用记录保留",
        503,
      );
    if (budget > 1000)
      throw new DomainError(
        "AUTOCUT_BUDGET_LIMIT",
        "单任务预算最高人民币10元",
        422,
      );
    const counts = (
      await db.query(
        "select count(*)::int total,count(*) filter(where actor_id=$1)::int owned from autocut_tasks where status in ('queued','running')",
        [actor],
      )
    ).rows[0];
    if (counts.owned >= 2 || counts.total >= 20)
      throw new DomainError(
        "AUTOCUT_QUEUE_LIMIT",
        "待处理任务已达上限，请等待已有任务完成",
        429,
      );
  }
  async owner(id: string, actor: string, edit = false, db: Db = this.pool) {
    await resolveActiveUser(db, { userId: actor });
    const p = (
      await db.query(
        `select * from autocut_projects where id=$1 and created_by=$2${edit ? " for update" : ""}`,
        [id, actor],
      )
    ).rows[0];
    if (!p)
      throw new DomainError(
        "AUTOCUT_NOT_FOUND",
        "剪辑工程不存在或无权访问",
        404,
      );
    await assertProjectAccess(db, p.project_id, actor, edit ? "edit" : "read");
    if (edit && p.archived_at)
      throw new DomainError(
        "AUTOCUT_ARCHIVED",
        "工程已归档，不能继续编辑",
        409,
      );
    return p;
  }
  async assets(
    projectId: string,
    actor: string,
    ids: string[],
    db: Db = this.pool,
  ): Promise<MediaAsset[]> {
    await assertProjectAccess(db, projectId, actor);
    const result = await db.query(
      `select v.id,v.asset_id as "assetId",v.mime_type as "mimeType",v.storage_key as "storageKey",v.bytes::float8,v.sha256,a.name
      from asset_versions v join assets a on a.id=v.asset_id
      where v.id=any($1::uuid[]) and a.project_id=$2 and a.status='active' and a.trashed_at is null`,
      [ids, projectId],
    );
    if (
      result.rows.length !== new Set(ids).size ||
      result.rows.some(
        (a) =>
          !/^(video\/(mp4|quicktime)|image\/(jpeg|png|webp)|audio\/(mpeg|mp3|wav|x-wav|mp4|x-m4a))$/.test(
            a.mimeType,
          ),
      )
    )
      throw new DomainError(
        "AUTOCUT_ASSET_FORBIDDEN",
        "素材不可用、格式不支持或不属于当前项目",
        422,
      );
    return ids.map((id) => result.rows.find((a) => a.id === id));
  }
  async create(projectId: string, actor: string, raw: unknown) {
    const p = createProjectSchema.parse(raw);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await resolveActiveUser(client, { userId: actor });
      await assertProjectAccess(client, projectId, actor, "edit");
      await this.assets(projectId, actor, p.assetVersionIds, client);
      const project = (
        await client.query(
          "insert into autocut_projects(project_id,created_by,name,asset_version_ids) values($1,$2,$3,$4) returning *",
          [projectId, actor, p.name, [...new Set(p.assetVersionIds)]],
        )
      ).rows[0];
      await client.query(
        "insert into asset_links(project_id,asset_version_id,role,metadata) select $1,unnest($2::uuid[]),'autocut_input',$3",
        [
          projectId,
          project.asset_version_ids,
          { autocutProjectId: project.id },
        ],
      );
      await client.query("commit");
      return project;
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }
  async list(projectId: string, actor: string) {
    await assertProjectAccess(this.pool, projectId, actor);
    return (
      await this.pool.query(
        "select * from autocut_projects where project_id=$1 and created_by=$2 and archived_at is null order by updated_at desc",
        [projectId, actor],
      )
    ).rows;
  }
  async analyses(
    p: { asset_version_ids: string[] },
    version?: string,
    db: Db = this.pool,
  ): Promise<Record<string, Analysis>> {
    const rows = (
      await db.query(
        `select distinct on(asset_version_id) asset_version_id,document from autocut_analyses
      where asset_version_id=any($1::uuid[]) and ($2::text is null or analyzer_version=$2) order by asset_version_id,created_at desc`,
        [p.asset_version_ids, version ?? null],
      )
    ).rows;
    return Object.fromEntries(
      rows.map((r) => [r.asset_version_id, analysisSchema.parse(r.document)]),
    );
  }
  async get(id: string, actor: string) {
    const p = await this.owner(id, actor);
    const assets = await this.assets(p.project_id, actor, p.asset_version_ids);
    const revisions = (
      await this.pool.query(
        "select id,parent_id,created_at from autocut_revisions where project_id=$1 order by created_at desc",
        [id],
      )
    ).rows;
    const document = p.current_revision_id
      ? (
          await this.pool.query(
            "select document from autocut_revisions where id=$1 and project_id=$2",
            [p.current_revision_id, id],
          )
        ).rows[0]?.document
      : null;
    const tasks = (
      await this.pool.query(
        "select * from autocut_tasks where project_id=$1 and actor_id=$2 order by created_at desc",
        [id, actor],
      )
    ).rows;
    const calls = (
      await this.pool.query(
        `select c.task_id,c.call_key,c.quote_cents,c.generation_job_id,j.model_id,j.status,j.billing_status,j.billing_meter_usage,j.started_at,j.finished_at,
      u.cost_cny::text from autocut_model_calls c join autocut_tasks t on t.id=c.task_id
      left join generation_jobs j on j.id=c.generation_job_id left join generation_usage u on u.job_id=j.id
      where t.project_id=$1 and t.actor_id=$2`,
        [id, actor],
      )
    ).rows;
    // Storage keys and server-side request inputs are never exposed by this endpoint.
    return {
      project: p,
      assets: assets.map(({ storageKey, ...a }) => a),
      analyses: await this.analyses(p),
      revisions,
      timeline: document,
      tasks,
      calls,
    };
  }
  async save(
    id: string,
    actor: string,
    expected: string | null,
    raw: unknown,
    taskId?: string,
  ): Promise<Timeline> {
    if ((raw as { schema_version?: unknown })?.schema_version === 2)
      throw new DomainError(
        "AUTOCUT_P1_ROUTE_REQUIRED",
        "v2工程请使用精修接口保存",
        422,
      );
    return this.saveDocument(
      id,
      actor,
      expected,
      raw,
      taskId,
    ) as Promise<Timeline>;
  }
  async saveP1(
    id: string,
    actor: string,
    expected: string | null,
    raw: unknown,
    taskId?: string,
  ): Promise<P1Timeline> {
    requireP1();
    if ((raw as { schema_version?: unknown })?.schema_version !== 2)
      throw new DomainError("AUTOCUT_P1_INVALID", "精修接口只接收v2工程", 422);
    return this.saveDocument(
      id,
      actor,
      expected,
      raw,
      taskId,
    ) as Promise<P1Timeline>;
  }
  private async saveDocument(
    id: string,
    actor: string,
    expected: string | null,
    raw: unknown,
    taskId?: string,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const p = await this.owner(id, actor, true, client);
      await client.query(
        "select id from autocut_projects where id=$1 for update",
        [id],
      );
      const current = (
        await client.query(
          "select current_revision_id from autocut_projects where id=$1",
          [id],
        )
      ).rows[0];
      if (current.current_revision_id !== expected)
        throw new DomainError(
          "AUTOCUT_REVISION_CONFLICT",
          "工程已被修改，请刷新后重试",
          409,
        );
      if (taskId) {
        const t = (
          await client.query(
            "select * from autocut_tasks where id=$1 and project_id=$2 for update",
            [taskId, id],
          )
        ).rows[0];
        if (!t || t.cancel_requested || t.status !== "running")
          throw new DomainError("AUTOCUT_CANCELLED", "任务已停止", 409);
      } else if (
        (
          await client.query(
            "select 1 from autocut_tasks where project_id=$1 and status=any($2)",
            [id, active],
          )
        ).rowCount
      )
        throw new DomainError(
          "AUTOCUT_BUSY",
          "请先停止当前任务再修改时间线",
          409,
        );
      const t = validateDocument(
        raw,
        id,
        await this.assets(p.project_id, actor, p.asset_version_ids, client),
        await this.analyses(p, undefined, client),
      );
      t.revision_id = randomUUID();
      await client.query(
        "insert into autocut_revisions(id,project_id,parent_id,document,created_by) values($1,$2,$3,$4,$5)",
        [t.revision_id, id, expected, t, actor],
      );
      await client.query(
        "update autocut_projects set current_revision_id=$2,updated_at=now() where id=$1",
        [id, t.revision_id],
      );
      if (taskId)
        await client.query(
          "update autocut_tasks set output_revision_id=$2 where id=$1",
          [taskId, t.revision_id],
        );
      await client.query("commit");
      return t;
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }
  async restore(
    id: string,
    actor: string,
    expected: string | null,
    revision: string,
  ) {
    await this.owner(id, actor, true);
    const row = (
      await this.pool.query(
        "select document from autocut_revisions where id=$1 and project_id=$2",
        [revision, id],
      )
    ).rows[0];
    if (!row)
      throw new DomainError("AUTOCUT_REVISION_NOT_FOUND", "版本不存在", 404);
    return row.document?.schema_version === 2
      ? this.saveP1(id, actor, expected, row.document)
      : this.save(id, actor, expected, row.document);
  }
  async addP1Assets(
    id: string,
    actor: string,
    expected: string | null,
    ids: string[],
  ) {
    requireP1();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const p = await this.owner(id, actor, true, client);
      if (p.current_revision_id !== expected)
        throw new DomainError(
          "AUTOCUT_REVISION_CONFLICT",
          "请刷新工程后重试",
          409,
        );
      if (
        (
          await client.query(
            "select 1 from autocut_tasks where project_id=$1 and status=any($2)",
            [id, active],
          )
        ).rowCount
      )
        throw new DomainError("AUTOCUT_BUSY", "请先等待或停止当前任务", 409);
      const all = [...new Set([...p.asset_version_ids, ...ids])];
      if (all.length > 20)
        throw new DomainError("AUTOCUT_ASSET_LIMIT", "工程最多20项素材", 422);
      await this.assets(p.project_id, actor, all, client);
      const fresh = all.filter((v) => !p.asset_version_ids.includes(v));
      await client.query(
        "update autocut_projects set asset_version_ids=$2,updated_at=now() where id=$1",
        [id, all],
      );
      if (fresh.length)
        await client.query(
          "insert into asset_links(project_id,asset_version_id,role,metadata) select $1,unnest($2::uuid[]),'autocut_input',$3",
          [p.project_id, fresh, { autocutProjectId: id }],
        );
      await client.query("commit");
      return { assetVersionIds: all };
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }
  async archive(id: string, actor: string) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await this.owner(id, actor, true, client);
      await client.query(
        "select id from autocut_projects where id=$1 for update",
        [id],
      );
      if (
        (
          await client.query(
            "select 1 from autocut_tasks where project_id=$1 and status=any($2)",
            [id, active],
          )
        ).rowCount
      )
        throw new DomainError("AUTOCUT_BUSY", "请先停止当前任务再归档", 409);
      await client.query(
        "update autocut_projects set archived_at=now(),updated_at=now() where id=$1",
        [id],
      );
      // Canvas synchronization only replaces links with non-null node_id, so these references survive normal canvas saves.
      await client.query(
        "delete from asset_links where role in ('autocut_input','autocut_output') and metadata->>'autocutProjectId'=$1",
        [id],
      );
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }
  async start(id: string, actor: string, raw: unknown) {
    if (!this.enabled)
      throw new DomainError(
        "AUTOCUT_DISABLED",
        "智能剪辑 Worker 或模型尚未配置",
        503,
      );
    const input = taskSchema.parse(raw),
      hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    if (["edit", "effects"].includes(input.kind) && !input.confirmed)
      throw new DomainError(
        "AUTOCUT_BUDGET_CONFIRM",
        "请先确认本次人民币预算上限",
        409,
      );
    if (["prepare", "export", "effects"].includes(input.kind) || input.p1) {
      requireP1();
      if (input.p1?.version !== 1)
        throw new DomainError("AUTOCUT_P1_INVALID", "缺少P1操作协议", 422);
      if (
        input.kind === "export" &&
        (!input.p1.format || !process.env.AUTOCUT_P1_EXPORT_PYTHON)
      )
        throw new DomainError(
          "AUTOCUT_EXPORT_UNCONFIGURED",
          "工程导出Python运行环境未配置",
          503,
        );
      if (
        input.kind === "export" &&
        input.p1.format === "capcut" &&
        process.env.AUTOCUT_P1_CAPCUT_LICENSE_APPROVED !== "true"
      )
        throw new DomainError(
          "AUTOCUT_EXPORT_LICENSE",
          "CapCut依赖许可证尚未批准，暂不启用",
          422,
        );
      if (input.p1?.previewClipId && input.kind !== "render")
        throw new DomainError(
          "AUTOCUT_P1_SCOPE",
          "片段预览只能使用渲染任务",
          422,
        );
      if (input.kind === "effects" && !input.p1.clipIds?.length)
        throw new DomainError(
          "AUTOCUT_P1_SCOPE",
          "请选择AI允许调整的片段",
          422,
        );
    }
    const client = await this.pool.connect();
    let row;
    try {
      await client.query("begin");
      const p = await this.owner(id, actor, true, client);
      await client.query(
        "select id from autocut_projects where id=$1 for update",
        [id],
      );
      const prior = (
        await client.query(
          "select * from autocut_tasks where actor_id=$1 and operation_id=$2",
          [actor, input.operationId],
        )
      ).rows[0];
      if (prior) {
        if (prior.project_id !== id || prior.fingerprint !== hash)
          throw new DomainError(
            "AUTOCUT_IDEMPOTENCY_CONFLICT",
            "操作编号已经用于其他请求",
            409,
          );
        await client.query("commit");
        return prior;
      }
      const current = (
        await client.query(
          "select current_revision_id from autocut_projects where id=$1",
          [id],
        )
      ).rows[0];
      if (current.current_revision_id !== input.expectedRevision)
        throw new DomainError(
          "AUTOCUT_REVISION_CONFLICT",
          "请刷新工程后重试",
          409,
        );
      if (
        (["render", "export", "effects"].includes(input.kind) ||
          input.scope === "subtitles") &&
        !input.expectedRevision
      )
        throw new DomainError(
          "AUTOCUT_TIMELINE_REQUIRED",
          "请先生成并保存时间线",
          422,
        );
      if (current.current_revision_id) {
        const doc = (
          await client.query(
            "select document from autocut_revisions where id=$1 and project_id=$2",
            [current.current_revision_id, id],
          )
        ).rows[0]?.document;
        if (
          input.kind === "export" &&
          !input.p1?.acceptLossy &&
          (doc?.effect_stack?.length ||
            doc?.tracks?.some(
              (tr: { clips: { transitions?: { type: string } }[] }) =>
                tr.clips.some((c) => c.transitions?.type === "fade"),
            ))
        )
          throw new DomainError(
            "AUTOCUT_EXPORT_LOSSY",
            "工程含目标软件不能保证还原的效果，请先确认兼容性降级",
            422,
          );
        if (doc?.schema_version === 2) {
          requireP1();
          if (input.kind === "edit")
            throw new DomainError(
              "AUTOCUT_P1_SCOPE",
              "v2工程请在精修台选择片段后使用独立AI效果入口；不会重写v3粗剪协议",
              422,
            );
        }
      }
      if (
        (
          await client.query(
            "select 1 from autocut_tasks where project_id=$1 and status=any($2)",
            [id, active],
          )
        ).rowCount
      )
        throw new DomainError("AUTOCUT_BUSY", "工程已有运行中的任务", 409);
      await this.assets(p.project_id, actor, p.asset_version_ids, client);
      await this.admit(client, actor, input.budgetCents);
      row = (
        await client.query(
          "insert into autocut_tasks(project_id,actor_id,operation_id,fingerprint,input,base_revision_id,budget_cents) values($1,$2,$3,$4,$5,$6,$7) returning *",
          [
            id,
            actor,
            input.operationId,
            hash,
            { ...input, plannerVersion: 3 },
            input.expectedRevision,
            input.budgetCents,
          ],
        )
      ).rows[0];
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
    try {
      await this.queue.add(row.id);
    } catch {
      await this.pool.query(
        "update autocut_tasks set status='failed',error_code='AUTOCUT_QUEUE_UNAVAILABLE',error_message='队列暂不可用，请重试',finished_at=now() where id=$1 and status='queued'",
        [row.id],
      );
      throw new DomainError(
        "AUTOCUT_QUEUE_UNAVAILABLE",
        "队列暂不可用，请重试",
        503,
      );
    }
    return row;
  }
  async cancel(id: string, taskId: string, actor: string) {
    await this.owner(id, actor, true);
    await this.pool.query(
      "update autocut_tasks set cancel_requested=true where id=$1 and project_id=$2 and actor_id=$3 and status=any($4)",
      [taskId, id, actor, active],
    );
    if (await this.queue.remove(taskId))
      await this.pool.query(
        "update autocut_tasks set status='cancelled',finished_at=now() where id=$1 and status='queued'",
        [taskId],
      );
  }
  async retry(id: string, taskId: string, actor: string) {
    await this.owner(id, actor, true);
    const client = await this.pool.connect();
    let row;
    try {
      await client.query("begin");
      const prior = (
        await client.query(
          "select * from autocut_tasks where id=$1 and project_id=$2 and actor_id=$3 for update",
          [taskId, id, actor],
        )
      ).rows[0];
      if (!prior || !["failed", "cancelled"].includes(prior.status))
        throw new DomainError(
          "AUTOCUT_NOT_RETRYABLE",
          "任务不处于可重试状态",
          409,
        );
      await this.admit(client, actor, prior.budget_cents);
      row = (
        await client.query(
          "update autocut_tasks set status='queued',cancel_requested=false,error_code=null,error_message=null,finished_at=null where id=$1 returning *",
          [taskId],
        )
      ).rows[0];
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    // The same task/call IDs reuse already submitted model requests; never silently create a paid retry.
    await this.queue.remove(taskId);
    try {
      await this.queue.add(taskId);
    } catch {
      await this.pool.query(
        "update autocut_tasks set status='failed',error_code='AUTOCUT_QUEUE_UNAVAILABLE',error_message='队列暂不可用',finished_at=now() where id=$1 and status='queued'",
        [taskId],
      );
      throw new DomainError("AUTOCUT_QUEUE_UNAVAILABLE", "队列暂不可用", 503);
    }
    return row;
  }
}
