# AutoCut 稳定性修复与质量验证交付

已修复首次规划字幕坐标错误，并由一次新的真实模型原始结果完成实际剪辑；可选常驻 CPU ASR 已完成本机冷/热、排队、取消与恢复测试。**四类真人/实拍质量验收和 Linux 镜像实跑尚未完成，不能宣称全阶段验收或可上线。**

本轮不提交、不推送、不部署，没有修改生产数据库或配置。保留现有 Agent Runtime、PostgreSQL、BullMQ、资产、人民币计费与 Timeline 架构；用户正式剪辑仍由平台服务执行，不依赖 Codex。

## 1. 已修复问题与代码

- [planner.ts:46](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/autocut/planner.ts:46)：首次规划仅允许 `clips`，每项严格限定 `asset_index/source_in/source_out`，数组顺序就是成片顺序。模型字幕、音轨、特效、ID、成片坐标及其他字段均拒绝，不做静默清洗。
- [planner.ts:186](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/autocut/planner.ts:186)：首次字幕在编译器内按 ASR 源区间求交并平移到成片，再统一校验。原先 executor 校验后才补字幕的顺序已移除；已有版本的人工字幕及后续修改语义保留。
- [executor.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/autocut/executor.ts:129)、[service.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/autocut/service.ts:383)：新任务使用规划协议 v3；旧未规划任务在下载/分析/付费之前停止，不静默切换协议重新收费。已有输出版本的纯渲染/恢复仍复用原版本。
- 首次“只修改字幕但没有已有时间线”的请求在模型调用前拒绝。实际选段短于目标时由程序添加明确提示，不重复素材凑时长；账单幂等、用户权限、版本冲突、源哈希和非法时间线保护继续保留。

首次模型结果的处理是**严格拒绝额外字段**，不是把审计中错误的字幕手工删掉后假装通过。新真实模型请求完整原文和旧失败原文均保存为回归 fixture。

## 2. 自动化与真实结果

- [autocut-stability.test.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/tests/autocut-stability.test.ts:14)：6 项新增测试，覆盖首次契约、半开区间、源/成片坐标、重排、跨片段字幕、空转写、多素材版本，以及常驻进程排队/取消/崩溃恢复。进程协议测试使用明确标记的替身，只验证生命周期，不作为真实 ASR 质量证明。
- [真实模型 fixture](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/tests/fixtures/autocut-real-first-plan.json)：原始响应文本、SHA-256 与实际 job ID；未改写选段。旧真实响应带模型字幕应拒绝，新 v3 响应应通过，字幕必须由程序生成。
- [PostgreSQL 集成测试](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/tests/autocut.integration.test.ts)：验证权限、不可变版本、幂等、报价积分预占、普通文本原规则和故障恢复；新增旧规划协议不下载、不调用模型、不创建计费请求的断言。
- 本轮 102 项相关测试通过，0 失败、0 跳过；包含真实 FFmpeg、PostgreSQL、原模型适配/计费/画布契约及 Native Agent 展示回归。API typecheck/build、Web typecheck、Compose 语法和入口 shell 语法通过；详见 [tests.txt](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/worklogs/autocut-stability/tests.txt)。

队列代码未变，本轮没有重跑专用 Redis 多 Worker 测试，也未重跑完整 Native Agent Runtime/生产浏览器链；此前测试记录仍独立保留，不与本次计数相加冒充完整回归。

本轮新的真实模型验证使用既有授权自制口播/图形样片及原先实测的分析缓存，走**当前 AutoCutExecutor、现有 JobService/账单、实际 FFmpeg**，不是另写一套修正脚本剪视频。

- 工程 7315 毫秒，4 条程序映射字幕；实际 H.264/AAC MP4 为 7320 毫秒，音视频起点均为 0，音轨 7315 毫秒。5 毫秒差来自视频帧量化，不能单凭这些值证明真人感知同步。
- 对成片重新执行真实 FunASR，四句文字与原意完整保留；检查一帧的烧录字幕未出现乱码或裁切。源素材仍为 TTS/图形，不计作真人/实拍验收。
- 本轮仅新增 1 次模型调用，输入 1152、输出 166，共 1318 Token；供应商账单记录换算成本 **¥0.00055114**，25 分保守预留，未超过本阶段授权的 ¥1/最多 4 次。未把未用预算当作费用，也未与审计阶段费用混算。
- 当前缓存分析路径尝试约 33.694 秒，其中规划 7.073 秒、渲染 25.155 秒；该次与 ASR 基准同机运行，且没有重跑冷 ASR/视觉分析，**不是首次冷全流程基准或独立渲染性能结论**。

证据：[实际模型及任务报告](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/worklogs/autocut-stability/model-run.json)、[原始响应](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/worklogs/autocut-stability/model-original-plan.json)、[新成片](H:/CodexStorage/autocut/stability/first-cut-output.mp4)、[成片再转写](H:/CodexStorage/autocut/stability/output-transcript.json)、[客观质量指标](H:/CodexStorage/autocut/stability/quality-sample-metrics.json)。

## 3. 常驻 ASR：实现与真实测量

[resident-asr.ts](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/src/autocut/resident-asr.ts:22) 提供单模型进程、串行请求队列；[autocut-asr.py](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/scripts/autocut-asr.py) 新增 daemon 模式。默认仍为 `AUTOCUT_ASR_MODE=oneshot`，设置 `resident` 才启用；没有默认增加资源占用。

