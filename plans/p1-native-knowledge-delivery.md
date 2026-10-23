# P1 原生知识库本地交付

本轮只在完整隔离副本中开发，未合并回原工作区、未提交、未推送、未部署。体验入口为 http://127.0.0.1:5177/knowledge ，后端为本机 5302。账号和数据来自独立测试环境，线上账号不会自动出现；可使用既有注册页创建本地账号。

## 已实现

- personal/project 两种空间；个人空间不依附项目生命周期。项目空间沿用活跃用户、未删除项目和成员角色授权，每次读取、写入、查询回执重新校验；逐文档跨项目授权只保留表结构，不开放共享。
- 文件夹创建、重命名、移动和空文件夹软删除，禁止循环和跨空间移动。文档创建、移动、重命名、编辑、软删除、回收站和历史版本向前恢复；非空文件夹不会级联删除文档。
- Markdown 唯一权威正文，独立 revision/contentHash，全文历史、标签、Wiki/别名链接、历史名称、绑定目标 ID、反向引用和操作审计。重命名不替换原文；同名引用需要显式选择，绑定之后维持文档身份。
- 标题、标签和正文联合搜索，PostgreSQL simple FTS 加转义的子串匹配，支持中文姓名、专业术语和中英混合；空间权限、分页、最近编辑、文件夹和标签筛选。
- 原应用内懒加载知识页、三栏导航/编辑/关系区域、折叠及键盘/指针调宽、独立滚动、深浅主题、基础手机布局。新增入口，不改原大型 canvas/project.tsx。
- CodeMirror Markdown、受控 Tiptap、模式切换、Wiki 补全和点击跳转、属性、历史预览、导入导出。相同空间/目录/标题/内容哈希的重复手工导入复用原文档；内容不同创建新文档，不覆盖。

## 保存与内容保护

KnowledgeService 使用真实 Drizzle/PostgreSQL 事务。先校验并锁定活跃身份和空间/项目权限，再以操作者和 operationId 锁定幂等操作；同一 ID 相同 payload 返回已提交回执，不同 payload 拒绝。校验 expectedRevision，原子写正文、版本、标签、关系、审计和回执，提交成功才返回成功；审计失败会整体回滚。

知识文档不复用画布全量保存，既有画布 CAS、幂等回执、MCP 权限及旧直库关闭机制保留。空间写锁保持关系解析一致；大空间吞吐仍需按实际规模压测。

浏览器 IndexedDB/localforage 按用户、文档和页面分别保护草稿、待确认操作及其他页面副本；刷新沿用稳定 operationId。网络失败或回执不明先查原操作，不能通过换 ID 盲目重试。冲突显示本地/远端比较，仅在用户明确确认所比较版本后再次 CAS 保存；比较后远端再变化仍拒绝。切页前保护草稿，关闭页面有未保存提醒。

输入中不逐键序列化整篇富文本。富文本聚焦编辑期间只保存本地临时编辑器状态，失焦、明确保存、模式切换或输入法提交时生成 Markdown；服务端从不把临时 JSON 当作正文权威。离开编辑区后自动保存，也可随时手动保存。源码编辑中的组合输入不作为已完成内容提交。

复用 P0 固定语料和语义守卫。打开文档与仅切换模式不会重写 Markdown；Frontmatter、Callout、任务项、嵌入或未知扩展等不能证明无损的内容显示源码保护。附件引用保留原路径，P1 没有新增附件上传、Vault ZIP 同步或服务器本地文件读取。历史恢复生成新 revision，不删除旧版本。

## 数据库与接口

增量迁移 `server/api/db/migrations/0046_native_knowledge.sql` 仅在 P1 隔离 PG 执行。新增 spaces/folders/documents/versions/tags/document_names/links/operations/audit/document_project_grants 表；不修改既有 0045，不重置旧表。正式环境仍需独立审查和备份后授权迁移。

服务实现位于 `server/api/src/knowledge-service.ts`，解析索引位于 `knowledge-index.ts`，路由位于 `knowledge-routes.ts`。API 前缀 `/api/knowledge`：spaces、空间 documents/folders/tags、单文档正文/history/version/relations、操作回执和 actions。actions 包括 document.create/import/save/delete/restore/resolveLink 与 folder.create/save/delete；写入均使用 operationId，修改已有实体另带 expectedRevision。

