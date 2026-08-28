# 实施进度

## 2026-08-24

- 已读取并复核实施目标。
- 已确认工作区为空。
- 已创建规划文件，开始工程骨架阶段。
- 已完成 Next.js + React Flow 工作台、邮箱密码演示登录、项目创建和节点画布。
- 已完成角色、场景、全景、3D 构图、关键帧、修复、风格优化、视频和输出节点的 Mock 执行闭环。
- 已完成 Provider 接口、健康检查、项目 JSON 导出、Docker Compose 服务预留和 PostgreSQL schema 草案。
- 已验证 `npm run lint`、`npx tsc --noEmit`、`npm run build`，首页与 `/api/health` 本地返回 200。
- 已验证 `docker compose config --quiet`，Compose 配置可解析。

## 后端闭环阶段

- 已确认采用邮箱密码 + Argon2id、Drizzle ORM、BullMQ、SSE。
- 已盘点当前状态：认证、项目、画布和 Mock 任务仍在 `components/studio.tsx` 的浏览器状态中，`scripts/mock-worker.mjs` 仅为占位 Worker。
- 已完成 Drizzle schema、PostgreSQL migration、Session Cookie、认证 API、项目/画布/任务 API。
- 已完成 BullMQ Mock Worker、任务事件持久化、Redis 发布和项目 SSE 订阅。
- 前端已改为服务端登录、项目创建、画布防抖保存、任务 API 入队和刷新恢复。
- 已通过真实 PostgreSQL + Redis smoke 流程：注册 200、创建项目 201、保存画布 200、创建任务 201，Worker 执行后任务为 completed/100%。
- 已通过 `npm run test:unit`、`npm run lint`、`npx tsc --noEmit`、`npm run build`。
- Docker 完整 Web 镜像构建受本机 BuildKit 会话错误和基础镜像下载速度影响未完成；DB/Redis 容器和迁移已实际验证。
- 已用本地 production server + Worker 在 `http://localhost:3000` 常驻运行，健康检查返回 PostgreSQL/Redis 均为 true。
- 已按反馈移除用户可见的创建项目门槛：登录后若无项目，前端自动创建“我的漫剧工作台”并直接进入画布；项目三点菜单已增加设置、复制 ID 和导出操作。
- 修复多租户节点/连线 ID 冲突：`canvas_nodes` 和 `canvas_edges` 均改为项目 ID + 本地 ID 组合主键。
- 组合主键迁移已在本地 PostgreSQL 执行，Web/Worker 重启后健康检查仍为 200。
- 已新增项目删除 API 和三点菜单删除入口，带二次确认；删除接口 smoke 测试返回 200。
- 已完成第一项资产库基础能力：新增 PostgreSQL `assets` 表、MinIO/S3 存储适配器、项目资产上传/列表/内容预览/删除 API，并在工作台接入资产库页面。
- 资产库支持图片缩略图、非图片文件类型占位、文件大小/日期展示、上传错误提示和删除确认。
- 已执行资产迁移并通过 `npm run lint`、`npx tsc --noEmit`、`npm run build`。
- 已完成第三阶段平台入口：大纲库支持服务端保存，工作流模板可创建自动化草稿，Agent / Skill 支持项目级新增、启停和服务端配置保存。
- 新增 `story_outlines`、`project_agents`、`automation_runs` 数据表及 `/api/projects/:projectId/platform` 接口；真实 Provider 仍仅保留适配器接口。
- 本次 `npm run lint`、`npx tsc --noEmit`、`npm run build` 均通过；本地 Docker 当前未启动，未重复执行数据库迁移 smoke。

## 当前边界

- 真实模型 Provider、积分扣费和资产版本比较仍未接入。
- Mock 任务不调用真实 Seedance 2.5，不扣积分；真实 Provider、Redis 队列、MinIO 和 FFmpeg 属于后续阶段。
