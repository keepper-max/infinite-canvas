# R2.2 参考项目与本地映射

本轮读取实际仓库README、LICENSE、GitHub仓库/树元数据及下列源码。原件和SHA清单保存在H:/CodexStorage/shoushou-r22/references，不执行下载的脚本、不安装外部插件、不引入第二套Runtime。维护状态是本次GitHub返回的快照，不保证未来持续维护。

| 参考项目 | 实际核查位置与许可证 | 借鉴机制 → 本地位置 |
| --- | --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | master；packages/core/agent-loop/src/agent.ts、packages/core/system-prompt/src/index.ts、packages/preset/persona/src/index.ts；MIT | 提示词贡献和人格与操作指令分层、持久会话事件 → conversation-policy.ts的PARTNER_PROFILE、model.ts的agentSystem、service.ts的模型Step检查点。保留本项目身份绑定/13工具，不引入Cordis插件或代理团队。 |
| [OpenClaw](https://github.com/openclaw/openclaw) | src/agents/system-prompt.ts、docs/reference/templates/{SOUL,IDENTITY,USER}.md、docs/concepts/memory.md；MIT | 身份、风格、用户上下文、记忆及安全独立组装 → PARTNER_PROFILE、conversationPrefix、creative-decisions.ts。身份不是扩大权限的凭据，不让人格替换系统规则。 |
| [Letta Code](https://github.com/letta-ai/letta-code) | src/agent/context.ts、cloud-managed-system-prompt.ts、docs/examples/mods/memory-citations.ts；Apache-2.0 | 状态归属与记忆引用溯源 → 既有Run/Step归属＋决定来源会话/用户原话/文档版本。不引入其客户端、全局状态或模型调用链。 |
| [dsh-memory](https://github.com/haitang1/dsh-memory) | lib/store.js、lib/automation.js、docs/DESIGN.md；MIT | 作用域、摘要/原始条目分离、版本恢复 → 会话内Step.summary＋显式个人知识决定文档。使用既有PG事务，不复制其文件锁/全局自动记忆/自动摘要重试机制。 |
| [LangGraph](https://github.com/langchain-ai/langgraph) | libs/langgraph/langgraph/graph/state.py、pregel/_checkpoint.py；MIT | 检查点、暂停与人类确认 → 保留原Approval和CAS，在原模型步骤增加意图及上下文快照；不建立新图执行器。 |
| [dsh-whale-persona](https://github.com/linsport/dsh-whale-persona) | README、_生成预设.cjs、LICENSE；API标NOASSERTION，实际LICENSE为MIT | 配置与人设内容解耦 → 内部可扩展版本化PARTNER_PROFILE。不复制鲸鱼人设、安装/更新脚本或互动养成。 |
| [dsh-whale-musume-persona](https://github.com/Kaalia0912/dsh-whale-musume-persona) | agent-presets/whale/agent.cordis.yml、lib/index.js；MIT | 预设与加载器边界 → 风格模块保持本地静态受控接口；不加载外部人设插件，不提供complete覆盖安全提示词的能力。 |

前五项本次仓库返回未归档；维护时间见references/index.json的pushed_at。dsh-memory最近推送比其余核心项目较早，但不能仅凭日期推断质量。两个人设仓库仅参考模块边界，未采用人格设定；没有新增依赖或许可证引入。本地实现为原有Runtime的增量代码，并未复制上述源码。

## DeepSeek兼容边界

已读官方[工具调用](https://api-docs.deepseek.com/guides/tool_calls/)及[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)。思考模式带tools时，需要完整续传reasoning_content；不带tools的处理不同。不能把推理字段当普通用户文本，也不能直接套用当前仅保留正文的兼容层。严格模式还需检查必填字段、additionalProperties及可接受JSON Schema子集。

本地nativeModelRoute仍仅允许原已核验路线，DeepSeek被拒绝；未切换生产默认模型、未读取生产凭据、未请求其付费API。现有通用兼容SDK不等于已完成DeepSeek思考工具协议适配。若以后引入，应独立验证能力、原始推理字段私有存储和续传、工具schema及费用；本轮只完成源码/官方协议分析和未开放路径的回归，不声称DeepSeek接入通过。
