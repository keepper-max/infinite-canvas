# 镜界工坊

一个面向 AI 漫剧生产的自有品牌 MVP。第一阶段把“角色母版 → 场景 → 全景 → 3D 构图 → 关键帧 → 修复 → 风格优化 → 视频任务 → 预览/导出”做成可操作的节点画布。

## 本地运行

```bash
cp .env.example .env
npm install
npm run dev
```

打开 `http://localhost:3000`，注册邮箱密码后创建项目。也可以启动完整本地依赖：

```bash
docker compose up --build
```

ECS 部署时将项目上传服务器，在 `.env` 中替换数据库、Redis、对象存储和 Cookie 配置，然后执行 `docker compose up -d --build`。Web 容器使用生产构建和 `next start`，Worker 会等待 PostgreSQL/Redis 就绪后自动初始化数据表。

健康检查地址：`http://localhost:3000/api/health`。

## 当前 MVP

- 画布基于 React Flow，支持节点拖拽、连线、选中、单节点执行和批量执行。
- Mock 任务会经过 BullMQ/Redis Worker 执行，进度写入 PostgreSQL 并通过 SSE 推送，不调用真实模型、不扣积分。
- 项目、节点、连线、任务、资产和 Session 持久化到 PostgreSQL；刷新页面后会从服务端恢复。
- 资产库支持上传图片、视频和音频到 MinIO，支持预览和删除；接口为 `/api/projects/:projectId/assets`。
- 资产支持版本上传和版本分组查询：`/api/projects/:projectId/assets/versions`；视频资产可通过 `/api/projects/:projectId/render` 使用 FFmpeg 合成 MP4。
- 项目成员支持查询、添加、修改角色和移除：`/api/projects/:projectId/members`。
- 第三阶段平台入口已提供：大纲库、工作流模板、Agent / Skill 配置和自动化流水线草稿；接口为 `/api/projects/:projectId/platform`。
- 工作流模板可直接提交当前项目节点到 Mock Worker 批量执行，任务状态通过任务中心和 SSE 返回。
- 画布助手接口为 `/api/projects/:projectId/assistant`，会把选中节点上下文转换为角色、场景、构图和 Seedance 提示建议；当前默认 Mock，可通过 `ASSISTANT_PROVIDER` 替换实现。
- 插件节点接口为 `/api/projects/:projectId/plugins`，内置角色三视图、Seedance 镜头和提示词优化节点，可按项目安装/启停。
- 提示词库接口为 `/api/projects/:projectId/prompts`，内置角色、场景、视频模板并支持项目自定义提示词。
- 自定义模型脚本接口为 `/api/projects/:projectId/models`，保存 OpenAI 兼容 Base URL、模型 ID、脚本和环境变量名，不保存明文 API Key。
- 配置模型后，`POST /api/projects/:projectId/models/:modelId/test` 可用同一套服务端适配器测试聊天请求；画布助手会优先使用该项目最新模型，失败自动回退 Mock。
- Seedance 2.0 Skill 已提炼到 `lib/seedance-skill.ts`，画布助手会自动应用模式选择、参考资产职责、角色/场景/构图锁定、镜头动作和安全检查规则。
- 积分账户将支付宝充值和激活码兑换计入同一余额；真实供应商视频按单次实际账单结算，Mock 任务不扣分。账单延迟时生成状态与结算状态分别保存。
- 支付宝支付接口已实现订单创建、异步验签通知和幂等到账，但默认关闭；经营资质、商户审核、完整协议资料和密钥未配置前无法创建支付订单。
- 管理员可创建、作废一次性积分激活码，完整码只在创建时返回一次，数据库仅保存哈希。也可在本地运行 `npm run credits:code -- --admin-id <管理员UUID> --credits 1000 --days 30`，需配置同一数据库连接和 `ACTIVATION_ADMIN_USER_IDS`，生成后只在终端显示一次。
- `GET /api/integrations` 可查看当前外部服务配置状态。
- `db/schema.ts` 和 `db/migrations/0000_backend_loop.sql` 定义了用户、项目、资产、画布、任务和产物边界。
- Compose 中 PostgreSQL 映射到宿主机 `55432`，用于避开常见的本地 `5432` 冲突；容器内部仍使用标准 PostgreSQL 端口。

## 生产接入边界

- 激活码上线前先在已注册用户中确定管理员 UUID，将其配置到服务端 `ACTIVATION_ADMIN_USER_IDS`（可逗号分隔），再执行 `npm run db:init` 应用积分增量迁移。未配置时任何账号都不能发码。不要用邮箱授权：当前注册没有邮箱验证。
- 当前每个新账号仍有初始 1000 体验积分；真实任务在提交前要求余额大于零，并按实际结算账单扣分，最终金额可能导致欠额。`USD_CNY_RATE` 未设置时不允许提交美元计费的供应商视频。
- 真实任务的参考素材通过 `PUBLIC_BASE_URL` 生成 24 小时签名 URL。生产必须使用 HTTPS，并配置 `PROVIDER_ASSET_SIGNING_SECRET`；未单独配置时会复用 `SESSION_SECRET`，不会公开对象存储端口。
- 充值开关默认关闭。只有经营资质、支付宝产品审核、运营主体与客服信息、HTTPS 域名及密钥全部确认后，才能设置 `PAYMENT_ENABLED=true`、`PAYMENT_COMPLIANCE_APPROVED=true` 和 `PAYMENT_PROVIDER=alipay`；不能只因为代码已实现就开放付费服务。

- 登录使用 PostgreSQL + Argon2id，会话使用服务端 HttpOnly Cookie。
- 本地 HTTP 默认关闭 Cookie 的 Secure 标记；生产 HTTPS 部署时设置 `COOKIE_SECURE=true`。
- `lib/provider.ts` 已抽象 `VideoProvider` 接口，后续可分别接入 Seedance、Kling、Veo。
- Redis、MinIO、FFmpeg 和 worker 已在 Docker Compose 中编排；真实供应商视频任务的账单由 worker 异步查询和扣分。

## 相关入口

- `components/studio.tsx`：工作台和画布交互
- `lib/types.ts`：节点、项目和任务类型
- `lib/provider.ts`：视频 Provider 适配器
- `public/demo/mock-video.svg`：Mock 视频预览
