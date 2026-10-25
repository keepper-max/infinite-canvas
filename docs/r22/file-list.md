# R2.2 文件清单

以R2.2开始前保存的35份工作区文件为基线；以下只列本轮新增或再次修改的文件。未把继承的R2.1文件算成本轮新开发。

## 正式服务端

- 新增 `server/api/src/knowledge-service.ts`
- 新增 `server/api/src/native-agent/context.ts`
- 新增 `server/api/src/native-agent/contracts.ts`
- 新增 `server/api/src/native-agent/conversation-policy.ts`
- 新增 `server/api/src/native-agent/creative-decisions.ts`
- 修改 `server/api/src/native-agent/model.ts`
- 新增 `server/api/src/native-agent/paid-model.ts`
- 修改 `server/api/src/native-agent/plan-service.ts`
- 修改 `server/api/src/native-agent/presentation.ts`
- 修改 `server/api/src/native-agent/routes.ts`
- 修改 `server/api/src/native-agent/service.ts`
- 新增 `server/api/src/native-agent/tools.ts`

## 正式前端

- 新增 `web/src/components/native-agent/creative-decisions.tsx`
- 修改 `web/src/components/native-agent/native-agent-panel.tsx`
- 修改 `web/src/components/native-agent/task-presentation.tsx`
- 新增 `web/src/components/native-agent/verified-reply.tsx`
- 修改 `web/src/services/api/native-agent.ts`

## 测试及隔离脚本

- 新增 `server/api/scripts/native-agent-r22-browser.mjs`
- 新增 `server/api/scripts/native-agent-r22-final-check.mts`
- 新增 `server/api/scripts/native-agent-r22-fixture.mts`
- 新增 `server/api/scripts/native-agent-r22-http-check.mts`
- 新增 `server/api/scripts/native-agent-r22-lab.mts`
- 新增 `server/api/scripts/native-agent-r22-multitab-browser.mjs`
- 新增 `server/api/scripts/native-agent-r22-optional-feature-check.mts`
- 新增 `server/api/scripts/native-agent-r22-policy-check.mts`
- 新增 `server/api/scripts/native-agent-r22-receipt-check.mts`
- 新增 `server/api/scripts/native-agent-r22-recovery-browser.mjs`
- 新增 `server/api/scripts/native-agent-r22-setup.mts`
- 新增 `server/api/tests/native-agent-conversation.test.ts`
- 修改 `server/api/tests/native-agent-presentation.test.ts`

## 文档

- 修改 `CHANGELOG.md`
- 修改 `docs/content/docs/progress/pending-test.mdx`
- 修改 `docs/content/docs/progress/todo.mdx`
- 新增 `docs/r22/delivery.md`
- 新增 `docs/r22/evaluation.md`
- 新增 `docs/r22/file-list.md`
- 新增 `docs/r22/findings.md`
- 新增 `docs/r22/progress.md`
- 新增 `docs/r22/references.md`
- 新增 `docs/r22/task_plan.md`

依赖、迁移：无新增。原用户website/content.js与基线SHA256一致。未暂存、提交、推送或部署。
