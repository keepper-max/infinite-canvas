# S0-3：MCP 写入一致性本地交付

**本地源码实施与隔离验证完成；未发布、未重启线上服务、未连接生产数据库。P1 保持暂停，等待审核。**

本轮在既有工作区增量修改，没有提交、推送、建分支或改写历史。前轮 S0 的 Markdown/权限修复及原有用户改动保留；[本轮全部文件、基线与补丁](H:/CodexStorage/shoushou-s03/FILES.md)另列，不把相对 HEAD 的全部差异算成本轮改动。

## 1. 文件与入口

- [repository.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/repository.ts)：统一锁序、CAS 保存、幂等回执、审计、一致性检查、只读核查、显式修复和向前回滚；Web 的 GET 使用只读一致性快照。
- [vibe-canvas-service.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/vibe-canvas-service.ts)、[canvas-compat.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/canvas-compat.ts)：分镜/成片业务转换与旧数据规范化，最终都进入原 saveCanvasInTransaction。
- [0045_canvas_operations.sql](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/db/migrations/0045_canvas_operations.sql)、schema.ts 和 [canvas-repair.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/scripts/canvas-repair.ts)：只新增回执/归档表及显式核查工具，不自动修复历史数据。
- [私有 MCP 原始源码](H:/代码相关/项目/漫剧工作流/scripts/shoushou-mcp-server.ts)、[版本门控](H:/代码相关/项目/漫剧工作流/scripts/shoushou-mcp-write-policy.ts)：0.4.0 候选；新增 v2/只读回执，旧 schema 保留、直库写关闭；旧 Worker 阻止 vibe-preview 任务改图。编译候选只放 S03/artifacts，未覆盖已发布 CJS。
- [CanvasSession](H:/CodexStorage/infinite-canvas-auth-upgrade/canvas-agent/src/canvas/session.ts)：浏览器工具保留原返回字段，补充 applied=true/persisted=false；网页已应用不等于数据库已提交。相关测试与四组类型检查入口见实验 README。

## 2. 统一事务实现

正式 Web 保存、迁移/恢复和 MCP v2 共用原 repository 保存函数，没有第二套节点持久化 SQL。普通写入统一按 actor → canvas → project/member 锁定；第一次初始化/显式修复额外使用与 ensureCanvasForProject 相同的初始化 advisory lock。

单次 MCP 事务依次执行：

1. 检查维护门控，重新读取活跃操作者、项目存活和成员编辑权限；锁定相关行直到事务结束，撤权/停用在已授权事务结束后生效。
2. 用 PostgreSQL JSONB 标准化业务 payload，以内置 SHA256 计算请求哈希；作用域为 `(projectId, actorId, operationId)`。哈希包含操作种类、原 expectedCanvasRevision 和业务 payload；不保存正文到普通操作审计。
3. 授权后查回执：同键同哈希返回原提交结果，同键不同哈希返回 CANVAS_OPERATION_MISMATCH；查重早于当前 revision 检查，因此成功后的旧 revision 重试仍能返回原回执。
4. 无回执时核查旧状态并检查 expectedCanvasRevision，读取同事务内的图，合并节点/边，保留 viewport/settings，经既有 CanvasWrite 契约验证，再调用 saveCanvasInTransaction。revision、节点、边、素材引用、快照、审计和回执同事务提交；任何失败回滚。
5. 只有 COMMIT 成功才返回 persisted=true、实际 canvasId/revision 与节点/连线 ID。数据库提交回执不明时返回 CANVAS_WRITE_STATUS_UNKNOWN/persisted=unknown，要求原 operationId/原 payload 重试或只读核查，不能盲目换新 ID。

不同操作同 baseRevision 只有一个成功，其他得到结构化 409/currentRevision。修复所需的历史版本跃迁也在这条保存链中，原始快照不重编号、不覆盖。

## 3. 新旧工具与调用方兼容

