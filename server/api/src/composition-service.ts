import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool, PoolClient } from "pg";

import type {
  CreateCompositionJobInput,
  TimelineDocument,
} from "./composition-contract.js";
import type { JobConfig } from "./config.js";
import { DomainError } from "./domain.js";
import type { ObjectStorage } from "./object-storage.js";
import { assertProjectAccess } from "./project-access.js";

export type CompositionQueuePort = {
  add(jobId: string, attempts: number): Promise<void>;
  remove(jobId: string): Promise<boolean>;
};
type Publisher = (projectId: string) => Promise<unknown>;

export class CompositionService {
  constructor(
    private readonly pool: Pool,
    private readonly queue: CompositionQueuePort,
    private readonly config: JobConfig,
    private readonly publish: Publisher = async () => undefined,
  ) {}

  async create(
    projectId: string,
    userId: string,
    input: CreateCompositionJobInput,
  ) {
    await assertProjectAccess(this.pool, projectId, userId, "edit");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ ...input, idempotencyKey: undefined }))
      .digest("hex");
    const duplicate = await this.pool.query(
      "select * from composition_jobs where project_id=$1 and idempotency_key=$2",
      [projectId, input.idempotencyKey],
    );
    if (duplicate.rows[0])
      return this.assertDuplicate(duplicate.rows[0], fingerprint);
    await assertAssetVersions(
      this.pool,
      projectId,
      collectAssetVersionIds(input.timeline),
    );

    const client = await this.pool.connect();
    let row: Record<string, unknown>;
    try {
      await client.query("begin");
      await assertProjectAccess(client, projectId, userId, "edit");
      const timelineResult = await client.query(
        `insert into timelines(project_id,node_key,name,created_by) values($1,$2,$3,$4)
         on conflict(project_id,node_key) do update set name=excluded.name,updated_at=now() returning *`,
        [projectId, input.nodeId, input.name, userId],
      );
      const timeline = timelineResult.rows[0];
      const nextVersion = await client.query(
        "select coalesce(max(version),0)+1 as version from timeline_versions where timeline_id=$1",
        [timeline.id],
      );
      const version = await client.query(
        "insert into timeline_versions(timeline_id,version,document,created_by) values($1,$2,$3,$4) returning *",
        [timeline.id, nextVersion.rows[0].version, input.timeline, userId],
      );
      await client.query(
        "update timelines set current_version_id=$2,updated_at=now() where id=$1",
        [timeline.id, version.rows[0].id],
      );
      const result = await client.query(
        `insert into composition_jobs(project_id,node_key,timeline_version_id,created_by,idempotency_key,request_fingerprint,status)
         values($1,$2,$3,$4,$5,$6,'pending')
         on conflict(project_id,idempotency_key) do nothing returning *`,
        [
          projectId,
          input.nodeId,
          version.rows[0].id,
          userId,
          input.idempotencyKey,
          fingerprint,
        ],
      );
      if (!result.rows[0]) {
        const raced = await client.query(
          "select * from composition_jobs where project_id=$1 and idempotency_key=$2",
          [projectId, input.idempotencyKey],
        );
        if (!raced.rows[0])
          throw new DomainError(
            "COMPOSITION_CONFLICT",
            "成片任务创建冲突",
            409,
          );
        await client.query("rollback");
        return this.assertDuplicate(raced.rows[0], fingerprint);
      }
      row = result.rows[0];
      await appendEvent(
        client,
        row,
        "composition.created",
        "pending",
        0,
        "成片任务已创建",
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    try {
      await this.queue.add(String(row.id), this.config.maxAttempts);
      await this.pool.query(
        "update composition_jobs set status='queued',updated_at=now() where id=$1",
        [row.id],
      );
      row.status = "queued";
      await this.event(
        row,
        "composition.queued",
        "queued",
        0,
        "成片任务已进入队列",
      );
    } catch (error) {
      await this.pool.query(
        "update composition_jobs set status='failed',retryable=true,error_code='QUEUE_UNAVAILABLE',error_message='成片队列暂时不可用',finished_at=now(),updated_at=now() where id=$1",
        [row.id],
      );
      await this.event(
        row,
        "composition.failed",
        "failed",
        0,
        "成片队列暂时不可用",
      );
      throw new DomainError(
        "QUEUE_UNAVAILABLE",
        "成片队列暂时不可用",
        503,
        true,
        { cause: error },
      );
    }
    return serialize(row);
  }

  async list(projectId: string, userId: string) {
    await assertProjectAccess(this.pool, projectId, userId);
    const result = await this.pool.query(
      "select * from composition_jobs where project_id=$1 order by created_at desc limit 100",
      [projectId],
    );
    return result.rows.map(serialize);
  }

  async get(jobId: string, userId: string) {
    const result = await this.pool.query(
      `select j.* from composition_jobs j join project_members m on m.project_id=j.project_id join projects p on p.id=j.project_id where j.id=$1 and m.user_id=$2 and p.deleted_at is null`,
      [jobId, userId],
    );
    return result.rows[0] ? serialize(result.rows[0]) : null;
  }

  async events(projectId: string, userId: string, after = 0) {
    await assertProjectAccess(this.pool, projectId, userId);
    const result = await this.pool.query(
      "select * from composition_job_events where project_id=$1 and id>$2 order by id asc limit 200",
      [projectId, after],
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      jobId: row.job_id,
      type: row.event_type,
      status: row.status,
      progress: row.progress,
      message: row.message,
      data: row.data,
      createdAt: row.created_at.toISOString(),
    }));
  }

  async cancel(jobId: string, userId: string) {
    const result = await this.pool.query(
      `update composition_jobs j set status='cancel_requested',cancel_requested_at=now(),updated_at=now()
       from project_members m, projects p where j.id=$1 and m.project_id=j.project_id and p.id=j.project_id and p.deleted_at is null and m.user_id=$2
       and m.role in ('owner','admin','editor')
       and j.status in ('pending','queued','preparing','rendering','uploading','retrying') returning j.*`,
      [jobId, userId],
    );
    if (!result.rows[0]) return this.get(jobId, userId);
    const row = result.rows[0];
    await this.event(
      row,
      "composition.cancel_requested",
      "cancel_requested",
      Number(row.progress),
      "正在取消成片任务",
    );
    if (await this.queue.remove(jobId)) await this.markCancelled(jobId);
    return this.get(jobId, userId);
  }

  async retry(jobId: string, userId: string) {
    const current = await this.get(jobId, userId);
    if (!current) return null;
    await assertProjectAccess(
      this.pool,
      String(current.projectId),
      userId,
      "edit",
    );
    if (current.status !== "failed" || !current.retryable)
      throw new DomainError(
        "COMPOSITION_NOT_RETRYABLE",
        "当前成片任务不能重试",
        409,
      );
    await this.queue.remove(jobId);
    const result = await this.pool.query(
      `update composition_jobs set status='retrying',progress=0,attempts=0,error_code=null,error_message=null,retryable=false,
       cancel_requested_at=null,started_at=null,finished_at=null,updated_at=now() where id=$1 returning *`,
      [jobId],
    );
    try {
      await this.queue.add(jobId, this.config.maxAttempts);
      await this.event(
        result.rows[0],
        "composition.retrying",
        "retrying",
        0,
        "成片任务正在重试",
      );
    } catch (error) {
      const failed = await this.pool.query(
        "update composition_jobs set status='failed',retryable=true,error_code='QUEUE_UNAVAILABLE',error_message='成片队列暂时不可用',finished_at=now(),updated_at=now() where id=$1 returning *",
        [jobId],
      );
      await this.event(
        failed.rows[0],
        "composition.failed",
        "failed",
        0,
        "成片队列暂时不可用",
      );
      throw new DomainError(
        "QUEUE_UNAVAILABLE",
        "成片队列暂时不可用",
        503,
        true,
        { cause: error },
      );
    }
    return serialize(result.rows[0]);
  }

  async markCancelled(jobId: string) {
    const result = await this.pool.query(
      "update composition_jobs set status='cancelled',finished_at=now(),updated_at=now() where id=$1 and status='cancel_requested' returning *",
      [jobId],
    );
    if (result.rows[0])
      await this.event(
        result.rows[0],
        "composition.cancelled",
        "cancelled",
        Number(result.rows[0].progress),
        "成片任务已取消",
      );
  }

  private assertDuplicate(row: Record<string, unknown>, fingerprint: string) {
    if (row.request_fingerprint !== fingerprint)
      throw new DomainError(
        "IDEMPOTENCY_CONFLICT",
        "重复请求的内容不一致",
        409,
      );
    return serialize(row);
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
      "insert into composition_job_events(job_id,project_id,event_type,status,progress,message,data) values($1,$2,$3,$4,$5,$6,$7)",
      [row.id, row.project_id, type, status, progress, message, data],
    );
    await this.publish(String(row.project_id)).catch(() => undefined);
  }
}

