import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../src/app.js";
import { PostgresAssetService } from "../src/asset-service.js";
import type { ApiConfig } from "../src/config.js";
import { createDatabase } from "../src/db/client.js";
import { applyMigrations } from "../src/db/migrate.js";
import { PostgresPlatformRepository } from "../src/repository.js";
import type { ObjectStorage, StoredObject } from "../src/object-storage.js";
import { OperationsService } from "../src/operations-service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test(
  "PostgreSQL persists sessions, default workspace, and project isolation",
  { skip: !databaseUrl },
  async () => {
    const { db, pool } = createDatabase(databaseUrl!);
    try {
      await applyMigrations(pool);
      const repository = new PostgresPlatformRepository(db);
      const objectStorage = new MemoryObjectStorage();
      const assetService = new PostgresAssetService(db, objectStorage, pool);
      const config: ApiConfig = {
        port: 3002,
        databaseUrl: databaseUrl!,
        cookieName: "integration_session",
        cookieSecure: false,
        sessionDays: 14,
        trustedOrigins: [],
        objectStorage: {
          endpoint: "http://unused",
          publicEndpoint: "http://unused",
          region: "us-east-1",
          bucket: "test",
          accessKeyId: "test",
          secretAccessKey: "test",
          forcePathStyle: true,
          autoCreateBucket: false,
        },
      };
      const firstApp = createApp(repository, config, assetService);
      const suffix = crypto.randomUUID();
      const firstEmail = `db-a-${suffix}@example.com`;
      const secondEmail = `db-b-${suffix}@example.com`;
      const first = await register(firstApp, firstEmail);
      const second = await register(firstApp, secondEmail);

      const count = await pool.query<{ count: string }>(
        "select count(*)::text as count from projects where owner_id = (select id from users where email = $1)",
        [firstEmail],
      );
      assert.equal(count.rows[0]?.count, "1");
      const defaults = await pool.query<{ count: string }>(
        "select count(*)::text as count from projects where owner_id = (select id from users where email = $1) and is_default = true",
        [firstEmail],
      );
      assert.equal(defaults.rows[0]?.count, "1");

      const restartedApp = createApp(
        new PostgresPlatformRepository(db),
        config,
        assetService,
      );
      assert.equal(
        (
          await restartedApp.request("/api/auth/me", {
            headers: { cookie: first.cookie },
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await restartedApp.request(`/api/projects/${second.workspaceId}`, {
            headers: { cookie: first.cookie },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await restartedApp.request(`/api/projects/${first.workspaceId}`, {
            headers: { cookie: first.cookie },
          })
        ).status,
        200,
      );

      const createdProject = await postJson(
        restartedApp,
        "/api/projects",
        first.cookie,
        { name: "云端第二项目", description: "生命周期验收" },
      );
      assert.equal(createdProject.response.status, 201);
      const createdProjectId = createdProject.body.data.project.projectId;
      const renamedProject = await patchJson(
        restartedApp,
        `/api/projects/${createdProjectId}`,
        first.cookie,
        { name: "云端第二项目·已改名" },
      );
      assert.equal(
        renamedProject.body.data.project.projectTitle,
        "云端第二项目·已改名",
      );
      const deletedProject = await restartedApp.request(
        `/api/projects/${createdProjectId}`,
        { method: "DELETE", headers: { cookie: first.cookie } },
      );
      assert.equal(deletedProject.status, 200);
      assert.equal(
        ((await deletedProject.json()) as any).data.workspace.projectId,
        first.workspaceId,
      );
      assert.equal(
        (
          await restartedApp.request(`/api/projects/${createdProjectId}`, {
            headers: { cookie: first.cookie },
          })
        ).status,
        403,
      );
      assert.ok(
        (
          await pool.query(
            "select deleted_at from projects where id=$1 and deleted_at is not null",
            [createdProjectId],
          )
        ).rowCount,
      );

      const initialWrite = canvasWrite(0, "初始故事");
      const saved = await putCanvas(
        restartedApp,
        first.workspaceId,
        first.cookie,
        initialWrite,
      );
      assert.equal(saved.response.status, 200);
      assert.equal(saved.body.data.canvas.revision, 1);
      assert.equal(
        (
          await restartedApp.request(
            `/api/projects/${first.workspaceId}/canvas`,
            { headers: { cookie: second.cookie } },
          )
        ).status,
        403,
      );

      const stale = await putCanvas(
        restartedApp,
        first.workspaceId,
        first.cookie,
        initialWrite,
      );
      assert.equal(stale.response.status, 409);
      assert.equal(stale.body.error.details.currentRevision, 1);

      const secondVersion = await putCanvas(
        restartedApp,
        first.workspaceId,
        first.cookie,
        canvasWrite(1, "第二版故事"),
      );
      assert.equal(secondVersion.body.data.canvas.revision, 2);
      const snapshots = await restartedApp.request(
        `/api/projects/${first.workspaceId}/canvas/snapshots`,
        { headers: { cookie: first.cookie } },
      );
      assert.deepEqual(
        ((await snapshots.json()) as any).data.snapshots.map(
          (item: any) => item.version,
        ),
        [2, 1],
      );
      const restored = await restartedApp.request(
        `/api/projects/${first.workspaceId}/canvas/snapshots/1/restore`,
        {
          method: "POST",
          headers: { cookie: first.cookie, "content-type": "application/json" },
          body: JSON.stringify({ expectedRevision: 2 }),
        },
      );
      const restoredBody = (await restored.json()) as any;
      assert.equal(restoredBody.data.canvas.revision, 3);
      assert.equal(restoredBody.data.canvas.nodes[0].title, "初始故事");

      const migrationProject = await register(
        restartedApp,
        `db-migration-${suffix}@example.com`,
      );
      const migrationBody = {
        migrationKey: `indexeddb-${suffix}`,
        ...canvasWrite(0, "迁移故事"),
        nodes: [
          {
            ...canvasWrite(0, "迁移故事").nodes[0],
            metadata: { apiKey: "do-not-store", storageKey: "image:pending" },
          },
        ],
      };
      const migrated = await postJson(
        restartedApp,
        `/api/projects/${migrationProject.workspaceId}/canvas/migrations/indexeddb`,
        migrationProject.cookie,
        migrationBody,
      );
      assert.equal(
        migrated.body.data.canvas.nodes[0].metadata.apiKey,
        undefined,
      );
      assert.deepEqual(migrated.body.data.report.pendingResourceRefs, [
        "image:pending",
      ]);
      const repeated = await postJson(
        restartedApp,
        `/api/projects/${migrationProject.workspaceId}/canvas/migrations/indexeddb`,
        migrationProject.cookie,
        migrationBody,
      );
      assert.equal(repeated.body.data.alreadyMigrated, true);

      const firstUpload = await postJson(
        restartedApp,
        `/api/projects/${first.workspaceId}/assets/uploads`,
        first.cookie,
        {
          ...assetUpload("frame.png"),
          thumbnail: {
            mimeType: "image/webp",
            bytes: 4,
            sha256: "b".repeat(64),
          },
        },
      );
      objectStorage.put(firstUpload.body.data.upload.storageKey, {
        bytes: 4,
        mimeType: "image/png",
        sha256: "a".repeat(64),
      });
      const thumbnailStorageKey =
        firstUpload.body.data.upload.thumbnailUpload.url.replace(
          "https://storage.test/upload/",
          "",
        );
      objectStorage.put(thumbnailStorageKey, {
        bytes: 4,
        mimeType: "image/webp",
        sha256: "b".repeat(64),
      });
      const firstVersion = await postJson(
        restartedApp,
        `/api/projects/${first.workspaceId}/assets/uploads/${firstUpload.body.data.upload.uploadId}/complete`,
        first.cookie,
        {},
      );
      assert.equal(firstVersion.body.data.asset.versions[0].version, 1);
      assert.match(
        firstVersion.body.data.asset.versions[0].thumbnailUrl,
        /\/download\/projects\//,
      );
      const assetId = firstVersion.body.data.asset.id;
      const firstVersionId = firstVersion.body.data.asset.currentVersionId;

      const secondUpload = await postJson(
        restartedApp,
        `/api/projects/${first.workspaceId}/assets/uploads`,
        first.cookie,
        {
          ...assetUpload("frame-v2.png"),
          assetId,
          parentVersionIds: [firstVersionId],
          provenance: { modelId: "test-image-model", skillId: "test-skill" },
        },
      );
      objectStorage.put(secondUpload.body.data.upload.storageKey, {
        bytes: 4,
        mimeType: "image/png",
        sha256: "a".repeat(64),
      });
      const secondAssetVersion = await postJson(
        restartedApp,
        `/api/projects/${first.workspaceId}/assets/uploads/${secondUpload.body.data.upload.uploadId}/complete`,
        first.cookie,
        {},
      );
      assert.deepEqual(
        secondAssetVersion.body.data.asset.versions.map(
          (version: any) => version.version,
        ),
        [2, 1],
      );
      assert.deepEqual(
        secondAssetVersion.body.data.asset.versions[0].parentVersionIds,
        [firstVersionId],
      );
      assert.deepEqual(
        secondAssetVersion.body.data.asset.versions[0].provenance,
        { modelId: "test-image-model", skillId: "test-skill" },
      );
      const secondVersionId =
        secondAssetVersion.body.data.asset.currentVersionId;

      const canvasWithPinnedVersion = canvasWrite(3, "固定素材版本");
      canvasWithPinnedVersion.nodes[0].metadata = {
        assetId,
        assetVersionId: firstVersionId,
      };
      assert.equal(
        (
          await putCanvas(
            restartedApp,
            first.workspaceId,
            first.cookie,
            canvasWithPinnedVersion,
          )
        ).response.status,
        200,
      );
      const link = await pool.query<{ asset_version_id: string }>(
        "select asset_version_id from asset_links where project_id = $1 and node_id = 'story'",
        [first.workspaceId],
      );
      assert.equal(link.rows[0]?.asset_version_id, firstVersionId);

      const switched = await patchJson(
        restartedApp,
        `/api/assets/${assetId}/current-version`,
        first.cookie,
        { versionId: firstVersionId },
      );
      assert.equal(switched.body.data.asset.currentVersionId, firstVersionId);
      assert.notEqual(firstVersionId, secondVersionId);
      assert.equal(
        (
          await pool.query<{ asset_version_id: string }>(
            "select asset_version_id from asset_links where project_id = $1 and node_id = 'story'",
            [first.workspaceId],
          )
        ).rows[0]?.asset_version_id,
        firstVersionId,
      );

      const firstDownload = await restartedApp.request(
        `/api/asset-versions/${firstVersionId}/download`,
        { headers: { cookie: first.cookie } },
      );
      const secondDownload = await restartedApp.request(
        `/api/asset-versions/${firstVersionId}/download`,
        { headers: { cookie: first.cookie } },
      );
      assert.notEqual(
        ((await firstDownload.json()) as any).data.url,
        ((await secondDownload.json()) as any).data.url,
      );
      assert.equal(
        (
          await restartedApp.request(
            `/api/asset-versions/${firstVersionId}/download`,
            { headers: { cookie: second.cookie } },
          )
        ).status,
        404,
      );

      assert.equal(
        (
          await postJson(
            restartedApp,
            `/api/assets/${assetId}/trash`,
            first.cookie,
            { reason: "integration" },
          )
        ).body.data.asset.status,
        "trashed",
      );
      const blockedPurge = await restartedApp.request(
        `/api/assets/${assetId}`,
        { method: "DELETE", headers: { cookie: first.cookie } },
      );
      assert.equal(blockedPurge.status, 409);
      assert.equal((await blockedPurge.json() as any).error.code, "ASSET_IN_USE");
      assert.equal(
        (
          await postJson(
            restartedApp,
            `/api/assets/${assetId}/restore`,
            first.cookie,
            {},
          )
        ).body.data.asset.status,
        "active",
      );

      const firstUser = await pool.query<{ id: string }>(
        "select id from users where email=$1",
        [firstEmail],
      );
      const secondUser = await pool.query<{ id: string }>(
        "select id from users where email=$1",
        [secondEmail],
      );
      const operations = new OperationsService(pool, {
        adminEmails: [firstEmail],
      });
      const account = (await operations.account(firstUser.rows[0]!.id)) as {
        account: { balance: number };
        enabled: boolean;
      };
      assert.equal(account.account.balance, 0);
      assert.equal(account.enabled, false);
      assert.deepEqual(await operations.capabilities(), {
        sms: false,
        credits: false,
        payments: false,
        teams: true,
        admin: true,
      });
      const team = (await operations.createTeam(firstUser.rows[0]!.id, {
        name: "集成测试团队",
      })) as { id: string; role: string };
      assert.equal(team.role, "owner");
      const member = (await operations.addTeamMember(
        team.id,
        firstUser.rows[0]!.id,
        { email: secondEmail, role: "editor" },
      )) as { role: string };
      assert.equal(member.role, "editor");
      assert.equal(
        (await operations.listTeamMembers(team.id, firstUser.rows[0]!.id))
          .length,
        2,
      );
      await operations.attachTeamProject(
        team.id,
        firstUser.rows[0]!.id,
        first.workspaceId,
      );
      assert.equal(
        (
          await restartedApp.request(`/api/projects/${first.workspaceId}`, {
            headers: { cookie: second.cookie },
          })
        ).status,
        200,
      );
      await operations.addTeamMember(team.id, firstUser.rows[0]!.id, {
        email: secondEmail,
        role: "viewer",
      });
      const viewerSave = await putCanvas(
        restartedApp,
        first.workspaceId,
        second.cookie,
        canvasWrite(4, "只读成员不应保存"),
      );
      assert.equal(viewerSave.response.status, 403);
      assert.equal(viewerSave.body.error.code, "PROJECT_READ_ONLY");
      assert.equal(
        (
          await postJson(
            restartedApp,
            `/api/assets/${assetId}/trash`,
            second.cookie,
            { reason: "forbidden" },
          )
        ).response.status,
        403,
      );
      const bulkSaved = await putCanvas(
        restartedApp,
        first.workspaceId,
        first.cookie,
        bulkCanvasWrite(4, 80),
      );
      assert.equal(bulkSaved.response.status, 200);
      await postJson(
        restartedApp,
        `/api/assets/${assetId}/trash`,
        first.cookie,
        { reason: "permanent-delete" },
      );
      const permanentDelete = await restartedApp.request(
        `/api/assets/${assetId}`,
        { method: "DELETE", headers: { cookie: first.cookie } },
      );
      assert.equal(permanentDelete.status, 200);
      assert.equal(
        ((await permanentDelete.json()) as any).data.purge.storageStatus,
        "completed",
      );
      assert.equal(await objectStorage.stat(firstUpload.body.data.upload.storageKey), null);
      assert.equal(await objectStorage.stat(secondUpload.body.data.upload.storageKey), null);
      assert.equal(
        (await pool.query("select count(*)::int count from assets where id=$1", [assetId])).rows[0].count,
        0,
      );
      const expiredUpload = await postJson(
        restartedApp,
        `/api/projects/${first.workspaceId}/assets/uploads`,
        first.cookie,
        assetUpload("expired.png"),
      );
      objectStorage.put(expiredUpload.body.data.upload.storageKey, {
        bytes: 4,
        mimeType: "image/png",
        sha256: "a".repeat(64),
      });
      const expiredAsset = await postJson(
        restartedApp,
        `/api/projects/${first.workspaceId}/assets/uploads/${expiredUpload.body.data.upload.uploadId}/complete`,
        first.cookie,
        {},
      );
      const expiredAssetId = expiredAsset.body.data.asset.id;
      await postJson(
        restartedApp,
        `/api/assets/${expiredAssetId}/trash`,
        first.cookie,
        { reason: "retention-test" },
      );
      await pool.query(
        "update assets set trashed_at=now()-interval '15 days' where id=$1",
        [expiredAssetId],
      );
      assert.equal(await assetService.purgeExpired(14), 1);
      assert.equal(
        await objectStorage.stat(expiredUpload.body.data.upload.storageKey),
        null,
      );
      const bulkRestored = await restartedApp.request(
        `/api/projects/${first.workspaceId}/canvas`,
        { headers: { cookie: first.cookie } },
      );
      const bulkRestoredBody = (await bulkRestored.json()) as any;
      assert.equal(bulkRestoredBody.data.canvas.nodes.length, 80);
      assert.equal(bulkRestoredBody.data.canvas.edges.length, 79);
      assert.ok(
        Number(
          (
            await pool.query(
              "select count(*)::int as count from admin_audit_logs where actor_user_id=$1",
              [firstUser.rows[0]!.id],
            )
          ).rows[0]?.count,
        ) >= 3,
      );
      assert.ok(
        Array.isArray(await operations.adminModels(firstUser.rows[0]!.id)),
      );
      assert.ok(
        Array.isArray(await operations.adminFailures(firstUser.rows[0]!.id)),
      );
      await assert.rejects(
        () => operations.adminOverview(secondUser.rows[0]!.id),
        (error: any) => error?.code === "ADMIN_FORBIDDEN",
      );
      const overview = (await operations.adminOverview(
        firstUser.rows[0]!.id,
      )) as {
        users: number;
        projects: number;
        userActivity: { active30d: number; new30d: number };
        jobActivity: { jobs30d: number; successRate30d: number };
        creditActivity: { consumed30d: string };
        alerts: { pendingBillingJobs: number; pendingCreditCharges: number };
        usage30d: unknown[];
        trends: Array<{ activeUsers: number; creditPoints: string }>;
      };
      assert.ok(overview.users >= 2);
      assert.ok(overview.projects >= 2);
      assert.ok(overview.userActivity.active30d >= 0);
      assert.ok(overview.userActivity.new30d >= 0);
      assert.ok(overview.jobActivity.jobs30d >= 0);
      assert.ok(overview.jobActivity.successRate30d >= 0);
      assert.match(overview.creditActivity.consumed30d, /^\d+$/);
      assert.ok(overview.alerts.pendingBillingJobs >= 0);
      assert.ok(overview.alerts.pendingCreditCharges >= 0);
      assert.ok(Array.isArray(overview.usage30d));
      assert.equal(overview.trends.length, 30);
      assert.ok(overview.trends.every((item) => item.activeUsers >= 0 && /^\d+$/.test(item.creditPoints)));
      const today = new Date().toISOString().slice(0, 10);
      const dailyOverview = (await operations.adminOverview(
        firstUser.rows[0]!.id,
        { dateFrom: today, dateTo: today },
      )) as {
        range: { from: string; to: string };
        userActivity: { newInRange: number; activeInRange: number };
        jobActivity: { jobsInRange: number; failedInRange: number };
        creditActivity: { consumedInRange: string };
        usageRange: unknown[];
        trends: unknown[];
      };
      assert.deepEqual(dailyOverview.range, { from: today, to: today });
      assert.ok(dailyOverview.userActivity.newInRange >= 0);
      assert.ok(dailyOverview.userActivity.activeInRange >= 0);
      assert.ok(dailyOverview.jobActivity.jobsInRange >= 0);
      assert.ok(dailyOverview.jobActivity.failedInRange >= 0);
      assert.match(dailyOverview.creditActivity.consumedInRange, /^\d+$/);
      assert.ok(Array.isArray(dailyOverview.usageRange));
      assert.equal(dailyOverview.trends.length, 1);
      const historicalJobs = (await operations.adminJobs(
        firstUser.rows[0]!.id,
        { page: 1, pageSize: 20, createdFrom: "1900-01-01", createdTo: "1900-01-01" },
      )) as { total: number; items: unknown[] };
      assert.equal(historicalJobs.total, 0);
      assert.deepEqual(historicalJobs.items, []);
    } finally {
      await pool.end();
    }
  },
);

async function register(app: ReturnType<typeof createApp>, email: string) {
  const response = await app.request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "integration-password" }),
  });
  assert.equal(response.status, 201);
  const body = (await response.json()) as {
    data: { workspace: { projectId: string } };
  };
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);
  return { cookie, workspaceId: body.data.workspace.projectId };
}