`create_vibe_storyboard_v2`、`import_rendered_video_v2` 都要求 projectId、operationId、expectedCanvasRevision；后者以文件 sha256/bytes/MIME/标题/分镜 ID 作为业务内容，文件路径不参与身份哈希。`get_canvas_operation_receipt` 只读查询当前操作者的已提交回执，维护模式也可使用，失权/停用后拒绝。

回执的 nodeIds/edgeIds 是该次提交的完整图 ID；新建 ID 单独位于 result.createdNodeIds/createdEdgeIds。replayed=true 返回的是**原提交 revision**，不是当前最新状态；发起下一项操作前应重读 get_project_context.canvas。原 context/jobs 字段保留，新增一致性 canvas 文档及 revision。

候选版本的切换是**显式不兼容的写行为变更**：旧 create_vibe_storyboard、import_rendered_video、queue_vibe_preview 名称和输入 schema 保留，描述明确标记关闭；调用返回 LEGACY_CANVAS_WRITE_DISABLED 和替代路线，不产生写入或文件上传。没有任何配置可重新打开旧直库路径，也没有给旧请求自动补 revision/operationId。

全部当前注册入口见 [47项工具清单](H:/CodexStorage/shoushou-s03/artifacts/mcp-entrypoints.json)：13 个私有 MCP 工具、34 个浏览器工具及 8 种 canvas_apply_ops 操作。除两个 v2 写工具外：ensure_vibe_project 通过正式 repository 初始化空项目/画布；generate_vibe_text 只写文字任务；其他私有工具只读；旧预览队列及其 Worker 写回被阻断。浏览器的创建/附件/批量操作/移动/连线/生成等通过网页状态和 Web CAS 保存，素材库添加、工作台任务不直接写画布图。

已定位的旧调用方与切换责任：

- Codex 私有 shoushou_canvas 连接、当前 stdio 会话及模型缓存工具列表：发布后必须重新建立握手，不能只替换磁盘包就认定运行实例更新。
- 原始工程 scripts/shoushou-mcp.ts、本地 mcp:shoushou、remote.mjs SSH 包装器：后者目前只显式转发账户，新开关不能仅靠修改本机环境传播；修改启动环境/包装器必须另经发布批准。本轮没改它。
- 原始工程 tests/shoushou-mcp.test.ts：已改为隔离 bundle 契约测试，验证 13 个工具，避免自动加载真实 .env。S0 集成回归已适配关闭后的旧 schema。
- 原始工程 README.md、AGENTS.md 中的旧导入提示，以及守守画布插件/Skill、人工 Agent 提示词：README 加了候选版本说明，实际安装配置、用户规则与缓存 Skill 未擅自改动；上线前由操作者确认更新，避免生产仍为旧版时提前调用不存在的 v2。
- queue_vibe_preview 的旧 Redis 任务/旧 Worker 和其他外部自动化：新源码阻止新入口及 vibe-preview 写回，已运行旧进程必须在维护窗口停止/排空。没有查询生产调用日志，无法证明未知外部客户端已全部迁移；这是发布门槛，不把静态源码清单冒充全网调用方清单。

浏览器工具的 UI 应用没有新增 operationId 端到端去重保证；超时后不能把 applied 回执当成已提交，也不能盲目重放创建节点。需要可靠持久化回执的业务应使用 v2；所有最终图保存仍受共用 CAS 保护。

## 4. 幂等、并发与故障测试

固定隔离目标为 `127.0.0.1:55441/s03_isolated`，专用 Docker PostgreSQL 16；测试拒绝其他连接。真实业务测试调用正式 repository/service、HTTP Web API 和编译后的 MCP stdio；SQL Trigger 注入失败，未用内存 Mock 代替数据库事务。

