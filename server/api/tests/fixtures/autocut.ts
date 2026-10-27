import { randomUUID } from "node:crypto";
import type {
  Analysis,
  MediaAsset,
  Timeline,
} from "../../src/autocut/contract.js";
export function fixture() {
  const p = randomUUID(),
    a = randomUUID(),
    v = randomUUID();
  const asset: MediaAsset = {
    id: v,
    assetId: a,
    mimeType: "video/mp4",
    storageKey: "private",
    bytes: 1,
    sha256: "0".repeat(64),
    name: "测试",
  };
  const info: Analysis = {
    version: 1,
    kind: "video",
    durationMs: 4000,
    width: 640,
    height: 360,
    fps: 25,
    hasAudio: true,
    scenes: [{ start: 0, end: 4000 }],
    silences: [],
    transcript: {
      segments: [{ start: 500, end: 2500, text: "完整语句", confidence: null }],
    },
    candidates: [],
  };
  const t: Timeline = {
    schema_version: 1,
    project_id: p,
    revision_id: randomUUID(),
    target_duration: 2000,
    aspect_ratio: "16:9",
    fps: 25,
    tracks: [
      {
        id: randomUUID(),
        kind: "video",
        clips: [
          {
            id: randomUUID(),
            asset_id: a,
            asset_version_id: v,
            source_in: 1000,
            source_out: 3000,
            timeline_start: 0,
            effects: { volume: 1, muted: false },
            transitions: { type: "cut", duration: 0 },
          },
        ],
      },
    ],
    subtitles: [],
    audio_settings: { master_volume: 1 },
    export_settings: { codec: "h264", format: "mp4", resolution: 720 },
    warnings: [],
  };
  return { p, asset, info, t, analyses: { [v]: info } };
}
