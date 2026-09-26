import assert from "node:assert/strict";
import test from "node:test";

import { PostgresAssetService } from "../src/asset-service.js";
import { createDatabase } from "../src/db/client.js";
import { applyMigrations } from "../src/db/migrate.js";
import { DomainError } from "../src/domain.js";
import type { ObjectStorage, StoredObjectDownload } from "../src/object-storage.js";
import { StorageQuotaService } from "../src/storage-quota-service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("storage quota serializes concurrent reservations and exempts admins", { skip: !databaseUrl }, async () => {
  const { pool } = createDatabase(databaseUrl!);
  const userId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  try {
    await applyMigrations(pool);
    await pool.query(
      `insert into users(id,email,password_hash,is_admin) values($1,$2,'test',false),($3,$4,'test',true)`,
      [userId, `quota-${userId}@example.com`, adminId, `quota-admin-${adminId}@example.com`],
    );
    const quota = new StorageQuotaService(pool, 1_000);
    const results = await Promise.allSettled([
      quota.reserve(userId, 600, `test:${userId}:a`),
      quota.reserve(userId, 600, `test:${userId}:b`),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.ok(rejected.reason instanceof DomainError);
    assert.equal(rejected.reason.code, "STORAGE_QUOTA_EXCEEDED");

    await quota.reserve(adminId, 10_000, `test:${adminId}:unlimited`);
    const adminUsage = await quota.getUsage(adminId);
    assert.equal(adminUsage.unlimited, true);
    assert.equal(adminUsage.quotaBytes, null);
  } finally {
    await pool.query("delete from users where id=any($1::uuid[])", [[userId, adminId]]).catch(() => undefined);
    await pool.end();
  }
});

test("unused generated assets are trashed while referenced assets are protected", { skip: !databaseUrl }, async () => {
  const { db, pool } = createDatabase(databaseUrl!);
  const userId = crypto.randomUUID();
  try {
    await applyMigrations(pool);
    const user = await pool.query(
      "insert into users(id,email,password_hash) values($1,$2,'test') returning id",
      [userId, `cleanup-${userId}@example.com`],
    );
    const project = await pool.query(
      "insert into projects(owner_id,name) values($1,'cleanup') returning id",
      [user.rows[0].id],
    );
    const assetIds: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const asset = await pool.query(
        `insert into assets(project_id,kind,name,created_by,updated_at)
         values($1,'image',$2,$3,now() - interval '31 days') returning id`,
        [project.rows[0].id, `generated-${index}`, userId],
      );
      const version = await pool.query(
        `insert into asset_versions(asset_id,version,storage_key,mime_type,bytes,sha256,source,created_by)
         values($1,1,$2,'image/png',10,$3,'generation',$4) returning id`,
        [asset.rows[0].id, `tests/${asset.rows[0].id}`, `sha-${index}`, userId],
      );
      await pool.query("update assets set current_version_id=$2 where id=$1", [asset.rows[0].id, version.rows[0].id]);
      assetIds.push(asset.rows[0].id);
      if (index === 1)
        await pool.query(
          "insert into asset_links(project_id,asset_version_id,role) values($1,$2,'reference')",
          [project.rows[0].id, version.rows[0].id],
        );
    }
    const service = new PostgresAssetService(db, new NoopObjectStorage(), pool);
    assert.equal(await service.trashUnusedGenerated(30), 1);
    const statuses = await pool.query("select id,status from assets where id=any($1::uuid[]) order by id", [assetIds]);
    assert.equal(statuses.rows.find((row) => row.id === assetIds[0])?.status, "trashed");
    assert.equal(statuses.rows.find((row) => row.id === assetIds[1])?.status, "active");
  } finally {
    await pool.query("delete from users where id=$1", [userId]).catch(() => undefined);
    await pool.end();
  }
});

class NoopObjectStorage implements ObjectStorage {
  async ensureReady() {}
  async createUploadUrl() { return { url: "http://unused", headers: {} }; }
  async createDownloadUrl() { return "http://unused"; }
  async stat() { return null; }
  async get() { return new Uint8Array(); }
  async openDownload(): Promise<StoredObjectDownload> { throw new Error("unused"); }
  async put(_storageKey: string, body: Uint8Array, mimeType: string, sha256: string) {
    return { bytes: body.byteLength, mimeType, sha256 };
  }
  async delete() {}
}
