---
name: vibe-video
description: 在守守画布的专用项目中策划、生成和管理 Vibe 知识视频。用户提到 Vibe 知识视频、知识大赏、代码视频或希望用 Opus 生成脚本与分镜时使用。
---

# Vibe 知识视频

把守守画布作为项目与素材管理台，把本机作为最终渲染环境。若环境中有 `vibe-knowledge-video` 技能，同时遵循其选题、脚本、分镜、确认和渲染要求。

## 进入专用项目

1. 若网页未连接，先用 `open-canvas` 打开线上守守画布。
2. 用 `canvas_list_projects` 搜索完整名称 `Vibe 知识视频制作`。
3. 找到唯一匹配项后，用 `site_navigate` 进入 `/canvas/<项目 ID>`；不要另建同名项目。
4. 先用 `canvas_get_state` 读取已有节点，避免覆盖同一主题的工作。

## 生成与归档

- 选题简报、脚本、分镜和 Canvas 代码使用 `canvas_generate_text`，模型固定为 `catalog.text.claude-opus-5-5`。生成后用 `generation_get_status` 等待完成。
- 每个阶段分别保留为清晰命名的文字节点；脚本和分镜必须经用户确认后才能进入下一阶段。
- 画布中的模型调用走正式登录、项目权限、积分和模型网关，不直接访问数据库或供应商密钥。
- Playwright、Python、FFmpeg 和最终 MP4 渲染在本机执行，工作目录优先放在 `H:\CodexStorage`，不要把大型帧序列或视频写入仓库。
- 当前 Windows 渲染环境位于 `H:\CodexStorage\vibe-video-runtime`。运行 Python 脚本时使用 `.venv\Scripts\python.exe`；Playwright 浏览器目录为 `ms-playwright`，FFmpeg/ffprobe 位于 `ffmpeg\ffmpeg-9.0.2-full_build\bin`。
- 成片通过守守画布现有上传入口加入专用项目；若当前 MCP 没有本地视频上传工具，使用浏览器上传，不要把视频编码成超大文本节点或提交到 Git。

## 停止条件

模型失败、积分不足、项目不存在或网页登录失效时，保留已完成节点并向用户说明阻塞点；不要绕过鉴权、计费或项目权限。
