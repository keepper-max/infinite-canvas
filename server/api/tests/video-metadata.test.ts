import assert from "node:assert/strict";
import test from "node:test";
import { parseVideoMetadata } from "../src/video-thumbnail.js";

test("video metadata uses actual file duration and dimensions", () => {
  assert.deepEqual(parseVideoMetadata({
    streams: [{ codec_type: "audio" }, { codec_type: "video", width: 640, height: 360, duration: "1" }],
    format: { duration: "1.042000" },
  }), { width: 640, height: 360, durationMs: 1042 });
});

test("video metadata falls back to video stream duration", () => {
  assert.deepEqual(parseVideoMetadata({ streams: [{ codec_type: "video", width: 1920, height: 1080, duration: "15.04" }], format: { duration: "N/A" } }),
    { width: 1920, height: 1080, durationMs: 15040 });
});

test("invalid or absent metadata stays null instead of fabricated duration", () => {
  for (const value of [null, undefined, {}, { streams: [null], format: null }, { streams: [{ codec_type: "video", width: -1, height: Infinity, duration: true }], format: { duration: "9999999999999" } }]) {
    assert.deepEqual(parseVideoMetadata(value), { width: null, height: null, durationMs: null });
  }
});