function canvasWrite(expectedRevision: number, title: string) {
  return {
    expectedRevision,
    contractVersion: 1,
    nodes: [
      {
        id: "story",
        type: "text",
        title,
        position: { x: 40, y: 80 },
        width: 320,
        height: 180,
        metadata: {},
      },
    ],
    edges: [],
    viewport: { x: 12, y: 24, k: 1.25 },
    settings: { backgroundMode: "dots", showImageInfo: true },
  };
}

function bulkCanvasWrite(expectedRevision: number, count: number) {
  const base = canvasWrite(expectedRevision, "批量节点 1");
  return {
    ...base,
    nodes: Array.from({ length: count }, (_, index) => ({
      ...base.nodes[0],
      id: `bulk-${index + 1}`,
      title: `批量节点 ${index + 1}`,
      position: { x: (index % 10) * 360, y: Math.floor(index / 10) * 220 },
    })),
    edges: Array.from({ length: Math.max(0, count - 1) }, (_, index) => ({
      id: `bulk-edge-${index + 1}`,
      fromNodeId: `bulk-${index + 1}`,
      toNodeId: `bulk-${index + 2}`,
    })),
  };
}

async function putCanvas(
  app: ReturnType<typeof createApp>,
  projectId: string,
  cookie: string,
  body: unknown,
) {
  const response = await app.request(`/api/projects/${projectId}/canvas`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, body: (await response.json()) as any };
}

