/** Read-only verification of a NEW isolated restore target, never production. */
import pg from "pg";
import { readFile, writeFile } from "node:fs/promises";
const root = "H:/CodexStorage/shoushou-p25";
const f = JSON.parse(
  await readFile(root + "/private/paid-fixture.json", "utf8"),
);
const pools = ["p25_isolated", "p25_restore_final_20261024"].map(
  (name) =>
    new pg.Pool({ connectionString: "postgres://p25@127.0.0.1:55485/" + name }),
);
const runScope =
  "run_id in(select id from native_agent_runs where actor_id=$1)";
const tables: Record<string, [string, string | null]> = {
  platform_schema_migrations: ["true", null],
  native_agent_sessions: ["actor_id=$1", f.ownerId],
  native_agent_runs: ["actor_id=$1", f.ownerId],
  native_agent_steps: [runScope, f.ownerId],
  native_agent_messages: [runScope, f.ownerId],
  native_agent_approvals: ["actor_id=$1", f.ownerId],
  native_agent_usage: [runScope, f.ownerId],
  native_agent_events: [runScope, f.ownerId],
  native_agent_model_jobs: ["actor_id=$1", f.ownerId],
  canvas_nodes: ["project_id=$1", f.projectId],
  canvas_edges: ["project_id=$1", f.projectId],
  canvas_snapshots: ["project_id=$1", f.projectId],
  knowledge_documents: ["space_id=$1", f.spaceId],
  knowledge_versions: [
    "document_id in(select id from knowledge_documents where space_id=$1)",
    f.spaceId,
  ],
};
try {
  const checks = [];
  for (const [table, [where, arg]] of Object.entries(tables)) {
    const query = `select count(*)::int count,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) hash from ${table} t where ${where}`;
    const [original, restored] = await Promise.all(
      pools.map(
        async (pool) => (await pool.query(query, arg ? [arg] : [])).rows[0],
      ),
    );
    checks.push({
      table,
      original,
      restored,
      match: JSON.stringify(original) === JSON.stringify(restored),
    });
  }
  const passed = checks.every((c) => c.match);
  await writeFile(
    root + "/artifacts/restore-final.json",
    JSON.stringify(
      {
        isolatedOnly: true,
        target: "p25_restore_final_20261024",
        scope:
          "Stable dedicated real-model actor/project; unrelated browser rows can postdate backup.",
        passed,
        checks,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed, tables: checks.length }));
  if (!passed) process.exitCode = 1;
} finally {
  await Promise.all(pools.map((pool) => pool.end()));
}
