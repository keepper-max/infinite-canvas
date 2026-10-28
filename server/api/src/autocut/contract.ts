import { z } from "zod";
import { DomainError } from "../domain.js";

// All times are integer milliseconds. Source and timeline intervals are [in, out).
export const AUTOCUT_LIMITS = {
  assets: 20,
  keyframes: 20,
  fileBytes: 500 * 1024 * 1024,
  durationMs: 30 * 60_000,
  runtimeMs: 30 * 60_000,
  concurrency: 1,
  threads: 2,
} as const;
const ms = z.number().int().nonnegative();
const clip = z
  .object({
    id: z.string().uuid(),
    asset_id: z.string().uuid(),
    asset_version_id: z.string().uuid(),
    source_in: ms,
    source_out: z.number().int().positive(),
    timeline_start: ms,
    effects: z
      .object({ volume: z.number().min(0).max(2), muted: z.boolean() })
      .strict(),
    transitions: z
      .object({ type: z.enum(["cut", "fade"]), duration: ms })
      .strict(),
  })
  .strict();
export const subtitleSchema = z
  .object({
    id: z.string().uuid(),
    start: ms,
    end: z.number().int().positive(),
    text: z.string().trim().min(1).max(2000),
  })
  .strict();
export const timelineSchema = z
  .object({
    schema_version: z.literal(1),
    project_id: z.string().uuid(),
    revision_id: z.string().uuid(),
    target_duration: z.number().int().positive().max(AUTOCUT_LIMITS.durationMs),
    aspect_ratio: z.enum(["16:9", "9:16", "1:1"]),
    fps: z.union([z.literal(25), z.literal(30)]),
    tracks: z.array(
      z
        .object({
          id: z.string().uuid(),
          kind: z.enum(["video", "audio"]),
          clips: z.array(clip),
        })
        .strict(),
    ),
    subtitles: z.array(subtitleSchema),
    audio_settings: z
      .object({ master_volume: z.number().min(0).max(2) })
      .strict(),
    export_settings: z
      .object({
        codec: z.literal("h264"),
        format: z.literal("mp4"),
        resolution: z.literal(720),
      })
      .strict(),
    warnings: z.array(z.string()),
  })
  .strict();