export class CompositionExecutor {
  constructor(
    private readonly pool: Pool,
    private readonly storage: ObjectStorage,
    private readonly config: JobConfig,
    private readonly publish: Publisher = async () => undefined,
  ) {}

  async execute(jobId: string, attempt: number) {
    const fetched = await this.pool.query(
      `select j.*,v.document,t.name from composition_jobs j
       join timeline_versions v on v.id=j.timeline_version_id join timelines t on t.id=v.timeline_id where j.id=$1`,
      [jobId],
    );
    const row = fetched.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error("Composition job not found");
    if (row.status === "cancel_requested" || row.status === "cancelled")
      return this.markCancelled(row);
    const updated = await this.pool.query(
      `update composition_jobs set status='preparing',progress=5,attempts=$2,started_at=coalesce(started_at,now()),updated_at=now()
       where id=$1 and status not in ('completed','cancelled','cancel_requested') returning *`,
      [jobId, attempt],
    );
    if (!updated.rows[0]) return;
    Object.assign(row, updated.rows[0]);
    await this.event(
      row,
      "composition.preparing",
      "preparing",
      5,
      "正在准备素材",
    );
    const document = row.document as TimelineDocument;
    const tempDir = await mkdtemp(join(tmpdir(), "jingjie-compose-"));
    try {
      const inputs = await this.prepareInputs(row, document, tempDir);
      await this.assertNotCancelled(row);
      await this.setStatus(row, "rendering", 35, "正在合成画面、声音与字幕");
      const outputPath = join(tempDir, "episode.mp4");
      try {
        await runFfmpeg(
          this.config.ffmpegPath,
          buildFfmpegArgs(document, inputs, outputPath),
          () => this.isCancelled(String(row.id)),
        );
      } catch (error) {
        if (await this.isCancelled(String(row.id))) {
          await this.markCancelled(row);
          throw new CompositionCancelledError();
        }
        throw error;
      }
      await this.assertNotCancelled(row);
      await this.setStatus(row, "uploading", 85, "正在保存成片");
      const coverPath = join(tempDir, "cover.jpg");
      try {
        await runFfmpeg(
          this.config.ffmpegPath,
          ["-i", outputPath, "-frames:v", "1", "-q:v", "2", "-y", coverPath],
          () => this.isCancelled(String(row.id)),
        );
      } catch (error) {
        if (await this.isCancelled(String(row.id))) {
          await this.markCancelled(row);
          throw new CompositionCancelledError();
        }
        throw error;
      }
      const bytes = await readFile(outputPath);
      const coverBytes = await readFile(coverPath);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const coverSha256 = createHash("sha256").update(coverBytes).digest("hex");
      const storageKey = `projects/${row.project_id}/compositions/${row.id}/episode.mp4`;
      const coverStorageKey = `projects/${row.project_id}/compositions/${row.id}/cover.jpg`;
      const uploadedKeys: string[] = [];
      try {
        await this.storage.put(storageKey, bytes, "video/mp4", sha256);
        uploadedKeys.push(storageKey);
        await this.storage.put(
          coverStorageKey,
          coverBytes,
          "image/jpeg",
          coverSha256,
        );
        uploadedKeys.push(coverStorageKey);
        await this.persistOutput(
          row,
          storageKey,
          bytes.byteLength,
          sha256,
          coverStorageKey,
          coverBytes.byteLength,
          document,
        );
      } catch (error) {
        await Promise.allSettled(
          uploadedKeys.map((key) => this.storage.delete(key)),
        );
        throw error;
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  async markFailed(jobId: string, terminal: boolean, error: unknown) {
    const message =
      error instanceof Error ? error.message.slice(0, 1_000) : "成片合成失败";
    const result = await this.pool.query(
      `update composition_jobs set status=$2,retryable=$3,error_code='FFMPEG_FAILED',error_message=$4,
       finished_at=case when $3 then null else now() end,updated_at=now()
       where id=$1 and status not in ('completed','cancelled','cancel_requested') returning *`,
      [jobId, terminal ? "failed" : "retrying", !terminal, message],
    );
    if (result.rows[0])
      await this.event(
        result.rows[0],
        terminal ? "composition.failed" : "composition.retrying",
        terminal ? "failed" : "retrying",
        Number(result.rows[0].progress),
        terminal ? "成片合成失败" : "成片合成失败，正在重试",
        { error: message },
      );
  }

  private async prepareInputs(
    row: Record<string, unknown>,
    document: TimelineDocument,
    tempDir: string,
  ) {
    const versions = [...document.video, ...document.audio];
    const result: string[] = [];
    for (let index = 0; index < versions.length; index++) {
      await this.assertNotCancelled(row);
      const versionId = versions[index]!.assetVersionId;
      const found = await this.pool.query(
        `select v.storage_key,v.mime_type from asset_versions v join assets a on a.id=v.asset_id
         where v.id=$1 and a.project_id=$2 and a.status='active' and a.trashed_at is null`,
        [versionId, row.project_id],
      );
      if (!found.rows[0])
        throw new DomainError(
          "ASSET_VERSION_NOT_FOUND",
          "时间线素材不存在或不属于当前项目",
          422,
        );
      const suffix = extensionFromMime(found.rows[0].mime_type);
      const path = join(
        tempDir,
        `input-${String(index).padStart(3, "0")}.${suffix}`,
      );
      await writeFile(path, await this.storage.get(found.rows[0].storage_key));
      result.push(path);
      await this.setStatus(
        row,
        "preparing",
        5 + Math.round(((index + 1) / versions.length) * 25),
        `正在准备素材 ${index + 1}/${versions.length}`,
      );
    }
    if (document.subtitles.length) {
      const subtitlePath = join(tempDir, "subtitles.srt");
      await writeFile(subtitlePath, toSrt(document.subtitles), "utf8");
      result.push(subtitlePath);
    }
    return result;
  }

  private async persistOutput(
    row: Record<string, unknown>,
    storageKey: string,
    bytes: number,
    sha256: string,
    coverStorageKey: string,
    coverBytes: number,
    document: TimelineDocument,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const asset = await client.query(
        "insert into assets(project_id,kind,name,status,created_by) values($1,'video',$2,'active',$3) returning id",
        [row.project_id, `${row.name || "成片"}.mp4`, row.created_by],
      );
      const version = await client.query(
        `insert into asset_versions(asset_id,version,storage_key,mime_type,bytes,width,height,duration_ms,sha256,source,source_job_id,parent_version_ids,provenance,thumbnail_storage_key,thumbnail_mime_type,thumbnail_bytes,created_by)
         values($1,1,$2,'video/mp4',$3,$4,$5,$6,$7,'composition',$8,$9,$10,$11,'image/jpeg',$12,$13) returning id`,
        [
          asset.rows[0].id,
          storageKey,
          bytes,
          document.output.width,
          document.output.height,
          document.video.reduce((total, clip) => total + clip.durationMs, 0),
          sha256,
          row.id,
          collectAssetVersionIds(document),
          {
            compositionJobId: row.id,
            timelineVersionId: row.timeline_version_id,
          },
          coverStorageKey,
          coverBytes,
          row.created_by,
        ],
      );
      await client.query(
        "update assets set current_version_id=$2,updated_at=now() where id=$1",
        [asset.rows[0].id, version.rows[0].id],
      );
      const completed = await client.query(
        `update composition_jobs set status='completed',progress=100,output_asset_id=$2,output_asset_version_id=$3,
         error_code=null,error_message=null,retryable=false,finished_at=now(),updated_at=now() where id=$1 returning *`,
        [row.id, asset.rows[0].id, version.rows[0].id],
      );
      await appendEvent(
        client,
        completed.rows[0],
        "composition.completed",
        "completed",
        100,
        "成片已生成",
        { assetId: asset.rows[0].id, assetVersionId: version.rows[0].id },
      );
      await client.query("commit");
      await this.publish(String(row.project_id)).catch(() => undefined);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  private async isCancelled(jobId: string) {
    const result = await this.pool.query(
      "select status from composition_jobs where id=$1",
      [jobId],
    );
    return ["cancel_requested", "cancelled"].includes(result.rows[0]?.status);
  }

  private async assertNotCancelled(row: Record<string, unknown>) {
    if (await this.isCancelled(String(row.id))) {
      await this.markCancelled(row);
      throw new CompositionCancelledError();
    }
  }

  private async markCancelled(row: Record<string, unknown>) {
    const result = await this.pool.query(
      "update composition_jobs set status='cancelled',finished_at=now(),updated_at=now() where id=$1 and status='cancel_requested' returning *",
      [row.id],
    );
    if (result.rows[0])
      await this.event(
        result.rows[0],
        "composition.cancelled",
        "cancelled",
        Number(result.rows[0].progress),
        "成片任务已取消",
      );
  }

  private async setStatus(
    row: Record<string, unknown>,
    status: string,
    progress: number,
    message: string,
  ) {
    const result = await this.pool.query(
      "update composition_jobs set status=$2,progress=$3,updated_at=now() where id=$1 and status <> 'cancel_requested' returning *",
      [row.id, status, progress],
    );
    if (!result.rows[0]) return this.assertNotCancelled(row);
    Object.assign(row, result.rows[0]);
    await this.event(row, `composition.${status}`, status, progress, message);
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
      "insert into composition_job_events(job_id,project_id,event_type,status,progress,message,data) values($1,$2,$3,$4,$5,$6,$7)",
      [row.id, row.project_id, type, status, progress, message, data],
    );
    await this.publish(String(row.project_id)).catch(() => undefined);
  }
}

export class CompositionCancelledError extends Error {
  constructor() {
    super("Composition cancelled");
    this.name = "CompositionCancelledError";
  }
}

function buildFfmpegArgs(
  document: TimelineDocument,
  inputs: string[],
  outputPath: string,
) {
  const subtitlePath = document.subtitles.length
    ? inputs[inputs.length - 1]
    : undefined;
  const mediaInputs = subtitlePath ? inputs.slice(0, -1) : inputs;
  const args = mediaInputs.flatMap((path) => ["-i", path]);
  const filters: string[] = [];
  let cursorMs = 0;
  document.video.forEach((clip, index) => {
    const duration = clip.durationMs / 1_000;
    const fade =
      clip.transition === "fade" && clip.transitionMs > 0
        ? Math.min(clip.transitionMs / 1_000, duration / 2)
        : 0;
    const fadeFilters = fade
      ? `,fade=t=in:st=0:d=${fade},fade=t=out:st=${Math.max(0, duration - fade)}:d=${fade}`
      : "";
    filters.push(
      `[${index}:v]trim=start=${clip.trimStartMs / 1_000}:duration=${duration},setpts=PTS-STARTPTS,scale=${document.output.width}:${document.output.height}:force_original_aspect_ratio=decrease,pad=${document.output.width}:${document.output.height}:(ow-iw)/2:(oh-ih)/2,fps=${document.output.fps},setsar=1,format=yuv420p${fadeFilters}[v${index}]`,
    );
    cursorMs += clip.durationMs;
  });
  filters.push(
    `${document.video.map((_, index) => `[v${index}]`).join("")}concat=n=${document.video.length}:v=1:a=0[vbase]`,
  );
  if (subtitlePath)
    filters.push(
      `[vbase]subtitles=filename='${escapeFilterPath(subtitlePath)}':force_style='FontName=WenQuanYi Zen Hei,FontSize=${document.output.subtitleFontSize},Alignment=2,MarginV=36,Outline=2'[vout]`,
    );
  else filters.push("[vbase]null[vout]");
  document.audio.forEach((track, index) => {
    const inputIndex = document.video.length + index;
    const duration = track.durationMs
      ? `:duration=${track.durationMs / 1_000}`
      : "";
    filters.push(
      `[${inputIndex}:a]atrim=start=${track.trimStartMs / 1_000}${duration},asetpts=PTS-STARTPTS,adelay=${track.startMs}:all=1,volume=${track.volume}[a${index}]`,
    );
  });
  if (document.audio.length)
    filters.push(
      `${document.audio.map((_, index) => `[a${index}]`).join("")}amix=inputs=${document.audio.length}:duration=longest:normalize=0[aout]`,
    );
  args.push("-filter_complex", filters.join(";"), "-map", "[vout]");
  if (document.audio.length)
    args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "192k");
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-movflags",
    "+faststart",
    "-t",
    String(cursorMs / 1_000),
    "-y",
    outputPath,
  );
  return args;
}

async function runFfmpeg(
  binary: string,
  args: string[],
  isCancelled: () => Promise<boolean>,
) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, {
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-16_000);
    });
    const timer = setInterval(
      () =>
        void isCancelled()
          .then((cancelled) => cancelled && child.kill("SIGTERM"))
          .catch(() => undefined),
      750,
    );
    child.once("error", reject);
    child.once("close", (code) => {
      clearInterval(timer);
      if (code === 0) resolve();
      else
        reject(new Error(stderr.trim() || `FFmpeg exited with code ${code}`));
    });
  });
}

