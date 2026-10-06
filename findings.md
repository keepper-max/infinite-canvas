# 调研与实现发现

- 当前工作区为空，无既有代码、依赖或仓库级 AGENTS.md。
- AIComicBuilder 适合作为生产链参考：剧本、角色、分镜、关键帧、视频和任务队列完整，Apache-2.0。
- AIYOU 适合参考节点画布，但许可证含商业限制，不直接复制代码。
- MicroDrama AI 适合参考多 Agent/SSE 流程，但依赖 MuAPI 且缺少独立许可证文件。
- 用户记录的 Seedance 2.5 上游链路为：Grok 提示词/三视图 → MJ 场景候选 → Grok 全景 → TapNow 3D 构图 → Nano Banana 2 修复 → MJ 优化 → Seedance 视频。
- MVP 节点需要明确区分身份参考、环境参考、构图、关键帧和视频输入。

## 当前实现决策

- 技术栈：Next.js App Router + React + TypeScript + XYFlow + Tailwind/CSS。
- 首版认证使用本地开发模式邮箱密码状态，生产持久化认证待接入 PostgreSQL/Argon2id。
- 首版任务用浏览器 Mock Runner，后续通过 `VideoProvider` 接入 Seedance/Kling/Veo。
- 本地验证结果：Next.js 首页和 `/api/health` 均返回 200；生产构建无警告。
- `db/schema.sql` 已将用户、项目成员、资产、节点、边、生成任务、事件和产物拆成可迁移的 PostgreSQL 表。
- 后端实现需补充 sessions、canvas_snapshots，以及实际的迁移执行、队列入队、Worker 更新和 SSE 广播；现有 Compose 已提供 PostgreSQL/Redis/Worker 服务，但 Worker 尚未连接业务。
- 生产构建阶段不能在模块导入时创建 Redis Queue，否则无 Redis 环境会产生连接错误；现已改为请求/Worker 运行时懒创建连接。
- 本地 HTTP 测试发现 Secure Cookie 会阻止 localhost 会话回传，改为 `COOKIE_SECURE=true` 显式开启，生产 HTTPS 必须设置该变量。
- React Flow 默认节点 ID（如 `prompt`、`video`）会在多个项目中重复，不能作为全局主键；节点和边必须使用项目范围组合主键。
- 第三阶段适合先用轻量项目级配置表承载大纲、Agent/Skill 和自动化草稿；工作流模板目前作为无模型依赖的预设入口，后续再映射为画布节点快照。

## 手机号 + 邮箱验证码账号升级发现（2026-10-06）

- 当前仓库是 Next.js 16.3 App Router、React 19、TypeScript、Drizzle ORM、PostgreSQL、ioredis/BullMQ。
- 当前鉴权为数据库 Session：`jingjie_session` Cookie 存随机 Token，数据库只保存 SHA-256 Token 哈希；不是 JWT，应继续复用。
- 当前 `users` 表以 UUID 为主键，`email` 与 `password_hash` 均为必填；现有注册/登录仅支持邮箱密码。
- Redis 已有统一连接入口 `lib/redis.ts`，验证码和限流应复用，不能新建第二个 Redis 客户端体系。
- 现有短信路由仅是登录后可访问的未配置占位；需要改为匿名可调用但后端限流的验证码发送入口。
- 积分账户通过 `users.id` 关联，新增凭证字段无需改变积分主键或历史账户。
- 当前工作区已有大量未提交的钱包、支付、画布与 Provider 改动，账号升级必须只增量修改必要文件。
- 首轮搜索尚未发现成型的邀请码、学校、渠道或后台用户管理模块；需继续确认 schema、迁移和 UI，不能凭需求文本假定其已存在。
- Next.js 16 本地文档确认：App Router Route Handler 使用原生 Request/Response；`cookies()` 必须异步调用，Cookie 写入必须发生在 Route Handler 或 Server Function。当前 `lib/auth.ts` 的用法符合新版接口。
- 当前用户表只有 `id/email/password_hash/created_at`；没有 phone、验证状态、昵称、头像、账号状态、最近登录、邀请码、学校或渠道字段。
- 当前用户表和旧迁移把 email/password_hash 设为 NOT NULL，因此需要正式增量迁移把二者调整为可空并增加“phone 或 email 至少一个”的约束及部分唯一索引。
- 当前没有成型的邀请系统、学校/社会渠道表或后台用户管理页面；需求中的“保留”在本仓库不存在可复用实现。方案应补一个最小统一邀请码/归因模型，而不能伪称已接入旧逻辑。
- 旧邮箱密码登录必须保留为兼容入口；新的手机/邮箱验证码注册登录复用同一 `users.id` 和 `createSession()`。
- 当前认证 UI 集中在 `components/studio.tsx` 的 `AuthScreen`，只有邮箱和密码；适合在原卡片内增加“手机号/邮箱”切换和验证码发送控件，不需要重做页面。
- `.env.example` 与 Compose 目前只有 `SMS_PROVIDER=unconfigured`，没有阿里云短信、SMTP、验证码 TTL/限流配置；需要补齐模板并透传 Web 容器。
- `scripts/db-init.mjs` 通过顺序拼接 SQL 文件执行幂等迁移；新迁移应追加为 `0008_account_credentials.sql`，不能修改已有迁移。
- 当前没有独立后台路由或管理员角色字段；已有激活码管理员由 `ACTIVATION_ADMIN_USER_IDS` 白名单控制。账号管理可沿用白名单思路增加统一管理员判断，避免引入第二套权限系统。
- 项目已有邮箱密码成员邀请输入场景（按邮箱查用户），将 users.email 改为可空后，该流程仍可用，但手机号账号未绑定邮箱时不能通过邮箱被添加，属于合理兼容边界。
- 阿里云官方 Node.js V2.0 SDK 文档推荐 `@alicloud/dysmsapi20170525`、`@alicloud/openapi-client` 与 `@alicloud/tea-util`；凭据放环境变量，SendSms 使用 `phoneNumbers/signName/templateCode/templateParam`，客户端应复用而非每次 new。
- 阿里云官方建议使用 `ALIBABA_CLOUD_ACCESS_KEY_ID` 和 `ALIBABA_CLOUD_ACCESS_KEY_SECRET` 环境变量；本项目同时兼容需求给出的 `ALIYUN_SMS_*` 命名，但代码不会将凭据发送到前端或写入日志。
## 账号体系升级实现记录（2026-10-06）

- 采用统一验证码接口而非为手机/邮箱复制控制器；渠道与 scene 进入同一 Redis 服务。
- 账号仍使用数据库 Session Cookie，现有 UUID 用户主键、积分、项目外键不变。
- 阿里云短信使用官方 `@alicloud/dysmsapi20170525` SDK；邮件使用可替换的 `EmailService` 接口与 SMTP 实现。
- 邀请码此前不存在可复用实现，因此新增最小 `invite_codes` 与兑换记录；手机号和邮箱注册共享同一事务。
- 验证码校验改为 Redis Lua 原子消费，避免并发请求重复使用同一验证码。
- 后台用户列表仅环境变量白名单管理员可访问，默认返回脱敏手机号和邮箱。
