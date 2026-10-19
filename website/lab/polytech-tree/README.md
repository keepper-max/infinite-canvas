# 互动知识树｜V3文明网络

V3已获用户批准发布为v0.16.27：恢复V1完整纵向网络与真实坐标，3862微点、真实关联线和最多60项前景/40名称共用相机；带空间索引、LOD、全库搜索、关系高亮与视图控制。实现、实测和回退见[V3.md](./V3.md)，上线证据见../../../ops/releases/v0.16.27.md。本地预览仍为http://127.0.0.1:4411/lab/polytech-tree/。

上一轮全塔性能优化已发布v0.16.26，采样见[PERFORMANCE.md](./PERFORMANCE.md)，发布记录见../../../ops/releases/v0.16.26.md。V2宫格未发布且已备份，其历史报告为[HIERARCHY.md](./HIERARCHY.md)。下列初次接入/视觉历史记录不代表V3：手机不再精选截断、浏览时不运行layoutTower，构建时自动校验/更新坐标缓存。

线上入口：https://shoumiren.online/#knowledge-tree ，独立课件：https://shoumiren.online/lab/polytech-tree/ 。用户已授权并发布v0.16.25；此前本地验收记录保留。仅切换官网Nginx片段和独立静态资源，没有修改生产数据、画布依赖、节点/权限/生成接口或应用镜像。发布证据见../../../ops/releases/v0.16.25.md。

## 运行与构建

在本目录运行 `npm ci --ignore-scripts --cache H:/CodexStorage/cache/npm` 后运行 `npm run build`，产物为dist（已忽略，不进入源码版本）。本次构建实际使用现有锁文件，tsc和Vite通过。独立项目的Three.js没有安装到主画布。

在正式仓库目录以PowerShell执行 `$env:WEBSITE_PREVIEW_PORT='4411'; node website/preview.cjs`。预览服务只监听127.0.0.1，使用dist产物并严格限制公开路径；原4405用户预览未关闭。停止本预览只需终止它自己的进程。

本目录复制自本机secwind7/polytech-tree检查副本，基线提交51d6e1f。复用layout、polyhedra、edges、labels、graph、tour与CameraRig；main/boot为独立课件控制与加载层，demo-scene及presentation为展示适配。原数据结构、描述和wikiEn逐条来源未改，LICENSE与LICENSE-data.md逐字节保留。

## 修改范围

- website/index.html：项目实践静态案例卡；assets/polytech-tree内新版44,056字节WebP（cover-f67e358e16e5，1200×675，实际深蓝场景截图、含来源侧车）和case.css。旧封面保留，不覆盖旧资源；未改fusion.css和content.css，不在首页加载Three.js或节点数据。
- website/lab/polytech-tree：独立源码、锁文件、数据、许可、浅色页面/深蓝舞台/白色知识面板、页底致谢和本说明；dist仅产物，源码和内部文档不公开。
- website/preview.cjs：增加独立产物与封面白名单、本地端口选项；保留现有官网路径与资讯。既存website/content.js日报vLLM更新原样保留，本任务没有修改其业务内容。
- ops/package-website-lab.ps1：新增纯本地打包入口；沿用公开文件白名单与哈希清单思路，不复用旧固定site02上线脚本执行生产写入。Nginx新增路由仅存为本目录nginx-locations.conf.example，未修改正式homepage-locations.conf。
- ops/publish-website-news.ps1及ops/releases/website-news-baseline.json：日常资讯校验改用已部署v0.16.24基线，避免未发布本地首页阻断资讯更新；不改变现有线上预期哈希。NEWS_WORKFLOW.md同步此边界；未运行生产发布脚本。CHANGELOG/pending-test记录本地待验收状态。

## 行为与验收

本轮视觉升级：src/style.css与index.html压缩标题/工具区并重排白色阅读面板；demo-scene.ts/presentation.ts/polyhedra.ts更新深海蓝、柔光、色彩、节点尺寸/材质和细环；labels.ts/edges.ts更新底板、避让、名称优先级和直连/次级关系层次；controls.ts/main.ts处理自适应取景、可打断过渡、拖动及多指防误点。首页、新封面、预览白名单、离线打包列表和Nginx草案仅同步封面引用；没有新增依赖或生产写入。

