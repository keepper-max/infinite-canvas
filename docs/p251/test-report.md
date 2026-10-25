# P2.5.1 实际验证

- 真实Qwen：最终单指令/8轮/一次审批/4节点3边/revision1通过；前两次真实失败保留，并分别修复字段描述和文字计划完成判断。真实正文/版本/hash与费用核验通过，real-model-audit.json。
- Playwright真实API/PG/Worker：12项通过，涵盖响应丢失查询、审批前无写入、刷新恢复审批、单次完整执行、真实保存同步、面板开合与拖宽、断网、未发送草稿、深浅色、390px及会话切换。最后UI变动后复验13项通过，新增顶部标题/保存状态边界检查；真实Qwen已保存成果另以浏览器打开核对，无新费用。
- Playwright草稿并发：5项通过。本页编辑未保存，另一页HTTP CAS写revision2；同步拒绝覆盖、只读差异、草稿持久化及刷新恢复通过，browser-draft.json。
- 实际Worker终止/重启：CAS提交后阻塞计划回执事务并终止本轮子进程，重启后4节点3边/revision1/唯一回执、无额外模型调用，worker-crash.json。
- 原P2.5兼容/账单HTTP替身：20项通过；知识/图谱/Knowledge Node/R1-F/账户积分真实PG回归45项通过；模型/计费/任务/画布单元87项通过；UI纯函数与Schema4项通过。
- 新计划PG组：8个子项全部通过，连同父项及Schema/UI函数共13项通过。扩展测试曾发现JSON未序列化的undefined字段与回放缺字段不严格相等，已修复返回结构；原始失败记录仍在进度中说明。覆盖稳定步骤回放/参数规范化去重、仅文字计划暂停及非法参数实际计量。
- Windows API/Web类型检查、API编译及Vite构建通过；Linux Node22.23.2最终源API编译和模块导入通过。Vite仍有既有大chunk/混合静动态导入警告，未掩盖或修改阈值。

测试均为本轮隔离数据库/Redis，非生产。没有实际付费图片/视频/音频调用，原业务媒体链路使用测试替身；不声称人民币生产结算验收。真实Windows中文输入法人工验收未完成。

- 真实MCP stdio：0.4.0/13工具，6项通过；沿用已核验隔离MCP制品，只有数据库目标换成本轮隔离库，不替换线上bundle。
- 供应商适配及真实网络隔离Linux导入沙箱：41项通过；使用请求替身，不新增付费媒体。Word/PDF全生产链未在本轮重跑，不将沙箱Markdown/大UTF-8测试当成Word/PDF验收。
- 完整隔离库一致性备份恢复到全新p251_final_restore，87张public表逐表行数和规范化行摘要全部相同；包含0053结构、计划/回执、原画布/知识/费用数据，restore-final.json。

## 产物

目录 H:/CodexStorage/shoushou-p251/artifacts：continuous-check.json、browser-check.json、browser-draft.json、worker-crash.json、real-continuous-check.json、real-model-audit.json，desktop-approval/completed、light-completed、mobile-completed及dirty-draft-preserved截图，video/*.webm录屏。失败产物保留原始结果，不覆盖为通过。
