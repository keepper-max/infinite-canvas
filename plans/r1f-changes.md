# R1-F 修改及新增文件清单

本清单相对于 R1-F 开始前冻结的 1092 个正式仓库文件；HEAD 保持 `6b71618d5aa8dc887809e338197e06c1b31112dd`，未提交/推送/建分支。没有丢失任何基线文件；未变化基线文件与原哈希一致。

## 正式仓库

- modified：`plans/r1-release-readiness.md`
- modified：`plans/r1-release-runbook.md`
- added：`plans/r1f-changes.md`
- added：`plans/r1f-delivery.md`
- added：`plans/r1f-release-checklist.md`
- added：`plans/r1f-runtime-contracts.md`
- added：`plans/r1f-validation.md`
- added：`server/api/db/migrations/0048_release_write_guards.sql`
- added：`server/api/src/canvas-write-capability.ts`
- added：`server/api/src/knowledge-feature.ts`
- modified：`server/api/src/knowledge-service.ts`
- added：`server/api/src/provider-submission.ts`
- modified：`server/api/tests/knowledge-canvas.integration.test.ts`
- added：`server/api/tests/knowledge-fixture.ts`
- modified：`server/api/tests/knowledge-graph.integration.test.ts`
- modified：`server/api/tests/knowledge.integration.test.ts`
- added：`server/api/tests/release-guards.integration.test.ts`
- modified：`server/api/src/app.ts`
- modified：`server/api/src/billing-service.ts`
- modified：`server/api/src/canvas-contract.ts`
- modified：`server/api/src/domain.ts`
- modified：`server/api/src/index.ts`
- modified：`server/api/src/job-service.ts`
- modified：`server/api/src/repository.ts`
- modified：`web/src/services/api/canvas.ts`
- modified：`web/src/services/api/jobs.ts`

## 私有 MCP 候选源码

- `H:/代码相关/项目/漫剧工作流/scripts/mock-worker.ts`
- `H:/代码相关/项目/漫剧工作流/scripts/shoushou-mcp-server.ts`

## 证据与依赖

没有新增 npm 依赖或修改依赖锁。迁移0048只增量添加表/列，不修改0045–0047。S0/P1/P1.5/P2其他原始工作区修改不归为本轮代码。

增量补丁、逐文件前后SHA256、原始源码副本：`H:/CodexStorage/shoushou-r1f/artifacts/r1f-increment.patch`、`r1f-file-manifest.json`、实验目录 baseline/ 和 mcp-baseline/。补丁只含源码/测试/交付文档，不包含 runtime.env、登录状态、数据库或对象备份。

实验环境脚本、测试证据、截图和私有备份全部位于 `H:/CodexStorage/shoushou-r1f`；实验脚本完整列表单独保存为 artifacts/lab-files.json。已安装 MCP bundle 不变。
