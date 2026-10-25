泄漏源：model driver原文delta经service直接持久化message.delta；API原始snapshot暴露context/steps/preview；面板直接渲染原模型messages、stream、JSON.stringify审批参数及raw错误/版本。plan-service.finish确定性结果同样拼入revision；内部plan review包含完整协议必须仅保留模型上下文。此次仅新增展示投影，不改原事件/回执/工具业务。

已实现服务端只读投影、原始流隔离、默认快照兼容控制字段及管理员追踪路由。普通HTTP快照保留必要CAS/审批/操作标识但不带原始参数；旧客户端可继续提交原审批绑定，不能借旧events接口看到原始delta。追踪需管理员且仍受会话归属和来源权限约束。原数据未迁移。
专项8项测试、API/Web类型检查首轮通过，真实隔离HTTP/Worker14项复验通过。

多标签根因：未发送输入原先共用用户＋项目键；新每文档槽位隔离，旧记录只读恢复，operationId不变。真实复制标签和刷新测试已通过；两页画布Web CAS保存/拒绝覆盖/差异/刷新保护另通过。
