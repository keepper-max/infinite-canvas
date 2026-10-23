# S0 安全整改交付

> 后续 S0-3 已获准并完成本地源码实施/隔离验证，见 [S0-3 交付](s03-mcp-write-consistency.md)。本文件保留上一轮的范围与结果；其中“尚未实施”的状态以新报告为准，生产仍未发布。

## 结论与边界

S0-1 与 S0-2 已完成源码修复和隔离验证，**尚未发布，因此不能认定线上风险已消除**。S0-3 完成统一事务/幂等设计与实验验证，正式工具的参数和写入语义未改，等待专项批准；P1 暂不具备启动条件。

本轮未提交、推送、建分支或部署，未修改生产数据库、迁移文件、MCP 发布 bundle、SSH 启动脚本、账号系统或生成业务。生产只读核对发布文件和运行文件 SHA256，没有查询生产数据库。详细过程与原始证据位于 [S0 实验目录](H:/CodexStorage/shoushou-security-s0/README.md)。

## 1. 已修复问题与代码位置

- **Markdown XSS 与危险协议**：[render-markdown.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/plugins/canvas/markdown/src/render-markdown.ts) 使用随包锁定的 DOMPurify 3.4.17 与 marked 14.1.4。标签/属性白名单移除脚本、事件、内联样式、嵌入容器、SVG/MathML 和 DOM clobbering 属性；浏览器 URL 解析后限制协议。正常 HTTP(S) 图片、相对附件、邮件/电话链接、Blob 图片和栅格 data 图片保留；主动 HTML、非标准协议及 SVG data URL 被阻止。实现依据 [DOMPurify 官方文档](https://github.com/cure53/DOMPurify)。
- **源文、缓存和失败处理**：[MarkdownPreview](H:/CodexStorage/infinite-canvas-auth-upgrade/plugins/canvas/markdown/src/index.tsx) 只消费净化结果，不调用 metadata 写回；缓存键包含策略版本，只缓存成功净化输出，内容不变不重建 DOM。解析/净化/DOM 写入失败清除旧内容并用 textContent 显示错误，不回退原始 HTML。移除运行时 CDN 依赖；插件版本为 1.1.1，独立与集中构建依赖均锁定。
- **MCP 源码和权限**：原始源码是 [shoushou-mcp-server.ts](H:/代码相关/项目/漫剧工作流/scripts/shoushou-mcp-server.ts)，并非正式仓库的 canvas-agent。新增 [shoushou-mcp-access.ts](H:/代码相关/项目/漫剧工作流/scripts/shoushou-mcp-access.ts)，直接复用正式 [assertProjectAccess / resolveActiveUser](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/project-access.ts)，不再保留私有写角色规则。删除项目、未知角色写入、成员撤销/降权均按正式逻辑拒绝；ensure/list 补齐存活项目筛选和权限校验。
- **身份和后台任务**：取消活跃账号身份缓存，每次重新解析 Operator；同时配置 ID 与账号时必须匹配同一活跃用户。Operator 不具有平台管理员项目绕过，也不采用调用参数中的 userId 或浏览器身份作为兜底；allowlist 仅缩小成员范围。文字后台任务在执行前、保存成功结果前重新检查身份/项目，已发出的供应商请求无法因此追回或保证取消。

权限改变在下一次调用重新判断；已经授权并进入旧直库事务的操作仍存在在途撤权窗口，严格事务内授权收敛属于 S0-3。操作系统修改启动环境不会改变存活进程的环境，修改 allowlist 配置后须重启 MCP；测试中对 env 对象的修改只验证代码每次重新读取配置，不能当作已实现配置热更新。

### MCP 版本溯源

本机 [remote 启动器](H:/代码相关/项目/漫剧工作流/scripts/shoushou-mcp-remote.mjs) 经既有 shoumiren-production SSH 配置读取远端 `/home/adminsun/.local/share/shoushou-mcp/shoushou-mcp-server.cjs`，复制到应用 API 容器临时路径执行。该启动器本轮未修改或重启。

原始源码按原 mcp:bundle 参数隔离重建后，与本机发布包、远端发布文件和当时运行的容器临时包 SHA256 均为 `fc283b4e64e3c43e39cce40912a441450a201b655a8d6813a65926b24de2af87`。由此确认原始工程和实际运行版本对应，不存在源码溯源阻塞；原始发布包保持原样，修复候选仅构建到 S0/artifacts。

## 2. 未修复、待批准与新增证据

**正式 MCP 的 CAS 与幂等尚未修复**。隔离环境通过真实 stdio 调用确认：相同 create_vibe_storyboard 输入重试创建两套节点，canvas revision 不变，快照版本却增加。随后网页保存通过 revision 条件，但在当前完整快照唯一约束下发生 23505 版本碰撞，整个网页事务回滚。

这次实际复现的是“重复创建＋快照/revision 分离＋网页保存失败”，**没有把快照删除后人为制造的覆盖称为当前实测结果**。若快照历史缺失等其他条件存在，旧全量覆盖风险仍需针对该状态验证；没有查询线上数据来推断其是否满足这些条件。

以下保留为明确未完成项：旧写工具统一事务上线、旧快照形状与版本修复、幂等回执持久化迁移、浏览器 Agent applied/persisted 回执改造、可撤销的普通用户 MCP scope 凭据及未来知识 ACL。后两者没有既有知识 API 可在本轮修复，不提前实现 P1。多标签页浏览器 Agent 与真实供应商/S3/Redis 端到端未验证。私有 stdio 的所有调用仍归属配置的 Operator，只适用于受控操作方；若作为多用户网络服务开放，不能用这个固定身份代表各个普通用户，必须先实现独立 scope/委托认证。

## 3. 自动化验证与运行结果

- [Markdown 浏览器测试](H:/CodexStorage/infinite-canvas-auth-upgrade/plugins/canvas/markdown/tests/security.test.mjs)：47 项断言通过，Chromium 151；覆盖旧 Markdown、表格/代码/任务列表/附件、9 类攻击、解析/净化异常、缓存 DOM 不替换、真实插件预览/编辑与源文不变。
- [S0 PostgreSQL 集成测试](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/tests/security-s0.integration.test.ts) 及既有 postgres.integration：11 项测试通过（含父测试计数）。真实平台 Cookie/会话失效、多用户/角色/项目删除、真实 MCP stdio 调用、并发 CAS 和下述事务原型均经过执行。
- 现有 canvas-contract、job-service、provider、volcengine-ark-provider 共 44 项通过，涵盖图片/视频请求结构、素材引用、下载恢复及去重；既有 PostgreSQL 集成回归同时覆盖素材上传/下载授权和画布快照。使用模拟服务，不调用真实付费模型，不宣称真实生成全链路已验收。
- Markdown 与 API 类型检查通过；MCP 定向类型检查通过，结果见实验日志；registry 干净副本只安装集中依赖后构建全部 5 个官方插件通过，未写正式 public/dist 或发布分支。实验容器只绑定 `127.0.0.1:55440`，数据库名 `s0_isolated`，测试拒绝其他目标；既有迁移仅应用于该隔离空库。

原始结果、首轮失败与修正均留存在 [artifacts](H:/CodexStorage/shoushou-security-s0/artifacts)。真实 Windows 输入法、Safari/Firefox 和生产部署未检查，本轮没有把 P0 的结果当作 S0 线上证据。

## 4. S0-3 兼容设计与回滚边界（待批准）

推荐增加显式版本化的写工具 `create_vibe_storyboard_v2`，要求 `expectedCanvasRevision` 与 `operationId`；扩展同样受影响的导入写工具。旧工具当前“每次创建独立版本”的行为保持不变，正式启用统一写入口与停用旧写入口必须作为一次专项切换批准，避免双入口期间继续存在绕过。没有静默给旧调用补 operationId 或自动重放旧全量草稿。

统一业务事务的建议顺序：

1. 由可信认证上下文或受限 Operator 解析活跃 actor；按统一顺序锁 actor、canvas、project/member，沿用正式授权。canvas 行锁先于 project 更新，避免与现有 CAS 保存的锁顺序相反。
2. 在授权后查询按 `(actorId, projectId, operationId)` 唯一约束的回执；相同 payload hash 返回原回执，不重建随机节点，权限撤销后连重放结果也拒绝。相同键但不同请求返回显式冲突。
3. 在同一事务视图读取并保留节点、边、viewport、settings，使用正式 CanvasWrite 契约转换 Vibe 旧形状，再进入现有保存事务；检查 expectedRevision，统一 revision+1，节点/边、素材引用、快照、业务审计和回执一起提交。冲突返回 409/currentRevision；草稿保留，由用户重读后决定重放，不自动覆盖。
4. 回执含 operationId、canvasId、revision、稳定创建节点 ID。保留期、payload canonicalization、审计字段、授权锁与删除/停用路径的全局锁序须在实施前确定；不在本轮擅加过期、重试或容量阈值。原子提交证明不替代这些生产实现。

实验直接在外层 Drizzle 事务中，以正式 repository 的 savepoint 调用复用真实 CAS/节点/边/素材引用/快照保存代码，并将**仅测试库**的 s0_canvas_operations 回执同事务提交。并发相同键只创建一次、模拟回执丢失重试返回原结果、不同键同 baseRevision 只有一个成功、旧网页 409、保存后故障使节点/边/revision/快照/回执全部回滚，均已通过。原型通过已有锁保护后从另一连接复用正式 guard；生产实现须用同一事务 executor，不能直接把实验包装器注册为工具。

兼容与回滚要求：先备份/盘点旧节点形状、快照最大版本与 canvas revision；在影子/测试环境演练修复，再申请增量迁移及正式切换。回滚切回上一份已验证服务产物并保留新增回执表/历史；**不得降低 revision、清理回执或删除快照，也不得把仍可绕过 CAS 的旧直库工具当作安全回退**。若新写路径失效，暂停写入并保持读取。该方案只形成设计，本轮未新增正式迁移或修改旧工具 schema。

## 5. 当前改动的兼容与回滚

- Markdown 节点 ID、metadata.content、编辑入口与资源原文不变；允许的常见 Markdown 保留。主动 HTML、style、任意表单、非标准 URL 协议等展示会收紧，这是安全修复的预期影响。源文仍可编辑/导出，净化不做持久化替换。外图仍可联网加载，本轮不承诺防跟踪或附件权限改造。
- 私有 MCP 的 10 个工具名、输入 schema、成功返回字段和独立创建语义未改变。之前错误放行的删除项目、停用用户与未知写角色现在失败；同时设置不匹配的 ID/账号也失败。错误沿用 SDK tool error，不新增匿名或管理员兜底。
- MCP TypeScript 别名指向用户指定的 H 盘正式后端源文件；构建时嵌入共享权限代码，产物运行时不依赖 H 盘。移动原始工程或正式仓库后须更新该别名；任何共享 guard 更新后须重建 MCP，未实现运行中远程动态加载。
- 本轮所有已修改原文件均在实验 backup 中保留。需要撤销本地候选时按文件清单对照备份恢复或应用反向 patch，不执行 reset --hard，也不覆盖原有用户改动。恢复旧净化器/权限代码会重新引入风险，故不是推荐的线上安全回滚；出现问题优先暂停受影响预览或私有写入能力。线上尚未发布，本轮无线上回滚动作。

## 6. 业务影响与 P1 门槛

本轮实际影响只在工作区候选源码与独立实验环境；生产仍运行旧包，图片/视频生成实现、账号会话机制、画布业务保存和浏览器 Agent 均未改。远程已安装插件使用本地缓存源码，后续发布新 bundle **不会自动修复所有旧安装**，须另行批准发布和插件更新验收；本轮没有替用户清缓存或强制升级。

**P1 保持暂停。**下一步先确认 S0-3 的版本化工具、旧写入口停用与增量回执/旧快照修复设计，再实施和验证；之后另行批准 S0 发布、MCP 重启及插件更新。当前源码整改通过不等于线上整改完成。
