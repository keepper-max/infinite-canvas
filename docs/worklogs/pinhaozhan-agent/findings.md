# Findings
接口 https://pinhaozhan.vip；GET /v1/models 返回8个模型，目标 deepseek-v4.1-flash。
GET /api/pricing: model_ratio=0.006849、completion_ratio=4、default group_ratio=1，token计费。
GET /api/log/token/ 和 /api/usage/token 可用，无历史账单。最初默认 User-Agent 被403；Mozilla/5.0只读成功。
现有 Token360 账单端点和目录格式不兼容，需独立适配；不能换地址后直接复用。
参考 https://doc.newapi.pro/en/guide/console/settings/rate-settings/ 和 https://docs.newapi.pro/en/docs/guide/feature-guide/user/log。
