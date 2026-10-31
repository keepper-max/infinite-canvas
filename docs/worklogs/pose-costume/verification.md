# 姿势与服装参考库验证

## 已执行

- `web: npm run typecheck`：通过。首次发现新增图片工具栏回调缺少类型标注，修正后通过。
- `web: npm run build`：通过。保留现有动态/静态混合导入和大 chunk 提醒，未为本次功能改构建策略。
- `web: node --test tests/pose-costume.test.cjs`：11/11 通过。覆盖两/三参考的顺序和提示词编号、未知/不足模型容量拒绝、中英及编号多词检索、默认关闭受限图片、个人试用逐张导入与许可标记、深度图来源转换、本地开发/线上开关隔离、同项目图库资产复用、显式项目/节点/幂等上下文、目录摘要不一致拒绝。
- `server/api: node_modules/.bin/tsx --test tests/pose-costume-contract.test.ts`：3/3 通过。覆盖收藏/组合/不可变版本快照经过画布契约往返、trace 不混入模型参数、成员和只读权限拒绝。权限测试使用受控数据库返回，未对生产数据库写入。
- `server/api: node_modules/.bin/tsx --test --test-name-pattern='canvas contract|reference|trace|stored asset|mode requirements|parameter ranges|multiref|generation jobs do not|interrupted provider|active provider|resuming a provider' tests/canvas-contract.test.ts tests/model-gateway.test.ts tests/job-service.test.ts tests/credit-display.test.ts`：21/21 通过。核查既有任务、引用、模型校验与恢复逻辑，不调用供应商。
- `web: node tests/pose-costume-browser.mjs`：7 组浏览器检查通过，页面脚本异常 0，本地试用图片路径的受控响应验证通过，真实生图调用 0。

浏览器检查实际覆盖：

1. 固定版本完整目录与摘要校验、中英/编号组合检索、收藏；本地个人试用中的姿势缩略图/原图、多视角与深度图切换、选择原站参考进入搭配位置。
2. 使用真实组件及平台客户端发送人物/姿势/服装三张参考，断言项目 URL、节点和参考顺序；受控结果进入图片节点并保留资产版本。
3. 刷新后原任务和结果恢复，不再次提交、不重复添加结果；并排与滑杆对照可用。
4. 搭配保存与刷新恢复；取消及可重试失败分别走现有 cancel/retry 接口，重试不额外调用创建接口。
5. 现有深色主题展示；viewer 项目角色禁用编辑与生成。

测试使用仓库已有 Playwright 与独立 Chromium 页面，不关闭用户已有页面。主目录索引来自核验过摘要的稀疏检出文件；测试仅读取一张 CC0 人物缩略图作为模拟图片响应，截图中重复的人物图是测试夹具响应，不是产品数据的替换。真实产品读取各条目自己的图片 URL。

复现浏览器验证时可提供本地已核验资源：

```powershell
$env:POSE_COSTUME_TEST_CATALOG='H:\CodexStorage\open-pose-costume-reference\public\data\catalog.json'
$env:POSE_COSTUME_TEST_IMAGE='H:\CodexStorage\pose-costume-verification\cc0-selected-thumbnail.webp'
node tests/pose-costume-browser.mjs
```

未提供时脚本读取固定公开索引和单张 CC0 缩略图；不下载图片归档。运行环境需能访问相应站点。浏览器可执行文件与输出位置可分别通过 `POSE_COSTUME_TEST_CHROME`、`POSE_COSTUME_TEST_OUTPUT` 指定。

本地测试产物：`H:\CodexStorage\pose-costume-verification\browser-results.json`、`library-and-comparison.png`、`library-dark.png`。没有把测试图片、完整目录或截图打包进生产应用。另对实际选中的姿势、服装原图执行 HEAD，可达性均为 HTTP 200 / image/png / ACAO:*；仅作为技术可达性证据。

## 文件范围

- 新增业务代码：`web/src/types/pose-costume.ts`、`web/src/lib/canvas/pose-costume.ts`、`web/src/services/api/pose-costume.ts`、`web/src/components/canvas/nodes/pose-costume-node.tsx`、`pose-costume-library.tsx`。
- 现有接入点：`web/src/pages/canvas/project.tsx` 注册节点并排除本节点的旧媒体事件恢复；`web/src/components/canvas/nodes/builtin-nodes.tsx` 为生成图片提供继续搭配工具栏；`web/src/types/canvas.ts` 增加可持久化状态。
- 仅导出现有函数复用：`web/src/services/api/assets.ts` 的 SHA-256；`web/src/services/api/image.ts` 的受管图片参数构造。没有修改其执行逻辑。
- 新增测试：`web/tests/pose-costume.test.cjs`、`web/tests/pose-costume-browser.mjs`、`web/tests/fixtures/pose-costume-harness.tsx`、`server/api/tests/pose-costume-contract.test.ts`。
- 文档：本目录、根 `THIRD_PARTY_NOTICES.md`、`CHANGELOG.md`、`docs/content/docs/progress/pending-test.mdx` 和 `todo.mdx`；仅向原有计划/发现/进度文档追加本次记录。未修改正式功能说明宣称用户已验收。

## 未验证，不能宣称通过

- 未调用真实图片供应商；真实三图理解效果、质量、积分实扣与计费后交付需用户先确认报价和整数积分预算。
- 未启动真实 PostgreSQL/对象存储联调环境，未使用生产双账号执行项目隔离验收。当前证据为既有服务端读码、契约/权限单元测试与受控浏览器请求断言。
- 真实取消与供应商执行的竞态、未知/待核验账单、长时间停留后签名过期和跨设备恢复需人工联调；不能把关闭面板当成退款或取消成功。
- 姿势、服装、深度图以及目录/中文翻译的额外授权未取得；见 README 的具体范围与接入条件。不会以热链或不打包目录的方式宣称绕过限制。
- 未提交、推送、发布或变更生产配置；保留原工作区其他改动。
