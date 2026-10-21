import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { safeSource } from "./core.mjs";
import { presentCases } from "./present.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const records = JSON.parse(
  fs.readFileSync(path.join(root, "cases.json"), "utf8"),
);
const cases = presentCases(records);
const ids = new Set();
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
for (const c of cases) {
  if (!/^[a-z0-9-]+$/.test(c.id) || ids.has(c.id))
    throw new Error("案例 ID 无效或重复");
  ids.add(c.id);
  for (const key of [
    "title",
    "company",
    "industry",
    "scenario",
    "background",
    "problem",
    "solution",
    "human",
    "outcome",
  ]) {
    if (typeof c[key] !== "string" || !c[key].trim())
      throw new Error(`${c.id}: 缺少 ${key}`);
  }
  for (const key of [
    "capabilities",
    "technology",
    "conditions",
    "limitations",
  ]) {
    if (
      !Array.isArray(c[key]) ||
      !c[key].length ||
      c[key].some((v) => typeof v !== "string" || !v.trim())
    )
      throw new Error(`${c.id}: ${key} 无效`);
  }
  for (const key of ["title", "publisher", "license", "upstreamId"])
    if (!c.source?.[key]) throw new Error(`${c.id}: 缺少来源 ${key}`);
  for (const key of ["originalAccessedAt"])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.source[key]))
      throw new Error(`${c.id}: 日期无效`);
  for (const source of [c.source, ...c.source.additional])
    if (!safeSource(source.url) || !source.title)
      throw new Error(`${c.id}: 来源链接无效`);
  // Several distinct upstream cases intentionally cite the same report.
}
// Refuse to silently retain publicly addressable pages after an ID is removed.
const orphan = fs
  .readdirSync(root, { withFileTypes: true })
  .find(
    (entry) =>
      entry.isDirectory() &&
      !ids.has(entry.name) &&
      fs.existsSync(path.join(root, entry.name, "index.html")),
  );
if (orphan)
  throw new Error(
    `发现已下架的旧详情 ${orphan.name}，请先备份并移出公开目录后再构建。`,
  );

const brand =
  '<a class="brand" href="/"><img src="/website-assets/20261016-site01/brand-logo.png" width="40" height="40" alt="">守密人<small>APPLIED AI</small></a>';
const header = `<a class="skip-link" href="#main">跳至主要内容</a><header class="nav pad">${brand}<nav class="navlinks" aria-label="主导航"><a href="/#frontier">前沿资讯</a><a href="/#projects">项目实践</a><a href="/ai-cases/" aria-current="location">企业 AI 案例库</a><a href="/#services">咨询服务</a></nav><a class="action" href="https://canvas.shoumiren.online" target="_blank" rel="noopener noreferrer">进入画布 ↗</a></header><nav class="mobile-nav pad" aria-label="栏目导航"><a href="/">首页</a><a href="/ai-cases/" aria-current="location">企业 AI 案例库</a><a href="/#contact">联系与合作</a></nav>`;
const footer =
  '<footer class="footer pad"><span>守密人 · AI 应用咨询与产品实践</span><a href="/#contact">联系与合作 ↗</a></footer>';
const consult =
  '<aside class="consult"><div><h2>让案例成为你下一步的参考。</h2><p>从业务问题、现有资料和可验证的目标开始。</p></div><a class="action solid" href="/#contact">咨询类似方案 ↗</a></aside>';
function page(title, description, route, content, script = "") {
  return `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f6faff"><title>${esc(title)} · 守密人</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="https://shoumiren.online${route}"><meta property="og:type" content="${route === "/ai-cases/" ? "website" : "article"}"><meta property="og:title" content="${esc(title)} · 守密人"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="https://shoumiren.online${route}"><meta property="og:image" content="https://shoumiren.online/website-assets/20261016-site01/brand-logo.png"><meta name="twitter:card" content="summary"><link rel="icon" href="/website-assets/20261016-site01/brand-logo.png"><link rel="stylesheet" href="/ai-cases/cases.css">${script}</head><body>${header}<main id="main" class="pad" tabindex="-1">${content}</main>${footer}</body></html>\n`;
}
const card = (c) =>
  `<article class="case-card" data-case-id="${c.id}"><div class="case-meta">${esc(c.industry)}<span>${esc(c.scenario)}</span></div><h2><a href="/ai-cases/${c.id}/">${esc(c.title)}<span aria-hidden="true"> ↗</span></a></h2><p class="company">${esc(c.company)} · 公开案例</p><dl><dt>业务问题</dt><dd>${esc(c.problem)}</dd><dt>解决方案</dt><dd>${esc(c.solution)}</dd><dt>成果（来源方披露）</dt><dd>${esc(c.outcome)}</dd></dl><ul class="tags" aria-label="AI 能力">${c.capabilities.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></article>`;
