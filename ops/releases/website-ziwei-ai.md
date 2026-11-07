# 官网紫微网页内解读发布

官网 https://shoumiren.online/ziwei/ 已启用网页内 DeepSeek V4.1 Flash 1017 解读，不跳转画布。模型固定 `deepseek-v4.1-flash-1017`，平台目录和此 Key 的模型权限均已核实；访客无需登录，调用由本站 Key 赞助，不扣访客画布积分。未改动画布全局模型 Key。

## 运行位置与数据

- 静态 release：`/var/www/shoumiren-site/releases/20261107-site15-ziwei`；上版 site14 保留。公开12文件及 snippet 哈希见 `website-ziwei-ai-manifest.json`；资讯发布 baseline 已同步。
- 后端位于物理应用服务器，容器 `shoumiren-website-ziwei`；复用现有 API 镜像、网络与 Token360Provider 文本调用实现。入口构建在 `website/ziwei/server-dist/main.cjs`，运行配置见 `ops/website-ziwei.compose.yml`。ECS 仅反向代理和托管静态页面。
- 私有发布目录 `/opt/infinite-canvas-releases/ziwei-ai1`；Key 仅存该目录 `config.env`，权限600，通过私有 SSH stdin 写入，未写到源码、日志、命令参数、本地发布包或 Git。环境文件另有固定模型、平台地址和独立 IP HMAC 密钥。不得打印 env 或完整 Docker inspect/config 输出。
- 仅接收严格 schema 的命盘星曜和计算口径，服务器重新生成格局证据与 prompt；不发送原始生日、时分和地点，不接收客户端模型地址、Key或自定义 prompt。结果按 textContent 展示。
- 原子 Redis 脚本按 HMAC(IP) 执行滚动24小时2次的预留与幂等记录；使用现有 AOF Redis，未知IP或存储异常阻止推理。已经提交但失败的请求保留次数，不自动重试；相同请求ID的成功返回缓存，处理中/失败返回明确状态。短期记录含解读结果，不保存原始出生输入。

## 入口与回滚

边缘 exact 路由覆盖客户端 X-Forwarded-For 为实际连接地址，再经原有 web 隧道进入物理服务器。应用 web 新增唯一 exact 路由，转发专用解读容器；所有原API路由保持原配置。服务端复用既有 forwardedClientIp 规范化并从右侧可信链提取IP，不使用客户端 CF/X-Real-IP。

物理 web 原配置备份在 `ziwei-ai1/web.before`，候选为 `web.next`。先验证 Nginx 再 reload，异常恢复；第一次激活验证遇到 reload 后旧 worker 尚未退出，已自动回滚，沿用既有发布检查等待后重试成功。API和 web 旧健康检查通过。新 sidecar 采用 unless-stopped，原 API 容器未更新。

边缘备份 `/root/shoumiren-ziwei-site15`；回滚脚本 `ops/releases/website-ziwei-ai-rollback.sh` 恢复 site14 占位接口与静态页，同时保留最新资讯。回滚边缘后再按物理备份恢复该 exact 路由并停止新容器；不得直接覆盖已发生后续变更的配置。需要同步恢复本地资讯 baseline。

应用入口本次只 reload Nginx，未重建原 web 容器；配置保留在当前容器层，容器 restart 可保留。以后 recreate 或回滚旧 web 镜像时，必须确保镜像包含本次 `nginx.conf` exact 路由，或从备份候选重新应用并检查，否则官网解读会不可用。独立 compose 与私有 env 也需保留；更新版本或轮换API Key时必须沿用同一 IP HMAC 密钥，避免重置尚在24小时窗口内的次数。未执行生产容器重启或回滚演练。

## 验证证据

- 前端、私有后端和API类型检查、构建通过；既有IP/鉴权限额5项回归通过；8项单测覆盖引擎一致性、时间/闰月口径、隐私投影、服务端 schema、防注入及知识重建一致性。
- 真实 Redis 集成使用随机测试HMAC命名空间和模拟模型，验证并发预留、重复成功/处理中/失败、第三次拒绝、IP隔离、实例重建、滚动过期及故障关闭。没有修改真实访客次数或调用模型。
- 本地及公网浏览器完整流程通过，额外模拟响应验证按钮防重复、输入变化后迟到响应不应用、解读保存/刷新和429提示；这些 UI 情景不调用付费模型。
- `tools/live-ai.mjs` 实际两次调用指定模型，返回1723和2274字；相同请求ID重发返回相同结果，保存刷新恢复；第三次即使伪造IP请求头也返回429及 Retry-After，页面不跳转。当前测试公网出口的2次额度已用完，未人为重置。
- 源站12公开文件哈希、资讯保留、源码404、私有页401、视频Range、旧页面和Nginx验证通过；无效命盘422，来源不受信任403。私有server源码、server-dist、工具脚本和config.env均实测404，12个线上公开文件中未检测到用户提供的Key。
- 本地发布证据 `H:/CodexStorage/deployments/ziwei-ai/`；浏览器证据 `H:/CodexStorage/ziwei-website-verification/live-ai/` 及 `public/`。不包含密钥。

未 commit、push、建分支，未发布工作区其他任务。后续待验证：不同运营商/海外实际出口、IPv6真实网络、长时间供应商故障及旧镜像重建后的运维恢复。已有代理链/失败路径分别有代码与模拟验证，不冒充这些环境已实测。
