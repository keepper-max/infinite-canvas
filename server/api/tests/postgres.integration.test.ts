import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../src/app.js";
import { PostgresAssetService } from "../src/asset-service.js";
import type { ApiConfig } from "../src/config.js";
import { createDatabase } from "../src/db/client.js";
import { applyMigrations } from "../src/db/migrate.js";
import { PostgresPlatformRepository } from "../src/repository.js";
import type { ObjectStorage, StoredObject } from "../src/object-storage.js";

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
      const assetService = new PostgresAssetService(db, objectStorage);
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
