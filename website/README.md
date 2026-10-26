# 守密人官网独立静态发布

## 官网品牌改版（v0.16.47已发布）

正式首页源码已收敛为index.html、brand.css、brand.js，保留content.js现有数据与/website-news/current.js自动资讯入口。新静态素材在assets/brand-v2；图片来源与精确生成提示词在该目录provenance.json及sidecar中，只有明确白名单内的图片/CSS/JS由本地preview公开。

预览：PowerShell设置`$env:WEBSITE_PREVIEW_PORT='4415'`后运行`node website/preview.cjs`，访问http://127.0.0.1:4415/ 。检查脚本tools/brand-check.cjs使用Playwright与Chrome，仅连接该本地地址，咨询请求全程拦截模拟；依赖来自既有工作区运行时，不安装到项目。结果与截图见.impeccable/review。设计记录与交付边界见DESIGN.md、brand-surface.md、upgrade-plan.md。

本轮没有改任何Nginx配置或生产发布流程；现有旧整包发布脚本不能直接发布新版。后续需单独审批新版本资源映射与白名单、缓存版本及回滚方案，仍保留learn/ai-courses/ai-cases/lab等已有路由与案例库访问保护；不要用资讯发布脚本发布本次HTML/CSS改版。

AI 实践课程专栏已发布至 https://shoumiren.online/ai-courses/ ，首页简介可进入，展示五方向25节拟定安排和筹备状态。223仓库查阅页 https://shoumiren.online/reference/ai-repositories/ 只通过独立链接访问、不加密码、设置noindex，首页及专栏无入口；只导出导航数据，不公开教材或私有研究库。当前静态目录site08，发布及回滚见 ops/releases/ai-course-columns.md；此前简介记录见 ops/releases/ai-course-intro.md。

当前已发布 v0.16.30：学习中心 https://shoumiren.online/learn/ 已接入数学与英语全量图谱、题库、自适应诊断和分享图。当前独立静态目录 /var/www/shoumiren-site/releases/20261021-site08；企业 AI 案例库继续使用密码保护，科技树、旧版资源及画布/API 容器保留。资讯发布基线已同步。发布、验证与回滚说明见 ops/releases/v0.16.30.md。

最新流程：每日北京时间9点由现有Codex任务ai核实后自动发布，不再逐条人工审核。首页引用/website-news/current.js（no-store），旧不可变资源保留。日常执行ops/publish-website-news.ps1，只替换资讯数据，不重建应用；细则及失败恢复见NEWS_WORKFLOW.md。调度仍依赖当前电脑/Codex，不是服务器独立任务。旧ops/publish-website.ps1固定site02整包白名单不适用于当前整站覆盖，下次整站发布须更新公开白名单和资源映射。

官网首页与画布Vite应用分开；当前site02包含咨询表单、项目概念视觉、完整文章与资讯摘要，不引入主画布依赖。

- 公开入口：https://shoumiren.online/
- 工作台：https://canvas.shoumiren.online/
- ECS静态目录：/var/www/shoumiren-site/releases/20261017-site02
- 边缘include：/etc/nginx/snippets/shoumiren-homepage.conf（仅根域HTTPS server）。只分流精确/、CSS和Logo，不覆盖旧/canvas、/login、/api、/assets/或媒体隧道。
- 切换备份：/root/shoumiren-homepage-20261017-site02；homepage.before/after保存旧/新snippet，回滚前比较当前snippet与after，避免覆盖后续改动。主站配置另备份且未改动。

第二版发布使用既有阿里云CLI和应用服务器SSH：先发布咨询API/管理界面及增量迁移，再将仅含公开文件的归档放到现有HTTPS工作台随机临时路径；运行ops/publish-website.ps1 -PrepareOnly -ArchiveUrl <临时URL>校验暂存，再单独运行ops/publish-website.ps1激活。脚本备份并比较现有snippet及主站配置，失败不可直接反复重跑PrepareOnly；先核对远端结果。传输完成后移除临时公开归档。preview.cjs仅用于127.0.0.1:4405，不部署为服务器。

咨询已部署：POST /api/website/inquiries，管理员在画布 /admin/inquiries 查阅、写内部备注并标记完成。公开邮箱shoushouhuabu@126.com，不依赖咨询邮件通知；原登录用户反馈保持不变。0044迁移已完成，Redis独立限流同IP每5分钟5次，故障拒绝。线上提交/重试去重及匿名管理接口401已确认，管理员完整操作和真实浏览器验收待补充，详见ops/releases/v0.16.23.md。

第二版使用独立site02目录，保留旧site01的不可变CSS/Logo。已补齐资讯摘要、三篇咨询文章与三类真实项目说明；图片为原界面作参考的AI产品概念视觉，见CONTENT_SOURCES.md与IMAGE_PROMPTS.md。原截图和内部文档不公开。最新资讯自动发布流程只更新独立数据入口，原页面、案例和咨询接口不随每日更新而部署。

P3本地精修：继续使用4415预览；Hero和导航保持原样，解决方案4/2/1列、真实画布工作台、真实项目界面与紧凑研究/生态入口已接入。`tools/p3-check.cjs`保存五档前后截图及报告，现有`tools/brand-check.cjs`覆盖表单模拟与失效降级。验收及资源缺口见[p3-review.md](p3-review.md)。静态官网无独立构建步骤，本轮未构建画布应用，也未修改发布白名单或Nginx；新增图片需另行审核后进入正式静态发布方案。

## P3 正式发布候选

用户已确认本地视觉并授权commit、push、部署。v0.16.47仅发布官网，资源统一为/website-assets/20261026-site09/；使用精确资源白名单与既有Cloud Assistant私有传输，保留所有旧静态目录和子页路由。Hero不再使用preview命名空间。部署记录、回滚与资讯基线见ops/releases/v0.16.47-website.md；前述“尚未授权发布”是本地开发阶段记录。

P3已上线：https://shoumiren.online/ 。静态首页/资讯当前目录为20261026-site09，原子页继续使用site08等既有目录。公网13文件哈希、1440/390 Chrome及原子页保护/画布ready检查通过；上线中发现新目录权限导致短暂404，已恢复并修正，详见v0.16.47发布记录。
