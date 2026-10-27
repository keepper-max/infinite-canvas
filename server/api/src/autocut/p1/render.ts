import { writeFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { runMedia, inputSafety } from "../media.js";
import type { Analysis } from "../contract.js";
import { DomainError } from "../../domain.js";
import {
  dimensions,
  clipDuration,
  clipEnd,
  primary,
  EFFECT_DEFAULTS,
  type P1Timeline,
  type P1Clip,
  type P1Track,
  type FrameValues,
  type Effect,
  type Curve,
} from "./runtime.js";
const base = [
  "-nostdin",
  "-hide_banner",
  "-loglevel",
  "error",
  "-threads",
  "2",
  "-filter_threads",
  "2",
  "-filter_complex_threads",
  "2",
];
const n = (v: number) => Number(v.toFixed(8)).toString();
const seconds = (ms: number) => n(ms / 1000);
const pathExpr = (p: string) =>
  p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
function ease(p: string, c: Curve) {
  return c === "hold"
    ? "0"
    : c === "easeIn"
      ? `pow(${p},2)`
      : c === "easeOut"
        ? `1-pow(1-(${p}),2)`
        : c === "easeInOut"
          ? `if(lt(${p},0.5),2*pow(${p},2),1-2*pow(1-(${p}),2))`
          : p;
}
function property(e: Effect, k: keyof FrameValues, time: string) {
  const points = e.keyframes.filter((f) => f.values[k] !== undefined);
  if (!points.length) return n(e.params[k] ?? EFFECT_DEFAULTS[k]);
  let expression = n(points[points.length - 1].values[k]!);
  for (let i = points.length - 2; i >= 0; i--) {
    const a = points[i],
      b = points[i + 1],
      p = `((${time})-${seconds(a.at)})/${seconds(b.at - a.at)}`,
      v = `${n(a.values[k]!)}+${n(b.values[k]! - a.values[k]!)}*(${ease(p, a.interpolation)})`;
    expression = `if(lt(${time},${seconds(b.at)}),${v},${expression})`;
  }
  return `if(lte(${time},${seconds(points[0].at)}),${n(points[0].values[k]!)},${expression})`;
}
/** Only numeric validated fields reach these generated expressions. No user filter text is accepted. */
export function parameterExpression(
  t: P1Timeline,
  id: string,
  trackId: string,
  k: keyof FrameValues,
  time: string,
) {
  let value = n(EFFECT_DEFAULTS[k]);
  for (const e of t.effect_stack) {
    if (
      !e.enabled ||
      e.type === "transition" ||
      !(
        ((e.target.kind === "clip" || e.target.kind === "subtitle") &&
          e.target.id === id) ||
        (e.target.kind === "track" && e.target.id === trackId)
      )
    )
      continue;
    if (
      e.params[k] === undefined &&
      !e.keyframes.some((f) => f.values[k] !== undefined)
    )
      continue;
    const add = [
      "x",
      "y",
      "rotation",
      "brightness",
      "blur",
      "sharpen",
    ].includes(k);
    const expression = property(e, k, time);
    value = add
      ? `(${value})+if(gte(${time},${seconds(e.start)})*lt(${time},${seconds(e.end)}),${expression},0)`
      : `(${value})*if(gte(${time},${seconds(e.start)})*lt(${time},${seconds(e.end)}),${expression},1)`;
  }
  return value;
}
function videoGraph(
  t: P1Timeline,
  c: P1Clip,
  track: P1Track,
  input: string,
  back: string,
  out: string,
  local: boolean,
) {
  const { width: w, height: h } = dimensions(t.aspect_ratio),
    time = local ? `(t+${seconds(c.timeline_start)})` : "t";
  const expr = (k: keyof FrameValues) =>
    parameterExpression(t, c.id, track.id, k, time);
  const opacity = track.muted
    ? "0"
    : parameterExpression(
        t,
        c.id,
        track.id,
        "opacity",
        local ? `(T+${seconds(c.timeline_start)})` : "T",
      );
  const filters = [
    `${input}setpts=PTS-STARTPTS,scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1,fps=${t.fps},format=rgba`,
  ];
  if (expr("scale") !== "1")
    filters.push(
      `scale=w='max(2,round(${w}*(${expr("scale")})))':h='max(2,round(${h}*(${expr("scale")})))':eval=frame`,
    );
  if (expr("rotation") !== "0")
    filters.push(
      `rotate=a='(${expr("rotation")})*PI/180':ow='hypot(iw,ih)':oh='hypot(iw,ih)':c=black@0`,
    );
  if (
    expr("brightness") !== "0" ||
    expr("contrast") !== "1" ||
    expr("saturation") !== "1"
  )
    filters.push(
      `eq=brightness='${expr("brightness")}':contrast='${expr("contrast")}':saturation='${expr("saturation")}':eval=frame`,
    );
  for (const e of t.effect_stack.filter(
    (e) =>
      e.enabled &&
      e.type === "filter" &&
      (e.target.id === c.id || e.target.id === track.id),
  )) {
    const enable = `gte(${time},${seconds(e.start)})*lt(${time},${seconds(e.end)})`;
    if (e.params.blur)
      filters.push(`gblur=sigma=${n(e.params.blur)}:enable='${enable}'`);
    if (e.params.sharpen)
      filters.push(
        `unsharp=5:5:${n(e.params.sharpen)}:5:5:0:enable='${enable}'`,
      );
  }
  if (opacity !== "1")
    filters.push(
      `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${opacity})'`,
    );
  const label = `fx_${out}`;
  return `${filters.join(",")}[${label}];${back}[${label}]overlay=x='(W-w)/2+(${expr("x")})*W':y='(H-h)/2+(${expr("y")})*H':eval=frame:shortest=1,format=yuv420p[${out}]`;
}
const encoding = [
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "20",
  "-threads",
  "2",
  "-c:a",
  "aac",
  "-ac",
  "2",
  "-ar",
  "48000",
];
export async function renderP1(
  ffmpeg: string,
  t: P1Timeline,
  paths: Record<string, string>,
  analyses: Record<string, Analysis>,
  dir: string,
  signal: AbortSignal,
  lowResolution = false,
) {
  const filterScriptOption = (
    await runMedia(ffmpeg, ["-hide_banner", "-h", "full"], signal)
  ).includes("-filter_complex_script ")
    ? "-filter_complex_script"
    : "-/filter_complex";
  const size = dimensions(t.aspect_ratio),
    main = primary(t);
  let current = "";
  let duration = 0;
  for (const [i, c] of main.clips.entries()) {
    const length = clipDuration(c),
      segment = join(dir, `p1-main-${i}.mp4`),
      info = analyses[c.asset_version_id];
    const input = [
      ...inputSafety,
      ...(info.kind === "image"
        ? ["-loop", "1"]
        : ["-ss", seconds(c.source_in)]),
      "-t",
      seconds(c.source_out - c.source_in),
      "-threads",
      "2",
      "-i",
      paths[c.asset_version_id],
      "-f",
      "lavfi",
      "-i",
      `color=c=black:s=${size.width}x${size.height}:r=${t.fps}:d=${seconds(length)}`,
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=stereo",
    ];
    // videoGraph accepts an input prefix; use a named pad to avoid concatenating filter names.
    const fixed =
      `[0:v]setpts=(PTS-STARTPTS)/${n(c.speed)}[src];` +
      videoGraph(t, c, main, "[src]", "[1:v]", "v", true);
    await writeFile(join(dir, `p1-main-${i}.filter`), fixed);
    await runMedia(
      ffmpeg,
      [
        ...base,
        ...input,
        filterScriptOption,
        join(dir, `p1-main-${i}.filter`),
        "-map",
        "[v]",
        "-map",
        "2:a",
        ...encoding,
        "-t",
        seconds(length),
        "-y",
        segment,
      ],
      signal,
    );
    if (!current) {
      current = segment;
      duration = length;
      continue;
    }
    const edge = t.effect_stack.find(
      (e) =>
        e.enabled &&
        e.type === "transition" &&
        e.target.id === main.clips[i - 1].id &&
        e.target.next_id === c.id,
    );
    const overlap = edge ? edge.end - edge.start : 0;
    const joined = join(dir, `p1-joined-${i}.mp4`);
    const style = edge?.params.style,
      transition =
        style === "dissolve" ? "fade" : style === "fade" ? "fadeblack" : style;
    const combine = overlap
      ? `[0:v]settb=AVTB[v0];[1:v]settb=AVTB[v1];[v0][v1]xfade=transition=${transition}:duration=${seconds(overlap)}:offset=${seconds(duration - overlap)}[v];[0:a][1:a]acrossfade=d=${seconds(overlap)}[a]`
      : "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]";
    await writeFile(join(dir, `p1-join-${i}.filter`), combine);
    await runMedia(
      ffmpeg,
      [
        ...base,
        "-i",
        current,
        "-i",
        segment,
        filterScriptOption,
        join(dir, `p1-join-${i}.filter`),
        "-map",
        "[v]",
        "-map",
        "[a]",
        ...encoding,
        "-t",
        seconds(duration + length - overlap),
        "-y",
        joined,
      ],
      signal,
    );
    await unlink(current);
    await unlink(segment);
    current = joined;
    duration += length - overlap;
  }
  for (const tr of t.tracks
    .filter((tr) => tr.role === "overlay" && !tr.muted)
    .sort((a, b) => a.layer - b.layer))
    for (const c of tr.clips) {
      const out = join(dir, `p1-overlay-${c.id}.mp4`),
        info = analyses[c.asset_version_id];
      const input = [
        ...inputSafety,
        ...(info.kind === "image"
          ? ["-loop", "1"]
          : ["-ss", seconds(c.source_in)]),
        "-t",
        seconds(c.source_out - c.source_in),
        "-threads",
        "2",
        "-i",
        paths[c.asset_version_id],
      ];
      const graph =
        `[1:v]setpts=(PTS-STARTPTS)/${n(c.speed)}+${seconds(c.timeline_start)}/TB[ovsrc];` +
        videoGraph(t, c, tr, "[ovsrc]", "[0:v]", "v", false)
          .replace("setpts=PTS-STARTPTS,", "")
          .replace(
            "shortest=1",
            "eof_action=pass:enable=between(t\\," +
              seconds(c.timeline_start) +
              "\\," +
              seconds(clipEnd(c)) +
              ")",
          );
      await writeFile(join(dir, `p1-overlay-${c.id}.filter`), graph);
      await runMedia(
        ffmpeg,
        [
          ...base,
          "-i",
          current,
          ...input,
          filterScriptOption,
          join(dir, `p1-overlay-${c.id}.filter`),
          "-map",
          "[v]",
          "-map",
          "0:a",
          ...encoding,
          "-t",
          seconds(t.target_duration),
          "-y",
          out,
        ],
        signal,
      );
      await unlink(current);
      current = out;
    }
  // Explicit original/music tracks are the only audio sources. Never duplicate embedded video audio.
  let mix = "";
  let index = 0;
  for (const tr of t.tracks.filter((tr) => tr.kind === "audio" && !tr.muted))
    for (const c of tr.clips.filter((c) => !c.effects.muted)) {
      let speed = c.speed;
      const tempos: string[] = [];
      while (speed > 2) {
        tempos.push("atempo=2");
        speed /= 2;
      }
      while (speed < 0.5) {
        tempos.push("atempo=0.5");
        speed /= 0.5;
      }
      tempos.push(`atempo=${n(speed)}`);
      const gain = parameterExpression(
          t,
          c.id,
          tr.id,
          "gain",
          `(t+${seconds(c.timeline_start)})`,
        ),
        volume = c.effects.volume * tr.volume * t.audio_settings.master_volume;
      const fades: string[] = [];
      if (tr.role === "original") {
        for (const e of t.effect_stack.filter(
          (e) => e.enabled && e.type === "transition",
        )) {
          if (e.target.next_id === c.linked_clip_id)
            fades.push(`afade=t=in:st=0:d=${seconds(e.end - e.start)}`);
          if (e.target.id === c.linked_clip_id)
            fades.push(
              `afade=t=out:st=${seconds(clipDuration(c) - (e.end - e.start))}:d=${seconds(e.end - e.start)}`,
            );
        }
      }
      const part = join(dir, `p1-audio-${index}.mka`),
        filter = join(dir, `p1-audio-${index}.filter`);
      await writeFile(
        filter,
        `[0:a]asetpts=PTS-STARTPTS,aresample=48000,${tempos.concat(fades).join(",")},atrim=duration=${seconds(clipDuration(c))},volume='${n(volume)}*(${gain})':eval=frame,adelay=${c.timeline_start}:all=1,apad,atrim=duration=${seconds(t.target_duration)}[a]`,
      );
      await runMedia(
        ffmpeg,
        [
          ...base,
          ...inputSafety,
          "-ss",
          seconds(c.source_in),
          "-t",
          seconds(c.source_out - c.source_in),
          "-threads",
          "2",
          "-i",
          paths[c.asset_version_id],
          filterScriptOption,
          filter,
          "-map",
          "[a]",
          "-c:a",
          "pcm_f32le",
          "-ac",
          "2",
          "-ar",
          "48000",
          "-y",
          part,
        ],
        signal,
      );
      if (mix) {
        const combined = join(dir, `p1-mix-${index}.mka`);
        await runMedia(
          ffmpeg,
          [
            ...base,
            "-i",
            mix,
            "-i",
            part,
            "-filter_complex",
            "[0:a][1:a]amix=inputs=2:normalize=0:duration=longest[a]",
            "-map",
            "[a]",
            "-c:a",
            "pcm_f32le",
            "-y",
            combined,
          ],
          signal,
        );
        await unlink(mix);
        await unlink(part);
        mix = combined;
      } else mix = part;
      index++;
    }
  const args = [...base, "-i", current, ...(mix ? ["-i", mix] : [])];
  const filters: string[] = [mix ? "[1:a]anull[a]" : "[0:a]volume=0[a]"];
  let label = "0:v";
  const fontFile =
    process.env.AUTOCUT_FONT_FILE ||
    (process.platform === "win32"
      ? "C:/Windows/Fonts/msyh.ttc"
      : "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc");
  if (t.subtitles.length)
    await stat(fontFile).catch(() => {
      throw new DomainError(
        "AUTOCUT_FONT_MISSING",
        "请配置可用的中文字体文件 AUTOCUT_FONT_FILE",
        503,
      );
    });
  for (const [i, cue] of [...t.subtitles]
    .sort((a, b) => a.layer - b.layer)
    .entries()) {
    const path = join(dir, `p1-cue-${i}.txt`);
    await writeFile(path, cue.text);
    const opacity = parameterExpression(t, cue.id, "", "opacity", "t");
    const scale = parameterExpression(t, cue.id, "", "scale", "t"),
      x = parameterExpression(t, cue.id, "", "x", "t"),
      y = parameterExpression(t, cue.id, "", "y", "t");
    filters.push(
      `[${label}]drawtext=fontfile='${pathExpr(fontFile)}':textfile='${pathExpr(path)}':expansion=none:fontsize='${cue.font_size}*(${scale})':fontcolor=${cue.color}:borderw=2:bordercolor=black:x='(w-text_w)/2+(${n(cue.x)}+(${x}))*w':y='(${n(cue.y)}+(${y}))*h':alpha='${opacity}':enable='gte(t,${seconds(cue.start)})*lt(t,${seconds(cue.end)})'[sub${i}]`,
    );
    label = `sub${i}`;
  }
  filters.push(
    `[${label}]${lowResolution ? "scale=iw/2:ih/2," : ""}format=yuv420p[v]`,
  );
  const file = join(dir, "p1-final.filter"),
    output = join(dir, "output.mp4");
  await writeFile(file, filters.join(";"));
  await runMedia(
    ffmpeg,
    [
      ...args,
      filterScriptOption,
      file,
      "-map",
      "[v]",
      "-map",
      "[a]",
      ...encoding,
      "-t",
      seconds(t.target_duration),
      "-movflags",
      "+faststart",
      "-y",
      output,
    ],
    signal,
  );
  const result = await stat(output);
  if (result.size > 500 * 1024 ** 2)
    throw new DomainError("AUTOCUT_OUTPUT_LIMIT", "成片超过500 MB", 422);
  return {
    output,
    width: lowResolution ? size.width / 2 : size.width,
    height: lowResolution ? size.height / 2 : size.height,
    bytes: result.size,
  };
}
