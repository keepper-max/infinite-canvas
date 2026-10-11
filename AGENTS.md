<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 守守画布 MCP

- 用户要求制作、续作或查询 Vibe 知识视频时，优先使用 `shoushou_canvas` MCP 读取项目上下文并写入分镜。
- 最终视频必须先渲染到 `SHOUSHOU_MCP_IMPORT_ROOTS` 允许的 H 盘目录，再通过 `import_rendered_video` 登记回画布；不要绕过项目成员权限或项目白名单。