async function postJson(
  app: ReturnType<typeof createApp>,
  path: string,
  cookie: string,
  body: unknown,
) {
  const response = await app.request(path, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, body: (await response.json()) as any };
}

async function patchJson(
  app: ReturnType<typeof createApp>,
  path: string,
  cookie: string,
  body: unknown,
) {
  const response = await app.request(path, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, body: (await response.json()) as any };
}

function assetUpload(name: string) {
  return {
    kind: "image",
    name,
    mimeType: "image/png",
    bytes: 4,
    sha256: "a".repeat(64),
    source: "upload",
    parentVersionIds: [],
    provenance: {},
  };
}

class MemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, StoredObject>();
  private readonly bodies = new Map<string, Uint8Array>();
  private signature = 0;

  put(key: string, object: StoredObject): void;
  put(
    key: string,
    body: Uint8Array,
    mimeType: string,
    sha256: string,
  ): Promise<StoredObject>;
  put(
    key: string,
    value: StoredObject | Uint8Array,
    mimeType?: string,
    sha256?: string,
  ): void | Promise<StoredObject> {
    if (value instanceof Uint8Array) {
      const object = {
        bytes: value.byteLength,
        mimeType: mimeType || "application/octet-stream",
        sha256,
      };
      this.objects.set(key, object);
      this.bodies.set(key, value);
      return Promise.resolve(object);
    }
    this.objects.set(key, value);
  }

  async ensureReady() {}

  async createUploadUrl(storageKey: string, mimeType: string, sha256: string) {
    return {
      url: `https://storage.test/upload/${storageKey}`,
      headers: { "content-type": mimeType, "x-amz-meta-sha256": sha256 },
    };
  }

  async createDownloadUrl(storageKey: string) {
    return `https://storage.test/download/${storageKey}?signature=${++this.signature}`;
  }

  async stat(storageKey: string) {
    return this.objects.get(storageKey) || null;
  }

  async get(storageKey: string) {
    const body = this.bodies.get(storageKey);
    if (!body) throw new Error("Object not found");
    return body;
  }

  async delete(storageKey: string) {
    this.objects.delete(storageKey);
  }
}
