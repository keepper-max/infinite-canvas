# P25 原生创作助手 UI 证据核对

## 结论与边界

- **UI finish 裁决：ship / clear。** 独立 reviewer 已确认快捷键提交约束、会话切换保存反馈清理两项 resolved；本文复核对应代码及现有浏览器证据。
- 本次是现有画布的 **Operate 普通局部扩展**：沿用 `canvasThemes`、`app-theme` 与极简扁平交互，不建立新视觉世界、不制作 comp。
- `PRODUCT.md`、`DESIGN.md` 当前不存在；已有主题、组件和渲染结果构成视觉依据，不能据此将项目判为从零建设。
- 本文仅记录 UI 验收证据，不代表真实供应商调用、费用结算、安全后端全链路或生产部署已验收。

## 既有系统与实现对照

- **主题与形态**：`web/src/lib/canvas-theme.ts` 是画布面板、文字和分隔线的配色来源；`web/src/lib/app-theme.ts` 提供 Ant Design 按钮、选择器和弹层 token。助手读取当前主题，使用扁平文字按钮与线性分隔，保留既有画布工具栏和节点视觉。
- **布局与层级**：桌面为右侧面板，默认宽度来自 store（440px），拖动调整在组件内约束为 360–760px；移动端固定覆盖、`max-w-full` 限制宽度。历史与项目上下文在顶部，消息区独立滚动，输入与模式选择留在底部。
- **历史与流输出**：`native-agent-panel.tsx` 读取服务端会话快照与事件；快照消息按会话、turn、item 渲染，流内容按 run/item 汇总，快照已物化的消息不再重复显示。`acceptAgentSnapshot` 拒绝较旧 run revision 回退当前快照。
- **审批与恢复**：计划展示操作摘要、可展开的写入参数、修改意见及确认/修改/取消；运行中提供停止任务，错误状态提供重新查询。草稿和未确认提交使用 localforage 保存，重试沿用 operation ID。
- **安全同步与定位**：面板通过 `use-native-agent-bridge.ts` 接入画布既有 `refreshExternal`；该函数在请求前后均检查未保存草稿、保存中及冲突状态。定位先同步再聚焦；桥接项目不匹配时禁用操作。

实现核对范围：`web/src/components/native-agent/`、`web/src/stores/use-native-agent-store.ts`、`web/src/services/api/native-agent.ts`、`web/src/pages/canvas/hooks/use-native-agent-bridge.ts`、`web/src/pages/canvas/hooks/use-cloud-canvas-persistence.ts` 与布局接入点。本文没有修改代码。

## 渲染与浏览器证据

证据根目录：`H:/CodexStorage/shoushou-p25/artifacts/`。已实际查看以下四张截图：

- `desktop-approval.png`（1440×1000）：深色桌面审批计划、参数入口、修改与取消可见；审批前画布为空。
- `desktop-completed.png`（1440×1000）：深色完成状态、知识节点与连线、保存 revision、同步与定位入口可见。
- `light-completed.png`（1440×1000）：浅色主题保持既有面板和画布色彩关系，未发送草稿可见；画布自身显示未保存状态，不能把截图解释为所有本地修改均已保存。
- `mobile-completed.png`（390×844）：手机面板宽度受视口限制，长消息换行，历史选择、输入和发送可见；当前滚动位置未展示全部完成反馈，不以此单图证明完整交互链。

`browser-check.json` 的 `checks` 实际为 **10 项**，`errors` 为 `[]`，记录的本地验收地址为 `http://127.0.0.1:5195`，最终 revision 为 2：

1. 服务端接受但响应丢失后查询原会话恢复任务；审批前画布保持空白。
2. 刷新恢复待审批及历史消息；响应丢失与刷新不产生重复 run，模式保持正确。
3. 两次确认后保存 4 节点、3 连线，且三个知识来源不同；断网重连与刷新保持保存结果。
4. 关闭面板与刷新保留未发送草稿；浅色与 390px 手机布局无横向溢出。
5. 运行中/已结束会话快捷键不能绕过提交约束；切换新会话清理上一会话保存与定位反馈。

以上每行合并两条原始检查，不将行数误当检查项数。`ui-detector.json` 内容为 `[]`，表示该次检测未报告命中；不替代渲染目检或功能验收。

## Finish 问题闭环与未覆盖项

- **Resolved：快捷键绕过禁用条件。** `submit()` 统一检查就绪、运行中、已结束、空输入、模型、付费预算及 busy；按钮与 Ctrl/Meta+Enter 均经过该入口，浏览器检查有对应通过记录。
- **Resolved：上一会话保存反馈残留。** 会话 effect 清理 `saved`，新建会话路径也显式清理，浏览器检查确认保存及定位反馈不串会话。
- **证据限制**：这 10 项浏览器清单没有单独列出逐 token 流输出、停止任务后状态恢复、请求期间新增草稿阻止同步等场景；本文对这些行为的结论限于代码核对，不追加未经执行的通过声明。
- **待主流程验收**：真实供应商费用、模型回执及生产环境结果由主流程独立确认，UI 的 ship 裁决不覆盖这些事项。

## 文档处理依据

- 已读取 `C:/Users/biaoc/.codex/skills/impeccable/reference/document.md`，采用其从现有主题、组件、布局、交互状态及渲染结果提取证据的方法。
- 当前授权仅为 finish 证据记录，唯一写入边界为本文；因此不执行完整 `$impeccable document` 的根级 `DESIGN.md`/sidecar 生成流程，不创建 `PRODUCT.md`、`DESIGN.md` 或 `.impeccable`，不顺带修复文档漂移。
- 下一步以真实供应商与费用验收结果补齐发布判断；本记录保留 UI 与业务验收的证据边界。
