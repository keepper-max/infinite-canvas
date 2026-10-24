import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createDatabase } from "../src/db/client.js";
import { KnowledgeService } from "../src/knowledge-service.js";
import { PostgresPlatformRepository } from "../src/repository.js";
import { hashSessionToken } from "../src/auth.js";
import { KnowledgeImportService } from "../src/knowledge-import-service.js";
import { S3ObjectStorage } from "../src/object-storage.js";
import { request as httpRequest } from "node:http";
const url = process.env.R12_TEST_DATABASE_URL,
  base = process.env.R12_TEST_API;
test(
  "R1.2 real PostgreSQL + S3 + Redis worker + HTTP",
  { skip: !url || !base },
  async (t) => {
    assert.equal(url, "postgres://r12@127.0.0.1:55482/r12_isolated");
    assert.equal(base, "http://127.0.0.1:3192");
    const { db, pool } = createDatabase(url!),
      service = new KnowledgeService(db),
      repo = new PostgresPlatformRepository(db),
      token = randomUUID(),
      otherToken = randomUUID();
    const owner = await repo.createUserWithWorkspace(
        "r12-test-" + randomUUID() + "@example.test",
        "synthetic",
      ),
      other = await repo.createUserWithWorkspace(
        "r12-other-" + randomUUID() + "@example.test",
        "synthetic",
      );
    const space = (
      await service.createSpace(owner.user.id, "personal", null, randomUUID())
    ).id;
    await repo.createSession(
      owner.user.id,
      hashSessionToken(token),
      new Date(Date.now() + 3600000),
    );
    await repo.createSession(
      other.user.id,
      hashSessionToken(otherToken),
      new Date(Date.now() + 3600000),
    );
    const request = async (
      path: string,
      body?: unknown,
      auth = token,
      headers: Record<string, string> = {},
    ) => {
      const r = await fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        body:
          body instanceof Uint8Array
            ? (body as any)
            : body === undefined
              ? undefined
              : JSON.stringify(body),
        headers: {
          connection: "close",
          cookie: "r12_session=" + auth,
          origin: base!,
          ...(body instanceof Uint8Array
            ? { "content-type": "application/octet-stream" }
            : { "content-type": "application/json" }),
          ...headers,
        },
      });
      const data = await r.json();
      return { status: r.status, ...data };
    };
    const path = `/api/knowledge/${space}`,
      dir = process.env.R12_FIXTURES!;
    const upload = (name: string, body: Uint8Array, op = randomUUID()) =>
      request(path + "/imports", body, token, {
        "x-operation-id": op,
        "x-file-name": encodeURIComponent(name),
      });
    const ready = async (id: string) => {
      const start = Date.now();
      while (Date.now() - start < 120000) {
        const r = await request(path + "/imports/" + id);
        assert.equal(r.status, 200, JSON.stringify(r));
        if (
          [
            "awaiting_confirmation",
            "failed",
            "completed",
            "cancelled",
          ].includes(r.data.state)
        )
          return r.data;
        await new Promise((r) => setTimeout(r, 400));
      }
      throw Error("Conversion timed out");
    };
    const confirm = (
      id: string,
      markdown: string,
      op = randomUUID(),
      extra = {},
    ) =>
      request(path + "/actions", {
        operationId: op,
        action: "document.importConfirm",
        payload: {
          taskId: id,
          title: "中文资料" + id.slice(0, 5),
          markdown,
          folderId: null,
          allowDuplicate: false,
          ...extra,
        },
      });
    try {
      let imported: any, task: any;
      await t.test(
        "upload receipt concurrent retries, payload mismatch, no premature document",
        async () => {
          const body = await readFile(dir + "/protected.md"),
            op = randomUUID(),
            [a, b] = await Promise.all([
              upload("protected.md", body, op),
              upload("protected.md", body, op),
            ]);
          assert.equal(a.status, 200, JSON.stringify(a));
          assert.equal(b.status, 200);
          assert.equal(a.data.id, b.data.id);
          assert.equal(
            (await upload("protected.md", Buffer.from("different"), op)).status,
            409,
          );
          assert.equal(
            (
              await service.list(owner.user.id, space, {
                page: 1,
                pageSize: 20,
              })
            ).total,
            0,
          );
          task = await ready(a.data.id);
          assert.equal(task.state, "awaiting_confirmation", task.error);
          assert.equal(task.markdown, body.toString());
        },
      );
      await t.test(
        "edited preview confirmation atomically persists document/index/source/version/receipt once",
        async () => {
          const op = randomUUID(),
            text = task.markdown + "\n中文搜索量子力学 #知识\n[[关联目标]]",
            a = await confirm(task.id, text, op),
            b = await confirm(task.id, text, op);
          assert.equal(a.status, 200, JSON.stringify(a));
          assert.equal(b.status, 200);
          assert.equal(a.data.id, b.data.id);
          assert.equal(b.data.replayed, true);
          imported = a.data;
          assert.equal(
            (await confirm(task.id, text + "different", op)).status,
            409,
          );
          assert.equal(
            (
              await service.list(owner.user.id, space, {
                q: "量子力学",
                page: 1,
                pageSize: 20,
              })
            ).total,
            1,
          );
          assert.equal(
            (await service.history(owner.user.id, space, imported.id)).length,
            1,
          );
          assert.equal(
            (await service.relations(owner.user.id, space, imported.id))
              .outgoing.length,
            2,
          );
          const r = await fetch(
              base + path + "/imports/" + task.id + "/original",
              { headers: { cookie: "r12_session=" + token } },
            ),
            body = Buffer.from(await r.arrayBuffer());
          assert.equal(
            createHash("sha256").update(body).digest("hex"),
            task.sha256,
          );
          assert.equal(
            (await request(path + "/documents/" + imported.id + "/sources"))
              .data.length,
            1,
          );
        },
      );
      await t.test(
        "space-scoped SHA duplicate requires explicit second copy",
        async () => {
          const r = await upload(
              "renamed.md",
              await readFile(dir + "/protected.md"),
            ),
            next = await ready(r.data.id);
          assert.equal(next.duplicateDocumentId, imported.id);
          assert.equal((await confirm(next.id, next.markdown)).status, 409);
          const ok = await confirm(next.id, next.markdown, randomUUID(), {
            allowDuplicate: true,
          });
          assert.equal(ok.status, 200);
          assert.notEqual(ok.data.id, imported.id);
        },
      );
      await t.test(
        "DOCX headings/lists/table/image and text PDF Chinese/multipage through worker",
        async () => {
          for (const name of [
            "basic.docx",
            "headings.docx",
            "table.docx",
            "image.docx",
            "chinese.pdf",
            "mixed.pdf",
            "multipage.pdf",
            "tagged-table.pdf",
            "notes.txt",
          ]) {
            const r = await upload(name, await readFile(dir + "/" + name));
            assert.equal(r.status, 200, JSON.stringify(r));
            const next = await ready(r.data.id);
            assert.equal(
              next.state,
              "awaiting_confirmation",
              name + ":" + next.error,
            );
            assert.match(next.markdown, /李白/);
            if (name === "table.docx") assert.match(next.markdown, /\|/);
            if (name === "multipage.pdf") assert.equal(next.pages.length, 5);
            if (name === "tagged-table.pdf") {
              assert.match(next.markdown, /# 中文结构表格/);
              assert.match(next.markdown, /\| 姓名 \| 领域 \|/);
            }
            if (name === "image.docx") {
              const match = /\/api\/knowledge\/[^)]+\/assets\/\d+/.exec(
                next.markdown,
              );
              assert.ok(match);
              const image = await fetch(base + match[0], {
                headers: { cookie: "r12_session=" + token },
              });
              assert.equal(image.status, 200);
              assert.equal(image.headers.get("content-type"), "image/png");
            }
            const saved = await confirm(next.id, next.markdown);
            assert.equal(saved.status, 200, JSON.stringify(saved));
          }
        },
      );
      await t.test(
        "scan/blank/corrupt/spoof/invalid UTF8 fail, cancellation and retry recover",
        async () => {
          for (const name of [
            "scan.pdf",
            "blank.pdf",
            "broken.docx",
            "spoof.pdf",
            "encoding.txt",
          ]) {
            const r = await upload(name, await readFile(dir + "/" + name));
            assert.equal(r.status, 200);
            const next = await ready(r.data.id);
            assert.equal(next.state, "failed", name);
            if (name === "scan.pdf" || name === "blank.pdf")
              assert.match(next.error, /OCR/);
            assert.equal((await confirm(next.id, "must not save")).status, 409);
            assert.equal(
              (await request(path + "/imports/" + next.id + "/cancel", {}))
                .status,
              200,
            );
          }
          const a = await upload("cancel.txt", Buffer.from("取消任务"));
          await request(path + "/imports/" + a.data.id + "/cancel", {});
          assert.equal((await ready(a.data.id)).state, "cancelled");
          assert.equal(
            (await upload("not.xlsx", Buffer.from("bad"))).status,
            422,
          );
          const tooLarge = await new Promise<number>((resolve, reject) => {
            const req = httpRequest(
              base + path + "/imports",
              {
                method: "POST",
                headers: {
                  cookie: "r12_session=" + token,
                  origin: base!,
                  "content-length": String(10 * 1024 * 1024 + 1),
                  "x-file-name": "large.txt",
                  "x-operation-id": randomUUID(),
                },
              },
              (res) => {
                res.resume();
                resolve(res.statusCode!);
              },
            );
            req.on("error", reject);
            req.end();
          });
          assert.equal(tooLarge, 413);
        },
      );
      await t.test(
        "unauthorized originals/tasks, revoked feature, project permissions",
        async () => {
          assert.equal(
            (await request(path + "/imports/" + task.id, undefined, otherToken))
              .status,
            404,
          );
          assert.equal(
            (await fetch(base + path + "/imports/" + task.id + "/original"))
              .status,
            401,
          );
          await pool.query(
            "insert into user_feature_grants(user_id,feature,enabled,updated_by,reason) values($1,'knowledge',false,$1,'isolated test')",
            [owner.user.id],
          );
          assert.equal(
            (await request(path + "/imports/" + task.id)).status,
            403,
          );
          await pool.query(
            "update user_feature_grants set enabled=true where user_id=$1",
            [owner.user.id],
          );
          const p = (
            await service.createSpace(
              owner.user.id,
              "project",
              owner.workspace.projectId,
              randomUUID(),
            )
          ).id;
          const r = await request(
            `/api/knowledge/${p}/imports`,
            Buffer.from("project"),
            otherToken,
            { "x-operation-id": randomUUID(), "x-file-name": "project.txt" },
          );
          assert.equal(r.status, 404);
        },
      );
      await t.test(
        "reparse preview never overwrites edits; stale confirmation CAS conflict",
        async () => {
          const r = await request(path + "/imports/" + task.id + "/reparse", {
            operationId: randomUUID(),
          });
          assert.equal(r.status, 200, JSON.stringify(r));
          const next = await ready(r.data.id);
          assert.equal(next.state, "awaiting_confirmation");
          const before = await service.read(owner.user.id, space, imported.id);
          assert.equal(before.markdown, imported.markdown);
          await service.write(owner.user.id, space, {
            operationId: randomUUID(),
            action: "document.save",
            payload: {
              id: before.id,
              expectedRevision: before.revision,
              title: before.title,
              markdown: before.markdown + "\n人工修改",
              folderId: null,
            },
          });
          assert.equal((await confirm(next.id, next.markdown)).status, 409);
          assert.match(
            (await service.read(owner.user.id, space, imported.id)).markdown,
            /人工修改/,
          );
          await request(path + "/imports/" + next.id + "/cancel", {});
        },
      );
      await t.test(
        "bounded cleanup preserves completed original and historical versions",
        async () => {
          const storage = new S3ObjectStorage({
              endpoint: "http://127.0.0.1:59082",
              publicEndpoint: "http://127.0.0.1:59082",
              region: "us-east-1",
              bucket: "r12-isolated",
              accessKeyId: process.env.R12_TEST_S3_ACCESS_KEY!,
              secretAccessKey: process.env.R12_TEST_S3_SECRET_KEY!,
              forcePathStyle: true,
              autoCreateBucket: false,
            }),
            imports = new KnowledgeImportService(
              service,
              storage,
              async () => {},
              1024 ** 3,
            );
          await pool.query(
            "update knowledge_imports set updated_at=now()-interval '8 days' where actor_id=$1 and state in ('cancelled','completed')",
            [owner.user.id],
          );
          assert.ok((await imports.cleanup()) > 0);
          assert.ok(
            await storage.stat("knowledge-imports/" + task.id + "/original"),
          );
          assert.ok(
            (await service.history(owner.user.id, space, imported.id)).length >=
              2,
          );
        },
      );
      await t.test(
        "imported Wiki Links resolve in graph; manual links, Knowledge Node and canvas CAS",
        async () => {
          const target = await service.write(owner.user.id, space, {
            operationId: randomUUID(),
            action: "document.create",
            payload: {
              title: "关联目标",
              markdown: "关系目标正文",
              folderId: null,
            },
          });
          assert.ok(
            (
              await service.relations(owner.user.id, space, target.id)
            ).backlinks.some((b: any) => b.id === imported.id),
          );
          const graph = await request(path + "/graph?pageSize=50");
          assert.equal(graph.status, 200);
          assert.ok(
            graph.data.edges.some(
              (e: any) => e.source === imported.id && e.target === target.id,
            ),
          );
          const p = await request(
            path +
              "/documents/" +
              target.id +
              "/link-preview?targetId=" +
              imported.id +
              "&action=add",
          );
          assert.equal(p.status, 200);
          assert.equal(
            (
              await request(path + "/actions", {
                operationId: randomUUID(),
                action: "document.linkAdd",
                payload: {
                  id: target.id,
                  targetId: imported.id,
                  expectedRevision: target.revision,
                },
              })
            ).status,
            200,
          );
          const ps = (
            await service.createSpace(
              owner.user.id,
              "project",
              owner.workspace.projectId,
              randomUUID(),
            )
          ).id;
          const source = await service.read(owner.user.id, space, imported.id),
            copy = await service.write(owner.user.id, ps, {
              operationId: randomUUID(),
              action: "document.copyFrom",
              payload: {
                sourceSpaceId: space,
                sourceDocumentId: source.id,
                sourceRevision: source.revision,
              },
            });
          const canvas = await repo.getCanvasForUser(
            owner.workspace.projectId,
            owner.user.id,
          );
          assert.ok(canvas);
          const op = randomUUID(),
            input = {
              operationId: op,
              expectedCanvasRevision: canvas.revision,
              reference: { mode: "latest", spaceId: ps, documentId: copy.id },
              position: { x: 10, y: 20 },
            },
            endpoint = `/api/knowledge/canvas/${owner.workspace.projectId}/nodes`;
          const saved = await request(endpoint, input);
          assert.equal(saved.status, 200, JSON.stringify(saved));
          const replay = await request(endpoint, input);
          assert.equal(replay.status, 200);
          assert.equal(
            (await request(endpoint, { ...input, operationId: randomUUID() }))
              .status,
            409,
          );
          const after = await repo.getCanvasForUser(
            owner.workspace.projectId,
            owner.user.id,
          );
          assert.equal(
            after!.nodes.filter((n) => n.type === "knowledge:document").length,
            1,
          );
          assert.equal(after!.edges.length, 0);
        },
      );
    } finally {
      await pool.end();
    }
  },
);
