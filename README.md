# 镜界工坊

一个面向 AI 漫剧生产的自有品牌 MVP。第一阶段把“角色母版 → 场景 → 全景 → 3D 构图 → 关键帧 → 修复 → 风格优化 → 视频任务 → 预览/导出”做成可操作的节点画布。

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`，注册邮箱密码后创建项目。也可以启动完整本地依赖：

```bash
docker compose up --build
```

健康检查地址：`http://localhost:3000/api/health`。

## 当前 MVP

- 画布基于 React Flow，支持节点拖拽、连线、选中、单节点执行和批量执行。
- Mock 任务会经过 BullMQ/Redis Worker 执行，进度写入 PostgreSQL 并通过 SSE 推送，不调用真实模型、不扣积分。
- 项目、节点、连线、任务、资产和 Session 持久化到 PostgreSQL；刷新页面后会从服务端恢复。
- 资产库支持上传图片、视频和音频到 MinIO，支持预览和删除；接口为 `/api/projects/:projectId/assets`。
- 第三阶段平台入口已提供：大纲库、工作流模板、Agent / Skill 配置和自动化流水线草稿；接口为 `/api/projects/:projectId/platform`。
- `db/schema.ts` 和 `db/migrations/0000_backend_loop.sql` 定义了用户、项目、资产、画布、任务和产物边界。
- Compose 中 PostgreSQL 映射到宿主机 `55432`，用于避开常见的本地 `5432` 冲突；容器内部仍使用标准 PostgreSQL 端口。

## 生产接入边界

- 登录使用 PostgreSQL + Argon2id，会话使用服务端 HttpOnly Cookie。
- 本地 HTTP 默认关闭 Cookie 的 Secure 标记；生产 HTTPS 部署时设置 `COOKIE_SECURE=true`。
- `lib/provider.ts` 已抽象 `VideoProvider` 接口，后续可分别接入 Seedance、Kling、Veo。
- Redis、MinIO、FFmpeg 和 worker 已在 Docker Compose 中编排；真实模型 Provider 和扣费逻辑属于后续阶段。

## 相关入口

- `components/studio.tsx`：工作台和画布交互
- `lib/types.ts`：节点、项目和任务类型
- `lib/provider.ts`：视频 Provider 适配器
- `public/demo/mock-video.svg`：Mock 视频预览
