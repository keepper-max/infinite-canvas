# 守守画布原生知识管理：技术审计与集成方案

状态：技术方案待确认，未进入实施。范围：正式仓库静态审计、官方资料核验、架构和验收设计。

**推荐：保留现有画布，以 Tiptap 提供受控富文本编辑，以 Markdown 源文作为权威数据；复用 PostgreSQL、项目权限、资产存储和模型任务，新增独立知识业务层。备选：CodeMirror 6 的 Markdown 优先编辑方案。**

本报告不等同于可投产确认：没有安装编辑器进行兼容性实测，没有连接生产数据库、运行性能基准或验证线上 MCP 进程。新增依赖、迁移、UI、工具注册和发布均须在方案获批后另行实施。

## 1. 现有守守画布技术架构

### 1.1 审计基线和结构

- 正式仓库：`H:/CodexStorage/infinite-canvas-auth-upgrade`；审计起点 HEAD 为 `6cc51c9e66e6def8ebbc8031538bd2322aee0d2d`。原有 `website/content.js` 工作区修改保持不动。
- `web/`：主平台 SPA；`server/api/`：平台 API、数据库、Worker；`canvas-agent/`：本地 Agent 与 stdio MCP；`plugins/canvas/`：画布插件及 SDK；`canvas-proxy/`：代理辅助项目。
- `website/` 是官网与实验页面，`docs/` 是文档站，`plans/` 是设计资料；这些子项目的依赖不能代替主平台技术栈结论。独立 3D 导演台不在本次修改范围。
- 没有根 workspace `package.json`，应分别看子项目配置。当前主 Web 是 **Vite，不是 Next.js**；用户所贴 Next.js 提醒不能作为实际架构依据。

以下版本来自 lockfile，区别于 package.json 中的范围，也不代表线上镜像版本：

| 层 | 实际代码/锁定依赖 | 说明 |
|---|---|---|
| Web | React 19.2.5、Vite 7.3.6、TypeScript 5.9.3、React Router DOM 7.18.3 | 客户端路由 SPA |
| UI/状态 | Ant Design 6.6.3、Tailwind 4.3.3、Zustand 5.0.15、TanStack Query | 主题、业务状态、远程查询各有既有入口 |
| 文本相关 | `@uiw/react-codemirror` 4.25.11、Streamdown 2.6.0 | 已有代码编辑和 Markdown 展示；没有安装三种候选编辑器 |
| API | Hono 4.13.7、Drizzle ORM 0.45.2、pg 8.23.0、Zod 4.5.4 | 同进程业务服务，既用 ORM 也用参数化 SQL |
| 任务/对象存储 | BullMQ 6.3.4、ioredis 6.0.0、AWS S3 SDK 3.1128.0 | 已有独立 Worker、Redis、S3 兼容存储 |

证据：[Web 依赖](H:/CodexStorage/infinite-canvas-auth-upgrade/web/package.json)、[Web lock](H:/CodexStorage/infinite-canvas-auth-upgrade/web/package-lock.json)、[API 依赖](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/package.json)、[API lock](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/package-lock.json)。Compose 基线为 PostgreSQL 16、Redis 7、MinIO；生产实际版本未登录核验。

### 1.2 画布、节点、连接和状态

**画布是自研 React DOM 节点 + CSS 平移缩放 + SVG 贝塞尔连接线，没有 React Flow、Konva 或 Pixi 依赖。**

- [InfiniteCanvas](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/components/canvas/infinite-canvas.tsx:267) 用 `translate(...) scale(...)` 变换世界坐标；[ConnectionPath](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/components/canvas/canvas-connections.tsx:23) 生成 SVG 路径。
- [CanvasNodeData / CanvasConnection](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/types/canvas.ts:124) 定义节点 ID、开放字符串 type、位置、尺寸、metadata、definition/version/workflowKind，以及端口、resourceType、role、order。连接参与资源输入与生成工作流，不能拿来存 Wiki Links。
- [registerNodeDefinitions / getNodeDefinition](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/lib/canvas/node-registry.ts:17) 使用 Map 注册定义；[CanvasNodeDefinition](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/types/canvas-plugin.ts) 支持 Content、Panel、resource、ports、execution、双击、工具栏。内置节点与插件共用定义接口。
- [CanvasProjectPage](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/pages/canvas/project.tsx) 用 React state/ref 管理活动画布、历史、选区和生成状态；[useCanvasStore](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/stores/canvas/use-canvas-store.ts) 保存项目壳和本地持久化。不能笼统说“全部画布状态都在 Zustand”。
- [useCloudCanvasPersistence](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/pages/canvas/hooks/use-cloud-canvas-persistence.ts:9) 负责云端 revision、本地草稿、冲突与离开保护；服务端是权威。本地缓存不是另一个知识数据库。

**能新增 Knowledge Node，且无须替换节点系统；但“完全零影响”不能提前保证。**建议用固定原生类型 `knowledge:document`，在内置初始化入口注册唯一类型，`execution.capability = none`，按需提供 `text` 输出端口。

需要补齐类型、创建入口、资源解析、持久化引用校验和 Agent 契约；尤其目前 `resource(node)` 是同步函数，无法直接异步取文档。仅注册 Content 而不改资源解析，会出现能看见节点却不能可靠供生成消费的问题。

### 1.3 编辑器和 UI 的实际可复用程度

- [Markdown 插件](H:/CodexStorage/infinite-canvas-auth-upgrade/plugins/canvas/markdown/src/index.tsx:15) 是 textarea 编辑 `metadata.content`，CDN 加载 `marked@14`，预览直接写 `innerHTML`；没有知识文档 ID、版本、文件树、关系索引或后台搜索。
- [ModelScriptEditor](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/components/layout/model-script-editor.tsx) 已使用 CodeMirror，但主要是模型脚本，不是现成知识编辑模块；Markdown 语言扩展尚需获批后增加。
- [AgentChatMessage](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/components/agent/agent-chat-message.tsx) 使用 Streamdown 展示模型 Markdown，可参考主题与外链确认交互，不能直接认定支持 Obsidian 方言或等同编辑器。
- [CanvasSidePanel](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/components/canvas/canvas-side-panel.tsx) 已有可调宽左面板，手机使用 Drawer；宽度配置在 [side-panel store](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/stores/use-canvas-side-panel-store.ts:3)，当前范围 220–480、默认 280。适合导航，容不下舒适的长文编辑。
- [canvas-theme](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/lib/canvas-theme.ts)、[app-theme](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/lib/app-theme.ts) 与 ConfigProvider 可复用；主画布支持深浅主题，新增模块不能只适配深色。

### 1.4 后端、账号、数据与文件

- [app.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/app.ts) 注册 REST 路由；`requireUser`（2711 行）从 Cookie 取随机会话令牌，哈希后查会话；`issueSession`（2691 行）设置 HttpOnly、SameSite=Lax、配置驱动 Secure。密码用 [Argon2id](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/auth.ts)。不是现成 OAuth 多租户 MCP 授权服务。
- [schema.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/db/schema.ts) 已有 users、sessions、projects、project_members、canvases、canvas_nodes/edges、snapshots、assets/versions、generation jobs、text conversations/messages、admin audit logs。
- [assertProjectAccess](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/project-access.ts:7) 排除已删除项目，读需成员资格，写需 owner/admin/editor；[repository](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/repository.ts:837) 的画布保存另有读写检查和 revision CAS，事务内保存结构与快照。
- `canvases.project_id` **有唯一约束**：当前一项目一个画布。不能直接承诺同一项目下任意多画布；本方案通过文档与画布解耦，再设计受控跨项目引用满足多画布复用。
- [AssetService](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/asset-service.ts) 提供预签上传、完成校验、不可变版本、授权下载/媒体流与配额；[ObjectStorage](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/object-storage.ts) 对接 S3 兼容服务。上传入口 `/api/projects/:projectId/assets/uploads`，完成入口 `.../:uploadId/complete`；画布读写入口 `/api/projects/:projectId/canvas`。

**数据库和用户体系可以复用；无需新增数据库、独立知识微服务或身份系统。**文档正文宜存 PostgreSQL text，图片附件走已有存储能力；但 [asset-contract](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/asset-contract.ts:3) 目前只有创作媒体、字幕、项目导出类别，**没有通用附件/PDF/Markdown 文档类别**。接入时需增量扩展契约和 MIME 策略，不能假装所有文件已支持。

### 1.5 AI 与 MCP 主链路

