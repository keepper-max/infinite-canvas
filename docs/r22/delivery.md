# R2.2 本地开发交付

## 体验与边界

本地普通账号入口：http://127.0.0.1:5202/__p25/login ，无需密码。进入画布点击“原生创作助手”，选择“雾港创作讨论 · R2.2”，可查看七轮讨论、原审批保存结果、创作决定及后续讨论。API3202、Web5202、独立Worker、Redis DB4和r22_isolated已隔离；可靠性回归使用没有后台Worker扫描的r21_regression_isolated。

正式服务器只读核实current为/opt/infinite-canvas-releases/r12-64ff7e289630，VERSION v0.16.37；本地HEAD52ac40a，R2.1未提交代码已完整备份到H:/CodexStorage/shoushou-r22/baseline。/version.json实际返回HTML，未把200误当版本证据。未改生产数据库、配置、模型、运行服务，无commit/push/部署，无P2.6/桌宠/多Agent。

本地使用明确的模型HTTP替身，显示模型名/Token/账本为测试协议，不是使用真实供应商；费用0。真实Qwen创作对话质量与人类主观内容验收尚未通过，不能把替身文本当成智能升级的验收结论。

## 根因及增量实现

R2.1解决了展示泄漏，但执行模式仍几乎每轮附加规划指令，正则只豁免少量聊天；普通反馈和方案指代容易触发“缺少可执行计划”。旧上下文超限直接丢旧轮，没有讨论摘要、已否定建议和用户明确决定；最近assistant新方案还未写入下一轮摘要时，单靠旧摘要会丢“第二个”的含义。

- Conversation Policy：同一个Runtime、同一Model Gateway，在同一个Run中纳入原预算的第一模型Step判断chat/consult/compare/action/clarify，并保存严格校验的结构化结果和用户证据。不靠固定词表决定全部意图；不符合格式或缺少依据则暂停，不执行新操作。
- Context Assembly：原授权历史＋本会话摘要＋原生消息中的近期真实交流锚点＋当前项目＋显式创作决定。摘要是带来源的模型辅助，不是新授权；按原12k预算移除完整旧轮，原消息不删除。每次提交和展示继续重验资料权限/版本。
- Creative Collaboration：独立版本化PARTNER_PROFILE分开身份、语言、创作判断；强调依据、取舍、合理异议、接受反馈和信息不足。讨论/比较/澄清只开放原注册的只读工具，服务端也拒绝越界写提案；action才进入原审批，建议模式仍不能写。
- Conversation-to-Action：通过resolvedRequest恢复指代，但实际写入只相信原13工具参数、完整计划、审批hash、CAS和事务回执。长期决定或模型判断不能替代审批；本地案例只改画布剧本文本，没有偷偷改知识原稿。
- Response Composition：模型负责观点和表达，服务端负责真实保存事实。结果卡依据原回执，新增加已更新节点显示与定位；继续聊天时旧任务结果仍保留。没有任务后额外付费总结调用。

本轮新客户端使用conversationVersion=1；旧客户端和已接受的R2.1 Run保留原协议。待确认草稿把该能力版本绑定到原operationId；旧草稿无此字段时不会重试时擅自补入新字段改变hash。原AGENT_PROTOCOL_VERSION、消息存储版本、模型名单、人民币规则和全部运行上限不变。

## 创作决定与恢复

用户可在“已确认的创作决定”中启用、查看、选择用户原话来源、编辑、移除、关闭。默认关闭，不自动把闲聊或模型建议存为项目长期记忆。记录在用户个人知识空间，按当前projectId隔离，使用KnowledgeService原CAS、操作回执、版本和审计；记录来源会话/Run/版本/用户原话及知识版本引用。普通成员即使知道ID也不能读他人的记录，灰度/用户/项目权限仍同时生效。

来源已删除或撤权时返回不可用提示，不把原决定正文交给模型；内部决定不能通过普通Agent知识搜索/读取绕过作用域。移除或关闭停止后续注入，原会话、知识版本和审计按现有机制保留，不伪称删除所有历史。关闭不会抹去当前对话已经发生过的内容，新会话只注入仍明确开启且有权限的决定。

