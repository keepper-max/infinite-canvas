# AutoCut V1.0 正式环境公开测试部署报告

AutoCut 已在 [守守画布 AI 智能剪辑](https://shoumiren.online/autocut) 上线，所有正常账号及后续正常注册账号默认可用，无邀请名单或额外套餐授权。管理员及指定普通账号均已完成真实生产任务、MP4 下载和工程保存；普通账号 HTTPS 页面、画布回填及隔离检查通过。快照时间：2026-10-27T03:51:12+08:00。

## 1. 实际版本与运行状态

- 模块版本：AutoCut V1.0 公开测试；平台根 VERSION 保持 v0.16.51，未冒充新增平台 Git 版本。
- Git 源基线：`eaf2c8a8aef66a2189f49246c32533a84f897a9e`。AutoCut 是经筛选的未提交源码快照，**不存在包含全部上线修改的新 Git Commit**；本轮没有 commit、tag、push 或建分支。
- 部署源码清单 SHA-256：`7a4f244e2139674917f9b44f5c57e5e263e48479ef83089c4ae2089f5e0a63b2`。最终封存镜像仅增加版本标签，封存前后 RootFS 层完全一致。
- API / 普通模型 Worker：`sha256:92c761db2890527c41fdfc5445885d72d6a3834472657c7ec3822981106609b1`；Web：`sha256:1bc99470e7dd3f819c1a50e198f085cbb5d71439520c7f4e70d1e3c995c89178`；AutoCut CPU Worker：`sha256:06b926a76ae8708f94caf4fb6901d214e5818dfd65ed11b9fa70042f72c2db75`。
- 实际制品目录：`/opt/infinite-canvas-releases/autocut-v1-stage`。名称保留 stage，但其封存制品已经正式运行。生产没有可供 `git status` 的源码工作树，以镜像、源码清单及运行记录为准。
- `current` 仍是历史壳目录链接，未改动以免影响旧运维路径；已备份并更新其 `compose-enabled.json`，写入 `runtime-release-autocut.json` 指向本次真实制品。独立 Agent Worker 保持原镜像，未改 Agent 算法或策略。

详细证据：[最终生产审计](H:/CodexStorage/autocut/production/evidence/final-audit.json)、[源码文件清单](H:/CodexStorage/autocut/production/evidence/source-manifest-sealed.json)。

## 2. Linux 构建、识别与成片

- `Dockerfile.autocut-cpu` 已在真实生产 Linux x86_64 Docker 构建成功，按锁定哈希安装 FunASR 1.3.22、Torch/Torchaudio 2.11.0+cpu；导入断言无 CUDA。31 个现有权重文件逐一匹配原 SHA-256，运行时只读挂载、关闭自动更新和远程代码信任。
- 构建首次因底座缺少 CA 证书失败；从签名 APT 源安装证书后，继续固定 Debian 快照。另支持本地不可变镜像 ID，未关闭 HTTPS 校验。验收容器曾遇到只读父目录内追加子挂载失败，改为独立 manifest 挂载后通过；这些失败未伪装为成功。
- 受限容器内真实 CPU ASR：78.469 秒；测得四句中文及真实时间戳。网络为 none，2 CPU、10 GiB 内存，无 GPU。cgroup 实测峰值 6.25 GiB；这是单次测量，不能作为所有素材峰值或 P95。
- 独立 FFmpeg 中文字幕 H.264/AAC 烟测 3.967 秒。正式任务输出均为 1280×720：管理员 9.960000 秒，普通账号 7.320000 秒；音视频起点均 0，普通账号音轨 7.315 秒、画面 7.320 秒。
- 两账号浏览器实际播放 MP4、打开效果反馈框、画布节点收到实际输出并保存，原有 Agent 面板打开；最终成功检查的页面脚本错误为 0。独立验收 API/Web 已停止，3 个短期会话均已精确撤销，HTTP 复核均为 401，其他会话未动。

[Linux 原始结果](H:/CodexStorage/autocut/production/evidence/linux-smoke.json) · [MP4 检查](H:/CodexStorage/autocut/production/evidence/mp4-verification.json) · [普通账号浏览器记录](H:/CodexStorage/autocut/production/public-browser-normal.json) · [自制样片成片](H:/CodexStorage/autocut/production/normal-output.mp4)。

## 3. 管理员、普通账号及真实失败

- 管理员任务 `d9137c77-8613-4304-a996-bf1c5293af2d`：真实上传、生产对象存储、Linux ASR、关键帧多模态分析、LLM v3、Timeline、MP4 下载和保存通过。
- 管理员首次尝试暴露结算衔接 bug：`billing_pending + settled` 收尾瞬态被误判失败。只修复 AutoCut 等待状态，继续要求 `completed + released` 后才读结果；付款不足及待核查仍拒绝。手动恢复原任务复用原 2 个付费 job，没有编辑模型 JSON，没有新增收费调用。
- 活动渲染任务 `cd7c1bac-dd7a-43ba-b801-a5b1edaf8bf1` 已真实取消并手动恢复渲染，无新增付费模型调用。重复相同 operationId 返回同一任务。
- 普通账号首任务 `c80391e0-7ea7-4ba2-9a0a-99c5208e304e`：实际识别完成，但模型把视频候选返回为 `start=0,end=0`，被严格校验拒绝。任务、原始响应和已发生费用全部保留，不把它算成功。
- 明确新建的普通账号任务 `8db3c2b2-f64b-4677-b8a0-dc58ecb0286b`：复用前次实测 ASR 缓存，重新请求素材理解和剪辑规划，未手改模型输出，真实成片/下载/保存通过。该次约 73.858 秒，其中分析 35.950、规划 30.243、渲染 7.526 秒；包含结算等待，**不是冷全流程基准**。管理员恢复耗时也包含人工修复等待，不能当性能指标。

普通账号通过实时 `/api/auth/me` 确认 `isAdmin=false`；未登录访问 401，跨账号 AutoCut 工程及资产下载 404，跨账号画布 403。没有调整账号身份、会员、价格、充值或发放积分。没有为其他账号自动创建任务。

[隔离检查](H:/CodexStorage/autocut/production/evidence/account-isolation.json) · [管理员记录](H:/CodexStorage/autocut/production/evidence/admin-acceptance.json) · [普通账号记录](H:/CodexStorage/autocut/production/evidence/normal-acceptance.json) · [首轮失败原文](H:/CodexStorage/autocut/production/evidence/normal-first-model-response.json)。

上线必要改动局限于 [准入及重试保护](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/autocut/service.ts)、[停收状态](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/autocut/routes.ts)、[结算收尾等待](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/autocut/model.ts)、预算/处理授权文案及反馈入口，没有修改选镜算法。新增 [结算回归](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/tests/autocut-public.test.ts) 并扩展 PostgreSQL 并发准入测试，本轮最窄相关套件 9 项全部通过、无跳过，API typecheck 通过；Linux API/Web/Worker 已真实构建。此前稳定性阶段的 102 项是独立历史记录，没有并入本轮计数冒充全部重跑。

## 4. 资源、预算与后台记录

- 现行保护：全局并发 1，FFmpeg 2 线程，单文件 500 MiB / 30 分钟，每工程最多 20 项，单任务 30 分钟，720p。新增已确认边界：每用户最多 2 个活动/排队任务，全局最多 20 个，单任务预算最高 ¥10；开始及重试均在 PostgreSQL 事务锁下检查，幂等重放不会因已满额被误收费。
- Worker 实际 Docker 硬限 2 CPU / 10 GiB，memory+swap 同为 10 GiB，非 privileged。生产保持 oneshot，未启用 resident 优化。独立 20 GiB ext4 文件盘限制临时数据，首次建立只格式化新文件；fstab 原件已备份。权重只读，模型 API Key 不注入 AutoCut Worker；真正模型请求仍走现有受管模型 Worker。
- 快照主机 24 线程，load average 约 0.34，可用内存 57.63 GiB，根盘可用 75.71 GiB。AutoCut 当前生命周期峰值 6.19 GiB；收尾队列 active/waiting/delayed/failed 均为 0。任务临时目录检查为 0，文件系统元数据/缓存不计作未清任务。
- 本轮共 5 个独立付费模型 job，全部结算并释放：供应商账本成本合计 **¥0.00278113**；按既有平台规则实际扣 **5 积分，即 ¥0.05**。两者含失败分析费用，不能混作固定售价；没有自动免费额度或补余额。
- 用户确认框显示预算及关键帧/转写外部模型处理提示；失败、取消保留实际费用状态。后台既有任务/资产分析/模型调用/usage 表记录 Task、归属、模式和要求、素材信息、ASR/规划/渲染、状态、供应商与费用；失败任务可通过起止时间及对应分析记录追踪，未为测试额外收集其他用户素材。

## 5. 反馈、监控与回滚

- 入口显示「AI 智能剪辑 · 测试版」。工作台「效果评价 / 问题反馈」提供非常满意、基本满意、需要调整、无法使用及文字说明，复用平台原反馈系统；不附原始素材，不自动代用户打分，不自动改算法。
- `AUTOCUT_ENABLED` 是独立功能开关；`platform_settings` 的 `autocut_admission.accepting` 是独立新任务开关，关闭后开始和重试被拒绝，已有记录、保存、取消和账本保留。
- `shoushou-autocut-monitor.service` 已启用并运行，每轮检查实际 Redis 队列、全局并发、API ready、Worker 状态/重启/OOM、容器 CPU/内存和独立盘。内存达到 80% 或盘剩余不足 20% 写 journal 警告；API 不健康、Worker 停机/OOM/异常重启或盘耗尽会关闭停收开关，**不会自动重开**。告警目前在主机 journal，无新增短信或第三方付费通知。账费、越权和大量模型失败仍需运营结合后台记录核查，发现即停收；本次未擅自设定失败率熔断阈值。
- 查看：`systemctl status shoushou-autocut-monitor`、`journalctl -u shoushou-autocut-monitor`、制品目录 `monitor-latest.json`。暂停队列用 BullMQ 的 `autocut-jobs` pause；停止 Worker 用当前 Compose 的 `stop autocut-worker`。
- 备份：`/opt/infinite-canvas-backups/autocut-v1-20261026T190741Z`；数据库 35,613,249 字节，实际隔离恢复 95 张原表、77 账号、49 个原迁移通过。生产增量增加 0055/0056，现为 51 个迁移，原 49 个哈希不变。
- [回滚脚本](H:/CodexStorage/autocut/production/rollback-autocut.sh) 已语法检查及 dry run，未实际回退健康生产。执行 `sh /opt/infinite-canvas-releases/autocut-v1-stage/rollback-autocut.sh --apply` 会先关闭停收、暂停剪辑队列、停止剪辑 Worker，再恢复旧 API/Web；现有模型/计费 Worker 保留到原回执结算完，再按脚本提示恢复其旧镜像。规范 Compose 备份及 fstab 备份均保留。
- 不执行 down migration，不恢复旧数据库覆盖线上，不删除项目、素材、任务或账单，不释放未知预留，不重发已付费模型请求。关闭功能或回滚前先停收并处理在途回执，避免仅凭功能开关打断已有费用结算。

[监控快照](H:/CodexStorage/autocut/production/evidence/monitor-latest.json) · [会话撤销](H:/CodexStorage/autocut/production/evidence/session-revocation.json) · [清理检查](H:/CodexStorage/autocut/production/evidence/scratch-cleanup.json)。

## 6. 完成状态及限制

**已部署并验证**：Linux 镜像/权重/CPU 推理、FFmpeg、真实生产 API→Redis→Worker→模型→对象存储、管理员与普通账号成片、保存下载、画布回填、费用幂等、权限隔离、取消恢复、资源硬限、监控及回滚制品。

**已部署但仍在公开测试**：真实用户剪辑质量、长素材耗时、复杂画面的精彩选镜、自然语义边界、长期负载和异常媒体。首轮普通账号模型产生零时长候选这一质量风险已实际观察到，严格拒绝会导致该次任务失败且已发生模型费不免除；新任务是用户/维护者明确操作，不能静默付费重试。

**尚未完成**：四类授权真人/实拍质量验收、最大规格/恶意媒体/长时间压力验证、真人唇音同步及长期容量统计。本轮样片为合法自制 TTS/图形，只证明真实工程链路，不能冒充实拍质量通过。普通账号 7.32 秒结果短于 10 秒目标，程序提示而不重复凑时长；不能宣称精确满足时长。

现有主站健康、独立 Agent 镜像和策略保留；未重跑其他产品的全部付费生成流程。本次没有新增云/GPU支出，没有引入第三方剪辑框架、ASR 常驻优化或 P1 功能；Codex 不参与用户正式运行链路。

交付完整性：47 个部署覆盖文件与封存源码逐字节一致，无关拼好站修改未上线；1093 个交付/源文本文件对照 11 个现有凭据值扫描，精确命中 0，私有验收会话文件不入库。报告本地链接检查通过，`git diff --check` 通过。

## 收尾在线复核

北京时间 2026-10-27 11:09 再次通过指定生产 SSH 连接实查：Web/API 健康，普通 Worker 与 AutoCut Worker 已运行约 8 小时，独立 Agent Worker 正常，监控服务 active；API ready 返回 200，新任务 accepting=true，Redis 全局并发 1、未暂停，active/waiting/delayed/failed 均为 0，未观察到 Worker OOM。本次只读复核未新增模型请求，不作为新的质量或压力验收。
