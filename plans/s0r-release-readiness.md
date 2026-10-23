# S0-R 安全整改发布准备交付

**本地发布兼容性预演完成，S0-1/S0-2/S0-3未相互覆盖；生产发布条件尚未全部满足。本轮未连接生产数据库、未操作线上服务或部署配置，P1未开始。**

统一CAS、幂等回执、归档与向前回滚实现沿用S03，没有重构。运行日志、当前源码快照和补丁保存在[独立S0-R目录](H:/CodexStorage/shoushou-s0r/README.md)。本轮无commit、push、分支创建或历史改写。

## 1. 完整代码基线与依赖

启动时备份正式仓库1046个未忽略源码/文档文件，并逐一核对S03交付27个文件SHA256，全部一致。相对S0前基线的31个相关差异归属：S0-1七项、S0-2一项、S0-3十八项（其中延续S0文档/测试）、原有用户/P0/并行资讯记录五项。私有MCP另外九项计入原27文件，不能把全部Git差异误当成S0改动。

原有findings/progress/task_plan、website/content.js、P0审计及其他修改保持当前内容；没有用HEAD恢复它们。Markdown安全源文件、共享project-access.ts和正式repository/S03业务源码在本轮保持不变；S0-R仅更新两处进度文档、新增五份计划/手册，并修改一个旧集成测试。

旧积分测试错误地期望补发批次还剩100：补发默认12个月到期、旧剩余批次730天到期，实际先消耗新批次、账户总额仍为100。本轮只将lot预期改为0，并增加所有批次剩余合计100的断言；credit-service.ts及计费逻辑未改。首次失败日志和复用测试库导致的固定渠道前缀/支付交易号冲突日志均保留，最终使用全新隔离库验证，不删旧库。

S0-1新增DOMPurify 3.4.17，Markdown插件1.1.0→1.1.1；Marked保持14.1.4，插件与集中registry均显式声明净化依赖，测试依赖Playwright。S03/S0-R无新增正式运行依赖；MCP按当前锁文件构建并内联正式repository/service，Agent保留原锁文件。本轮Linux Agent npm ci可正常完成，不能据此宣布此前Windows安装缺可选包的问题已解决。

完整文件、分阶段补丁、27文件证明、各包声明及锁定依赖见[FILES.md](H:/CodexStorage/shoushou-s0r/FILES.md)和其JSON清单。可审阅的补丁同时保留“相对HEAD”“相对本轮开始”两个基准，避免覆盖用户既有修改；备份受控留在H盘。

## 2. MCP v2迁移检查

详细协议与每个已知入口：[调用方迁移基线](H:/CodexStorage/infinite-canvas-auth-upgrade/plans/s0r-mcp-v2-migration.md)。本地真实stdio已验证0.4.0握手、13工具、必填revision/operationId、断连后查原回执、原ID/原payload重放和下一次写前重新读取canvas。

当前Codex可见工具元数据仍只有旧版10工具，本轮没有调用它们访问生产。远程wrapper仍使用旧容器标签且只显式转发账号；仅修改本机v2环境变量不能证明远端启用。安装的Vibe Skill走浏览器Agent，npx入口未固定已验收包版本；用户规则仍有旧import工具提示。这些都是正式切换门槛，本轮未替换运行bundle、改安装缓存、重连生产或改用户规则。

旧工具在候选中明确返回LEGACY_CANVAS_WRITE_DISABLED和替代路线，不悄悄补revision。未知提交先查原operationId状态；NOT_FOUND不排除仍在提交，只能原ID/原参数重放，不能换ID盲目重试。普通用户与私有Operator身份不能混用。

## 3. Linux、数据库和存储实测

实际环境：Linux x64、Node v22.23.2、PostgreSQL16.14、MinIO RELEASE.2025-09-07T16-13-09Z；版本来自本地运行容器。Dockerfile声明Node22，Compose声明PG16，与源码目标一致；未核实线上实际补丁版本，不能冒充生产验证。全部容器专用purpose=shoushou-s0r标签、无宿主服务端口发布，数据库/对象及临时数据在H盘隔离目录。

- **构建通过**：原Dockerfile的api-test、api生产运行镜像和web生产镜像；Linux npm ci后的五个官方插件registry及Agent tsc构建；私有MCP独立候选bundle、MCP与Markdown定向类型检查。Vite仍有已有大chunk/动静态混用警告，未更改构建限制。独立旧Next产品前端不属于守守画布发布产物，本轮不构建或部署它。
- **全量API 212项通过、0失败、0跳过**：包含S0权限、S03真实SQL事务故障/并发/旧快照、0044→0045两次迁移保持旧值、撤权停用删除、素材/图片/视频/音频与模型任务回归；使用全新专用数据库及真实Redis。供应商调用和支付响应仍是测试替身，未调用真实付费服务。
- **真实MinIO/stdio与锁实验4项通过**：SigV4签名PUT/GET、HEAD/hash、Range、有效PNG/MP4/WAV文件字节往返；真实MCP成片导入与重连后的原ID回执/重放。媒体由本地生产镜像FFmpeg生成，ffprobe确认MP4可识别，未进行商业供应商端到端验收。
- **Agent 32项通过**；Windows Chromium源插件安全测试通过（包含净化失败时文本回退与原文不变）；Linux构建的实际Markdown1.1.1发布包另经浏览器正常Markdown、脚本/事件、危险协议、SVG/MathML四类验证通过。不是只测试一个与发布包不同的净化函数。
- **正式镜像运行冒烟6项通过**：Nginx静态资源与健康、API就绪，真实HTTP Web保存和真实MCP stdio并发仅一方成功；独立read-only API返回503拒写并保留授权读取。数据库pg_dump恢复到新库后，12张核心表行数与完整行聚合hash一致；未覆盖源库或回退其revision。