- **38 项数据库/业务集成测试通过**（Node 统计含父测试）：覆盖两个独立 MCP 客户端并发、相同/不同 operationId、Web/MCP 同时保存、JSON 键序、payload 冲突、提交后 HTTP 连接被销毁、只读回执查询、成员撤销/未知角色、停用/删除和维护门控。
- SQL 故障覆盖节点、连线、快照、审计、回执、归档插入及上传后 DB 失败；确认 revision、节点/边、素材记录/版本/引用、审计和回执不会出现半提交。
- 旧 revision=0/snapshot=7、缺 canvas 行、重复节点、过期修复计划、损坏旧图、旧快照恢复及修复向前回滚均有真实 PG 用例。0044 数据库先写入真实旧节点/快照，再运行 0045 两遍，既有数据值不变。
- **65 项媒体/任务/契约回归、32 项 Browser Agent 回归和 1 项原 MCP 契约测试通过**；图片/视频/音频节点、端口、素材版本引用、viewport/settings 在 MCP 追加后保留。四组类型检查与候选 bundle 构建通过。
- stdio 成片导入实际读取 H 盘合成文件并经 AWS SDK 上传至本机 HTTP S3 测试端点，再执行真实 DB 事务；重试不重复上传。对象存储端点和供应商响应使用替身，没有调用真实付费生成服务或验收真实生产 S3/媒体解码。

[逐项退出码](H:/CodexStorage/shoushou-s03/artifacts/validation-results.json)、[业务原始日志](H:/CodexStorage/shoushou-s03/artifacts/business-final.log)、[业务用例列表](H:/CodexStorage/shoushou-s03/artifacts/business-results.json)及其他日志保存在实验目录。Canvas Agent 现有 lock 缺少可选 esbuild 条目，npm ci 拒绝；没有修正式 lock，在实验副本补齐依赖后测试源码，副本与目标源码哈希核对。

## 5. 数据迁移与旧快照兼容

0045 只新增 canvas_operations、canvas_repair_archives，不更新旧表数据、不清空历史，也不自动去重；不新增向量库或数据库扩展。回执/归档无级联删除外键，避免账号/项目生命周期把审计回执连带清除；尚未设置自动保留期或清理任务。

普通写入遇到快照超前、当前快照缺失/不匹配、旧图形状或缺 canvas 时，返回显式错误并保留原图；不以“最新 revision”自动强盖旧数据。只读核查使用 repeatable-read/read-only 事务，生成状态 hash、异常原因与重复候选，不导出正文到普通日志。

确认后的修复需要 owner/admin、operationId、expectedCanvasRevision、expectedStateHash、reason：

- 将原始 canvas、节点、边、素材引用和全部快照存入归档；现有快照留在原表，原始节点数据亦在归档中保留。
- 将可识别的 prompt/scene/output 转为现有 text/video 节点；原类型、旧字段与正文仍保存在 metadata/原始归档。旧快照缺尺寸时使用明确的 360×240 兼容默认；无法识别的字段结构导致整个修复失败，不静默清图。
- 素材引用保留版本与角色并再次核查项目归属。既有 CanvasWrite 会排除凭据/内嵌临时媒体等不应成为云端权威数据的字段；排除路径列在修复结果，未经净化的原始记录只留在受控归档。
- 生成 `max(原 revision, 历史最大 snapshot version)+1` 的新 revision；疑似重复节点只列候选，原样保留，删除必须另获确认。
- 需要回滚内容时，用归档再次生成更高 revision；校验归档 hash，保留回滚前快照和原归档，不降低版本、不物理还原旧坏状态。旧快照本来未记录的资源/布局信息不能凭空恢复，可使用完整修复归档核查。

`npm run canvas:repair -- --database-url-env <显式环境变量名> --project-id <ID> --output <新计划文件>` 默认只生成计划，不读取默认 DATABASE_URL/.env，不覆盖已有计划文件。reason 初始为空，须审阅填写；`--apply <计划>` 会绑定操作者、目标库、revision 和 hash。本候选 CLI 对生产目标只允许只读计划，**应用/向前回滚仅允许隔离目标**；生产执行能力与每项目数据修复须另行批准，本轮未解除该保险。

## 6. 生产发布与安全回滚方案（未执行）

推荐维护窗口一次切换写入口，禁止旧直库写和 v2 双写。

