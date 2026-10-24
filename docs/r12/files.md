# R1.2 源码与交付文件清单

正式仓库：`H:/CodexStorage/infinite-canvas-auth-upgrade`。以下只列本轮文件；没有提交或推送。

`website/content.js` 是执行期间出现的用户修改，保持原样，不属于本轮实现。

## 仓库文件

- [CHANGELOG.md](H:/CodexStorage/infinite-canvas-auth-upgrade/CHANGELOG.md)
- [docs/content/docs/progress/pending-test.mdx](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/content/docs/progress/pending-test.mdx)
- [docs/content/docs/progress/todo.mdx](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/content/docs/progress/todo.mdx)
- [docs/r12/deployment.md](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/r12/deployment.md)
- [docs/r12/files.md](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/r12/files.md)
- [docs/r12/findings.md](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/r12/findings.md)
- [docs/r12/interfaces.md](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/r12/interfaces.md)
- [docs/r12/progress.md](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/r12/progress.md)
- [docs/r12/quality-performance.md](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/r12/quality-performance.md)
- [docs/r12/README.md](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/r12/README.md)
- [docs/r12/task_plan.md](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/r12/task_plan.md)
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
- [server/document-converter/convert.mjs](H:/CodexStorage/infinite-canvas-auth-upgrade/server/document-converter/convert.mjs)
- [server/document-converter/Dockerfile](H:/CodexStorage/infinite-canvas-auth-upgrade/server/document-converter/Dockerfile)
- [server/document-converter/package-lock.json](H:/CodexStorage/infinite-canvas-auth-upgrade/server/document-converter/package-lock.json)
- [server/document-converter/package.json](H:/CodexStorage/infinite-canvas-auth-upgrade/server/document-converter/package.json)
- [server/document-converter/tests/converter.test.mjs](H:/CodexStorage/infinite-canvas-auth-upgrade/server/document-converter/tests/converter.test.mjs)
- [server/document-converter/tests/fixtures.mjs](H:/CodexStorage/infinite-canvas-auth-upgrade/server/document-converter/tests/fixtures.mjs)
- [web/src/pages/knowledge/editor/index.tsx](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/pages/knowledge/editor/index.tsx)
- [web/src/pages/knowledge/import-panel.tsx](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/pages/knowledge/import-panel.tsx)
- [web/src/pages/knowledge/index.tsx](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/pages/knowledge/index.tsx)
- [web/src/pages/knowledge/style.css](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/pages/knowledge/style.css)
- [web/src/services/api/knowledge-import.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/services/api/knowledge-import.ts)

## 仓库外隔离证据

- `H:/CodexStorage/shoushou-r12/artifacts`：测试日志、浏览器结果、截图、录屏、性能、备份恢复摘要。
- `H:/CodexStorage/shoushou-r12/fixtures`：固定DOCX/PDF/TXT/Markdown语料。
- `H:/CodexStorage/shoushou-r12/dev-api.mts`：本机专用合成账号登录入口，不发布到生产。
- `H:/CodexStorage/shoushou-r12/private`：隔离凭据及备份，禁止提交或公开。
- `H:/CodexStorage/shoushou-r12/artifacts/source-sha256.json`：本轮仓库文件内容校验和；排除清单自身和用户文件。
