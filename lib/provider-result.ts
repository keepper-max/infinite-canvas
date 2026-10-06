import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";

import { putAssetFile } from "@/lib/storage";

type ProviderResultInput = {
  url: string;
  projectId: string;
  assetId: string;
  mimeType: string;
  name?: string;
};

export type StoredProviderResult = {
  assetId: string;
  objectKey: string;
  size: number;
  sha256: string;
  mimeType: string;
};

/** 将供应商临时结果流式落盘、写入对象存储，并保证临时文件始终清理。 */
export async function storeProviderResult(input: ProviderResultInput): Promise<StoredProviderResult> {
  const tempDir = await mkdtemp(join(tmpdir(), "jingjie-provider-"));
  const tempPath = join(tempDir, "result");
  try {
    const response = await fetch(input.url, { redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`供应商结果下载失败（${response.status}）`);
    await pipeline(Readable.fromWeb(response.body as unknown as NodeReadableStream), createWriteStream(tempPath));
    const file = await stat(tempPath);
    if (!file.size) throw new Error("供应商返回了空结果");
    const hash = createHash("sha256");
    await pipeline(createReadStream(tempPath), hash);
    const sha256 = hash.digest("hex");
    const extension = extensionFor(input.mimeType, input.name);
    const objectKey = `${input.projectId}/${input.assetId}-provider-result${extension}`;
    await putAssetFile(objectKey, tempPath, input.mimeType || "application/octet-stream");
    return { assetId: input.assetId, objectKey, size: file.size, sha256, mimeType: input.mimeType || "application/octet-stream" };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function extensionFor(mimeType: string, name?: string) {
  const original = name ? basename(name).match(/\.[a-z0-9]+$/i)?.[0].toLowerCase() : undefined;
  if (original) return original;
  const known: Record<string, string> = { "video/mp4": ".mp4", "video/webm": ".webm", "image/png": ".png", "image/jpeg": ".jpg", "audio/mpeg": ".mp3" };
  return known[mimeType] ?? "";
}
