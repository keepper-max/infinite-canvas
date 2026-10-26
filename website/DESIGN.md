---
name: 守密人科技官网
description: 深蓝行业影像与浅色企业内容构成的官网视觉系统；仅适用于 website。
colors:
  navy: "#071426"
  navy-soft: "#101f38"
  blue: "#2563eb"
  blue-hover: "#1c50c7"
  ice: "#65b7ff"
  ink: "#101828"
  muted: "#59677b"
  line: "#e5eaf1"
  wash: "#f5f7fb"
  white: "#fff"
typography:
  display:
    fontFamily: "'PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif"
    fontSize: "clamp(36px,3.7vw,58px)"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-.03em"
  headline:
    fontFamily: "'PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif"
    fontSize: "clamp(28px,3vw,40px)"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-.025em"
  title:
    fontFamily: "'PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif"
    fontSize: "21px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "'PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.8
  label:
    fontFamily: "'PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif"
    fontSize: "14px"
    fontWeight: 500
rounded:
  tag: "4px"
  control: "6px"
  panel: "8px"
  media: "12px"
spacing:
  compact: "12px"
  control-x: "23px"
  column: "28px"
  section: "100px"
components:
  button-primary:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "12px 23px"
  button-primary-hover:
    backgroundColor: "{colors.blue-hover}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "#e4ecf7"
    rounded: "{rounded.control}"
    padding: "12px 23px"
  text-link:
    textColor: "{colors.ink}"
    height: "44px"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "13px 15px"
  navigation:
    backgroundColor: "{colors.navy}"
    textColor: "#e6edf8"
    height: "80px"
  knowledge-tag:
    backgroundColor: "#eef3fa"
    textColor: "#405771"
    rounded: "{rounded.tag}"
    padding: "3px 8px"
  service:
    backgroundColor: "{colors.white}"
    padding: "10px 28px 4px"
  product-window:
    backgroundColor: "{colors.navy}"
    rounded: "{rounded.media}"
  article:
    backgroundColor: "{colors.wash}"
    padding: "22px 0 0"
---

# Design System: 守密人科技官网

## Overview

**Creative North Star: "面向真实行业的电影展窗"**

以深海军蓝承托统一调色的行业影像，用前后错落的纵向面板建立第一眼识别。品牌表达专业、清晰、克制；冰蓝用于边光和焦点，科技蓝指向行动。

正文回到白色与浅灰分区，以留白、细分割线和明确标题承载业务信息。按钮紧凑而明确，卡片以内容和图像组织层次，深度集中在行业影像和产品展示。

本规范从 `brand.css`、`index.html`、`brand.js` 及本轮截图提取，仅约束静态官网 `website/`。工作台、画布和独立 3D 导演台继续使用各自主题，不继承这里的品牌 token；首屏构图与页面顺序以 `brand-surface.md` 为准。

**Key Characteristics:**

- 深蓝影像建立品牌识别，浅色正文保持可读性。
- 沿用中文系统品牌字体，以字重、尺寸和留白区分层级。
- 内容容器以细线组织，图片与产品窗口承担主要空间深度。
- 产品概念视觉保留可见说明，素材来源可追溯。

## Colors

冷静深蓝、明确科技蓝与低彩度浅色中性色协作；规范值以 frontmatter 为准。

### Primary

- **科技蓝**（`blue`）：主 CTA、服务图标、输入光标和勾选强调；悬停使用更深的 `blue-hover`。
- **冰蓝**（`ice`）：键盘焦点、深底导航悬停与影像边光语汇，不用于大面积正文背景。

### Neutral

- **深海军蓝**（`navy`）：首屏、初始导航、产品展示底层；**午夜蓝**（`navy-soft`）承托合作区域。
- **墨色正文**（`ink`）与**蓝灰辅文**（`muted`）：浅底标题、说明、标签的主要阅读层次。
- **纸白**（`white`）、**冷雾浅底**（`wash`）与**细线灰**（`line`）：正文背景、交替分区与分割线。

