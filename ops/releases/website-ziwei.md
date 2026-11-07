# 官网紫微独立页面发布

- 公开入口：https://shoumiren.online/ziwei/ ，官网首页导航与页脚已接入。
- 新目录：`/var/www/shoumiren-site/releases/20261107-site14-ziwei`；前版 site13 保留。
- 本次为官网静态功能发布，未 commit、push、建分支或改动应用容器；未捆绑工作区其他任务的后端和前端改动。根 VERSION 未变。
- 12 个公开文件及配置哈希见 `website-ziwei-manifest.json`。仅发布首页和独立包公开名单，不包含源码、依赖目录或出生数据。
- 部署证据：`H:/CodexStorage/deployments/ziwei68/` 的 stage-result、activate-result、manifest 与发布脚本；归档包约 304 KB。生产备份 `/root/shoumiren-ziwei-site14` 保存原 snippet、主站配置、首页和激活前资讯。

## 发布与验证

通过既有 ECS Cloud Assistant 发布官网静态资源；ECS 仅为边缘静态入口，应用服务器未操作。先校验主配置与 snippet 基线，在私有备份目录测试完整候选 Nginx，再于资讯锁内原子切换并 reload。校验失败自动恢复旧 snippet。

所有 12 文件线上读取哈希一致，资讯与激活前一致；学习页、实验室等旧页面正常，私有案例返回 401，源码路径返回 404，视频 Range 正常。DS 占位接口返回 503 / ZIWEI_AI_NOT_CONFIGURED。公网 Chromium 完成首页入口、无效输入、重复点击、生成、本机保存、刷新恢复、复制、旧结果拦截、重排、实际 JSON 下载、手机视口及清除恢复检查；pageerror 与页面第三方请求为零。

`website-news-baseline.json` 已更新为新目录与实际文件哈希。资讯发布脚本仅增加对 `-ziwei` 静态目录后缀的白名单支持，原有防漂移校验保留；路径白名单与 PowerShell 语法解析通过，未执行资讯更新。当前线上动态资讯在切换时直接从原目录保留，未使用工作区的 content.js 覆盖。

## 回滚

已准备 `ops/releases/website-ziwei-rollback.sh`，通过既有 `ops/publish-website-brand.ps1 -ScriptPath ...` 执行于边缘机。脚本持有资讯锁，要求当前配置仍等于本次发布结果，保留最新资讯后切回旧配置，并测试、reload Nginx；发现后续发布则拒绝覆盖。

回滚后应同步恢复本地 `website-news-baseline.json` 的 site13 基线，再核验公开首页与资讯。未执行回滚演练，以免中断已上线页面；原配置备份、候选配置语法与发布失败自动回滚路径已经检查。

## DS 接入边界

当前仅提供知识证据、自建 prompt、同源请求/响应约定和未配置占位响应。真实 DeepSeek 服务端适配器、账号权限、积分预算及账本任务需接入后单独验证；现在不发送付费模型请求。无需使用参考项目数据库或大型数据集。许可与来源见官网 credits 及 `website/ziwei/pattern-provenance.json`。