决定文档格式版本、会话协议与消息版本独立。未知/损坏版本拒绝覆盖；凭据形态的正文或确认原话禁止保存。回执恢复保存原模型请求的完整JSON字符串及SHA，避免jsonb重排和新记忆改变旧请求hash；仍先校验当前权限，再读取原已核验结果，不重发未知供应商调用。缺失或损坏快照失败关闭，原记录保留；旧R2.1恢复路径不改变。

## 安全渐进展示

原始message.delta仍私有，意图JSON、tool_calls和推理字段不会先闪现。只有实际持久化且通过R2.1展示投影的自然回复才能作为conversation.message事件；界面对已核验文字逐步展开，支持减少动效和隐藏页面停止，刷新以正式快照为权威。未请求的UUID、凭据形态和推理标签整段屏蔽，不全局删除合法用户编号，不改原始消息。

这是“核验后分块显现”，不是供应商逐Token低延迟直出；首段仍需等待本轮核验完成。未安全放行的原始流没有回退。文本按React文本节点渲染，不以innerHTML执行模型HTML。

## 运行证据

详见evaluation.md、references.md、file-list.md与H:/CodexStorage/shoushou-r22/artifacts中的实际日志。

- 独立PG可靠性、CAS、审批、幂等、Worker、费用、Token、权限和知识原文回归；展示专项与语义策略/长上下文/精确回执快照专项均运行，最终55项全部通过，0失败/0跳过，见agent-regression-final.log。
- 14项原策略HTTP/Worker检查；12项跨会话/决定CAS/真实撤权/来源删除/安全事件检查；7轮真实浏览器9项检查、3项多标签草稿、4项断网与撤权恢复检查通过，pageerror为0。
- strategy-comparison.json保存相同输入R2.1兼容路径暂停与R2.2讨论完成；context-length-comparison.json保存长短上下文提交证据；conversation-transcript.json保存实际输入、替身输出、工具及合成费用。
- receipt-check.json验证在已结算结果后模拟本地Worker回执未完成，并修改记忆，再通过正式reconcile HTTP和独立Worker恢复；必须保持相同Step/账本/Token/费用/画布版本，不把设计视为通过，实际结果见该文件。
- API/Web类型检查和构建；既有Vite大分块警告保留，无新依赖/迁移。真实供应商质量、真实Windows输入法、物理设备与真实人民币结算没有被冒充通过。

截图：creative-analysis-dark.png、discussion-to-action-plan.png、continuous-discussion-dark.png、continuous-discussion-light.png、mobile.png、permission-revoked.png。实际七轮录屏副本为artifacts/r22-conversation-demo.webm，原件位置见artifacts/video-path.json；无生产视频/媒体模型调用。源码差异、SHA与R2.1原始用户变更校验见source-manifest.json及补丁。

## 上线建议与未验收项

代码和替身业务链路可以本地体验；真实Qwen对新意图JSON、创作分析、反馈调整、上下文指代和套话控制尚未验收，生产发布仍需单独批准。语义判断是模型能力而非安全授权：误判时也不能越过最终审批/权限。每Run增加意图模型步骤会消耗原预算和轮次；不自动提高额度，余额不足按原机制停止。中间合成费用和隔离性能不得作为生产保证。

后续经批准发布应包含R2.1＋R2.2的API、独立Agent Worker和Web，并保持原普通生成Worker/MCP/CAS/账本；不需要数据库迁移。新Web配旧API会失败关闭，不自动退回不安全raw流；应等服务端和Worker就绪再切前端。先做不付费历史/权限冒烟，再按单独批准预算做真实模型质量验收。

回滚先暂停新Agent执行，保留读取和全部回执；已接受R2.2 Run须由支持原上下文快照的新Worker完成核查，不能交给不认识该协议的旧Worker盲跑。保留R2.1安全展示接口与新快照读取能力，不回退原始流，不降低revision、清历史、删知识版本或重复付费。完成后等待用户体验与发布授权，不进入P2.6。

补充权限验收：optional-feature-check.json 的3项真实HTTP/Worker检查通过；撤销知识授权后新建无知识来源对话可完成，决定API与含知识来源旧会话继续拒绝，原授权已恢复。

当前创作决定使用个人知识文档保存，因此会在个人知识库中可见；建议通过Agent面板管理，手工破坏内部格式会触发拒绝覆盖，不会静默重建。