桌面3862节点、11时代；支持旋转、滚轮缩放、右键平移、悬停、点击两跳聚焦、节点列表、时代/领域筛选及原有漫游。方向键与加减号控制相机，节点列表是无需鼠标的替代入口。减少动态效果时不连续漫游，改为逐时代查看；没有声音和登录请求。

手机精选419节点，DPR上限1、无抗锯齿、名称默认8最多24；桌面名称默认24，最大100。名称有底板、投影避让和优先级，时代整词在桌面显示并参与避让。点选显示两跳子图，集外几何体隐藏、镜头平滑取景（减少动态时即时），取消恢复全景；观察最近距离40，聚焦留出标签空间。数据、来源、关系和placed索引语义不变。

- 独立构建通过；入口约2.97KB（gzip1.73KB）、样式7.60KB（gzip2.35KB）、Three.js约482KB（gzip122KB）、数据/场景约1.57MB（gzip579KB）。重块仅在课件中动态加载，Vite大块告警保留；署名原始数据2.69MB不自动下载。
- Chromium1243软件WebGL2、1440×1000与390×844验证：首页无课件/Three.js请求，封面已解码，保留5条资讯；筛选、键盘节点选择/视角、漫游/Escape、鼠标拖动与缩放、触控模拟、页底许可展开、pagehide清理/恢复，以及加载失败/WebGL不可用降级通过。另补加载进度、真实悬停/点选、表单模拟503后保留内容、首页手机无溢出；表单未提交生产。
- 已修复复核提出的手机时代字重叠和浅底聚焦配色反转。截图与结果在.impeccable/review/；自动化脚本在H:/CodexStorage/website-qa/polytech-qa.cjs及polytech-extra.cjs。检查只证明本地浏览器行为，不是手机硬件FPS或生产验收。
- 本轮最新结果为results.json的33项回归及museum-results.json的22项展项检查（1440×1000、1024×768、390×844），全部通过，无运行/控制台错误或失败资源；实际查看了全景、点选、密集关系、手机/中屏及漫游截图。截图前缀museum-，脚本polytech-museum.cjs。来源等细字对比度最低调整为5.13:1（白底），未宣称完整WCAG认证。
- 许可/数据源文件逐字节对比通过，预览白名单路径可访问；封面来源扫描0缺失。Impeccable静态检测仅报外部CSS未解析导致的flat-type-hierarchy，实际h1约40px、正文13–14px，并非真实扁平字号。视觉复核结论与剩余项记录在progress.md。

## 上线前步骤与风险

1. 用户先确认本地效果，再明确授权发布；真机iOS Safari/Android、Firefox、低端GPU、弱网、浏览器字体差异和较长时间漫游仍待实测。本次未跑主画布完整测试、未执行生产Nginx检查，因为未改这些系统且禁止部署。
2. 以新的官网版本目录打包并备份。`pwsh -File ops/package-website-lab.ps1`只创建H盘公开归档及SHA256SUMS；必须确认没有src、node_modules、研究记录或项目私密文档。不能直接重跑旧ops/publish-website.ps1覆盖site02。
3. 审核nginx-locations.conf.example并替换NEW_RELEASE：单独课件入口no-store、Vite哈希JS/CSS长期缓存、哈希封面长期缓存、非哈希case.css及许可no-cache。许可可抓取、未知课件路径404；保持根域/画布/API/素材隧道不变。需在真实环境核验CSP与MIME，当前只是草案。
4. 官网新版当前资讯入口须继续映射news-current.js；切换并读回后更新website-news-baseline.json的目录/哈希及资讯脚本对应release，不能为了跳过漂移保护采纳未知哈希。批准前每日资讯不能把开发中的课件顺带发布。
5. 发布后补验首页和课件、资讯更新、咨询表单、画布链接、许可文件及回滚。失效WebGL/资源加载应继续显示静态介绍；不要把所有404回落到画布SPA。冷启动需下载约700KB gzip场景/数据，实际传输压缩需服务器启用并验证。