**The Surface Scope Rule.** 官网色彩只用于官网；画布和工作台使用其既有主题系统。

## Typography

**Display Font:** PingFang SC，依次回退 Microsoft YaHei、Noto Sans CJK SC、sans-serif。
**Body Font:** 与标题同一字体栈；不新增外部字体下载。

**Character:** 中文品牌字体承担全部层级；英文眉题靠小字号与字距形成辅助标记，不引入第二套展示字体。

### Hierarchy

- **Display**：用于首屏两行主张，默认值见 `display`；1200px 以下改为 `clamp(34px,3.8vw,48px)`，800px 以下为 48px，480px 以下为 37px / 1.4。
- **Headline**：章节标题使用 `headline`；手机端为 28px，合作区等局部标题保留其组件覆盖值。
- **Title**：默认 `title`；服务标题 20px，项目标题桌面 23px，文章标题桌面 22px，按局部内容密度调整。
- **Body**：基础值见 `body`；模块说明多为 13–14px，首屏说明 15px / 1.95，产品说明在平板限制为 65ch。
- **Label**：按钮使用 `label`；桌面导航 13px，知识标签 10px；英文眉题 10px、字距 .14em。

## Layout

- 默认内容宽度为 `min(1280px,calc(100% - 112px))`；1200px 以下水平总留白 72px，800px 以下 48px，480px 以下 40px。
- 章节垂直间距默认 100px，1100px 以下 80px，480px 以下 62px；产品、合作和页脚有专用间距。
- 桌面首屏两列比例 1 : 1.14、主体最小高 610px；1600px 以上高 660px。800px 以下标题在前、矩阵在后；手机矩阵高 306px，以容器裁剪保留透视。
- 服务网格按四列→800px 以下两列→480px 以下一列；项目桌面三列，800px 以下每项图文并列，480px 以下上下排列；文章与资讯手机均单列。
- 导航默认高 80px；1100px 以下为 72px并切换折叠菜单，480px 以下高 68px。页脚五列→三列→两列；表单在800px 以下成为单列。

实际断点为 1600、1200、1100、800、480px；390/768/1024/1440px 是验收视口，不应误记为 CSS 断点。

## Elevation & Depth

浅色正文以细线和色面分区，普通服务与文章不使用浮起阴影。行业面板使用透视与局部暗部，产品窗口使用轻微侧转和柔和结构阴影；移动端去掉产品侧转。

### Shadow Vocabulary

- **行业影像**（`6px 18px 40px #0006`）：独立纵向面板的空间深度；边缘另有 `inset 1px 0 0 #9bcfff44`。
- **产品窗口**（`0 24px 55px #172f4c24`）：产品概念视觉与浅底分离。
- **滚动导航**（`0 1px 0 var(--line)`）：白底粘性导航的边界。
- **移动菜单**（`0 14px 24px #07142612`）：展开菜单与页面的层次。

## Shapes

媒体使用柔和圆角 `media`，按钮与表单使用 `control`，行业面板使用 `panel`，标签使用 `tag`；手机行业面板圆角 5px、产品窗口 8px。正文不是封闭卡片墙，常用单侧或顶部 1px 细线。

## Components

### Buttons

- 主按钮为科技蓝实底，普通最小高度 48px，图文间距 22px；悬停加深并上移 2px，变化时间 .2s。
- 深底次按钮使用低对比描边与浅色文字；悬停增加极轻白色底与描边亮度。文本链接用 44px 最小高度和箭头表达可进入。
- 键盘焦点使用 3px 冰蓝 outline、外扩 5px。提交按钮禁用时透明度 .6、禁用光标、无上移。

### Chips

知识树标签是浅蓝灰底、细小静态分类说明；不是筛选器，不添加选中态或点击行为。

### Cards / Containers

