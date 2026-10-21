// Presentation aliases only: keep cases.json byte-for-byte identical to upstream.
export function presentCases(records) {
  return records.map((record) => ({
    id: record.id,
    title: `${record.company} · ${record.scenario}`,
    company: record.company,
    industry: record.industry,
    scenario: record.scenario,
    capabilities: record.components,
    background: record.case_summary,
    problem: record.problem,
    solution: record.solution,
    human: record.human,
    outcome: record.result,
    technology: record.architecture,
    conditions: record.reusable,
    limitations: record.verification_notes,
    source: {
      ...record.source_record,
      additional: record.additional_sources,
      originalAccessedAt: record.source_record.accessed_at,
      upstreamId: record.id,
      license:
        "MIT：仅限上游原创摘要及结构化整理；第三方原文、图片、报告不在此许可范围。",
    },
    record,
  }));
}
