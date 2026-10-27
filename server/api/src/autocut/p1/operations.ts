import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { join, extname } from "node:path";
import { runMedia, inputSafety, probeMedia } from "../media.js";
import { DomainError } from "../../domain.js";
import type { Pool } from "pg";
import type { ObjectStorage } from "../../object-storage.js";
import type { StorageQuotaService } from "../../storage-quota-service.js";
import type { MediaAsset, Analysis } from "../contract.js";
import {
  upgradeTimeline,
  P1_LIMITS,
  type P1Timeline,
  type V1Input,
  frameValues,
  clipEnd,
} from "./runtime.js";
export async function prepareMedia(
  pool: Pool,
  storage: ObjectStorage,
  quota: StorageQuotaService,
  ffmpeg: string,
  asset: MediaAsset,
  path: string,
  actor: string,
  taskId: string,
  dir: string,
  signal: AbortSignal,
) {
  const exists = (
    await pool.query(
      "select 1 from autocut_analyses where asset_version_id=$1 limit 1",
      [asset.id],
    )
  ).rowCount;
  const info = await probeMedia(ffmpeg, path, signal);
  if (!exists)
    await pool.query(
      "insert into autocut_analyses(asset_version_id,analyzer_version,document) values($1,'p1-media-v1',$2) on conflict do nothing",
      [asset.id, info],
    );
  const v = (
    await pool.query(
      "select thumbnail_storage_key from asset_versions where id=$1",
      [asset.id],
    )
  ).rows[0];
  if (info.kind !== "audio" && !v?.thumbnail_storage_key) {
    const thumb = join(dir, `thumb-${asset.id}.jpg`);
    await runMedia(
      ffmpeg,
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-threads",
        "2",
        "-filter_threads",
        "2",
        ...inputSafety,
        "-i",
        path,
        "-frames:v",
        "1",
        "-vf",
        "scale=320:-2",
        "-threads",
        "2",
        "-y",
        thumb,
      ],
      signal,
    );
    const bytes = await readFile(thumb),
      key = `projects/autocut-previews/${taskId}/${asset.id}.jpg`,
      reservation = `p1-thumb:${taskId}:${asset.id}`;
    await quota.reserve(actor, bytes.length, reservation);
    let persisted = false;
    try {
      await storage.put(
        key,
        bytes,
        "image/jpeg",
        createHash("sha256").update(bytes).digest("hex"),
        signal,
      );
      signal.throwIfAborted();
      const updated = await pool.query(
        "update asset_versions set thumbnail_storage_key=$2,thumbnail_mime_type='image/jpeg',thumbnail_bytes=$3 where id=$1 and thumbnail_storage_key is null",
        [asset.id, key, bytes.length],
      );
      persisted = !!updated.rowCount;
    } finally {
      try {
        if (!persisted) {
          const current = (
            await pool.query(
              "select thumbnail_storage_key from asset_versions where id=$1",
              [asset.id],
            )
          ).rows[0];
          if (current?.thumbnail_storage_key !== key) await storage.delete(key);
        }
      } finally {
        await quota.release(reservation);
      }
    }
  }
  return info;
}
export async function fileHash(path: string) {
  const h = createHash("sha256");
  for await (const b of createReadStream(path)) h.update(b);
  return h.digest("hex");
}
export async function exportBundle(
  ffmpeg: string,
  document: P1Timeline | V1Input,
  assets: MediaAsset[],
  paths: Record<string, string>,
  analyses: Record<string, Analysis>,
  format: string,
  includeMedia: boolean,
  dir: string,
  signal: AbortSignal,
) {
  const python = process.env.AUTOCUT_P1_EXPORT_PYTHON;
  if (!python)
    throw new DomainError(
      "AUTOCUT_EXPORT_UNCONFIGURED",
      "工程导出Python环境未配置",
      503,
    );
  const timeline =
      document.schema_version === 2
        ? document
        : upgradeTimeline(document, (id) => !!analyses[id]?.hasAudio),
    used = new Set(
      timeline.tracks.flatMap((tr) => tr.clips.map((c) => c.asset_version_id)),
    ),
    media = assets.filter((a) => used.has(a.id));
  if (media.reduce((s, a) => s + a.bytes, 0) > P1_LIMITS.packageBytes)
    throw new DomainError(
      "AUTOCUT_PACKAGE_LIMIT",
      "使用的素材总量超过5GiB导出上限",
      422,
    );
  const input = join(dir, "export-input.json"),
    output = join(dir, "export.zip");
  const audioSources: Record<string, string> = {};
  if (format === "jianying" || format === "capcut")
    for (const a of media.filter(
      (a) =>
        a.mimeType.startsWith("video/") &&
        timeline.tracks.some(
          (tr) =>
            tr.kind === "audio" &&
            tr.clips.some((c) => c.asset_version_id === a.id),
        ),
    )) {
      const audio = join(dir, `audio-${a.id}.wav`);
      await runMedia(
        ffmpeg,
        [
          "-nostdin",
          "-hide_banner",
          "-loglevel",
          "error",
          "-threads",
          "2",
          ...inputSafety,
          "-i",
          paths[a.id],
          "-map",
          "0:a:0",
          "-vn",
          "-c:a",
          "pcm_s16le",
          "-ar",
          "48000",
          "-ac",
          "2",
          "-y",
          audio,
        ],
        signal,
      );
      audioSources[a.id] = audio;
    }
  const native: Record<
    string,
    { at: number; values: ReturnType<typeof frameValues> }[]
  > = {};
  for (const tr of timeline.tracks.filter((tr) => tr.kind === "video"))
    for (const c of tr.clips) {
      const times = new Set([c.timeline_start, clipEnd(c)]);
      for (const e of timeline.effect_stack)
        if (e.target.id === c.id || e.target.id === tr.id)
          for (const k of e.keyframes) times.add(k.at);
      native[c.id] = [...times]
        .filter((t) => t >= c.timeline_start && t <= clipEnd(c))
        .sort((a, b) => a - b)
        .map((at) => ({
          at,
          values: frameValues(
            timeline,
            c,
            tr,
            Math.min(at, clipEnd(c) - 0.001),
          ),
        }));
    }
  await writeFile(
    input,
    JSON.stringify({
      timeline: { ...timeline, _native: native },
      format,
      includeMedia,
      maxBytes: P1_LIMITS.packageBytes,
      media: media.map((a) => ({
        id: a.id,
        name: a.name,
        mimeType: a.mimeType,
        bytes: a.bytes,
        sha256: a.sha256,
        durationMs: analyses[a.id]?.durationMs,
        local_source: paths[a.id],
        audio_source: audioSources[a.id],
      })),
    }),
  );
  const script =
    process.env.AUTOCUT_P1_EXPORT_SCRIPT ||
    join(process.cwd(), "scripts", "autocut-p1-export.py");
  await runMedia(
    python,
    [script, "--input", input, "--output", output],
    signal,
  );
  const size = (await stat(output)).size;
  if (size > P1_LIMITS.packageBytes)
    throw new DomainError("AUTOCUT_PACKAGE_LIMIT", "导出包超过5GiB", 422);
  return { output, width: 0, height: 0, bytes: size };
}