进程协议的输入/输出显式使用 UTF-8；另以包含中文和空格的真实 WAV 文件路径执行 CPU 识别通过，未仅用 ASCII 路径推断 Windows 兼容性。[路径验证记录](H:/CodexStorage/autocut/stability/unicode-asr-check.json)

使用既有 CPU FunASR、本地 3 组权重，对 13.366576 秒中文自制 WAV 实测。这里的“冷”指新进程首次加载模型，未清除操作系统文件缓存；热测量也不是统计 P95。

- 单次进程：44.353 秒；常驻首次：43.294 秒，其中 Python 内模型加载 41.370 秒、识别 1.772 秒。常驻热请求：1.309 秒，识别 1.308 秒。
- 两个同时提交的任务按 `[0,1]` 串行完成，共 3.464 秒；复用同一进程，仅加载一次模型，未以并行模型占用换取速度。
- 真实硬杀空闲模型后，当前进程不自动重试；下一请求重新加载并成功，约 44.408 秒。真实活动请求取消后，整个受管 Python 进程树约 497.7 毫秒退出；下一请求约 41.797 秒重新加载成功。
- 实得 643 条进程树采样：空闲常驻树 RSS 最大约 **4.05 GB**，启动/运行全程最大观测 RSS 约 **5.56 GB**，最大观测私有字节约 **6.07 GB**。采样累计 CPU 约 189.05 秒，最大区间 CPU 约为单核心的 239.6%；不是完整 CPU 账单或可靠硬峰值。
- ASR 证据目录当时约 4.06 MB，包含 120 秒重复音频取消样本；模型约 2.19 GB 复用原目录。磁盘数值不是整个产品临时盘峰值。重复音频仅测取消，不用于质量验收。

首轮资源采样因旧环境缺 psutil 没有数据，只保留为不完整记录。已在 H 盘独立监控 venv 安装 psutil 后重跑；没有改动旧 ASR 环境。最终数据见 [asr-benchmark.json](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/worklogs/autocut-stability/asr-benchmark.json)、[资源摘要](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/worklogs/autocut-stability/asr-resource-summary.json)、[原采样](H:/CodexStorage/autocut/stability/asr/samples.jsonl)。

**结论：常驻模式在本地热请求上明显减少重复加载，值得保留为可选方案；不立即默认启用。** 代价是长期占内存，取消会丢掉热模型；计算线程参数不等于所有依赖合计的 CPU 硬上限，Linux 还需容器配额实测。多个 Worker 实例即使 BullMQ 全局并发为 1，也可能各自保留模型，部署前必须核定实例数和内存。

## 4. 真实素材质量与开源增强

用户要求先检查既有测试目录。现有合适来源只有已明确自制的 TTS/图形样片，**真人口播、长访谈、实拍旅行/探店、多素材商品宣传四类均缺少已确认授权的输入**，不能给出真实质量分数或将本阶段标成完成。

逐类缺项、评估口径和现有样片数据见 [quality-report.md](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/worklogs/autocut-stability/quality-report.md)。没有遍历其他客户目录、外传无授权素材或用合成画面冒充实拍。

本阶段未引入 AutoClip、FireRed 等新的剪辑组件。已知字幕坐标问题可由当前契约/程序映射修复；没有实拍对照证明词/句边界、分窗去重、视觉分组或动态抽帧的客观收益，按用户要求暂不引入。

## 5. Linux CPU Worker 部署准备

已提供 [Dockerfile.autocut-cpu](H:/CodexStorage/infinite-canvas-auth-upgrade/Dockerfile.autocut-cpu)、Linux x86_64/CPython 3.11 的 CPU 依赖输入及带 SHA-256 的完整锁定清单、独立锁定的构建工具链、31 个模型文件的可移植校验清单、启动校验入口和只读挂载配置。Torch/Torchaudio 均锁定 `2.11.0+cpu`，没有 CUDA/NVIDIA 依赖。

模型 13/8/10 个文件的清单生成与逐文件校验均通过；没有将权重或凭据加入仓库。Compose 仅做占位变量语法解析，未启动任何容器；测试占位内存值不是部署建议或已批准资源值。

**Linux 镜像实际构建与推理未运行。** 本机 Docker 数据盘实为 `C:/Users/biaoc/AppData/Local/Docker/wsl/disk/docker_data.vhdx`；按 H 盘存储约束，没有向其下载大镜像，也未擅自迁移 Docker 数据。还需在获准的 Linux 构建环境验证依赖安装、模型只读加载、进程取消和实际资源占用。

步骤与阻塞项见 [linux-worker.md](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/worklogs/autocut-stability/linux-worker.md)。本阶段没有生产迁移。

## 6. 未完成与上线风险

- 四类实拍素材与人工参考标注缺失，不能判断真实用户语义选镜、精彩度和同步质量；长素材/噪声/口音/异常媒体/磁盘耗尽仍未验收。
- 当前字幕依据句区间映射；用户裁到句中时，程序只能按区间求交，可能在多个片段显示同一句文本。边界单测通过不代表词级文字已对齐，也不能据此承诺所有句子不会截断。
- Linux CPU 镜像、源码分发依赖的实际构建、模型加载与容器 CPU/内存配额尚待实跑；镜像底座 digest、Debian snapshot、实例数和配额需在启用前核定。
- 未做本轮完整生产浏览器、Native Agent Runtime、Redis 多 Worker、同机 API 压测；旧未规划任务协议变更需通过明确新建任务处理，不自动重发收费请求。

下一步先补齐有使用权且明确允许模型分析的四类样片，再按质量报告完成对照；在 Linux 实跑和资源核定之前保持生产开关关闭。
