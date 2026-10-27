import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fixture } from "./fixtures/autocut.js";
import {
  compileSelectionPlan,
  initialSelectionPlanJsonSchema,
} from "../src/autocut/planner.js";
import { ResidentFunAsrProvider } from "../src/autocut/resident-asr.js";

test("First plans have a strict source-only schema and cannot smuggle subtitles, audio or effects", () => {
  const { p, asset, analyses } = fixture();
  const raw = { clips: [{ asset_index: 0, source_in: 500, source_out: 2500 }] };
  const compile = (r: unknown) =>
    compileSelectionPlan(r, p, [asset], analyses, "16:9", null, false);
  assert.deepEqual(
    compile(raw).subtitles.map(({ id, ...cue }) => cue),
    [{ start: 0, end: 2000, text: "完整语句" }],
  );
  for (const extra of [
    { subtitles: [] },
    { subtitles: [{ start: 500, end: 2500, text: "model caption" }] },
    { audio: [] },
    { warnings: [] },
    { shell: "arbitrary" },
  ])
    assert.throws(() => compile({ ...raw, ...extra }));
  for (const extra of [
    { timeline_start: 0 },
    { clip_id: p },
    { volume: 1 },
    { fade_ms: 0 },
    { muted: false },
  ])
    assert.throws(() => compile({ clips: [{ ...raw.clips[0], ...extra }] }));
  assert.equal(initialSelectionPlanJsonSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(initialSelectionPlanJsonSchema.properties!), [
    "clips",
  ]);
  assert.throws(() =>
    compile({ clips: [{ ...raw.clips[0], source_out: 4001 }] }),
  );
  assert.throws(() =>
    compile({ clips: [{ ...raw.clips[0], source_out: 400 }] }),
  );
});

test("First captions use source intersections, output order and half-open cut boundaries", () => {
  const { p, asset, analyses } = fixture();
  analyses[asset.id].transcript.segments = [
    { start: 500, end: 1500, text: "甲", confidence: null },
    { start: 1500, end: 2500, text: "乙", confidence: null },
    { start: 2500, end: 3500, text: "丙", confidence: null },
  ];
  const run = (ranges: [number, number][]) =>
    compileSelectionPlan(
      {
        clips: ranges.map(([source_in, source_out]) => ({
          asset_index: 0,
          source_in,
          source_out,
        })),
      },
      p,
      [asset],
      analyses,
      "16:9",
      null,
      false,
    );
  const reordered = run([
    [2500, 3500],
    [500, 1500],
  ]);
  assert.deepEqual(
    reordered.subtitles.map(({ id, ...cue }) => cue),
    [
      { start: 0, end: 1000, text: "丙" },
      { start: 1000, end: 2000, text: "甲" },
    ],
  );
  // A sentence intersecting two clips is clamped to each actual cut; neither cue keeps source coordinates.
  const split = run([
    [1000, 2000],
    [2000, 3000],
  ]);
  assert.deepEqual(
    split.subtitles.map(({ id, ...cue }) => cue),
    [
      { start: 0, end: 500, text: "甲" },
      { start: 500, end: 1000, text: "乙" },
      { start: 1000, end: 1500, text: "乙" },
      { start: 1500, end: 2000, text: "丙" },
    ],
  );
  assert.equal(new Set(split.subtitles.map((c) => c.id)).size, 4);
  assert.deepEqual(run([[3500, 4000]]).subtitles, []);
  analyses[asset.id].transcript.segments = [];
  assert.deepEqual(run([[500, 1500]]).subtitles, []);
});

test("First captions resolve immutable versions independently across mixed assets", () => {
  const { p, asset, analyses } = fixture(),
    other = fixture();
  const compiled = compileSelectionPlan(
    {
      clips: [
        { asset_index: 1, source_in: 1000, source_out: 2000 },
        { asset_index: 0, source_in: 1500, source_out: 3000 },
      ],
    },
    p,
    [asset, other.asset],
    { ...analyses, ...other.analyses },
    "16:9",
    null,
    false,
  );
  assert.deepEqual(
    compiled.subtitles.map(({ id, ...c }) => c),
    [
      { start: 0, end: 1000, text: "完整语句" },
      { start: 1000, end: 2000, text: "完整语句" },
    ],
  );
  assert.equal(compiled.target_duration, 2500);
});

test("Unedited real model plan-v3 compiles to measured ASR captions; real legacy model captions are rejected", async () => {
  const evidence = JSON.parse(
    await readFile(
      new URL("./fixtures/autocut-real-first-plan.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    createHash("sha256").update(evidence.rawText).digest("hex"),
    evidence.provenance.rawTextSha256,
  );
  assert.deepEqual(JSON.parse(evidence.rawText), evidence.newPlan);
  const compile = (raw: unknown) =>
    compileSelectionPlan(
      raw,
      evidence.projectId,
      evidence.assets,
      evidence.analyses,
      "16:9",
      null,
      false,
    );
  assert.throws(() => compile(evidence.oldRejectedPlan));
  const timeline = compile(evidence.newPlan);
  assert.equal(timeline.target_duration, evidence.expectedDuration);
  assert.deepEqual(
    timeline.subtitles.map((s) => s.text),
    evidence.expectedSubtitleText,
  );
  assert.equal(timeline.subtitles[0].start, 0);
  assert.equal(timeline.subtitles.at(-1)!.end, timeline.target_duration);
});

function provider() {
  const script = fileURLToPath(
    new URL("./fixtures/autocut-asr-daemon.mjs", import.meta.url),
  );
  const dir = fileURLToPath(new URL("./fixtures", import.meta.url));
  return new ResidentFunAsrProvider(process.execPath, script, dir, dir, dir);
}
async function loaded(p: ResidentFunAsrProvider) {
  for (let i = 0; i < 100 && p.diagnostics.loadMs === undefined; i++)
    await delay(10);
  assert.ok(p.diagnostics.pid);
}
test("Resident ASR queues requests, reuses one process and cancels queued work without killing active work", async () => {
  const p = provider();
  try {
    const first = p.transcribe("slow", AbortSignal.timeout(10000));
    await loaded(p);
    const cancel = new AbortController();
    const queued = p.transcribe("slow", cancel.signal);
    const rejection = assert.rejects(queued, /queued cancelled/);
    cancel.abort(new Error("queued cancelled"));
    await rejection;
    await first;
    const third = await p.transcribe("short", AbortSignal.timeout(10000));
    assert.equal(third.segments[0].text, "protocol fixture");
    assert.equal(p.diagnostics.loads, 1);
  } finally {
    await p.close();
  }
});
test("Resident ASR active cancellation kills its process tree; crashes fail once and the next request reloads", async () => {
  const p = provider();
  try {
    const cancel = new AbortController();
    const active = p.transcribe("slow", cancel.signal);
    const rejection = assert.rejects(active, /active cancelled/);
    await loaded(p);
    cancel.abort(new Error("active cancelled"));
    await rejection;
    await p.transcribe("short", AbortSignal.timeout(10000));
    assert.equal(p.diagnostics.loads, 2);
    await assert.rejects(
      p.transcribe("crash", AbortSignal.timeout(10000)),
      /PROCESS_EXITED/,
    );
    assert.equal(p.diagnostics.loads, 2); // no automatic inference retry
    await p.transcribe("short", AbortSignal.timeout(10000));
    assert.equal(p.diagnostics.loads, 3);
  } finally {
    await p.close();
  }
  await assert.rejects(
    p.transcribe("short", AbortSignal.timeout(1000)),
    /CLOSED/,
  );
});
