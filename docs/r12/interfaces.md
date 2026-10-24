# 导入接口及后续格式适配

全部路径在 `/api/knowledge/:spaceId` 下，使用现有会话、功能授权、个人/项目权限。文档确认同样校验空间写权限、操作ID及CAS；原件下载不提供可绕过服务端的公开对象路径。

## 当前接口

- `POST /imports`：原始字节请求体，`x-file-name`为URI编码名称，`x-operation-id`为稳定UUID，`x-folder-id`可选；返回暂存任务而非文档。`GET /imports/operations/:operationId`恢复未知上传回执。
- `GET /imports`、`GET /imports/:id`：当前账号任务与受权完成来源；未完成任务优先，最近任务列表有界。刷新后重新选择任务即可恢复，预览修改保存在localforage，用户/空间/任务分开。
- `POST /imports/:id/cancel|retry|reparse`：取消、重新排队或生成重新解析预览；重新解析需要稳定operationId，绑定原文档及当时revision，不直接改正文。
- `POST /actions` 的 `document.importConfirm`（或专用`POST /imports/:id/confirm`）：payload包含taskId、title、markdown、folderId、allowDuplicate，外层包含稳定operationId。统一KnowledgeService事务保存文档、版本、索引、审计、回执和任务完成状态；任何失败全体回滚。
- `GET /imports/:id/original`、`GET /imports/:id/assets/:assetId`、`GET /documents/:id/sources`：授权下载原件/图片、获取来源元数据。图谱仍只解析真实Wiki Links，CanvasConnection不参与知识索引。

## 转换适配契约

现有独立转换包入口是 `convert(buffer, extension)`，容器通过stdin接收`{body:base64,extension}`，stdout仅输出一个JSON对象。中文输出按UTF-8流式解码，避免进程分块破坏正文。API不信任容器附件路径，验证ID、MIME及重复后才写私有对象。

结果包含 `markdown`、`converter`（名称/版本）、`warnings[]`、`pages[]`（页码/字符/正文偏移）、`assets[]`（容器内临时ID/MIME/base64）与`metrics`（耗时/CPU/峰值RSS）。可信Worker将附件写私有存储，并用授权API URL替换临时引用。原件SHA和长度在解析及重解析前都核查。

R1.3增加PPTX/XLSX/CSV或OCR时，新增格式适配分支与固定语料，不扩展KnowledgeService正文模型。OCR可使用独立镜像及页码/置信度警告，模型文件离线预置；仍不得给解析器网络、数据库密钥或宿主敏感挂载。

后续启用新的文件上限、并发、超时或成本规则前，按AGENTS.md向用户说明并确认。需要模型的OCR或总结必须单独计量、单独授权；不复用本轮免模型解析来默认产生费用。不开发Agent Runtime或新增知识MCP工具。
