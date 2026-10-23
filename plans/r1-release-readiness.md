> R1-F 更新：三个源码阻塞已进入实际修复与隔离验收，最新状态见 [R1-F交付](r1f-delivery.md) 和 [更新检查表](r1f-release-checklist.md)。下文保留R1原始审计与风险复现记录，不能将旧的待整改描述当作当前代码状态。

# R1 发布准备交付

**结论：本地预发布制品和隔离预演已完成，当前不具备正式生产发布条件。** 未连接生产、未迁移生产、未部署或重启、未切换 MCP，也未调用任何真实付费模型。本轮不提交、不打 tag、不推送，等待审核。

## 发布基线与修改

- 仓库 `H:/CodexStorage/infinite-canvas-auth-upgrade`，HEAD `6b71618d5aa8dc887809e338197e06c1b31112dd`，VERSION 保持 v0.16.31。冻结本轮开始的 1088 个 Git 可见源码/文档文件；P2 交付的64文件哈希全部一致，S0/P1/P1.5/P2 代码完整。保留原工作区所有修改；没有把原用户的网站、管理后台或历史计划误归为本轮变更。
- 只做一项构建修正：Dockerfile 的非生产 `api-test` target 增加 `COPY server/api/scripts ./scripts`，修复真实 CLI 测试入口缺失。API/Web 生产 target 和业务、安全、计费/MCP 行为未改。本轮其他正式仓库改动是发布文档、功能验收记录和待办；独立 R1 实验脚本不进入业务源码。
- 0045、0046、0047 的顺序和 SHA256 已记录；校验和分别以 00c32daf…、81b45d8d…、5ce826fd… 开头，完整值见 R1 migration-manifest。0045 现有内容不变，0046 知识结构和0047复制来源表只做增量。API/Worker 启动会自动迁移，不能在备份与授权前启动候选生产进程。
- API、API-test、Web、5官方插件 registry、Agent、私有 MCP 候选均已构建；版本/依赖锁/镜像 ID与digest/插件和bundle SHA256 纳入独立 R1 release-manifest。当前制品只是可审阅候选，未冒充已批准正式版本。

## 实际测试结果

- Linux x64 Node v22.23.2、PostgreSQL 16.14；API 全量 **243 项通过，0失败/跳过**；包括真实知识 PostgreSQL、文档/图谱、权限、CAS、MCP v2、计费规则与人民币积分账本、图片/视频/音频及原业务。金额和供应商响应采用测试替身，不能宣布真实供应商结算通过。
- Linux Agent 构建及 **127 项测试通过**；API/Web 生产 Dockerfile target 构建通过，Vite 保留既有大 chunk 提示。Linux 构建的真实 Markdown **1.1.1 发布包**在 Windows Chromium 的正常 Markdown、脚本/事件、危险协议、SVG/MathML 四组检查通过，外部请求被拦截。
- 真实 MinIO/SigV4/S3 **4 项测试通过**（框架计数含父项），覆盖 PNG/MP4/WAV PUT/GET/HEAD/hash/Range、真实 MCP stdio0.4.0/13工具与重连查原回执、Web/MCP CAS。三次1MiB上传加1.2秒合成等待的事务约1.55–1.61秒，Web锁等待约1.54–1.60秒；仍有上传期间持锁风险，不改上传架构或生产限制。
- 发布边界 **5 项测试通过**，其中包含主动复现缺口：0044→0047 保留59张旧表完整行摘要，重复迁移不改写；未知节点原样往返可保留，但带最新revision且省略知识节点的旧客户端保存会被接受；画布只读仍允许知识CRUD；同一个失败任务重复retry产生2个新任务候选。后3项是发现风险，不是安全条件通过。最终迁移样本约1.79秒，不能推断生产锁时长。
- 实际编译 Nginx/API 的维护冒烟 **4组通过**：健康/就绪、正常密码登录及授权知识读取、网关拦截知识/画布/新任务/空间写入并保持原文、退出登录。实验配置只在 R1 容器挂载，未改正式 nginx.conf 或生产配置；API直连和私有 MCP/Worker 必须另行限制。
- 数据库备份分别恢复到全新数据库，**74/73张表**全部行摘要一致，涵盖账户、项目、画布、快照、回执、知识文档/版本/链接/来源和任务/账单；源库未覆盖。MinIO **7对象，共3,237,905字节**恢复到新桶，字节/hash/metadata一致，未删除源对象。都是合成隔离数据，不是生产备份已完成。

首轮243项中240通过、3失败（含父项），原因是 api-test 未复制 CLI 脚本；修正后使用全新测试库重跑243全部通过，没有删旧测试库。R1新测试最初遗漏模型capabilities fixture，补全后重跑；全部早期日志保留，不用最终结果抹去过程失败。

