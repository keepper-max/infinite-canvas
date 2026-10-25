# Findings
接口 https://pinhaozhan.vip；GET /v1/models 返回8个模型，目标 deepseek-v4.1-flash。
GET /api/pricing: model_ratio=0.006849、completion_ratio=4、default group_ratio=1，token计费。
GET /api/log/token/ 和 /api/usage/token 可用，无历史账单。最初默认 User-Agent 被403；Mozilla/5.0只读成功。
现有 Token360 账单端点和目录格式不兼容，需独立适配；不能换地址后直接复用。
参考 https://doc.newapi.pro/en/guide/console/settings/rate-settings/ 和 https://docs.newapi.pro/en/docs/guide/feature-guide/user/log。

## 发布验证补充
- 生产双栈访问曾间歇超时；拼好站专用Undici IPv4连接保留DNS/TLS，无固定IP和重试，其他渠道不变。
- 模型曾返回{parameters:{}}而非{}；严格拒绝并保留已结算账单，不剥除字段。补充固定工具格式提示。
- AI SDK 7拒绝messages中的system角色；固定提示通过现有SDK系统入口传入，计入请求指纹和contextCost，不启用allowSystemInMessages。已补实际SDK/封装Linux Node22流式协议验证。
- 生产实际核验通过：2轮、只读get_canvas_state、2笔费用结算；默认与可选模型通过服务端CAS审计策略保存，非管理员管理接口拒绝。
