import assert from "node:assert/strict";
import test from "node:test";
import { compileAnalysisResult } from "../src/autocut/analysis.js";
import { fixture } from "./fixtures/autocut.js";

test("Analysis accepts textual evidence lists without changing measured ranges", () => {
  const { asset, analyses } = fixture(), info = analyses[asset.id];
  const candidate = { start: 500, end: 2500, summary: "完整句子", evidence: ["关键帧", "真实转写"], confidence: 0.95 };
  const result = compileAnalysisResult({ candidates: [candidate] }, info);
  assert.deepEqual(result.candidates, [{ ...candidate, evidence: "关键帧\n真实转写" }]);
  assert.deepEqual(result.transcript, info.transcript);
  assert.deepEqual(compileAnalysisResult({ candidates: [{ ...candidate, evidence: "单条证据" }] }, info).candidates[0].evidence, "单条证据");
});

test("Analysis does not repair invalid values or silently drop extra fields", () => {
  const { asset, analyses } = fixture(), info = analyses[asset.id];
  const candidate = { start: 500, end: 2500, summary: "原文", evidence: "证据", confidence: 0.95 };
  for (const patch of [{ evidence: {} }, { evidence: ["证据", 123] }, { start: "500" }, { confidence: 2 }, { command: "shell" }])
    assert.throws(() => compileAnalysisResult({ candidates: [{ ...candidate, ...patch }] }, info), (e: any) => e.code === "AUTOCUT_ANALYSIS_SCHEMA_INVALID");
  assert.throws(() => compileAnalysisResult({ candidates: [candidate], clips: [] }, info));
});

test("Structured sentence evidence preserves source citations and rejects out-of-range values", () => {
  const { asset, analyses } = fixture(), info = analyses[asset.id];
  const c = { start: 500, end: 2500, summary: "原句", evidence: [{ text: "真实句子", segment_start: 500, segment_end: 2500 }], confidence: 0.95 };
  assert.equal(compileAnalysisResult({ candidates: [c] }, info).candidates[0].evidence, "真实句子（源素材 500–2500 ms）");
  for (const segment_end of [4001, 500])
    assert.throws(() => compileAnalysisResult({ candidates: [{ ...c, evidence: [{ ...c.evidence[0], segment_end }] }] }, info), (e: any) => e.code === "AUTOCUT_ANALYSIS_INVALID");
});
