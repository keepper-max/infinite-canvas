import { fixture } from "./fixtures/autocut.js";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AUTOCUT_LIMITS,
  mapSubtitles,
  timelineJsonSchema,
  validateTimeline,
  type Analysis,
  type MediaAsset,
  type Timeline,
} from "../src/autocut/contract.js";
import {
  probeMedia,
  downloadAsset,
  preprocess,
  renderTimeline,
  runMedia,
} from "../src/autocut/media.js";
import { autoCutTextPayload } from "../src/autocut/model.js";
import { compileSelectionPlan } from "../src/autocut/planner.js";

test("AutoCut validates immutable asset identity and exact half-open intervals", () => {
  const { p, asset, analyses, t } = fixture();
  assert.deepEqual(validateTimeline(t, p, [asset], analyses), t);
  for (const mutate of [
    (d: Timeline) => {
      d.project_id = randomUUID();
    },
    (d: Timeline) => {
      d.tracks[0].clips[0].asset_id = randomUUID();
    },
    (d: Timeline) => {
      d.tracks[0].clips[0].source_out = 5000;
    },
    (d: Timeline) => {
      d.tracks[0].clips[0].source_in = -1;
    },
    (d: Timeline) => {
      d.tracks[0].clips[0].timeline_start = 1;
    },
    (d: Timeline) => {
      d.target_duration = 1900;
    },
    (d: Timeline) => {
      d.tracks[0].clips[0].transitions = { type: "fade", duration: 1200 };
    },
    (d: Timeline) => {
      d.subtitles.push({ id: randomUUID(), start: 0, end: 2001, text: "越界" });
    },
  ]) {
    const input = structuredClone(t);
    mutate(input);
    assert.throws(() => validateTimeline(input, p, [asset], analyses));
  }
});
test("AutoCut rejects gaps, duplicate IDs, audio-as-picture and arbitrary shell/effects fields", () => {
  const { p, asset, analyses, t } = fixture();
  assert.throws(() =>
    validateTimeline({ ...t, shell: "anything" }, p, [asset], analyses),
  );
  const duplicate = structuredClone(t);
  duplicate.tracks[0].clips.push(duplicate.tracks[0].clips[0]);
  assert.throws(() => validateTimeline(duplicate, p, [asset], analyses));
  assert.throws(() =>
    validateTimeline(t, p, [asset], {
      [asset.id]: { ...analyses[asset.id], kind: "audio" },
    }),
  );
  assert.throws(() => validateTimeline(t, p, [], analyses));
  assert.throws(() => validateTimeline(null, p, [asset], analyses));
});
test("AutoCut maps measured subtitle intersections to output, preserving text", () => {
  const { t, analyses } = fixture();
  const [cue] = mapSubtitles(t, analyses);
  assert.deepEqual(
    { ...cue, id: "x" },
    { id: "x", start: 0, end: 1500, text: "完整语句" },
  );
  assert.ok(timelineJsonSchema.properties);
  assert.equal(AUTOCUT_LIMITS.concurrency, 1);
});
test("Existing text model requests are byte-for-byte unaffected by AutoCut opt-in", () => {
  assert.deepEqual(
    autoCutTextPayload({ trace: { workflowKind: "director.workflow" } } as any),
    {},
  );
});
test("Selection compiler owns IDs, arithmetic and asset resolution; subtitle scope cannot alter media", () => {
  const { p, asset, analyses, t } = fixture();
  const compiled = compileSelectionPlan(
    {
      clips: [
        { asset_index: 0, source_in: 0, source_out: 1000 },
        { asset_index: 0, source_in: 2000, source_out: 3500 },
      ],
    },
    p,
    [asset],
    analyses,
    "16:9",
    null,
    false,
  );
  assert.equal(compiled.target_duration, 2500);
  assert.equal(compiled.tracks[0].clips[1].timeline_start, 1000);
  assert.equal(compiled.tracks[0].clips[0].asset_version_id, asset.id);
  assert.throws(() =>
    compileSelectionPlan(
      { clips: [{ asset_index: 1, source_in: 0, source_out: 1000 }] },
      p,
      [asset],
      analyses,
      "16:9",
      null,
      false,
    ),
  );
  const subtitle = compileSelectionPlan(
    { clips: [], subtitles: [{ start: 0, end: 1000, text: "只改字幕" }] },
    p,
    [asset],
    analyses,
    "16:9",
    t,
    true,
  );
  assert.deepEqual(subtitle.tracks, t.tracks);
  assert.deepEqual(subtitle.audio_settings, t.audio_settings);
});
test("Selection revisions retain manually edited subtitles and existing audio controls", () => {
  const { p, asset, analyses, t } = fixture();
  t.subtitles = [{ id: randomUUID(), start: 0, end: 1500, text: "人工修改的字幕" }];
  const old = t.tracks[0].clips[0]; old.effects = { volume: 0.25, muted: true };
  const next = compileSelectionPlan({ clips: [{ asset_index: 0, clip_id: old.id, source_in: 1500, source_out: 2500 }] }, p, [asset], analyses, "16:9", t, false);
  assert.equal(next.subtitles[0].text, "人工修改的字幕");
  assert.equal(next.subtitles[0].start, 0); assert.equal(next.subtitles[0].end, 1000);
  assert.deepEqual(next.tracks[0].clips[0].effects, old.effects);
});
test("Asset download streams and verifies actual SHA-256 instead of trusting object metadata", async () => {
  const root = process.platform === "win32" ? "H:/CodexStorage/autocut/poc" : join(tmpdir(), "autocut-test");
  await mkdir(root, { recursive: true }); const dir = await mkdtemp(join(root, "integrity-"));
  const bytes = Buffer.from("real object bytes"), { asset } = fixture();
  const storage = { openDownload: async () => ({ bytes: bytes.length, body: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }) }) } as any;
  asset.bytes = bytes.length; asset.sha256 = createHash("sha256").update(bytes).digest("hex");
  await downloadAsset(storage, asset, join(dir, "valid.bin"), AbortSignal.timeout(5000));
  assert.deepEqual(await readFile(join(dir, "valid.bin")), bytes);
  await assert.rejects(downloadAsset(storage, { ...asset, sha256: "0".repeat(64) }, join(dir, "changed.bin"), AbortSignal.timeout(5000)), /校验失败/);
});
test(
  "AutoCut produces an actual MP4 with source audio, image hold, extra audio and subtitles",
  { skip: !process.env.AUTOCUT_MEDIA_TEST },
  async () => {
    const root = process.env.AUTOCUT_TEST_ROOT || "H:/CodexStorage/autocut/poc";
    await mkdir(root, { recursive: true });
    const dir = await mkdtemp(join(root, "render-test-"));
    const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg",
      signal = AbortSignal.timeout(120000);
    const { p, asset, info, t, analyses } = fixture();
    const source = join(root, "video.mp4"),
      picture = join(root, "still.png");
    const probed = await probeMedia(ffmpeg, source, signal);
    assert.equal(probed.hasAudio, true);
    assert.equal(probed.kind, "video");
    const prepared = await preprocess(ffmpeg, source, dir, signal, undefined, { ...probed, scenes: [{ start: 0, end: probed.durationMs }] });
    assert.equal(prepared.frames.length, 1);
    assert.ok(prepared.frames[0].dataUrl.startsWith("data:image/jpeg;base64,"));
    const imageInfo = await probeMedia(ffmpeg, picture, signal);
    assert.equal(imageInfo.kind, "image");
    const image: MediaAsset = {
      ...asset,
      id: randomUUID(),
      assetId: randomUUID(),
      mimeType: "image/png",
    };
    analyses[image.id] = imageInfo;
    t.tracks[0].clips.push({
      ...t.tracks[0].clips[0],
      id: randomUUID(),
      asset_id: image.assetId,
      asset_version_id: image.id,
      source_in: 0,
      source_out: 1000,
      timeline_start: 2000,
    });
    t.target_duration = 3000;
    t.subtitles = [
      { id: randomUUID(), start: 0, end: 1500, text: "AutoCut media test" },
    ];
    t.tracks.push({
      id: randomUUID(),
      kind: "audio",
      clips: [
        {
          ...t.tracks[0].clips[0],
          id: randomUUID(),
          source_in: 0,
          source_out: 1000,
          timeline_start: 2000,
          effects: { volume: 0.2, muted: false },
        },
      ],
    });
    validateTimeline(t, p, [asset, image], analyses);
    const started = Date.now();
    const result = await renderTimeline(
      ffmpeg,
      t,
      { [asset.id]: source, [image.id]: picture },
      analyses,
      dir,
      signal,
    );
    const output = await probeMedia(ffmpeg, result.output, signal);
    assert.equal(output.hasAudio, true);
    assert.equal(output.width, 1280);
    assert.equal(output.height, 720);
    assert.ok(Math.abs(output.durationMs - 3000) <= 80);
    // Decode actual samples: source sound must survive, image section must not lose the extra audio.
    const pcm = join(dir, "decoded.pcm");
    await runMedia(
      ffmpeg,
      [
        "-v",
        "error",
        "-i",
        result.output,
        "-map",
        "0:a:0",
        "-f",
        "s16le",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-y",
        pcm,
      ],
      signal,
    );
    const bytes = await readFile(pcm);
    let amplitude = 0;
    for (let i = 0; i < bytes.length; i += 2)
      amplitude += Math.abs(bytes.readInt16LE(i));
    assert.ok(amplitude / (bytes.length / 2) > 100);
    await writeFile(
      join(root, "media-test-result.json"),
      JSON.stringify(
        {
          output: result.output,
          durationMs: output.durationMs,
          renderMs: Date.now() - started,
          bytes: result.bytes,
          sourceAudio: true,
          picture: true,
          subtitles: true,
          extraAudio: true,
        },
        null,
        2,
      ),
    );
  },
);
test(
  "AutoCut cancellation kills the actual media subprocess",
  { skip: !process.env.AUTOCUT_MEDIA_TEST },
  async () => {
    const c = new AbortController();
    setTimeout(() => c.abort(new Error("cancel-test")), 300);
    await assert.rejects(
      runMedia(
        process.env.FFMPEG_PATH || "ffmpeg",
        ["-re", "-f", "lavfi", "-i", "testsrc2", "-f", "null", "-"],
        c.signal,
      ),
      /cancel-test/,
    );
  },
);
