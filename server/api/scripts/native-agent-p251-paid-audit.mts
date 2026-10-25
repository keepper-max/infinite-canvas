import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createDatabase } from "../src/db/client.js";
const root = "H:/CodexStorage/shoushou-p251",
  result = JSON.parse(
    await readFile(root + "/artifacts/real-continuous-check.json", "utf8"),
  ),
  { pool } = createDatabase("postgres://p25@127.0.0.1:55485/p251_isolated");
try {
  const run = (
    await pool.query("select * from native_agent_runs where id=$1", [
      result.runId,
    ])
  ).rows[0];
  assert.equal(run.status, "completed");
  const requests = (
    await pool.query(
      "select id,input->'protocolRequest' request from native_agent_steps where run_id=$1 and kind='model' order by ordinal",
      [run.id],
    )
  ).rows;
  const texts = (v: any): string[] => {
    if (typeof v === "string") {
      try {
        const parsed = JSON.parse(v);
        if (parsed && typeof parsed === "object") return [v, ...texts(parsed)];
      } catch {}
      return [v];
    }
    return Array.isArray(v)
      ? v.flatMap(texts)
      : v && typeof v === "object"
        ? Object.values(v).flatMap(texts)
        : [];
  };
  const sources = [];
  for (const source of run.sources) {
    if (!source.documentId) continue;
    const version = (
      await pool.query(
        "select markdown,content_hash from knowledge_versions where document_id=$1 and revision=$2",
        [source.documentId, source.revision],
      )
    ).rows[0];
    assert.equal(version.content_hash, source.contentHash);
    assert.equal(
      createHash("sha256").update(version.markdown).digest("hex"),
      source.contentHash,
    );
    const ranges = source.ranges ?? [
      { start: 0, end: version.markdown.length },
    ];
    const requestIds = requests
      .filter((step) =>
        ranges.some((range: any) => {
          const snippet = version.markdown.slice(range.start, range.end);
          return texts(step.request?.messages ?? []).some((text) =>
            text.includes(snippet),
          );
        }),
      )
      .map((step) => step.id);
    assert.ok(requestIds.length);
    sources.push({
      documentId: source.documentId,
      title: source.title,
      revision: source.revision,
      contentHash: source.contentHash,
      ranges,
      modelRequestStepsContainingExactReadText: requestIds,
    });
  }
  assert.equal(sources.length, 3);
  const money = (
    await pool.query(
      "select count(*)::int calls,sum(u.cost_cny)::text supplierCny,sum(u.credit_points)::int chargedPoints,count(distinct m.job_id)::int uniqueJobs from native_agent_model_jobs m join generation_usage u on u.job_id=m.job_id where m.run_id=$1",
      [run.id],
    )
  ).rows[0];
  assert.equal(money.calls, 8);
  assert.equal(money.uniquejobs, 8);
  const total = (
    await pool.query(
      "select coalesce(sum(case when m.status='settled' then m.settled_cents else greatest(m.quote_cents,j.credits_reserved) end),0)::int cents from native_agent_model_jobs m join generation_jobs j on j.id=m.job_id where m.actor_id=$1",
      [run.actor_id],
    )
  ).rows[0];
  assert.ok(total.cents <= 100);
  const allNew = (
    await pool.query(
      "select r.id,r.status,r.error_code,r.rounds,r.spent_cents,r.reserved_cents from native_agent_runs r where r.actor_id=$1 and r.plan_protocol=1 order by r.created_at",
      [run.actor_id],
    )
  ).rows;
  const report = {
    runId: run.id,
    projectId: run.project_id,
    onePrompt: true,
    oneApproval: true,
    actualModel: "qwen3.5-flash",
    rounds: run.rounds,
    inputTokens: run.input_tokens,
    outputTokens: run.output_tokens,
    actualSupplierCny: money.suppliercny,
    chargedPoints: money.chargedpoints,
    verifiedJobs: money.uniquejobs,
    allAuthorizationUsedOrHeldCents: total.cents,
    authorizationCapCents: 100,
    unsettledOldRequestsRemainReserved: true,
    sources,
    allP251Trials: allNew,
  };
  await writeFile(
    root + "/artifacts/real-model-audit.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      rounds: run.rounds,
      supplierCny: money.suppliercny,
      chargedPoints: money.chargedpoints,
      authorizationUsedOrHeld: total.cents,
      sources: sources.length,
    }),
  );
} finally {
  await pool.end();
}
