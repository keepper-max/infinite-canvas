# AI 漫剧生产画布 2.0：事实与决策

## 当前仓库事实

- 工作仓库：`H:\CodexStorage\infinite-canvas-upgrade`。
- GitHub：`keepper-max/infinite-canvas`；上游为 `basketikun/infinite-canvas`。
- 当前已集成 Infinite Canvas 画布、分组/解组、媒体参数、视频任务 ID 恢复、代理、WebDAV、全局托管模型和 Seedance 工作流。
- 前端为 Vite + React + TypeScript + Zustand；画布主业务仍主要保存在浏览器 localForage/IndexedDB。
- 底层内置节点目前为图片、文本、配置、视频、音频、分组；插件节点使用开放字符串类型。
- 当前全局模型和 Seedance 适配已经存在，后续应迁入统一服务端模型注册表，而不是重写丢弃。
- 第 0 部分本地基线（2026-09-08）：`main` 位于 `d31c74e253232c4a6314b7461b7e2f0d9c948ee8`，与 `origin/main` 无前后差异；工作区只有本轮新增的规划文件未跟踪。
- 当前根 `docker-compose.yml` 只有 `app` 一个服务，运行镜像由 Bun 同时提供 Vite 静态产物和同源模型代理；尚无 PostgreSQL、Redis、Worker、MinIO/OSS 服务。
- 当前服务端敏感配置仅登记变量名 `TOKEN360_API_KEY`、`TOKEN360_UPSTREAM`、`TOKEN360_CATALOG_URL`；审计文档不得记录其值。
- 现有 `CanvasConnection` 只有起止节点 ID，尚无端口、数据类型或引用角色；第 0 部分契约必须保持向后兼容映射。
- 现有视频调用区分普通 OpenAI 格式、Gemini 格式、脚本模型和服务端托管 JSON 模式；新能力表需要覆盖并收敛这些分支，而不是直接删除。
- 旧版工作区 `H:\代码相关\项目\漫剧工作流` 保留了 Next.js/Drizzle/PostgreSQL 的完整后端实现，已使用 `argon2`、`pg`、`drizzle-orm`，并包含注册、登录、Session、项目权限及画布 API；第 1 部分将复用其已验证数据语义，但适配为当前仓库的独立 API 服务。
- 旧 `projects` 已有 `owner_id`，`project_members` 尚缺复合主键/唯一约束；旧库没有独立 `canvases` 表，画布节点直接绑定项目。兼容迁移必须增量补表/约束，不能重建现有 19 张表。
- 旧 SQL 迁移实际已为 `project_members(project_id,user_id)` 和画布节点/边建立复合主键，只有旧 Drizzle 声明没有完整表达这些约束；新 schema 要与数据库实际约束对齐。
- 旧认证已采用 Argon2id、随机 Session Token 的 SHA-256 哈希和 HttpOnly/Lax Cookie，可复用安全语义；需要补强密码长度、统一错误信封、Origin 校验、Session 轮换/过期清理和默认草稿幂等创建。
- 当前前端路由仍直接开放首页和 `/canvas/:id`，项目完全由 localForage 保存。第 1 部分只接入用户边界和云端项目壳；节点/连线内容迁移仍留在第 2 部分。
- 前端已有 React Router、Ant Design、React Query 和 `UserLayout`，认证可以作为路由门卫接入，不需要替换现有布局；画布详情页会隐藏顶部栏，退出入口需同时覆盖普通顶部栏和画布工具栏或提供统一会话失效跳转。
- 第 1 部分依赖版本已通过当前注册表核验：Hono 4.13.7、Node adapter 2.1.1、Drizzle ORM 0.45.2、pg 8.23.0、argon2 0.45.1、Zod 4.5.4、tsx 4.23.13。
- 第 1 部分完成后，平台 API 已成为账号与项目边界；画布节点、连线和媒体内容仍以 IndexedDB 为权威，必须由第 2、3 部分分别迁移，不能把项目壳同步误认为云端画布持久化。
- ECS 使用旧式 Docker builder 且无法稳定直连 Docker Hub；镜像阶段已按 API、模型代理、前端顺序组织，PostgreSQL 镜像支持通过 `POSTGRES_IMAGE` 覆盖，生产部署时应使用主机可达的可信镜像源。
- 第 0 部分 PostgreSQL 备份已在隔离容器成功恢复，并能应用第 1 部分增量迁移；原 19 张业务表和数据未被重建或覆盖。
- 第 2 部分审计确认：画布详情页用组件内 `nodes`、`connections`、`viewport` 作为运行态，并通过两个 effect 写回 Zustand；Zustand 再以 400ms 防抖写入统一 localForage 键 `infinite-canvas:canvas_store`。
- 当前 `CanvasNodeData` 和 metadata 包含运行态 URL、storageKey、远端任务 ID、插件字段及多媒体引用；第 2 部分只能保存 JSON 结构和待转存引用，不能把 Blob、`blob:` URL 或密钥配置当作云端资产上传。
- 旧工作区已有 `canvas_nodes`、`canvas_edges`、`canvas_snapshots` 及画布 API，可借鉴事务替换和组合主键语义；新实现必须叠加独立 `canvases.revision`、端口/角色字段和显式冲突响应，不能原样复制旧的无并发控制保存逻辑。
- 现有 WebDAV 同步会合并项目及媒体文件，属于用户主动配置的另一条同步链；第 2 部分不得破坏它，但平台云端画布必须优先于 WebDAV/localForage，并把二者降级为迁移/导出来源。
- 第 2 部分最终采用 800ms 防抖和串行保存：服务端 revision 控制并发，浏览器缓存最近成功快照与未同步草稿；任何 409 冲突都要求用户明确选择。
- 旧 IndexedDB 不自动删除。迁移前保留本地原数据，只上传清洗后的节点、连线、视口和设置；媒体 Data URL/Blob、API Key/Token、渠道、代理与 WebDAV 配置均排除。
- ECS 隔离恢复旧数据库后，0007 增量迁移、真实 PostgreSQL 集成、同源读写、版本冲突与 API 重启恢复均通过，生产容器未变更。

