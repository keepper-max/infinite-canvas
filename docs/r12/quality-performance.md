# 转换质量、许可证与资源实测

## 实际选择

本轮采用 Mammoth 1.13.0 + Turndown 7.2.4/GFM 1.0.2 处理 DOCX，PDF.js 6.4.299 处理文字型 PDF，yauzl 3.4.0 预检 DOCX 压缩结构，TextDecoder 处理 UTF-8。均位于独立 `server/document-converter` 包；API 不加载 Office/PDF 解析依赖，不新增 Python 业务服务。

已核对 [Mammoth BSD-2-Clause](https://github.com/mwilliamson/mammoth.js)、[PDF.js Apache-2.0](https://github.com/mozilla/pdf.js)、[Turndown MIT](https://github.com/mixmark-io/turndown)、[yauzl MIT](https://github.com/thejoshwolfe/yauzl)。保留依赖许可证及 Apache NOTICE 等分发义务，生产发布前应将镜像依赖清单随制品归档。npm 生产依赖审计结果保留在 `converter-audit.json`，不把当前无已知告警等同永久安全保证。

[MarkItDown](https://github.com/microsoft/markitdown) 0.1.9 已在独立 Python 容器用相同样本实测：中文、列表、表格及图片引用可提取；DOCX 表格无表头时使用空表头，扫描 PDF 返回空正文，业务适配仍必须拒绝。其 DOCX 也使用 Mammoth；本轮 Node 组合可以复用当前部署栈并显式保存图片、页码、警告，实测解析延迟较低，因此未引入 Python 主服务。

[Docling](https://github.com/docling-project/docling) 已核对官方功能及 MIT 许可，具有结构识别/OCR 能力；本轮没有运行其模型管线，不能给出实际质量或 CPU/内存胜负结论。它保留为后续需要复杂版面/OCR时的适配器候选，不为首版引入未经验证的模型依赖。

## 固定语料与结果

- 中文 Word：基础段落、粗斜体、超链接、标题和列表、表格、嵌入图片。正文内容和顺序断言通过；无表头表格插入空表头而不擅自把第一数据行当标题，图片原字节保存为授权附件。未知样式、外链图片、嵌入附件等按警告及原件核对。
- PDF：中文、混排、5页、30页、扫描、空白，以及结构标记完整的中文标题/表格。文字与页码断言通过，标记表格输出保留“姓名/领域、李白/诗歌、王安石/文学”；扫描和空白明确拒绝。未标记复杂表格不推测结构。
- TXT/MD：有效 UTF-8、BOM、CRLF、Frontmatter、Wiki Links、Callout、未知扩展保真；中文长文本跨 stdout 分块逐字相等。无效 UTF-8 提示另存编码并保留原件；损坏 DOCX、伪装 PDF、伪装二进制文本及不支持扩展被拒绝。
- 生成器在 `server/document-converter/tests/fixtures.mjs`。PDF 测试使用本机有许可字体，仅在隔离语料目录生成，未把字体文件或带字体测试 PDF 放入仓库或发布包。

详细原始输出：`converter-results.json`（早期语料批次）、`tagged-table.json`、`markitdown-results.json`、`converter-unit-tests.txt`、`final-import-tests.txt`。最终通过结论以最终测试日志为准，不能将早期失败日志视为通过。

## 试运行资源边界

用户已批准：单文件10MiB、全队列单并发、每账号最多3个未完成任务、解析90秒、每个容器1CPU/512MiB、DOCX解压100MiB、失败/取消暂存保留7天。正式文档引用原件不会被清理。解压路径、加密条目、过多条目、输出容量和进程数另有沙箱防耗尽检查；超限明确失败，无正式文档创建。

原件和提取图片计入既有用户存储配额，共用 `storage-quota:<user>` 锁；上传/对象提交位于短数据库事务外。管理员既有素材配额豁免保持原逻辑，导入另受试运行上限约束。未修改积分或模型费用规则。

## 实测数据

Linux解析容器 Node22、1CPU/512MiB；主机本地 API/MinIO/Redis/PostgreSQL，存在其他本地负载，均非生产容量结论。以下来自 `performance.json`，任务均通过真实队列，包含容器冷启动与轮询延迟。

- DOCX 约10KB：上传575ms、解析79ms、CPU86ms、峰值RSS71MiB；到预览就绪约5.3秒。
- 中文PDF 1页/5页/30页：解析约342/304/477ms，RSS约100–102MiB；端到端约6.7/3.7/5.5秒，不以页数严格线性增长推断容量。
- TXT 1.04MB/5.2MB同时提交、单并发处理：上传约859/885ms；解析约25/578ms；RSS约77/107MiB；端到端约6.2/11.6秒，后者排队约4.8秒。400,000/2,000,000字符均与源文逐字一致。
- MarkItDown相同DOCX样本进程内约1.2–3.3秒、RSS约107MiB；PDF样本约2.2–2.4秒。其启动和依赖初始化计时范围与Node不同，原始 JSON 分别记录进程耗时与完整容器墙钟，不据此宣称普遍性能倍数。
- 浏览器真实预览、编辑、保存及恢复已通过；多兆字正文的移动端富文本交互尚未单独完成性能验收。当前保守单并发设置不得直接放大为生产吞吐保证。
