import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DomainError } from "../domain.js";
import {
  mapSubtitles,
  validateTimeline,
  type MediaAsset,
  type Analysis,
  type Timeline,
} from "./contract.js";
const selection = z
  .object({
    asset_index: z.number().int().nonnegative(),
    source_in: z.number().int().nonnegative(),
    source_out: z.number().int().positive(),
    clip_id: z.string().uuid().optional(),
    volume: z.number().min(0).max(2).optional(),
    muted: z.boolean().optional(),
    fade_ms: z.number().int().nonnegative().optional(),
  })
  .strict();
export const selectionPlanSchema = z
  .object({
    clips: z.array(selection).optional(),
    audio: z
      .array(
        selection.extend({ timeline_start: z.number().int().nonnegative() }),
      )
      .optional(),
    subtitles: z
      .array(
        z
          .object({
            start: z.number().int().nonnegative(),
            end: z.number().int().positive(),
            text: z.string().trim().min(1).max(2000),
          })
          .strict(),
      )
      .optional(),
    warnings: z.array(z.string()).default([]),
  })
  .strict();
export const selectionPlanJsonSchema = z.toJSONSchema(selectionPlanSchema);
// First cuts select source ranges only. Captions, effects and output coordinates are program-owned.
export const initialSelectionPlanSchema = z
  .object({
    clips: z
      .array(
        selection
          .pick({ asset_index: true, source_in: true, source_out: true })
          .strict(),
      )
      .min(1),
  })
  .strict();
export const initialSelectionPlanJsonSchema = z.toJSONSchema(
  initialSelectionPlanSchema,
);
export function compileSelectionPlan(
  raw: unknown,
  id: string,
  assets: MediaAsset[],
  analyses: Record<string, Analysis>,
  aspect: Timeline["aspect_ratio"],
  before: Timeline | null,
  subtitleOnly: boolean,
) {
  const plan: z.infer<typeof selectionPlanSchema> = before
    ? selectionPlanSchema.parse(raw)
    : { ...initialSelectionPlanSchema.parse(raw), warnings: [] };
  if (subtitleOnly) {
    if (!before || !plan.subtitles)
      throw new DomainError(
        "AUTOCUT_SUBTITLES_REQUIRED",
        "字幕修改需要已有时间线和合法字幕",
        422,
      );
    return validateTimeline(
      {
        ...before,
        subtitles: plan.subtitles.map((s) => ({ ...s, id: randomUUID() })),
      },
      id,
      assets,
      analyses,
    );
  }
  if (!plan.clips?.length)
    throw new DomainError(
      "AUTOCUT_PLAN_EMPTY",
      "模型没有选择可用画面，请补充素材或调整要求",
      422,
    );
  const compileClip = (s: z.infer<typeof selection>) => {
    const asset = assets[s.asset_index];
    if (!asset)
      throw new DomainError(
        "AUTOCUT_PLAN_UNKNOWN_ASSET",
        "模型引用了不存在的素材序号",
        422,
      );
    if (
      s.clip_id &&
      !before?.tracks.some((t) =>
        t.clips.some(
          (c) => c.id === s.clip_id && c.asset_version_id === asset.id,
        ),
      )
    )
      throw new DomainError(
        "AUTOCUT_PLAN_UNKNOWN_CLIP",
        "模型引用了不存在的旧片段",
        422,
      );
    const old = before?.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === s.clip_id);
    const fade = s.fade_ms ?? old?.transitions.duration ?? 0;
    return {
      id: s.clip_id || randomUUID(),
      asset_id: asset.assetId,
      asset_version_id: asset.id,
      source_in: s.source_in,
      source_out: s.source_out,
      timeline_start: 0,
      effects: {
        volume: s.volume ?? old?.effects.volume ?? 1,
        muted: s.muted ?? old?.effects.muted ?? false,
      },
      transitions: {
        type: fade ? ("fade" as const) : ("cut" as const),
        duration: fade,
      },
    };
  };
  let cursor = 0;
  const clips = plan.clips.map((s) => {
    const c = compileClip(s);
    c.timeline_start = cursor;
    cursor += s.source_out - s.source_in;
    return c;
  });
  const audio = plan.audio?.map((s) => ({
    ...compileClip(s),
    timeline_start: s.timeline_start,
  }));
  const t: Timeline = {
    schema_version: 1,
    project_id: id,
    revision_id: randomUUID(),
    target_duration: cursor,
    aspect_ratio: aspect,
    fps: before?.fps || 25,
    tracks: [
      {
        id: before?.tracks.find((t) => t.kind === "video")?.id || randomUUID(),
        kind: "video",
        clips,
      },
      ...(audio
        ? [{ id: randomUUID(), kind: "audio" as const, clips: audio }]
        : before?.tracks.filter((t) => t.kind === "audio") || []),
    ],
    subtitles: plan.subtitles?.map((s) => ({ ...s, id: randomUUID() })) || [],
    audio_settings: before?.audio_settings || { master_volume: 1 },
    export_settings: { codec: "h264", format: "mp4", resolution: 720 },
    warnings: plan.warnings.filter(
      (w) =>
        !/schema|json|metadata|uuid|subtitles|不可信|程序映射|元数据|audio.*轨道/i.test(
          w,
        ),
    ),
  };
  if (!plan.audio && before)
    for (const track of t.tracks.filter((t) => t.kind === "audio"))
      track.clips = track.clips
        .filter((c) => c.timeline_start < cursor)
        .map((c) => ({
          ...c,
          source_out: Math.min(
            c.source_out,
            c.source_in + cursor - c.timeline_start,
          ),
        }));
  if (!before) t.subtitles = mapSubtitles(t, analyses);
  else if (plan.subtitles === undefined)
    t.subtitles = retainedSubtitles(before, t, analyses);
  // Source dialogue already lives in each visual clip. Reject accidental duplication into a second audio track.
  if (
    audio?.some(
      (a) =>
        !a.effects.muted &&
        clips.some(
          (v) =>
            !v.effects.muted &&
            v.asset_version_id === a.asset_version_id &&
            v.source_in === a.source_in &&
            v.source_out === a.source_out &&
            v.timeline_start === a.timeline_start,
        ),
    )
  )
    throw new DomainError(
      "AUTOCUT_AUDIO_DUPLICATED",
      "模型将原声重复加入音轨，已停止执行",
      422,
    );
  return validateTimeline(t, id, assets, analyses);
}

