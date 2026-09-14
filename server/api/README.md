# 平台 API

平台 API 负责邮箱账号、服务端 Session、项目成员权限和默认草稿空间。浏览器只持有 HttpOnly Cookie，不保存 Session Token 明文。

## 迁移

API 启动时会按文件名顺序执行 `db/migrations` 中尚未应用的 SQL，并把文件名及 SHA-256 写入 `platform_schema_migrations`。已经应用的迁移不得修改；校验和变化时服务会拒绝启动。

`0006_platform_api_auth.sql` 是增量迁移：保留原有业务表和数据，补齐默认项目字段、项目成员关系和每项目唯一画布记录。生产执行前必须再次完成 PostgreSQL 全库备份。

`0007_canvas_persistence.sql` 增加结构化节点、端口连线、画布设置、历史快照和旧数据迁移台账。保存接口使用 `expectedRevision` 做乐观并发控制，冲突返回 `CANVAS_REVISION_CONFLICT`，不会覆盖较新的云端版本。

`0008_asset_versions.sql` 在兼容旧 `assets` 表的前提下增加不可变版本、画布引用、上传台账和回收站。旧资产文件字段会迁移为 v1，旧列保留但不再作为新链路的权威来源。

`0016_admin_billing.sql` 增加账号状态、首次模型请求 Trace、重试来源和实际消耗流水。历史任务没有首次 Trace，不会用视频资源 ID 猜测费用；生产执行前同样必须完成 PostgreSQL 全库备份。

管理员接口统一位于 `/api/admin/*`，每个接口独立校验管理员身份。涵盖概览、账号启停与会话撤销、消耗、任务与手动对账、模型状态、项目只读排障、素材临时下载和审计日志；不会返回 API Key、Authorization 或完整供应商请求。

Worker 在生成任务进入终态后读取 `GET /v1/billing/{request_id}`。404 按退避计划继续同步，最长 24 小时；对账只更新账单状态，不重新提交模型任务，也不修改生成结果。

画布接口：

- `GET/PUT /api/projects/:projectId/canvas`
- `GET /api/projects/:projectId/canvas/snapshots`
- `POST /api/projects/:projectId/canvas/snapshots/:version/restore`
- `POST /api/projects/:projectId/canvas/migrations/indexeddb`

旧 IndexedDB 迁移只上传结构化 JSON。内嵌图片、视频、音频数据以及 API Key、Token、渠道、代理和 WebDAV 配置会被排除，原 IndexedDB 数据不会自动删除。

资产接口：

- `GET /api/projects/:projectId/assets`
- `POST /api/projects/:projectId/assets/uploads`
- `POST /api/projects/:projectId/assets/uploads/:uploadId/complete`
- `GET /api/asset-versions/:versionId/download`
- `PATCH /api/assets/:assetId/current-version`
- `POST /api/assets/:assetId/trash`、`POST /api/assets/:assetId/restore`

浏览器通过短期签名地址直传对象存储，服务端完成时核验文件大小、类型和 SHA-256。数据库只保存对象键，不保存会过期的下载 URL。开发环境把 `OBJECT_STORAGE_ENDPOINT` 指向 Compose 内的 MinIO，把 `OBJECT_STORAGE_PUBLIC_ENDPOINT` 指向浏览器可访问地址；生产 OSS 使用其 S3 兼容 endpoint，并将 `OBJECT_STORAGE_FORCE_PATH_STYLE=false`、`OBJECT_STORAGE_AUTO_CREATE_BUCKET=false`。

## 回滚

推荐恢复部署前的完整数据库备份，这是包含数据状态的可靠回滚路径。仅需撤回新增结构时，可在确认备份有效后按逆序手动执行 `db/rollback/0008_asset_versions.down.sql`、`db/rollback/0007_canvas_persistence.down.sql` 和 `db/rollback/0006_platform_api_auth.down.sql`。

回滚脚本会删除 `canvases` 表及本次新增的项目字段和索引，因此不得由应用自动执行，也不能在没有新备份时直接运行。

## 本地检查

```bash
npm run typecheck
npm test
npm run build
```

设置独立测试库的 `TEST_DATABASE_URL` 后，测试会额外执行真实 PostgreSQL 迁移、Session 持久化、默认项目幂等和跨用户项目隔离检查。
