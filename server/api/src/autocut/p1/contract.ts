import { narrationMixProblem } from "../audio-mix.js";
import { z } from "zod";
import { DomainError } from "../../domain.js";
import {
  validateTimeline as validateV1,
  timelineSchema,
  type Analysis,
  type MediaAsset,
} from "../contract.js";
import {
  P1_LIMITS,
  clipEnd,
  clipDuration,
  primary,
  type P1Timeline,
  type Effect,
} from "./runtime.js";
const ms = z.number().int().nonnegative();
const uuid = z.string().uuid();
const values = z
  .object({
    x: z.number().min(-1).max(1).optional(),
    y: z.number().min(-1).max(1).optional(),
    scale: z.number().min(0.1).max(4).optional(),
    rotation: z.number().min(-360).max(360).optional(),
    opacity: z.number().min(0).max(1).optional(),
    brightness: z.number().min(-1).max(1).optional(),
    contrast: z.number().min(0).max(3).optional(),
    saturation: z.number().min(0).max(3).optional(),
    blur: z.number().min(0).max(20).optional(),
    sharpen: z.number().min(0).max(2).optional(),
    gain: z.number().min(0).max(2).optional(),
  })
  .strict();
const curve = z.enum(["linear", "easeIn", "easeOut", "easeInOut", "hold"]);
export const effectSchema = z
  .object({
    id: uuid,
    version: z.literal(1),
    type: z.enum(["transform", "animation", "transition", "filter", "audio"]),
    target: z
      .object({
        kind: z.enum(["clip", "track", "subtitle", "boundary"]),
        id: uuid,
        next_id: uuid.optional(),
      })
      .strict(),
    start: ms,
    end: ms,
    enabled: z.boolean(),
    interpolation: curve,
    params: values
      .extend({
        style: z
          .enum([
            "cut",
            "dissolve",
            "fade",
            "fadeblack",
            "slideleft",
            "slideright",
            "wipeleft",
            "wiperight",
          ])
          .optional(),
      })
      .strict(),
    keyframes: z
      .array(z.object({ at: ms, values, interpolation: curve }).strict())
      .max(P1_LIMITS.keyframes),
  })
  .strict();
