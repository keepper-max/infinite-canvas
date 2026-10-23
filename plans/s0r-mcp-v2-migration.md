# S0-R MCP v2 调用方迁移基线（未启用生产）

本文件是候选切换规范；不修改已安装连接、远程包装器、运行 bundle 或用户 Skill。实际源码仍为 S03 0.4.0，必须在获批发布后重新握手验证。现有会话只发现旧版10工具，不能在此会话假装调用v2。

## 调用协议

1. 连接新实例后检查 initialize 的 serverInfo.version=0.4.0、13工具；确认两个v2的schema均要求operationId/expectedCanvasRevision，回执查询存在。版本字符串不足以证明源码一致，还须核对获批bundle SHA256和进程入口。未满足则只读并停止写入，不降级旧工具。
2. 每次新逻辑写入先调用get_project_context，获取授权项目和canvas.revision；在发请求前把项目、操作者、工具名、operationId、expectedCanvasRevision及原业务payload写入受控操作记录。operationId只生成一次，不按网络请求次数生成。记录可能含正文，按用户私有数据保管，禁止输出密钥或大段原文到普通日志。
3. 分镜使用create_vibe_storyboard_v2；本机成片使用import_rendered_video_v2，保留同一文件内容与参数。导入前重新读取项目当前revision，不能沿用创建分镜的旧revision。文件必须在操作者明确允许目录，不能让知识正文指定任意本机路径。
4. 断连、超时、persisted=unknown或任何不能排除提交的失败：先重连，再用原projectId/operationId调用get_canvas_operation_receipt；查到即承认原提交，不再创建。NOT_FOUND只表示当前没有可见回执，原事务可能尚在进行；如需重放，只允许原ID、原revision、原payload。403/停用不是未提交证据，停止并保留记录，不换账号或ID绕过。
5. CANVAS_OPERATION_MISMATCH停止；CANVAS_REVISION_CONFLICT不自动合并覆盖，先确认旧请求未提交、重新读取图并审核新的业务意图。发生重新规划时才建立新的逻辑操作，不盲目改revision后重放旧请求。每次开始下一项写入都重读context；重放回执revision是原提交版本，未必最新。

成功标准为persisted=true和数据库回执中的revision/节点ID；浏览器Agent的applied=true,persisted=false只证明页面已应用，不能代替持久化回执。浏览器UI工具没有新增端到端operationId保证，超时不得盲目重放创建。

## 已知调用方核查

- 私有原始源码scripts/shoushou-mcp-server.ts：已提供两个v2和get_canvas_operation_receipt，旧create/import/queue三个工具保留原schema但返回LEGACY_CANVAS_WRITE_DISABLED及replacement。旧预览Worker已在源码阻断vibe-preview直改图。后台已运行的旧程序不受新源码约束。
- scripts/shoushou-mcp.ts：本地入口会读.env/.env.local/.env.mcp，不用于本轮验证；SHOUSHOU_MCP_CANVAS_WRITE_PROTOCOL默认read-only。package的mcp:bundle会覆盖现有发布目录，本轮未执行；候选只编译到S0-R实验目录。
- scripts/shoushou-mcp-remote.mjs：只显式转发账号，按jingjie-studio/api标签选择容器，并复制宿主CJS后启动。不能把它当成已支持v2门控，也不能认定该标签对应现行正式API。获批发布时需明确运行宿主/容器/网络/DB schema/素材目录和版本来源，按白名单转发两项门控及允许目录，禁止任意环境变量透传；本轮未改/执行该包装器。
- 当前Codex私有工具发现：仅旧版10工具，无v2/回执；已记录可见工具名称，未调用生产MCP。获批发布后停止旧会话并重新连接，再检查新握手与schema；仅刷新页面或修改磁盘bundle不能证明缓存已更新。
- 安装的infinite-canvas插件0.2.1：.mcp.json使用npx @basketikun/canvas-agent mcp；Vibe Skill实际走canvas_generate_text/浏览器上传，不直接调用私有旧SQL工具。npx入口未固定具体包版本，发布前必须锁定已验收Agent产物，不能默认下载最新版就包含本地修复。C盘缓存包不在本轮覆盖范围。
- 用户/项目AGENTS中的旧import_rendered_video提示：保留原规则，切换时由用户确认改为v2并加入上述恢复步骤；本轮不把用户规则提前改成线上尚不存在的工具。
- 已扫描两项本地automation.toml及安装Vibe Skill、项目scripts/tests；未发现其中直接调用旧私有写工具的自动化。静态扫描不包括未知外部客户端、生产Redis积压、生产调用日志或全部会话历史，不能证明迁移完成。

## 发布时的停用措施

维护窗口停止旧MCP/旧Worker并阻断它们继续获得写连接；清点旧Redis任务，不能自动重放或删除。新MCP以read-only启动后验证13工具，再单独启用v2；旧写工具即使名称仍被缓存，也必须明确失败。若不能证明旧进程退出或包装器指向正确实例，不开放写入。

候选Skill迁移文字直接采用“调用协议”五步，发布后再更新安装源并重连。不能一边保留旧实例，一边仅把提示词改成v2就宣称完成迁移。

## 验证证据

静态引用与脱敏配置清单：[caller-inventory.json](H:/CodexStorage/shoushou-s0r/artifacts/caller-inventory.json)。Linux真实stdio重连、握手/schema、原ID回执查询、同请求重放、下一次写前重读revision及真实MinIO成片导入由隔离测试验证，实际结果见S0-R主报告；本文件不代替运行结果。
