import { createHash } from "node:crypto";

import { readConfig } from "../config.js";
import { createDatabase } from "./client.js";
import { S3ObjectStorage } from "../object-storage.js";
import { createVideoThumbnail } from "../video-thumbnail.js";

const config = readConfig();
const { pool } = createDatabase(config.databaseUrl);
const storage = new S3ObjectStorage(config.objectStorage);
const limitArgument = process.argv.find((value) => value.startsWith("--limit="));
const limit = Math.max(1, Math.min(10_000, Number(limitArgument?.slice("--limit=".length)) || 1_000));
let completed = 0;
let failed = 0;

try {
    await storage.ensureReady();
    const result = await pool.query(
        `select v.id, v.storage_key, v.mime_type
       from asset_versions v
       join assets a on a.id=v.asset_id
      where a.kind='video' and a.status='active' and v.thumbnail_storage_key is null
      order by v.created_at asc
      limit $1`,
        [limit],
    );
    for (const row of result.rows) {
        try {
            const source = await storage.get(String(row.storage_key));
            const thumbnail = await createVideoThumbnail(source, config.jobs.ffmpegPath, String(row.storage_key));
            const thumbnailStorageKey = `${row.storage_key}.thumbnail.jpg`;
            await storage.put(thumbnailStorageKey, thumbnail, "image/jpeg", createHash("sha256").update(thumbnail).digest("hex"));
            const updated = await pool.query(
                `update asset_versions
            set thumbnail_storage_key=$2,thumbnail_mime_type='image/jpeg',thumbnail_bytes=$3
          where id=$1 and thumbnail_storage_key is null`,
                [row.id, thumbnailStorageKey, thumbnail.byteLength],
            );
            completed += updated.rowCount || 0;
        } catch (error) {
            failed += 1;
            console.warn(`[video-thumbnail-backfill] failed version ${row.id}:`, error instanceof Error ? error.message : "unknown error");
        }
    }
    console.log(`[video-thumbnail-backfill] completed=${completed} failed=${failed} scanned=${result.rowCount || 0}`);
    if (failed) process.exitCode = 1;
} finally {
    await pool.end();
}
