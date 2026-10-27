# AutoCut API、迁移与启用

## 数据兼容与回滚

- `0055_autocut.sql` 新增工程、版本、分析、任务和模型调用关联表，不替换现有项目/资产/计费表。
- `0056_autocut_archive.sql` 为新工程增加软归档，并让派生分析在原始资产被明确删除时级联清理、成片引用置空；不对旧用户数据做批量删除。
- 生产启用前必须备份数据库并验证恢复。应用回退时关闭 AutoCut 开关、停止专用 Worker，再回退代码；保留新增表、工程、账单和对象。`db/rollback/0055_autocut.down.sql` 明确采用非破坏回退，禁止用 DROP 清空用户工程。
- 活动工程的 `asset_links` 使用空 `node_id`，不会被画布同步删除。归档前必须停止任务，归档只释放该工程引用，不物理删除文件。原项目软删除后，新接口和 Worker 均拒绝继续访问。

## 运行配置

API 默认不启用处理能力。启用需要 `AUTOCUT_ENABLED=true`，以及以下经过验证的配置，缺项会拒绝启动而非选用未知模型：

- `AUTOCUT_MODEL_ID`：现有目录中的视觉文本模型；开发验收使用 `catalog.text.qwen3.5-flash`，不代表其他模型自动支持图片。
- `AUTOCUT_MODEL_VISION_VERIFIED=true`、`AUTOCUT_ANALYSIS_VERSION`：实际视觉输入测试通过后填写，升级模型/提示词/分析逻辑时更换版本。
- `AUTOCUT_MODEL_QUOTE_CENTS`：每次调用的保守人民币上限（分），包括图片/输入/最大输出、平台加成与取整；`AUTOCUT_MODEL_MAX_OUTPUT_TOKENS`：已验证的最大输出。开发测试采用 25 分/次与 4000 输出 Token，这只是限定输入下的验收配置，不是任意供应商通用报价。
- `AUTOCUT_ASR_PYTHON`、`AUTOCUT_ASR_MODEL`、`AUTOCUT_ASR_VAD`、`AUTOCUT_ASR_PUNCTUATION`：已经装好 CPU FunASR 的解释器和本地模型目录。禁止用户任务中临时 pip 安装或下载权重。
- `AUTOCUT_TEMP_ROOT`：Worker 私有工作目录；Windows 默认 H 盘，Linux 建议独立磁盘/卷。为 HF/ModelScope/Torch/系统临时目录设置同一受控工作盘。

使用同一 API 制品新增 `node dist/autocut-worker.js` 独立进程，或 `npm run autocut:worker`。普通生成 Worker 继续处理模型任务，必须一并收到相同 AutoCut 模型配置，才能启用关键帧消息和输出 Token 约束。专用 Worker 不直接持有模型 API 密钥；模型密钥继续由原生成 Worker 注入。

`docker-compose.autocut.yml` 是待审查的可选覆盖文件，没有自动启用。需要准备兼容 API 制品且有 CPU FunASR 的 Worker 镜像、本地只读模型挂载，以及显式填写容器 CPU/内存限制；本轮不代选这些未确认的生产上限。默认 API 镜像只有 FFmpeg，并不自带 Python/ASR 权重，因此不能仅启动覆盖文件就宣称语音功能可用。`Dockerfile` 已将 ASR 桥接脚本纳入制品，第三方模型环境仍需独立准备。

全局只运行一个剪辑任务，每次 FFmpeg 两线程；任务 30 分钟后停止，正常临时目录立即清理，非活动崩溃目录按同一时限回收。不要通过扩容多个副本绕过 Redis 全局并发。

实测供应商将思考 Token 也计入用量：一次请求设置 `max_tokens=4000`，最终账单的 completion 为 7013。因此该参数不能被写成“总计费 Token 硬上限”。已验证 Qwen 路线可以通过 `AUTOCUT_MODEL_DISABLE_THINKING=true` 发出 `enable_thinking=false`，独立图片验证返回 49 输出 Token；其他供应商未验证该开关。生产报价必须覆盖供应商实际最大计费范围，核验完成前不要启用未知路线。AutoCut 在原积分事务中预占完整保守报价，普通文字与原生 Agent 原预占规则不变。

画布沿用既有显式保存方式。创建任务会独立保存剪辑工程；保存画布后，节点与工程的关联才能随画布恢复，不会偷偷将整张未保存画布写入服务器。

## API

统一使用原登录 Cookie、来源校验与平台错误格式。工作空间 ID 是既有普通项目；工程 ID 是新增 AutoCut 工程，不是漫剧项目。

| 方法与路径 | 用途 |
|---|---|
| `GET /api/autocut/status` | 处理开关和已确认资源边界 |
| `GET /api/autocut/timeline-schema` | 完整最终 Timeline JSON Schema |
| `GET/POST /api/autocut/workspaces/:id/projects` | 列表/创建；创建提供 `name,assetVersionIds` |
| `GET /api/autocut/projects/:id` | 资产摘要、分析、当前工程、版本、任务和用量 |
| `PUT /api/autocut/projects/:id/timeline` | `expectedRevision,timeline`，乐观锁保存新版本 |
| `POST /api/autocut/projects/:id/restore` | `expectedRevision,revisionId`，恢复为新版本 |
| `POST /api/autocut/projects/:id/archive` | 停止活动任务后软归档并释放引用保护 |
| `POST /api/autocut/projects/:id/tasks` | 创建分析剪辑/纯渲染任务 |
| `POST /api/autocut/projects/:id/tasks/:taskId/cancel` | 取消排队/运行任务 |
| `POST /api/autocut/projects/:id/tasks/:taskId/retry` | 显式续跑原任务，复用已有付费请求 |

创建任务字段：`operationId`（UUID 幂等键）、`expectedRevision`、`kind=edit|render`、`prompt`、`mode=auto|highlights|speech|travel|product|custom`、`targetDurationMs`、`aspectRatio`、`budgetCents`、`confirmed`，可选 `scope=all|subtitles`。同一工程只有一个活动任务；相同幂等键但内容不同返回冲突。`render` 不重新分析/推理，缺少既有分析时明确失败。

上传复用原 `/api/projects/:id/assets/uploads` 和完成接口，直接传对象存储；AutoCut 不增设任意 URL 抓取入口。成片复用原资产下载/媒体流接口，继承已有鉴权。

## 本地验证入口

- `tests/autocut.test.ts`：Schema、编译器、字幕映射、真实媒体和取消，真实媒体项由 `AUTOCUT_MEDIA_TEST=1` 启用。
- `tests/autocut.integration.test.ts`：独立 `TEST_DATABASE_URL`，增量迁移和工程权限/版本/预算。
- `tests/autocut-queue.test.ts`：专用 `TEST_AUTOCUT_REDIS_URL`，不能指向生产 Redis。
- `scripts/autocut-poc.mts`：显式 `AUTOCUT_REAL_POC=1` 才能运行；开发验收共 1 元预算，已有付费记录则只允许 `AUTOCUT_RESUME=1` 续跑，不允许从头自动付费。该脚本使用开发机既有私有连接，不是产品运行依赖或通用部署脚本。
- `scripts/autocut-ui-lab.mts` 与 `autocut-browser.mjs`：只绑定回环地址的隔离浏览器环境；真实 PostgreSQL/上传接口和 Redis 队列，故意不连接付费 Worker。不要发布或代理这些测试入口到公网。
