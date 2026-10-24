# 核查记录

- 现有 KnowledgeService 统一 actor/space 权限、CAS、审计及操作回执，导入确认必须复用同一事务链。
- 现有 Markdown 导入在浏览器直接创建文档，需要替换为暂存/确认流程；保留草稿离开保护。
- 原 AI Worker 初始化模型供应商，不适合导入隔离测试；新增独立导入执行入口，不改变 AI Worker。
- 已查阅 MarkItDown、Docling、Mammoth、PDF.js 官方仓库，组件选择仍需固定样本实测。
- 解析进程必须无网络、无数据库凭据、无敏感挂载；普通 child_process 本身不能作为安全边界。
- 已实测 MarkItDown 0.1.9（独立 Python 容器）和 Node Mammoth/PDF.js：两者基础中文可提取。MarkItDown 扫描件返回空串，不能直接作为成功；Node 适配器显式拒绝。原始测试输出在 H:/CodexStorage/shoushou-r12/artifacts/。
- Docling 仅完成官方功能/许可核查，未跑模型管线，不伪造质量/资源比较数据。本轮传统解析不增加模型依赖，保留转换适配接口供后续 OCR。
- 真实 HTTP 首轮发现 Mammoth 的无表头表格被 GFM 插件保留 HTML；增加无语义假定的空表头输出，保留各行，合并单元格表格保留 HTML 并警告。
- PDF.js 6 的销毁对象是加载任务而非 PDFDocumentProxy；已修复并重新通过中文、多页 PDF 沙箱测试。
- API/Web 首次构建通过；浏览器 Word 导入、编辑预览、确认和打开文档通过。后续全面验收尚在运行。

- 最终转换组件实测、授权及事务测试已完成，详见README与quality-performance。
- 解析器控制台输出污染、中文UTF-8分块、表格首行语义及移动端网格撑宽均按真实证据修正；不把早期失败计为通过。
- 新增迁移只在隔离数据库执行；SQL/outbox持久化后队列投递失败已验证Worker启动恢复。
