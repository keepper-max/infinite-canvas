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
  selectKeyframeTimes,
  probeMedia,
  downloadAsset,
  preprocess,
  renderTimeline,
  runMedia,
} from "../src/autocut/media.js";
import { autoCutTextPayload, parseModelJson, readAutoCutModelConfig } from "../src/autocut/model.js";
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
    const imageDir = join(dir, "image-preprocess");
    await mkdir(imageDir);
    const imagePrepared = await preprocess(ffmpeg, picture, imageDir, signal, undefined, imageInfo);
    assert.equal(imagePrepared.frames.length, 1, "Cached images with no scenes still produce one frame");
    assert.equal(imagePrepared.frames[0].at, 0);
    const audioPrepared = await preprocess(ffmpeg, source, dir, signal, undefined, { ...probed, kind: "audio", scenes: [] });
    assert.deepEqual(audioPrepared.frames, []);
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


test("Time buckets select at most 20 unique increasing source midpoints, including nonempty boundary buckets", () => {
  const uniform = (count: number) => ({ kind: "video" as const, durationMs: count * 100,
    scenes: Array.from({ length: count }, (_, i) => ({ start: i * 100, end: (i + 1) * 100 })) });
  for (const [count, expected] of [[0, 0], [1, 1], [21, 20], [39, 20], [40, 20]]) {
    const info = uniform(count), times = selectKeyframeTimes(info);
    assert.equal(times.length, expected);
    assert.ok(times.length <= AUTOCUT_LIMITS.keyframes);
    assert.deepEqual(times, selectKeyframeTimes(info));
    for (const [i, at] of times.entries()) {
      assert.ok(Number.isSafeInteger(at) && at >= 0 && at < info.durationMs);
      assert.ok(!i || at > times[i - 1]);
      assert.ok(info.scenes.some(s => Math.floor((s.start + s.end) / 2) === at));
    }
    if (count) {
      const n = Math.min(20, count), bucket = (t: number) => Math.floor(t * n / info.durationMs);
      assert.equal(bucket(times[0]), 0);
      assert.equal(bucket(times.at(-1)!), n - 1);
    }
  }
});

test("Time buckets keep the longest scene and original-order ties, leave empty buckets, and never insert endpoints", () => {
  const info = { kind: "video" as const, durationMs: 4000,
    scenes: [{ start: 0, end: 100 }, { start: 100, end: 400 }, { start: 400, end: 700 }, { start: 3000, end: 4000 }] };
  assert.deepEqual(selectKeyframeTimes(info), [250, 3500]);
  assert.deepEqual(selectKeyframeTimes({ ...info, scenes: [info.scenes[2], info.scenes[1], info.scenes[0], info.scenes[3]] }), [550, 3500]);
  const boundary = { kind: "video" as const, durationMs: 1000,
    scenes: [{ start: 100, end: 900 }, { start: 0, end: 100 }] };
  assert.deepEqual(selectKeyframeTimes(boundary), [50, 500]);
  assert.deepEqual(selectKeyframeTimes({ ...boundary, scenes: [{ start: 0, end: 1000 }] }), [500]);
  assert.deepEqual(selectKeyframeTimes({ kind: "video", durationMs: 7,
    scenes: [{start:0,end:1},{start:1,end:2},{start:2,end:7}] }), [0, 4]);
});

test("Dense scenes are selected by time and output timestamps are deduplicated without fabricated times", () => {
  const scenes = Array.from({ length: 20 }, (_, i) => ({ start: i, end: i + 1 }));
  scenes.push({ start: 900, end: 1000 });
  assert.deepEqual(selectKeyframeTimes({kind:"video",durationMs:1000,scenes}), [0,950]);
  const tiny = [{start:0,end:1},{start:0,end:2},{start:1,end:2},{start:2,end:4}];
  assert.deepEqual(selectKeyframeTimes({kind:"video",durationMs:4,scenes:[...tiny,...tiny]}), [0,1,3]);
});

test("Image/audio behavior, invalid scene rejection and independence from assets", () => {
  assert.deepEqual(selectKeyframeTimes({kind:"image",durationMs:0,scenes:[]}),[0]);
  assert.deepEqual(selectKeyframeTimes({kind:"audio",durationMs:1000,scenes:[]}),[]);
  for (const scene of [{start:-1,end:20},{start:20,end:20},{start:30,end:20},{start:0,end:101},{start:0.5,end:20},{start:0,end:NaN}])
    assert.throws(()=>selectKeyframeTimes({kind:"video",durationMs:100,scenes:[scene]}));
  assert.throws(()=>selectKeyframeTimes({kind:"video",durationMs:AUTOCUT_LIMITS.durationMs+1,scenes:[{start:0,end:1}]}));
  const info = {kind:"video" as const,durationMs:4000,scenes:Array.from({length:40},(_,i)=>({start:i*100,end:(i+1)*100}))};
  const expected=selectKeyframeTimes(info), old=AUTOCUT_LIMITS.assets;
  try { (AUTOCUT_LIMITS as {assets:number}).assets=2;assert.deepEqual(selectKeyframeTimes(info),expected); }
  finally { (AUTOCUT_LIMITS as {assets:number}).assets=old; }
});

test("parseModelJson preserves valid JSON types and extracts only the first balanced object", () => {
  const object={clips:[], nested:{text:'quoted " { } '+String.raw`\\`}}, json=JSON.stringify(object);
  const forms=[json,`\x60\x60\x60json\n${json}\n\x60\x60\x60`,`  \x60\x60\x60 JSON  \n${json}\n\x60\x60\x60  `,
    `说明 ${json}`,`${json} 说明`,`说明：(${json})，完毕。`,`${json} {"second":true}`];
  for(const text of forms){assert.deepEqual(parseModelJson(text),object);assert.deepEqual(parseModelJson(text),parseModelJson(text));}
  assert.equal(parseModelJson("null"),null);
  for(const value of [[],[1,{x:2}],false,0,"text"])assert.deepEqual(parseModelJson(JSON.stringify(value)),value);
  for(const value of ['quote"','one\\','two\\\\','three\\\\\\','{inside}','x\nnewline']) {
    const raw=JSON.stringify({text:value,nested:{ok:true}});
    assert.deepEqual(parseModelJson(`prefix ${raw} suffix`),JSON.parse(raw));
  }
});

test("parseModelJson rejects empty, truncated and malformed first objects instead of scanning later objects", () => {
  for(const text of ["","  ","说明",'{"clips":','{"a":"unfinished}', '{"a":1,}', '{bad} {"valid":true}', '{"a":"line\ntext"}', String.raw`{"a":"\q"}`, '{"a": {"b":1}'])
    assert.equal(parseModelJson(text),undefined,text);
});

test("Timebucket configuration requires an explicit new analysis identity without changing quotes", () => {
  const env={AUTOCUT_ENABLED:"true",AUTOCUT_MODEL_ID:"fixture",AUTOCUT_MODEL_QUOTE_CENTS:"25",AUTOCUT_MODEL_MAX_OUTPUT_TOKENS:"4096",AUTOCUT_MODEL_VISION_VERIFIED:"true",AUTOCUT_ANALYSIS_VERSION:"cpu-v1-qwen35flash-20261027-timebucket-v2"};
  assert.equal(readAutoCutModelConfig(env)?.analysisVersion,env.AUTOCUT_ANALYSIS_VERSION);
  assert.equal(readAutoCutModelConfig(env)?.quoteCents,25);
  assert.throws(()=>readAutoCutModelConfig({...env,AUTOCUT_ANALYSIS_VERSION:"cpu-v1-qwen35flash-20261027"}));
});
