import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ObjectStorage } from "../object-storage.js";
import { DomainError } from "../domain.js";
import {
  AUTOCUT_LIMITS as limits,
  transcriptSchema,
  type Analysis,
  type MediaAsset,
  type Timeline,
} from "./contract.js";

export type AsrProvider = {
  transcribe(
    path: string,
    signal: AbortSignal,
  ): Promise<Analysis["transcript"]>;
};
const formats =
  "mov,matroska,avi,mp3,wav,flac,aac,ogg,image2,jpeg_pipe,png_pipe,webp_pipe";
export const inputSafety = [
  "-protocol_whitelist",
  "file,pipe",
  "-format_whitelist",
  formats,
];

export function runMedia(
  binary: string,
  args: string[],
  signal: AbortSignal,
  onLog?: (line: string) => void,
) {
  signal.throwIfAborted();
  return new Promise<string>((resolve, reject) => {
    const child = spawn(binary, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdout = "",
      stderr = "",
      pending = "";
    const abort = () => child.kill("SIGKILL");
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (b) => {
      stdout += String(b);
    });
    child.stderr.on("data", (b) => {
      stderr = (stderr + String(b)).slice(-16000);
      pending += String(b);
      const lines = pending.split(/[\r\n]/);
      pending = lines.pop() || "";
      for (const line of lines) onLog?.(line);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(signal.reason);
      else if (code === 0) resolve(stdout);
      else
        reject(
          new DomainError(
            "AUTOCUT_MEDIA_FAILED",
            "媒体解码或渲染失败，请检查文件格式",
            422,
            false,
            { details: { exitCode: code } },
          ),
        );
    });
  });
}

export async function downloadAsset(
  storage: ObjectStorage,
  asset: MediaAsset,
  path: string,
  signal: AbortSignal,
) {
  if (asset.bytes > limits.fileBytes)
    throw new DomainError("AUTOCUT_FILE_LIMIT", "单文件不能超过 500 MB", 422);
  const object = await storage.openDownload(
    asset.storageKey,
    undefined,
    signal,
  );
  if (object.bytes !== asset.bytes || object.bytes > limits.fileBytes)
    throw new DomainError(
      "AUTOCUT_FILE_CHANGED",
      "素材大小与已登记版本不一致",
      422,
    );
  let bytes = 0;
  const hash = createHash("sha256");
  const source = Readable.fromWeb(
    object.body as import("node:stream/web").ReadableStream<Uint8Array>,
  );
  source.on("data", (chunk) => {
    bytes += chunk.length;
    hash.update(chunk);
    if (bytes > asset.bytes) source.destroy(new Error("AUTOCUT_FILE_OVERFLOW"));
  });
  await pipeline(source, createWriteStream(path, { flags: "wx" }), { signal });
  if (bytes !== asset.bytes)
    throw new DomainError("AUTOCUT_FILE_TRUNCATED", "素材下载不完整", 422);
  if (hash.digest("hex") !== asset.sha256.toLowerCase())
    throw new DomainError(
      "AUTOCUT_CHECKSUM_MISMATCH",
      "素材校验失败，原始版本可能已变化，请重新上传",
      422,
    );
}

export function probePath(ffmpeg: string) {
  return join(
    dirname(ffmpeg),
    /\.exe$/i.test(basename(ffmpeg)) ? "ffprobe.exe" : "ffprobe",
  );
}