function retainedSubtitles(
  before: Timeline,
  next: Timeline,
  analyses: Record<string, Analysis>,
) {
  if (!before.subtitles.length) return [];
  const oldClips = before.tracks
    .filter((t) => t.kind === "video")
    .flatMap((t) => t.clips);
  return next.tracks
    .filter((t) => t.kind === "video")
    .flatMap((t) =>
      t.clips.flatMap((c) => {
        const cues = oldClips
          .filter((o) => o.asset_version_id === c.asset_version_id)
          .flatMap((o) =>
            before.subtitles.flatMap((s) => {
              const start = Math.max(s.start, o.timeline_start),
                end = Math.min(
                  s.end,
                  o.timeline_start + o.source_out - o.source_in,
                );
              if (end <= start) return [];
              const a = Math.max(
                  c.source_in,
                  o.source_in + start - o.timeline_start,
                ),
                b = Math.min(
                  c.source_out,
                  o.source_in + end - o.timeline_start,
                );
              return b > a
                ? [
                    {
                      id: randomUUID(),
                      start: c.timeline_start + a - c.source_in,
                      end: c.timeline_start + b - c.source_in,
                      text: s.text,
                    },
                  ]
                : [];
            }),
          );
        if (!cues.length)
          return mapSubtitles(
            { ...next, tracks: [{ ...t, clips: [c] }] },
            analyses,
          );
        const unique = new Set<string>();
        return cues.filter((s) => {
          const key = `${s.start}:${s.end}:${s.text}`;
          if (unique.has(key)) return false;
          unique.add(key);
          return true;
        });
      }),
    );
}
