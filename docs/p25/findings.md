# 核查与决策

- 画布统一事务入口是PostgresPlatformRepository.applyCanvasOperationForUser；不得另建持久化链。
- 现有模型Provider有chat/completions，但尚未发现tool_calls执行链，需进一步读码。
- 已有Agent组件和两套store，先明确本地Codex适配与原生入口边界，不能把Codex当平台Runtime。
- 使用planning-with-files保留阶段证据；评估开源组件时按github-project-onboarding核查官方源码/许可，UI按impeccable沿用既有风格。
- 先前PowerShell rg通配路径不适用，后续使用rg目录及-g过滤。

- 用户已批准资源限制，真实1元模型预算仍未回复。
- 决定候选：AI SDK7.0.152 + compatible3.0.77（Apache2、Node>=22、Zod4兼容）；Mastra1.79.0核心包约83MB且引入独立状态/工作流体系，本项目已有PG/BullMQ/权限/CAS，优先保留SDK工具协议与流解析，运行状态作为业务层持久化，不重写通用框架。
- 当前Agent入口实际受CODEX_AGENT_ENABLED控制并直接装载LocalAgentPanel；原生入口需独立服务端能力检查，不能启用本地Codex依赖。
- 画布CAS操作kind有白名单，需仅增Agent受控类型并在事务内重验Agent灰度。KnowledgeCanvasService.add已正确校验知识引用并使用同一CAS。
- 首次业务验收暴露测试替身把全文搜索的模糊命中误当成三篇不同资料；已要求替身按真实返回标题消歧，并补充3个来源ID必须互不相同的断言，不能只凭节点总数判断完整性。
- 超长无空白中文文本会导致BPE分词耗时异常；上下文估计改用固定小块分词，正文含特殊Token标记按普通数据处理，计入工具Schema和协议/输出预算。该估计不能当作未验证供应商的计费证据。

## 最终更新

用户授权读取服务器既有API配置并测试低价文本模型，替代早期“尚未回复”状态。已完成JobService桥接与真实Qwen验收；付费只读路由配置使用后未提交私密内容。真实费用、未完成边界见delivery.md，不将先前进度描述当成最终状态。
