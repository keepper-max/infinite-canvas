# 官网紫微排盘

官网独立页面 `/ziwei/`，入口在官网首页导航与页脚。不依赖、导入或创建画布节点。

## 本地开发与检查

在本目录执行：

```powershell
npm ci --cache H:\CodexStorage\npm-cache
npm run typecheck
npm test
npm run build
npm run test:browser
```

预览沿用 `website/preview.cjs`，从仓库根目录启动：

```powershell
$env:WEBSITE_PREVIEW_PORT='4419'
node website/preview.cjs
```

浏览 `http://127.0.0.1:4419/ziwei/`。测试及临时文件写入 `H:/CodexStorage/ziwei-website-verification/`。浏览器测试复用既有 Playwright 安装，可通过 `ZIWEI_TEST_CHROME` 指定已有 Chromium，不下载浏览器。

## 发布边界

`dist/` 是独立静态构建产物，`public-files.json` 列出唯一允许公开的文件；`src/`、`tools/`、`node_modules/`、package 文件不得发布。官网首页、`website/preview.cjs` 与 `website/homepage-locations.conf` 已接入入口及路由白名单。当前发布位于 `/var/www/shoumiren-site/releases/20261107-site15-ziwei`，发布证据与回滚见 `ops/releases/website-ziwei.md`。

后续发布需沿用官网版本目录、公开文件白名单与可回滚 Nginx snippet 流程，按实际暂存的静态版本核对 `/ziwei/` alias；不能使用仅更新资讯的脚本发布功能页，也不能将源码目录整个公开。

## 功能与数据

- 公历、时分、性别、出生地输入；十二宫与主要星曜展示。
- 输入修改后，旧盘明确标记，并禁用 JSON 导出及解读资料复制；重新排盘更新结果。
- 点击保存才将单份出生资料、结构化命盘写入本机 IndexedDB（localForage）。刷新恢复，支持清除；不连接画布云端存储、不跨设备同步。
- JSON 导出包含完整出生资料；AI 资料复制只包含十二宫星曜、计算口径及格局知识证据，排除原始日期、时分与出生地。
- 官网内点击生成 DeepSeek V4.1 Flash 1017 解读，不跳转画布；复用画布 Token360Provider 文本调用实现。本站 Key 赞助调用，不扣访客积分；服务端同 IP 滚动24小时2次，重复请求幂等，已提交失败也计次。
- 参考站链接是普通外部跳转，不携带出生资料。未找到可供第三方接入的公开排盘/解读 API；不将私有接口当作代算服务。

## 来源、口径与许可

参考项目：https://github.com/Renhuai123/ziwei-doushu ，固定提交 `a600484a49255039d0725f1ba9e11ca81a948f97`。

`src/engine/` 中 8 个必要文件按原样摘录，MIT（Copyright 2026 紫微研究）；完整许可及依赖许可保留于 `licenses/`，访客可在 `credits.html` 查看。依赖锁定 iztro 2.6.1、lunar-javascript 1.7.7；间接依赖 lunar-lite 0.2.8。localForage 1.10.0 为 Apache-2.0。

时分在适配层转换成引擎的 0–11 地支索引，真太阳时及晚子时换日只处理一次；公历转农历及闰月归属由引擎完成。默认晚子时归次日、闰月前十五日归本月。首版仅接收 UTC+8 标准时间，历史夏令时需用户先换算；开启真太阳时时手填经度，不自动推测出生地坐标。

排盘仅需小型算法及星表，不需要大型解读数据集。本次没有下载或使用原项目 Releases 数据集、私有断语库或后端接口。

## 格局知识与 DS 解读

`patterns.ts` 从固定提交改编，检测条件保留，叙述性断语替换为中性说明；变更来源在 `pattern-provenance.json`。`knowledge.ts` 参考 heming 的联合阅读方法，以原创措辞整理单人关系框架，不发布现代课程引文或合盘评分。`interpret.ts` 提供事实与知识证据消息构建、SHA-256 命盘标识、请求编号及响应一致性校验。

`POST /api/website/ziwei/interpret` 已启用，公开约定见 `api-contract.json`。服务端严格校验命盘后重新构造消息，模型固定 `deepseek-v4.1-flash-1017`，Key 仅在物理服务器私有环境文件中。独立进程复用现有 API 镜像、文本 provider 与持久化 Redis，不覆盖画布账号模型配置，不使用参考项目数据库。

限额先原子预留，超额429；重复请求返回缓存或明确状态，不重复调用。未知真实IP或Redis不可用时停止调用。失败的已提交请求不自动退款或重试，避免不确定供应商状态下重复扣费。结果与当前资料绑定，资料变化后迟到响应不会应用。

后端构建：`npm run build:server`；类型检查：`npx tsc -p tsconfig.server.json`。后端源码和 server-dist 必须保持私有，公开发布仍仅使用 public-files.json。部署、密钥引用和回滚见 `ops/releases/website-ziwei-ai.md`。
