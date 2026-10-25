# 运行、迁移与接口

## 本地服务

正式源码工作目录 `H:/CodexStorage/infinite-canvas-auth-upgrade/server/api`。已运行的独立容器为 shoushou-p25-pg（PG16.14）、shoushou-p25-redis（Redis7）；端口仅回环可达，DB=p25_isolated。不要停止用户已有 r12 或其他容器。

当前三个独立后台进程：`node --import tsx scripts/native-agent-lab.mts`（3195）、同脚本加 `--worker`、`node --import tsx scripts/native-agent-fixture.mts`（3295）；Web 在 API 目录执行 `node scripts/native-agent-web.mjs`（5195）。启动前确认端口没有被占用；重复运行会冲突。所有临时数据/模型替身/自动登录只在这些隔离脚本内。

回到本地浏览器访问 `http://127.0.0.1:5195/__p25/login`，进入有 4 节点/3 连接及已完成会话的雾港验收项目。真实模型结果已另存专用项目及截图。可新建会话，在执行模式输入「根据雾港世界观、林岚和周可的设定搭建第一集流程」，逐批检查审批，使用测试替身不产生费用。再次执行是新的逻辑操作，会按计划新建节点；不要把它当成旧操作重试。

## 正式源码配置边界（本轮不发布）

- NATIVE_AGENT_ENABLED 默认关闭；API/专用 Worker 必须同时明确启用。`npm run native-agent:worker` 启动持久化 Worker，普通生成 Worker 不消费原生推理私有任务。
- NATIVE_AGENT_DEFAULT_ENABLED 默认关闭；通过既有管理员身份调用 `/api/native-agent/admin/grants/:userId`，body={enabled,reason}，审计并保留独立撤销。仍须项目/知识权限，不能扩大授权。
- NATIVE_AGENT_PAID_ENABLED 默认关闭；现有服务器凭据由已有 ProviderConfig 服务端注入，禁止进入前端。Token360 路由设置 NATIVE_AGENT_PAID_ROUTE=token360、NATIVE_AGENT_PAID_MODEL_ID=catalog.text.qwen3.5-flash；调用前核验现有目录价格及人民币汇率，缺失即拒绝，不修改普通生成模型默认渠道。
- NATIVE_AGENT_FIXTURE_URL 仅接受非 production 的 127.0.0.1 HTTP，正式进程拒绝替身。原有本地 Codex 入口改为显式 CODEX 开关，不作为网站原生 Runtime。

## 数据库增量

新增 0050_native_agent.sql、0051_native_agent_active_clock.sql、0052_native_agent_model_jobs.sql，按序建表/索引/活动时钟/可信模型任务绑定；没有清空、修改余额、降 revision 或删除历史。Drizzle 映射 `src/db/native-agent-schema.ts`，SQL 权威约束/外键/部分唯一索引。原迁移不改；Linux 制品必须保留已记录 LF 字节，不把 Windows CRLF 哈希套到别的环境。

正式发布前需另行备份并在目标生产结构副本复演，迁移校验与旧流程一致。回滚优先关闭付费和新增 Run，保留原数据与读取；不 DROP 表、不清回执、不重开旧 MCP，不取消已核实费用。未知供应商结果保留原任务及预留。

## API 与幂等

`GET status`、`GET/POST sessions`、`GET sessions/:id`、`POST sessions/:id/close`、`POST sessions/:id/runs`、`POST runs/:id/cancel`、`POST runs/:id/reconcile`、`POST approvals/:id`、`GET runs/:id/events?after=cursor` 均位于 `/api/native-agent`。复用正式登录/CSRF/错误映射，不能从普通用户传入 actor/project override。

新 Run 提供 operationId、prompt、modelId、mode、budgetCents；审批提供 operationId、expectedRevision、payloadHash、decision 及可选 instruction。丢响应先查原会话/原任务；状态不明不换 operationId 自动重试。reconcile 只恢复已核验/已结算/已释放且有可信原始产物的同一模型步骤，权限重验，并发只物化一次。

协议版本和消息版本各为 1；事件按 session/run/turn/item 归属，物化消息权威，cursor 只补实时内容。单 SQL 快照保证同一 MVCC 视图，前端拒绝旧 revision 覆盖新状态；API 返回成功代表实际持久化。

## 运行约束与费用

用户已批准：16模型轮、32工具、64k累计Token、单轮12k/最大输出2k、有效15分钟（审批等待不计时）、每用户1未结束Run/全局2执行、模型60秒/工具30秒。未知模型或业务写入不自动重试；写入超时可能已提交，保留原回执并暂停，不声称自动回滚。

预算按既有人民币积分实际扣减，包含1.2加价与取整；供应商原币/人民币成本另存原账单。Qwen 单轮保守预留12分、豆包全模型窗口含加价100分；价格/汇率不符拒绝推理，未来修改报价需按仓库规则说明影响。当前 Qwen 12k预检是估计，实际超限工具前停止，不能当作精确分词器。没有媒体生成工具或自动付费重试。

## Windows 中文输入法人工清单（未通过声明）

使用真实 Microsoft 拼音及系统候选窗口：输入多句中文、候选选词/换词、Enter选词与换行、Ctrl+Enter发送、组合中关闭并重开面板、刷新恢复草稿、长文粘贴和中英文切换。组合未结束时不得触发发送；当前代码检查isComposing，但自动事件不能替代人工签字。记录Windows/浏览器/输入法版本、输入内容、实际结果及录屏。
