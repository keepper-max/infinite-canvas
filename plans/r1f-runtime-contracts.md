# P2.5 可复用的任务与权限接口

本轮只提供已实现接口约束，不实现 Agent Runtime。

- `POST /api/jobs/:jobId/retry`：新调用传 `{retryOperationId: UUID, expectedInputFingerprint?: SHA256}`。同一逻辑操作直到确认结果都保持同ID；参数冲突409。第二次独立重试显式生成新ID，但仍须整个重试任务族的执行和账单状态可核验；任务族共用数据库事务锁，不能通过回到祖先任务绕过保护。
- `GET /api/jobs/:jobId/retry-operations/:operationId`：丢回执先查此接口；仅404允许同ID重放POST。超时、403、409不能换ID盲重试。回执、任务和attempt是不同身份；读取仍检查当前用户和权限。
- `GET /api/features/knowledge`：当前用户授权状态。管理员 `GET/PUT /api/admin/features/knowledge/users/:userId` 读取/变更授权，PUT为 `{enabled:boolean,reason:string}`；管理员身份来自已有服务端账号/受控配置，调用方无法自报管理员。授权不会赋予额外项目权限。
- `POST /api/projects/:projectId/canvas/write-capability`：传 expectedRevision 和从实际读取画布得到的 acknowledgedKnowledgeNodes（稳定ID与原knowledgeReference，按ID排序）。服务端核对真实数据、权限与灰度后签发一次性token；不将token写入画布metadata。全量PUT带 `{writeCapability:{token,deletedKnowledgeNodeIds}}`。能力凭据不是项目权限或灰度凭据。
- 内部Agent知识读取必须调用 KnowledgeService；画布知识引用使用 KnowledgeCanvasService。新增服务器操作只可复用现有CAS事务，追加操作保留旧知识引用，不能用“可信source”接受任意全量图。语义知识链接仍与 CanvasConnection 分离。

供应商 create 只允许已知未提交状态获得原子提交权；恢复已有 providerJobId 只能查询原执行，不再创建。unknown/dispatching 或旧未核验执行禁止付费重放；manual_review不是允许重新提交的凭据。已冻结知识来源需要在执行前重新检查账号、灰度、项目与文档权限，不能让外部文档文本决定授权或工具调用。

将来 Runtime 的 operationId 应先持久化到调用日志，再调用上述服务；网络中断后使用原日志恢复。不能把“新attempt”当成“新逻辑操作”，也不能绕过现有人民币账本自行扣费。
