import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../src/app.js";
import type { AssetDocument, BeginAssetUpload } from "../src/asset-contract.js";
import type { AssetServicePort } from "../src/asset-service.js";
import type {
  CanvasDocument,
  CanvasMigrationReport,
  CanvasSnapshotSummary,
  CanvasWrite,
} from "../src/canvas-contract.js";
import {
  DomainError,
  type PlatformRepository,
  type PlatformUser,
  type ProjectSummary,
  type Workspace,
} from "../src/domain.js";
import type { ApiConfig } from "../src/config.js";
import type { OperationsServicePort } from "../src/operations-service.js";

const config: ApiConfig = {
  port: 3002,
  databaseUrl: "postgresql://unused",
  cookieName: "test_session",
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

test("register creates one workspace and subsequent login reuses it", async () => {
  const repository = new MemoryRepository();
  const app = createApp(repository, config);
  const registered = await jsonRequest(app, "/api/auth/register", {
    email: "first@example.com",
    password: "password-123",
  });
  assert.equal(registered.response.status, 201);
  assert.equal(registered.body.data.workspace.projectTitle, "未命名项目");
  assert.equal(repository.workspaces.size, 1);

  const loggedIn = await jsonRequest(app, "/api/auth/login", {
    email: "first@example.com",
    password: "password-123",
  });
  assert.equal(loggedIn.response.status, 200);
  assert.equal(
    loggedIn.body.data.workspace.projectId,
    registered.body.data.workspace.projectId,
  );
  assert.equal(repository.workspaces.size, 1);
});

test("duplicate email and wrong password return stable errors", async () => {
  const repository = new MemoryRepository();
  const app = createApp(repository, config);
  await jsonRequest(app, "/api/auth/register", {
    email: "same@example.com",
    password: "password-123",
  });
  const duplicate = await jsonRequest(app, "/api/auth/register", {
    email: "SAME@example.com",
    password: "password-456",
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.error.code, "EMAIL_ALREADY_REGISTERED");
  const wrong = await jsonRequest(app, "/api/auth/login", {
    email: "same@example.com",
    password: "not-the-password",
  });
  assert.equal(wrong.response.status, 401);
  assert.equal(wrong.body.error.code, "INVALID_CREDENTIALS");
});

test("session survives a new app instance and logout revokes it", async () => {
  const repository = new MemoryRepository();
  const firstApp = createApp(repository, config);
  const registered = await jsonRequest(firstApp, "/api/auth/register", {
    email: "persist@example.com",
    password: "password-123",
  });
  const cookie = cookieFrom(registered.response);
  const restartedApp = createApp(repository, config);
  const me = await restartedApp.request("/api/auth/me", {
    headers: { cookie },
  });
  assert.equal(me.status, 200);
  const logout = await restartedApp.request("/api/auth/logout", {
    method: "POST",
    headers: { cookie },
  });
  assert.equal(logout.status, 200);
  const after = await restartedApp.request("/api/auth/me", {
    headers: { cookie },
  });
  assert.equal(after.status, 401);
});

test("project lookup is scoped to the signed-in member", async () => {
  const repository = new MemoryRepository();
  const app = createApp(repository, config);
  const first = await jsonRequest(app, "/api/auth/register", {
    email: "a@example.com",
    password: "password-123",
  });
  const second = await jsonRequest(app, "/api/auth/register", {
    email: "b@example.com",
    password: "password-123",
  });
  const response = await app.request(
    `/api/projects/${second.body.data.workspace.projectId}`,
    { headers: { cookie: cookieFrom(first.response) } },
  );
  const body = (await response.json()) as any;
  assert.equal(response.status, 403);
  assert.equal(body.error.code, "PROJECT_FORBIDDEN");
});

test("project lifecycle is server authoritative and delete keeps a usable workspace", async () => {
  const repository = new MemoryRepository();
  const app = createApp(repository, config);
  const registered = await jsonRequest(app, "/api/auth/register", {
    email: "projects@example.com",
    password: "password-123",
  });
  const cookie = cookieFrom(registered.response);
  const created = await postJson(app, "/api/projects", cookie, {
    name: "第二集",
  });
  assert.equal(created.response.status, 201);
  const projectId = created.body.data.project.projectId;
  const renamed = await patchJson(app, `/api/projects/${projectId}`, cookie, {
    name: "第二集·修订",
  });
  assert.equal(renamed.body.data.project.projectTitle, "第二集·修订");
  assert.equal(
    (await app.request("/api/projects", { headers: { cookie } })).status,
    200,
  );
  const removed = await app.request(`/api/projects/${projectId}`, {
    method: "DELETE",
    headers: { cookie },
  });
  const removedBody = (await removed.json()) as any;
  assert.equal(removed.status, 200);
  assert.equal(removedBody.data.deletedProjectId, projectId);
  assert.notEqual(removedBody.data.workspace.projectId, projectId);
  assert.equal(
    (await app.request(`/api/projects/${projectId}`, { headers: { cookie } }))
      .status,
    403,
  );
});

test("cross-site state changes are rejected", async () => {
  const app = createApp(new MemoryRepository(), config);
  const response = await app.request("http://local.test/api/auth/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    },
    body: JSON.stringify({
      email: "blocked@example.com",
      password: "password-123",
    }),
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("permissions-policy") || "", /camera=\(\)/);
});

test("Alipay notify bypasses browser Origin checks only at the exact signed callback route", async () => {
  let received: Record<string, string> | undefined;
  const operations = {
    receivePaymentCallback: async (fields: Record<string, string>) => {
      received = fields;
      return true;
    },
  } as OperationsServicePort;
  const app = createApp(
    new MemoryRepository(),
    config,
    undefined,
    undefined,
    undefined,
    undefined,
    operations,
  );
  const response = await app.request("http://local.test/api/payments/notify", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    },
    body: "out_trade_no=order-1&sign=signed",
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "success");
  assert.deepEqual(received, { out_trade_no: "order-1", sign: "signed" });
});

test("canvas endpoints persist structure and expose revision conflicts", async () => {
  const repository = new MemoryRepository();
  const app = createApp(repository, config);
  const registered = await jsonRequest(app, "/api/auth/register", {
    email: "canvas@example.com",
    password: "password-123",
  });
  const projectId = registered.body.data.workspace.projectId;
  const cookie = cookieFrom(registered.response);
  const write = canvasWrite(0);
  const saved = await app.request(`/api/projects/${projectId}/canvas`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(write),
  });
  assert.equal(saved.status, 200);
  assert.equal(((await saved.json()) as any).data.canvas.revision, 1);

  const restored = await app.request(`/api/projects/${projectId}/canvas`, {
    headers: { cookie },
  });
  assert.equal(restored.status, 200);
  assert.equal(
    ((await restored.json()) as any).data.canvas.nodes[0].title,
    "故事",
  );

  const stale = await app.request(`/api/projects/${projectId}/canvas`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(write),
  });
  const staleBody = (await stale.json()) as any;
  assert.equal(stale.status, 409);
  assert.equal(staleBody.error.code, "CANVAS_REVISION_CONFLICT");
  assert.equal(staleBody.error.details.currentRevision, 1);
});

