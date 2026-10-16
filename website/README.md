# 守密人官网独立静态发布

官网首页与画布Vite应用分开；当前版本20261016-site01来自已确认的融合版Demo，仅隐藏方案选择、调整正式标题/说明及画布子域链接，不引入主画布依赖。

- 公开入口：https://shoumiren.online/
- 工作台：https://canvas.shoumiren.online/
- ECS静态目录：/var/www/shoumiren-site/releases/20261016-site01
- 边缘include：/etc/nginx/snippets/shoumiren-homepage.conf（仅根域HTTPS server）。只分流精确/、CSS和Logo，不覆盖旧/canvas、/login、/api、/assets/或媒体隧道。
- 切换前配置备份：/root/shoumiren-homepage-20261016-site01/shoumiren-live.before；after保存切换后的版本，回滚前须比较当前配置与after，避免覆盖后续改动。

第二版发布使用既有阿里云CLI和应用服务器SSH：先发布咨询API/管理界面及增量迁移，再将仅含公开文件的归档放到现有HTTPS工作台随机临时路径；运行ops/publish-website.ps1 -PrepareOnly -ArchiveUrl <临时URL>校验暂存，再单独运行ops/publish-website.ps1激活。脚本备份并比较现有snippet及主站配置，失败不可直接反复重跑PrepareOnly；先核对远端结果。传输完成后移除临时公开归档。preview.cjs仅用于127.0.0.1:4405，不部署为服务器。

工作区新增咨询表单：POST /api/website/inquiries，管理员在画布 /admin/inquiries 查阅、写内部备注并标记完成。公开邮箱shoushouhuabu@126.com，不依赖咨询邮件通知；原登录用户反馈保持不变。新接口依赖数据库增量迁移0044与Redis独立限流（同IP每5分钟5次，Redis故障拒绝）。未部署；必须先发布API与管理界面并确认迁移，再启用新版静态首页，不能只更新首页让表单指向未上线接口。

第二版使用独立site02目录，保留旧site01的不可变CSS/Logo；脚本只替换homepage snippet，失败恢复旧snippet。已补齐三则资讯摘要、三篇咨询文章与三类真实项目说明；图片为原界面作参考的AI产品概念视觉，见CONTENT_SOURCES.md与IMAGE_PROMPTS.md。content.js、content.css与三张concept-v1.png一并发布到site02，原截图和内部文档不公开。每日任务仍仅产出待审核草稿，不开启自动发布。
