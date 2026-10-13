# 检查进度

- 已阅读仓库 AGENTS.md、SECURITY.md、鉴权和验证码存储实现。
- 尚未做认证态跨账号测试、生产端口扫描或漏洞利用。
- 仅新增本目录检查文档；业务代码未修改。
- 已完成 12 个公开 GET 请求、2 个拒绝来源的空请求。未读取业务数据、未提交真实账号密码或验证码。
- local-probes.ts 本地五项输出验证完成；auth.test.ts 与 app.test.ts 共 21 项通过。
- 已生成 report.md；未进行认证态线上利用，保留未验证项。已检查文档更新要求，业务功能未变，不修改 CHANGELOG/todo/pending-test。

## 用户确认后的实施
- 已增加安全媒体连接器、媒体响应 CSP、对象存储默认附件，以及 Redis 滑动窗口鉴权限流。
- 用户最终阈值：账号 5 次/5 分钟；密码+验证码错误校验共享 IP 10 次/15 分钟后冷却 3 小时；验证码发送独立 5 次/5 分钟。
- 定向类型检查通过；第一轮相关测试 64 项通过。
- Docker 连接失败；WSL Ubuntu 启动报 ERROR_NO_SYSTEM_RESOURCES，未改动系统资源或使用生产 Redis 替代。
- 已补充 opt-in 本地 Redis 集成测试，等待可用隔离 Redis；新增文档列出边缘缓存更新、真实 IP 链及旧签名链接有效期等发布验收项。
- 最终定向回归 66 通过、1 跳过（真实 Redis）；账户字段调整后的安全专项 10 通过、1 跳过，类型检查再次通过。
- 安全取址连接器真实请求本站健康接口 200/healthy；无害探针中私网读取在 fetch 前拒绝、两个密码入口 429、SVG 保留 MIME 且具备 sandbox。
- 实现与发布边界已补充到报告、CHANGELOG、todo、pending-test 和生产手册；没有 commit/push/部署。

## 用户授权发布后的预检
- 已确认物理主机 shoumiren，线上当前提交 bc4590d84021，发布分区剩余约 215 GB。
- 使用现有 Redis/API 镜像创建临时无端口、无卷 Redis，真实原子限流集成测试 1 项通过，临时容器已清理；未连接生产 Redis。
- ECS 跳板 deploy-gateway 为禁止 shell 的隧道账号；同一部署 key 的 root 登录不可用。正在确认既有 ECS 配置管理入口，不放宽 SSH 或主机指纹校验。
- 已复用既有 ECS 云助手管理入口，确认主站 Nginx 追加 XFF；边缘配置已备份到 /root/shoushou-security-edge-backup-20261013T114125Z，配置预检通过。开始准备 v0.16.16 提交与版本化发布，操作输出另存 H 盘发布目录。
