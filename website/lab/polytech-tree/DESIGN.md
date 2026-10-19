---
name: 守密人互动知识树
description: 浅色页面、深海蓝三维舞台、白色知识面板的科学博物馆展项，仅约束本目录。
colors:
  page: "#f4f9ff"
  scene: "#071b2d"
  network-line: "#315c78"
  network-highlight: "#67d4f4"
  network-core: "#a8d8e8"
  network-node: "#548ba7"
  surface: "#fff"
  toolbar: "#ffffffee"
  ink: "#203f53"
  muted: "#587181"
  reader: "#435e70"
  line: "#d7e3eb"
  accent: "#155e83"
  hover: "#e1f0f7"
  focus: "#378bb7"
  node-focus: "#d5f5ff"
typography:
  display:
    fontFamily: "'Microsoft YaHei','PingFang SC',sans-serif"
    fontSize: "clamp(26px,2.4vw,34px)"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-.025em"
  title:
    fontSize: "25px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontSize: "13px"
    lineHeight: 1.85
  label:
    fontSize: "11px"
rounded:
  control: "8px"
  experience: "14px"
  fallback-image: "14px"
spacing:
  control: "8px 12px"
  toolbar: "12px 16px"
  reader: "24px"
  mobile-reader: "20px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "{spacing.control}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "{spacing.control}"
  button-secondary-hover:
    backgroundColor: "{colors.hover}"
---

# Design System: 守密人互动知识树

## Overview

本页是既有官网的普通扩展，视觉依据为官网 `../../fusion.css`、`../../content.css`，局部实现以 `src/style.css` 和 `src/demo-scene.ts` 为准。沿用冰蓝浅底、深蓝文字和克制圆角，三维舞台采用用户本轮指定的深海蓝，白色知识面板与之对比；此文不定义官网其他页面的新规则。

视觉方向为科学博物馆的互动展项，不使用星空、粒子雨或昂贵泛光。官网入口使用约44KB的真实课件静态封面，点击进入独立演示，三维内核在演示页加载。

## Colors

主色 `accent` 用于漫游按钮、原生控件强调及版权正文链接；`focus` 独立承担键盘焦点。浅色页面包围深海蓝舞台，白色阅读区保持独立清晰。

正文使用 `ink`，辅助说明和低权重版权使用 `muted`，节点说明使用 `reader`。V3舞台按用户要求使用#071B2D，节点为蓝灰/青蓝，社会文化组少量紫色；presentation.ts仅映射展示颜色，节点与图例同源，不改原始领域分类或数据色值。

V3取消宫格。全景以3862真实微点和代表性真实线呈现V1纵向自然疏密；前景最多60项重点点位，40名称预算内投影避让。选中用#D0F4FF、关联线#67D4F4；背景适度退暗但不移除、不重新布局。悬停只轻度退暗，无关名称不抢占局部标签预算。

## Typography

全页沿用中文无衬线字体栈，无新增网络字体。主标题使用 `display`，副题14px；中等宽度以下换行使用13px。

- 阅读区引导标题11px，科技名称使用 `title`，手机23px；阅读正文13px/1.95。
- 导语12px，手机11px；控件12px，辅助文字10–12px，沿用官网密度。
- 三维科技名称500字重、浅字深底板，抬离节点；优先选中、悬停和直接关联节点，漫游也执行投影避让。按需层级视图不再显示全塔时代标签；时代与年份仍在筛选和知识详情中保留。

## Layout

页面最大宽1480px，常规左右32px，中屏22px，小屏14px；压缩页头/标题，工具条、舞台与阅读区、状态栏顺序不变。

- 桌面阅读区300px，舞台高度clamp(500px,65vh,720px)；1100px以内阅读区270px，760px以内改上下布局（舞台420px，阅读区300px内部滚动）。
- 小屏时代/领域并排，节点选择整行，两个操作平分一行；状态栏换行。
- 手机与桌面首屏均加载3862个真实点；宏观桌面名称预算32、实际避让后本轮21个，小屏预算16/实际9个。背景不是图片；质量模式代表线从3000随LOD逐渐增至最多10000，性能模式1400且DPR1，数据不删。前景关联分页每30项替换，仍能在背景看到完整脉络。

