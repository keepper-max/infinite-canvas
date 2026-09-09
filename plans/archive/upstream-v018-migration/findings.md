# 迁移发现

- 用户 Fork：`keepper-max/infinite-canvas`，当前基线 `ed013e8`。
- 上游：`basketikun/infinite-canvas`，目标版本 `d213a74` / v0.18.0。
- 上游领先 17 个提交，涉及 64 个文件。
- 高冲突文件：`web/src/services/api/video.ts`、`web/src/services/api/model-plugin.ts`、`web/src/stores/use-config-store.ts`、`web/src/pages/canvas/project.tsx`。
- 不迁移 README 广告及推广素材。
- 功能提交之间的实际代码兼容；目前冲突均集中在被跳过的发行日志或待测文档。
- 构建入口为 `web/package.json`，使用 Vite + React 19；根目录没有 Node 包定义。
- 服务端托管渠道可以用非敏感占位值满足现有配置就绪检查，容器代理在转发时覆盖真实 Authorization。
- Token360 的视频接口需要独立 JSON 适配；不能直接沿用上游 OpenAI multipart 视频请求。
- Seedance Skill 明确要求：2.0 的创作方法可用于 2.5，但时长、分辨率、参考数量等数字不能跨模型线复用。
