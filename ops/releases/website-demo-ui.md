# 展厅界面一致性修复

- 线上：https://shoumiren.online/demos/showcase/ 与 https://shoumiren.online/demos/ 。
- 统一为官网既有深蓝、蓝色与浅灰蓝；数字占位封面改为13份实际交互截图及2份既有演示预览。两页共用render-gallery.cjs、gallery-ui2.css和gallery-ui2.js，15/25项数量和实际入口不变。
- 分类、搜索、无结果提示与1440px/390px布局已验证。英文品牌≥11px、分类数字不再降低透明度；独立复审所列修正ship。
- 发布目录：/var/www/shoumiren-site/releases/20261106-site12-ui；备份：/root/shoumiren-demos-20261106-site12-ui。仅切换/demos/静态路径；旧目录、首页、资讯、科技树路由与案例库访问保护保留。
- 本轮缓存、截图、检测记录、哈希清单与发布记录保存在H:/CodexStorage/demo-ui-20261106；来源记录侧车未列入公开路径。
- 源码改动保留工作区，未提交、推送或建分支。资讯发布基线只更新snippetSha256。