## Elevation & Depth

工作区仅一层柔和偏移投影；V3不用发光、后处理或全量多面体，微点由深度/原重要度控制大小与亮度，密度和真实交叉线营造空间层次。背景/前景用一个WebGL画布和同一相机，DOM名称由同一坐标投影，不叠两个独立场景。

关系线从原prereqs/related去重生成，曲线复用V1向塔轴微收的控制点。宏观线按时代轮换取代表，不偏置到数组前部；线透明度随LOD渐变，选择/悬停有独立高亮批次。标签底板遮住穿过正文的线，不增加装饰性伪关联。

官网案例封面继续继承content.css的浅色容器，使用新深蓝场景截图；实时场景仅由demo-scene.ts创建，未接入的scene.ts不作为设计依据。

## Shapes

控件使用 `control` 圆角，互动区域使用 `experience` 圆角和（1px）边框，并裁切内部内容。降级封面使用 `fallback-image` 圆角；图例色点为圆形（7px），不额外增加装饰徽章。

## Components

聚焦/重置使用.85秒平滑、可被用户操作打断的取景；减少动态时即时切换。初始取景按真实节点与画布纵横比计算，ResizeObserver维护投影和标签焦距；观察最近距离40、聚焦保留名称边距。名称、拾取、筛选、图继续共享placed索引。

坐标在构建阶段复用V1布局并缓存，浏览无全图物理和自转矩阵上传。微点/线批绘制，前景索引固定容量，统一屏幕网格命中；裁剪/候选索引最多30Hz更新，GPU矩阵和DOM名称逐帧同步。镜头沿用.85秒可打断过渡，减少动态时即时。

- 按钮和选择器40px；漫游主色白字，重置透明次级样式，取消聚焦最小30px。
- 焦点：按钮、选择器、链接、滑杆、三维画布和版权折叠标题统一使用 `focus` 的（3px）轮廓、外偏移（3px），不能依赖鼠标悬停表示可操作。
- 阅读区：默认全库简介与22个原领域入口（不是宫格）；选中展示原知识/来源、前置/后续/相关推荐和真实路径信息。无原始应用字段时明确说明，不编造应用案例。面包屑、搜索、历史返回及关联分页保留，搜索跨筛选直达真实ID，不切换成菜单。
- 加载沿用骨架、阶段进度，颜色与深蓝舞台协调；失败继续使用静态封面和恢复入口。
- 动效与版权：漫游旋转观察并每12秒进入下一时代，完整背景始终保留，用户操作即停；减少动态时改为手动逐时代查看。左键平移、右键旋转、指针中心缩放，另有全景/加减/关系线/性能模式；许可仍保持低权重且完整可访问。

## Do's and Don'ts

- Do 沿用官网浅色、深蓝字和真实课件封面，检查桌面/手机的场景、阅读区与入口一致性。
- Do 保持领域颜色与图例同源，保留节点列表、键盘焦点和失败后的静态阅读路径。
- Don't 将本页改成深色赛博舞台、添加与知识数据无关的炫光，或把手机标签重新堆满场景。
- Don't 将本独立课件的节点预算、布局尺寸或控件样式提升为全站规则；当前交付范围是本地预览，不表示生产已发布。

证据：上述数值来自 `src/style.css`、`src/main.ts`、`src/demo-scene.ts`、`src/boot.ts`、`src/polyhedra.ts`、`src/edges.ts` 与 `index.html`；视觉对照为 `.impeccable/review/desktop.png`、`mobile.png`、`homepage-case.png`，方向依据为 `task_plan.md`。节点聚焦色与关系线混合/透明度以最终源码为准。
