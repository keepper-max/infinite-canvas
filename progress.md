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

## ECS 部署就绪阶段

- Dockerfile 已切换为生产构建：镜像构建时执行 `npm run build`，容器启动执行迁移后使用 `next start`。
- Compose 增加环境变量覆盖、PostgreSQL/Redis 健康检查和服务依赖顺序，可直接上传 ECS 后启动。
- 新增 `.env.example`，明确数据库、Redis、S3、Cookie 和外部服务配置项。
- 新增 `/api/integrations`、`/api/credits`、`/api/payments/create`、`/api/sms/send` 接口边界；积分、支付、短信当前为安全的未配置占位，不会产生真实扣费或发送。
- ESLint 已排除 `.open-next` 和 `dist` 部署生成目录。
- 生产 Compose 已移除源码挂载，并将 PostgreSQL、Redis、MinIO 管理端口限制为 ECS 本机回环地址，避免直接暴露公网。
- 本阶段验证：`npm run lint`、`npx tsc --noEmit`、`npm run test:unit`、`npm run build`、`docker compose config --quiet` 均通过；未执行真实 Docker 镜像构建（当前 Docker 引擎未启动）。
- 已新增项目成员 API（查询、添加、角色修改、移除），并限制只有项目所有者可管理成员。
- 已新增资产版本 API，支持按版本组查询和上传新版本；已新增 FFmpeg 合成 API，将项目内多个视频资产合成为 MP4 并回存对象存储。
- 工作流模板现可直接创建运行记录并批量提交项目节点到 Mock Worker，不再只是草稿。
- 单元测试扩展为 2 项，覆盖任务状态机和外部服务默认未配置行为。
- 已将参考仓库 Fork 到用户账号：`https://github.com/keepper-max/infinite-canvas`；当前项目不直接复制其代码。
- 画布已增加本地撤销/重做历史、Delete 删除选中节点、Ctrl/Cmd+D 复制节点、Ctrl/Cmd+Z/Y 快捷键，并保留服务端画布持久化与导出能力。
- 已从 Fork 的 `infinite-canvas` 参考其画布产品能力（项目导入导出、节点操作、快捷键和可扩展节点思路），在现有 React Flow + PostgreSQL 架构中完成对应交互移植；未复制原仓库源码。
- 画布顶部新增“重做、导入画布、复制节点、删除节点”入口，导入 JSON 后会走现有防抖保存接口。
- 本次验证：`npm run lint`、`npx tsc --noEmit`、`npm run test:unit`、`npm run build` 均通过。
- 已完成 AI 画布助手、插件节点、提示词库和自定义模型脚本的服务端与工作台入口移植：助手读取选中节点生成生产建议；插件可项目级安装/启停；提示词按角色/场景/视频分类；模型配置使用环境变量引用 Key。
- 新增迁移 `0004_canvas_extensions.sql` 及对应表 `project_plugins`、`prompt_templates`、`model_configs`。
- 进一步借鉴 Fork 仓库完成模型运行器：支持 OpenAI 兼容 `/chat/completions` 测试调用，API Key 只从 ECS 环境变量读取；助手会优先调用项目模型配置。
- 提示词库增加分类、关键词查询和删除接口；插件 API 支持项目级内置节点 manifest；工作台新增画布助手、提示词库、插件节点和模型脚本四个入口。
- 本阶段验证：`npm run lint`、`npx tsc --noEmit`、`npm run test:unit`、`npm run build` 均通过。
- 继续开发完成：团队成员前端入口、积分账户/账本表和余额接口、工作流拓扑排序、提示词库搜索/分类、插件节点管理和 Seedance Skill 画布助手入口。
- 新增迁移 `0005_credits.sql`；单元测试扩展到 3 项，增加工作流拓扑排序校验。
- 已将 Seedance 2.0 提示词 Skill 的生产规则提炼为网站侧 `lib/seedance-skill.ts`，接入画布助手；不携带 Codex 工具路由，只保留可在网页中执行的提示词编排规则。

## 2026-10-06 手机号 + 邮箱验证码账号升级

- 已完整读取用户粘贴的 33 节需求、仓库级 AGENTS.md 和 planning-with-files 技能说明。
- 已确认当前仓库为 Next.js App Router + PostgreSQL/Drizzle + Redis + 数据库 Session Cookie 架构。
- 已记录当前工作区存在大量用户未提交改动，后续仅追加账号体系相关修改，不覆盖既有工作。
- 已开始分模块盘点 auth、users、迁移、Redis、短信占位、邀请码/渠道、积分和前端登录注册入口。
- 已阅读 Next.js 16 仓库内 Route Handler、Cookie 与鉴权指南，确认继续使用现有数据库 Session Cookie。
- 已确认仓库不存在既有邀请码、学校/渠道归因和后台用户管理实现，需要以最小增量方式补齐，而不是复制两套注册逻辑。
- 已确认认证 UI、环境变量、Compose 透传和迁移执行方式；账号升级采用统一验证码接口并保留旧密码登录。
- 已核对阿里云官方 Node.js V2.0 SDK 接入方式，准备使用官方 Dysmsapi 2017-05-25 SDK 与后端单例客户端。
## 2026-10-06 账号体系升级

- 完成用户表增量迁移、邀请码表与初始化脚本接入。
- 完成验证码生成、哈希存储、用途隔离、原子消费、错误次数和发送频率限制。
- 完成阿里云短信与 SMTP 邮件服务端适配。
- 完成验证码注册/登录 API，并保留旧邮箱密码登录。
- 完成注册/登录双通道 UI 与管理员用户列表。
- `npm run test:unit` 通过（15 项通过，1 项原有数据库集成测试按环境跳过）。
- `npx tsc --noEmit`、`npm run lint`、`npm run build` 全部通过。
- 最终复审修正迁移重复执行时可能重置邮箱验证状态的问题；密钥扫描仅命中示例占位值和测试专用值。
- 非强制 `npm audit fix` 将实际 Next.js 锁定版本更新到 16.3.8，并消除生产依赖漏洞；剩余 9 项只在开发依赖中，修复需要破坏性降级，未执行 `--force`。
- Docker Desktop 未运行，因此未在隔离 PostgreSQL 上实跑迁移；迁移文件已重读并通过构建引用检查。

## 2026-10-06 阿里云短信凭据接入

- 从用户指定的 `AccessKey2.csv` 读取凭据，仅注入当前查询进程，未输出或写入版本库。
- 通过阿里云官方 SDK 只读确认短信签名、模板查询均返回 `OK`。
- 选择已审核通过且明确绑定“守密人大连科技”的“验证码”模板，确认包含 `${code}` 变量。
- 凭据、签名和模板 Code 写入被 Git 忽略的 `.env.local`；未发送测试短信、未创建或修改阿里云资源。
- 修正阿里云 SDK CommonJS/ESM 运行时构造器兼容，类型检查、定向 ESLint和单元测试通过。
