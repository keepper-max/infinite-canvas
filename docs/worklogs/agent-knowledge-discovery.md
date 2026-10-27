# Agent知识引用与决定表单简化

## 已核实根因

生产任务a3a5877c…先成功查询项目和画布。模型随后读取个人空间中全零documentId，并在同批安排搜索；实际读取不存在文档先失败，搜索尚未执行却被统一标成同样失败。该空间归属账号本人，6篇有效文档、0篇删除文档；“授权资料”只是前台缺标题时的占位文案。原4条模型Job均resolved/settled，已扣4积分、预留0；本轮未重跑或修改生产任务。

## 最小修复

- tools：无真实来源时不向模型开放read_knowledge/list_knowledge_relations；保留search_knowledge，从其结果或已验证来源取得ID。两类读取调用均检查spaceId与documentId对，禁止全零或未发现引用。真实知识权限继续由KnowledgeService验证，发现引用不等于授予权限。
- service：模型返回及工具实际执行前复核引用，覆盖历史回执执行路径；工具真正开始才标running，前序失败后的pending步骤标cancelled/AGENT_BATCH_NOT_EXECUTED。既有完成步骤保留，不自动重试模型或工具。
- presentation：未执行与失败分别展示，不把占位名称伪装成真实资料标题；无效引用给出搜索提示。已删除文档返回明确DomainError，不误报付费执行状态不明。
- 前台仅移除CreativeDecisionsPanel入口及挂载，不再产生该表单的数据请求。Agent自动沿用当前会话上下文并自主判断何时查询资料；既有用户显式保存的记录及后台服务保留，不自动启用或新增跨会话长期记忆，实际业务写入仍审批。

## 验证与限制

- 当前已提交基线bef7604（v0.16.53）复制到H盘隔离候选，仅覆盖本次4个Agent模块、面板文件与新增测试，保留工作区其他DS/官网变更。
- 新增5项测试覆盖发现后读取实际正文、伪造引用在暂存工具前拒绝、不同空间引用拒绝、批次部分完成后失败与未执行区分、来源撤销停止。连同既有自动交互/只读/范围测试共37项通过，无跳过；包含真实PostgreSQL和认证HTTP，模型为明确测试替身，供应商调用0。
- 前后端候选tsc --noEmit通过。Playwright对本地真实API页面完成4项检查：决定表单移除、模型选择保留、输入可用、无决定API请求/浏览器异常；截图包括桌面与窄屏。
- 首次隔离库重启为空，补齐正式迁移后重测；既有写入测试需要隔离策略开启，修正测试环境后通过。复审发现新引用预校验提前解析了其他工具，影响原错误优先级，已限定只检查两类知识读取；既有范围与审批回归重测通过。
- 证据目录H:/CodexStorage/shoushou-agent-knowledge-discovery/artifacts。没有把本地替身测试当成真实DS生成通过，未提交、推送或部署。原暂停任务需上线后由用户明确续跑；历史错误记录不自动重写。

## 修改清单

4个server/api/src/native-agent模块：tools.ts、service.ts、conversation-policy.ts、presentation.ts；web/src/components/native-agent/native-agent-panel.tsx；新增server/api/tests/native-agent-knowledge-discovery.test.ts；CHANGELOG、pending-test、todo及本文。无迁移、无运行预算/超时/重试边界调整。

## 后续获准发布

用户明确批准commit/push/部署后，已发布v0.16.54，代码2d74e5ba5fe6。独立API/Web构建通过，两个Linux候选镜像各24项及正式浏览器9项通过；100表/1667对象备份恢复验证完成。仅更新API、Agent Worker和Web，51条迁移不变，AutoCut及其他工作区修改保留。

原暂停任务保留且未重跑，6张Agent历史表和10张计费表摘要不变，新增付费模型调用0。保护画布29节点/27连线完整，生产表单已移除，验收会话撤销后401。完整哈希、制品、限制及回滚见ops/releases/v0.16.54-agent-knowledge-discovery.md；上述“未发布”描述仅对应本地开发阶段。
