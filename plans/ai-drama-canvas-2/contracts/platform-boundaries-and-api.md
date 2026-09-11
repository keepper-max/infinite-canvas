# 平台边界与 API 契约

## 服务职责

### Web

- 渲染 Infinite Canvas、项目、资产和任务界面。
- 使用 HttpOnly Session Cookie 调用平台 API。
- IndexedDB 仅缓存画布和待迁移旧数据。
- 不持有全局模型密钥，不直接调用 Provider，不负责后台轮询。

### API

- 注册登录、Session、用户与项目成员权限。
- 项目、画布事务保存、资产元数据、任务创建/取消/重试。
- 生成预签名上传地址，提供 SSE 事件。
- 校验输入并创建不可变任务快照；不执行耗时生成和 FFmpeg。

### Worker

- 消费 BullMQ 任务并执行模型提交、轮询、取消、下载和转存。
- 更新 PostgreSQL 状态并发布 Redis 事件。
- 执行 FFmpeg 合成、转码、封面和字幕任务。
- 通过并发、超时、临时目录配额和心跳保护 ECS。

### PostgreSQL

- 用户、Session、项目权限、画布权威快照、资产版本、任务和事件权威数据。
- 不保存大二进制文件和明文密钥。

### Redis

- BullMQ 队列、并发锁和短期事件分发。
- Redis 丢失后可从 PostgreSQL 重建待执行任务；它不是业务数据权威。

### MinIO/OSS

- 保存上传与生成的图片、视频、音频、字幕和导出包。
- 开发默认 MinIO；生产默认 OSS，业务代码只依赖统一 `ObjectStorage` 接口。
- 数据库保存稳定 `storageKey`，短时访问使用预签名 URL。

## 目标目录

在现有仓库内渐进增加，不移动现有 `web`：

```text
web/                         # 现有 Vite/React 前端
server/
  api/                       # HTTP、鉴权、SSE
  worker/                    # BullMQ、Provider 轮询、FFmpeg
packages/
  contracts/                 # 跨端 DTO、状态和校验 schema
  db/                        # Drizzle schema、迁移、查询
  model-gateway/             # 模型注册、参数编译、Provider 适配
  object-storage/            # MinIO/OSS 统一接口
infra/
  docker/                    # 容器入口、健康检查
  nginx/                     # SPA 回退、API/SSE 转发
```

第 1 部分先建立最小 workspace 和服务骨架；不得一次性重写现有前端目录。

## Docker 服务

- `web`：静态前端与反向代理入口。
- `api`：无状态平台 API，依赖 PostgreSQL 和 Redis。
- `worker`：后台任务，依赖 PostgreSQL、Redis 和对象存储；镜像包含 FFmpeg。
- `db`：PostgreSQL 16，持久卷。
- `redis`：Redis 7，持久化只用于队列恢复，不代替数据库。
- `minio`：仅本地/开发默认启用；生产可通过配置切到 OSS。

所有服务提供独立健康检查。Web 只有在 API 可用时才显示“云端已同步”，Worker 异常不阻止登录和读取既有画布。

## ER 草图

```text
users 1 ── * sessions
users 1 ── * project_members * ── 1 projects
projects 1 ── * canvas_nodes
projects 1 ── * canvas_edges
projects 1 ── * canvas_snapshots
projects 1 ── * assets 1 ── * asset_versions
projects 1 ── * generation_jobs 1 ── * job_attempts
generation_jobs 1 ── * job_events
generation_jobs 1 ── * job_artifacts * ── 1 asset_versions
canvas_nodes * ── * asset_versions      (node_asset_bindings)
generation_jobs * ── * asset_versions   (job_input_references)
```

关键约束：

- 所有项目子表都直接保存 `project_id`，权限查询不依赖跨多层推断。
- `project_members(project_id, user_id)` 唯一。
- `canvas_nodes(project_id, node_id)`、`canvas_edges(project_id, edge_id)` 唯一。
- `asset_versions(asset_id, version)` 唯一，`storage_key` 唯一。
- `generation_jobs(project_id, idempotency_key)` 唯一。
- Session Token 只保存哈希；用户密码只保存 Argon2id 哈希。

## API 响应

成功响应：

```ts
type ApiSuccess<T> = {
  data: T;
  meta?: { requestId: string; revision?: number; nextCursor?: string };
};
```

错误响应：

```ts
type ApiError = {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    fieldErrors?: Record<string, string>;
  };
  meta: { requestId: string };
};
```

规则：

- `message` 是面向普通用户的中文说明，不包含调用栈、SQL、Provider URL、密钥或完整上游响应。
- 原始错误按 `requestId` 写入脱敏管理员日志。
- 认证失败统一返回 `UNAUTHENTICATED`；无项目权限统一返回 `PROJECT_FORBIDDEN`，避免泄露项目是否存在。
- 画布 revision 冲突返回 HTTP 409 和 `CANVAS_REVISION_CONFLICT`。
- 验证错误返回 HTTP 422；幂等命中仍返回已有资源的成功响应。

## 核心 API 轮廓

```text
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me
POST /api/auth/logout

GET  /api/projects
POST /api/projects
GET  /api/projects/:projectId
PATCH /api/projects/:projectId
DELETE /api/projects/:projectId

GET  /api/projects/:projectId/canvas
PUT  /api/projects/:projectId/canvas
POST /api/projects/:projectId/canvas/migrations/indexeddb

GET  /api/projects/:projectId/assets
POST /api/projects/:projectId/assets/uploads
PATCH /api/assets/:assetId/current-version
POST /api/assets/:assetId/trash

POST /api/projects/:projectId/jobs
GET  /api/projects/:projectId/jobs
GET  /api/jobs/:jobId
POST /api/jobs/:jobId/retry
POST /api/jobs/:jobId/cancel
GET  /api/projects/:projectId/events

GET  /api/models
GET  /api/health/live
GET  /api/health/ready
```

所有 `:projectId` 路由先校验 Session，再校验成员关系。通过任务 ID 或资产 ID 访问时，也必须反查所属项目权限。

项目创建、改名和删除以 PostgreSQL 为唯一权威；IndexedDB 只保存云端项目的离线缓存和待迁移旧项目。项目删除仅允许所有者执行，采用软删除并停止未完成任务；删除最后一个可用项目时，服务端必须在同一事务返回新的默认草稿空间。

## SSE

- `Content-Type: text/event-stream`，事件 `id` 使用 `JobEvent.eventId`。
- 支持 `Last-Event-ID`；断线自动重连。
- 发送心跳注释保持连接，不制造业务事件。
- 一个连接只推送当前用户有权限的指定项目事件。
- 前端先获取画布和任务快照，再接 SSE；收到事件按 `sequence` 合并。

## Session 与跨站保护

- Cookie：HttpOnly、SameSite=Lax；生产启用 Secure。
- 登录后轮换 Session；注销和改密后撤销服务端 Session。
- 状态修改接口校验 Origin/Host，并使用不可猜测的 CSRF 方案或同源双重令牌。
- 密码至少 8 位，服务端使用 Argon2id；日志不得记录请求密码。

## 兼容与切换

- 第 1 部分 API 上线后，未登录用户进入认证页；首次登录事务内创建“未命名项目”和空画布。
- 已登录且没有项目的异常账号在进入工作台时自动补建默认草稿，不要求先走创建项目页。
- 第 2 部分明确询问后迁移旧 IndexedDB 画布；迁移失败继续保留本地数据并允许导出。
- 第 8 部分部署通过新健康探针后才切流；旧镜像和旧数据卷保留到验收完成。
