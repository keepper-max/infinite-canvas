import { readdir, rm, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { Pool } from "pg";
import { AUTOCUT_LIMITS } from "./contract.js";

/** Losing a worker never means permission to repeat a paid model request. */
export async function recoverAutoCutTasks(pool: Pool, tempRoot: string) {
  const client = await pool.connect();
  try {
    for (const row of (
      await pool.query("select id from autocut_tasks where status='running'")
    ).rows) {
      const key = `autocut:${row.id}`;
      if (
        (
          await client.query(
            "select pg_try_advisory_lock(hashtextextended($1,0)) ok",
            [key],
          )
        ).rows[0].ok
      ) {
        try {
          await client.query(
            "update autocut_tasks set status='failed',error_code='AUTOCUT_WORKER_INTERRUPTED',error_message='Worker中断，保留原模型请求供手动重试',finished_at=now() where id=$1 and status='running'",
            [row.id],
          );
        } finally {
          await client.query(
            "select pg_advisory_unlock(hashtextextended($1,0))",
            [key],
          );
        }
      }
    }
    const root = resolve(tempRoot);
    for (const item of await readdir(root, { withFileTypes: true }).catch(
      () => [],
    )) {
      const id = /^task-([a-f0-9-]{36})-[A-Za-z0-9]+$/.exec(item.name)?.[1];
      if (!id || !item.isDirectory()) continue;
      const path = resolve(join(root, item.name));
      if (
        !path.startsWith(root + sep) ||
        Date.now() - (await stat(path)).mtimeMs < AUTOCUT_LIMITS.runtimeMs
      )
        continue;
      if (
        !(
          await pool.query(
            "select 1 from autocut_tasks where id=$1 and status in ('queued','running')",
            [id],
          )
        ).rowCount
      )
        await rm(path, { recursive: true, force: true });
    }
  } finally {
    client.release();
  }
}