const select = (key, label, values) =>
  `<div><label for="${key}">${label}</label><select id="${key}" name="${key}"><option value="">全部${label}</option>${[...new Set(values)].map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("")}</select></div>`;
const description =
  "按行业、业务场景与 AI 能力，了解企业解决了什么问题、如何实施，以及成果与局限。";
const list = `<section class="intro"><h1>企业 AI 案例库</h1><p class="lead">从业务问题出发，看 AI 如何落地。</p><p>${description}</p><p class="reading-note">公开资料整理，供方案研究参考；所列企业并非我们的客户。</p></section><section aria-label="查找案例"><form id="case-filters" action="/ai-cases/" method="get"><div class="search"><label for="q">关键词搜索</label><div class="search-input"><input id="q" name="q" type="search" autocomplete="off" placeholder="例如：包装、库存、知识检索…"><button class="action solid" type="submit">搜索案例</button></div></div><div class="filters">${select(
  "industry",
  "行业",
  cases.map((c) => c.industry),
)}${select(
  "scenario",
  "业务场景",
  cases.map((c) => c.scenario),
)}${select(
  "capability",
  "AI 能力",
  cases.flatMap((c) => c.capabilities),
)}<a class="clear" id="clear-filters" href="/ai-cases/">清空条件</a></div></form><p id="case-status" role="status" aria-live="polite">共 ${cases.length} 个案例</p><div id="case-error" role="alert" hidden><p>筛选暂时不可用，你仍可阅读下方案例。</p><a href="/ai-cases/">重新加载案例库</a></div><noscript><p>已显示全部案例。启用 JavaScript 后可使用搜索、筛选与分页。</p></noscript><div id="case-results" class="case-grid">${cases.map(card).join("\n")}</div><div id="empty-results" class="empty" hidden><h2>没有找到符合条件的案例</h2><p>试试更宽泛的关键词，或清空筛选条件。</p><a class="action" href="/ai-cases/">查看全部案例</a></div><nav id="pagination" class="pagination" aria-label="案例分页"></nav></section>${consult}`;
fs.writeFileSync(
  path.join(root, "index.html"),
  page(
    "企业 AI 案例库",
    description,
    "/ai-cases/",
    list,
    '<script type="module" src="/ai-cases/list.mjs"></script>',
  ),
);
const bullets = (values) =>
  `<ul>${values.map((v) => `<li>${esc(v)}</li>`).join("")}</ul>`;
const sourceLink = (s) =>
  `<a href="${esc(safeSource(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a>`;
