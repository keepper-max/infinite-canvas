# 守密人科技官网本地改版交付

预览：http://127.0.0.1:4415/ 。本轮未commit、push、打tag或部署，不改Nginx、数据库、API、鉴权、工作台及独立科技树。原index与preview在H:/CodexStorage/website-backups/20261025-brand-upgrade可回查。

## 代码与组件

- website/index.html：唯一正式首页、语义化导航/内容/页脚、四类方案展开、产品入口、教育交流及咨询字段组；移除三方案切换与旧模板代码。
- website/brand.css、brand.js：独立品牌token、行业透视面板、响应式菜单、项目/文章/资讯渲染、页内详情、焦点/减少动效及原咨询协议。
- website/preview.cjs：只增加明确品牌资源白名单，不公开原图、来源文档、提示词、测试文件或私有项目资料。
- website/assets/brand-v2：新增原创行业影像、既有画布/品控/工厂概念图的WebP衍生版与来源sidecar；精确生图提示词industries-prompt.txt。内置image_gen生成，不调用付费生成API；原生工具保存位置由工具决定，网站消费资源在H盘。
- website/tools/brand-check.cjs：本地Chrome/Playwright检查；website/.impeccable/review保存实际截图与report.json。
- PRODUCT.md、website/DESIGN.md、website/.impeccable/design.json、brand-surface.md、来源与实施记录，以及CHANGELOG/pending-test/todo更新；规范仅约束官网。

website/content.js本轮改版未动，保留此前自动资讯的既有工作区改动；改版前后SHA256保持b2d79758e8a610b0a860e4319b1d888fcb4b80f1fbb9374f6caaf73025367709。

## 页面结构与视觉

深海军蓝品牌首屏：左侧明确主张和双CTA，右侧五行业纵向影像共用单图，轻透视/抬升，没有循环粒子或3D依赖。用户最新反馈已删除首屏免责声明小字，保留“AI × 行业未来场景”；素材仍只表达应用方向，不冒充已交付医疗/工业客户案例。

浅色正文：四类解决方案→守守画布产品→两项已有项目与互动知识树→原创文章/前沿资讯→社区邮件交流与AI学院→关于我们→深蓝合作CTA→原咨询表单及企业式页脚。画布按用户最新要求采用既有概念图，并准确标为“产品概念视觉”。

## 保留的功能

守守画布进入、学习中心、AI课程、独立知识树及受保护企业案例库入口；三篇文章全文、五条带来源/观察的资讯及每日数据入口；原咨询POST契约、幂等请求ID、同意项、错误保留与成功回执。未发现真实独立社区平台，使用已确认业务邮箱交流；未虚构备案、客户、经营指标或已开课状态。

## 实际验证

- Node语法检查：brand.js、preview.cjs、brand-check.cjs通过；git diff --check通过。官网无package.json或编译任务，因此未运行无关工作台构建/类型检查。
- 本地Chrome 1440/1024/768/390：scrollWidth等于视口，唯一H1、3项目/5资讯，无破图/坏锚点/页面异常或资源404，首页未加载Three.js。
- 菜单Enter打开/Escape关闭并返回焦点、点击导航关闭；方案、文章、产品详情可展开；减少动态效果配置下检查布局。
- 咨询仅模拟服务：失败保留内容、同请求ID重试、成功重置。禁JS及brand.js404时字段/按钮禁用、method=post，不能通过默认GET泄露联系方式，邮箱与替代提示可见。
- 数据脚本加载失败时，资讯/文章显示替代提示，产品与联系入口仍保留。学习/课程/案例/知识树静态入口本地200，不视为生产权限验收。

完整页面强制解码全部图片的本地资源传输记录约395KB，非弱网首屏性能或生产带宽承诺；首屏原创图约155KB，画布概念图约57KB。浏览器报告及真实截图在website/.impeccable/review：desktop.png/mobile.png为全页，desktop-hero.png/mobile-hero.png为首屏，desktop-product.png为更新后的产品区域。

Impeccable机械检查因不能解析发布资源alias而误报字体均16px，实际浏览器为桌面53.28/40/20/15px，记录并交独立复审核对。复审发现的表单安全降级和来源说明两项已修复并评分resolved；用户最新两项视觉反馈已重新截图/验证，评分亦resolved。SHIP结论仅指本地候选交付。

## 未验证与上线前事项

- 未在Safari/Firefox、物理手机/中文输入法或真实生产咨询后台联调；未作生产负载、真实客户转化或弱网性能测试。
- 尚需用户确认本地视觉；正式社区、备案信息如需展示，应提供真实配置，不用占位内容。
- 现有生产脚本/静态白名单不能直接发布新品牌资源。获明确上线授权后，应建立独立新版本资源映射与哈希/缓存、保留旧资源和所有子页/访问保护，备份后切换，核验首页/资讯/表单/工作台健康并同步资讯基线。
- 不得用仅发布news的脚本顺带发布本次HTML/CSS。旧资源、原截图与用户其它改动均保留。
