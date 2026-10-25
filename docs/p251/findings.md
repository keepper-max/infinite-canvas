# 当前证据

- HEAD82cea69，正式目录H:/CodexStorage/infinite-canvas-auth-upgrade；P2.5源码在正式仓库未提交工作区，非旧实验目录。开始基线副本/哈希在H:/CodexStorage/shoushou-p251/baseline。
- 既有Runtime每轮工具列表立即形成审批，完成该批后重新调用模型；没有跨模型轮的结构化总计划。因此Qwen每次单个写工具会触发审批，普通文字stop被直接认定Run完成，未检查用户目标是否完整。
- 既有canvas.apply已支持批次节点/边共用CAS及原子事务，预分配工具stepId就是实际节点/边ID，可用于计划依赖，无须第二套画布持久化。
- 原生面板在UserLayout中为右侧flex sibling，画布ResizeObserver/顶部定位与保存applyRemote链需要进一步核查；refreshExternal已在HTTP前后拒绝脏草稿覆盖，不能移除此保护。
- 保留全部13工具、0050–0052迁移及既有CAS/积分/MCP，不改生产和官网。

- 布局只读独立评估确认：远端同步重置viewport与撤销历史；ResizeObserver仅更新尺寸；桌面面板在768附近挤空画布；顶部项目名/保存状态缺少收缩策略。素材hydration回调仅检查加载版本，期间编辑可能被旧baseNodes覆盖，需按媒体字段合并或编辑epoch保护。
- 连续计划将保留13工具业务输入：写工具在规划阶段返回proposalOnly和稳定预分配UUID，后续连接引用该UUID；全计划只经一次版本/哈希审批，再调用既有CAS事务。不是固定雾港脚本；模型决定节点、内容、布局和连线。

- 付费知识门禁核查：现有JobService只检查trace.inputSnapshot.knowledgeSources；Native paid推理的知识来源存于Run.sources而未传该trace，存在旁路。将在付费适配器发请求前调用同一assertKnowledgeGenerationEnabled，隔离真实测试才显式允许本地门禁，生产开关保持不变。
- 本轮工具搜索路径统一用rg目录加-g，不在PowerShell传未展开的路径通配符。

- 首轮预演严格Schema拒绝内部result字段，未写入；已只传正式画布字段。第二轮一次审批已产生，但JSON.stringify的嵌套对象键顺序与PostgreSQL JSONB回读不同，计划哈希校验正确拒绝执行。计划及参数去重统一改用与正式CAS相同的PG JSONB规范化SHA256，保留严格审批验证，不放宽校验。失败证据均保留。

- 浏览器真实定位：云端加载期间首次mount没有containerRef，原[] ResizeObserver effect提前退出后未重建，导致面板开合世界中心偏移；现依赖projectLoaded且首次不覆盖恢复viewport。实际面板开合误差<0.001世界单位，zoom不变。
- Qwen真实参数曾为知识引用增加title；严格服务校验保留，字段描述明确条件。模型也可能只输出自然语言计划；现首次触发有界内部核对，仍无实际提案则暂停，不标记执行完成。成功演示8轮63089Token，接近64k，长任务仍需明确预算续跑。
- 真实费用和本地积分分开报告：成功供应商成本0.01625518元，隔离账本8积分；总授权已使用/占用0.73元，旧未核验预留保留。