证据目录：`H:/CodexStorage/shoushou-r1/artifacts`、`linux-final`。核心文件：all-api.log、s3-and-lock.log、release-boundaries-v3.log、maintenance-smoke.json、published-plugin-results.json、backup-restore.json、object-backup-restore.json。旧P2界面验收已由用户确认，本轮没有重复宣称真实输入法、物理手机或生产性能通过。

## 发布检查表与阻塞

- [x] 完整源码冻结、P2哈希、迁移顺序与重入、Linux生产构建、真实PG/MinIO/stdio、恢复新目标及本地安全插件包验收。
- [ ] **重试幂等与真实费用**：`server/api/src/job-service.ts` 的 retry 每次生成 `retry:<jobId>:<randomUUID>`；同一失败任务回放会得到不同任务。本轮未产生供应商费用，不能声称已重复实扣，但“不重复扣费”条件未满足。需批准稳定 retryOperationId/原参数hash/回执及不明供应商提交先查状态的最小整改，再跑并发重试/账单唯一性；不擅自修改计费语义。
- [ ] **旧客户端写保护与灰度**：revision只防旧版本竞争，不防客户端读到最新图后漏传未知节点。需批准能力握手/服务端最低客户端检查或可靠旧标签页全入口拒写措施。邀请码现有功能只控制注册，知识API/生成接口没有按邀请码cohort的功能gate；隐藏入口不是灰度授权，不能把现有用户全量开放冒充邀请灰度。
- [ ] **生产拓扑与安全缓存**：当前可见私有MCP元数据仍为10个旧工具，独立候选是13工具。旧写者、实际运行bundle/remote wrapper、外部自动化和缓存传播未获生产只读授权，未核查；Markdown非local缓存仍需显式升级/覆盖，最低安全版本覆盖证据不足。旧直库写者和旧安全插件不能作为回退。
- [ ] **生产备份/存储/模型与维护窗口**：生产 PG 补丁版本、扩展权限、迁移历史、S3 TLS/CORS/路径风格、可恢复备份、真实供应商/CNY结算未验；全入口停写草案尚未获批上线。慢上传锁风险、真实Windows输入法/物理触控和长期性能仍列未通过项。

这些阻塞不能用本地测试数量抵销。推荐先审阅重试幂等、旧客户端能力与cohort gate的补丁范围，再批准最小生产只读核查；通过后再安排费用预算和正式维护窗口。

## 配置与运维准备

- 仅检查了仓库 Dockerfile/Compose/Nginx 和候选运行配置，未读取生产配置值。正式核查应逐项确认 PUBLIC_BASE_URL/TRUSTED_ORIGINS、Secure cookie、TLS/代理头、PG/Redis/S3目标及密钥引用；输出只限存在标志和脱敏origin，不输出凭据。
- Compose 当前未显式传递 CANVAS_WRITE_MODE；私有MCP门控也是独立环境。R1维护网关草案能覆盖HTTP写入口，但不覆盖内网直连、数据库权限和Worker，必须与停旧写者、队列在途核查组合。变量非热更新开关，不擅自生产重启。
- 当前 plugin-loader 的非local插件使用持久source，updatePlugin 会重新下载并启用。需要保留用户原启用状态、核对版本/hash、显式升级后复查；单独替换前端镜像不足以完成S0-1升级。
- 候选私有MCP验证v2 schema和原回执查询；切换必须新握手，不能热覆盖正在运行的bundle。已安装本地bundle未改，也未调用它接触生产。

## 备份、迁移与恢复方案

生产操作必须另外授权并先冻结所有已知写者。在同一维护点备份PG、对象与部署制品，保存恢复所需版本/权限/扩展及sha；恢复到新目标逐表与对象核对，不覆盖线上。执行0045→46→47前先核对既有迁移哈希、extension权限、锁预算与备份恢复证据；失败保持读取并停止后续操作，不DROP、不降低revision或删除快照。历史修复逐项目单独审批。

详细发布、回滚和邀请灰度标准：[R1操作手册](./r1-release-runbook.md)。真实供应商项目和预算：[真实模型验收提案](./r1-real-model-acceptance.md)，建议先申请文本最高¥10，可选媒体另行最高¥30，当前均未获批准、未执行。最小生产只读 SQL 和权限/资源范围位于独立R1目录 readonly-scope.md、proposed-production-readonly.sql。

## P2.5 开发基线

[P2.5 Runtime基线](./r1-p25-runtime-baseline.md)复用 KnowledgeService、来源快照、统一账号/权限、现有队列和CAS回执；Run/Step幂等、费用不明停机和逐次授权是前置。未实现新Agent工具、知识MCP或自主循环；等待R1审核后再决定本地开发与发布。
