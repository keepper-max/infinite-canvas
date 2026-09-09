# Infinite Canvas 选择性迁移计划

## 目标

在 `keepper-max/infinite-canvas` 的现有主线基础上，选择性吸收上游 v0.18.0 能力，同时保留并重新接入全局服务端模型配置、Seedance/Token360 视频适配和 ECS 部署边界。

## 阶段

- [complete] 1. 建立基线并审计上游 17 个提交的依赖与冲突面
- [complete] 2. 合入低冲突修复：素材下载、提示词标记、多参考图片、URL 渠道导入
- [complete] 3. 合入画布能力：节点分组/解组及几何状态
- [complete] 4. 合入媒体参数体系：图片尺寸、视频比例/时长、参考音视频
- [complete] 5. 合入视频任务恢复，同时保留 Token360/Seedance 请求适配
- [complete] 6. 合入可选代理与 WebDAV 修复，不暴露全局 API Key
- [complete] 7. 完成 lint/typecheck/build 和关键流程检查
- [in_progress] 8. 整理提交并推送至用户 GitHub

## 迁移原则

- 不整库 merge；按功能提交选择性迁移。
- 不把 API Key、密码、`.env` 或 ECS 私密配置写入仓库。
- 上游广告和服务商推广内容不合入。
- 与 Token360 冲突的 `video.ts`、`use-config-store.ts`、`model-plugin.ts` 手工合并。
- 每批改动均保持可单独回退。

## 错误记录

- `git cherry-pick` 首次执行被 Git 拒绝：当前仓库缺少提交者姓名和邮箱。代码未发生变化；将使用 GitHub 账号公开身份，仅配置本仓库后重试。
- 第二个选择性提交仅在 `CHANGELOG.md` 产生版本标题冲突；保留功能条目在 `Unreleased`，不引入上游发行版本标题。
- WebDAV 代理增强提交在两份上游待测文档和 `CHANGELOG.md` 产生文本冲突，功能代码无冲突；保留当前文档版本，只合入实际代理与同步逻辑。
- 根目录没有 `package.json`；项目构建入口位于 `web/package.json`，后续检查均在 `web` 目录执行。
- 本机未安装 Bun，首次基线验证未执行。仓库同时提供 `package-lock.json`，改用 npm 的冻结安装与相同脚本验证。
- `npm ci` 被仓库既有 peer 依赖冲突阻止：`@ant-design/pro-components@3.0.0-beta.3` 声明 antd 5，而项目使用 antd 6。采用 `npm ci --legacy-peer-deps` 复现 Bun 的宽松解析，不改依赖版本。
- `npm ci --legacy-peer-deps` 继续被未同步的 `package-lock.json` 阻止；下一次使用 `npm install --package-lock=false`，只安装本地依赖而不改写锁文件。
- 一次记录错误的补丁因上下文不匹配未应用，对源码无影响。
- 普通 npm 安装持续无输出后返回 `ECONNRESET`，确认 本机访问 npm 官方源中断。停止重复安装；优先利用已落盘依赖执行检查，否则转 Docker/Bun 环境验证。
- 镜像源安装成功后，类型检查发现上游模型脚本弹窗仍使用 Ant Design 旧样式槽 `content`；按当前 v6 类型改为 `container`。