逐项证据：[Linux结果](H:/CodexStorage/shoushou-s0r/linux-artifacts/results.json)、[全量API日志](H:/CodexStorage/shoushou-s0r/linux-artifacts/linux-api-all-tests.log)、[真实存储与锁测量](H:/CodexStorage/shoushou-s0r/linux-artifacts/s0r-storage-results.json)、[正式HTTP冒烟](H:/CodexStorage/shoushou-s0r/artifacts/runtime-smoke-results.json)、[发布包测试](H:/CodexStorage/shoushou-s0r/artifacts/published-plugin-results.json)、[备份恢复](H:/CodexStorage/shoushou-s0r/artifacts/backup-restore-results.json)。原失败运行不删除，最终结果与过程失败分别标记。

### 上传持锁风险

三个样本均为1MiB PUT，上传回调人为等待1.2秒，实际MinIO PUT分别约365/1230/319ms；事务总耗时约1.77/2.56/1.61秒，Web等待约1.76/2.55/1.60秒。均在pg_stat_activity观测到Lock等待，Web最后409、未覆盖导入。数字来自同机容器共享资源下的合成延迟，不能当生产吞吐或p95，也不是精确逐锁持有时间。

结论：事务一致性成立，但对象上传期间确实占有canvas及授权相关锁。慢网络/大文件可长时间阻塞网页保存和成员撤权；本轮没有设新超时、大小阈值或自动重试，也未擅改上传架构。大文件高并发发布需要单独的延迟预算与验收，不能据此宣布性能风险消除。

推荐后续审批“锁外暂存、锁内提交”：先授权预检和原回执查询，按actor/operationId/内容hash上传不可变私有暂存对象；上传完成后仍走现有repository事务，重新验证权限/revision/hash、提交素材引用与回执。撤权/冲突不产生可见资产，暂存对象保留待核查；提交不明不删除对象。需补齐暂存持久凭证、并发同ID、内容不可变/失效、失败保留和回收设计，再经批准实施，不重新设计CAS。

## 4. 发布与回滚操作手册

[上线手册](H:/CodexStorage/infinite-canvas-auth-upgrade/plans/s0r-release-runbook.md)逐步列出前置、成功标准、失败处理与回滚；[安全回滚手册](H:/CodexStorage/infinite-canvas-auth-upgrade/plans/s0r-rollback-runbook.md)覆盖代码/插件/迁移/历史内容/对象故障。

顺序为封存制品→盘点旧写者→维护冻结及备份→获批核查/0045→单独批准的必要历史修复→新版只读启动→更新插件缓存/stdio重连→受控真实冒烟→批准开放写入。未知旧写者、坏图或缺备份任一未解决即停止；不能恢复旧直库MCP来“回滚”。新表/快照/归档/回执不删，内容恢复生成更高revision。

## 5. 未解决项及发布阻塞

1. 未获生产操作授权，也未查询生产DB、日志/Redis任务、实际运行版本/容器标签、旧写者及全部外部调用方；远程wrapper切换和v2门控传播需审核后修订并演练，不能直接套用旧入口。
2. Markdown远程插件有浏览器持久化source缓存；旧1.1.0不会因API发布/网页刷新自动变安全。需落实升级覆盖与最低安全版本政策，不能把新包测试通过当成全部客户端升级完成。旧插件安全包不能成为回滚目标。
3. 本轮S3是真实本地MinIO HTTP/path-style/SigV4，不是生产存储、TLS网关/供应商配置测试。慢上传持锁已经证实；生产容量预算、大文件及撤权等待上限需另行验收或批准暂存改造。
4. 生产历史异常数量、迁移锁预算、对象备份恢复、运维网络阻断和真实供应商工作流尚未验收。repair CLI仍仅允许隔离目标apply，生产执行器及逐项目修复另审；不自动删重复节点。
5. 私有Operator尚非普通用户委托身份；Browser Agent原始输入日志隐私、未来知识ACL、真实Windows输入法和长文性能仍有独立门槛，不因S0事务通过自动视为解决。

本轮无需生产只读数据即可完成隔离验证。如后续批准只读核查，建议先审核[单项目SQL提案](H:/CodexStorage/shoushou-s0r/proposed-production-readonly.sql)：仅SELECT canvases/projects/canvas_snapshots，返回版本与存在标志、不读正文/账号；需专用SELECT角色、显式只读事务和一个批准项目ID。预期按项目索引查找，最大版本查询可能遍历该项目历史索引，开销与单项目历史数量有关；没有线上统计，不能承诺具体耗时。先获批EXPLAIN、不执行ANALYZE；正文一致性/旧图扫描另提范围，不擅自全库扫描。

## 6. P1基线与建议

[P1原生知识库基线](H:/CodexStorage/infinite-canvas-auth-upgrade/plans/p1-native-knowledge-baseline.md)确认Tiptap受控、CodeMirror保护、Markdown权威、PostgreSQL、personal/project独立、统一身份权限，以及知识关系/执行连线分离；说明KnowledgeService/节点引用/AI来源/MCP复用的边界，附真实Windows IME人工验收单及多档长文20轮p50/p95验证方案。

**建议审核本轮后单独批准P1隔离开发；生产接入必须等待S0获批发布及对应安全/兼容门槛完成。** 本轮未实现知识库功能、未迁移知识表，也没有把方案或尚未执行的人工验收标为通过。交付后停止等待审核。