test("canvas migration is idempotent and project scoped", async () => {
  const repository = new MemoryRepository();
  const app = createApp(repository, config);
  const first = await jsonRequest(app, "/api/auth/register", {
    email: "owner@example.com",
    password: "password-123",
  });
  const second = await jsonRequest(app, "/api/auth/register", {
    email: "other@example.com",
    password: "password-123",
  });
  const projectId = first.body.data.workspace.projectId;
  const migration = {
    migrationKey: "indexeddb-v7-owner",
    ...canvasWrite(0),
    nodes: [
      {
        ...canvasWrite(0).nodes[0],
        metadata: { apiKey: "must-not-persist", storageKey: "image:one" },
      },
    ],
  };
  const migrated = await app.request(
    `/api/projects/${projectId}/canvas/migrations/indexeddb`,
    {
      method: "POST",
      headers: {
        cookie: cookieFrom(first.response),
        "content-type": "application/json",
      },
      body: JSON.stringify(migration),
    },
  );
  const migratedBody = (await migrated.json()) as any;
  assert.equal(migrated.status, 200);
  assert.equal(migratedBody.data.canvas.nodes[0].metadata.apiKey, undefined);
  assert.deepEqual(migratedBody.data.report.pendingResourceRefs, ["image:one"]);

  const duplicate = await app.request(
    `/api/projects/${projectId}/canvas/migrations/indexeddb`,
    {
      method: "POST",
      headers: {
        cookie: cookieFrom(first.response),
        "content-type": "application/json",
      },
      body: JSON.stringify(migration),
    },
  );
  assert.equal(((await duplicate.json()) as any).data.alreadyMigrated, true);
  const forbidden = await app.request(`/api/projects/${projectId}/canvas`, {
    headers: { cookie: cookieFrom(second.response) },
  });
  assert.equal(forbidden.status, 403);
});

