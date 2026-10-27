/** Shared browser/Worker semantics. All times are integer milliseconds; all intervals are half-open. */
export type Curve = "linear" | "easeIn" | "easeOut" | "easeInOut" | "hold";
export type EffectValues = {
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  opacity?: number;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  blur?: number;
  sharpen?: number;
  gain?: number;
};
export type Effect = {
  id: string;
  version: 1;
  type: "transform" | "animation" | "transition" | "filter" | "audio";
  target: {
    kind: "clip" | "track" | "subtitle" | "boundary";
    id: string;
    next_id?: string;
  };
  start: number;
  end: number;
  enabled: boolean;
  interpolation: Curve;
  params: EffectValues & { style?: TransitionStyle };
  keyframes: { at: number; values: EffectValues; interpolation: Curve }[];
};
export type TransitionStyle =
  | "cut"
  | "dissolve"
  | "fade"
  | "fadeblack"
  | "slideleft"
  | "slideright"
  | "wipeleft"
  | "wiperight";
export type P1Clip = {
  id: string;
  asset_id: string;
  asset_version_id: string;
  source_in: number;
  source_out: number;
  timeline_start: number;
  speed: number;
  effects: { volume: number; muted: boolean };
  linked_clip_id?: string;
};
export type P1Track = {
  id: string;
  name: string;
  kind: "video" | "audio";
  role: "main" | "overlay" | "original" | "music";
  layer: number;
  muted: boolean;
  volume: number;
  clips: P1Clip[];
};
export type P1Subtitle = {
  id: string;
  start: number;
  end: number;
  text: string;
  kind: "subtitle" | "title";
  layer: number;
  font_size: number;
  color: string;
  x: number;
  y: number;
  anchor?: { clip_id: string; source_in: number; source_out: number };
};
export type P1Timeline = {
  schema_version: 2;
  project_id: string;
  revision_id: string;
  target_duration: number;
  aspect_ratio: "16:9" | "9:16" | "1:1";
  fps: 25 | 30;
  tracks: P1Track[];
  subtitles: P1Subtitle[];
  effect_stack: Effect[];
  audio_settings: { master_volume: number };
  export_settings: { codec: "h264"; format: "mp4"; resolution: 720 };
  warnings: string[];
};
export type V1Input = {
  schema_version: 1;
  project_id: string;
  revision_id: string;
  target_duration: number;
  aspect_ratio: P1Timeline["aspect_ratio"];
  fps: 25 | 30;
  tracks: {
    id: string;
    kind: "video" | "audio";
    clips: (Omit<P1Clip, "speed"> & {
      transitions: { type: "cut" | "fade"; duration: number };
    })[];
  }[];
  subtitles: { id: string; start: number; end: number; text: string }[];
  audio_settings: P1Timeline["audio_settings"];
  export_settings: P1Timeline["export_settings"];
  warnings: string[];
};
export const P1_LIMITS = {
  tracks: 16,
  clips: 200,
  effects: 1000,
  keyframes: 128,
  packageBytes: 5 * 1024 ** 3,
} as const;
export const EFFECT_DEFAULTS = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
  brightness: 0,
  contrast: 1,
  saturation: 1,
  blur: 0,
  sharpen: 0,
  gain: 1,
} as const;
export type FrameValues = {
  -readonly [K in keyof typeof EFFECT_DEFAULTS]: number;
};
export const uid = () => globalThis.crypto.randomUUID();
export const clipDuration = (c: P1Clip) =>
  Math.round((c.source_out - c.source_in) / c.speed);
export const clipEnd = (c: P1Clip) => c.timeline_start + clipDuration(c);
export const dimensions = (aspect: P1Timeline["aspect_ratio"]) =>
  aspect === "16:9"
    ? { width: 1280, height: 720 }
    : aspect === "9:16"
      ? { width: 720, height: 1280 }
      : { width: 720, height: 720 };
