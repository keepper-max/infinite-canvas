# 如何预防和处理复发

## 已实现
1. 显式请求stream_options.include_usage，只有stop/tool_calls、合法整数用量和DONE齐全且无协议/混流错误时，主动结束SDK读取并请求取消上游reader。不等HTTP连接永久关闭，也不增加计时或重试。
2. 继续执行原语义/工具schema、权限、审批、CAS和计费核验。协议完整不等于业务成功；半截JSON仍失败。缺用量、截断长度或异常结束进入原核查路径，保留operationId/原回执和未知预留。
3. providerStream仅记录计数/时间/枚举和用量数字。状态里程碑串行写库、最终flush，无逐片数据库写入；元数据落盘失败不能让成功路径假报持久化成功。原供应商异常优先，二级诊断异常不覆盖它。
4. 采用成熟SSE解析库，测试逐字节UTF8、CRLF、独立usage、挂起、重置、重复查询和权限撤销。升级SDK或供应商协议时复用这组回归。

## 后台判读（不是用户前台技术追踪）
- response_headers_received不存在：未收到响应头，查建连/首包阶段。
- providerStream.termination=protocol_complete、networkEof=false、upstreamCancelRequested=true：完整协议已收齐，由适配层安全取消连接等待，这是正常收尾而非用户取消。是否业务成功仍看Run状态、账单与实际保存回执。
- termination=aborted、DONE=false、lastByteAt长时间不变：响应体静默到既有限时，结合原请求ID请供应商核对中转/CDN日志；不能仅凭本地元数据区分所有网络跳点。
- bytes增长但events不增长：可能在等待未闭合SSE帧；comments增长而textChars不动则是心跳；reasoningChars增长则仍有思考片段活动。字段bytes为fetch解压后/SDK前响应体字节，不是网卡/TLS抓包字节。
- finishSeen/usageFrameSeen存在但usageSeen=false或DONE缺失：结束信息不完整，不推算免费、不拼接伪造结果。
- read_error与白名单readErrorCode帮助区分连接重置/关闭/读超时；jsonErrors/sseErrors指向格式边界异常。providerError仅存布尔值，不记录供应商可能回显的敏感错误正文。
- networkEof=true且DONE=false：真实EOF未见DONE，仍由SDK用量/finish与业务语义校验决定结果，不补写结束标记。

## 运维与发布边界
- 已有管理员trace入口可读取providerStream，普通presentation和前台不显示。未新建自动告警、熔断门槛或监控面板；若后续需要阈值须另行确认。
- 本地补丁不包含数据库迁移，也不改变用户/项目模型选择、积分余额、60+60秒、15分钟或重试次数。
- 上线前按既有备份恢复/不可变制品流程核验API/Worker与eventsource-parser运行依赖。只读接口成功不能替代真实流式验收；专用项目的付费模型调用须先批准预算，失败即停。
- 旧请求已缺失的158字符之后的正文不能由本补丁补回，也不能凭账单当作已生成成功。保留历史与预留，先查询原请求状态；结束任务不代表退款，重新生成必须用户明确发起。
- 完整结束帧的兼容问题可由本补丁预防，供应商真断流或链路故障不能保证永不发生。此时应能定位并安全停止，不能靠盲目重试积累费用。
- 本轮不提交/部署。回滚只恢复API/Worker制品，保留原任务、费用和新JSON诊断字段，不删回执、不降revision；旧版本可能再次等待HTTP EOF，必要时停止受影响新请求。