export type Timeline = z.infer<typeof timelineSchema>;
export type MediaAsset = {
  id: string;
  assetId: string;
  mimeType: string;
  storageKey: string;
  bytes: number;
  sha256: string;
  name: string;
};
export const transcriptSchema = z
  .object({
    segments: z.array(
      z
        .object({
          start: ms,
          end: z.number().int().positive(),
          text: z.string().trim().min(1),
          confidence: z.number().min(0).max(1).nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export const analysisSchema = z
  .object({
    version: z.literal(1),
    durationMs: ms,
    width: ms,
    height: ms,
    fps: z.number().nonnegative(),
    hasAudio: z.boolean(),
    kind: z.enum(["video", "image", "audio"]),
    silences: z.array(z.object({ start: ms, end: ms })),
    scenes: z.array(z.object({ start: ms, end: ms })),
    transcript: transcriptSchema,
    processing: z
      .object({
        preprocessMs: ms,
        asrMs: ms,
        asrApiCostCny: z.literal(0),
        basis: z.literal("local_cpu_no_api_charge"),
      })
      .strict()
      .optional(),
    candidates: z.array(
      z
        .object({
          start: ms,
          end: ms,
          summary: z.string(),
          evidence: z.string(),
          confidence: z.number().min(0).max(1),
        })
        .strict(),
    ),
  })
  .strict();
export type Analysis = z.infer<typeof analysisSchema>;
export const createProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    assetVersionIds: z
      .array(z.string().uuid())
      .min(1)
      .max(AUTOCUT_LIMITS.assets),
  })
  .strict();
export const taskSchema = z
  .object({
    operationId: z.string().uuid(),
    expectedRevision: z.string().uuid().nullable(),
    kind: z.enum(["edit", "render", "prepare", "export", "effects"]),
    prompt: z.string().trim().max(100_000),
    mode: z.enum([
      "auto",
      "highlights",
      "speech",
      "travel",
      "product",
      "custom",
    ]),
    targetDurationMs: z
      .number()
      .int()
      .positive()
      .max(AUTOCUT_LIMITS.durationMs),
    aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
    budgetCents: z.number().int().nonnegative(),
    confirmed: z.boolean(),
    scope: z.enum(["all", "subtitles"]).default("all"),
    p1: z
      .object({
        version: z.literal(1),
        format: z
          .enum(["otio", "fcp7", "jianying", "capcut", "srt"])
          .optional(),
        includeMedia: z.boolean().optional(),
        acceptLossy: z.boolean().optional(),
        previewClipId: z.string().uuid().optional(),
        clipIds: z.array(z.string().uuid()).max(200).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type TaskInput = z.infer<typeof taskSchema>;

export function validateTimeline(
  input: unknown,
  projectId: string,
  assets: MediaAsset[],
  analyses: Record<string, Analysis>,
): Timeline {
  const t = timelineSchema.parse(input);
  const bad = (message: string): never => {
    throw new DomainError("AUTOCUT_INVALID_TIMELINE", message, 422);
  };
  if (t.project_id !== projectId) bad("时间线不属于当前剪辑工程");
  if (t.tracks.filter((x) => x.kind === "video").length !== 1)
    bad("必须有且仅有一条画面轨");
  const ids = new Set<string>();
  let end = 0;
  for (const track of t.tracks) {
    if (ids.has(track.id)) bad("轨道编号重复");
    ids.add(track.id);
    let cursor = 0;
    for (const c of track.clips) {
      if (ids.has(c.id)) bad("片段编号重复");
      ids.add(c.id);
      const a = assets.find(
        (a) => a.id === c.asset_version_id && a.assetId === c.asset_id,
      );
      const info = analyses[c.asset_version_id];
      if (!a || !info) bad("片段引用未授权或未分析的素材");
      if (
        c.source_out <= c.source_in ||
        (info!.kind !== "image" && c.source_out > info!.durationMs)
      )
        bad("片段时间超出素材边界");
      if (info!.kind === "image" && c.source_in !== 0) bad("图片起点必须为零");
      if (track.kind === "video" && info!.kind === "audio")
        bad("音频不能作为画面");
      if (track.kind === "audio" && !info!.hasAudio) bad("素材不含音轨");
      const length = c.source_out - c.source_in;
      if (
        c.transitions.duration > length / 2 ||
        (c.transitions.type === "cut" && c.transitions.duration !== 0) ||
        (track.kind === "audio" && c.transitions.type !== "cut")
      )
        bad("转场参数不合法");
      if (track.kind === "video" && c.timeline_start !== cursor)
        bad("画面片段必须连续且不能重叠，请重新排列");
      cursor = c.timeline_start + length;
      if (track.kind === "video") end = cursor;
      if (cursor > t.target_duration) bad("轨道超出成片时长");
    }
  }
  if (end !== t.target_duration) bad("成片时长与画面轨不一致");
  for (const cue of t.subtitles) {
    if (ids.has(cue.id)) bad("字幕编号重复");
    ids.add(cue.id);
    if (cue.end <= cue.start || cue.end > end) bad("字幕时间超出成片范围");
  }
  return t;
}

export function mapSubtitles(
  timeline: Timeline,
  analyses: Record<string, Analysis>,
) {
  return timeline.tracks
    .filter((t) => t.kind === "video")
    .flatMap((t) =>
      t.clips.flatMap((c) =>
        (analyses[c.asset_version_id]?.transcript.segments ?? [])
          .filter((s) => s.end > c.source_in && s.start < c.source_out)
          .map((s) => ({
            id: crypto.randomUUID(),
            start:
              c.timeline_start + Math.max(s.start, c.source_in) - c.source_in,
            end: c.timeline_start + Math.min(s.end, c.source_out) - c.source_in,
            text: s.text,
          })),
      ),
    );
}

export const timelineJsonSchema = z.toJSONSchema(timelineSchema);
