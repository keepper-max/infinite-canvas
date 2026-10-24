# R1.2 本地交付

后续状态：用户已明确批准commit、push和生产部署，最终v0.16.35已上线；实际迁移、备份、修正与公网验收见 [生产记录](../../ops/releases/v0.16.35.md)。以下保留本地开发阶段事实。

本轮完成多格式资料导入的本地功能与隔离验证。没有访问生产、执行生产迁移、重启线上服务、调用付费模型、提交或推送。源码基线为 `987b91bd818170f7132dd2f59a4231b8e016ea9f`，版本号保持 v0.16.33，改动待审阅。

## 体验入口

- 本地 Web：<http://127.0.0.1:5192/__r12/login>。仅限本机的隔离验收账号自动登录，无需正式网站密码。
- 本地 API：`http://127.0.0.1:3192`。真实 PostgreSQL、MinIO、Redis 使用专属 `shoushou-r12-*` 容器。
- 测试文件：`H:/CodexStorage/shoushou-r12/fixtures`。录屏与截图：`H:/CodexStorage/shoushou-r12/artifacts`。
- 自动登录代码仅在仓库外的 `H:/CodexStorage/shoushou-r12/dev-api.mts`，不进入正式 API，也不提供生产登录绕过。

## 已实现

- DOCX、文字型 PDF、TXT、MD、MARKDOWN 上传、格式核查、后台转换、可编辑预览、标题与文件夹选择、确认创建。Word 图片通过授权附件接口显示，表格转换为 Markdown；复杂合并表格保留并告警。
- 原件独立保存在私有对象存储，记录名称、类型、SHA256、长度、转换器版本、警告、页码、资源数据及对应文档 revision；下载每次检查用户与空间权限。
- 转换任务与文档分离，支持排队、解析、等待确认、失败重试、取消、刷新恢复；上传不创建文档，确认复用 KnowledgeService 的版本、关系索引、审计、CAS 与回执事务。
- 同空间 SHA 重复提示、显式独立副本、稳定操作 ID、上传操作查询、未知回执先查询再重试；重新解析先展示当前正文与新结果，确认使用原文档 expectedRevision，冲突不覆盖。
- 独立 Node 转换容器：非 root、只读根目录、无网络、无宿主项目/凭据挂载、受限 CPU/内存/进程与超时。转换宿主缺失或镜像不可用时拒绝新上传，保留已有文档/原件读取。

## 已验证

- 导入相关后端：17 项通过，使用真实 PostgreSQL、MinIO、Redis、专用 Worker、HTTP 和解析容器；包含长中文跨输出分块保真、撤权、幂等、CAS、回滚、过期清理及 Knowledge Node。
- Linux 旧功能：46 项通过；媒体、账户及计费回归另 41 项通过。模型执行使用本机替身，不代表真实供应商或人民币结算验收。
- 浏览器：主流程 14 组、补充 PDF/Markdown/空间竞态 3 组通过；手机布局另外核对宽度390px、面板x=0、内容clientWidth/scrollWidth均为390，修复抽屉及长文件名撑宽。自动化不替代真实 Windows 中文输入法。
- 转换器单元 3 项、既有画布/鉴权/任务单元 47 项、MCP 0.4.0 封存测试 bundle 的真实 stdio 工具发现 1 项通过；未修改或连接生产 MCP。
- Linux Node 22 的正式构建代码读取真实知识数据与 MinIO 原件、匿名访问拒绝 401；Web/API 构建与类型检查通过，Web 保留既有大包提示。
- Worker 离线拒写/保留原件读取，以及 SQL 已持久化但队列投递失败后的 Worker 重启恢复，均已实际验证。隔离恢复77张表及127个对象（19,439,420字节），表行数/行哈希和对象SHA256一致；明细以 `artifacts/backup-restore.json` 为准。

完整测试证据在 `H:/CodexStorage/shoushou-r12/artifacts`：`final-import-tests.txt`、`linux-regression-tests.txt`、`media-account-tests.txt`、`browser-results.json`、`browser-extra-results.json`、`mobile-layout.json`、`outbox-recovery.json`、`availability.json`。早期失败日志保留；环境启动/测试等待错误、表格转换、UTF-8 分块及手机宽度问题修正后才计入通过结果。

## 限制与待用户确认

- 扫描型及没有正文的 PDF 明确失败并提示需要 OCR；不执行 OCR。未可靠标记的 PDF 表格、分栏、图片不承诺还原，保留文字和原件供核对；结构标记完整的标题和简单表格已经实测。
- Word 页面布局、宏、嵌入对象及无法读取的外链图片不执行或伪造还原；警告说明，原件保留。合并/嵌套表格可能进入源码保护。
- 个人文档复制到项目沿用 P2 的内容复制语义，不自动扩大原件或个人附件的权限；需在目标项目空间导入资料，才能向该空间成员提供完整原件和附件访问。
- 待真实 Windows 输入法、物理手机及用户实际复杂 Office/PDF 文件体验；本地合成性能数据不构成生产容量保证。
- 本轮明确不含 PPT/Excel/OCR、Agent、付费模型和生产发布。等待用户体验及独立发布批准。

组件选型和质量/性能见 [quality-performance.md](quality-performance.md)，部署及向前回退见 [deployment.md](deployment.md)，扩展接口见 [interfaces.md](interfaces.md)，全部源码文件见 [files.md](files.md)。