export async function probeMedia(
  ffmpeg: string,
  path: string,
  signal: AbortSignal,
): Promise<Analysis> {
  const raw = JSON.parse(
    await runMedia(
      probePath(ffmpeg),
      [
        "-v",
        "error",
        ...inputSafety,
        "-show_entries",
        "format=duration,format_name:stream=codec_type,width,height,r_frame_rate,duration",
        "-of",
        "json",
        path,
      ],
      signal,
    ),
  );
  const streams = raw.streams as Array<{
    codec_type: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    duration?: string;
  }>;
  if (!Array.isArray(streams) || !streams.length)
    throw new DomainError(
      "AUTOCUT_INVALID_MEDIA",
      "文件不包含可解码的媒体",
      422,
    );
  const video = streams.find((s) => s.codec_type === "video");
  const hasAudio = streams.some((s) => s.codec_type === "audio");
  const isImage = ["jpeg_pipe", "png_pipe", "webp_pipe", "image2"].includes(
    raw.format?.format_name,
  );
  const durationMs = isImage
    ? 0
    : Math.round(Number(raw.format?.duration ?? video?.duration) * 1000);
  if (
    !Number.isFinite(durationMs) ||
    (!isImage && durationMs <= 0) ||
    durationMs > limits.durationMs
  )
    throw new DomainError(
      "AUTOCUT_DURATION_LIMIT",
      "素材时长无效或超过 30 分钟",
      422,
    );
  const [n, d] = (video?.r_frame_rate || "0/1").split("/").map(Number);
  return {
    version: 1,
    durationMs,
    width: video?.width || 0,
    height: video?.height || 0,
    fps: d ? n / d : 0,
    hasAudio,
    kind: isImage ? "image" : video ? "video" : "audio",
    silences: [],
    scenes: [],
    transcript: { segments: [] },
    candidates: [],
  };
}

/** Source milliseconds; buckets are half-open and empty buckets remain empty. */
export function selectKeyframeTimes(
  info: Pick<Analysis, "kind" | "durationMs" | "scenes">,
  keyframes: number = limits.keyframes,
): number[] {
  if (info.kind === "audio") return [];
  if (info.kind === "image") return [0];
  if (!info.scenes.length) return [];
  const duration = info.durationMs;
  if (!Number.isSafeInteger(duration) || duration <= 0 || duration > limits.durationMs ||
      !Number.isSafeInteger(keyframes) || keyframes <= 0 || keyframes > limits.keyframes)
    throw new DomainError("AUTOCUT_INVALID_MEDIA", "素材时长或关键帧上限无效", 422);
  const n = Math.min(keyframes, info.scenes.length);
  const buckets = new Map<number, { at: number; duration: number }>();
  for (const { start, end } of info.scenes) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start < 0 || end <= start || end > duration)
      throw new DomainError("AUTOCUT_INVALID_MEDIA", "场景时间范围无效", 422);
    const bucket = Math.min(n - 1, Math.floor(((start + end) * n) / (2 * duration)));
    const candidate = { at: Math.floor((start + end) / 2), duration: end - start };
    const previous = buckets.get(bucket);
    if (!previous || candidate.duration > previous.duration) buckets.set(bucket, candidate);
  }
  return [...new Set([...buckets.values()].map((s) => s.at))].sort((a, b) => a - b);
}

