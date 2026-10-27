# AutoCut Linux CPU Worker 部署准备

## 已准备

- [Dockerfile.autocut-cpu](H:/CodexStorage/infinite-canvas-auth-upgrade/Dockerfile.autocut-cpu) 继承带本轮源码的现有 API 镜像，强制提供 `@sha256:` digest 和固定 Debian snapshot；保留现有 Node Worker/BullMQ/数据库/对象存储模式。
- [CPU 输入](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/requirements-autocut-cpu.in) 与 [哈希锁文件](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/requirements-autocut-cpu.lock) 面向 Linux x86_64/CPython 3.11，锁定 FunASR 1.3.22、Torch/Torchaudio 2.11.0+cpu 等完整解析结果；无 CUDA/NVIDIA 依赖。
- [构建工具输入](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/requirements-autocut-build.in) 与 [构建锁文件](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/requirements-autocut-build.lock) 固定 pip/setuptools/wheel。jieba 等依赖仅分发源码，不能承诺“只装 wheel”；锁定其 sdist 哈希并在固定工具链下构建，禁用未锁定的 build isolation。
- [模型清单](H:/CodexStorage/infinite-canvas-auth-upgrade/docs/worklogs/autocut-stability/models.sha256.json) 对已有 ASR/VAD/标点模型的 13/8/10 个文件逐一记录大小/SHA-256；[校验程序](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/scripts/autocut-model-manifest.py) 已实际 create/verify 通过，拒绝变更、缺失、额外文件及逃出模型根目录的路径。
- [入口](H:/CodexStorage/infinite-canvas-auth-upgrade/server/api/scripts/autocut-worker-entrypoint.sh) 在启动 Worker 前验证模型；[可选 overlay](H:/CodexStorage/infinite-canvas-auth-upgrade/docker-compose.autocut.yml) 只读挂载清单与权重，要求显式 CPU/内存/镜像配置。默认 `AUTOCUT_ASR_MODE=oneshot`，常驻需显式设为 `resident`。

依赖锁是跨平台解析准备，不是 Linux 安装/推理已通过；Windows 本机基准使用 Python 3.12、既有 torch 2.13.0/torchaudio 2.11.0 环境，不能套用为 Linux 镜像性能。CPU 版本组合来自 [PyTorch 官方安装矩阵](https://pytorch.org/get-started/previous-versions/)，解析工具能力见 [uv 官方说明](https://docs.astral.sh/uv/pip/compile/)。

## 准备流程

1. 在获准且工作数据位于 H 盘或指定 Linux 磁盘的构建环境，先用正式 Dockerfile 的 `api` target 构建包含本轮源码的 API 镜像，记录其不可变 digest。不要用尚未包含 resident-asr/v3 的旧生产镜像。
2. 核定可用的 Debian bookworm snapshot，再用 `Dockerfile.autocut-cpu` 构建；其 RUN 会检查当前 API 代码存在、按锁和哈希安装，并断言 torch 不包含 CUDA。记录最终镜像 digest、Python/FFmpeg/依赖版本和构建日志。
3. 将经许可核查的本地模型目录与对应清单放入只读模型卷；清单保证实际字节，不冒充上游 immutable commit。模型卡声明 Apache-2.0 不替代全部来源/分发许可留存。
4. 在隔离 PostgreSQL、Redis、对象存储和测试模型配置下，先验证权重校验失败阻止启动、真实 CPU ASR、两请求排队、取消/崩溃恢复、临时文件及内存；不得直接对生产运行基准脚本。
5. 明确镜像、CPU/内存配额、Worker 实例数和分析缓存版本后，才进入单独批准的发布流程。模型/依赖/分析行为变化需要更新分析版本，避免误复用旧分析缓存。

构建命令形态（占位值必须核定，本文没有执行）：

```sh
docker build -f Dockerfile.autocut-cpu \
  --build-arg AUTOCUT_API_IMAGE='<current-api-image>@sha256:<verified-digest>' \
  --build-arg DEBIAN_SNAPSHOT='<reviewed-YYYYMMDDTHHMMSSZ>' \
  -t '<local-review-cpu-image>' .
```

模型校验形态：

```sh
python server/api/scripts/autocut-model-manifest.py verify \
  --manifest docs/worklogs/autocut-stability/models.sha256.json \
  --asr '<provisioned-asr-root>' --vad '<provisioned-vad-root>' \
  --punctuation '<provisioned-punctuation-root>'
```

锁定输入/依赖/权重有利于复现，不代表已经证明最终镜像逐字节一致或经过供应链认证。固定 digest 之前不要把浮动镜像标签写成可复现发布产物。

## 未完成与阻塞

- 本机 Docker 的 `docker_data.vhdx` 位于 C 盘；本轮按存储约束没有下载/构建大镜像，也没有擅自迁移 Docker 配置。需要提供获准的 Linux/H 盘构建环境后再完成镜像安装和真实推理。
- 尚未核定本轮 API 底座 digest、可用 Debian snapshot、Linux 容器 CPU/内存和实例数；overlay 对这些值不设置经验默认值。语法测试使用占位值，不是资源批准。
- 模型和 manifest 已本地校验，但 Linux 只读卷加载、sdist 构建、原生库/字体、容器停止及实际任务恢复尚未实跑。每个常驻 Worker 会持有独立模型，全局任务并发 1 不等于全服务仅一份模型。
- 没有四类真实质量素材、生产容量/故障矩阵结果和发布授权，不能启用线上 AutoCut。旧服务、生产数据库和配置保持原状。
