# R1.2 源码与交付文件清单

正式仓库：`H:/CodexStorage/infinite-canvas-auth-upgrade`。用户已授权提交、推送和部署，最终版本v0.16.35。

`website/content.js`属于用户已有修改，保留原样，未提交或部署。

## 本轮仓库文件

- [CHANGELOG.md](H:/CodexStorage/infinite-canvas-auth-upgrade/CHANGELOG.md)
- [VERSION](H:/CodexStorage/infinite-canvas-auth-upgrade/VERSION)
- [docs/content/docs/progress/pending-test.mdx](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/content/docs/progress/pending-test.mdx)
- [docs/content/docs/progress/todo.mdx](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/content/docs/progress/todo.mdx)
- [docs/r12/README.md](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/r12/README.md)
- [docs/r12/deployment.md](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/r12/deployment.md)
- [docs/r12/files.md](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/r12/files.md)
- [docs/r12/findings.md](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/r12/findings.md)
- [docs/r12/interfaces.md](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/r12/interfaces.md)
- [docs/r12/progress.md](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/r12/progress.md)
- [docs/r12/quality-performance.md](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/r12/quality-performance.md)
- [docs/r12/task_plan.md](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/r12/task_plan.md)
- [ops/releases/v0.16.34.md](H:/CodexStorage/infinite-canvas-auth-upgrade/ops/releases/v0.16.34.md)
- [ops/releases/v0.16.35.md](H:/CodexStorage/infinite-canvas-auth-upgrade/ops/releases/v0.16.35.md)
- [server/api/db/migrations/0049_knowledge_imports.sql](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/db/migrations/0049_knowledge_imports.sql)
- [server/api/package.json](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/package.json)
- [server/api/src/app.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/app.ts)
- [server/api/src/db/knowledge-schema.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/db/knowledge-schema.ts)
- [server/api/src/index.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/index.ts)
- [server/api/src/knowledge-import-queue.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/knowledge-import-queue.ts)
- [server/api/src/knowledge-import-routes.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/knowledge-import-routes.ts)
- [server/api/src/knowledge-import-sandbox.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/knowledge-import-sandbox.ts)
- [server/api/src/knowledge-import-service.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/knowledge-import-service.ts)
- [server/api/src/knowledge-import-worker.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/knowledge-import-worker.ts)
- [server/api/src/knowledge-routes.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/knowledge-routes.ts)
- [server/api/src/knowledge-service.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/knowledge-service.ts)
- [server/api/src/storage-quota-service.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/storage-quota-service.ts)
- [server/api/tests/knowledge-import-regression.integration.test.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/tests/knowledge-import-regression.integration.test.ts)
- [server/api/tests/knowledge-import-sandbox.test.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/tests/knowledge-import-sandbox.test.ts)
- [server/api/tests/knowledge-import.integration.test.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/tests/knowledge-import.integration.test.ts)
- [server/document-converter/.dockerignore](H:/CodexStorage/infinite-canvas-auth-upgrade/server/document-converter/.dockerignore)
- [server/document-converter/Dockerfile](H:/CodexStorage/infinite-canvas-auth-upgrade/server/document-converter/Dockerfile)
- [server/document-converter/convert.mjs](H:/CodexStorage/infinite-canvas-auth-upgrade/server/document-converter/convert.mjs)
- [server/document-converter/package-lock.json](H:/CodexStorage/infinite-canvas-auth-upgrade/server/document-converter/package-lock.json)
- [server/document-converter/package.json](H:/CodexStorage/infinite-canvas-auth-upgrade/server/document-converter/package.json)
- [server/document-converter/tests/converter.test.mjs](H:/CodexStorage/infinite-canvas-auth-upgrade/server/document-converter/tests/converter.test.mjs)
- [server/document-converter/tests/fixtures.mjs](H:/CodexStorage/infinite-canvas-auth-upgrade/server/document-converter/tests/fixtures.mjs)
- [web/src/pages/knowledge/editor/index.tsx](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/pages/knowledge/editor/index.tsx)
- [web/src/pages/knowledge/import-panel.tsx](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/pages/knowledge/import-panel.tsx)
- [web/src/pages/knowledge/index.tsx](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/pages/knowledge/index.tsx)
- [web/src/pages/knowledge/style.css](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/pages/knowledge/style.css)
- [web/src/services/api/knowledge-import.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/services/api/knowledge-import.ts)

## 仓库外证据

- `H:/CodexStorage/shoushou-r12`：隔离服务、固定语料、性能、浏览器与回归证据；private目录禁止公开。
- `H:/CodexStorage/shoushou-r12-release/artifacts`：生产预检、备份恢复、迁移预演/执行、镜像清单、公网测试与会话撤销结果。
- `H:/CodexStorage/shoushou-r12-release/private`：受控备份、凭据和原始诊断，禁止提交或分享。
- 最终生产步骤及回退见 `ops/releases/v0.16.35.md`；不把主浏览器脚本的CDP缓存故障算成整套通过。
