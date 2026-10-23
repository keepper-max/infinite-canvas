# R1-F 实际验证结果

2026-10-23，本地隔离环境；供应商全部为测试替身，实际供应商费用0。以下结果区分最终运行与保留的早期失败，不将方案当作已执行测试。

## 最终通过

- Linux Node **22.23.2** / PostgreSQL **16.14**：最终全量 API **254通过、0失败、0跳过**，约246.3秒。日志 `H:/CodexStorage/shoushou-r1f/linux-final-sealed/all-api.log`。包含真实PG知识CRUD/历史/搜索/图谱/来源、Markdown保真、账户/权限、注册登录、CAS、MCP、图片视频音频、原人民币积分及支付替身回归。
- 其中新增 R1-F 场景10组（node:test含父项11）：默认关闭/管理员审计、项目隔离、版本字符串伪造、无凭据/漏传拒写、新旧客户端并发、撤权与回执重放、5路相同重试/改参拒绝、第二次独立重试/旧无body调用、回执故障真实PG回滚、5路CNY结算唯一账本、多层重试族不明提交和旧legacy任务保护、明确删除保留原文与历史。见 linux-final-sealed/release-guards-results.json。
- S3/stdio/上传锁最终 **4通过、0失败**（含父项），约22.8秒。真实MinIO SigV4 PUT/GET/HEAD/Range、PNG/MP4/WAV字节哈希、MCP 0.4.0握手/重连/回执，以及Web/MCP争用。三次1MiB上传含1.2秒人为等待时，事务1.475–1.565秒，Web等待1.462–1.549秒；实测观察到PG锁等待，慢上传持锁风险仍在。见 linux-final-sealed/s0r-storage-results.json。
- 真实 MCP stdio2组：追加与回放只增一次revision并保留3个知识节点；同一连接撤权后立即隐藏知识引用并拒写，旧写工具保持禁用。见 artifacts/mcp-knowledge-results.json。已安装bundle未替换。
- 浏览器3组：使用实际前端源码服务模块、本地HTTP与真实IndexedDB，服务端完成重试后丢弃POST回执；刷新后查询原回执，POST总数仍为1。新版画布模块签发能力后保留3个知识节点；已构建UI可打开文档/图谱/创作画布。见 artifacts/browser-results.json，截图 knowledge-review.png / canvas-review.png。
- 编译产物真实链路2组：API/Web生产target镜像、Redis队列、正式Worker、本地HTTP模型，读取2篇真实知识正文及revision，最终completed与0金额结算；撤权后知识/任务/事件/新知识生成403。见 artifacts/compiled-runtime-final-sealed.log、runtime-http.json。所有上游均为本地替身。
- Worker实际重启及恢复：本地HTTP替身收到请求后主动断连，真实任务进入unknown/manual_review。重启Worker并重投恢复队列任务后没有新模型请求；HTTP重试409。最终编译Worker复验仍通过，见 artifacts/worker-restart-results.json 和 compiled-worker-recovery.log。
- 安全插件4组：Linux构建 Markdown **1.1.1** 包在Windows Chromium检查正常Markdown、脚本/事件、危险协议、SVG/MathML/变异；外部请求拦截。见 artifacts/published-plugin-results.json。此项验证本地包，不能证明线上持久缓存已更新。
- 迁移：从R1的0047备份恢复到新数据库，0048执行两次；**72张旧表原有列和行摘要完全一致**，没有自动授权，旧任务状态为legacy。见 artifacts/migration-rehearsal.json。
- 恢复：两个数据库备份恢复到新目标，**77/76张表**行摘要一致；7个对象、3,237,905字节恢复至新桶，hash/metadata一致，源对象删除0。见 artifacts/backup-restore.json 和 object-backup-restore.json。
- 构建：最终 API、Web 生产target、MCP候选均成功；API build包含TypeScript检查，Web独立typecheck通过。Vite既有大chunk告警保留。没有新增依赖或变更依赖锁。

## 失败过程与限制

早期新测试辅助函数把Response.ok误写为函数，已修正。管理员配置邮箱SQL的数组参数在实测中报错，已改为JSONB展开并通过；后续加入服务端管理员再次检查。早期全量末尾S3文件没有挂载，后独立补跑和最终整体运行均通过。

复用已有全量测试库时，固定渠道前缀/支付fixture相撞；新库第一次启动又缺少显式就绪等待，出现ECONNREFUSED。最终使用全新隔离PG、Redis、MinIO，显式验证就绪后254+4全部通过，没有删除或清空旧库。早期挂载父目录只读与单文件新增挂载冲突，改为实验目录只读测试快照，不改业务源码。

浏览器第一次误把完整CanvasDocument当写入CanvasDraft导致422，修正测试按真实前端写入契约后通过；另一次复用仍运行的重试fixture被正确拒绝。编译服务刚启动的验证先遇连接未就绪，随后遇本地空模型目录将替身标为不可用；均修正实验fixture/就绪检查，未修改正式模型选择或计费规则。

Agent目录没有变更；Windows直接npm test因未安装该目录tsx无法运行，日志保留，不算本轮通过。R1此前Linux Agent127项通过为历史证据。真实Windows中文输入法、物理手机、真实供应商/结算、生产配置/备份均未验收，不从隔离性能推导生产承诺。

## 评审入口

`http://127.0.0.1:5179/knowledge`，当前应用浏览器已登录独立合成账号并打开4篇文档/12条Wiki关系图谱。API `http://127.0.0.1:5305`，数据库r1f_runtime，支付关闭。会话通过正式账号/session机制，不存在生产认证绕过。停止本地环境只需停止以shoushou-r1f命名的容器；数据库卷、源码补丁及证据保留，不删除其他项目容器。
