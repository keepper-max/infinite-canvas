# 守密人学习中心

官网独立静态栏目，入口 `/learn/`，图谱 `/learn/explore/`，诊断及结果 `/learn/diagnose/`。结果沿用原应用状态，无额外结果路由。主画布应用与 API 不参与此栏目。

从 `H:\代码相关\项目\AI教育\math-taxonomy` 导入完整数据、判题与诊断引擎和本地图形库，未生成或修改题库。数学 802 个、英语 442 个知识点，题库 5123 题；算法和判题规则保持上游原样。关于页保留 AI 初稿、未经教师审核及结果局限说明。来源与许可页按用户要求暂保留现状，当前原页正文不完整；来源与许可信息后续单独完善。LICENSE 和 vendor 许可文件原样保留。

## 本地验证

在官网仓库运行 `node website/preview.cjs`，打开 `http://127.0.0.1:4405/learn/`。这是既有 Node 本地预览服务，不是生产运行方案。

执行 `node website/learn/tests/test_engine.js` 和 `node website/learn/tests/integration.cjs`。后者核验数据、算法、原测试与上游导入时 SHA-256 清单逐字节一致，并检查入口及可发布资源。测试与清单不作为公开页面。

诊断会话、设置及已见题目改用 `shoumiren.learn.*` 命名空间，数学和英语仍分别存档；不读取、迁移或覆盖其他页面及原站浏览器存档。图谱深度使用独立 sessionStorage 键。判题、出题、复测、回放规则均由未改动的 engine.js 执行。

## 发布与后续验收

- 按用户追加授权发布到独立 site07 静态目录；`homepage-locations.conf` 增加 `/learn/` 目录路由与保留 query 的尾斜线重定向，不落入画布 SPA fallback。发布记录见 `ops/releases/v0.16.30.md`。
- 只发布 HTML、CSS、JS、data JSON、品牌图、LICENSE 和 vendor 许可；排除 tests、README、完整性清单及源项目脚本、草稿和截图。
- 学习页需要同源脚本与数据、inline 初始化脚本、inline 样式及 `img-src 'self' data: blob:`；分享图预览使用 blob URL，已在正式 HTTPS/CSP 下完成桌面与手机宽度验收，不能直接套用禁止 inline 的科技树 CSP。
- 分享二维码固定指向 `https://shoumiren.online/learn/?from=share`，英语携带 `subject=english`；避免导出 localhost。分享图是复习交流用图，不含姓名或答题原文，也不上传存档。
- 来源与许可正文按用户要求暂不补齐，后续单独处理。物理手机、Safari/Firefox 与读屏器需补充验收。
