import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import { constrainReferenceImage } from "../src/reference-image.js";

test("oversized reference images are resized without changing aspect ratio", async () => {
  const input = new Uint8Array(
    await sharp({
      create: {
        width: 120,
        height: 100,
        channels: 3,
        background: { r: 220, g: 180, b: 120 },
      },
    })
      .png()
      .toBuffer(),
  );
  const result = await constrainReferenceImage(input, "image/png", 10_000);
  const metadata = await sharp(result.bytes).metadata();

  assert.equal(result.resized, true);
  assert.equal(result.mimeType, "image/png");
  assert.ok((metadata.width || 0) * (metadata.height || 0) <= 10_000);
  assert.ok(Math.abs((metadata.width || 1) / (metadata.height || 1) - 1.2) < 0.02);
});

test("reference images within the limit remain byte-identical", async () => {
  const input = new Uint8Array(
    await sharp({
      create: {
        width: 80,
        height: 60,
        channels: 3,
        background: { r: 20, g: 40, b: 60 },
      },
    })
      .jpeg()
      .toBuffer(),
  );
  const result = await constrainReferenceImage(input, "image/jpeg", 10_000);

  assert.equal(result.resized, false);
  assert.deepEqual(result.bytes, input);
});

test("non-image references are not decoded or changed", async () => {
  const input = new Uint8Array([1, 2, 3]);
  const result = await constrainReferenceImage(input, "video/mp4");

  assert.equal(result.resized, false);
  assert.deepEqual(result.bytes, input);
});