### ECS 运行基线（2026-09-08）

- 主机运行 Ubuntu 22.04 系列内核、Docker 29.1.3 和 Docker Compose 2.40.3；系统盘约 40 GiB，审计时已用约 21 GiB。
- 对外服务是 `infinite-canvas` 容器，镜像 `infinite-canvas:global`，端口 `3000`，重启策略 `unless-stopped`，根页面返回 HTTP 200。
- 当前线上镜像 ID 为 `sha256:a13b4d47de32276972cb9481a148e4e7019d14770d4a201a6625c34f81a734b8`；其 `/healthz` 未暴露 JSON 健康响应，说明部署镜像早于本地当前代理实现或使用了不同启动层。
- 旧 `jingjie-studio` Compose 项目位于 `/opt/jingjie-studio`；Web 与 Worker 已停止，PostgreSQL 16、Redis 7、MinIO 仍在运行并只绑定回环地址。
- 持久卷仍存在：`jingjie-studio_postgres_data`、`jingjie-studio_minio_data` 及 Redis 匿名卷。它们是后续迁移来源，不得直接覆盖或删除。
- PostgreSQL 备份中确认有 19 张业务表，包括用户、Session、项目成员、画布节点/边/快照、资产、任务/事件/产物、积分、模型配置和提示词等；第 1 部分必须先读取旧 Drizzle/SQL 结构并编写兼容迁移，不能新建空库替代。
- 线上应用容器环境清单只记录到变量名 `TOKEN360_API_KEY`；任何 inspect 备份都按敏感文件处理。

### 第 0 部分备份

- ECS 备份：`/opt/jingjie-backups/part0-20260908T141423Z`，包含当前生产镜像、容器 inspect、旧源码/配置、PostgreSQL 自定义格式转储、MinIO 数据和恢复说明；全部校验和已通过。
- 本地 Git 备份：`H:\CodexStorage\backups\infinite-canvas-upgrade\part0-20260908T141423Z`，包含完整 Git bundle 和非敏感容器配置；bundle 验证通过。
- 备份没有触发容器切换、数据库写入、数据恢复或线上发布。

## 蔓悦实测结论

- 蔓悦与 Infinite Canvas 属于高度相近的自研 DOM 节点 + SVG 连线架构，不是 React Flow。
- 其产品优势主要在漫剧业务层：项目关联、分镜表、角色卡及状态、版本 A/B、批量首帧/视频、任务详情、对象存储、时间线、字幕和合并成片。
- 其画布交互还包含对齐/排列、锁定、搜索、专注模式和媒体性能模式。
- 蔓悦后端源码未公开，只能依据公开前端包和实际页面行为；不得复制其私有实现。
- 直接访问其带尾斜杠画布路由曾返回 403，说明我们的生产 Nginx 必须配置 SPA 路由回退。

