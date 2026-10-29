import { randomUUID } from "node:crypto";
import { originalSpeechWindows, type VoiceAvoidance } from "./audio-mix.js";
import { DomainError } from "../domain.js";
import { validateTimeline, mapSubtitles, type Timeline, type Analysis, type MediaAsset } from "./contract.js";

/** Audio uses measured source time; never stretch, repeat, or silently truncate speech. */
export function applyNarration(
  timeline: Timeline, assets: MediaAsset[], analyses: Record<string, Analysis>,
  originalVolume?: number, narration?: MediaAsset, priorNarrationIds: string[] = [],
  avoidance?: VoiceAvoidance,
): Timeline {
  const t = structuredClone(timeline);
  if (originalVolume !== undefined) for (const track of t.tracks) if (track.kind === "video")
    for (const clip of track.clips) { clip.effects.volume = originalVolume; clip.effects.muted = originalVolume === 0; }
  if (narration) {
    const info = analyses[narration.id];
    if (!info || info.kind !== "audio" || !info.hasAudio || info.durationMs <= 0)
      throw new DomainError("AUTOCUT_NARRATION_INVALID", "配音不是可用音频，已保留原模型结果", 422);
    if (info.durationMs > t.target_duration)
      throw new DomainError("AUTOCUT_NARRATION_TOO_LONG", "配音长于实际成片；请缩短文案或增加可用画面与目标时长，不会截断配音或自动付费重试", 422);
    t.tracks = t.tracks.map((track) => track.kind === "audio"
      ? { ...track, clips: track.clips.filter((c) => !priorNarrationIds.includes(c.asset_version_id)) } : track)
      .filter((track) => track.clips.length > 0);
    delete t.audio_settings.narration_mix;
    let narrationStart = 0;
    if (avoidance === "preserve-original") {
      const occupied = originalSpeechWindows(t, analyses, [narration.id]);
      let cursor = 0, found = false;
      for (const span of [...occupied, { start: t.target_duration, end: t.target_duration }]) {
        const candidate = Math.ceil(cursor);
        if (candidate + info.durationMs <= Math.floor(span.start)) { narrationStart = candidate; found = true; break; }
        cursor = Math.max(cursor, span.end);
      }
      if (!found) throw new DomainError("AUTOCUT_NARRATION_NO_GAP", "没有足够容纳整段配音的可核验空隙；请缩短文案、增加无人声画面或改用配音优先。已产生的费用按原账本结算，不自动付费重试", 422);
    }
    t.tracks.push({ id: randomUUID(), kind: "audio", clips: [{ id: randomUUID(), asset_id: narration.assetId,
      asset_version_id: narration.id, source_in: 0, source_out: info.durationMs, timeline_start: narrationStart,
      effects: { volume: 1, muted: false }, transitions: { type: "cut", duration: 0 } }] });
    if (avoidance) t.audio_settings.narration_mix = { mode: avoidance, asset_version_id: narration.id };
    const voiceCaptions = info.transcript.segments.map((s) => ({id: randomUUID(),start:narrationStart+s.start,end:narrationStart+s.end,text:s.text}));
    const originalCaptions = avoidance ? mapSubtitles({ ...t, tracks: t.tracks.filter((tr) => tr.kind === "video")
      .map((tr) => ({ ...tr, clips: tr.clips.filter((c) => !c.effects.muted && c.effects.volume > 0) })) }, analyses)
      .filter((s) => s.end <= narrationStart || s.start >= narrationStart + info.durationMs) : [];
    t.subtitles = [...originalCaptions, ...voiceCaptions].sort((a,b) => a.start-b.start || a.end-b.end);
  }
  return validateTimeline(t, t.project_id, assets, analyses);
}
