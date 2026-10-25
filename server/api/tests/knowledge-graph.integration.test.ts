import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabase } from "../src/db/client.js";
import { applyMigrations } from "../src/db/migrate.js";
import { KnowledgeService } from "../src/knowledge-service.js";
import { PostgresPlatformRepository } from "./knowledge-fixture.js";
import { hashSessionToken } from "../src/auth.js";
import { createApp } from "../src/app.js";
import type { ApiConfig } from "../src/config.js";
const connection = process.env.P1_TEST_DATABASE_URL;
test(
  "P1.5 read-only graph against real isolated PostgreSQL",
  { skip: !connection },
  async (t) => {
    const url = new URL(connection!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55451");
    assert.ok(["/p1_isolated", "/p2_isolated", "/r2_business"].includes(url.pathname));
    const { db, pool } = createDatabase(connection!),
      service = new KnowledgeService(db),
      repo = new PostgresPlatformRepository(db),
      artifact = process.env.P15_ARTIFACT_DIR!,
      privateDir = process.env.P15_PRIVATE_DIR!;
    const fixtures: any = {};
    const timings: any[] = [];
    const create = async (
      actor: string,
      space: string,
      title: string,
      markdown: string,
      folderId: string | null = null,
    ) =>
      service.write(actor, space, {
        action: "document.create",
        operationId: randomUUID(),
        payload: { title, markdown, folderId },
      });
    async function actor(name: string) {
      const user = await repo.createUserWithWorkspace(
        `graph-${name}-${randomUUID()}@example.test`,
        "synthetic-test-password",
      );
      const token = randomUUID();
      await repo.createSession(
        user.user.id,
        hashSessionToken(token),
        new Date(Date.now() + 86400000),
      );
      await writeFile(
        resolve(privateDir, `${name}-state.json`),
        JSON.stringify({
          cookies: [
            {
              name: "p1_knowledge_session",
              value: token,
              domain: "127.0.0.1",
              path: "/",
              expires: Math.floor(Date.now() / 1000) + 86400,
              httpOnly: true,
              secure: false,
              sameSite: "Lax",
            },
          ],
          origins: [],
        }),
      );
      return {
        userId: user.user.id,
        token,
        projectId: user.workspace.projectId,
      };
    }
    const stamp = async (spaceId: string) =>
      createHash("sha256")
        .update(
          JSON.stringify(
            (
              await pool.query(
                "select id,revision,content_hash,markdown from knowledge_documents where space_id=$1 order by id", [spaceId],
              )
            ).rows,
          ),
        )
        .digest("hex");
    try {
      await applyMigrations(pool);
      const small = await actor("small"),
        medium = await actor("medium"),
        large = await actor("large"),
        outsider = await actor("outsider");
      const smallSpace = (
        await service.createSpace(small.userId, "personal", null, randomUUID())
      ).id;
      const a = await create(
          small.userId,
          smallSpace,
          "林岚",
          "[[雾港]] [[未完成]]",
        ),
        b = await create(small.userId, smallSpace, "雾港", "[[林岚]]"),
        c = await create(
          small.userId,
          smallSpace,
          "航海日志",
          "[[林岚|档案员]]",
        ),
        isolated = await create(
          small.userId,
          smallSpace,
          "独立灵感",
          "未连接的原文",
        );
      fixtures.small = {
        actor: small.userId,
        space: smallSpace,
        center: a.id,
        isolated: isolated.id,
        documents: 4,
      };
      await t.test(
        "four documents include isolated nodes, real directed edges and local one-hop only",
        async () => {
          const before = await stamp(smallSpace);
          const page = await service.graph(small.userId, smallSpace, {
            pageSize: 100,
          });
          assert.equal(page.nodes.length, 4);
          assert.equal(page.edges.length, 3);
          assert.equal(page.nodes.find((n) => n.id === isolated.id)!.degree, 0);
          assert.equal(
            page.nodes.find((n) => n.id === a.id)!.unresolvedCount,
            1,
          );
          const local = await service.graph(small.userId, smallSpace, {
            centerId: a.id,
            pageSize: 100,
          });
          assert.deepEqual(
            new Set(local.nodes.map((n) => n.id)),
            new Set([a.id, b.id, c.id]),
          );
          assert.equal(await stamp(smallSpace), before);
        },
      );
      const mediumSpace = (
          await service.createSpace(
            medium.userId,
            "project",
            medium.projectId,
            randomUUID(),
          )
        ).id,
        mediumDocs: any[] = [];
      const folder = await service.folderWrite(medium.userId, mediumSpace, {
        action: "folder.create",
        operationId: randomUUID(),
        payload: { name: "角色群像", parentId: null },
      });
      for (let i = 0; i < 40; i++) {
        const group = Math.floor(i / 10),
          name = `知识${String(i).padStart(2, "0")}`,
          next = `知识${String(group * 10 + ((i + 1) % 10)).padStart(2, "0")}`;
        mediumDocs.push(
          await create(
            medium.userId,
            mediumSpace,
            name,
            `# 关系网络\n\n[[${next}]] ${i % 10 === 0 ? "[[知识00]] [[知识10]] [[知识20]] [[知识30]]" : ""}\n\n#${group < 2 ? "人物" : "世界观"}`,
            i < 20 ? folder.id : null,
          ),
        );
      }
      fixtures.medium = {
        actor: medium.userId,
        space: mediumSpace,
        projectId: medium.projectId,
        center: mediumDocs[0].id,
        documents: 40,
        folder: folder.id,
      };
      await t.test(
        "real folder/tag filters and keyset pages return no duplicate nodes or invented edges",
        async () => {
          const seen = new Set<string>();
          let cursor: string | undefined;
          do {
            const page = await service.graph(medium.userId, mediumSpace, {
              pageSize: 7,
              cursor,
            });
            page.nodes.forEach((n) => {
              assert.ok(!seen.has(n.id));
              seen.add(n.id);
            });
            cursor = page.nextCursor || undefined;
          } while (cursor);
          assert.equal(seen.size, 40);
          const f = await service.graph(medium.userId, mediumSpace, {
            pageSize: 100,
            folderId: folder.id,
            tag: "人物",
          });
          assert.equal(f.totalNodes, 20);
          assert.ok(
            f.edges.every(
              (e) =>
                f.nodes.some((n) => n.id === e.source) &&
                f.nodes.some((n) => n.id === e.target),
            ),
          );
        },
      );
      const bigSpace = (
          await service.createSpace(
            large.userId,
            "personal",
            null,
            randomUUID(),
          )
        ).id,
        start = performance.now(),
        big: any[] = [];
      for (let i = 0; i < 600; i++)
        big.push(
          await create(
            large.userId,
            bigSpace,
            `文档${String(i).padStart(3, "0")}`,
            `[[文档${String((i + 1) % 600).padStart(3, "0")}]]\n\n中文姓名 林岚 沈知远 AI #研究`,
          ),
        );
      const hub = await create(
        large.userId,
        bigSpace,
        "高连接度入口",
        big.map((d) => `[[${d.title}]]`).join("\n"),
      );
      timings.push({
        kind: "601 real KnowledgeService document writes and indexing",
        elapsedMs: performance.now() - start,
      });
      fixtures.large = {
        actor: large.userId,
        space: bigSpace,
        center: hub.id,
        first: big[0].id,
        documents: 601,
      };
      await t.test(
        "601 documents and hub adjacency page independently, all edges remain recoverable",
        async () => {
          const before = await stamp(bigSpace),
            seen = new Set<string>(),
            edges = new Set<string>();
          let cursor: string | undefined, edgeCursor: string | undefined;
          let nodeDone = false,
            edgeDone = false;
          do {
            const at = performance.now(),
              page = await service.graph(large.userId, bigSpace, {
                pageSize: 100,
                cursor,
                edgeCursor,
              });
            timings.push({
              kind: "global page",
              elapsedMs: performance.now() - at,
              nodes: page.nodes.length,
              edges: page.edges.length,
            });
            page.nodes.forEach((n) => seen.add(n.id));
            page.edges.forEach((e) => edges.add(e.source + ":" + e.target));
            cursor = page.nodes.at(-1)?.id || cursor;
            edgeCursor = page.edges.length
              ? `${page.edges.at(-1)!.source}:${page.edges.at(-1)!.target}`
              : edgeCursor;
            nodeDone = !page.nextCursor;
            edgeDone = !page.nextEdgeCursor;
          } while (!nodeDone || !edgeDone);
          assert.equal(seen.size, 601);
          assert.equal(edges.size, 1200);
          let localCursor: string | undefined;
          const adjacent = new Set<string>();
          do {
            const p = await service.graph(large.userId, bigSpace, {
              centerId: hub.id,
              pageSize: 100,
              cursor: localCursor,
            });
            assert.ok(p.nodes.length <= 101);
            p.nodes.forEach((n) => adjacent.add(n.id));
            localCursor = p.nextCursor || undefined;
          } while (localCursor);
          assert.equal(adjacent.size, 601);
          assert.equal(await stamp(bigSpace), before);
        },
      );
      await t.test(
        "duplicate titles do not invent links; deleted targets disappear without changing source",
        async () => {
          const dup1 = await create(small.userId, smallSpace, "同名", "一"),
            dup2 = await create(small.userId, smallSpace, "同名", "二"),
            ref = await create(
              small.userId,
              smallSpace,
              "重名引用",
              "[[同名]]",
            );
          assert.equal(
            (
              await service.graph(small.userId, smallSpace, { pageSize: 100 })
            ).edges.some((e) => e.source === ref.id),
            false,
          );
          await service.write(small.userId, smallSpace, {
            action: "document.delete",
            operationId: randomUUID(),
            payload: { id: b.id, expectedRevision: 1 },
          });
          const page = await service.graph(small.userId, smallSpace, {
            pageSize: 100,
          });
          assert.ok(
            page.edges.every((e) => e.source !== b.id && e.target !== b.id),
          );
          assert.equal(
            (await service.read(small.userId, smallSpace, a.id)).markdown,
            "[[雾港]] [[未完成]]",
          );
          await service.write(small.userId, smallSpace, {
            action: "document.restore",
            operationId: randomUUID(),
            payload: { id: b.id, expectedRevision: 2, version: 1 },
          });
          fixtures.small.duplicates = [dup1.id, dup2.id];
        },
      );
      await t.test(
        "each graph page rechecks user/project permissions including revocation and soft deletion",
        async () => {
          await assert.rejects(
            service.graph(outsider.userId, smallSpace, { pageSize: 20 }),
            { code: "KNOWLEDGE_NOT_FOUND" },
          );
          await pool.query(
            "insert into project_members(project_id,user_id,role) values($1,$2,$3)",
            [medium.projectId, outsider.userId, "viewer"],
          );
          assert.ok(
            (
              await service.graph(outsider.userId, mediumSpace, {
                pageSize: 20,
              })
            ).nodes.length,
          );
          await pool.query(
            "delete from project_members where project_id=$1 and user_id=$2",
            [medium.projectId, outsider.userId],
          );
          await assert.rejects(
            service.graph(outsider.userId, mediumSpace, { pageSize: 20 }),
            { code: "KNOWLEDGE_NOT_FOUND" },
          );
          await pool.query(
            "update users set account_status='disabled' where id=$1",
            [outsider.userId],
          );
          await assert.rejects(
            service.graph(outsider.userId, mediumSpace, { pageSize: 20 }),
            { code: "UNAUTHENTICATED" },
          );
          await pool.query(
            "update users set account_status='active' where id=$1",
            [outsider.userId],
          );
          const deletedProject = (
              await repo.createProjectForUser(outsider.userId, {
                name: "待删除测试",
              })
            ).projectId,
            ps = (
              await service.createSpace(
                outsider.userId,
                "project",
                deletedProject,
                randomUUID(),
              )
            ).id;
          await repo.deleteProjectForUser(deletedProject, outsider.userId);
          await assert.rejects(
            service.graph(outsider.userId, ps, { pageSize: 20 }),
            { code: "KNOWLEDGE_NOT_FOUND" },
          );
        },
      );
      await t.test(
        "formal authenticated graph HTTP route rejects unauthenticated/invalid cursor/cross-space",
        async () => {
          const app = createApp(
              repo,
              {
                cookieName: "p1_knowledge_session",
                cookieSecure: false,
                trustedOrigins: [],
              } as unknown as ApiConfig,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              service,
            ),
            path = `/api/knowledge/${mediumSpace}/graph`;
          assert.equal((await app.request(path)).status, 401);
          const headers = { cookie: `p1_knowledge_session=${medium.token}` };
          assert.equal((await app.request(path, { headers })).status, 200);
          assert.equal(
            (await app.request(path + "?cursor=invalid", { headers })).status,
            422,
          );
          assert.equal(
            (
              await app.request(`/api/knowledge/${smallSpace}/graph`, {
                headers,
              })
            ).status,
            404,
          );
        },
      );
      await writeFile(
        resolve(artifact, "graph-fixtures.json"),
        JSON.stringify(fixtures, null, 2),
      );
      await writeFile(
        resolve(artifact, "graph-query-timings.json"),
        JSON.stringify(timings, null, 2),
      );
    } finally {
      await pool.end();
    }
  },
);
