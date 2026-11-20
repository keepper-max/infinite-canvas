# 网宿 GPT Image 2.5 接入

## 供应商接口依据

- 型号：`gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`；数据来自[网宿模型文档](https://doc.model-store.ai/ai-gateway/model/support-doc)使用的公开目录及示例接口，不以其他供应商协议猜测网宿路径。
- 详情：`GET /api/aisite/v1/model-plaza/detail?modelId={model}`，示例查询：`POST /api/aisite/v1/model-configs/access-template`，请求体 `{"type":1,"id":"{model}"}`，上述文档请求域名均为 `https://doc.model-store.ai`。
- 文生图：`POST https://api.edgecloudapp.com/v2/llm/images/generations`，JSON；参考图编辑：`POST https://api.edgecloudapp.com/v2/llm/images/edits`，multipart文件。两者使用服务端既有 `AIGATEWAY_TOKEN`，不把 `/doubao` 视频路径用于图片。
- 两型号目录牌价均为美元/百万Token：文字输入5、图片输入8、图片输出30；还列有文字缓存1.25、图片缓存2，但目录将缓存能力标为关闭，未获得该网关缓存细分回执定义。因此发现缓存用量时待核账，不推算折扣。

## 实现与副作用边界

- 网宿目录从单个视频模型扩展为一个视频、两个图片模型，管理员原有启停状态不被覆盖；图片模式为文生图与参考图编辑，数量、尺寸、质量和透明背景沿用现有画布参数入口。
- `WangsuProvider` 对图片使用独立兼容接口，对视频继续委派原 `VolcengineArkProvider`；既有Seedance参数、查询、取消、素材下载与任务恢复链不改写。
- 图片编辑使用已有对象存储或防SSRF的素材读取函数，将图片作为multipart文件发送；不把内部存储键交给供应商，不主动改变参考图尺寸或质量。支持标准base64与URL图片响应，由既有任务层入资产库。
- 图片按实际输入文字/图片和输出Token分项计美元成本，进入既有账本汇率、1.2倍率、整数积分向上取整和幂等扣分流程；视频保持人民币。细分用量缺失、不一致、缓存无法拆分或异常值时保留预留待核账，不按未知费用0积分放行。
- 新迁移 `0058_wangsu_images.sql` 仅追加图片路由，不切换当前画布渠道、不修改历史任务；后台提示更新为当前提供图片和视频。该渠道仍不提供文字、音频模型。

## 验证及状态

- 本地84项定向测试通过，包含两个图片型号的目录编译、JSON文生图、单图/多图multipart编辑、base64与URL响应、图片鉴权/结果异常、内网素材拒绝、美元账本与未知用量保护、既有Seedance/方舟/任务/积分回归。API/Web类型检查通过。
- 已完成API/Web生产构建、API与Worker各84项Linux回归；100张表备份恢复摘要一致，新迁移已在恢复库和生产执行。未调用付费图片接口，真实图片质量、Token字段及多图接收仍待验收。
- 用户后续授权后，功能提交0e5ff9c及v0.16.69标签已推送并部署；现有令牌目录已包含两个图片型号，后台目录、双域名健康、资源哈希和回滚预检通过。发布详情见 `ops/releases/v0.16.69-wangsu-image25.md`。
