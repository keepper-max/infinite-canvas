import { clearMissingNarrationMix } from "../audio-mix.js";
import { DomainError } from "../../domain.js";
import {
  clipEnd,
  effectValues,
  type P1Timeline,
  type EffectValues,
} from "./runtime.js";

/** Transient output document only. Never saves a revision or changes the user's edit. */
export function previewTimeline(document: P1Timeline, id: string): P1Timeline {
  const selected = document.tracks
    .filter((t) => t.kind === "video")
    .flatMap((t) => t.clips)
    .find((c) => c.id === id);
  if (!selected)
    throw new DomainError(
      "AUTOCUT_P1_SCOPE",
      "低清预览只允许选择当前工程中的画面片段",
      422,
    );
  const start = selected.timeline_start,
    end = clipEnd(selected),
    t = structuredClone(document);
  for (const tr of t.tracks)
    tr.clips = tr.clips.flatMap((c) => {
      const a = Math.max(start, c.timeline_start),
        b = Math.min(end, clipEnd(c));
      if (b <= a) return [];
      const original = c.source_in;
      c.source_in = original + Math.round((a - c.timeline_start) * c.speed);
      c.source_out = original + Math.round((b - c.timeline_start) * c.speed);
      c.timeline_start = a - start;
      return [c];
    });
  t.subtitles = t.subtitles.flatMap((s) => {
    const a = Math.max(start, s.start),
      b = Math.min(end, s.end);
    if (b <= a) return [];
    delete s.anchor;
    return [{ ...s, start: a - start, end: b - start }];
  });
  const ids = new Set([
    ...t.tracks.map((t) => t.id),
    ...t.tracks.flatMap((t) => t.clips.map((c) => c.id)),
    ...t.subtitles.map((s) => s.id),
  ]);
  t.effect_stack = t.effect_stack.flatMap((e) => {
    if (
      !ids.has(e.target.id) ||
      (e.type === "transition" &&
        (!e.target.next_id || !ids.has(e.target.next_id)))
    )
      return [];
    const a = Math.max(start, e.start),
      b = Math.min(end, e.end);
    if (b <= a) return [];
    const sample = (at: number) => ({
      at: at - start,
      values: Object.fromEntries(
        Object.entries(effectValues(e, at)).filter(([k]) => k !== "style"),
      ) as EffectValues,
      interpolation: e.interpolation,
    });
    e.keyframes = e.keyframes.length
      ? [
          sample(a),
          ...e.keyframes
            .filter((k) => k.at > a && k.at < b)
            .map((k) => ({ ...k, at: k.at - start })),
          sample(b),
        ]
      : [];
    e.start = a - start;
    e.end = b - start;
    return [e];
  });
  // Existing overlaps and layers retain their exact relative positions in the preview window.
  t.target_duration = end - start;
  clearMissingNarrationMix(t);
  return t;
}
