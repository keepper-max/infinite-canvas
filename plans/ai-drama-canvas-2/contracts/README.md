# AI 漫剧生产画布 2.0 契约索引

本目录是第 1–8 部分共同遵守的规范。实现与本文冲突时，先修改契约并记录迁移方案，不能在单个页面或 Provider 内自行创造另一套字段。

- `baseline-and-recovery.md`：本地/ECS 基线、备份、恢复与敏感配置清单。
- `canvas-graph-contract.md`：通用节点、业务用途、端口、连线与旧数据兼容。
- `assets-and-jobs-contract.md`：资产版本、生成任务状态机、幂等与事件。
- `model-gateway-contract.md`：模型注册、能力声明、四类视频模式和参数过滤。
- `platform-boundaries-and-api.md`：Web/API/Worker/存储边界、目录、ER 草图及 API 错误格式。

## 版本规则

- 当前契约版本：`1`。
- 数据库、画布快照和任务输入均保存 `contractVersion`。
- 新字段优先可选并提供默认值；删除或改义字段必须新增迁移器。
- 对外显示名可改，稳定 ID 不改。

