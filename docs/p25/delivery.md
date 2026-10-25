# P2.5 原生 AI Agent Runtime 本地交付

## 结论与入口

已实现可独立运行的服务端原生 Runtime；真实 Qwen3.5 Flash 通过工具调用和用户审批保存了 3 个知识节点、1 个文本节点、3 条有效连接。不是把模型普通文本解析为执行结果。

本地入口：http://127.0.0.1:5195/__p25/login 。这是仅绑定回环地址的隔离脚本，自动登录合成验收账号；正式应用不包含此免密路由。进入画布后点击顶部「原生创作助手」。API 3195、Web 5195、协议替身 3295、PostgreSQL 55485、Redis 56385。当前付费模型入口已关闭，面板只显示明确标记的协议替身，避免继续产生费用。

基线 HEAD `82cea69` / v0.16.35，正式仓库 `H:/CodexStorage/infinite-canvas-auth-upgrade`。没有提交、推送、创建分支、部署、修改生产配置或生产数据。仅按用户授权只读使用既有服务器模型配置进行开发测试。`website/content.js` 用户既有修改保持 SHA256 `E7E8D90B8B06FC10EB16DC0F0036F174C6D073C0FEF730DA004523E2A0EE2A5F`。

## 已交付

- PG Session/Run/Step/Message/Approval/Usage/Event，独立协议版本与消息版本；数据库原操作 ID、参数哈希、每用户未结束任务唯一约束及持久化队列恢复。
- AI SDK 严格 tool_calls、流式消息、13 个注册工具、建议/执行模式、知识来源版本/哈希、审批修改/取消、权限重验、CAS 冲突停止、既有 Markdown 与画布事务复用。
- 既有 JobService/JobExecutor/CreditService/BillingService 模型桥接，数据库原子费用预留、真实账单核对、原任务回执恢复；不增加 Agent 货币，不改变原有媒体生成和人民币结算规则。
- 画布原生右侧面板、历史、执行记录、重连、刷新/草稿保护、保存及定位反馈；未保存画布禁止远端结果覆盖；深浅主题、390px 基础布局、懒加载。
- 默认关闭的服务端 native_agent 权限，独立于 knowledge 灰度并叠加现有项目/知识权限；普通项目成员不能读取他人的私有推理正文或重试该模型任务。

工具：search_knowledge、read_knowledge、list_knowledge_relations、create_knowledge_document、suggest_knowledge_relation、apply_knowledge_relation、get_project_context、get_canvas_state、list_canvas_nodes、create_canvas_node、connect_canvas_nodes、update_canvas_node、get_job_status。首批画布写入仅支持 text 与 knowledge:document；不提供删除、任意 metadata、SQL/Shell、付费媒体或新增 MCP 工具。

## 依赖与许可

新增直接依赖 AI SDK 7.0.152、OpenAI-compatible 3.0.77（Apache-2.0、Node>=22）及 js-tiktoken 1.0.21（MIT）；锁文件新增/调整12个条目，完整清单见 artifacts/dependency-licenses.json。传递依赖 json-schema 为 AFL-2.1 OR BSD-3-Clause，本项目采用其 BSD-3-Clause 选项并保留随包许可声明，其余为 Apache-2.0/MIT。没有引入第二套身份、存储或工作流框架。

## 真实模型结果与费用

专用隔离项目 `47d91dbb-53a3-49c0-b1e0-af8faf086885`，会话 `cc595c1c-ce9d-462c-adf8-b59a5cb08773`，最终 Run `1edc3fa0-4962-4bf1-b0d3-7d44c6198196`。最终画布 revision=7，4 节点/3 连接；三篇原文在真实供应商协议请求的 tool 消息中逐篇核对，固定引用 revision 与 contentHash 保留。详情见 `H:/CodexStorage/shoushou-p25/artifacts/real-model-check.json`。

这是同一真实会话的多轮验收，不能宣称一次自然语言指令自动完成：前两次 Run 仅检索/阅读和文字计划，改为根对象工具 Schema 后模型通过实际写工具创建节点；随后用户式明确续令完成连线。每个 Run 最多 5 个模型轮次；模型布局较粗糙，后续可由用户手动整理。HTTP 协议替身的一条指令端到端验收另有浏览器证据。

Qwen 共 19 次成功结算，供应商合计 USD 0.00548801，按既有 6.8 汇率为 CNY 0.03731846；隔离积分账本逐任务加价/取整合计 19 积分（¥0.19）。另 3 次 GPT-4.1 Mini 路由被拒绝，仍待供应商拒绝账单核查，保留预留及原任务，不当成免费成功、不自动再提交。豆包路由因原服务账号未开通被拒绝并确认非提交。这些均不是生产用户扣费或媒体生成验收。

实际收费请求已停止。用户授权测试总上限 ¥1，现有已结算与未确认预留均在上限内；当前本地服务不加载付费凭据。费用证据 `real-model-costs.json` 保留原币金额、结算状态、人民币成本；没有打印或提交 API Key。

## 验证结果

- 原生后端真实 PG：20 项通过；新增工具 Schema 1 项通过。费用桥接测试重新单独运行通过，覆盖 8 类检查，包括加价/取整和回执丢失并发恢复；该测试已包含在上述后端集合，不能重复累加总数。
- 既有业务真实 PG/HTTP：45 项通过，无跳过，覆盖知识/图谱/Latest-Pinned/权限/CAS、任务重试、积分、注册登录；相关 Provider/计费/画布单元回归 110 项通过。
- Playwright 真浏览器 10 项通过、pageerror=[]；MCP 实际 stdio 0.4.0/13 工具，6 项检查通过；没有切换正式 MCP。
- Windows API 构建、Web 类型检查与 Vite 构建通过；Linux Node 22.23.2 独立依赖副本构建及 Runtime 导入通过。Web 保留既有大 chunk 警告；助手懒加载块约 24.14 kB / gzip 9.55 kB。
- 自有隔离数据库 pg_dump 恢复至全新 `p25_restore_final_20261024` 成功，专用真实模型账号/项目 14 张表计数及行内容摘要完全相同。不是生产备份承诺；浏览器新增的无关项目可能晚于备份快照。

证据与测试失败定位见 [test-report.md](test-report.md)，UI 审核边界见 [ui-review.md](ui-review.md)，运行与接口见 [runtime.md](runtime.md)。完整文件及 SHA256 清单、补丁位于 `H:/CodexStorage/shoushou-p25/artifacts/changes.json` 和 `p25-working.patch`，不包含用户官网修改及私有凭据。

## 未完成与发布限制

- 未部署生产；生产灰度、迁移、Worker 发布和真实人民币充值/支付验收需要另行授权，知识付费媒体生产门禁未开启。
- Qwen 预检使用 o200k 估计，不是其官方精确分词器；实际返回用量会持久化并在执行工具前复核 12k/64k，超限停止。不能保证估算偏差导致的已发生推理绝不收费；费用另有保守报价和原账单门禁。长文输入仍需完善该模型的精确预检，不能把本次短文结果作为长文硬上限证明。
- GPT 兼容路由不可用、豆包账号未开通；当前仅 Qwen 完成真实工具业务验收。旧失败请求账单仍待核查，不释放不明预留。
- 真实 Windows 中文输入法、物理手机、读屏器、多浏览器、长期运行与生产负载未验收。浏览器自动事件不能替代人工输入法。
- 没有 Agent 自主删除/覆盖、付费图片/视频/音频、复杂长期记忆或新 MCP 工具。知识关系仍通过 Markdown Wiki Links，不写 CanvasConnection 伪造知识关系。

到此暂停，等待用户体验，不自动进入生产发布或下一阶段。
