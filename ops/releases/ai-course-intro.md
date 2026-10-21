# AI 实践课程简介：官网首页补丁

入口：https://shoumiren.online/#ai-courses 。用户授权 commit、push 与部署。功能提交为 `9a7f9d8`，已推送 main；本次是现有 site07 的单页补丁，不调整应用版本或镜像。

## 发布范围

- 首页增加面向零基础成人与 AI 爱好者的简短介绍，展示办公与写作、网页与小工具、专属 AI 助手、资料问答和工作流自动化五个拟开设方向。
- 明确标为课程筹备中、内容整理阶段；交流按钮复用既有咨询表单，只跳转和聚焦，没有提交测试咨询。
- 课程研究知识库仍保存在本机公开目录之外，没有把研究卡、上游教材、JSON、检索脚本或本机路径传到服务器。
- 工作区既有 `website/content.js` 资讯改动留在工作区，不随本次提交或发布。线上资讯在切换前后字节一致。

## 方式与证据

- 线上预检调用 `t-qd070pdivuki2o0`：site07 首页、Nginx 片段和主站配置匹配既有基线；公网首页哈希一致，画布 ready 正常。
- 激活调用 `t-qd070pdp0uxkx6o`：持有既有资讯锁 `/run/lock/shoumiren-website-news.lock`，先建立 `/root/shoumiren-ai-course-intro-20261021` 备份，再将已提交的首页通过同目录临时文件原子替换。
- 备份包含 `index.before`、`index.next`、`index.after`、`index.public`、`homepage.before`、`main.before`、`news.before` 和 `news.public`。任何校验失败会比较当前首页版本后尝试恢复 `index.before`；不会覆盖无法识别的新首页。
- 只更新 `/var/www/shoumiren-site/releases/20261021-site07/index.html`；Nginx 片段、主站、资讯、学习中心、案例库与科技树文件不改动，无需 reload 或重启应用。
- 发布文件来自 Git 索引及已提交 blob，公网读回逐字节一致。工作区原有 CRLF 与提交规范化 LF 产生不同哈希，部署以提交版本为准。
- 公网 Chromium 在1440px和390px检查：五个方向、筹备状态、咨询入口聚焦正常，无横向溢出与页面脚本错误；学习中心200、案例库匿名401；已查看截图。
- 未知课程研究路径仍由原站返回SPA文档200，响应不是本地研究数据；本次没有新增或扩大这些路径的服务范围。不能将此记录表述为线上未知路径均404。
- 同步 `ops/releases/website-news-baseline.json` 的首页哈希，保留既有目录及片段哈希。资讯验证调用 `t-qd070pdqbzhm680` 返回 `NEWS_UNCHANGED`，没有发布资讯。
- 按项目要求未进行应用编译、构建或重新运行测试套件；完成的是部署基线、字节读回、原入口健康和真实HTTPS浏览器验收。物理手机与Safari/Firefox未验证。

本机发布材料与回滚脚本：`H:/CodexStorage/work/ai-course-intro-release/`。公网浏览器结果与截图：该目录的 `production/`。

## 哈希

- 发布前首页：`81eb3008fc0a1cbb7c5e405d59778e3f0ffca7aee7b538b6448727261ca59972`。
- 已提交且已发布首页：`5004b167170613d6ee568f4109f805e0461c090cc81970b2499e557d4e5b35df`。
- 未变资讯：`1edf9502d1e4bb6774ec8a7ea2d4b08062ef9c510404ddd995778c7e647a87ca`。
- 未变片段：`f69c5c02fae24d3962443eb7d7f34c3952ba415af35de49943ecd8c4f19e068d`。
- 未变主站：`109b39f25e53d4eebec367ff847fc155b1984c9daf5fde7b3028dca2f739bd12`。

## 回滚

先持有相同资讯锁，比较当前首页为本次已发布哈希、片段和主站为上述未变哈希；任一不符即停止。将备份 `index.before` 安装至当前站点的临时文件，再原子替换 `index.html`，读回公网并比较。不要回滚或覆盖资讯、案例库权限、学习中心和其他静态资源，不删除备份。

回滚完成后，将资讯基线的 `indexSha256` 恢复为发布前首页值并提交记录；目录与片段保持原样。本次未执行实际回滚。
