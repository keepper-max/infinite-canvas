# 网宿 Seedance 2.5 接入

## 协议与费用证据

- 用户指定模型：`doubao-seedance-2-5-260628`。
- 官方控制台模型详情与其链接的[模型文档](https://doc.model-store.ai/ai-gateway/model/support-doc)提供接口示例。公开模型详情接口：`GET https://doc.model-store.ai/api/aisite/v1/model-plaza/detail?modelId=doubao-seedance-2-5-260628`；示例查询：`POST /api/aisite/v1/model-configs/access-template`，请求体 `{"type":1,"id":"doubao-seedance-2-5-260628"}`。
- 官方同时提供 OpenAI 兼容 `/videos` 和豆包原生协议；本次采用 `https://api.edgecloudapp.com/v2/llm/doubao/contents/generations/tasks` 创建任务，追加 `/{video_id}` 查询，复用现有原生适配器、对象存储引用与任务恢复链。
- 480p/720p 无视频输入：70 元/百万 Token；有视频输入：42 元/百万 Token。1080p 分别为 77、46 元/百万 Token；四档与现有 Seedance 2.5 刊例算法一致。人民币成本进入现有账本，再按现有规则逐笔向上取整为整数积分，来源记为 `wangsu_model_catalog`。
- 缺失、空值或非法实际用量进入 `manual_review`，保留积分预留；失败本身不作为供应商未计费的证据。只有回执明确 `billable:false` 时允许按零成本处理。

## 本地实现与上线准备

- 新增迁移 `0057_wangsu_provider.sql`，只追加渠道与视频路由，不切换当前渠道、不修改旧任务。API 与 Worker 启动时注册单个模型；刷新保留管理员已有模型启停状态。
- 服务端 API 与 Worker 均须注入 `AIGATEWAY_TOKEN`；`WANGSU_API_BASE_URL` 默认 `https://api.edgecloudapp.com/v2/llm/doubao`。Compose 和环境模板仅引用变量，无真实凭据。
- 后台入口 `/admin/models/wangsu`（模型 → 网宿 AI）。沿用现有全局渠道切换机制：该渠道当前只有视频模型，设为画布渠道后文字、图片和音频模型不会出现在可选列表，页面已提示。现有任务使用自身已保存的渠道继续运行。
- 首帧、首尾帧、多模态参考和续写复用现有映射；时长仍沿用现有方舟目录的 5/10 秒选项，未扩大行为边界。供应商介绍中的最长 30 秒尚未扩展到画布参数选项。
- 生产启用前先备份数据库与服务端环境配置，应用增量迁移、注入轮换后的密钥、更新 API/Web/Worker，再做真实生成与扣分验收。需要撤销时在后台切回原渠道，保留新渠道和账单记录，避免删除历史。

## 验证与限制

- API/Web 类型检查通过；72 项定向测试全部通过，覆盖模型目录、创建/查询、参考角色、失败/缺结果/鉴权失败、四档成本、用量缺失与现有任务/账本/积分回归。命令：API 目录运行 `node --import tsx --test --test-concurrency=1 tests/wangsu-provider.test.ts tests/volcengine-ark-provider.test.ts tests/billing-service.test.ts tests/model-gateway.test.ts tests/job-service.test.ts tests/credit-service.test.ts`，API/Web 分别运行 `npm run typecheck`。
- 修正 Token360 按同名上游模型更新所有渠道的问题，限定更新自身渠道，避免覆盖网宿原生参数。
- 未执行生产迁移、未部署、未注入真实密钥、未发起付费视频；生产真实响应、下载入库和积分扣款仍需验收。未执行完整构建或数据库集成测试。
