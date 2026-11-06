# 技术演示维护清单

仅供维护使用。本文件位于展厅之外，不在预览、静态发布白名单或公开下载目录内。素材与站内互动独立核验后再开放卡片。

| 案例 | 取用入口与依赖 | 站内展示方式 |
|---|---|---|
| 区域运营大屏 | https://github.com/knight-L/sc-datav · demo0，地图边界、飞线、配套图表与渲染依赖 | 独立页面，本机渲染示例数据 |
| 产品结构拆解 | https://vincentwei1021.github.io/video-shotcraft/ · space-camera-moves / exploded-view | 本站 MP4 |
| 界面卡片逐步组装 | 同镜头目录 · product-card-progressive-assemble | 本站 MP4 |
| 寻猫雷达 | https://liuhaisi2026212-maker.github.io/motion-palette-15/styles.json · 01，videos/01.mp4 | 本站 MP4 |
| 一亩田 | 同清单 · 06 | 本站 MP4 |
| 纸上有戏 | 同清单 · 16 | 本站 MP4 |
| 科技发布片头 | https://motiontemplates.github.io/385712/assets/demo.mp4 | 本站横屏 MP4 |
| 中国早餐图鉴 | https://hugohe3.github.io/ppt-master-examples/viewer.html?project=ppt169_pixel_breakfast_atlas · 16 页 | 站内翻页 |
| Transformer 图解 | https://hugohe3.github.io/ppt-master-examples/viewer.html?project=ppt169_attention_is_all_you_need · 15 页 | 站内翻页 |
| 数学薄弱点诊断 | /learn/diagnose/?target=cnm_221&demo=1 · 原有知识图谱、题库与诊断引擎 | 直达配方法模拟诊断 |
| 人类科技树 | /lab/polytech-tree/ · 原有 three.js 构建和节点数据 | 直达原有 3D 探索页 |
| 奶茶里有多少糖 | 同十五画境清单 · 14 | 本站 MP4 |

两条既有路径已只读请求生产环境，均返回 HTTP 200 且标题匹配。官网是独立静态站；后续发布需单独明确授权并按正式静态资源清单映射，不使用旧整站发布脚本。


## 素材版本和取用文件