export async function preprocess(
  ffmpeg: string,
  path: string,
  dir: string,
  signal: AbortSignal,
  asr?: AsrProvider,
  cached?: Analysis,
) {
  const started = Date.now();
  let asrMs = 0;
  const info = cached ?? (await probeMedia(ffmpeg, path, signal));
  const scenes: number[] = [0];
  let silenceStart: number | undefined;
  const base = [
    "-nostdin",
    "-hide_banner",
    "-threads",
    String(limits.threads),
    "-filter_threads",
    String(limits.threads),
    ...inputSafety,
    "-i",
    path,
  ];
  if (!cached && (info.kind === "video" || info.hasAudio)) {
    const filters = [
      ...(info.kind === "video"
        ? ["-vf", "select='gt(scene,0.3)',showinfo"]
        : []),
      ...(info.hasAudio ? ["-af", "silencedetect=noise=-35dB:d=0.6"] : []),
    ];
    await runMedia(
      ffmpeg,
      [...base, ...filters, "-f", "null", "-"],
      signal,
      (line) => {
        const scene = /pts_time:([\d.]+)/.exec(line);
        if (scene) scenes.push(Math.round(Number(scene[1]) * 1000));
        const start = /silence_start: ([\d.]+)/.exec(line),
          end = /silence_end: ([\d.]+)/.exec(line);
        if (start) silenceStart = Math.round(Number(start[1]) * 1000);
        if (end && silenceStart !== undefined) {
          info.silences.push({
            start: silenceStart,
            end: Math.min(info.durationMs, Math.round(Number(end[1]) * 1000)),
          });
          silenceStart = undefined;
        }
      },
    );
  }
  if (silenceStart !== undefined)
    info.silences.push({ start: silenceStart, end: info.durationMs });
  const boundaries = [
    ...new Set([...scenes.filter((x) => x < info.durationMs), info.durationMs]),
  ].sort((a, b) => a - b);
  if (!cached)
    info.scenes =
      info.kind === "image"
        ? [{ start: 0, end: 0 }]
        : boundaries
            .slice(0, -1)
            .map((s, i) => ({ start: s, end: boundaries[i + 1] }));
  const frames: { at: number; dataUrl: string }[] = [];
  if (info.kind !== "audio") {
    const selected = selectKeyframeTimes(info);
    for (const [i, at] of selected.entries()) {
      const output = join(dir, `frame-${i}.jpg`);
      await runMedia(
        ffmpeg,
        [
          "-nostdin",
          "-hide_banner",
          "-loglevel",
          "error",
          "-threads",
          "2",
          "-filter_threads",
          "2",
          ...inputSafety,
          "-ss",
          String(at / 1000),
          "-i",
          path,
          "-frames:v",
          "1",
          "-vf",
          "scale=512:-2:force_original_aspect_ratio=decrease",
          "-threads",
          "2",
          "-y",
          output,
        ],
        signal,
      );
      frames.push({
        at,
        dataUrl: `data:image/jpeg;base64,${(await readFile(output)).toString("base64")}`,
      });
    }
  }
  if (!cached && info.hasAudio) {
    if (!asr)
      throw new DomainError(
        "AUTOCUT_ASR_UNCONFIGURED",
        "语音识别服务尚未配置，无法分析含音轨素材",
        503,
      );
    const wav = join(dir, "speech.wav");
    await runMedia(
      ffmpeg,
      [
        ...base,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        "-y",
        wav,
      ],
      signal,
    );
    const asrStarted = Date.now();
    info.transcript = transcriptSchema.parse(await asr.transcribe(wav, signal));
    asrMs = Date.now() - asrStarted;
    for (const s of info.transcript.segments)
      if (s.end <= s.start || s.end > info.durationMs)
        throw new DomainError(
          "AUTOCUT_ASR_INVALID",
          "语音识别返回越界时间戳",
          422,
        );
  }
  if (!cached)
    info.processing = {
      preprocessMs: Date.now() - started,
      asrMs,
      asrApiCostCny: 0,
      basis: "local_cpu_no_api_charge",
    };
  return { info, frames };
}