1. 审核所有已知调用方及外部自动化；备份数据库/对象/运行产物，记录当前 revision、历史最大 snapshot、运行 PID/bundle hash，保留用户未保存草稿。完成 Linux/Node22、真实存储、客户端重连及回滚产物预演，不能用本机 Node24 的结果替代。
2. 暂停所有旧 MCP 写进程/客户端和预览 Worker，核对旧任务已排空或由操作者确认处理；在受控入口阻断旧程序写入。新 API 使用 CANVAS_WRITE_MODE=read-only，新 MCP 使用 SHOUSHOU_MCP_CANVAS_WRITE_PROTOCOL=read-only，读取保留。
3. 在已有数据库上单独批准并执行增量 0045，核对旧迁移校验和与数据未变；只读逐项目生成异常计划，owner/admin 确认修复/重复候选。生产 repair CLI 当前有本地保险，解除或采用受控运维执行器必须另审，不擅自批量处理。
4. 修复窗口可使用 CANVAS_WRITE_MODE=repair-only，仅允许显式授权的修复/向前回滚；普通 Web/MCP 保存拒绝。正常启用时 CANVAS_WRITE_MODE=enabled（默认），MCP 则需明确设置协议=v2，重新握手确认 server 0.4.0、13 个工具与两个必填参数，再验收真实链路。
5. 故障时先停止写入、保留读取与回执核查，保存不明提交的原 operationId。保留 0045 表、回执、归档和历史快照；修复/回滚只向前生成版本。**不能切回旧直库 MCP，也不能通过降 revision、删回执/快照或清空新表恢复服务。**若需回退不识别维护门控的旧 API，必须先从受控入口阻断画布写入；未经这项预演，不执行旧二进制回退。

CANVAS_WRITE_MODE 针对画布保存/修复，不是全平台数据库只读，也不改变登录、计费或独立资产/工作台流程；MCP 协议开关同时限制其 ensure/文字任务提交。环境变量不是热更新配置，切换要采用经批准的进程/部署流程；本轮没有改启动配置、线上环境或进程。

## 7. 未解决风险与验证边界

- 生产仍可能运行旧 bundle、旧 Worker 或未知客户端；本地源码完成不表示线上旁路已关闭。生产历史异常数量、数据规模、迁移锁时长和所有活动调用方未在本轮核查。
- S3 与 PostgreSQL 不支持同一原子提交。上传在锁内进行，网络慢会延长事务；失败可能留下未引用的内容寻址暂存对象，本轮不自动删除、不新增回收阈值或超时。COMMIT 状态不明时不得删除可能已引用的对象。
- 私有 MCP 仍是配置 Operator 的受控 stdio，不是多租户委托身份。Browser Agent 的 rawInput 日志隐私、未来知识 ACL/scope 仍需原安全清单的后续工作，不能把 v2 一致性当作这些风险已修复。
- 一致性核查对每次保存增加查询；归档保留全部快照。长历史、大文件、并发容量和真实 Linux/存储压力尚未建立生产预算。超大/不可识别旧数据、非法跨项目素材绑定应停止并人工核查，不自动裁剪或绕过检查。
- 全局写门控和锁只约束升级后的正式写者，不能阻止持有旧 DB 凭据的任意旧程序；上线前停掉旧写者是必要条件。没有做生产发布，也没有擅自改账号/数据库权限来关闭它们。

## 8. P1 启动条件

S0-3 的**本地技术前置已具备**：统一事务、v2 幂等、兼容修复和回滚均有可运行实现与真实数据库证据。生产接入仍需本报告的发布/调用方/旧数据审核及 Linux/真实存储验收；普通用户 MCP 委托和未来知识权限按独立安全边界设计。

P0 遗留的真实 Windows 输入法和长文性能门槛未在本轮复核，P1 编辑器验收仍需补齐。

本轮没有开始 P1，也不把源码测试通过当作生产发布许可。请先审核本地 S0-3 交付，再决定后续发布或 P1 本地开发授权。
