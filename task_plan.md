# 后端持久化闭环实施计划

## 目标

将当前浏览器本地 MVP 改为可刷新的多用户闭环：注册/登录、项目和画布持久化、BullMQ Mock Worker、PostgreSQL 任务状态和 SSE 进度。

## 阶段

- [x] 已有 MVP 与 Docker 骨架盘点
- [x] 认证与 PostgreSQL/Drizzle 持久化
- [x] 项目、画布与任务 API
- [x] BullMQ Worker 与 SSE 事件流
- [x] 前端切换服务端数据源
- [x] 集成测试、Docker 依赖验证和刷新恢复验收

## 约束

- 自有品牌“镜界工坊”，不复制灵创视界品牌资产。
- 第一版本地 Docker，真实视频 API 不调用，Mock 任务不扣积分。
- 真实 Provider 的模型 ID、参数和额度由适配器配置承载。
- 本阶段只做 Mock 生成，不接真实视频 API；认证入口恢复为登录后创建项目。

## 错误记录

| 错误 | 尝试 | 处理 |
|---|---:|---|
| Docker BuildKit 构建会话密钥异常 | 1 | 改用传统 `DOCKER_BUILDKIT=0` 路径；因基础镜像下载很慢中止完整镜像构建，但 Compose 配置和 DB/Redis 依赖已单独验证 |
| 本地生产 HTTP Session 未发送 | 1 | `Secure` Cookie 在 HTTP localhost 下不发送；改为由 `COOKIE_SECURE=true` 显式开启，默认适配本地 HTTP |

- [x] 第一项：资产库基础能力（MinIO 上传、预览、删除和工作台页面）
- [x] 第二优先级：真实 Provider 仅保留 VideoProvider 接口，不接真实模型
- [x] 第三阶段：大纲库、工作流模板、Agent/Skill 配置和自动化流水线草稿