- 四川大屏取自 https://github.com/knight-L/sc-datav/tree/c1aebf1d9ceb6067d41cb6fd7440b00ec2d71f8e 。只构建 Demo0 的 map、stores、panel/chart1–4、四川地理边界、地形贴图、边界流光、图表与其运行依赖。用本地 Canvas 文字绘制城市标签，按屏宽重排地图和四个图表区。静态入口为 demos/media/region/index.html；assets 中的 JS、CSS、三张 WebP 均被入口实际使用。封面来自本站完整大屏的 1440×900 浏览器截图。
- 两个产品镜头取自 https://github.com/Vincentwei1021/video-shotcraft/tree/1266a3ec4831289c4d893d42dd5102723658039a 。使用 demos/camera/space-camera-moves/ExplodedView.tsx、demos/ui-entrance/product-card-progressive-assemble/ProductCardProgressiveAssemble.tsx 和 demos/_fixtures 的必要依赖。按原有帧序和空间布局重渲，拆解对象为示例工作台，商品卡替换为台灯；原样例中的仓库名、品牌名、推广按钮未进入画面。最终输出 H.264，30 fps，分别为 170、172 帧。
- 四部动画来自 https://github.com/liuhaisi2026212-maker/motion-palette-15/tree/681838e339b54f5710b641259e809e7fbaca4933 ，清单 styles.json 的 01、06、16、14 对应寻猫雷达、一亩田、纸上有戏和奶茶多少糖。原始文件分别是 https://liuhaisi2026212-maker.github.io/motion-palette-15/videos/01.mp4 、videos/06.mp4、videos/16.mp4、videos/14.mp4；均使用完整原画幅，保留原声轨（如有），只移除容器元数据并将索引前置。
- 科技发布片头取自 https://motiontemplates.github.io/385712/assets/demo.mp4 ，素材项目版本 9dfbe7d7c6a6d4aa03f6f8e2f2285e631099faae。原片 24 秒，包含屏幕墙开场、数字、主持人和模板内容。展厅取开头约 5.47 秒，在主持人出现前结束。原始文件 SHA-256：f0c6292cdd60a5ecef003adbc353f3a4c54f96cf93d117ce71ade552b38a3197。
- 两套图鉴使用 https://github.com/hugohe3/ppt-master-examples/tree/8f7fe65d739b373b5bbe9930927fbd769bf2f3b1 的 examples.json（version 1）和对应项目的 svg_final 文件。每页按原位置、原画幅渲染为 1920×1080 WebP，统一阅读器支持键盘、手机按钮与点开原图。封面来自各自第一页。原图集取用文件依次为：

  - examples/ppt169_pixel_breakfast_atlas/svg_final/：01_cover.svg、02_how_to_read.svg、03_no01_beijing_douzhi.svg、04_no02_tianjin_jianbing.svg、05_no03_shanghai_sidajingang.svg、06_no04_wuhan_reganmian.svg、07_no05_guangzhou_changfen.svg、08_no06_changsha_mifen.svg、09_no07_chongqing_xiaomian.svg、10_no08_xian_roujiamo.svg、11_no09_lanzhou_niuroumian.svg、12_no10_yunnan_xiaoguomixian.svg、13_no11_xinjiang_kaobaozi.svg、14_disputes.svg、15_atlas_table.svg、16_atlas_complete.svg。
  - examples/ppt169_attention_is_all_you_need/svg_final/：01_cover.svg、02_contents.svg、03_bottleneck.svg、04_idea.svg、05_architecture.svg、06_scaled_dot_product.svg、07_multi_head.svg、08_three_uses.svg、09_positional_encoding.svg、10_why_self_attention.svg、11_training_recipe.svg、12_results.svg、13_ablations.svg、14_legacy.svg、15_ending.svg。

- 配方法直接进入已有学习中心。展厅来访者从第一题开始，答题沿用原有引擎；其他入口已有的自动演示和 step 参数继续可用。封面取本地实际题目页。科技树封面复用官网现有真实 WebGL 截图 cover-f67e358e16e5.webp，原截图记录在 assets/polytech-tree 的内部 sidecar。

## 本地构建和公开边界

- 从仓库根目录运行 node website/tools/build-demos.cjs，从同一份卡片定义生成首页精选区、展厅和九个详情页，并核对公开文件是否存在。科技树使用其原有 npm run build。官网静态页没有主画布的构建依赖。
- PowerShell 设置 $env:WEBSITE_PREVIEW_PORT='4416' 后运行 node website/preview.cjs。当前预览仅监听 127.0.0.1。运行时只访问同源相对地址。
- tools/demo-public-files.json 是内部映射清单；demos/home.js 映射到网站的 brand.js，实现新的首页脚本地址。后续若单独发布，应复制清单中的文件到对应 URL，配合首页 index.html、既有诊断 app.js 与科技树 dist 的正式路由映射；不要发布整个 website 或 tools 目录，不复用旧整站发布脚本。
- 来源、原始链接、工序和素材版本只存在于本维护文件。公开卡片、阅读器和视频无来源导航或作者信息。依据原有许可，科技树保留独立的版权文件。渲染依赖、原始下载、完整浏览器验收记录与截图位于 H:/CodexStorage/tech-demo-work，不在官网目录中。
- 本地导出可使用 node website/tools/build-demos.cjs <全新输出目录>。交付时已实际导出到 H:/CodexStorage/tech-demo-work/verified-public，含 75 个静态增量文件；目录内无维护文档、清单或源码。

## 线上状态

v0.16.67 已发布到 https://shoumiren.online/demos/ 。12 项公网桌面和手机模拟操作通过，75 个公开文件与发布包哈希一致。维护文件未进入公开包；发布和回滚细节见 ops/releases/v0.16.67-website-demos.md。