test("asset routes keep immutable versions, regenerate downloads, and isolate projects", async () => {
  const repository = new MemoryRepository();
  const assets = new MemoryAssetService(repository);
  const app = createApp(repository, config, assets);
  const first = await jsonRequest(app, "/api/auth/register", {
    email: "asset-owner@example.com",
    password: "password-123",
  });
  const second = await jsonRequest(app, "/api/auth/register", {
    email: "asset-other@example.com",
    password: "password-123",
  });
  const projectId = first.body.data.workspace.projectId;
  const firstCookie = cookieFrom(first.response);
  const upload = await postJson(
    app,
    `/api/projects/${projectId}/assets/uploads`,
    firstCookie,
    uploadInput("first.png"),
  );
  assert.equal(upload.response.status, 201);
  const invalidMime = await postJson(
    app,
    `/api/projects/${projectId}/assets/uploads`,
    firstCookie,
    { ...uploadInput("not-an-image.txt"), mimeType: "text/plain" },
  );
  assert.equal(invalidMime.response.status, 422);
  const completed = await postJson(
    app,
    `/api/projects/${projectId}/assets/uploads/${upload.body.data.upload.uploadId}/complete`,
    firstCookie,
    {},
  );
  assert.equal(completed.body.data.asset.versions[0].version, 1);

  const listed = await app.request(`/api/projects/${projectId}/assets`, {
    headers: { cookie: firstCookie },
  });
  assert.equal(((await listed.json()) as any).data.assets.length, 1);
  const forbidden = await app.request(`/api/projects/${projectId}/assets`, {
    headers: { cookie: cookieFrom(second.response) },
  });
  assert.equal(forbidden.status, 403);

  const versionId = completed.body.data.asset.currentVersionId;
  const download = await app.request(
    `/api/asset-versions/${versionId}/download`,
    { headers: { cookie: firstCookie } },
  );
  assert.match(
    ((await download.json()) as any).data.url,
    /signed\/asset-version/,
  );
  const trashed = await postJson(
    app,
    `/api/assets/${completed.body.data.asset.id}/trash`,
    firstCookie,
    { reason: "test" },
  );
  assert.equal(trashed.body.data.asset.status, "trashed");
  const restored = await postJson(
    app,
    `/api/assets/${completed.body.data.asset.id}/restore`,
    firstCookie,
    {},
  );
  assert.equal(restored.body.data.asset.status, "active");
  await postJson(
    app,
    `/api/assets/${completed.body.data.asset.id}/trash`,
    firstCookie,
    { reason: "purge test" },
  );
  const purged = await app.request(
    `/api/assets/${completed.body.data.asset.id}`,
    { method: "DELETE", headers: { cookie: firstCookie } },
  );
  assert.equal(purged.status, 200);
  assert.equal((await purged.json() as any).data.purge.storageStatus, "completed");
  const afterPurge = await app.request(
    `/api/projects/${projectId}/assets?status=all`,
    { headers: { cookie: firstCookie } },
  );
  assert.equal(((await afterPurge.json()) as any).data.assets.length, 0);
});

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  body: unknown,
) {
  const response = await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
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

function uploadInput(name: string) {
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

function cookieFrom(response: Response) {
  const value = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(value);
  return value;
}

class MemoryRepository implements PlatformRepository {
  users = new Map<string, PlatformUser & { passwordHash: string }>();
  sessions = new Map<string, { userId: string; expiresAt: Date }>();
  workspaces = new Map<string, Workspace>();
  owners = new Map<string, string>();
  deleted = new Set<string>();
  canvases = new Map<string, CanvasDocument>();
  snapshots = new Map<string, CanvasSnapshotSummary[]>();
  migrations = new Map<string, CanvasMigrationReport>();

  async createUserWithWorkspace(email: string, passwordHash: string) {
    if ([...this.users.values()].some((user) => user.email === email))
      throw new DomainError("EMAIL_ALREADY_REGISTERED", "邮箱已注册", 409);
    const user = { id: crypto.randomUUID(), email, passwordHash };
    this.users.set(user.id, user);
    const workspace = this.workspaceFor(user.id);
    return { user: { id: user.id, email: user.email }, workspace };
  }

  async findUserByEmail(email: string) {
    return (
      [...this.users.values()].find((user) => user.email === email) || null
    );
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date) {
    this.sessions.set(tokenHash, { userId, expiresAt });
  }

  async findUserBySession(tokenHash: string, now: Date) {
    const session = this.sessions.get(tokenHash);
    const user =
      session && session.expiresAt > now
        ? this.users.get(session.userId)
        : null;
    return user ? { id: user.id, email: user.email } : null;
  }

  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }

  async ensureDefaultWorkspace(userId: string) {
    return this.workspaceFor(userId);
  }

  async createProjectForUser(
    userId: string,
    input: { name: string; description: string },
  ) {
    const workspace = this.newWorkspace(
      userId,
      input.name,
      input.description,
      false,
    );
    return { ...workspace, role: "owner" };
  }

  async listProjects(userId: string): Promise<ProjectSummary[]> {
    return [...this.workspaces.values()]
      .filter((workspace) => this.owns(workspace.projectId, userId))
      .map((workspace) => ({ ...workspace, role: "owner" }));
  }

  async getProjectForUser(
    projectId: string,
    userId: string,
  ): Promise<ProjectSummary | null> {
    const workspace = this.workspaces.get(projectId);
    return workspace && this.owns(projectId, userId)
      ? { ...workspace, role: "owner" }
      : null;
  }

  async updateProjectForUser(
    projectId: string,
    userId: string,
    input: { name?: string; description?: string },
  ) {
    const workspace = await this.getProjectForUser(projectId, userId);
    if (!workspace) return null;
    const updated = {
      ...workspace,
      projectTitle: input.name ?? workspace.projectTitle,
      projectDescription: input.description ?? workspace.projectDescription,
      updatedAt: new Date().toISOString(),
    };
    this.workspaces.set(projectId, updated);
    return updated;
  }

  async deleteProjectForUser(projectId: string, userId: string) {
    if (!this.owns(projectId, userId)) return null;
    this.deleted.add(projectId);
    return {
      deletedProjectId: projectId,
      workspace: this.workspaceFor(userId),
    };
  }

  async getCanvasForUser(projectId: string, userId: string) {
    return this.owns(projectId, userId)
      ? this.canvasFor(projectId, userId)
      : null;
  }

  async saveCanvasForUser(
    projectId: string,
    userId: string,
    write: CanvasWrite,
    source = "save",
    restoredFromVersion?: number,
  ) {
    if (!this.owns(projectId, userId))
      throw new DomainError("PROJECT_FORBIDDEN", "无权访问该项目", 403);
    const current = this.canvasFor(projectId, userId);
    if (current.revision !== write.expectedRevision)
      throw new DomainError(
        "CANVAS_REVISION_CONFLICT",
        "云端画布已更新",
        409,
        false,
        { details: { currentRevision: current.revision } },
      );
    const canvas = {
      ...current,
      ...write,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    this.canvases.set(projectId, canvas);
    this.snapshots.set(projectId, [
      {
        version: canvas.revision,
        source,
        restoredFromVersion: restoredFromVersion ?? null,
        createdAt: canvas.updatedAt,
      },
      ...(this.snapshots.get(projectId) || []),
    ]);
    return canvas;
  }

  async listCanvasSnapshots(projectId: string, userId: string) {
    return this.owns(projectId, userId)
      ? this.snapshots.get(projectId) || []
      : null;
  }

  async restoreCanvasSnapshot(
    projectId: string,
    userId: string,
    version: number,
    expectedRevision: number,
  ) {
    if (!this.owns(projectId, userId)) return null;
    const current = this.canvasFor(projectId, userId);
    if (
      !(this.snapshots.get(projectId) || []).some(
        (snapshot) => snapshot.version === version,
      )
    )
      throw new DomainError(
        "CANVAS_SNAPSHOT_NOT_FOUND",
        "找不到该画布历史版本",
        404,
      );
    return this.saveCanvasForUser(
      projectId,
      userId,
      { ...current, expectedRevision } as CanvasWrite,
      "restore",
      version,
    );
  }

  async migrateCanvasForUser(
    projectId: string,
    userId: string,
    migrationKey: string,
    write: CanvasWrite,
    report: CanvasMigrationReport,
  ) {
    if (!this.owns(projectId, userId))
      throw new DomainError("PROJECT_FORBIDDEN", "无权访问该项目", 403);
    const key = `${projectId}:${userId}:${migrationKey}`;
    const existing = this.migrations.get(key);
    if (existing)
      return {
        canvas: this.canvasFor(projectId, userId),
        report: existing,
        alreadyMigrated: true,
      };
    const canvas = await this.saveCanvasForUser(
      projectId,
      userId,
      write,
      "migration",
    );
    this.migrations.set(key, report);
    return { canvas, report, alreadyMigrated: false };
  }

  async isReady() {
    return true;
  }

  private workspaceFor(userId: string) {
    const existing = [...this.workspaces.values()].find((workspace) =>
      this.owns(workspace.projectId, userId),
    );
    if (existing) return existing;
    return this.newWorkspace(userId, "未命名项目", "", true);
  }

  private newWorkspace(
    userId: string,
    title: string,
    description: string,
    isDefault: boolean,
  ) {
    const now = new Date().toISOString();
    const workspace = {
      projectId: crypto.randomUUID(),
      projectTitle: title,
      projectDescription: description,
      canvasId: crypto.randomUUID(),
      isDefault,
      updatedAt: now,
    };
    this.workspaces.set(workspace.projectId, workspace);
    this.owners.set(workspace.projectId, userId);
    return workspace;
  }

  owns(projectId: string, userId: string) {
    return (
      this.owners.get(projectId) === userId && !this.deleted.has(projectId)
    );
  }

  private canvasFor(projectId: string, userId: string): CanvasDocument {
    const existing = this.canvases.get(projectId);
    if (existing) return existing;
    const workspace =
      this.workspaces.get(projectId) || this.workspaceFor(userId);
    const canvas: CanvasDocument = {
      projectId,
      canvasId: workspace.canvasId,
      revision: 0,
      contractVersion: 1,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, k: 1 },
      settings: { backgroundMode: "lines", showImageInfo: false },
      updatedAt: workspace.updatedAt,
    };
    this.canvases.set(projectId, canvas);
    return canvas;
  }
}

class MemoryAssetService implements AssetServicePort {
  private readonly assets = new Map<string, AssetDocument>();
  private readonly uploads = new Map<
    string,
    {
      projectId: string;
      userId: string;
      input: BeginAssetUpload;
      assetId: string;
    }
  >();

  constructor(private readonly repository: MemoryRepository) {}

  async list(projectId: string, userId: string, includeTrashed = false) {
    if (!this.repository.owns(projectId, userId)) return null;
    return [...this.assets.values()].filter(
      (asset) =>
        asset.projectId === projectId &&
        (includeTrashed || asset.status === "active"),
    );
  }

  async beginUpload(
    projectId: string,
    userId: string,
    input: BeginAssetUpload,
  ) {
    if (!this.repository.owns(projectId, userId))
      throw new DomainError("PROJECT_FORBIDDEN", "无权访问该项目", 403);
    const uploadId = crypto.randomUUID();
    const assetId = input.assetId || crypto.randomUUID();
    this.uploads.set(uploadId, { projectId, userId, input, assetId });
    return {
      uploadId,
      assetId,
      storageKey: `projects/${projectId}/${uploadId}`,
      uploadUrl: "https://signed/upload",
      headers: { "content-type": input.mimeType },
    };
  }

  async completeUpload(projectId: string, uploadId: string, userId: string) {
    if (!this.repository.owns(projectId, userId)) return null;
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.projectId !== projectId || upload.userId !== userId)
      throw new DomainError("ASSET_UPLOAD_NOT_FOUND", "找不到该上传任务", 404);
    const existing = this.assets.get(upload.assetId);
    const now = new Date().toISOString();
    const version = {
      id: crypto.randomUUID(),
      assetId: upload.assetId,
      version: (existing?.versions.length || 0) + 1,
      storageKey: `projects/${projectId}/${uploadId}`,
      mimeType: upload.input.mimeType,
      bytes: upload.input.bytes,
      width: upload.input.width ?? null,
      height: upload.input.height ?? null,
      durationMs: upload.input.durationMs ?? null,
      sha256: upload.input.sha256,
      source: upload.input.source,
      sourceJobId: null,
      parentVersionIds: upload.input.parentVersionIds,
      provenance: upload.input.provenance,
      createdAt: now,
    };
    const item: AssetDocument = {
      id: upload.assetId,
      projectId,
      kind: upload.input.kind,
      name: upload.input.name,
      currentVersionId: version.id,
      status: "active",
      createdBy: userId,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      trashedAt: null,
      versions: [
        version as AssetDocument["versions"][number],
        ...(existing?.versions || []),
      ],
    };
    this.assets.set(item.id, item);
    return item;
  }

  async createDownloadUrl(versionId: string, userId: string) {
    const asset = [...this.assets.values()].find((item) =>
      item.versions.some((version) => version.id === versionId),
    );
    return asset && this.repository.owns(asset.projectId, userId)
      ? { url: `https://signed/asset-version/${versionId}` }
      : null;
  }

  async setCurrentVersion(assetId: string, versionId: string, userId: string) {
    const asset = this.assets.get(assetId);
    if (!asset || !this.repository.owns(asset.projectId, userId)) return null;
    asset.currentVersionId = versionId;
    return asset;
  }

  async trash(assetId: string, userId: string) {
    const asset = this.assets.get(assetId);
    if (!asset || !this.repository.owns(asset.projectId, userId)) return null;
    asset.status = "trashed";
    asset.trashedAt = new Date().toISOString();
    return asset;
  }

  async restore(assetId: string, userId: string) {
    const asset = this.assets.get(assetId);
    if (!asset || !this.repository.owns(asset.projectId, userId)) return null;
    asset.status = "active";
    asset.trashedAt = null;
    return asset;
  }

  async purge(assetId: string, userId: string) {
    const asset = this.assets.get(assetId);
    if (!asset || !this.repository.owns(asset.projectId, userId)) return null;
    if (asset.status !== "trashed")
      throw new DomainError("ASSET_NOT_TRASHED", "请先将素材移入回收站", 409);
    this.assets.delete(assetId);
    return { assetId, storageStatus: "completed" as const };
  }
}

function canvasWrite(expectedRevision: number): CanvasWrite {
  return {
    expectedRevision,
    contractVersion: 1,
    nodes: [
      {
        id: "story",
        type: "text",
        title: "故事",
        position: { x: 12, y: 24 },
        width: 320,
        height: 180,
        metadata: {},
        definitionId: "core.text",
        definitionVersion: 1,
        workflowKind: "generic",
        locked: false,
      },
    ],
    edges: [],
    viewport: { x: 10, y: 20, k: 1.2 },
    settings: { backgroundMode: "dots", showImageInfo: true },
  };
}