const fieldLabels = {
  id: "案例编号",
  source: "来源",
  company: "企业",
  industry: "行业",
  scenario: "业务场景",
  fde: "FDE分类",
  problem: "业务问题",
  solution: "解决方案",
  human: "人员责任",
  result: "成果",
  maturity: "成熟度说明",
  url: "原始来源",
  architecture: "技术工作流",
  components: "技术组成",
  fde_actions: "实施动作",
  reusable: "可复用经验",
  evidence: "证据说明",
  case_summary: "案例概述",
  industry_group: "行业分组",
  maturity_stage: "成熟阶段",
  fde_relation: "FDE关联",
  evidence_level: "证据等级",
  evidence_label: "证据等级说明",
  source_record: "来源记录",
  analysis_boundary: "分析边界",
  verification_notes: "核验说明",
  additional_sources: "补充来源",
  detail_score: "详细度得分",
  detail_level: "详细度分类",
  detail_label: "详细度说明",
  detail_dimensions: "详细度维度",
  missing_details: "未披露细节",
  technical_reference: "技术方案参考",
  title: "标题",
  publisher: "发布方",
  source_type: "来源类型",
  directness: "定位范围",
  claim_origin: "结果披露方",
  independently_verified: "独立核验",
  accessed_at: "查阅日期",
  collection_title: "合集名称",
  case_number: "案例序号",
  printed_page: "印刷页码",
  pdf_page: "PDF页码",
  business_problem: "业务问题",
  business_context: "业务背景",
  solution_workflow: "方案流程",
  technical_workflow: "技术工作流",
  human_governance: "人机与治理",
  measured_outcome: "量化结果",
  source_traceability: "来源可追溯",
};
function recordValue(value) {
  if (Array.isArray(value))
    return value.length
      ? "<ul>" +
          value.map((v) => "<li>" + recordValue(v) + "</li>").join("") +
          "</ul>"
      : "无";
  if (value && typeof value === "object") return recordFields(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string" && safeSource(value))
    return sourceLink({ title: value, url: value });
  return esc(value ?? "未披露");
}
function recordFields(record) {
  return (
    '<dl class="original-record">' +
    Object.entries(record)
      .map(
        ([key, value]) =>
          "<dt>" +
          esc(fieldLabels[key] || key) +
          "</dt><dd>" +
          recordValue(value) +
          "</dd>",
      )
      .join("") +
    "</dl>"
  );
}
for (const c of cases) {
  const route = `/ai-cases/${c.id}/`;
  const content = `<nav class="breadcrumb" aria-label="面包屑"><a href="/">首页</a><span aria-hidden="true">/</span><a id="back-to-cases" href="/ai-cases/">企业 AI 案例库</a></nav><article class="case-detail"><header class="detail-heading"><p class="case-meta">${esc(c.industry)} · ${esc(c.scenario)}</p><h1>${esc(c.title)}</h1><p>${esc(c.company)} · 公开案例</p><p class="reading-note">依据公开资料整理，所列企业并非我们的客户；不构成收益承诺。</p></header><div class="detail-layout"><div class="prose"><section id="background"><h2>业务背景</h2><p>${esc(c.background)}</p></section><section id="problem"><h2>核心痛点</h2><p>${esc(c.problem)}</p></section><section id="solution"><h2>实施方案</h2><p>${esc(c.solution)}</p><p>${esc(c.human)}</p></section><section id="technology"><h2>技术组成</h2><p class="annotation">以下为编辑归纳，仅供方案讨论；不代表企业已公开确认的完整架构。</p>${bullets(c.technology)}</section><section id="conditions"><h2>可复用经验</h2><p class="annotation">保留来源项目的经验归纳，适用条件仍需结合自身业务评估。</p>${bullets(c.conditions)}</section><section id="outcomes"><h2>成果及局限</h2><p>${esc(c.outcome)}</p>${bullets(c.limitations)}</section><section id="record"><h2>完整案例资料</h2><details><summary>展开原始案例记录</summary>${recordFields(c.record)}</details></section><section class="sources" id="sources"><h2>来源与核验</h2><p>${sourceLink(c.source)}</p>${c.source.additional.length ? "<details><summary>补充来源</summary><ul>" + c.source.additional.map((s) => `<li>${sourceLink(s)}</li>`).join("") + "</ul></details>" : ""}<p>${esc(c.source.publisher)} · 上游查阅日期 <time datetime="${c.source.originalAccessedAt}">${c.source.originalAccessedAt}</time></p><p>${esc(c.record.source_record.claim_origin)}；未逐条重新核验原始资料，不代表独立审计。</p><p>摘要参考 ${sourceLink({ title: "FDE-case-library（" + c.id + "）", url: "https://github.com/guminghao-avi/FDE-case-library/tree/ef5501231b60539e91c770437a2bfd7c60d65277" })}。Copyright (c) 2026 guminghao-avi contributors · <a href="/ai-cases/LICENSE-FDE.txt">MIT 许可证全文</a>。</p><p>${esc(c.source.license)}</p></section></div><aside class="detail-aside"><h2>阅读导航</h2><nav aria-label="本文目录">${[
    ["background", "业务背景"],
    ["problem", "核心痛点"],
    ["solution", "实施方案"],
    ["technology", "技术组成"],
    ["conditions", "可复用经验"],
    ["outcomes", "成果及局限"],
    ["record", "完整案例资料"],
    ["sources", "来源与核验"],
  ]
    .map(([id, label]) => `<a href="#${id}">${label}</a>`)
    .join(
      "",
    )}</nav><a class="action solid" href="/#contact">咨询类似方案 ↗</a></aside></div></article>${consult}`;
  fs.mkdirSync(path.join(root, c.id), { recursive: true });
  fs.writeFileSync(
    path.join(root, c.id, "index.html"),
    page(
      c.title,
      c.problem,
      route,
      content,
      '<script type="module" src="/ai-cases/detail.mjs"></script>',
    ),
  );
}
fs.writeFileSync(
  path.join(root, "404.html"),
  page(
    "案例未找到",
    "该案例不存在或链接已变更，请返回案例库重新查找。",
    "/ai-cases/",
    '<section class="intro"><h1>暂时找不到这个案例</h1><p>链接可能已变更，请返回案例库重新查找。</p><a class="action" href="/ai-cases/">返回企业 AI 案例库</a></section>',
  ),
);
console.log(`已校验并生成 ${cases.length} 个案例详情、列表与异常页面。`);