async function renderV1Timeline(
  ffmpeg: string,
  timeline: Timeline,
  paths: Record<string, string>,
  analyses: Record<string, Analysis>,
  dir: string,
  signal: AbortSignal,
) {
  const visual = timeline.tracks.find((t) => t.kind === "video")!;
  const width =
    timeline.aspect_ratio === "9:16"
      ? 720
      : timeline.aspect_ratio === "1:1"
        ? 720
        : 1280;
  const height =
    timeline.aspect_ratio === "16:9"
      ? 720
      : timeline.aspect_ratio === "1:1"
        ? 720
        : 1280;
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
  const segments: string[] = [];
  for (const [i, c] of visual.clips.entries()) {
    const info = analyses[c.asset_version_id],
      duration = (c.source_out - c.source_in) / 1000,
      out = join(dir, `clip-${i}.mp4`);
    const args = [
      ...base,
      ...inputSafety,
      ...(info.kind === "image"
        ? ["-loop", "1"]
        : ["-ss", String(c.source_in / 1000)]),
      "-i",
      paths[c.asset_version_id],
    ];
    if (!info.hasAudio || c.effects.muted)
      args.push(
        "-f",
        "lavfi",
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=48000",
      );
    const fade =
      c.transitions.type === "fade" && c.transitions.duration
        ? `,fade=t=in:st=0:d=${c.transitions.duration / 1000},fade=t=out:st=${duration - c.transitions.duration / 1000}:d=${c.transitions.duration / 1000}`
        : "";
    args.push(
      "-vf",
      `setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${timeline.fps},format=yuv420p${fade}`,
      "-map",
      "0:v:0",
      "-map",
      info.hasAudio && !c.effects.muted ? "0:a:0" : "1:a:0",
      "-af",
      `asetpts=PTS-STARTPTS,aresample=48000,apad,volume=${c.effects.volume}`,
      "-t",
      String(duration),
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
      "-y",
      out,
    );
    await runMedia(ffmpeg, args, signal);
    segments.push(out);
  }
  // Names are generated here; no user-controlled concat paths or filter expressions.
  await writeFile(
    join(dir, "concat.txt"),
    segments.map((_, i) => `file 'clip-${i}.mp4'`).join("\n"),
  );
  const args = [
    ...base,
    "-protocol_whitelist",
    "file,pipe",
    "-f",
    "concat",
    "-safe",
    "1",
    "-i",
    join(dir, "concat.txt"),
  ];
  const audio = timeline.tracks
    .filter((t) => t.kind === "audio")
    .flatMap((t) => t.clips);
  for (const c of audio)
    args.push(
      "-threads",
      "2",
      ...inputSafety,
      "-ss",
      String(c.source_in / 1000),
      "-t",
      String((c.source_out - c.source_in) / 1000),
      "-i",
      paths[c.asset_version_id],
    );
  const filters = [
    `[0:a]asetpts=PTS-STARTPTS,volume=${timeline.audio_settings.master_volume}[a0]`,
  ];
  for (const [i, c] of audio.entries())
    filters.push(
      `[${i + 1}:a]asetpts=PTS-STARTPTS,aresample=48000,adelay=${c.timeline_start}:all=1,volume=${c.effects.muted ? 0 : c.effects.volume * timeline.audio_settings.master_volume}[a${i + 1}]`,
    );
  filters.push(
    `${Array.from({ length: audio.length + 1 }, (_, i) => `[a${i}]`).join("")}amix=inputs=${audio.length + 1}:normalize=0:duration=first[aout]`,
  );
  if (timeline.subtitles.length) {
    const subtitlePath = join(dir, "subtitles.srt");
    await writeFile(
      subtitlePath,
      timeline.subtitles
        .map(
          (s, i) =>
            `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text.replace(/[\r\n]/g, " ").replace(/<[^>]*>/g, "")}\n`,
        )
        .join("\n"),
    );
    const escaped = subtitlePath
      .replace(/\\/g, "/")
      .replace(/:/g, "\\:")
      .replace(/'/g, "\\'");
    filters.push(
      `[0:v]setpts=PTS-STARTPTS,subtitles=filename='${escaped}':force_style='FontName=WenQuanYi Zen Hei,FontSize=26,Alignment=2,MarginV=32,Outline=2'[vout]`,
    );
  }
  if (!timeline.subtitles.length)
    filters.push("[0:v]setpts=PTS-STARTPTS[vout]");
  const output = join(dir, "output.mp4");
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[aout]",
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
    "-t",
    String(timeline.target_duration / 1000),
    "-movflags",
    "+faststart",
    "-y",
    output,
  );
  await runMedia(ffmpeg, args, signal);
  const result = await stat(output);
  if (result.size > limits.fileBytes)
    throw new DomainError(
      "AUTOCUT_OUTPUT_LIMIT",
      "成片超过 500 MB，请缩短时间线后重试",
      422,
    );
  return { output, width, height, bytes: result.size };
}
function srtTime(ms: number) {
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}

/** V1 remains byte-for-byte on its original rendering branch. */
export async function renderTimeline(
  ffmpeg: string,
  timeline: Timeline | import("./p1/runtime.js").P1Timeline,
  paths: Record<string, string>,
  analyses: Record<string, Analysis>,
  dir: string,
  signal: AbortSignal,
) {
  if (timeline.schema_version === 1)
    return renderV1Timeline(ffmpeg, timeline, paths, analyses, dir, signal);
  const { requireP1 } = await import("./p1/contract.js");
  requireP1();
  return (await import("./p1/render.js")).renderP1(
    ffmpeg,
    timeline,
    paths,
    analyses,
    dir,
    signal,
  );
}
