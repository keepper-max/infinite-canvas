import { randomUUID } from "node:crypto";
import { DomainError } from "../domain.js";
import { validateTimeline, type Timeline, type Analysis, type MediaAsset } from "./contract.js";

/** Audio uses measured source time; never stretch, repeat, or silently truncate speech. */
export function applyNarration(
  timeline: Timeline, assets: MediaAsset[], analyses: Record<string, Analysis>,
  originalVolume?: number, narration?: MediaAsset, priorNarrationIds: string[] = [],
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
    t.tracks.push({ id: randomUUID(), kind: "audio", clips: [{ id: randomUUID(), asset_id: narration.assetId,
      asset_version_id: narration.id, source_in: 0, source_out: info.durationMs, timeline_start: 0,
      effects: { volume: 1, muted: false }, transitions: { type: "cut", duration: 0 } }] });
    t.subtitles = info.transcript.segments.map((s) => ({id: randomUUID(),start:s.start,end:s.end,text:s.text}));
  }
  return validateTimeline(t, t.project_id, assets, analyses);
}
