# 守密人官网独立静态发布

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