- 服务四列以线性图标和竖分隔线组织；原生展开详情补充方案，箭头随展开旋转 90deg。
- 项目卡片以 16:10 图像为主、正文开放排版；概念图标签覆盖于图像底部，详情展开后继续显示能力边界。
- 文章用顶部细线起笔；原创文章与自动资讯保持独立区块，来源链接可识别。

### Inputs / Fields

- 输入为白底、`#c5d0df` 描边、控制圆角，内边距 13px 15px；单行最小高48px，文本域默认最小高145px、手机155px。
- 标签与输入显式关联，焦点沿用统一 outline；原生必填与长度校验保留。提交中禁用输入与按钮、显示“正在提交…”，并设置 `aria-busy`。
- 失败时保留内容并显示深红结果；成功以深绿状态文字提供记录编号并重置表单；结果区域使用 `role=status` 与 `aria-live=polite`。
- 表单在 HTML 中默认禁用；脚本绑定提交处理后才启用。脚本不可用时显示在线提交说明与邮箱替代入口，避免普通浏览器提交暴露咨询内容；保持既有咨询 API，不把组件示例视为服务端验收。

### Navigation

初始导航融入深蓝首屏，滚动超过80px切为白底墨字。移动菜单有展开状态、Escape关闭及焦点返回，点击导航项或导航外部关闭；跳过导航链接仅在焦点时出现。

### Industry Matrix & Product Window

行业矩阵共用一张五分区影像，整体倾斜 −7deg、面板 rotateY(−18deg)，悬停至 −10deg 并抬升12px（.6s）；仅表达应用方向，首屏图注仅保留“AI × 行业未来场景”。产品窗口沿用既有画布概念图的压缩资源 `canvas-concept.webp`，保留“产品概念视觉”说明；不宣称实机截图或尚不存在的能力。

首屏文字入场 .9s，行业矩阵 1.3s、延迟 .1s；共同缓动 `cubic-bezier(.16,1,.3,1)`。项目图像悬停放大至 1.025（.5s）；`prefers-reduced-motion:reduce` 关闭动画与过渡、恢复即时滚动并移除已指定的空间交互。

## Do's and Don'ts

### Do:

- **Do** 保持深蓝影像与浅色正文的阅读节奏。
- **Do** 保留产品概念图的可见说明与素材来源记录。
- **Do** 保留键盘焦点、移动导航状态、减少动态效果与表单禁用反馈。
- **Do** 从官网 CSS 提取实际值；规范和实现冲突时先核查源文件。

### Don't:

- **Don't** 将官网品牌 token 注入工作台、画布或独立 3D 导演台。
- **Don't** 添加大面积霓虹、粒子、复杂 3D、过度玻璃或全站黑底。
- **Don't** 用概念图宣称客户交付或实机产品界面。
- **Don't** 用预览组件或本地截图推断生产发布、真实服务器提交已验收。

## P3 当前正文实现补充

Hero由既有hero-kit.css控制，本轮零改动；前文早期面板与产品概念视觉描述仅为历史提取。正文继续使用原字体栈与navy/blue/ink/muted/line/wash/radius，补充section-space（桌面96、平板80、手机64px）、card-padding（24px）与轻微hover-shadow。服务采用统一图文卡片，1200px以上四列、1100px以下两列、560px以下单列；图片8:5，平板/手机2:1，详情继续使用原生details。图片只在hover放大1.025，reduce模式关闭。

产品浅灰蓝两栏，右侧实际界面最大600px且不透视；800px以下单栏，图像等比。案例桌面三列等高，直接呈现问题/实现/能力，800px以下图文并列、560px以下单列，图片contain完整保留真实界面。文章复用行业图像、短摘要与原全文；没有日期数据不编造日期。生态为两张简洁横向入口，560px以下单列。详情与CTA保留44px以上目标及键盘焦点，不在首页初始化科技树。

检测器无法解析本地预览URL到磁盘CSS路径，离线HTML的默认字号报告不构成浏览器事实；实际15/57.6/40/19px层级已由Chrome读取。颜色/字号侧车建议仍需单独同步，本轮不通过自动重建侧车掩盖差异。
