# 官网 P3 本地验收报告

本地预览：http://127.0.0.1:4415/ 。状态：本地候选已完成，等待视觉确认；未commit、push、建分支、构建镜像或部署。

## 修改前后

- Hero：保留新横竖WebP、原HTML结构、标题、文案、双CTA、能力入口和导航；hero-kit.css没有修改。正文首段改为浅蓝灰渐入白底，并调整顶部留白，不改首屏构图。
- 解决方案：从图标及竖分隔线改为统一比例行业场景卡片。四类服务与详情内容保留，桌面四列、平板两列、手机单列，只有轻微悬停反馈，减少动态效果时关闭。
- 产品：概念图换为本地验收的真实完整工作台截图，含深色画布、节点、连线、侧栏和Agent入口。图注表明测试画布内容，不表示Agent已连接、生成结果或客户交付。保留产品详情与工作台外链；没有改工作台代码。
- 项目：两项自研项目换为既有真实界面截图，科技树沿用真实网络封面；直接展示问题、实现方式和已有能力，展开详情保留能力边界。无客户、收入、准确率或提效数字。
- 内容：三篇原创文章复用已有行业素材作封面，缩短首页摘要，保留全文。五则资讯、日期与信源不动；社区与学院为两张低权重横向入口。正文复用原品牌字体、颜色及圆角。

## 文件清单

- 页面与资源映射：`website/index.html`、`brand.css`、`brand.js`、`preview.cjs`。
- 七张WebP：`assets/brand-v2/service-{enterprise,industry,agent,knowledge}.webp`、`canvas-interface.webp`、`quality-interface.webp`、`factory-interface.webp`；各自`.json`及`p3-provenance.json`记录来源、处理和SHA256，不在公开预览白名单中。
- 检查：新增`tools/p3-check.cjs`；已有`tools/brand-check.cjs`不改动、已运行。
- 文档：本报告、`CONTENT_SOURCES.md`、`README.md`、`DESIGN.md`、`brand-surface.md`、`findings.md`、`progress.md`；根`CHANGELOG.md`及`docs/content/docs/progress/{todo,pending-test}.mdx`。
- 现有其他未提交改动保留；本轮未修改`content.js`、Hero样式、ops、应用前后端、鉴权或数据库。

## 截图对照

截图目录：`website/.impeccable/review/p3/{before,after}/`，包含1920、1440、1024、768、390五档全页与分区截图。完整截图保留页面导航；分区截图仅暂时隐藏粘性导航/跳过链接，避免Chromium跨视口捕获重复遮挡，实际页面及代码没有隐藏导航。

- [桌面修改前](.impeccable/review/p3/before/1440-full.png) / [桌面修改后](.impeccable/review/p3/after/1440-full.png)
- [手机修改前](.impeccable/review/p3/before/390-full.png) / [手机修改后](.impeccable/review/p3/after/390-full.png)
- [产品桌面](.impeccable/review/p3/after/1440-product.png) / [产品手机](.impeccable/review/p3/after/390-product.png)
- [方案桌面](.impeccable/review/p3/after/1440-services.png) / [方案平板](.impeccable/review/p3/after/1024-services.png)

## 实际检查结果

1. 本地真实Chrome/Playwright五档通过：无横向溢出、断图、失效内部锚点、HTTP资源错误、JS异常或控制台错误。3案例、3文章、5资讯完整保留；桌面服务卡片高度419px一致，案例802px一致。人工查看桌面/手机产品、服务、案例、生态及宽屏/手机Hero截图。
2. 键盘Enter展开服务、主CTA焦点可见、移动菜单展开/Escape关闭通过。已有brand-check还覆盖导航点击关闭、静态学习/学院/科技树/案例库入口200。
3. 已有咨询失败保留内容、相同ID重试、成功重置、数据脚本失败、无JavaScript及主脚本失败的表单禁用/邮箱降级通过。请求全部本地拦截模拟，无生产咨询写入、登录或付费生成。
4. Header/Hero/form HTML与任务前备份逐段相同；brand.js从资讯渲染到末尾的导航、表单逻辑相同。content.js SHA256仍为`b2d79758e8a610b0a860e4319b1d888fcb4b80f1fbb9374f6caaf73025367709`。
5. 未新增依赖；首页未加载Three.js或科技树JS。图片lazy/decode、固定尺寸、响应式Hero与减少动态效果保留。强制加载全页图片的桌面传输约449KB，对照约410KB；这是本地全页资源量，不是生产首屏测速或加载耗时承诺。
6. Impeccable机械检测已执行，返回建议/警告。离线检测器无法将预览URL解析到磁盘CSS，产生默认16px层级误报；Chrome实测1440下body15、h1 57.6、h2 40、服务h3 19px。颜色/字号规范侧车建议尚未逐条同步，不能宣称检测器全绿。

原始结果：`p3/after/report.json`与`.impeccable/review/report.json`。本次是静态HTML/CSS/JS页面，无独立编译步骤，运行相关浏览器检查；未运行不受影响的Vite应用构建、后端测试或生产回归。

## 素材与已知限制

- 工作台全景来自真实测试画布，但内容以知识输入为主；建议补充更丰富且可公开的图片/视频创作、资产管理及实际Agent协作截图。它不证明所有产品链路或生产账号权限已验收。
- 行业图复用既有生成素材裁切，均标注场景示意；部分裁切原始横向像素有限，平板及高DPI下会偏软。正式视觉定稿建议补充独立高清横版企业办公、行业应用、工具协同和知识组织图，不将当前示意图视为客户摄影。
- 原创文章没有真实发布日期，本轮不编造；日期字段须由内容负责人补齐。没有新增客户交付授权或成果指标，当前仍以自研项目实践展示。
- 仅检查桌面Chrome中的响应式视口；未测真实iOS/Android、Safari/Firefox、屏幕阅读器、弱网/低端设备及生产接口。没有声称已完成生产兼容验收。
- 既有正式发布脚本/路径不能直接覆盖当前本地候选；本轮没有改Nginx、缓存策略或公开目录。上线前需确认新图片、Hero预览命名空间的正式映射、白名单、内容哈希和回退方案，另行获得发布许可。

## 回退与交付

任务前备份在`H:/CodexStorage/website-backups/20261026-p3/`。按本轮文件比较后恢复，不能直接覆盖后续他人改动。原图片均保留；真实截图衍生图有独立来源记录。

CHANGELOG已追加本地P3归纳；已实现布局进入pending-test，todo保留真实素材、文章日期和正式发布准备，等待用户视觉验收。不修改线上资讯自动发布工作流。