export function curve(t: number, mode: Curve) {
  const v = Math.max(0, Math.min(1, t));
  return mode === "hold"
    ? 0
    : mode === "easeIn"
      ? v * v
      : mode === "easeOut"
        ? 1 - (1 - v) * (1 - v)
        : mode === "easeInOut"
          ? v < 0.5
            ? 2 * v * v
            : 1 - 2 * (1 - v) * (1 - v)
          : v;
}
export function effectValues(e: Effect, time: number): EffectValues {
  const result: EffectValues = { ...e.params };
  for (const name of Object.keys(EFFECT_DEFAULTS) as (keyof FrameValues)[]) {
    const points = e.keyframes.filter((k) => k.values[name] !== undefined);
    if (!points.length) continue;
    const first = points[0],
      last = points[points.length - 1];
    if (time <= first.at) {
      result[name] = first.values[name];
      continue;
    }
    if (time >= last.at) {
      result[name] = last.values[name];
      continue;
    }
    const right = points.findIndex((k) => k.at > time),
      a = points[right - 1],
      b = points[right];
    result[name] =
      a.values[name]! +
      (b.values[name]! - a.values[name]!) *
        curve((time - a.at) / (b.at - a.at), a.interpolation);
  }
  return result;
}
export function frameValues(
  t: P1Timeline,
  clip: P1Clip | P1Subtitle,
  track: P1Track | undefined,
  time: number,
): FrameValues {
  const value: FrameValues = { ...EFFECT_DEFAULTS };
  for (const e of t.effect_stack) {
    if (
      !e.enabled ||
      e.type === "transition" ||
      time < e.start ||
      time >= e.end
    )
      continue;
    if (!(
      ((e.target.kind === "clip" || e.target.kind === "subtitle") &&
        e.target.id === clip.id) ||
      (e.target.kind === "track" && e.target.id === track?.id)
    ))
      continue;
    const p = effectValues(e, time);
    for (const k of Object.keys(EFFECT_DEFAULTS) as (keyof FrameValues)[])
      if (p[k] !== undefined) {
        if (["x", "y", "rotation", "brightness", "blur", "sharpen"].includes(k))
          value[k] += p[k]!;
        else value[k] *= p[k]!;
      }
  }
  return value;
}
export const primary = (t: P1Timeline) =>
  t.tracks.find((x) => x.role === "main")!;
