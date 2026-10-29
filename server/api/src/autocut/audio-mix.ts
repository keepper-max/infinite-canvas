/** Shared by browser and renderers. Only measured, half-open millisecond ranges. */
export type VoiceAvoidance = "preserve-original" | "narration-first" | "duck-original";
export type NarrationMix = { mode: VoiceAvoidance; asset_version_id: string };
type Span = { start: number; end: number };
type SoundClip = {
  asset_version_id: string; source_in: number; source_out: number; timeline_start: number;
  speed?: number; effects: { volume: number; muted: boolean };
};
export type MixTimeline = {
  target_duration: number;
  audio_settings: { master_volume: number; narration_mix?: NarrationMix };
  tracks: { kind: string; muted?: boolean; volume?: number; clips: SoundClip[] }[];
};
type SpeechFacts = {
  hasAudio: boolean; silences: Span[]; transcript: { segments: Span[] };
  processing?: { basis: string };
};

export function unionSpans(spans: Span[]): Span[] {
  const result: Span[] = [];
  for (const span of spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start)) {
    const last = result[result.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else result.push({ ...span });
  }
  return result;
}

export function narrationWindows(t: MixTimeline): Span[] {
  const mix = t.audio_settings.narration_mix;
  if (!mix) return [];
  return unionSpans(t.tracks.filter((tr) => tr.kind === "audio" && !tr.muted && tr.volume !== 0)
    .flatMap((tr) => tr.clips.filter((c) => c.asset_version_id === mix.asset_version_id && !c.effects.muted && c.effects.volume > 0)
      .map((c) => ({ start: c.timeline_start, end: c.timeline_start + Math.round((c.source_out - c.source_in) / (c.speed ?? 1)) }))));
}

/** Unknown/empty recognition is not proof of silence. Only verified silence is safe then. */
export function originalSpeechWindows(t: MixTimeline, facts: Record<string, SpeechFacts>, voiceIds: string[]): Span[] {
  const spans: Span[] = [];
  for (const tr of t.tracks) for (const c of tr.clips) {
    if (tr.muted || tr.volume === 0 || c.effects.muted || c.effects.volume === 0 || voiceIds.includes(c.asset_version_id)) continue;
    const info = facts[c.asset_version_id];
    if (info && !info.hasAudio) continue;
    const project = (s: Span) => {
      const start = Math.max(c.source_in, s.start), end = Math.min(c.source_out, s.end);
      if (end > start) spans.push({ start: c.timeline_start + (start - c.source_in) / (c.speed ?? 1), end: c.timeline_start + (end - c.source_in) / (c.speed ?? 1) });
    };
    if (info?.processing?.basis === "local_cpu_no_api_charge" && info.transcript.segments.length) {
      info.transcript.segments.forEach(project);
    } else {
      let cursor = c.source_in;
      for (const s of unionSpans(info?.silences ?? [])) {
        project({ start: cursor, end: Math.min(c.source_out, s.start) });
        cursor = Math.max(cursor, s.end);
      }
      project({ start: cursor, end: c.source_out });
    }
  }
  return unionSpans(spans);
}

export function narrationMixProblem(t: MixTimeline, facts: Record<string, SpeechFacts>): string | undefined {
  const mix = t.audio_settings.narration_mix;
  if (!mix) return;
  if (!t.tracks.some((tr) => tr.kind === "audio" && tr.clips.some((c) => c.asset_version_id === mix.asset_version_id)))
    return "避让设置引用的配音音轨不存在，请同时移除避让设置或恢复配音";
  if (mix.mode === "preserve-original") {
    const occupied = originalSpeechWindows(t, facts, [mix.asset_version_id]);
    if (narrationWindows(t).some((v) => occupied.some((s) => v.start < s.end && v.end > s.start)))
      return "配音与原有人声或未核验音频重叠，请调整配音位置或改用配音优先";
  }
}

export function originalSoundGain(t: MixTimeline, at: number, assetVersionId?: string): number {
  const mix = t.audio_settings.narration_mix;
  if (!mix || mix.mode === "preserve-original" || assetVersionId === mix.asset_version_id) return 1;
  return narrationWindows(t).some((s) => at >= s.start && at < s.end) ? mix.mode === "duck-original" ? 0.2 : 0 : 1;
}

/** Callers supply the clock expression; no user strings enter an FFmpeg expression. */
export function originalSoundExpression(t: MixTimeline, clock = "t", assetVersionId?: string): string {
  const mix = t.audio_settings.narration_mix;
  if (!mix || mix.mode === "preserve-original" || assetVersionId === mix.asset_version_id) return "1";
  const windows = narrationWindows(t);
  if (!windows.length) return "1";
  const active = windows.map((s) => `(gte(${clock},${s.start / 1000})*lt(${clock},${s.end / 1000}))`).join("+");
  return `1-${mix.mode === "duck-original" ? 0.8 : 1}*min(1,${active})`;
}

/** Program-owned settings are cleared only when a deliberate edit removes the voice. */
export function clearMissingNarrationMix(t: MixTimeline): void {
  const mix = t.audio_settings.narration_mix;
  if (mix && !t.tracks.some((tr) => tr.kind === "audio" && tr.clips.some((c) => c.asset_version_id === mix.asset_version_id)))
    delete t.audio_settings.narration_mix;
}