- 内置文本模型：`requestImageQuestion` → 服务端托管 job → `ModelGateway` 编译 → `JobService` → BullMQ Worker → Provider → 产物/计费。自定义渠道有浏览器直连/脚本分支，不能混为同一密钥安全边界。
- [requestImageQuestion](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/services/api/image.ts:997) 把消息编成 prompt；[Token360Provider 文本分支](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/provider.ts:82) 发送 chat/completions。模型 API 接入本身并不提供知识库、检索器或服务端 Agent 工具循环。
- [TextWorkbenchService](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/text-workbench-service.ts:71) 按项目和创建者隔离会话，具有滚动上下文压缩和任务绑定；压缩是字符预算与历史摘要处理，不应宣传为已做文档语义检索。
- [usePluginHost](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/pages/canvas/hooks/use-plugin-host.tsx) 注入 `ai.generateText/Image/Video` 等；[canvas-resource-references](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/lib/canvas/canvas-resource-references.ts) 从节点和上游边提取输入。当前引用单位是画布节点/资产，不是文档 revision/block。
- 在 `server/api/src`、Web services/lib 的检索范围内，未发现专用知识文档表、关系索引、全文索引或向量检索服务；已有提示词搜索与资产查询不能视作 RAG。

MCP 有两条不同的实际路径：

| 路径 | 已核实实现 | 权限和持久化边界 |
|---|---|---|
| 仓库本地 canvas-agent | [mcp.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/canvas-agent/src/server/mcp.ts:9) 用 SDK `registerTool` + Zod + stdio；工具集在 [schemas.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/canvas-agent/src/canvas/schemas.ts) | 转发本地 HTTP `/api/tools`；连接 token 不是平台用户身份 |
| 浏览器执行桥 | [CanvasSession.callTool](H:/CodexStorage/infinite-canvas-auth-upgrade/canvas-agent/src/canvas/session.ts:440) → SSE `tool_call` → [local-agent-panel](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/components/agent/local-agent-panel.tsx:795) → `applyCanvasAgentOps` | 绑定活动/turn 客户端；页面更新后回执，随后由云保存链持久化。回执不是数据库提交证明 |
| 本机私有 shoushou-canvas MCP | [本地 bundle](H:/CodexStorage/shoushou-mcp/shoushou-mcp-server.cjs:142047)，server 0.3.0；可见源码标记为 `scripts/shoushou-mcp-server.ts` | 从环境配置解析平台用户；`requireProject` 检查成员、可选白名单；可直接访问数据库，独立于网页桥 |

私有 bundle 中确认存在 `get_project_context`、`create_vibe_storyboard`、`import_rendered_video` 等；该源码原始工程位置与线上实际加载版本未确认，**不能在正式仓库里编辑一个同名文件就声称更新了它**。本轮未调用任何 Vibe 写工具。

## 2. 当前可复用的系统能力

| 能力 | 复用方式 | 必须补充的部分 |
|---|---|---|
| 账号与项目角色 | 沿用会话、成员和 edit/read 校验 | 知识空间/文档/附件/检索统一资源授权；MCP 身份不能取自参数 |
| PostgreSQL 与 Drizzle | 新增知识表、增量迁移、已有连接池与事务 | 文档 CAS、关系索引、查询计划、配额；不把正文塞入 canvas JSON |
| 节点注册与资源输入 | 新原生定义和明确 text 输出 | 异步文档解析、revision 引用、未知节点降级、导出适配 |
| 主题/导航/面板 | 左面板新增“知识”入口，独立文档面板 | 文件树、正文编辑、Backlinks、待保存/冲突状态 |
| AI 任务与资产 | 复用模型目录、计费、取消/失败恢复、上传下载 | 授权检索、来源引用、修改提案；通用附件类型 |
| 本地缓存和历史经验 | 复用 localForage、状态机和快照思路 | 按 user/project/space/doc 隔离，文档独立保存，最小恢复版本 |
| Worker / Redis | 复用运行设施处理批量导入和可选索引 | 独立任务类型/队列、幂等与旧 revision 丢弃，不改生成任务语义 |

不能直接复用为知识权威源的内容：Markdown 节点正文、浏览器插件私有 storage、提示词素材列表、画布执行边、Agent 聊天压缩记忆。它们各自保留原作用，新增知识模块与其通过 ID/版本关联。

## 3. Tiptap / BlockSuite / BlockNote 对比

### 3.1 维护状态、版本与主要依赖

联网读取了官方 GitHub release、指定 tag 的 manifest、许可证，以及 npm registry dist-tags；以下是本轮核验快照，实施前应重查，不能跟随 `latest` 自动升级。

| 项目 | 已核实发布状态 | 主要依赖/适配 | 维护判断 |
|---|---|---|---|
| Tiptap | GitHub 非预发布 v3.32.0；npm react/markdown latest 均 3.32.0 | ProseMirror、React adapter；React peer 接受 17/18/19；Markdown 依赖 marked ^17.0.1 | 近期有正式发布；主包稳定版本不代表 Markdown 子能力已脱离 Beta |
| BlockSuite | 独立仓库 release 与 npm `@blocksuite/store`、`@blocksuite/affine` latest 均 0.22.4 | Yjs、signals、RxJS、Web Components/Lit 生态，独立块模型 | 独立仓库最后提交停在 2025-07-07；AFFiNE 内仍有 blocksuite 活动，不能据此断言整个技术停止维护 |
| BlockNote | GitHub 非预发布与 npm core latest 为 0.56.0 | Tiptap/PM ^3.31.3、React adapter 接受 18/19；协作相关 Yjs peers 按能力选择 | 近期维护活跃；0.56.0 release 明示破坏性变更，0.x 不能当永久稳定 API |
| CodeMirror 补充 | npm `@codemirror/lang-markdown` latest 6.5.2 | 现有 UI wrapper 可用，依赖 CM6/Lezer | GitHub 镜像迁至自建仓库，GitHub archive 不代表项目停更；新主站部分页面本轮抓取受限 |

