import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { S3ObjectStorage } from "../src/object-storage.js";

test("Project ZIP upload stays in bounded parts, aborts failed multipart and recovers lost completion acknowledgement", async () => {
  const root = resolve(
    process.env.AUTOCUT_TEST_TEMP_ROOT || "H:/CodexStorage/autocut/p1/tests",
  );
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, "multipart-")),
    path = join(dir, "export.zip"),
    bytes = 17 * 1024 ** 2,
    sha = "a".repeat(64);
  await writeFile(path, Buffer.alloc(bytes));
  try {
    for (const mode of ["ok", "part-failure", "lost-completion"]) {
      const parts: number[] = [],
        commands: string[] = [],
        storage = new S3ObjectStorage({
          endpoint: "http://127.0.0.1:1",
          publicEndpoint: "http://127.0.0.1:1",
          bucket: "test",
          region: "test",
          accessKeyId: "test",
          secretAccessKey: "test",
          forcePathStyle: true,
          autoCreateBucket: false,
          downloadTtlSeconds: 900,
        } as any);
      (storage as any).internalClient = {
        send: async (c: any) => {
          const name = c.constructor.name;
          commands.push(name);
          if (name === "CreateMultipartUploadCommand")
            return { UploadId: "bounded-test" };
          if (name === "UploadPartCommand") {
            parts.push(c.input.Body.length);
            if (mode === "part-failure") throw Error("part failed");
            return { ETag: "part-" + parts.length };
          }
          if (name === "CompleteMultipartUploadCommand") {
            assert.equal(c.input.MultipartUpload.Parts.length, 3);
            if (mode === "lost-completion") throw Error("ack lost");
            return {};
          }
          if (name === "HeadObjectCommand")
            return {
              ContentLength: bytes,
              ContentType: "application/zip",
              Metadata: { sha256: sha },
            };
          return {};
        },
      };
      if (mode === "part-failure") {
        await assert.rejects(
          storage.putFile("test", path, "application/zip", sha),
          /part failed/,
        );
        assert.ok(commands.includes("AbortMultipartUploadCommand"));
      } else {
        const out = await storage.putFile("test", path, "application/zip", sha);
        assert.equal(out.bytes, bytes);
        assert.deepEqual(parts, [8 * 1024 ** 2, 8 * 1024 ** 2, 1024 ** 2]);
        assert.ok(!commands.includes("AbortMultipartUploadCommand"));
      }
    }
  } finally {
    if (resolve(dir).startsWith(root + sep))
      await rm(dir, { recursive: true, force: true });
  }
});
