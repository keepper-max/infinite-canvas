import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../src/db/client.js";
import { KnowledgeService } from "../src/knowledge-service.js";
import { PostgresPlatformRepository } from "../src/repository.js";
import { VibeCanvasService } from "../src/vibe-canvas-service.js";
import { KnowledgeImportService } from "../src/knowledge-import-service.js";
import { S3ObjectStorage } from "../src/object-storage.js";
const url = process.env.R12_TEST_DATABASE_URL;
test(
  "real database import revocation, rollback, quota and existing MCP CAS chain",
  { skip: !url },
  async (t) => {
    assert.equal(url, "postgres://r12@127.0.0.1:55482/r12_isolated");
    const { db, pool } = createDatabase(url!),
      knowledge = new KnowledgeService(db),
      repo = new PostgresPlatformRepository(db),
      o = await repo.createUserWithWorkspace(
        "r12-reg-" + randomUUID() + "@example.test",
        "synthetic",
      ),
      user = o.user.id,
      s = (await knowledge.createSpace(user, "personal", null, randomUUID()))
        .id;
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
        knowledge,
        storage,
        async () => {},
        1024 ** 3,
      );
    try {
      await t.test(
        "existing MCP createStoryboard uses same CAS receipt and concurrent failure",
        async () => {
          const service = new VibeCanvasService(pool),
            project = (
              await repo.createProjectForUser(user, {
                name: "R12 MCP regression",
              })
            ).projectId,
            input = {
              operationId: randomUUID(),
              expectedCanvasRevision: 0,
              title: "隔离分镜",
              summary: "原业务",
              aspectRatio: "9:16",
              scenes: [
                {
                  title: "测试",
                  narration: "中文旁白",
                  visual: "场景",
                  durationSeconds: 5,
                },
              ],
            };
          const [a, b] = await Promise.all([
            service.createStoryboard(project, user, input),
            service.createStoryboard(project, user, input),
          ]);
          assert.equal(a.revision, 1);
          assert.equal(a.operationId, b.operationId);
          assert.equal(
            (await repo.getCanvasForUser(project, user))!.nodes.length,
            3,
          );
          await assert.rejects(
            service.createStoryboard(project, user, {
              ...input,
              operationId: randomUUID(),
            }),
            { code: "CANVAS_REVISION_CONFLICT" },
          );
        },
      );
      await t.test(
        "revoked actor fails task before reading or parsing original",
        async () => {
          const task = await imports.upload(
            user,
            s,
            randomUUID(),
            "revoked.txt",
            Buffer.from("中文权限正文"),
            null,
          );
          await pool.query(
            "update users set account_status='disabled' where id=$1",
            [user],
          );
          let parsed = false;
          await imports.process(task.id, async () => {
            parsed = true;
            throw Error("must not parse");
          });
          assert.equal(parsed, false);
          const state = await pool.query(
            "select state,error from knowledge_imports where id=$1",
            [task.id],
          );
          assert.equal(state.rows[0].state, "failed");
          await pool.query(
            "update users set account_status='active' where id=$1",
            [user],
          );
        },
      );
      await t.test(
        "unfinished quota and retry cannot exceed three; cancelled originals retained",
        async () => {
          const tasks = [];
          for (let i = 0; i < 3; i++)
            tasks.push(
              await imports.upload(
                user,
                s,
                randomUUID(),
                "queued-" + i + ".txt",
                Buffer.from("待处理" + i),
                null,
              ),
            );
          await assert.rejects(
            imports.upload(
              user,
              s,
              randomUUID(),
              "fourth.txt",
              Buffer.from("第四"),
              null,
            ),
            { code: "KNOWLEDGE_IMPORT_QUOTA" },
          );
          const failed = (
            await pool.query(
              "select id from knowledge_imports where actor_id=$1 and state='failed'",
              [user],
            )
          ).rows[0];
          const previousWrites = process.env.KNOWLEDGE_IMPORT_WRITES_ENABLED;
          process.env.KNOWLEDGE_IMPORT_WRITES_ENABLED = "false";
          try {
            await assert.rejects(imports.change(user, s, failed.id, "retry"), {
              code: "KNOWLEDGE_IMPORT_READ_ONLY",
            });
            assert.equal(
              (await imports.get(user, s, failed.id)).state,
              "failed",
            );
          } finally {
            if (previousWrites === undefined)
              delete process.env.KNOWLEDGE_IMPORT_WRITES_ENABLED;
            else process.env.KNOWLEDGE_IMPORT_WRITES_ENABLED = previousWrites;
          }
          await assert.rejects(imports.change(user, s, failed.id, "retry"), {
            code: "KNOWLEDGE_IMPORT_QUOTA",
          });
          for (const task of tasks) {
            await imports.change(user, s, task.id, "cancel");
            assert.ok(
              await storage.stat("knowledge-imports/" + task.id + "/original"),
            );
          }
        },
      );
      await t.test(
        "document confirmation failure rolls back document version/index/task/receipt",
        async () => {
          const task = await imports.upload(
            user,
            s,
            randomUUID(),
            "rollback.txt",
            Buffer.from("原文 [[目标]]"),
            null,
          );
          await imports.process(task.id, async () => ({
            markdown: "原文 [[目标]]",
            converter: "fixture",
            warnings: [],
            pages: [],
            assets: [],
            metrics: {},
          }));
          const op = {
            operationId: randomUUID(),
            action: "document.importConfirm",
            payload: {
              taskId: task.id,
              title: "回滚目标",
              markdown: "原文 [[目标]]",
              folderId: randomUUID(),
              allowDuplicate: false,
            },
          };
          await assert.rejects(knowledge.write(user, s, op), {
            code: "KNOWLEDGE_FOLDER_INVALID",
          });
          assert.equal(
            (await knowledge.list(user, s, { page: 1, pageSize: 20 })).total,
            0,
          );
          assert.equal(
            (await imports.get(user, s, task.id)).state,
            "awaiting_confirmation",
          );
          await assert.rejects(knowledge.receipt(user, s, op.operationId), {
            code: "KNOWLEDGE_OPERATION_NOT_FOUND",
          });
        },
      );
      for (const configuredAdmin of [false, true])
        await t.test(
          configuredAdmin
            ? "configured admin preserves existing unlimited storage policy"
            : "database admin preserves unlimited policy for originals and assets",
          async () => {
            const account = await repo.createUserWithWorkspace(
              "r12-quota-" + randomUUID() + "@example.test",
              "synthetic",
            );
            const actor = account.user.id;
            const space = (
              await knowledge.createSpace(actor, "personal", null, randomUUID())
            ).id;
            const limited = new KnowledgeImportService(
              knowledge,
              storage,
              async () => {},
              1,
            );
            await assert.rejects(
              limited.upload(
                actor,
                space,
                randomUUID(),
                "limited.txt",
                Buffer.from("中文"),
                null,
              ),
              { code: "KNOWLEDGE_IMPORT_QUOTA" },
            );
            if (!configuredAdmin)
              await pool.query("update users set is_admin=true where id=$1", [
                actor,
              ]);
            const privileged = new KnowledgeImportService(
              knowledge,
              storage,
              async () => {},
              1,
              undefined,
              configuredAdmin ? [account.user.email] : [],
            );
            const task = await privileged.upload(
              actor,
              space,
              randomUUID(),
              "admin.txt",
              Buffer.from("中文原件"),
              null,
            );
            await privileged.process(task.id, async () => ({
              markdown: "正文",
              converter: "fixture",
              warnings: [],
              pages: [],
              assets: [
                {
                  id: "0",
                  mimeType: "image/png",
                  body: Buffer.alloc(32).toString("base64"),
                },
              ],
              metrics: {},
            }));
            assert.equal(
              (await privileged.get(actor, space, task.id)).state,
              "awaiting_confirmation",
            );
            await privileged.change(actor, space, task.id, "cancel");
          },
        );
    } finally {
      await pool.end();
    }
  },
);
