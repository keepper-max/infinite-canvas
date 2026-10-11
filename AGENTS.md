<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 守守画布项目寻址

- 守守画布正式代码仓库固定为 `H:\CodexStorage\infinite-canvas-auth-upgrade`；涉及读码、修改、测试、提交、推送或部署时，必须以该目录为工作目录，不要把当前文档目录 `H:\代码相关\项目\漫剧工作流` 当成正式代码仓库。
- 守守画布线上入口固定为 `https://shoumiren.online`；生产服务器当前发布入口为 `/opt/infinite-canvas-releases/current`。
- 独立 3D 导演台源码仓库固定为 `H:\CodexStorage\3d-director-desk`；只有涉及 3D 导演台自身代码时才进入该目录，主画布代码仍在守守画布正式仓库。
- 生产应用容器不运行在公网 ECS 上；必须通过 `H:\CodexStorage\ssh\shoumiren-deploy-config` 的 `shoumiren-production` 连接进入应用服务器，不得把 ECS 跳板机误判为应用主机。

## 守守画布 MCP

- 用户要求制作、续作或查询 Vibe 知识视频时，优先使用 `shoushou_canvas` MCP 读取项目上下文并写入分镜。
- 最终视频必须先渲染到 `SHOUSHOU_MCP_IMPORT_ROOTS` 允许的 H 盘目录，再通过 `import_rendered_video` 登记回画布；不要绕过项目成员权限或项目白名单。
