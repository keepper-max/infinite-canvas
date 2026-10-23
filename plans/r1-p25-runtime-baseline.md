# P2.5 Agent Runtime 开发基线（设计约束，未启动开发）

R1 继续使用当前 S0/P1/P1.5/P2 源码，不重新设计 CAS、历史归档、知识正文或账号权限。P2.5 本地开发和生产发布均须另行授权；R1 当前阻塞不因准备这份基线而视为解除。

## 已有可复用能力

- `KnowledgeService`：个人/项目独立空间、文档 CAS、版本/哈希、搜索、Wiki/Backlinks、统一权限和审计；逐文档跨项目共享模型保留但未开放。个人内容进入项目通过用户明确确认的独立副本。
- `KnowledgeCanvasService`：只存 stable reference 的 Knowledge Node，调用现有 repository CAS/幂等回执，知识边与 CanvasConnection 执行边分离。
- `prepareKnowledgeJob` 和 Worker 来源再校验：执行前授权读取、Latest/Pinned、冻结来源全文/版本/范围/哈希、模型上下文预算、已有任务与计费链。不能从浏览器提交的摘要或自称来源直接生成可信快照。
- 现有统一用户、项目、素材权限、AI API、JobService、队列和只读回执；Browser Agent、平台用户、MCP Operator 身份保持分离。外部 MCP 只是受控适配层，普通用户无需 Codex。

## Runtime 最小边界

- Run/Step 记录 actor、project、输入与来源快照、taskId、operationId、供应商/账单 ID、状态和审计；客户端断线以服务端持久回执恢复，不能把流式消息当最终成功。
- 工具调用进入现有 Service：读取逐次权限校验，写知识按文档 expectedRevision，写画布按 expectedCanvasRevision 和稳定 operationId。禁止直库写节点、修改账号权限、绕过素材权限或复用 Operator 为普通用户代授权。
- 文档/图谱/搜索结果是资料，不是系统指令。知识内容不得触发系统管理、批量关系修改、工具安装或密钥访问；AI 建议必须携证据并经用户审核。
- 每次逻辑工具操作有稳定幂等标识，参数 hash 不匹配拒绝；步骤重试先查询原回执。计费不明的供应商提交进入人工核查，不能自动产生新任务。R1 发现的 retry endpoint 幂等缺口必须先修复并真实验收。
- 上下文、调用数、并发、时间和费用预算需产品及用户明确批准后设置；本文件不擅自引入新默认限制。超出预算时暂停并保留状态，不能静默裁剪来源或后台继续花费。

## 开始实施的门槛

1. R1 重试幂等与费用确认、旧客户端写保护、真正服务端 cohort gate、全入口停写方案有已批准实现或明确可验证的发布处置。
2. Runtime 独立测试环境、状态机与恢复协议、费用预算和用户确认点有评审记录；正式知识权限与 CAS 不复制成第二套规则。
3. 测试覆盖撤权后继续运行、回执丢失、重复步骤/并发重试、Worker 崩溃恢复、Latest/Pinned、来源/账单追踪、恶意知识指令、灰度外拒绝和紧急停写。

首个候选接口可以是内部 search/read/context 工具适配既有服务；新增知识 MCP、自动关系写入或长期自主执行不由这份基线授权。