export const p1TimelineSchema = z
  .object({
    schema_version: z.literal(2),
    project_id: uuid,
    revision_id: uuid,
    target_duration: z.number().int().positive().max(1800000),
    aspect_ratio: z.enum(["16:9", "9:16", "1:1"]),
    fps: z.union([z.literal(25), z.literal(30)]),
    tracks: z
      .array(
        z
          .object({
            id: uuid,
            name: z.string().min(1).max(100),
            kind: z.enum(["video", "audio"]),
            role: z.enum(["main", "overlay", "original", "music"]),
            layer: z.number().int().min(0).max(100),
            muted: z.boolean(),
            volume: z.number().min(0).max(2),
            clips: z
              .array(
                z
                  .object({
                    id: uuid,
                    asset_id: uuid,
                    asset_version_id: uuid,
                    source_in: ms,
                    source_out: z.number().int().positive(),
                    timeline_start: ms,
                    speed: z.number().min(0.25).max(4),
                    effects: z
                      .object({
                        volume: z.number().min(0).max(2),
                        muted: z.boolean(),
                      })
                      .strict(),
                    linked_clip_id: uuid.optional(),
                  })
                  .strict(),
              )
              .max(P1_LIMITS.clips),
          })
          .strict(),
      )
      .min(1)
      .max(P1_LIMITS.tracks),
    subtitles: z
      .array(
        z
          .object({
            id: uuid,
            start: ms,
            end: ms,
            text: z.string().trim().min(1).max(2000),
            kind: z.enum(["subtitle", "title"]),
            layer: z.number().int().min(0).max(100),
            font_size: z.number().min(8).max(120),
            color: z.string().regex(/^#[a-fA-F0-9]{6}$/),
            x: z.number().min(-1).max(1),
            y: z.number().min(-1).max(1),
            anchor: z
              .object({ clip_id: uuid, source_in: ms, source_out: ms })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(P1_LIMITS.clips * 10),
    effect_stack: z.array(effectSchema).max(P1_LIMITS.effects),
    audio_settings: timelineSchema.shape.audio_settings,
    export_settings: timelineSchema.shape.export_settings,
    warnings: z.array(z.string().max(2000)),
  })
  .strict();
const allowed: Record<Effect["type"], string[]> = {
  transform: ["x", "y", "scale", "rotation", "opacity"],
  animation: ["x", "y", "scale", "rotation", "opacity"],
  filter: ["brightness", "contrast", "saturation", "blur", "sharpen"],
  audio: ["gain"],
  transition: ["style"],
};
export function p1Enabled(env: NodeJS.ProcessEnv = process.env) {
  return env.AUTOCUT_P1_ENABLED === "true";
}
export function requireP1() {
  if (!p1Enabled())
    throw new DomainError("AUTOCUT_P1_DISABLED", "P1 精修功能尚未启用", 404);
}
export function validateP1(
  input: unknown,
  projectId: string,
  assets: MediaAsset[],
  analyses: Record<string, Analysis>,
): P1Timeline {
  const t = p1TimelineSchema.parse(input);
  const bad = (s: string): never => {
    throw new DomainError("AUTOCUT_P1_INVALID", s, 422);
  };
  if (t.project_id !== projectId) bad("工程归属不符");
  if (
    t.tracks.some(
      (tr) =>
        (tr.role === "main" && tr.layer !== 0) ||
        (tr.role === "overlay" && tr.layer === 0),
    )
  )
    bad("叠加轨必须位于主轨之上");
  if (t.tracks.filter((tr) => tr.role === "main").length !== 1)
    bad("必须有一条视频主轨");
  const ids = new Set<string>();
  const add = (id: string) => {
    if (ids.has(id)) bad("工程编号重复");
    ids.add(id);
  };
  const all = t.tracks.flatMap((tr) => tr.clips);
  if (all.length > P1_LIMITS.clips) bad("片段数量超过上限");
  for (const tr of t.tracks) {
    add(tr.id);
    if ((tr.kind === "video") !== ["main", "overlay"].includes(tr.role))
      bad("轨道类型与用途冲突");
    for (const c of tr.clips) {
      add(c.id);
      const a = assets.find(
          (a) => a.id === c.asset_version_id && a.assetId === c.asset_id,
        ),
        info = analyses[c.asset_version_id];
      if (!a || !info) bad("引用未授权或未分析的素材");
      if (
        c.source_out <= c.source_in ||
        clipDuration(c) <= 0 ||
        (info.kind !== "image" && c.source_out > info.durationMs) ||
        (info.kind === "image" && c.source_in !== 0)
      )
        bad("素材时间越界");
      if (
        (tr.kind === "video" && info.kind === "audio") ||
        (tr.kind === "audio" && !info.hasAudio)
      )
        bad("素材类型与轨道不符");
      if (clipEnd(c) > t.target_duration) bad("片段超出工程时长");
      if (c.linked_clip_id) {
        const linked = primary(t).clips.find((p) => p.id === c.linked_clip_id);
        if (
          tr.role !== "original" ||
          !linked ||
          linked.asset_version_id !== c.asset_version_id ||
          linked.source_in !== c.source_in ||
          linked.source_out !== c.source_out ||
          linked.timeline_start !== c.timeline_start ||
          linked.speed !== c.speed
        )
          bad("原声与画面不同步");
      }
    }
  }
  const main = primary(t);
  if (
    !main.clips.length ||
    main.clips[0].timeline_start !== 0 ||
    clipEnd(main.clips[main.clips.length - 1]) !== t.target_duration
  )
    bad("主轨时长不符");
  for (const s of t.subtitles) {
    add(s.id);
    if (s.end <= s.start || s.end > t.target_duration) bad("字幕范围越界");
    if (s.anchor) {
      const c = main.clips.find((c) => c.id === s.anchor!.clip_id);
      if (!c || s.anchor.source_out <= s.anchor.source_in) bad("字幕锚点失效");
      if (c) {
        const a = Math.max(c.source_in, s.anchor.source_in),
          b = Math.min(c.source_out, s.anchor.source_out);
        if (
          b <= a ||
          s.start !==
            c.timeline_start + Math.round((a - c.source_in) / c.speed) ||
          s.end !== c.timeline_start + Math.round((b - c.source_in) / c.speed)
        )
          bad("字幕锚点与成片坐标不符");
      }
    }
  }
  for (const e of t.effect_stack) {
    add(e.id);
    if (
      e.end < e.start ||
      e.end > t.target_duration ||
      (e.end === e.start &&
        !(e.type === "transition" && e.params.style === "cut"))
    )
      bad("效果时间不合法");
    for (const k of [
      ...Object.keys(e.params),
      ...e.keyframes.flatMap((k) => Object.keys(k.values)),
    ])
      if (!allowed[e.type].includes(k)) bad("效果含不允许的参数");
    if (
      e.keyframes.some(
        (k, i) =>
          k.at < e.start ||
          k.at > e.end ||
          (i > 0 && k.at <= e.keyframes[i - 1].at),
      )
    )
      bad("关键帧必须有序且位于效果范围内");
    if (
      e.keyframes.some(
        (k) => k.values.blur !== undefined || k.values.sharpen !== undefined,
      )
    )
      bad("模糊和锐化暂只支持静态参数");
    if (e.type === "transition") {
      if (
        e.target.kind !== "boundary" ||
        !e.target.next_id ||
        !e.params.style ||
        e.keyframes.length
      )
        bad("转场关系不合法");
      const i = main.clips.findIndex((c) => c.id === e.target.id);
      const a = main.clips[i],
        b = main.clips[i + 1];
      if (
        !a ||
        !b ||
        b.id !== e.target.next_id ||
        e.start !== b.timeline_start ||
        e.end !== clipEnd(a) ||
        e.end - e.start > Math.min(clipDuration(a), clipDuration(b)) / 2
      )
        bad("转场必须精确覆盖相邻片段重叠");
    } else {
      if (e.target.kind === "boundary" || e.target.next_id)
        bad("效果目标不合法");
      const clip = all.find((c) => c.id === e.target.id),
        track = t.tracks.find((tr) => tr.id === e.target.id),
        cue = t.subtitles.find((s) => s.id === e.target.id);
      if (
        cue &&
        ((e.type !== "animation" && e.type !== "transform") ||
          e.params.rotation !== undefined ||
          e.keyframes.some((k) => k.values.rotation !== undefined))
      )
        bad("字幕只支持位置、缩放和透明度动效");
      const target =
        e.target.kind === "clip"
          ? clip
          : e.target.kind === "track"
            ? track
            : cue;
      if (!target) bad("效果目标不存在");
      if (
        (clip && (e.start < clip.timeline_start || e.end > clipEnd(clip))) ||
        (cue && (e.start < cue.start || e.end > cue.end))
      )
        bad("效果超出目标范围");
      const isAudio =
        track?.kind === "audio" ||
        (clip &&
          t.tracks.some(
            (tr) => tr.kind === "audio" && tr.clips.includes(clip),
          ));
      if (e.type === "audio" ? !isAudio : isAudio)
        bad("音频与画面效果目标不匹配");
    }
  }
  for (let i = 1; i < main.clips.length; i++) {
    const a = main.clips[i - 1],
      b = main.clips[i],
      edges = t.effect_stack.filter(
        (e) =>
          e.enabled &&
          e.type === "transition" &&
          e.target.id === a.id &&
          e.target.next_id === b.id,
      );
    if (
      edges.length > 1 ||
      b.timeline_start !==
        clipEnd(a) - (edges[0] ? edges[0].end - edges[0].start : 0)
    )
      bad("主轨只能连续或使用已声明转场重叠");
  }
  const mixProblem = narrationMixProblem(t, analyses);
  if (mixProblem) bad(mixProblem);
  return t;
}
export function validateDocument(
  input: unknown,
  id: string,
  assets: MediaAsset[],
  analyses: Record<string, Analysis>,
) {
  if ((input as { schema_version?: unknown })?.schema_version === 2) {
    requireP1();
    return validateP1(input, id, assets, analyses);
  }
  return validateV1(input, id, assets, analyses);
}
export const p1JsonSchema = z.toJSONSchema(p1TimelineSchema);