依赖只安装在隔离副本，并更新该副本的 package-lock：Tiptap 3.32.0 开源套件、CodeMirror Markdown 6.5.2/autocomplete 6.20.0、unified/remark/YAML、DOMPurify/marked；沿用既有 React、Ant Design 和 localforage。16 个直接新增包的实际版本、许可证和 LICENSE 文件哈希见 `artifacts/dependency-licenses.json`，许可为 MIT/ISC 或 MPL-2.0/Apache-2.0 双许可选项，没有引入 Tiptap Pro；报告不替代将来分发时的第三方声明整理。

## 实际验证

证据统一保存在隔离目录 `artifacts/`；早期失败日志保留，最终结论以文件名中 complete/validated 或下述结果 JSON 为准。

- 真实 PostgreSQL 测试 11/11：CRUD/层级/中文搜索/权限撤销与用户停用/删除项目/个人归属、全 P0 原文、链接消歧、并发 CAS、同 ID 重放与异 payload 拒绝、审计故障回滚、真实 Hono 登录路由，以及 500 篇关联文档通过真实服务创建。见 `knowledge-tests-complete.log`、`knowledge-results.json`。
- 实际 Chromium 两轮 8+10 组通过，无页面脚本异常：创建编辑、源码保护、无副作用打开/切换、网络失败刷新、两页面冲突、历史/回收站、主题/手机/键盘调宽、真正富文本保存、组合事件保护、Wiki 补全、聚焦富文本草稿刷新、回执丢失、文件夹操作、关联消歧、P0 全语料、实际文件导入下载及重导入。
- 501 篇（含一篇 69,006 字符长文）的创建/索引/历史/审计测试块耗时 36,061ms；不是搜索请求延迟。最终浏览器 58,290 字符文档加载约 1,697ms、输入并保存约 1,883ms，是单次同机观察，不是逐键延迟或生产性能承诺。
- 原创作后端回归 65 项通过；隔离 stdio MCP 13 工具、v2 幂等回执及真实 Web/MCP CAS 竞争通过，未新增知识 MCP 工具。真实画布页面保存与可见文本节点通过，画布页没有请求知识编辑器模块。供应商调用使用测试替身，没有触发付费图片/视频/音频生成。
- API TypeScript 构建、Web TypeScript 和 Vite 最终构建结果见 `api-build-final.log`、`web-typecheck-complete.log`、`web-build-complete.log`。编辑器为动态模块；原应用已有的大块构建提示仍存在。
- 最终补充恶意 HTML/脚本/事件/javascript URL 页面回归通过，源码保护未执行载荷且原文未变；示例文档的实际 PostgreSQL revision、字符数和哈希读回见 `review-persistence.json`，可见页面截图见 `screenshots/review-populated.png`。本轮运行时为 Windows Node 24.16.0、React 19.2.5 和容器 PostgreSQL 16.14；不把此前 S0-R 的 Linux Node 22 结果冒充本轮新增模块的跨平台实测。

## 人工未验及限制

真实 Windows 中文输入法尚未由人操作，组合事件自动化不能替代此项。请使用微软拼音在源码和富文本中检查：候选选择/翻页/取消、中文标点和连续输入；列表/表格/Wiki 周围编辑和撤销；组合中保存/切换/导出；刷新恢复与再次提交。分别检查深浅主题及长文，并核对实际 Markdown 和版本。

长文自动化仅覆盖单机测试，不证明低配机、全部浏览器、物理手机、长时间会话和大空间吞吐。浏览器存储损坏、被清除或配额耗尽不能保证离线恢复；页面会显示草稿保护失败，不能把此状态当作已保存。

本轮没有新建生产环境、执行生产迁移或外部模型实测。附件路径不等于附件已上传；个人空间暂不对项目共享。完整 Obsidian、知识节点、全局图谱、AI 关系、Agent/知识 MCP、向量库和协同编辑均未实现。

## P2 接口建议与停止条件

后续画布引用应保存 knowledgeDocumentId、spaceId、引用时 revision 和来源信息，使用 KnowledgeService 授权读取/搜索/版本接口；写入画布继续走已统一的画布 CAS 事务。知识语义关系不得映射为生成执行边；跨空间检索必须重新授权，保留的 grants 表不能直接激活。

本轮完成后仅供本地体验，等待用户确认。真实输入法和用户体验结论应归档；P2 仍需单独批准，S0 未正式发布前 P1 不进入生产。
