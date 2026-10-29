import { randomUUID } from "node:crypto";
import { DomainError } from "../../domain.js";
import { narrationWindows, originalSoundGain } from "../audio-mix.js";
import type { P1Timeline } from "./runtime.js";
import { clipEnd } from "./runtime.js";

/** Native projects get ordinary split audio clips; the authoritative Timeline is untouched. */
export function bakeNarrationMix(document: P1Timeline): P1Timeline {
  const mix = document.audio_settings.narration_mix;
  if (!mix || mix.mode === "preserve-original") return document;
  const t = structuredClone(document), windows = narrationWindows(document);
  const sources = new Set(t.tracks.filter((tr) => tr.kind === "audio").flatMap((tr) =>
    [tr.id, ...tr.clips.filter((c) => c.asset_version_id !== mix.asset_version_id).map((c) => c.id)]));
  if (t.effect_stack.some((e) => e.enabled && e.type === "audio" && sources.has(e.target.id)))
    throw new DomainError("AUTOCUT_EXPORT_AUDIO_MIX", "自动避让与已有音频效果叠加时暂不支持跨软件工程导出；请导出MP4，原工程保留", 422);
  for (const tr of t.tracks.filter((tr) => tr.kind === "audio")) {
    if (tr.role === "original") { tr.role = "music"; tr.name = "原声（自动避让分段）"; }
    tr.clips = tr.clips.flatMap((c) => {
      if (c.asset_version_id === mix.asset_version_id) return [c];
      const end = clipEnd(c), cuts = [...new Set([c.timeline_start, end,
        ...windows.flatMap((w) => [w.start, w.end]).filter((at) => at > c.timeline_start && at < end)])].sort((a, b) => a - b);
      const { linked_clip_id: _link, ...independent } = c;
      return cuts.slice(0, -1).map((start, i) => ({ ...independent, id: i ? randomUUID() : c.id,
        timeline_start: start,
        source_in: c.source_in + Math.round((start - c.timeline_start) * c.speed),
        source_out: i === cuts.length - 2 ? c.source_out : c.source_in + Math.round((cuts[i + 1] - c.timeline_start) * c.speed),
        effects: { ...c.effects, volume: c.effects.volume * originalSoundGain(document, (start + cuts[i + 1]) / 2, c.asset_version_id) },
      }));
    });
  }
  delete t.audio_settings.narration_mix;
  t.warnings.push("自动避让已转换为独立分段音频；移动画面后须在目标剪辑软件中检查音量与同步。");
  return t;
}
