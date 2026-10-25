# 测试证据与实际限制

证据根目录 `H:/CodexStorage/shoushou-p25/artifacts`，全部业务写入仅发生在自有隔离 PostgreSQL；外部费用只有已授权的低价文本模型。

## 通过的执行

- native-final.txt：Node test 原生 PG/SDK/权限/审批/CAS/取消/故障测试20通过、0失败、0跳过。model-job-final.txt 是随后对费用桥接的复验1通过，包含8类检查（model-job-check.json），不重复计入总数。native-agent-schema.test.ts 另1项通过。
- existing-unit-final.txt：110通过，覆盖图片/视频/音频 Provider、计费、重试、画布协议/兼容。
- regression/final-output.txt：45通过，覆盖真实PG、HTTP、知识保真/搜索/关系/图谱/Latest-Pinned、R1-F门禁、注册登录及积分账本。
- browser-check.json：10项真实Playwright通过、errors=[]；最终项目054bff5d-e613-4a8a-b659-64c4b94b4de9，revision2，审批后4节点3连线。覆盖响应丢失、刷新/离线、草稿、键盘提交约束、会话反馈、浅色390px布局；不把此替身标成真实模型。
- mcp-check.json：真实stdio 0.4.0/13工具，6检查通过（CAS写入、相同操作回放、冲突、回执、旧写入口拒绝），只启动隔离MCP。
- real-model-check.json：真实Qwen API，三份原文请求证据、3知识节点+1文本+3条边、revision7；同一会话4次Run完成检索、正文、节点、连线，前两次未写入，明确保留失败验收历史。
- Windows API tsc、Web tsc/Vite通过；linux-node22-final.txt 记录Node22.23.2构建及模块导入通过；仅既有Vite chunk/动态导入警告。
- restore-final.json：pg_dump恢复到全新目标，专用真实模型账号/项目14表计数与内容摘要全相同。备份位于 H:/CodexStorage/shoushou-p25/pg/p25-final-20261024.dump；这是测试数据备份，不是生产恢复验收。

## 复现与修复闭环

- 原生页面初始化异步草稿恢复会覆盖早期输入：初始化就绪前禁止提交和输入；浏览器加入等待及草稿断网/刷新检查。
- 快照并发下可能报40001或旧响应倒退状态：改为一个SQL聚合读取同一MVCC快照，前端按Run revision拒绝旧快照。重复回归通过。
- 快捷键可绕过禁用按钮、会话切换残留保存提示：submit统一校验，切会话清理保存状态；独立UI finish review ship，浏览器已覆盖。
- 真实Qwen先只输出文字计划：节点输入Schema改为根对象，严格服务端条件校验不变，随后实际写入成功；模型仍需明确续令完成边，不能宣称单指令可靠全自主。
- USD账单已返回但本地缺汇率时正确阻止工具，原任务核验后使用同一Step恢复，没有再次提交模型；新增故障注入模拟持久化后回执丢失，并发核查只提交1次、1轮、1账单。
- 预算原先只计供应商成本：改为实际积分含加价/取整；新增取整差异测试通过，原生成费用逻辑不改。
- 最终既有PG回归第一次从LF测试副本启动，遇到旧CRLF迁移哈希不匹配，迁移器正确拒绝且未改原迁移。核对隔离库记录与正式源码字节完全一致后，改回正式源码工作目录重跑45项通过；没有改生产迁移哈希或关闭校验。

## 未验收

真实Windows中文输入法、物理手机/读屏器/其他浏览器、长期负载、完整生产运维及真实充值人民币结算未测。Qwen分词预检仍为跨模型估计；实际输入+输出工具前复核，不能保证超长输入无已发生费用。3个被拒GPT请求保留待核账预留；不自动免费、不自动付费重试。缺少授权的模型路由未强行使用。

截图desktop-approval.png、desktop-completed.png、light-completed.png、mobile-completed.png为替身浏览器；real-desktop-completed.png等为真实模型结果只读截图。native-agent-demo.webm为最新替身浏览器录屏，不冒充真实供应商运行录像。
