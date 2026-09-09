# AI 漫剧生产画布 2.0：任务包索引

本目录把长期改造拆成可独立恢复上下文、实施、验证和回滚的任务包。

## 推荐顺序

1. `00-baseline-and-contracts.md`
2. `01-platform-api-and-auth.md`
3. `02-canvas-persistence.md`
4. `03-assets-and-versions.md`
5. `04-jobs-and-model-gateway.md`
6. `05-canvas-productization.md`
7. `06-drama-workflow.md`
8. `07-composition.md`
9. `08-release-and-operations.md`

## 每次执行前

1. 读取根目录 `task_plan.md`、`findings.md`、`progress.md`。
2. 读取目标任务包全文。
3. 检查工作区、分支、远端和未提交改动。
4. 重新核对任务包依赖是否完成。
5. 涉及生产配置、数据迁移或部署时先创建可回滚备份。

## 每次执行后

1. 运行任务包指定的最窄检查和整链路检查。
2. 重读改动文件，检查状态流、权限、空值和副作用。
3. 更新根目录三份规划文件与任务包状态。
4. 汇报完成内容、未执行检查、风险和下一任务包。
5. 未收到明确指令时不 commit、不 push、不部署。

