// Curated summaries, not a browser-side scraper. Keep sources and reporting dates with every update.
const websiteContent = {
  news: [
    {date:'2026-10-23',category:'智能体工具',title:'OpenHands 1.32 更新自动化与 MCP 安装流程',
      summary:'OpenHands 发布1.32.0正式版，将固定的自动化项目保存到代理服务设置，MCP安装对话框支持选择可安装的库选项，自动化仓库选择器也扩展到所有可克隆的提供方。官方同时更新相关组件依赖。',
      observation:'团队部署自动化助手时，除了模型表现，还应检查任务配置能否保存、仓库权限是否匹配，以及工具安装选项是否清楚。版本更新不等于所有托管与自建环境无需配置即可使用。',
      source:'OpenHands 官方发布记录',url:'https://github.com/OpenHands/OpenHands/releases/tag/v1.32.0'},
    {date:'2026-10-23',category:'开发兼容',title:'LangChain Core 1.7 调整工具调用流，升级需核对事件解析',
      summary:'LangChain Core 发布1.7.0，工具参数的原始流事件改为 tool-call-delta 增量片段，不再通过 block-delta 发送累计快照；官方说明完整工具调用与最终输出读取接口保持不变。',
      observation:'自行消费流事件的团队应检查参数拼接和工具进度展示，避免把增量片段当完整参数。若需暂时保留旧快照行为，可按官方说明锁定旧版本，再安排兼容验证，而不是直接升级生产环境。',
      source:'LangChain 官方发布记录',url:'https://github.com/langchain-ai/langchain/releases/tag/langchain-core%3D%3D1.7.0'},
    {date:'2026-10-21',category:'开源智能体',title:'Hermes Agent 0.22.3 发布，稳定版汇总工具与插件更新',
      summary:'Nous Research 发布 Hermes Agent 0.22.3稳定补丁，汇总此前一段时间的工具进度、插件授权与更新等变化。本次面向CLI、安装器、Microsoft Store应用及Docker和云端渠道，安装器版桌面应用需等待后续捆绑更新，不能视为所有客户端同步升级。',
      observation:'使用开源智能体的团队应先核对自己的安装渠道，再检查插件权限、升级兼容和会话清理行为。汇总发布不等于这些能力都在当天首次出现，也不代表已经通过业务场景验证。',
      source:'Hermes Agent 官方发布记录',url:'https://github.com/NousResearch/hermes-agent/releases/tag/v0.22.3'},
    {date:'2026-10-21',category:'AI 应用',title:'Gemini 车载个性化开始推送，数据连接仍需用户授权',
      summary:'Google 宣布在 Android Auto 上开始推送 Personal Intelligence，可经用户授权连接邮件、日历等应用，为出行提供个性化回答；内置 Google 的汽车计划在未来数月跟进。功能面向符合条件的个人账号，存在年龄和地区限制，不包含 Workspace 企业、商业和教育用户。',
      observation:'场景助手的价值来自连接任务背景，而非只增加聊天入口。企业设计类似体验时，应明确数据授权、撤销入口与账号适用范围，不能把个人版能力当成企业服务已经开放。',
      source:'Google 官方博客',url:'https://blog.google/products-and-platforms/platforms/android/android-auto-cars-with-google-built-in-gemini-personal-intelligence/'},
    {date:'2026-10-20',category:'智能体开发',title:'Cloudflare Agents 0.29 更新，完善工作区与中断恢复',
      summary:'Cloudflare Agents 发布0.29.0，Agent Skills 支持读写 Computer Workspace，并更新浏览器会话的创建与关闭流程。聊天恢复新增中断次数上限，避免同一轮任务因反复触及内存限制而无限重试，同时调整模型网关配置接口。',
      observation:'持续运行的智能体需要同时设计工作区权限、资源释放和失败终止。已使用该 SDK 的团队应先核对迁移说明及自己的恢复逻辑，不把版本更新直接等同于生产可靠性保证。',
      source:'Cloudflare Agents 官方发布记录',url:'https://github.com/cloudflare/agents/releases/tag/agents%400.29.0'},
  ],
  projects: [
    {name:'AI 智能品控审核系统',type:'企业知识库 × 图像辅助审核',image:'quality-concept-v1.png',alt:'品控审核产品概念图：知识文件、包装标签检查和人工复核相互连接',
      intro:'把法规、企业规范与包装图片连接起来，让审核结论能回到具体依据。',
      problem:'包装审核既要读取图片，也要核对不断变化的规范；只给一段模型判断，很难复查依据与历史版本。',
      approach:'知识文件校对发布后参与检索，包装图片进入审核任务；风险项由人员确认、修正和终审，保留所用条款与版本快照。',
      deliverable:'知识依据管理、包装审核、人工终审、案例记忆与数据备份。',
      boundary:'AI 提供辅助审核，最终结论由人员确认。'},
    {name:'工厂运营 Copilot',type:'产品管理 × 运营决策支持',image:'factory-concept-v1.png',alt:'工厂运营产品概念图：产品资料连接定位、竞品和定价决策',
      intro:'从产品资料出发，把定位、竞品与定价整理进同一套运营工作台。',
      problem:'工厂供货信息分散，产品定位、报价与客户需求经常需要重复整理，难以形成可延续的工作过程。',
      approach:'围绕酒店商用日化场景组织产品资料，把产品定位、竞品分析、定价和询盘管理做成可逐步操作的模块。',
      deliverable:'产品管理、定位 Agent、竞品分析与定价策略等模块。',
      boundary:'界面不展示客户资料与经营业绩，外部平台接入按实际权限配置。'},
  ],
  articles: [
    {title:'AI 工具越来越多，企业应该从哪里开始？',paragraphs:[
      '先找一个反复发生、输入资料明确、结果能够检查的任务，而不是先采购一组模型。整理包装规范、归纳询盘、组织创作素材，都可以拆成具体的工作步骤。',
      '把现有流程写清楚：谁提供资料，谁作判断，结果交给谁，出错后怎样恢复。如果输入仍靠人到处寻找，直接加一个聊天窗口通常不能解决整个问题。',
      '第一轮只验证一个环节。用同一批资料比较原有做法和新流程，记录正确性、人工修改量、耗时与调用成本；涉及审核或对外发送的结果，保留人工确认。',
      '验证通过后再扩展权限、数据来源和自动化范围。先让一个小流程稳定工作，比一次上线很多无人检查的能力更值得投入。'
    ]},
    {title:'从想法到流程：一次可验证的 AI 实践',paragraphs:[
      '一个可以验证的原型，首先要说明“完成”是什么。例如包装审核不仅是识别文字，还要能找到依据、指出风险位置，并允许人员修正判断。',
      '我们在品控审核项目中把知识发布、图片审核和人工终审分开。知识未经校对不直接成为正式依据，历史审核保存实际使用的条款快照，避免知识更新后失去追溯线索。',
      '这样的流程允许分别检查每一层：资料是否正确解析，检索是否找对依据，模型是否完整返回，人工操作是否被记录。出现问题时可以定位到具体环节，而不是只重新生成。',
      '原型阶段就应包含失败路径：网络错误不能显示成功，重复提交不能产生重复记录，人工修正不能抹去原始结果。可恢复和可追溯，是实际工作流的一部分。'
    ]},
    {title:'先定义任务，再选择模型与工具',paragraphs:[
      '同一个项目常常需要不同能力。文字归纳、图片识别、视频生成和企业资料检索，不必全部交给同一个模型，也不必让模型处理本来可以确定执行的步骤。',
      '先列出输入格式、输出结构、速度要求、资料权限和可接受成本。需要引用依据的任务，先考虑检索与版本；需要对接业务系统的任务，先确定接口权限与人工审批。',
      '再用真实任务样本比较候选工具。检查常见输入，也检查缺少字段、图片不清、资料互相冲突等边界；不要只保留最漂亮的一次结果。',
      '最后把选型写回流程：哪些步骤可以自动执行，哪些只提供建议，哪些失败后交给人处理。工具会更新，但明确的任务定义和验收方式可以持续复用。'
    ]},
  ],
};