export function upgradeTimeline(
  v: V1Input,
  hasAudio: (id: string) => boolean,
): P1Timeline {
  const main = v.tracks.find((t) => t.kind === "video")!;
  const clips = main.clips.map(({ transitions, ...c }) => ({
    ...c,
    speed: 1,
    effects: { ...c.effects, muted: true },
  }));
  const subtitles: P1Subtitle[] = v.subtitles.flatMap((s) =>
    main.clips.flatMap((c) => {
      const start = Math.max(s.start, c.timeline_start),
        end = Math.min(s.end, c.timeline_start + c.source_out - c.source_in);
      return end > start
        ? [
            {
              ...s,
              id: uid(),
              start,
              end,
              kind: "subtitle" as const,
              layer: 100,
              font_size: 26,
              color: "#ffffff",
              x: 0,
              y: 0.86,
              anchor: {
                clip_id: c.id,
                source_in: c.source_in + start - c.timeline_start,
                source_out: c.source_in + end - c.timeline_start,
              },
            },
          ]
        : [];
    }),
  );
  const tracks: P1Track[] = [
    {
      id: main.id,
      name: "视频主轨",
      kind: "video",
      role: "main",
      layer: 0,
      muted: false,
      volume: 1,
      clips,
    },
    {
      id: uid(),
      name: "原声",
      kind: "audio",
      role: "original",
      layer: 0,
      muted: false,
      volume: 1,
      clips: main.clips
        .filter((c) => hasAudio(c.asset_version_id))
        .map(({ transitions, ...c }) => ({
          ...c,
          id: uid(),
          speed: 1,
          linked_clip_id: c.id,
        })),
    },
    ...v.tracks
      .filter((t) => t.kind === "audio")
      .map((t, i) => ({
        id: t.id,
        name: `背景音乐 ${i + 1}`,
        kind: "audio" as const,
        role: "music" as const,
        layer: i,
        muted: false,
        volume: 1,
        clips: t.clips.map(({ transitions, ...c }) => ({ ...c, speed: 1 })),
      })),
  ];
  const effects: Effect[] = main.clips.flatMap((c) =>
    c.transitions.type === "fade" && c.transitions.duration
      ? [
          {
            id: uid(),
            version: 1 as const,
            type: "animation" as const,
            target: { kind: "clip" as const, id: c.id },
            start: c.timeline_start,
            end: c.timeline_start + c.source_out - c.source_in,
            enabled: true,
            interpolation: "linear" as const,
            params: { opacity: 1 },
            keyframes: [
              {
                at: c.timeline_start,
                values: { opacity: 0 },
                interpolation: "linear" as const,
              },
              {
                at: c.timeline_start + c.transitions.duration,
                values: { opacity: 1 },
                interpolation: "linear" as const,
              },
              {
                at:
                  c.timeline_start +
                  c.source_out -
                  c.source_in -
                  c.transitions.duration,
                values: { opacity: 1 },
                interpolation: "linear" as const,
              },
              {
                at: c.timeline_start + c.source_out - c.source_in,
                values: { opacity: 0 },
                interpolation: "linear" as const,
              },
            ].filter((k, i, a) => !i || k.at > a[i - 1].at),
          },
        ]
      : [],
  );
  return { ...v, schema_version: 2, tracks, subtitles, effect_stack: effects };
}
export function boundary(t: P1Timeline, a: string, b: string) {
  return t.effect_stack.find(
    (e) =>
      e.enabled &&
      e.type === "transition" &&
      e.target.id === a &&
      e.target.next_id === b,
  );
}
/** Ripple only the primary track. Preserve overlays/music as explicit timeline positions. */
export function reflow(t: P1Timeline, previous?: P1Timeline) {
  const main = primary(t);
  let cursor = 0;
  for (let i = 0; i < main.clips.length; i++) {
    const c = main.clips[i],
      oldStart =
        previous?.tracks.flatMap((x) => x.clips).find((x) => x.id === c.id)
          ?.timeline_start ?? c.timeline_start,
      edge = i ? boundary(t, main.clips[i - 1].id, c.id) : undefined;
    const overlap = edge
      ? Math.min(
          edge.end - edge.start,
          Math.floor(clipDuration(main.clips[i - 1]) / 2),
          Math.floor(clipDuration(c) / 2),
        )
      : 0;
    c.timeline_start = cursor - overlap;
    if (edge) {
      edge.start = c.timeline_start;
      edge.end = cursor;
    }
    if (oldStart !== c.timeline_start)
      shiftEffects(t, c.id, c.timeline_start - oldStart);
    cursor = clipEnd(c);
  }
  t.target_duration = cursor;
  for (const tr of t.tracks.filter((tr) => tr.role === "original"))
    tr.clips = tr.clips.flatMap((c) => {
      if (!c.linked_clip_id) return [c];
      const link = main.clips.find((v) => v.id === c.linked_clip_id);
      if (!link) return [];
      shiftEffects(t, c.id, link.timeline_start - c.timeline_start);
      return [
        {
          ...c,
          timeline_start: link.timeline_start,
          source_in: link.source_in,
          source_out: link.source_out,
          speed: link.speed,
        },
      ];
    });
  const valid = new Set(t.tracks.flatMap((tr) => tr.clips.map((c) => c.id)));
  t.subtitles = t.subtitles.flatMap((s) => {
    if (!s.anchor)
      return s.start < cursor ? [{ ...s, end: Math.min(s.end, cursor) }] : [];
    const c = main.clips.find((c) => c.id === s.anchor!.clip_id);
    if (!c) return [];
    const a = Math.max(s.anchor.source_in, c.source_in),
      b = Math.min(s.anchor.source_out, c.source_out);
    const start = c.timeline_start + Math.round((a - c.source_in) / c.speed),
      end = c.timeline_start + Math.round((b - c.source_in) / c.speed);
    if (b <= a || end <= start) return [];
    for (const e of t.effect_stack)
      if (e.target.kind === "subtitle" && e.target.id === s.id) {
        const delta = start - s.start;
        e.start += delta;
        e.end += delta;
        for (const k of e.keyframes) k.at += delta;
      }
    return [{ ...s, start, end }];
  });
  t.effect_stack = t.effect_stack.filter((e) =>
    e.target.kind === "clip"
      ? valid.has(e.target.id)
      : e.target.kind === "boundary"
        ? main.clips.some(
            (c, i) =>
              c.id === e.target.id &&
              main.clips[i + 1]?.id === e.target.next_id,
          )
        : e.target.kind === "subtitle"
          ? t.subtitles.some((s) => s.id === e.target.id)
          : t.tracks.some((tr) => tr.id === e.target.id),
  );
  for (const e of t.effect_stack) {
    const c =
        e.target.kind === "clip"
          ? t.tracks.flatMap((tr) => tr.clips).find((c) => c.id === e.target.id)
          : undefined,
      s =
        e.target.kind === "subtitle"
          ? t.subtitles.find((s) => s.id === e.target.id)
          : undefined;
    if (c || s)
      clipEffect(e, c ? c.timeline_start : s!.start, c ? clipEnd(c) : s!.end);
  }
  t.effect_stack = t.effect_stack.filter(
    (e) =>
      e.end > e.start || (e.type === "transition" && e.params.style === "cut"),
  );
  return t;
}
export function shiftEffects(t: P1Timeline, id: string, delta: number) {
  for (const e of t.effect_stack)
    if (e.target.kind === "clip" && e.target.id === id) {
      e.start += delta;
      e.end += delta;
      for (const k of e.keyframes) k.at += delta;
    }
}
function clipEffect(e: Effect, start: number, end: number) {
  const a = Math.max(e.start, start),
    b = Math.min(e.end, end);
  if (a === e.start && b === e.end) return;
  const sample = (at: number) => ({
    at,
    values: Object.fromEntries(
      Object.entries(effectValues(e, at)).filter(
        ([k]) => !["style", "blur", "sharpen"].includes(k),
      ),
    ) as EffectValues,
    interpolation: e.interpolation,
  });
  const keys = e.keyframes.filter((k) => k.at >= a && k.at <= b);
  if (e.keyframes.length) {
    if (
      e.keyframes.some((k) => k.at < a) &&
      e.keyframes.some((k) => k.at > a) &&
      !keys.some((k) => k.at === a)
    )
      keys.unshift(sample(a));
    if (
      e.keyframes.some((k) => k.at < b) &&
      e.keyframes.some((k) => k.at > b) &&
      !keys.some((k) => k.at === b)
    )
      keys.push(sample(b));
    if (!keys.length) keys.push(sample(a));
  }
  e.start = a;
  e.end = b;
  e.keyframes = keys;
}
function copyTargetEffects(t: P1Timeline, from: string, to: string, delta = 0) {
  for (const e of [...t.effect_stack])
    if (
      (e.target.kind === "clip" || e.target.kind === "subtitle") &&
      e.target.id === from
    ) {
      const next = structuredClone(e);
      next.id = uid();
      next.target.id = to;
      next.start += delta;
      next.end += delta;
      next.keyframes.forEach((k) => {
        k.at += delta;
      });
      t.effect_stack.push(next);
    }
}
function splitTargetEffects(
  t: P1Timeline,
  from: string,
  to: string,
  at: number,
  end: number,
) {
  for (const e of [...t.effect_stack])
    if (
      (e.target.kind === "clip" || e.target.kind === "subtitle") &&
      e.target.id === from &&
      e.end > at
    ) {
      const next = structuredClone(e);
      next.id = uid();
      next.target.id = to;
      clipEffect(next, at, end);
      t.effect_stack.push(next);
      clipEffect(e, e.start, at);
    }
}
export function splitClip(t: P1Timeline, id: string, at: number) {
  const tr = t.tracks.find((tr) => tr.clips.some((c) => c.id === id));
  const c = tr?.clips.find((c) => c.id === id);
  if (!tr || !c || at <= c.timeline_start || at >= clipEnd(c)) return t;
  if (c.linked_clip_id) return splitClip(t, c.linked_clip_id, at);
  const old = structuredClone(t),
    cut = c.source_in + Math.round((at - c.timeline_start) * c.speed),
    right = {
      ...structuredClone(c),
      id: uid(),
      source_in: cut,
      timeline_start: at,
    };
  c.source_out = cut;
  tr.clips.splice(tr.clips.indexOf(c) + 1, 0, right);
  for (const track of t.tracks.filter((x) => x.role === "original"))
    for (const audio of [...track.clips])
      if (audio.linked_clip_id === id) {
        const end = clipEnd(audio);
        const next = {
          ...structuredClone(audio),
          id: uid(),
          linked_clip_id: right.id,
          source_in: cut,
          timeline_start: at,
        };
        audio.source_out = cut;
        track.clips.push(next);
        splitTargetEffects(t, audio.id, next.id, at, end);
      }
  for (const cue of [...t.subtitles])
    if (cue.anchor?.clip_id === id && cue.anchor.source_out > cut) {
      const next = {
        ...structuredClone(cue),
        id: uid(),
        start: Math.max(cue.start, at),
        anchor: {
          ...cue.anchor,
          clip_id: right.id,
          source_in: Math.max(cut, cue.anchor.source_in),
        },
      };
      t.subtitles.push(next);
      splitTargetEffects(t, cue.id, next.id, at, cue.end);
      cue.anchor.source_out = Math.min(cue.anchor.source_out, cut);
    }
  splitTargetEffects(t, id, right.id, at, clipEnd(right));
  return reflow(t, old);
}
export function duplicateClips(t: P1Timeline, ids: Set<string>) {
  const old = structuredClone(t);
  for (const tr of t.tracks)
    for (const c of [...tr.clips])
      if (ids.has(c.id)) {
        if (c.linked_clip_id && ids.has(c.linked_clip_id)) continue;
        const n = {
          ...structuredClone(c),
          id: uid(),
          timeline_start: tr.role === "main" ? c.timeline_start : clipEnd(c),
        };
        delete n.linked_clip_id;
        tr.clips.splice(tr.clips.indexOf(c) + 1, 0, n);
        for (const a of t.tracks.filter((x) => x.role === "original"))
          for (const ac of [...a.clips])
            if (ac.linked_clip_id === c.id) {
              const copied = {
                ...structuredClone(ac),
                id: uid(),
                linked_clip_id: n.id,
              };
              a.clips.push(copied);
              copyTargetEffects(t, ac.id, copied.id);
            }
        for (const s of [...t.subtitles])
          if (s.anchor?.clip_id === c.id) {
            const copied = {
              ...structuredClone(s),
              id: uid(),
              anchor: { ...s.anchor, clip_id: n.id },
            };
            t.subtitles.push(copied);
            copyTargetEffects(t, s.id, copied.id);
          }
        copyTargetEffects(t, c.id, n.id, n.timeline_start - c.timeline_start);
      }
  return reflow(t, old);
}
export function removeClips(t: P1Timeline, ids: Set<string>) {
  const old = structuredClone(t);
  for (const tr of t.tracks) tr.clips = tr.clips.filter((c) => !ids.has(c.id));
  return reflow(t, old);
}
export function setTransition(
  t: P1Timeline,
  from: string,
  to: string,
  style: TransitionStyle,
  duration: number,
) {
  const old = structuredClone(t);
  t.effect_stack = t.effect_stack.filter(
    (e) => !(e.type === "transition" && e.target.id === from),
  );
  if (style !== "cut") {
    const a = primary(t).clips.find((c) => c.id === from)!,
      b = primary(t).clips.find((c) => c.id === to)!;
    const d = Math.floor(
      Math.min(duration, clipDuration(a) / 2, clipDuration(b) / 2),
    );
    if (d > 0)
      t.effect_stack.push({
        id: uid(),
        version: 1,
        type: "transition",
        target: { kind: "boundary", id: from, next_id: to },
        start: clipEnd(a) - d,
        end: clipEnd(a),
        enabled: true,
        interpolation: "linear",
        params: { style },
        keyframes: [],
      });
  }
  return reflow(t, old);
}
export const STYLE_PRESETS = [
  "minimal-speech",
  "vlog",
  "cinematic-travel",
  "product",
  "knowledge",
] as const;
export function applyPreset(
  t: P1Timeline,
  preset: (typeof STYLE_PRESETS)[number],
  scope: Set<string>,
) {
  const next = structuredClone(t);
  for (const tr of next.tracks.filter((tr) => tr.kind === "video"))
    for (const c of tr.clips.filter((c) => scope.has(c.id))) {
      if (preset === "minimal-speech" || preset === "knowledge") {
        next.effect_stack.push({
          id: uid(),
          version: 1,
          type: "animation",
          target: { kind: "clip", id: c.id },
          start: c.timeline_start,
          end: clipEnd(c),
          enabled: true,
          interpolation: "linear",
          params: { opacity: 1 },
          keyframes: [
            {
              at: c.timeline_start,
              values: { opacity: 0 },
              interpolation: "linear",
            },
            {
              at: Math.min(clipEnd(c), c.timeline_start + 300),
              values: { opacity: 1 },
              interpolation: "linear",
            },
          ],
        });
        continue;
      }
      next.effect_stack.push({
        id: uid(),
        version: 1,
        type: "animation",
        target: { kind: "clip", id: c.id },
        start: c.timeline_start,
        end: clipEnd(c),
        enabled: true,
        interpolation: "easeInOut",
        params: { scale: 1 },
        keyframes: [
          {
            at: c.timeline_start,
            values: { scale: preset === "product" ? 1.05 : 1 },
            interpolation: "easeInOut",
          },
          {
            at: clipEnd(c),
            values: { scale: preset === "cinematic-travel" ? 1.12 : 1.06 },
            interpolation: "linear",
          },
        ],
      });
    }
  return next;
}
