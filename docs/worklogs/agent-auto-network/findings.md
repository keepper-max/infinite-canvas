# 根因与修复
- 生产v0.16.48的新任务停在价格预检，错误AGENT_PREFLIGHT_FAILED；Job明确拒绝提交，零Token、零新增扣费与预留。不是旧任务占用。
- 生产Node v22.23.3：104.21.79.22在251ms建立TCP后TLS未完成；172.67.168.180在325ms建立TCP、688ms完成TLS、1709ms返回HTTP200。现有family4仅选择一个地址，不能回避同域名的失效IPv4边缘。IP仅为诊断观察，不写入运行配置。
- 另一轮只读探测中，104.21.79.22恢复并返回200，而172.67.168.180卡在TLS阶段。说明地址故障具有间歇性，不能把任何一个公网IP永久固定为好地址；候选代码每次连接仍重新查DNS，全部地址失败时停止。
- 使用现有Undici buildConnector/RetryAgent：每次连接重新查IPv4 DNS，记住连接失败和成功地址；成功地址必须仍在新DNS结果内。只读GET连接失败最多重试一次、默认500ms；HTTP错误、JSON错误、TLS证书错误不重试。推理使用原始Agent，无RetryAgent。默认连接超时未扩大、总请求受原模型限时约束。
- 底层family4是内部能力，前台不再让用户选建议/执行。新增严格interaction:auto仅配conversationVersion1+advice入场，记录在immutable policy_snapshot与operationId的payloadHash内。先只读识别；经核验当前用户行动意图后重验服务端项目写权限，再开放提案工具。审批后仍走原事务保存链。
- 历史请求不加auto、不换operationId、不提升旧只读语义；旧只读行动提示重新发送，无需寻找已移除的切换开关。未知网络结果保持原payload。
