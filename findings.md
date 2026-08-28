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
