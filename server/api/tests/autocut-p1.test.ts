import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./fixtures/autocut.js";
import {
  upgradeTimeline,
  primary,
  clipEnd,
  splitClip,
  duplicateClips,
  removeClips,
  reflow,
  setTransition,
  frameValues,
  uid,
  applyPreset,
} from "../src/autocut/p1/runtime.js";
import { validateP1, p1Enabled } from "../src/autocut/p1/contract.js";
import { compileEffectPlan } from "../src/autocut/p1/effects-planner.js";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { runMedia, probeMedia } from "../src/autocut/media.js";
import { renderP1 } from "../src/autocut/p1/render.js";
import { previewTimeline } from "../src/autocut/p1/preview.js";
import { exportBundle, fileHash } from "../src/autocut/p1/operations.js";

function setup() {
  const f = fixture();
  f.t.subtitles = [{ id: uid(), start: 0, end: 2000, text: "完整句子" }];
  const t = upgradeTimeline(f.t, () => true);
  return {
    ...f,
    t,
    check: (x: unknown) => validateP1(x, f.p, [f.asset], f.analyses),
  };
}
test("P1 upgrade preserves source spans, separates original sound and leaves V1 unchanged", () => {
  const f = fixture(),
    before = JSON.stringify(f.t),
    t = upgradeTimeline(f.t, () => true);
  assert.equal(JSON.stringify(f.t), before);
  assert.equal(primary(t).clips[0].effects.muted, true);
  const sound = t.tracks.find((t) => t.role === "original")!.clips[0];
  assert.equal(sound.linked_clip_id, primary(t).clips[0].id);
  assert.equal(sound.source_in, 1000);
  validateP1(t, f.p, [f.asset], f.analyses);
  assert.equal(p1Enabled({}), false);
});
test("Split maps captions and linked source audio across the cut, then speed/reorder remains valid", () => {
  const f = setup(),
    id = primary(f.t).clips[0].id;
  {
    splitClip(f.t, id, 1000);
    f.check(f.t);
    assert.deepEqual(
      f.t.subtitles.map((s) => [s.start, s.end]),
      [
        [0, 1000],
        [1000, 2000],
      ],
    );
  }
  assert.equal(f.t.tracks.find((t) => t.role === "original")!.clips.length, 2);
  const old = structuredClone(f.t);
  primary(f.t).clips.reverse();
  primary(f.t).clips[0].speed = 2;
  reflow(f.t, old);
  f.check(f.t);
  assert.equal(f.t.target_duration, 1500);
  assert.equal(f.t.subtitles.find((s) => s.anchor?.clip_id === id)!.start, 500);
  const original = f.t.tracks.find((t) => t.role === "original")!;
  assert.equal(
    original.clips.find((c) => c.linked_clip_id === primary(f.t).clips[0].id)!
      .speed,
    2,
  );
});
test("Copy shifts animated time, original audio and caption anchors; deletion removes their references", () => {
  const f = setup(),
    id = primary(f.t).clips[0].id,
    next = applyPreset(f.t, "product", new Set([id]));
  duplicateClips(next, new Set([id]));
  f.check(next);
  const copy = primary(next).clips[1];
  assert.equal(copy.timeline_start, 2000);
  assert.equal(
    next.effect_stack.find((e) => e.target.id === copy.id)!.start,
    2000,
  );
  assert.equal(next.subtitles.length, 2);
  removeClips(next, new Set([id]));
  f.check(next);
  assert.equal(next.effect_stack.length, 1);
  assert.equal(next.subtitles.length, 1);
  assert.equal(next.target_duration, 2000);
});
test("Transitions shorten the timeline exactly; trimming keeps source-linked captions and valid overlap", () => {
  const f = setup();
  duplicateClips(f.t, new Set([primary(f.t).clips[0].id]));
  const [a, b] = primary(f.t).clips;
  setTransition(f.t, a.id, b.id, "dissolve", 400);
  f.check(f.t);
  assert.equal(f.t.target_duration, 3600);
  assert.equal(b.timeline_start, 1600);
  const old = structuredClone(f.t);
  a.source_out = 1200;
  reflow(f.t, old);
  f.check(f.t);
  assert.equal(b.timeline_start, 100);
  assert.equal(f.t.target_duration, 2100);
  assert.equal(f.t.effect_stack[0].end - f.t.effect_stack[0].start, 100);
});
test("Effects reject scripts, unknown fields, unauthorized targets, invalid bounds and unordered keyframes", () => {
  const f = setup(),
    id = primary(f.t).clips[0].id,
    n = applyPreset(f.t, "vlog", new Set([id]));
  f.check(n);
  for (const mutate of [
    (v: any) => {
      v.effect_stack[0].params.command = "ffmpeg";
    },
    (v: any) => {
      v.effect_stack[0].target.id = uid();
    },
    (v: any) => {
      v.effect_stack[0].keyframes.reverse();
    },
    (v: any) => {
      v.effect_stack[0].params.scale = 100;
    },
    (v: any) => {
      v.tracks[0].clips[0].asset_version_id = uid();
    },
    (v: any) => {
      v.tracks[0].clips[0].source_out = 5000;
    },
  ]) {
    const bad = structuredClone(n);
    mutate(bad);
    assert.throws(() => f.check(bad));
  }
});
test("Linked audio and subtitle effects survive copy/split and leave no orphan on deletion", () => {
  const f = setup(),
    main = primary(f.t).clips[0],
    sound = f.t.tracks.find((t) => t.role === "original")!.clips[0],
    cue = f.t.subtitles[0];
  for (const [kind, id, type, key] of [
    ["clip", sound.id, "audio", "gain"],
    ["subtitle", cue.id, "animation", "opacity"],
  ] as const)
    f.t.effect_stack.push({
      id: uid(),
      version: 1,
      type,
      target: { kind, id },
      start: 0,
      end: 2000,
      enabled: true,
      interpolation: "linear",
      params: { [key]: 1 },
      keyframes: [
        { at: 0, values: { [key]: 0 }, interpolation: "linear" },
        { at: 2000, values: { [key]: 1 }, interpolation: "linear" },
      ],
    });
  const copied = duplicateClips(structuredClone(f.t), new Set([main.id]));
  f.check(copied);
  assert.equal(copied.effect_stack.length, 4);
  removeClips(copied, new Set([main.id]));
  f.check(copied);
  assert.equal(copied.effect_stack.length, 2);
  splitClip(f.t, main.id, 1000);
  f.check(f.t);
  assert.equal(f.t.effect_stack.length, 4);
  const right = primary(f.t).clips[1],
    rightSound = f.t.tracks
      .find((t) => t.role === "original")!
      .clips.find((c) => c.linked_clip_id === right.id)!;
  assert.equal(
    f.t.effect_stack.find((e) => e.target.id === rightSound.id)!.keyframes[0]
      .values.gain,
    0.5,
  );
  delete rightSound.linked_clip_id;
  reflow(f.t);
  assert.ok(
    f.t.tracks.some((t) => t.clips.some((c) => c.id === rightSound.id)),
  );
  f.check(f.t);
});
test("Animation interpolation is deterministic with half-open effect boundaries and clipped endpoint values", () => {
  const f = setup(),
    id = primary(f.t).clips[0].id,
    e = {
      id: uid(),
      version: 1 as const,
      type: "animation" as const,
      target: { kind: "clip" as const, id },
      start: 0,
      end: 2000,
      enabled: true,
      interpolation: "linear" as const,
      params: { scale: 1 },
      keyframes: [
        { at: 0, values: { scale: 1 }, interpolation: "linear" as const },
        { at: 2000, values: { scale: 2 }, interpolation: "linear" as const },
      ],
    };
  f.t.effect_stack.push(e);
  assert.equal(
    frameValues(f.t, primary(f.t).clips[0], primary(f.t), 1000).scale,
    1.5,
  );
  assert.equal(
    frameValues(f.t, primary(f.t).clips[0], primary(f.t), 2000).scale,
    1,
  );
  const old = structuredClone(f.t);
  primary(f.t).clips[0].source_out = 2000;
  reflow(f.t, old);
  assert.equal(e.keyframes.at(-1)!.values.scale, 1.5);
  f.check(f.t);
});
test("AI effects cannot change selected source ranges or target IDs beyond the user scope", () => {
  const f = setup(),
    id = primary(f.t).clips[0].id;
  assert.throws(() =>
    compileEffectPlan(
      {
        suggestions: [{ target_id: uid(), preset: "push-in", strength: 1 }],
        notes: [],
      },
      f.t,
      [id],
    ),
  );
  assert.throws(() =>
    compileEffectPlan({ clips: [], suggestions: [], notes: [] }, f.t, [id]),
  );
  const n = compileEffectPlan(
    {
      suggestions: [{ target_id: id, preset: "push-in", strength: 0.5 }],
      notes: [],
    },
    f.t,
    [id],
  );
  f.check(n);
  assert.deepEqual(n.tracks, f.t.tracks);
  assert.equal(n.effect_stack.length, 1);
});
test("Transient snippet shifts source/audio/captions without mutating the saved document", () => {
  const f = setup(),
    id = primary(f.t).clips[0].id;
  duplicateClips(f.t, new Set([id]));
  const selected = primary(f.t).clips[1],
    before = JSON.stringify(f.t),
    snippet = previewTimeline(f.t, selected.id);
  assert.equal(snippet.target_duration, 2000);
  assert.equal(primary(snippet).clips[0].timeline_start, 0);
  assert.equal(primary(snippet).clips[0].source_in, 1000);
  assert.equal(snippet.subtitles[0].start, 0);
  assert.equal(JSON.stringify(f.t), before);
  assert.throws(() => previewTimeline(f.t, uid()));
});
test(
  "P1 synthetic filter regression renders an overlapping transition, overlay, source audio and subtitle",
  { skip: process.env.RUN_AUTOCUT_P1_MEDIA !== "1" },
  async () => {
    const root = resolve(
      process.env.AUTOCUT_TEST_TEMP_ROOT || "H:/CodexStorage/autocut/p1/tests",
    );
    await mkdir(root, { recursive: true });
    const dir = await mkdtemp(join(root, "filters-"));
    const binary = process.env.FFMPEG_PATH || "ffmpeg",
      signal = AbortSignal.timeout(120000),
      source = join(dir, "synthetic.mp4");
    try {
      await runMedia(
        binary,
        [
          "-nostdin",
          "-hide_banner",
          "-loglevel",
          "error",
          "-threads",
          "2",
          "-filter_threads",
          "2",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=s=160x90:r=25:d=4",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:duration=4",
          "-c:v",
          "libx264",
          "-threads",
          "2",
          "-c:a",
          "aac",
          "-shortest",
          "-y",
          source,
        ],
        signal,
      );
      const f = setup(),
        id = primary(f.t).clips[0].id;
      duplicateClips(f.t, new Set([id]));
      const next = primary(f.t).clips[1];
      setTransition(f.t, id, next.id, "dissolve", 400);
      const overlay = {
        ...structuredClone(primary(f.t).clips[0]),
        id: uid(),
        timeline_start: 400,
        source_out: 1800,
      };
      f.t.tracks.push({
        id: uid(),
        name: "overlay",
        kind: "video",
        role: "overlay",
        layer: 1,
        muted: false,
        volume: 1,
        clips: [overlay],
      });
      f.t.effect_stack.push({
        id: uid(),
        version: 1,
        type: "transform",
        target: { kind: "clip", id: overlay.id },
        start: overlay.timeline_start,
        end: clipEnd(overlay),
        enabled: true,
        interpolation: "linear",
        params: { scale: 0.3, x: 0.2, rotation: 10, opacity: 0.7 },
        keyframes: [],
      });
      f.check(f.t);
      const out = await renderP1(
          binary,
          f.t,
          { [f.asset.id]: source },
          f.analyses,
          dir,
          signal,
        ),
        info = await probeMedia(binary, out.output, signal);
      assert.equal(info.width, 1280);
      assert.equal(info.height, 720);
      assert.equal(info.hasAudio, true);
      assert.ok(Math.abs(info.durationMs - f.t.target_duration) <= 80);
      assert.ok(out.bytes > 1000);
      const snippet = previewTimeline(f.t, next.id),
        low = await renderP1(
          binary,
          snippet,
          { [f.asset.id]: source },
          f.analyses,
          dir,
          signal,
          true,
        ),
        lowInfo = await probeMedia(binary, low.output, signal);
      assert.equal(lowInfo.width, 640);
      assert.equal(lowInfo.height, 360);
      assert.ok(Math.abs(lowInfo.durationMs - snippet.target_duration) <= 80);
      if (process.env.AUTOCUT_P1_EXPORT_PYTHON) {
        f.asset.bytes = (await stat(source)).size;
        f.asset.sha256 = await fileHash(source);
        for (const format of ["srt", "otio", "fcp7", "jianying"]) {
          const target = join(dir, format);
          await mkdir(target);
          const bundle = await exportBundle(
            binary,
            f.t,
            [f.asset],
            { [f.asset.id]: source },
            f.analyses,
            format,
            true,
            target,
            signal,
          );
          const report = JSON.parse(
            await runMedia(
              process.env.AUTOCUT_P1_EXPORT_PYTHON,
              [
                "-c",
                "import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); c=json.loads(z.read('compatibility.json')); assert c['experimental']; assert not c['verifiedClientVersions']; assert z.testzip() is None; assert any(n.startswith('media/') for n in z.namelist()); assert b'CodexStorage' not in z.read('media-manifest.json'); print(json.dumps(c))",
                bundle.output,
              ],
              signal,
            ),
          );
          assert.equal(report.format, format);
          assert.equal(report.includesMedia, true);
        }
      }
    } finally {
      if (
        process.env.AUTOCUT_KEEP_TEST !== "1" &&
        resolve(dir).startsWith(root + sep)
      )
        await rm(dir, { recursive: true, force: true });
    }
  },
);