## 核心架构决策

| 决策 | 原因 |
|---|---|
| 保留 Infinite Canvas 底座 | 当前交互和扩展系统可用，重换底座只会增加迁移风险 |
| 新建独立平台 API 与 Worker | 当前 Vite 前端不适合承担鉴权、密钥、任务和云数据职责 |
| PostgreSQL 作为云端权威 | 支持多用户隔离、版本、任务恢复和可追溯性 |
| Redis/BullMQ 执行生成任务 | 页面关闭后继续、失败重试、并发与幂等控制 |
| 开发用 MinIO、生产优先 OSS | 视频占用大，避免 ECS 系统盘同时承担长期素材 |
| 通用节点 + `workflowKind` | 防止为几十个漫剧用途复制底层组件 |
| 类型化端口和边 | 在请求模型前阻止首尾帧、多参考等模式传错参数 |
| 资产版本不可变 | 保证旧任务可复现，切换主版本不破坏历史 |
| Skill 节点输出结构化 JSON | Seedance Skill 先编译提示词，再由视频节点调用模型 |
| 内部模型 ID 与显示名分离 | 用户只看模型名，Provider、地址和密钥留在服务端 |

## 关键风险

- IndexedDB 到 PostgreSQL 是数据权威切换，必须提供显式迁移、备份和失败回退，不能静默上传。
- 旧浏览器配置可能含 API Key；迁移时必须明确排除渠道、密钥和代理配置。
- 当前画布主页面文件较大，产品化改造需要按状态、渲染、交互和执行边界渐进拆分，避免一次大型重写。
- 模型公开目录不等于完整能力声明；必须叠加人工维护的能力覆盖表。
- 用户自定义脚本和第三方插件可访问敏感数据；首版只允许可信来源，沙箱后续单独实施。
- FFmpeg 必须在 Worker 运行，并限制并发、临时空间和清理策略；不能阻塞 Web 服务。

## 第 3 部分补充发现（2026-09-09）

- 当前图片与音视频仅保存在浏览器 IndexedDB（`image_files`、`media_files`），页面刷新依赖重新生成 blob URL；尚无云端资产权威数据。
- 当前资产 Store 仅支持 `text | image | video`，直接删除会清理本地文件，没有不可变版本、主版本、来源追踪、回收站或用户隔离。
- 资产页的上传、编辑、导入、下载全部连接本地 Store；第 3 部分需要在保留旧数据读取能力的同时切换到项目级 API。
- 画布数据已有 `storageKey` 字段，但没有 `assetId` / `assetVersionId`，后续需要用确切版本标识绑定长期媒体引用。
- 对象存储采用一套 S3 兼容适配器：开发环境连接 MinIO，生产环境通过可配置 endpoint 连接 OSS；浏览器只获得短期签名地址，永久记录只保存服务端生成的对象键。
- 旧数据库中的直连资产字段可无损迁移为不可变 v1，同时保留旧列用于回滚；新版本只写 `asset_versions`，主版本切换仅更新指针。
- 画布保存事务会同步确切的资产版本引用，并拒绝跨项目版本；因此后续任务和生成节点可绑定 `AssetVersion.id`，不会因主版本切换而漂移。
- ECS 隔离环境已验证旧库恢复、0008 增量迁移、真实 PostgreSQL 版本链、MinIO 签名上传下载、画布版本绑定、跨用户隔离、回收站恢复和 API 重启恢复；生产容器未改动。

## 资源索引

- 总计划：`task_plan.md`
- 执行包目录：`plans/ai-drama-canvas-2/`
- 历史迁移规划备份：`plans/archive/upstream-v018-migration/`
- 当前进度：`progress.md`
- 当前画布类型：`web/src/types/canvas.ts`
- 当前画布主流程：`web/src/pages/canvas/project.tsx`
- 当前浏览器持久化：`web/src/stores/canvas/use-canvas-store.ts`
- 当前插件宿主：`web/src/pages/canvas/hooks/use-plugin-host.tsx`