function toSrt(cues: TimelineDocument["subtitles"]) {
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n${srtTime(cue.startMs)} --> ${srtTime(cue.endMs)}\n${cue.text.replace(/\r?\n/g, " ")}\n`,
    )
    .join("\n");
}
function srtTime(ms: number) {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1_000);
  const millis = ms % 1_000;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${String(millis).padStart(3, "0")}`;
}
function pad(value: number) {
  return String(value).padStart(2, "0");
}
function escapeFilterPath(path: string) {
  return path.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}
function extensionFromMime(mime: string) {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("quicktime")) return "mov";
  return mime.startsWith("audio/") ? "m4a" : "mp4";
}
function collectAssetVersionIds(document: TimelineDocument) {
  return [
    ...new Set([
      ...document.video.map((item) => item.assetVersionId),
      ...document.audio.map((item) => item.assetVersionId),
    ]),
  ];
}
async function assertAssetVersions(
  executor: Pick<Pool, "query"> | PoolClient,
  projectId: string,
  ids: string[],
) {
  const result = await executor.query(
    "select count(*)::int as count from asset_versions v join assets a on a.id=v.asset_id where v.id=any($1::uuid[]) and a.project_id=$2 and a.status='active' and a.trashed_at is null",
    [ids, projectId],
  );
  if (Number(result.rows[0]?.count) !== ids.length)
    throw new DomainError(
      "ASSET_VERSION_NOT_FOUND",
      "时间线包含不可用素材",
      422,
    );
}
async function appendEvent(
  client: PoolClient,
  row: Record<string, unknown>,
  type: string,
  status: string,
  progress: number,
  message: string,
  data: Record<string, unknown> = {},
) {
  await client.query(
    "insert into composition_job_events(job_id,project_id,event_type,status,progress,message,data) values($1,$2,$3,$4,$5,$6,$7)",
    [row.id, row.project_id, type, status, progress, message, data],
  );
}
function serialize(row: Record<string, unknown>) {
  return {
    id: row.id,
    projectId: row.project_id,
    nodeId: row.node_key,
    timelineVersionId: row.timeline_version_id,
    status: row.status,
    progress: Number(row.progress || 0),
    attempts: Number(row.attempts || 0),
    retryable: Boolean(row.retryable),
    error: row.error_message
      ? {
          code: row.error_code,
          message: row.error_message,
          retryable: Boolean(row.retryable),
        }
      : null,
    outputAssetId: row.output_asset_id,
    outputAssetVersionId: row.output_asset_version_id,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : row.updated_at,
  };
}
