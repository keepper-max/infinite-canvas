# 企业 AI 案例库

官网独立静态栏目，现按用户要求全量导入上游原始案例数据，沿用现有页面和咨询入口，不接入画布。

## 本地运行

在正式仓库根目录执行：

```powershell
node website/ai-cases/build.mjs
$env:WEBSITE_PREVIEW_PORT='4415'
node website/preview.cjs
```

列表：http://127.0.0.1:4415/ai-cases/ 。详情示例：/ai-cases/datawhale-001/ 。修改数据后需重建并重启预览。咨询按钮跳转现有首页 /#contact，本地预览不代理真实咨询提交。

## 数据与展示

- cases.json 与上游 data/cases.json 逐字节一致，保留全部 127 条、原始顺序、字段、摘要、成果数字、匿名身份、来源与核验记录。未删除共享同一来源链接的不同案例。
- upstream.json 固定原始版本与 SHA-256，core.test.mjs 校验字节摘要，防止原文被展示层改写。present.mjs 只做字段别名；标题由原企业名和原场景组合，不生成摘要。
- 列表、详情、计数、筛选选项均由实际数据生成；每页仍为6条，共22页。列表用上游 components 字段作为 AI 能力选项。架构对应 architecture，可复用经验对应 reusable；详情可展开完整原始记录，所有上游字段均保留可见。成果保留上游原文，并标记来源方披露。
- build.mjs 校验唯一ID、内容结构、安全来源地址并预生成HTML；共享来源不当作重复案例。下架数据后如有残留详情，构建拒绝继续，须先备份并移出公开目录。预览只开放有效ID。
- HTML内容统一转义、外链仅允许无凭据HTTPS，URL参数只用于文本搜索和同站状态返回。移动分页允许换行，保留原生控件、键盘焦点、空结果、404、失败静态降级和无脚本阅读。

## 许可与核验边界

上游版本：ef5501231b60539e91c770437a2bfd7c60d65277。README明确原创代码、摘要和结构化数据采用MIT，完整许可保留在 LICENSE-FDE.txt，详情底部署名。第三方原文、图片、报告不在MIT许可内，本次只保留链接，不复制第三方原始材料。

127条数据未逐条重新核验，原始查阅日期沿用上游记录，不冒充本次核验；来源等级和独立核验状态保留。上游自己披露的成果数字、推演与证据缺口原样保留，不代表本站独立确认、现时效果、客户合作或收益承诺。此前7条编辑改写版已备份至 H:/CodexStorage/backups/ai-cases-selected7-before-full-import-20261021 。

## 检查与发布

```powershell
node --test website/ai-cases/core.test.mjs
node web/node_modules/typescript/bin/tsc --allowJs --checkJs --noEmit --target es2022 --module nodenext --lib es2022,dom,dom.iterable --skipLibCheck website/ai-cases/core.mjs website/ai-cases/list.mjs website/ai-cases/detail.mjs website/ai-cases/present.mjs
node website/ai-cases/build.mjs
```

案例原始JSON不进行格式化，避免破坏逐字节一致性。其他源码使用Prettier检查；静态站未配置ESLint，不运行无关画布构建。最新验证见 progress.md。

已按用户明确授权发布至 https://shoumiren.online/ai-cases/ ，版本v0.16.28，生产静态目录为 /var/www/shoumiren-site/releases/20261021-site06。列表、有效详情、资源类型及真实404已线上核验。后续发布仍需按批准流程执行。仅公开HTML、cases.css、cases.json、present/core/list/detail.mjs和许可；不要公开构建、测试、规划和内部文档，不改工作台/API路由。

## 改动文件

本轮更新 cases.json、build.mjs、list.mjs、cases.css、core.test.mjs，新增 present.mjs 与 upstream.json，重建列表和127个详情；website/preview.cjs增加展示适配模块白名单。同步README、规划、进度和CHANGELOG、待测/TODO文档。此前首页入口和既有 website/content.js 工作区改动保留。

原始案例文件在 .gitattributes 中设置 -text，避免 Git 自动换行转换破坏上游字节一致性。部署证据与回滚说明见 ops/releases/v0.16.28.md。