版本证据：[Tiptap release](https://github.com/ueberdosis/tiptap/releases/tag/v3.32.0)、[React tag manifest](https://github.com/ueberdosis/tiptap/blob/v3.32.0/packages/react/package.json)、[Markdown manifest](https://github.com/ueberdosis/tiptap/blob/v3.32.0/packages/markdown/package.json)、[BlockSuite release](https://github.com/toeverything/blocksuite/releases/tag/v0.22.4)、[独立仓库提交](https://github.com/toeverything/blocksuite/commit/5cb5cb68471ca692f3c162258f0087cb22fcb82d)、[AFFiNE 内实现](https://github.com/toeverything/AFFiNE/tree/9be1a8284a99f70dbabb186552b863701bff0188/blocksuite)、[BlockNote release](https://github.com/TypeCellOS/BlockNote/releases/tag/v0.56.0)、[core manifest](https://github.com/TypeCellOS/BlockNote/blob/v0.56.0/packages/core/package.json)、[React manifest](https://github.com/TypeCellOS/BlockNote/blob/v0.56.0/packages/react/package.json)。

AFFiNE 当前默认分支 `blocksuite/affine/all/package.json` 为 0.27.5，属于其 workspace，**不是所给独立 BlockSuite 仓库最新 npm 稳定版的证据**。独立仓库 README 中旧 `@blocksuite/presets`/PageEditor 示例与 0.22.4 目录已不完全对应，需以固定版本 API 复验。

### 3.2 功能与集成判断

**Tiptap：适合作为守守画布的原生富文本编辑内核，知识业务仍需自己建立。**

- React 适配且 UI headless，便于沿用 Ant Design 和 canvasThemes；Node/Mark、Suggestion、NodeView 与自定义属性可表达 Wiki Link、附件引用和文档嵌入占位。
- 官方 Markdown 扩展提供双向转换和自定义 tokenizer，但仍标 Beta；Wiki Links 要自行实现解析、渲染、补全、序列化。双向链接/Backlinks 是服务端关系索引的责任，不由 Link/Mention 扩展自动生成。
- 图片扩展负责显示，上传和授权仍接已有资产服务；任意文件卡片、YAML 属性、重命名更新与多文档引用都需业务实现。文档属性应存在原文/业务模型中，不能只放编辑器节点 attr。
- 将编辑器装在独立文档面板，Knowledge Node 只显示轻量摘要；不为每个画布节点挂完整 ProseMirror 实例。涉及新增模块和少量适配，不需要重写画布。
- 长期成本中等：自有工具栏和方言维护、PM/Tiptap 配套升级、Markdown 回归语料。优先公共核心扩展，避免修改上游源码。

能力证据：[Markdown 状态与能力](https://tiptap.dev/docs/editor/markdown)、[自定义 tokenizer](https://tiptap.dev/docs/editor/markdown/advanced-usage/custom-tokenizer)、[扩展机制](https://tiptap.dev/docs/editor/extensions/custom-extensions)、[图片扩展](https://tiptap.dev/docs/editor/extensions/nodes/image)。

**BlockSuite：文档与白板统一能力强，但与本项目“保留现有画布、Markdown 权威”的约束相冲突。**

- 可单独嵌入文档编辑组件，无须复制 AFFiNE 整个应用；React 通过 Web Component 边界包装。block tree、schema、Doc/collection、Yjs 状态不是可完全剥离的外壳。
- 文档和 Edgeless 共享内部块/CRDT 模型，并有引用和格式转换基础；这不等于它的 surface 节点可直接变成守守的 `CanvasNodeData`。
- 只引入 Page 模式也要维护块模型↔Markdown 转换及持久化；引入 Edgeless 则出现第二套视口、选区、撤销、布局和渲染事件。问题是状态和语义冲突，并非 React 无法渲染它。
- 支持自定义 block/inline、附件、嵌入与 adapter；但守守账号、服务端授权搜索、Backlinks、MCP 仍要集成。不能把 AFFiNE 产品能力全部算成包开箱即有。
- 本项目成本高：CRDT 持久化、原有 revision 保存的协调、包发布来源、Web Component 生命周期与主题、双数据模型长期升级。没有实测依据宣称其性能一定优于本画布。

能力证据：[BlockSuite README](https://github.com/toeverything/blocksuite/blob/v0.22.4/README.md)、[块模型](https://blocksuite.io/guide/working-with-block-tree.html)、[同步和 snapshot/adapter](https://blocksuite.io/guide/data-synchronization.html)、[store manifest](https://github.com/toeverything/blocksuite/blob/v0.22.4/packages/framework/store/package.json)。

**BlockNote：最快提供块文档体验，但 Markdown 兼容和许可边界不如主方案直接。**

- React 原生，带斜杠菜单、工具栏和 block UI，开箱体验优于自行配置 Tiptap；CSS variables、组件替换可保留守守视觉，无须改画布引擎。
- `editor.document` 的 BlockNote JSON 是其推荐无损存储；官方明确 Markdown 导入/导出有损。以其 JSON 为权威，会增加本项目 Markdown 权威目标的转换和迁移成本。
- 自定义 React inline content 可表达 Wiki Link；关系索引、路径消歧、重命名、Frontmatter、跨文档嵌入和文件树仍是自建。任意自定义块的 Markdown 往返需专门实现和验证。
- 核心 AI 调用可以走守守业务服务，不必使用其 AI 包；如果使用 `xl-ai` 或 XL 导出器，需重新审查授权。不能因“开源”就视作全功能免费闭源商用。
- 单文档编辑接入难度低；达到 Obsidian 语义目标的总成本中高，0.x 升级和 BlockNote/PM/Tiptap 多层版本需一起验证。

能力证据：[格式互通](https://www.blocknotejs.org/docs/foundations/supported-formats)、[自定义 inline](https://www.blocknotejs.org/docs/features/custom-schemas/custom-inline-content)、[主题/UI](https://www.blocknotejs.org/docs/react/styling-theming)。

### 3.3 许可证与商业功能边界

| 项目 | 已验证许可证据 | 商业化结论/约束 |
|---|---|---|
| Tiptap | 仓库与本次 core/react/markdown 包为 MIT | 可作为商业产品基础，保留通知；Pro 扩展、Cloud、部分 AI/版本/导入导出功能有独立商业条款，不包含在 MIT 结论内 |
| BlockSuite | 根 LICENSE 为 MPL-2.0，而 0.22.4 store/affine package.json 声明 MIT | 存在声明粒度差异；不能一概按 MIT，也不能一概说所有包均 MPL。采用前应检查所用 npm tarball 的 LICENSE、文件头及传递依赖；本轮未完成全量包许可审计 |
| BlockNote | 根 LICENSE.txt 声明非 XL MPL-2.0，XL 为 GPL-3.0/商业双许可；xl-ai manifest 同样标注 | 核心可商用，分发前端涉及 MPL 覆盖文件源码可得性/修改义务；闭源使用 XL 应取得对应商业许可或满足 GPL，不能默认豁免 |
| CodeMirror | Markdown 包 manifest 与编辑器许可为 MIT | 可商用并保留通知；渲染器和其他解析依赖分别审查 |

许可证据：[Tiptap LICENSE](https://github.com/ueberdosis/tiptap/blob/v3.32.0/LICENSE.md)、[Tiptap Pro 许可](https://tiptap.dev/pro-license)、[BlockSuite 根许可](https://github.com/toeverything/blocksuite/blob/v0.22.4/LICENSE)、[BlockSuite affine 包声明](https://github.com/toeverything/blocksuite/blob/v0.22.4/packages/affine/all/package.json)、[BlockNote 根声明](https://github.com/TypeCellOS/BlockNote/blob/v0.56.0/LICENSE.txt)、[BlockNote core 许可全文](https://github.com/TypeCellOS/BlockNote/blob/v0.56.0/packages/core/LICENSE)、[XL AI 声明](https://github.com/TypeCellOS/BlockNote/blob/v0.56.0/packages/xl-ai/package.json)、[官方商业边界](https://www.blocknotejs.org/pricing)、[CodeMirror 包声明](https://github.com/codemirror/lang-markdown/blob/main/package.json)。

以上为所读文件和官方说明的工程选型归纳，未完成拟发布依赖清单与所有文件的法律审查；没有验证的商业合同范围、价格和未来功能不作承诺。当前仓库自身 MIT 不会自动改变第三方代码的许可。

### 3.4 按本项目目标作出的综合比较

以下为架构判断，不是已测评分；“性能”按集成后的可控性比较，三种编辑器均不能自动解决全库检索/图谱性能。

| 维度 | Tiptap | BlockSuite | BlockNote | CodeMirror Markdown 优先 |
|---|---|---|---|---|
| 集成难度 | 中，编辑器+业务适配 | 高，CRDT/块模型适配 | 编辑器低，知识系统中高 | 低中，沿用 wrapper |
| 功能完整度 | 富文本强，知识业务自建 | 文档/白板强，Obsidian 语义仍缺 | 块文档开箱强，知识业务缺 | 源码强，富文本体验弱 |
| 画布兼容性 | 高，独立面板+轻节点 | 只用文档可行，引 Edgeless 重复 | 高，独立面板 | 高 |
| AI 兼容性 | 高，通过统一服务 | 可接，但需状态转换 | 可接自有 AI，避开 XL 依赖 | 高，文本直接消费 |
| UI 灵活性 | 高，自建 UI | 中，Web Component 边界 | 中高，需调整默认 UI | 高，编辑皮肤沿用 |
| 性能可控性 | 一次一个活动编辑器 | 需防 CRDT/双引擎开销 | 活动 block 文档需实测 | 源码长文更易控制，仍需实测 |
| 维护成本 | 中，方言/转换是重点 | 高，包来源和双模型 | 中高，有损转换/0.x 升级 | 中，预览与知识体验自建 |
| 商业可用性 | 核心 MIT 最明确 | 包/文件许可证待细化 | 核心 MPL，XL 单独约束 | MIT，依赖分别核查 |

主方案选 Tiptap，是为了原生 UI、React 适配和受控富文本能力；不是因为它已经是一套知识库。备选选 CodeMirror，是因为 Markdown 保真和已有依赖更贴合本项目；BlockNote 只有在产品转向 Notion 风格块文档、接受 JSON 权威时才值得重新排序。

## 4. Obsidian 核心功能覆盖矩阵

难度：低=局部 UI/契约；中=前后端完整业务链；高=方言一致性、批量导入或规模/安全系统工程。体验差距是预计，不是运行测试结论。

| 能力 | 现成开源基础 | 需自行开发 | 守守可复用 | 难度 | 预计差距 | 阶段 |
|---|---|---|---|---|---|---|
| 1 Markdown/富文本 | Tiptap/CM6；BlockNote Markdown 有损 | 双模式、受支持方言与转换门禁 | CM wrapper、主题、展示经验 | 中高 | P1 常用格式可接近；复杂方言源码优先 | P1，P4 扩展 |
| 2 自动保存 | 编辑器 change 事件 | 文档保存队列、CAS、草稿恢复与冲突 UI | 云画布状态机思路 | 中 | 无本地文件系统即时落盘；网络失败可恢复 | P1 |
| 3 文件夹/层级 | Tree UI | 父子关系、移动/重名/路径校验、分页 | AntD 与左面板 | 中 | 非 OS 文件目录，初期不直接同步本地文件夹 | P1 |
| 4 标签 | 解析器、UI Tag | 正文/Frontmatter 一致提取、过滤索引 | AntD、数据库 | 中 | 初期少高级组合查询 | P1 基础，P4 高级 |
| 5 Wiki Links | tokenizer/inline 扩展 | 补全、消歧、重命名、未解析链接 | 节点引用交互只能借鉴 | 高 | 自定义块/插件方言分步支持 | P1 基础 |
| 6 Backlinks | SQL 反向索引通用能力 | 保存时解析、来源位置/摘录、未链接提及另做 | PostgreSQL | 中高 | 已链接引用先做；未链接提及后做 | P1，P4 |
| 7 属性/YAML | YAML/Frontmatter 库 | 原样保留、类型校验、属性编辑与检索 | agent 有 yaml/gray-matter，但 API/Web 不直接共用依赖 | 中高 | P1 保留，P4 才接近属性管理体验 | P1 保留，P4 UI |
| 8 嵌入/块引用 | 编辑器自定义节点与 AST | 标题/块定位、循环保护、跨文档授权 | 资产展示、文档缓存 | 高 | 初期仅附件/整文档，块级逐步完善 | P2 基础，P4 完整 |
| 9 全文搜索 | PostgreSQL FTS/可选 pg_trgm | 中文召回、排序、分段摘录、授权分页 | API/DB | 中高 | P1 不承诺完整 Obsidian 搜索语法 | P1，P3 相关性 |
| 10 全局关系图 | 通用图布局/绘图基础 | 分层/聚合/分页、筛选和布局持久化 | 仅借主题，不加载到工作流图 | 高 | P2 摘要级全局视图，完整漫游后续 | P2 摘要，P4 |
| 11 局部知识图谱 | 图布局通用能力 | 邻接查询、渐进展开、边类型/方向 | 现有视口/裁剪经验 | 中高 | 初期层数与预算受控 | P2 |
| 12 大规模知识库 | DB 索引/编辑器视口基础 | 服务端分页、增量解析、缓存和性能测量 | Worker/Redis，现有节点裁剪 | 高 | 没有实测前不承诺万文档不卡 | 各阶段门槛，P4 深化 |
| 13 库导入导出 | ZIP/Markdown 解析；已有 fflate | 预览、冲突、路径映射、附件、清单及回滚 | 资产/上传、导出工具经验 | 高 | P1 单文档；整库 P4 才验收 | P1 单篇，P4 整库 |
| 14 Obsidian Markdown | 通用 Markdown + 自定义方言 | Wiki、alias、嵌入、callout、注释、block ID 等 | 原文保留/解析基础 | 高 | 明确支持子集；不含插件运行时 | P1 子集，P4 |
| 15 JSON Canvas | 公开规范/类型基础 | 双向适配、文件路径、外链/分组、损失报告 | 现有节点/导出能力部分可借 | 高 | 工作流端口/计费/生成配置无等价表示 | P4 |
| 16 AI 检索问答 | 模型 API、SQL 检索基础 | ACL 检索、切块、引用验证、编辑提案 | 模型目录/JobService/Agent/MCP | 高 | 不承诺无幻觉；无来源时明确无证据 | P3 |

Obsidian 的 Wiki Link、路径和重命名基线来自 [Internal links](https://obsidian.md/help/links)，属性格式来自 [Properties](https://obsidian.md/help/properties)，嵌入基线来自 [Embed files](https://obsidian.md/help/Linking%2Bnotes%2Band%2Bfiles/Embed%2Bfiles)，Canvas 交换格式来自 [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/)。富文本内核覆盖的是编辑界面，文件管理、关系索引、授权和迁移均属于额外工作。

## 5. 推荐技术架构

### 5.1 同一平台内分层，不增加独立知识平台

请求链：`知识 UI / Knowledge Node / Agent / MCP → 平台授权入口 → KnowledgeService → PostgreSQL / AssetService / 既有模型任务`。

- **文档层**：`KnowledgeService` 管空间、目录、文档、CAS 保存、软删除和版本；正文为 UTF-8 Markdown 源文，数据库是权威，导入导出是文件交换边界。
- **关系层**：Markdown AST/方言解析器生成链接、锚点、标签和附件索引；Backlinks 为入边查询，不另存一份反向边。显式语义关系单独记录，AI 建议必须标记待接受。
- **画布层**：原生 Knowledge Node 仅存文档引用和显示配置；使用独立知识查询缓存；语义图谱为临时视图，不入执行连接集合。
- **AI 层**：先授权检索，再组装有版本的来源包，复用文本任务和计费；生成/修改以提案形式进入文档保存链。
- **接入层**：REST、网页本地 Agent、私有 MCP 共享同一业务授权和持久化语义；不复制 SQL 给每个工具，不信任调用方提供的 userId。

建议新增目录：`web/src/services/api/knowledge.ts`、`web/src/components/knowledge/`、`web/src/stores/use-knowledge-ui-store.ts`、`server/api/src/knowledge/`；这些是拟议路径，**尚未创建代码**。UI store 只存选中文档/面板等交互状态，服务端文档走 Query 缓存，避免与画布 store 双权威。

### 5.2 Markdown 与编辑器状态的权威关系

- 数据库存**完整 Markdown 源文（含 Frontmatter）**、content hash、revision、parserVersion。解析出来的 properties/tags/plaintext/editor JSON 都是可重建的派生数据，不接受多个客户端独立写不同权威副本。
- Tiptap 只在活动编辑会话中持有 JSON；仅对验收过的 Markdown 子集开放富文本编辑。未知块、插件方言、YAML 或无法保真的输入保留源文并切源码模式，禁止“打开后自动保存”静默重写全文。
- 以固定语料验证 Markdown→编辑→Markdown；允许已声明的排版规范化，但不允许丢失链接目标、未知语法、属性或附件路径。源码模式直接编辑文本，不借由富文本 JSON 重建。
- 已有 CodeMirror wrapper 可作为源码入口；Markdown 扩展/安全渲染所需依赖在实施时审批。转换门禁失败则启动备选，保持同一数据模型/API，无须迁库。

### 5.3 保存与一致性

建议每篇文档单独保存，不复用画布十分钟自动保存周期或全量结构替换。新增保存延迟、大小、重试和并发限制均属于实际行为，值需获用户确认，本报告不把经验值写成默认生产配置。

1. 客户端以 `expectedRevision` 提交正文和 operationId，保存队列串行化同文档写入；本地草稿按用户/空间/文档保存。
2. 服务端校验身份、文档权限和当前 revision；解析成功后在同一事务写正文、revision、基础恢复快照、链接/标签索引和审计元数据；CAS 失败返回 409，保留双方内容供比较。
3. 保存失败不能显示“已保存”；切换项目/文档、关闭面板和退出要保留/提示未提交草稿。旧请求响应不得覆盖新文档或新 revision。
4. 大文档/批量导入的派生搜索索引可异步，但需暴露 indexedRevision；任务按 docId+revision 幂等，旧任务不能覆盖新索引。普通 P1 文档的链接索引同步提交，保障 Backlinks 即时一致。
5. 前端成功后失效同文档和邻接缓存；其他已打开页面在恢复焦点/显式刷新时检查 revision。P1 不承诺实时协同；P2 再补项目事件失效通知，事件不可代替权威回读。

## 6. 知识文档与知识关系数据模型

### 6.1 初始模型及约束

以下是设计字段，不是已执行 DDL。所有跨表引用带 space/project 一致性约束，UUID 仅作标识，不能作权限凭证。

| 实体 | 建议关键字段 | 约束/索引与阶段 |
|---|---|---|
| knowledge_spaces | id、project_id、name、created_by、deleted_at | P1 每项目一个活跃空间，可用已有个人默认项目承载个人库；不新增独立账号体系 |
| knowledge_folders | id、space_id、parent_id、name、path_key、revision、deleted_at | 同空间父子；禁止循环/移到子目录；活跃路径唯一，根目录重名也需约束 |
| knowledge_documents | id、space_id、folder_id、title、file_name、path_key、markdown_source、revision、content_hash、parser_version、created/updated_by/at、deleted_at | 活跃 `(space_id,path_key)` 唯一；规范化策略固定并保留显示路径；CAS 更新 |
| knowledge_revisions | doc_id、revision、markdown_source/hash、actor_id、source、operation_id、created_at | `(doc_id,revision)` 唯一；P1 最小恢复快照，P4 浏览/比较/保留策略 |
| knowledge_links | id、space_id、source_doc_id、source_revision、target_doc_id nullable、target_path_raw/key、alias、heading/block、kind、source_range、status | 按目标查 Backlinks，按来源替换出边；保留 unresolved/ambiguous，不伪造目标 UUID |
| knowledge_tags | space_id、doc_id、tag_key、display_name、source_revision | `(space_id,doc_id,tag_key)` 去重；支持层级标签过滤，非独立权威 |
| knowledge_attachments | space_id、doc_id、asset_version_id、logical_path、source_revision | 引用授权资产版本，不能持久存短期签名 URL；附件类型需扩展已有契约 |
| knowledge_audit_events | actor、project/space/doc、action、from/to revision、operation_id、content_hash、created_at | 保存/导入/工具修改审计；正文存 revision，不把全文/密钥写日志；幂等结果可关联 operation_id |

properties/aliases/plaintext 可作为 documents 的 JSONB/text 派生列或专用索引表，P1 只保留和解析所需字段；不为了高级属性提前建立复杂 EAV 体系。YAML 解析失败时允许保存源码与诊断，但不发布错误属性索引；不能丢掉原文后用空对象覆盖。

### 6.2 P2/P3 扩展模型

| 实体 | 目的与边界 |
|---|---|
| knowledge_space_project_grants | P2 显式授权来源知识空间供其他项目画布引用；至少含 space_id、target_project_id、read 权限、授予者、撤销时间，不隐式开放所有用户项目 |
| canvas_knowledge_refs | 可重建的画布文档引用索引：canvas_id、node_id、space_id、doc_id、mode、pinned_revision；随画布事务更新。节点引用为事实源，索引不能独立改出不一致结果 |
| knowledge_relations | P2/P3 显式人物/设定等语义关系：from/to doc 或实体、predicate、origin、evidence doc/revision/range、proposed/accepted；与解析出的 Wiki 链接不同 |
| knowledge_chunks | P3 doc_id、revision、chunk_id、heading/block、range、text/hash、parser_version；服务端按权限检索，旧 revision 失效 |
| knowledge_change_proposals | P3 AI/Agent 修改建议，记录 baseRevision、操作/diff、来源、审核状态；接受时再做 CAS，不覆盖用户最新编辑 |

语义向量不是初始必填字段；只有评测证明词法检索不足时才提议 embedding model/version/dimension 与可选 pgvector 增量迁移，仍使用同一个 PostgreSQL，先不引入独立向量服务。

### 6.3 链接解析、重命名与边界情况

- 通过 Markdown AST 和方言扩展解析，忽略 fenced code、inline code、注释等非链接位置；不能只用全局正则扫描 `[[...]]`。支持路径、显示别名与标题锚点；块 ID 与复杂嵌入按阶段开放。
- 路径解析在当前空间内进行：显式路径优先，唯一文件名/别名候选可解析，同名多候选显示消歧；空链接、无效路径、目标不存在保留原文诊断。不得跨空间全局匹配同名文档。
- 持久化 `target_doc_id` 提供稳定身份，同时保留原始链接文本以导出；路径移动/重命名要重新处理未解析链接、aliases、重复标题、块锚点和重命名前后的索引。
- 推荐重命名预览影响后，按每篇来源 revision 更新受影响链接；遇到并发编辑保留冲突任务，不用批量 SQL 直接覆盖源文。大型变更使用可恢复批次，客户端看到 processing/partial/conflict 状态。
- 删除文档采用软删除；入边保留并标记目标已删除，搜索排除，画布显示占位；恢复后重建。删除画布节点只删除引用，删除画布/项目也不越权连带清理其他项目知识。

块引用由显式 `^block-id`/稳定映射处理，不用易漂移的字符偏移当永久身份；source_range 只在对应 revision 内有效。循环嵌入须用 visited 集合、深度/展开预算和可见诊断限制，具体预算实施前确认。

## 7. 与现有画布的集成设计

### 7.1 原生 Knowledge Node

建议定义 `knowledge:document`，使用现有注册机制，宿主受控加载；不用可远程安装插件承载核心知识权限。节点 metadata 只保存 `knowledgeRef = { spaceId, documentId, mode, revision? }`、展示配置与可选非权威标题提示。

- 拖入：文件树拖拽携带 ID，由宿主按当前 project 校验引用资格，再换算画布坐标创建节点；不能把整个 Markdown/附件/base64 放进拖拽载荷或节点 metadata。
- 展示：按文档 ID 查询授权摘要，节点仅渲染轻量文本/缩略图；双击打开文档工作区。正文只为活动文档加载，禁止每节点启动完整编辑器。
- 引用：默认 latest，在重新验证后显示当前 revision；需要可复现创作时支持 pinned revision。`revision` 未填与 0 的语义明确区分，缺失文档、已删除、撤权显示占位并停止文本解析。
- 一致性：同文档多节点从同一 query key 读取，保存失效相关缓存；切换用户清缓存，跨页恢复焦点核对 revision。文档标题/正文变化不批量重写画布节点副本。
- 撤销：画布 undo 只撤销引用节点的增加、位置和连接；正文 undo 由编辑器会话处理，恢复历史版本是一笔新的文档 revision。移动节点不能触发文档保存。

类型扩展需检查 [CanvasNodeMetadata](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/types/canvas.ts)、[节点工厂](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/lib/canvas/canvas-node-factory.ts)、[内置注册](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/components/canvas/nodes/builtin-nodes.tsx)、[Agent ops](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/lib/canvas/canvas-agent-ops.ts)、服务端 [canvas-contract](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/canvas-contract.ts) 和资源引用校验；这些是改动清单，不是现在进行修改。

服务端现允许开放字符串 node type 和 record metadata，新增引用字段通常无须整体升级画布格式；但必须添加已识别知识引用的资源校验，不能借自由 metadata 绕过文档授权。注册表为 Map 覆盖式写入，需防同名插件覆盖原生知识定义。

还需统一新类型的定义身份：现有节点工厂/Agent ops 对带冒号类型生成 `builtin.*`，服务端缺省推断却生成 `plugin.*`。P2 应为知识类型明确同一个 definitionId/version，并覆盖创建、Agent、回读和导入路径；不为此批量重写旧插件的历史身份。

### 7.2 一文档多画布与项目权限

P1 文档归属来源项目知识空间，同一画布可以有多个引用。P2 才允许显式将知识空间授予目标项目用于引用，当前每项目单画布的模型保持不变。

- 读引用要求：来源项目未删除、用户具备来源文档读取权、目标项目可读，且来源空间已向目标项目授权。授权不会自动赋予原本无权访问来源项目的人权限；如以后需要这种共享，另设计空间 ACL，不在本阶段暗中扩大权限。
- 编辑仍要求来源项目 edit 权限；目标画布 editor 只有目标节点编辑权，不自然获得来源文档写权。创建引用还需目标项目 edit。
- P1 不支持跨项目附件复用；P2 跨项目知识引用中的附件必须走同样授权解析下载，不能把来源私有签名 URL 放进目标画布。撤权时清理查询/预览缓存并使后续请求失败。
- 如果未来产品要求“目标项目新成员无需来源项目成员资格即可共享阅读”，必须先确认该权限语义；不将其混入第一版跨画布复用实现。

这条保守路径已满足一个用户在多个有权访问的画布中复用文档；没有为了该能力重构 projects/canvases 基数关系。UI 必须把“引用源文档”和“复制为新的文档/创作文本”区分清楚。

### 7.3 知识关系与工作流连接隔离

- 文档间 Wiki Link 进 `knowledge_links`，人物/世界观语义进 `knowledge_relations`；图谱坐标仅作可丢弃视图缓存。
- 知识节点连接生成节点时，只有用户显式创建的 `resourceType=text` / `role=data` 等执行边进入原 `CanvasConnection`；不能因为两篇文档互相引用就自动增加生成输入。
- “展开关联”优先打开局部关系视图；只有明确选择“添加到画布”的文档才生成持久化 Knowledge Node，且不自动创建执行边。
- JSON Canvas 中普通展示连线不得默认解释为生成工作流边；导入时保留为展示关系或输出不支持项，不能静默触发任务。

### 7.4 引用供生成使用时的关键适配

当前 `CanvasNodeDefinition.resource(node)` 是同步读取 node metadata。推荐保留已有图片/文本解析路径，在现有**异步生成输入准备阶段**增加知识引用解析分支：服务端按操作者和项目重新读取文档，输出不可变来源包。

来源包含 documentId、revision、contentHash、标题/锚点、摘录和来源范围；写入生成 trace/输入快照用于复现。latest 文档变化后，已开始任务继续使用原来源包；重试需明确复用旧版本还是重新取最新。文档更新不得自动重新触发计费生成。

不得仅让前端 `resource` 返回一个旧摘要供模型使用，也不能把异步请求塞进每个节点渲染函数。知识到 Text/Config 的转换属于明确复制操作，保留来源元数据但不宣传为持续同步引用。

### 7.5 JSON Canvas 交换边界

JSON Canvas 1.0 是交换格式，不是本平台执行格式；现有自定义项目导出不能直接宣称兼容。P4 建立双向 adapter，导入预览先列支持和损失项，再创建可恢复的新数据。

| JSON Canvas 类型/属性 | 导入守守 | 导出处理 |
|---|---|---|
| text / text 字段 | 普通文本或独立 Markdown 文档，用户明确是否入库 | 文本内容导出为 text；知识文档优先导出 file 引用 |
| file / file + subpath | .md 解析为 Knowledge Node，附件走授权资产；不存在文件保留缺失占位 | 打包相对路径附件/Markdown，标题或块锚点转 subpath；不用数据库 ID 冒充文件路径 |
| link / url | 安全外链卡片；本平台尚无通用内置外链节点，需单独适配，禁止自动执行或抓取 | 仅导出允许协议 URL；不可用类型给出损失报告 |
| group / label / background | 保留视觉边界和标签，组内归属需按平台明确规则映射 | 平台 groupId 与标准几何分组语义不同，必要时保留 sidecar 映射并报告差异 |
| x/y/width/height、边方向/端点/label/color | 坐标与渲染适配；普通边保持展示语义 | 标准要求整数坐标，浮点转换声明舍入；端口/role/生成配置无标准等价字段，禁止伪装为无损 |

未知节点/字段、工作流配置与宿主专有信息通过显式兼容清单/可选 sidecar 保留；导出先授权并排除凭据。原有图片/视频/音频可映射 file，但素材必须一并导出或标明缺失，不能仅导出临时签名 URL。

## 8. 与 AI API、Agent、MCP 的集成设计

### 8.1 检索、问答与创作

P3 推荐先做“授权词法检索 + 引用来源 + 模型生成”，再用评测决定是否加语义向量。已有模型网关只公开 text/image/video/audio 能力，没有经过核验的 embedding 模型链路，不能把文本接口当 embedding 接口用。

1. KnowledgeService 基于身份、空间和项目构建授权集合，在数据库候选查询阶段过滤；标题、路径、标签先命中，正文全文/子串搜索补充，结果去重并标明 revision。
2. 按标题/段落切块，返回可定位摘录；按模型实际 token 预算装配上下文。拒绝“把所有文档塞进 prompt”，也不能只靠现有字符上限假定任何模型都能容纳。
3. 模型通过现有 JobService 和 Worker 执行总结、人物关系分析、设定一致性检查、创作转换等任务；从授权来源提取证据，引用映射由服务器控制。
4. 输出使用来源编号，服务端校验引用只指向本次检索来源。没有证据时显示不足；摘要、猜测、关系建议与原文事实区分，不能把模型回答写回当作原文事实。
5. AI 修改文档先生成 baseRevision 对应的 diff/提案，用户接受或已授予范围的 Agent 指令才提交 CAS；版本落后返回冲突。任务失败、取消或计费状态不明时不能重复启动造成重复扣费。

P1 搜索采用现有 PostgreSQL：先保证中文精确子串/标题标签召回与授权分页；英文等可用原生 FTS。中文连续文本不能仅用默认 `simple` 词典就承诺良好分词；二字人物名、同义表达、混合语言均需语料评测。

数据规模增大时提议 `pg_trgm` 支持相关查询索引，但该扩展并非本轮已安装，短查询可能无有效 trigram 仍需回退和测量。参见 [PostgreSQL 16 FTS](https://www.postgresql.org/docs/16/textsearch.html)、[pg_trgm 索引及约束](https://www.postgresql.org/docs/16/pgtrgm.html)。

语义增强顺序：先用小规模问答集测词法召回和出处，再可选 query rewrite/rerank；仍不足才评估 embedding 与同库 pgvector。需确认供应商、费用、隐私、重算成本、版本维度和权限过滤方案，不新增独立向量数据库作为先决条件。

### 8.2 六个拟议知识工具

本节只有契约设计，没有注册工具或调用写操作。REST 路由建议以 `/api/projects/:projectId/knowledge/...` 为入口，由服务端绑定 actor；read/update 即使有 documentId 也必须回查真实 space/project。

| 工具 | 主要输入 | 返回/保证 |
|---|---|---|
| search_knowledge | projectId、spaceId、query、filters、cursor、limit | 授权摘要/命中片段、docId/revision、nextCursor、索引状态；不默认返回全篇 |
| read_knowledge | projectId、spaceId、documentId、revision?、anchor? | 原文/范围、revision/hash、属性和来源定位；缺失或无权不泄露正文 |
| create_knowledge | projectId、spaceId、folderId?、path/title、markdown、operationId | 唯一 docId、已持久化 revision；重复调用不创建副本 |
| update_knowledge | projectId、spaceId、documentId、expectedRevision、明确 replace/patch 操作、operationId | 新 revision/hash；冲突不覆盖，空正文是合法替换但需明确操作；未传字段不作清空 |
| query_relationships | projectId、spaceId、documentId、direction、kind、cursor、预算参数 | 授权邻居/边、是否截断、nextCursor、revision；计数也不能包含无权文档 |
| add_knowledge_to_canvas | targetProjectId、canvasId、documentId/spaceId、位置、mode/revision?、expectedCanvasRevision、operationId | 校验双方权限后事务落盘节点和引用索引，返回 nodeId、canvas revision；冲突要求重读 |

limit、关系深度、响应体上限、超时/重试等只定义为需受控参数，**具体默认值和失败处理须按项目规则取得确认后才实施**。读工具只读标注，写工具标注副作用；annotations 不能代替真正 ACL。

### 8.3 两条 MCP 接入的改造边界

- **本地 canvas-agent**：可继续经已绑定网页的当前登录会话请求知识 REST；知识工具请求必须显式校验 project 与绑定客户端，避免焦点切换串项目。无网页时明确不可用，不能悄悄使用管理员数据库身份兜底。
- **普通商业用户的无浏览器 Agent**：如确需后台访问，再做平台签发的可撤销、有限 scope 的授权凭据；按用户/项目/动作审计。沿用账号系统，不要求 Obsidian 账号；不把 HttpOnly 登录 Cookie 复制到 Agent 配置。
- **私有 Vibe MCP**：保留其 operator 身份和项目白名单，知识工具应调用同一 KnowledgeService/平台内部接口；不得把拥有 DB 凭据的运维进程直接开放给普通用户。原始源码工程与发布方式需先定位，不能维护 bundle 手工补丁。
- **画布写入**：`add_knowledge_to_canvas` 必须使用画布 revision CAS，并令页面回读/处理冲突；浏览器 `applyOps` 只能作为交互响应，必须等保存成功再返回持久化成功。当前网页未保存修改与外部写入发生冲突时保留本地草稿，不自动覆盖。
- **日志和审计**：现有 [CanvasSession.callTool](H:/CodexStorage/infinite-canvas-auth-upgrade/canvas-agent/src/canvas/session.ts:442) 记录 rawInput。新增知识工具不能照搬全文日志；只记资源 ID、动作、长度/hash、revision、request/operation ID，敏感文档正文与凭据不写普通日志。

通用知识 API 的访问检查每次都执行；不能缓存“曾经有权限”长期放行。被模型读到的外部文本和知识正文均是不可信资料，不能授权工具、切换身份或扩大搜索范围。

## 9. UI 交互建议

### 9.1 推荐工作区

**使用现有左侧面板作为知识导航，正文在画布坐标变换之外的可调宽工作面板打开，并支持进入独立文档工作区。**不把长文编辑器放进卡片，也不把长期编辑放进居中 Modal。

- 左面板增加“知识”入口：按需文件树、搜索、标签；当前项目/空间始终可见。沿用现有侧栏展开/收起和手机 Drawer，不改原有素材入口职责。
- 文档面板展示标题、来源项目、保存状态、源码/富文本切换和 Backlinks；可调宽，长文可专注打开同平台独立文档路由。右侧已有 Agent 面板时提供互斥/切换，避免三个窄栏挤压画布。
- 点知识节点定位同一个文档面板；节点预览只读，原文修改集中在编辑器；增加“引用到画布”“复制到创作节点”明确动作。
- 关系视图与正文切换，展示入链/出链/显式语义关系，用标签和线型区分；默认当前文档邻域，逐步展开并显示尚未加载的数量。
- 手机采用单工作区导航，先目录再正文再画布，保留返回位置与未保存提示；拖拽有“添加到画布”按钮替代。键盘文件导航、链接补全、焦点返回和中文输入法组合输入必须验收。

编辑器根节点声明 `data-canvas-no-zoom` 并正确处理滚轮、指针、快捷键和 contenteditable；正文撤销不得冒泡为画布撤销。现有 InfiniteCanvas 已规避部分输入区空格行为，但新面板仍需回归 Delete/Backspace、Ctrl/Cmd+Z、滚轮和输入法选字。

### 9.2 主题与状态

沿用 `canvasThemes` / `useThemeStore` / Ant Design token；深色与浅色都验收，不硬编码独立色板。工具栏保持当前扁平透明风格，图谱不引入完整 AFFiNE/Obsidian 外观。

必须设计的状态包括：无文档/搜索无结果、加载和离线草稿、正在保存/失败/冲突、文档被删或撤权、链接未解析/歧义、索引落后、图谱部分加载。不将“错误返回空列表”包装为真的没有知识。

本轮只提出交互方案，没有改变现有 UI；编辑器布局、宽度阈值和快捷键细节在获批后的隔离原型中确认。

## 10. 性能、安全及许可证风险

### 10.1 按严重度排序的关键发现

| 级别 | 发现与证据 | 影响及建议 |
|---|---|---|
| P1 安全 | 现有 Markdown 插件 `marked.parse` 结果直写 innerHTML，所读路径没有净化 | 导入不可信 Markdown/HTML 可能引入注入风险；未做攻击验证，不能声称已利用。知识预览必须禁用/净化危险 HTML、协议和属性，不复用该渲染路径 |
| P1 一致性 | 私有 MCP `create_vibe_storyboard`（本地 bundle 142467 行起）直接插 nodes/edges，再单独快照，未走正式画布 expectedRevision 保存链 | 与网页全量保存竞争时可能丢外部写入/产生不一致快照；知识画布写工具必须统一 CAS 事务，旧工具的整改需独立获批，不在本轮更改 |
| P1 权限 | 私有 MCP `requireProject`（142199 行附近）所读查询未筛 deleted_at，写权限仅拒绝 viewer；身份解析结果被缓存 | 与正式 API 的已删除项目过滤、owner/admin/editor 白名单不一致；停用账号后缓存身份的即时撤销能力不足。不能直接复制为商用知识 ACL；线上是否加载此 bundle 待确认 |
| P1 隔离 | 本地 MCP token/浏览器客户端身份与平台用户授权是两层；现有 rawInput 日志会扩大知识正文暴露范围 | 新工具每次服务端授权、操作审计、日志脱敏；不把 DB operator 凭据做成通用用户接入 |
| P2 性能/兼容 | 画布结构已有数量/字节上限、全量保存与 O(N) 裁剪；编辑器转换及第三方包许可尚有边界 | 图谱独立按需加载；Markdown 保真原型和依赖清单许可核验作为实施门禁 |

这些是本次知识集成的关键相关发现，不是对整个平台所有路由和漏洞的穷尽审计。已追踪注册→渲染→输入解析→保存→Agent 回执主链；支付、视频供应商内部协议等仅确认复用边界，没有进行业务安全复审。

### 10.2 图谱和大知识库性能设计

代码现状：[visibleNodes](H:/CodexStorage/infinite-canvas-auth-upgrade/web/src/pages/canvas/project.tsx:997) 已按视口过滤节点，但每次仍扫描节点集合；连接只在 performanceMode 且两端都不可见时跳过，正常模式仍遍历；画布保存事务替换项目节点/边并记录快照，不适合高频全库图谱布局。

[canvas-contract](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/canvas-contract.ts:6) 当前硬上限为 **1000 节点、4000 边、4 MiB 结构载荷**。这是已存在的值，本方案不修改或抬高它们；文档数与这些上限完全分离。

- 全库数据留服务端，目录、搜索、Backlinks、邻接均分页/游标查询；列表不返回全文，附件按需取；Query 缓存按 user/space/doc/revision 和权限范围分键。
- 首次图谱只取当前文档邻域，展开有节点/边/层数预算与明确截断提示；全局视图用聚合/抽样摘要，筛选后再展开，不自动实例化成创作节点。
- 布局在 Worker 计算并可取消；缓存 key 包括空间、邻域/过滤条件、关系版本和布局版本，保存用户固定位置，避免每次点选重排。
- 视口裁剪、低缩放简化标签、按需文字度量、平移缩放帧合并；图谱专用轻量渲染与主画布分离。只有实测证明 DOM/SVG 局部视图不足时才引入 Canvas/WebGL 视图，不借机替换原引擎。
- 索引按更新文档增量重建；可选异步任务与生成任务隔离，观测队列延迟和 DB pool 争用。编辑单篇、移动单节点不得拉取全库或重算全图。

建议验收数据集（测试目标，**不是生产默认限制**）：1 千/1 万篇混合中文文档、10 万条链接，覆盖长文、高出入度节点、附件和重名路径。测搜索/邻接 p50/p95、打开文档、输入延迟、布局耗时、拖拽帧、峰值内存、保存冲突和索引延迟，并在低端设备复验。

可讨论的目标是授权搜索 p95 ≤500ms、普通文档打开 ≤1s、局部图谱拖动接近 60fps；尚未压测，必须先确定设备、网络、数据集和预算再签订验收标准，不能作为现有性能宣传。

### 10.3 数据隔离、文件与 AI 安全

- **授权闭环**：检索候选、结果总数、Backlinks 摘录、图谱边、版本、附件和导出均先授权；不能返回后再前端过滤。检查来源/目标资源真实归属，防跨项目 UUID 直接对象引用；停用账号、退出、撤成员、软删除项目都必须重新生效。
- **浏览器缓存**：按 userId/spaceId/docId 隔离，登出/换账号清活动缓存；撤权后不继续显示旧全文；离线数据敏感性和是否允许脱机查看需单独确认，P1 不承诺完整离线 Vault。
- **导入下载**：ZIP 路径穿越、绝对路径/盘符、符号链接、重复条目、解压炸弹、编码、YAML 资源耗尽、SVG/HTML 等主动内容需处理。先预览清单、冲突策略和目标空间，批次标识与版本支持恢复；不得自动从 Markdown 任意 URL 抓附件。
- **外链和媒体**：仅允许已确认安全协议，外链有跳转提示；服务端取远程内容继续沿用现有 media-security/remote-media 边界，限制内网地址与重定向。附件经授权流或短时下载，不能缓存过期签名 URL 为文档正文。
- **AI/Agent**：文档属于资料，不能提升为系统指令；不能因正文写着“读取另一项目”就扩权。写工具必须明确目标、baseRevision 和幂等 ID，提案/保存分离，上传到外部模型的文档范围可见；审计记录保留必要归属与 hash，不记录密钥或普通日志全文。

### 10.4 商业与维护门禁

主方案只依赖公共编辑核心与自有模型服务，不需要 Tiptap Cloud、BlockNote XL、Obsidian 客户端/账号或 AFFiNE 账号。商业收费功能须按实际选入的包再次审核，不能用本报告的核心许可证结论覆盖未来插件。

落地前建立直接/传递依赖 SBOM、固定版本与通知清单，确认 MPL 覆盖文件的分发义务、BlockSuite 包声明冲突、XL/pro 功能来源和升级策略。第三方支持范围、SLA、真实 bundle 大小、未安装依赖的漏洞情况、完整许可证兼容性仍待确认。

结构与维护方面：`project.tsx` 已有四千余行，不能再把知识库 CRUD、文件树、解析与索引逻辑堆进去；只在宿主增加薄集成边界，知识代码按实际业务模块组织。避免同时引入自建笔记 store、编辑器 JSON store 和画布 metadata 正文三份权威，也避免创建通用图数据库/Agent 框架来解决第一版需求。

文档还有既有残留：[docs/index.md](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/index.md) Notes 仍描述“项目主要在浏览器、Key 直连”，与当前平台权威数据/内置模型链不一致。本报告依据实际源码和配置，没有顺手修改这段无关历史说明；知识开发文档应同时纠正相关入口，避免新模块继承旧假设。

## 11. P0–P4 开发路线

估算为一位熟悉本项目的资深全栈工程师有效人日，包含相应定向测试、设计复审和文档，不含等待审批、外部模型采购或团队实时协同。并行开发可缩短日历时间但不直接把人日减半；总量约 **82–121 人日**，并非一两个编辑器组件的工作量。

### P0：技术审计与架构确认（4–6 人日总计）

- **范围**：本报告完成源码与官方资料审计；剩余为用户确认、隔离编辑器保真/输入法/主题原型、中文检索基准及权限契约评审。原型属于后续实施，当前没有装依赖或编写原型。
- **模块/结构**：仅设计文档、拟议 API/数据契约、固定语料与性能计划；确认私有 MCP 原始源码工程/实际加载版本，不改生产数据。
- **风险/原功能影响**：Tiptap Markdown Beta、未知语法与第三方许可；原型与生产分离，现有创作功能不改。
- **工程量**：本轮报告工作包含在总估算内；原型和门禁仍需单独安排，不把静态审计视作完成了运行验收。
- **验收**：选定主/备方案、权威格式和跨项目权限语义；固定语料语义无丢失，未知格式源码回退；React19/中文输入法/快捷键可用；MCP 与性能阻塞项有处理结论。

### P1：文档管理 MVP（20–28 人日）

- **范围**：文件树、单文档 Markdown 导入导出、受控富文本/源码、独立自动保存、标签、基础 Wiki Links、已链接 Backlinks、授权搜索；保留 Frontmatter。最小恢复版本、操作审计和权限从第一版开始。
- **模块/结构**：新增 knowledge API/service/contract、增量迁移、文档/目录/版本/链接/标签/附件映射/审计；Web knowledge 组件与服务、主题适配。按需要扩展资产附件类型，不修改现有生成语义。
- **风险/原功能影响**：转换丢失、并发覆盖、中文搜索弱；功能开关隔离新入口，画布类型先不增加。新增表而非覆盖旧库，回滚先关闭入口并保留新数据。
- **工程量**：20–28 人日；不含完整 Obsidian 方言、协同编辑和整库迁移。
- **验收**：新建/改名/移动/删除/恢复闭环；刷新不丢已确认保存内容；两个页面同 revision 修改一方 409、草稿保留；空正文可保存；失联/换账号/撤权正确；同名与未解析链接可诊断，Backlinks 随成功保存更新；中文人物名搜索基准通过；原账号/文本/画布/资产冒烟无回归。

### P2：画布融合与局部图谱（18–25 人日）

- **范围**：原生 Knowledge Node、拖入/按钮添加、latest/pinned 文档引用、局部关系展开、全库聚合入口、明确知识到创作文本转换；显式授权后跨项目画布引用。
- **模块/结构**：节点定义/类型/创建、canvas contract 资源检查、异步知识输入解析、canvas_knowledge_refs、空间项目 grants、局部邻接接口与布局缓存；KnowledgeService 与画布保存事务协作。
- **风险/原功能影响**：执行边污染、上下文旧摘要、引用越权、编辑快捷键冲突；不调整旧端口语义、不重写画布，知识更新不自动触发生成。主画布关键链发生适配，必须回归。
- **工程量**：18–25 人日；复杂实体关系抽取和全量实时图谱不在此阶段。
- **验收**：一文档多节点/多个授权画布回读一致；更新无需重存每个引用；删除/撤权后预览和生成均停止；无权目标被拒；图谱边不出现在执行边；undo 正文/画布分离；旧图像/视频/音频/分组/插件生成、连接和保存通过；全库规模下实际加载数有界、不突破已有画布契约。

### P3：AI 知识与 Agent/MCP（18–27 人日）

- **范围**：带出处问答、总结、人物/设定分析、关联建议、知识驱动生成、文档修改提案；六个知识工具与必要的网页/无头授权入口。先词法检索，语义增强按评测决定。
- **模块/结构**：knowledge chunks/proposals/relations、检索与上下文编译、JobService trace 扩展、工具 schemas/registry/handlers；先解决私有 MCP 权限/保存差异并统一到业务层，不复制原始直库写法。
- **风险/原功能影响**：提示注入、来源幻觉、重复扣费、过期修改和 MCP 客户端串项目；新增任务与原生成任务隔离。Agent 共享接口有真实回归范围，不能仅靠 UI 测试。
- **工程量**：18–27 人日；若另做面向外部客户完整远程 MCP OAuth 产品、重型语义搜索，需重新估算，不包含在此基本接入量中。
- **验收**：两个用户/三个项目的检索与工具隔离，viewer/撤权/删除项目全部生效；每条有效引用能定位对应 revision；无来源时不给假出处；重复 operationId 不重复文档或扣费；过期 baseRevision 冲突；取消/失败无半写正文；既有 MCP 工具名/行为与对话归属不变；知识到生成记录完整来源包。

### P4：格式兼容、高级属性与规模化（22–35 人日）

- **范围**：ZIP Vault 导入导出、Obsidian 方言扩展、JSON Canvas 适配、高级属性、历史比较/恢复、性能优化；增量同步按实际需求选择，首版不复制插件生态。
- **模块/结构**：导入预检与批次 manifest、路径映射/错误报告、附件事务补偿、属性类型/锚点索引、版本 UI、图谱聚合/分级渲染与可选搜索索引；必要时增加同步游标，不以本地文件系统为云端权威。
- **风险/原功能影响**：导入破坏性、未知方言丢失、附件错链、超大 ZIP/库与格式降级；仅向明确目标增量导入，冲突逐项处理，原创作流程保持边界但需导出/引用回归。
- **工程量**：22–35 人日；完整离线协同、本地双向文件监控、全插件兼容另立项。
- **验收**：固定 Vault→平台→Vault 语料语义一致，未知格式原文保留；YAML/aliases/heading/block/附件相对路径正确；失败批次可恢复、不覆盖旧数据；JSON Canvas text/file/link/group 与边样式有映射/损失清单且绝不触发生成；历史恢复新增 revision；规模数据、低端设备和跨浏览器达到确认的性能预算。

调整理由：P1 提前纳入最小版本和安全，而非等 P4 才防丢文/隔离；P1 先做单篇导出以保证退出通道；基础语法保真也必须前置，完整 Vault/JSON Canvas 留 P4。跨项目共享放 P2，避免 P1 偷改现有一项目一画布模型；全文检索先于语义向量，以证据决定基础设施。

## 12. 最终推荐方案及依据

### 12.1 决策

**主方案：Tiptap（公共核心）+ Markdown 权威源文 + 现有 CodeMirror 源码入口 + PostgreSQL 知识业务层 + 原生 Knowledge Node。**

理由：React19 适配有 manifest 证据，headless UI 保留守守主题；已有节点注册、资源管线、账号、存储和任务足以增量集成；数据和关系由平台掌控，AI/MCP 共用业务层，不依赖编辑器厂商服务。知识关系与执行流分离，从架构上避免全库塞进画布和重复权威。

**备选方案：CodeMirror 6 Markdown 优先编辑 + 安全预览，其他数据/API/画布设计不变。**

触发条件：Tiptap 固定版本仍无法通过目标方言的转换保真门禁，或团队无法承担富文本维护。此时先牺牲部分所见即所得体验，保住数据格式、权限和画布集成；以后通过兼容的编辑器适配增加富文本，无须迁移知识库。

本轮不选 BlockSuite，主要原因是双模型/CRDT 与双画布维护成本，以及独立包与 AFFiNE 开发线差异；不选 BlockNote 为主/备，主要原因是默认块 JSON 权威、有损 Markdown 和 XL 许可边界。三者都不提供守守完整的账号隔离知识系统，选择任何一个都不能省略本报告的业务层。

### 12.2 已验证、待验证与下一步

已验证的是本地源码/lockfile、节点扩展及保存/权限链路、两个 MCP 的不同实现、官方发布和包声明、官方 Markdown 能力边界。本报告包含 12 个交付章节和 16 项能力矩阵，未写生产功能代码。

尚需确认：

- 实际上线镜像/数据库扩展、当前用户数据量、典型单文档/附件规模及目标低端设备；本轮没有访问生产，不用本地 Compose 替代生产结论。
- 私有 Vibe MCP 原始源码工程、部署来源和当前加载 bundle；其权限和 revision 差异的运行复现及修复范围。
- Tiptap 方言往返、中文输入法和 React19 实际集成效果；三候选未安装，性能/包体积/漏洞未测。
- 精确依赖清单许可、BlockSuite root/package 声明差异、任何商业扩展合同；CodeMirror 新自建站部分页面无法读取，采用 npm 和官方迁移说明作为已核验证据。
- 跨项目共享是否采用本报告“仍要求来源权限”的保守语义，以及保存延迟、导入/检索/图谱预算、历史保留与离线策略；这些值未写入现有配置。

**建议下一步仅确认主/备选、Markdown 权威和项目权限语义，再批准 P0 隔离原型；通过保真与授权门禁后才进入 P1。当前停留在审计方案阶段。**

### 12.3 核验记录与文档变更边界

- 静态检查覆盖 Web/API/canvas-agent 配置、画布注册/渲染/连接/裁剪/持久化/资源解析、认证和项目权限、资产契约、文本任务、Agent 工具路由及本机私有 MCP 相关函数；没有穷尽审查每一行代码。
- 官方核验包括 GitHub 连接器读取仓库/固定 tag 文件/releases，以及 npm registry 元数据。CodeMirror 新地址见 [官方迁移说明](https://github.com/codemirror/dev/blob/main/README.md)，Markdown registry 见 [包元数据](https://registry.npmjs.org/@codemirror%2Flang-markdown)；主站抓取 403 已记为资料限制。
- 本轮仅增加本报告并追加 task_plan/findings/progress 审计记录；既有 todo/pending-test 已检查，未把尚未批准的方案写成已实施功能或正式待办。无用户可感知功能变更，无需修改 CHANGELOG。
- 未运行 typecheck/test/build：没有代码或依赖变更，本轮是设计审计；不据此声称运行测试通过。交付前仅做文档差异、引用路径/行号与章节覆盖检查。
