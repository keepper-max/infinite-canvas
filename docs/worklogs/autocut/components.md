# 开源组件与许可核查

逐仓库读取 GitHub 最新提交元数据、许可证、README 和实际入口/依赖文件。固定版本与活动记录见 [repositories.json](repositories.json)，对应原始文件保存在 `sources/`，每个目录 `index.json` 记录成功读取与 404 路径；不把 404 当作接口存在。

| 项目 | 核查提交 | 代码许可与义务 | 接口、依赖及实际能力 | 本轮结论 |
|---|---|---|---|---|
| [FunClip](https://github.com/modelscope/FunClip) | `36acf72e2add` | MIT；保留版权与许可声明。权重独立许可 | `funclip/videoclipper.py`、Python/Gradio/FunASR；真实语音选段、字幕及 LLM 辅助剪辑；CPU 可运行，模型/torch 占用明显 | 不整体集成 UI；复用已有 FunASR 环境，以小适配器取得真实句级时间戳 |
| [PySceneDetect](https://github.com/Breakthrough/PySceneDetect) | `36ca0229a898` | BSD-3-Clause；保留版权、免责声明及不背书条款 | Python/CLI，OpenCV、numpy；真实场景切分；CPU 解码，长片仍有 CPU/I/O 成本 | 接口可替换；本轮先用已有 FFmpeg 场景检测，不新增 Python/OpenCV 依赖 |
| [Auto-Editor](https://github.com/WyattBlue/auto-editor) | `deb8737a9a84` | 仓库标记 Unlicense；发行二进制、关联产品/素材必须分开核查 | 当前为 Nim CLI；README 支持多编辑器工程导出，`src/license.nim` 实际存在收费功能门控，不能沿用旧版“纯 Python、所有能力全免费”的假设 | 不作为核心依赖，不复制授权门控，不以静音删除代替语义编辑 |
| [AutoClip](https://github.com/artbyjazi/autoclip) | `5d0eac36fa61` | MIT；字体与模型独立许可 | CLI/FastAPI；Python 3.11–3.12，Whisper、MediaPipe、SceneDetect；真实长视频片段、字幕和重构图；完整本地模型栈较重 | 参考分阶段产物和选段边界思想，未安装/复制完整系统，未声称本机跑通该项目 |
| [FireRed-OpenStoryline](https://github.com/FireRedTeam/FireRed-OpenStoryline) | `c9e945215586` | Apache-2.0；保留许可/适用 NOTICE，修改需说明；权重另审 | FastAPI/CLI/MCP；LangChain、TransNetV2、FunASR、PyTorch、FAISS、MoviePy/PyAV；自然语言视频编排。GPU 加速在其待办中，不等于所有组件都要求 GPU | 已有平台 Agent、队列和权限，整套再引入会重复建设；本轮不集成 |
| [OpenChatCut](https://github.com/0xsline/OpenChatCut) | `7fa4b7903e7e` | 主项目 AGPL-3.0-or-later；网络服务及修改源码义务需专门审查，不能把官方素材 MIT 当成主程序许可 | React/Vite/Electron/Node 24、Remotion/FFmpeg、专业时间线、Agent/MCP；桌面/本地存储假设较重 | 不复制、不嵌入，不新增该依赖；只审查公开设计边界 |
| [WhisperX](https://github.com/m-bain/whisperX) | `5d3678b85356` | BSD-2-Clause；保留版权/免责声明。Whisper、对齐模型、pyannote 模型/访问条款另外核查 | Python CLI/API；faster-whisper、torch、pyannote、transformers、torchcodec；词级对齐和说话人分离。CPU 路径存在，不能将 GPU 示例性能套到服务器 | P1 对齐候选，本轮不安装，未承诺词级置信度或说话人能力 |

## 实际采用与未采用的边界

- 当前主要执行依赖是项目已有 FFmpeg，不是上述完整编辑器。开发机 FFmpeg 为 `9.0.2-full_build`，含 libx264；发布时必须核查实际二进制的 `-L`、构建选项和关联库，不能把 FFmpeg 一律当成 LGPL。分发镜像/二进制时的许可与源码提供义务应按实际构建履行。[FFmpeg 官方许可说明](https://ffmpeg.org/legal.html)
- 真实 ASR 验证复用了 H 盘已安装 FunASR `1.3.22` 与 SeACo-Paraformer、FSMN-VAD、CT-Punctuation 权重。三个本地模型 README 标注 Apache License 2.0；本轮未复制权重到代码库或容器，也未代替发布前完整的供应链/权重许可清单。
- 所有候选仓库在本次元数据中均未归档；最近提交时间和具体 SHA 保存于 JSON。维护状态是快照，不是稳定性保证。没有以 README 的声明代替本机运行验收，也没有对七套第三方完整系统做性能压测。
- 未新增这些仓库的 npm/pip 依赖，未 Fork、提交或推送。生产仍须审查实际 Linux 镜像、ASR/字体/编解码器与模型许可，当前仅完成代码许可证识别及技术选型。
