# 生产发布与恢复手册

## 发布边界

- 短信、积分扣费和在线支付适配器默认关闭；只上线表结构和接口边界。
- API Key 只写服务器 `.env`，不进入代码、日志、截图或备份校验输出。
- `ADMIN_EMAILS` 只填写明确授权的账号；生产环境必须启用 HTTPS、`COOKIE_SECURE=true` 并填写准确的 `TRUSTED_ORIGINS`。
- 密码登录失败限流已确认：账号 5 次/5 分钟，IP 10 次/15 分钟后冷却 3 小时；验证码发送和错误校验分别按账号 5 次/5 分钟，错误校验共享 IP 冷却。其他限流、日志保留和告警阈值仍需上线前确认。
- 安全加固发布必须同时更新 ECS 的 `ops/edge/media-cache-locations.conf`，让旧媒体缓存也携带隔离 CSP；不要只重建应用容器。公网 Nginx 必须追加真实 `X-Forwarded-For`，应用取私网隧道前最近的公网地址，忽略 CF/X-Real-IP 和左侧伪造值。API 只能由私网反向代理访问，不得将容器端口暴露公网；若未来加 CDN，先核验真实 IP 链，再开放流量。Redis 不可用时拒绝受保护的鉴权请求，不回退到不限流。

## 0. 生产拓扑与部署入口

### 官网与画布分域（分阶段上线）

- 根域shoumiren.online精确首页已切为守密人官网，canvas.shoumiren.online为画布工作台；根域旧工作台/API/媒体路径仍兼容，禁止全量重定向。新域Web/API/3D仍同源代理既有隧道，不新增应用数据库或开放端口。
- 官网源为website/，静态发布目录/var/www/shoumiren-site/releases/20261016-site01，include为/etc/nginx/snippets/shoumiren-homepage.conf，仅分流根域精确首页和CSS/Logo。ops/publish-website.ps1分准备/激活阶段，以云助手上传公共文件并校验SHA256，不重建画布容器。新版本应使用新的目录和资源路径，不覆盖immutable缓存文件。
- 官网切换备份/root/shoumiren-homepage-20261016-site01/shoumiren-live.before，after保存激活配置。回滚前cmp确认当前配置等于after，再恢复before并nginx -t/reload；若已存在后续修改则停止，不覆盖他人配置。不删静态版本、数据库或媒体；新画布子域不受根首页回滚影响。
- 边缘SSH deploy-gateway仅用于跳转，不提供shell。边缘站点维护可使用现有授权阿里云云助手，先验证实例ID、主机名和当前Nginx配置，命令不得携带密钥或输出环境文件。
- 新子域边缘站点/etc/nginx/sites-available/shoumiren-canvas，独立证书/etc/letsencrypt/live/canvas.shoumiren.online；沿用旧站点上游、请求头、媒体鉴权缓存和代理超时。原站点和续期配置备份/root/shoumiren-domain-20261016/nginx-before.tgz；只对新增站点做可回滚的平滑reload。
- canvas证书以现有certbot.timer及webroot续期，deploy hook /etc/letsencrypt/renewal-hooks/deploy/shoumiren-canvas-reload只在该证书更新后校验并reload Nginx；不更改根域证书及续期方式。
- 登录Cookie仍host-only；新域须重新登录。API同源Origin可由既有校验接受，若遇到来源错误应先查Host/转发链，不盲目扩大TRUSTED_ORIGINS或Cookie Domain。
- 切首页前必须验收新域登录、读取/保存、上传/下载、视频Range、跨账号权限和3D；保留旧域本地数据同步/迁移入口。回滚时停用新增子域站点并nginx -t/reload，DNS只处理新增canvas记录，不能覆盖后来改动或删除权威媒体。

- `shoumiren.online` 指向 ECS；ECS 只承担公网 Nginx、HTTPS 和反向代理，不运行应用容器。
- Web、API、Worker、PostgreSQL、Redis 和 MinIO 运行在物理服务器 `shoumiren`。
- 3D 导演台保持独立仓库和构建产物；生产 `.env` 的 `DIRECTOR_DESK_DIST` 必须指向版本化发布目录中的绝对 `dist` 路径，Web 容器只读挂载并通过 `/3d-director/` 同域名提供。
- 物理服务器通过独立反向隧道，把 SSH 管理入口绑定到 ECS 回环地址 `127.0.0.1:19222`；该端口不得监听 ECS 公网地址。
- 发布必须使用 ECS 非 root 账号 `deploy-gateway` 作为跳板，再进入物理服务器 `adminsun`；禁止根据域名解析或历史物理服务器公网 IP 直接判断部署目标。
- `ops/deploy-via-ecs.ps1` 会核对本地 `main`、`origin/main`、两台主机指纹、物理服务器主机名、生产容器工作目录和公网健康状态，再调用现有生产发布脚本。

物理服务器安装独立管理隧道：

```sh
sudo install -o root -g root -m 0644 ops/systemd/shoumiren-deploy-tunnel.service /etc/systemd/system/shoumiren-deploy-tunnel.service
sudo systemctl daemon-reload
sudo systemctl enable --now shoumiren-deploy-tunnel.service
```

确认 ECS 只在回环地址监听管理端口：

```sh
ss -lnt | grep '127.0.0.1:19222'
```

Windows 发布入口示例；健康检查等待秒数必须由负责人明确填写，不在脚本中设置猜测默认值：

```powershell
.\ops\deploy-via-ecs.ps1 `
  -IdentityFile H:\CodexStorage\shoumiren_deploy_ed25519 `
  -EcsKnownHostsFile H:\CodexStorage\ssh\production-ecs-known-hosts `
  -PhysicalKnownHostsFile H:\CodexStorage\ssh\production-physical-known-hosts `
  -PublicUrl https://shoumiren.online `
  -HealthTimeoutSeconds 300
```

首次配置、隧道重启或排查发布入口时，在相同参数后增加 `-PreflightOnly`；该模式只验证 Git、主机身份、生产容器和公网健康，不创建发布包、不备份数据库、不切换服务。

如果管理隧道不可用，只重启 `shoumiren-deploy-tunnel.service`；不要重启网站、API、数据库、素材隧道或删除任何发布目录。紧急回滚仍在物理服务器当前发布目录使用第 5 节命令。

## 1. 只读预检

1. 确认当前目录、Git 提交、工作区状态和 `docker compose ps`。
2. 确认 `.env` 权限只允许部署账号读取，并检查必填变量是否存在；禁止打印变量值。
3. 确认磁盘空间、数据库和 Redis 就绪，记录当前 Web/API/Worker 镜像 ID。
4. 确认公网域名已启用 HTTPS，MinIO 控制台与 API 不直接暴露公网。
5. 确认 `DIRECTOR_DESK_DIST/index.html` 存在且对应本次验收版本；切换新版本时保留上一版本目录用于回滚，不要原地覆盖。

在生产目录执行统一预检。脚本只检查必填变量是否存在，不输出变量值：

```sh
chmod 600 .env
sh ops/preflight-production.sh
```

生产环境如使用额外的 Compose 覆盖文件（例如仅在回环地址开放 API 端口），预检、备份、发布、健康检查和回滚都必须设置同一个 `COMPOSE_OVERRIDE_FILE`：

```sh
export COMPOSE_OVERRIDE_FILE=/opt/infinite-canvas-releases/docker-compose.production.yml
```

## 2. 发布前备份

在当前生产目录执行：

```sh
sh ops/backup-production.sh
sh ops/verify-backup.sh /opt/infinite-canvas-backups/release-实际时间戳
```

备份包含源代码快照、环境配置、PostgreSQL 自包含转储、Git 提交、容器和镜像清单。目录权限由 `umask 077` 收紧。Redis 只承载可恢复队列状态，不作为权威数据源；任务权威状态在 PostgreSQL。

## 3. 构建与分阶段切换

1. 先构建带唯一提交标签的新 Web/API 镜像，不覆盖旧标签。
2. 在隔离 Compose 项目中恢复备份数据库副本并运行全部增量迁移。
3. 对隔离环境执行登录、默认项目、画布保存、素材上传、任务创建、SSE、失败重试和 FFmpeg 冒烟。
4. 生产迁移只运行一次；`0011` 为新增表/列的兼容迁移，不删除旧字段。
5. 先切换 API/Worker，再切换 Web；任何就绪检查失败都停止继续切换。

确认部署窗口、健康检查等待时长和目标提交后执行：

```sh
export PUBLIC_URL=https://实际域名
export DEPLOY_HEALTH_TIMEOUT_SECONDS=负责人确认的秒数
export CONFIRM_PRODUCTION_DEPLOY=deploy-完整Git提交号
sh ops/deploy-production.sh
```

脚本会先完成预检和备份校验，再核对待执行迁移是否已在 `ops/backward-compatible-migrations.txt` 明确声明可供上一版程序继续读取，然后构建带提交号的 Web/API 镜像、单独执行迁移并分阶段切换服务。发布记录只包含提交号、备份路径、迁移清单和镜像引用，不包含环境变量值。

## 4. 发布后验收

```sh
PUBLIC_URL=https://实际域名 sh ops/health-check.sh
```

另外人工验证两个独立账号：互相不能读取项目；团队 `editor` 可编辑，`viewer` 只能查看。检查模型目录、真实图片/视频任务、资产转存和成片输出，确认浏览器与服务器日志均无密钥。

## 5. 回滚

1. 停止继续发布，保留现场日志和请求 ID。
2. 把 Web/API/Worker 标签切回备份清单中的上一版镜像并重建对应服务。
3. 因 `0011` 仅增加结构，应用回滚通常不需要回退数据库；不要直接删表或删列。
4. 只有确认数据被错误写入且负责人批准时，才从已验证的 `database.dump` 恢复到新建数据库并切换连接；禁止覆盖原数据库做试恢复。
5. 重新执行健康检查和双账号权限冒烟。

按发布脚本输出的清单回滚应用镜像：

```sh
export CONFIRM_PRODUCTION_ROLLBACK=rollback-清单中的完整Git提交号
sh ops/rollback-production.sh /opt/infinite-canvas-releases/release-提交短号.manifest
```

回滚脚本会先比较备份时与当前的迁移清单；存在未声明向后兼容的新增迁移时会拒绝切换旧镜像。首次上线版本化计费规则时，如果已经有任务使用旧 Worker 无法理解的规则快照，也会拒绝回切旧 Worker，必须先前滚修复。该操作不会删除新增数据库结构，也不会用备份覆盖当前数据库。需要恢复数据时仍必须先恢复到新数据库并人工确认切换。

## 6. 监控清单

- Web/API：存活与就绪接口、5xx 数、请求延迟、磁盘容量。
- Worker：运行实例数、等待/失败任务数、最长等待时间。
- PostgreSQL：连接数、容量、备份结果和慢查询。
- Redis：连通性、内存、持久化错误和队列积压。
- OSS/MinIO：容量、4xx/5xx、签名失败和临时地址转存失败。

## 7. ECS 素材热缓存

素材原文件仍以物理服务器 MinIO 为权威来源。ECS 只保留可随时删除、可自动回源重建的热缓存，不把缓存纳入生产数据备份。

1. 在物理服务器安装并启动 `ops/systemd/shoumiren-media-tunnel.service`，确认 ECS 回环端口 `19101` 和 `19102` 可用。原 `19001`、`19002` 转发保留为回滚路径。
2. 在 ECS 创建仅允许 `www-data` 写入的 `/var/cache/shoumiren-media`，把 `ops/edge/media-cache.conf` 安装到 Nginx `http` 配置中。
3. 把 `ops/edge/media-cache-locations.conf` 的两个 location 放到站点 HTTPS server 的通用 `/api/` location 之前。
4. 把现有 `/infinite-canvas-assets/` 的 MinIO 上游从 `127.0.0.1:19001` 切到独立媒体隧道 `127.0.0.1:19101`，使上传和旧签名下载不再与主站共用 SSH 连接。
5. 先运行 `nginx -t`，再 reload。使用已登录账号连续请求同一素材，确认首次回源、后续命中；未登录和其他项目账号必须继续返回 `401/403/404`，不能从缓存读取内容。

缓存上限为 15 GB，索引区为 32 MB，视频与大文件统一按 2 MB 分片，30 天未访问的条目可以淘汰。缓存命中仍会通过主 API 隧道执行轻量权限检查；缓存未命中时才通过独立媒体隧道读取文件。回滚时恢复站点 Nginx 备份并停止独立媒体隧道即可，禁止删除 MinIO 权威数据。

告警阈值、日志轮转大小与保留份数属于生产容量策略，需结合实际并发和磁盘确认后写入 Compose/监控平台。

## 8. ECS API JSON 压缩

公网 `/api/` 直接经 ECS 代理到业务隧道 `127.0.0.1:19002`，不经过 Web 容器，因此不能依赖仓库根目录 `nginx.conf` 的 JSON 压缩设置。ECS 当前站点 `/etc/nginx/sites-enabled/shoumiren` 指向 `/etc/nginx/sites-available/shoumiren-live`；改动前先核验实际路径并备份原文件。

在现有 `location /api/` 内保留以下设置；不要覆盖代理头、超时或把 API 代理缓冲打开：

```nginx
gzip on;
gzip_types application/json;
gzip_vary on;
```

仅对协商支持压缩的客户端压缩 JSON，保持 `Cache-Control: no-store`；不将 `text/event-stream`、图片或视频加入压缩类型。现有 `proxy_buffering off` 和 `proxy_request_buffering off` 必须保留，素材热缓存 location 不变。后续重建 ECS 站点配置时也应保留此设置，不只更新应用容器。

变更后先执行 `nginx -t`，通过后平滑 reload，并检查首页、就绪接口、已登录画布响应的 `Content-Encoding: gzip` 和 `Vary: Accept-Encoding`，同时检查 `Accept-Encoding: identity` 仍返回可读 JSON。任何检查失败时恢复站点备份，重新检查并 reload；不要重启应用或数据库。本轮原配置备份为 `/root/shoumiren-api-gzip-20261015-c/shoumiren-live.before`，恢复前仍需核对是否存在后续配置变更，避免覆盖他人修改。

## 9. 正式生成并发50（待发布执行）

旧镜像只接受1—32，不能先把旧镜像环境变量改为50，否则Worker无法启动。先发布包含新配置校验的镜像；本次代码默认及上限均50，转存并发仍4、合成仍1，失败任务不增加自动重试。

发布前在应用服务器受限备份目录保存当前Worker镜像、命令、挂载、Compose文件及环境文件（权限600，不输出密钥）。确认没有执行中的生成/转存/合成任务后，将正式环境的`WORKER_CONCURRENCY`显式设为50；核对Compose最终覆盖来源，历史压测override可能覆盖环境值，不能只改`.env.example`或依赖默认值。新镜像使用正常`node dist/worker.js`，不得继续挂载`worker-load50.js`压测入口。

发布后核对实际Worker启动日志`concurrency=50`、健康检查、转存4、合成1，以及无重复执行/对账异常。先复用既有测试媒体验证元数据处理，不自动发起额外付费生成。并发50是单Worker的执行槽数量，不是供应商无限并发承诺，多副本会叠加。

回滚必须同时恢复原镜像和原环境并发2，勿让旧镜像加载50；保留任务、账本和媒体数据。当前本地变更尚未执行此发布步骤。

## 10. 官网内容与公开咨询发布

官网第二版静态目录为`/var/www/shoumiren-site/releases/20261017-site02`，旧site01的CSS/Logo路径继续保留，不覆盖不可变资源。只发布首页、公开CSS/JS和三张concept-v1.png，不发布原截图、源码、研究记录或配置文件。

先发布Web/API及增量迁移0044_website_inquiries.sql。咨询记录独立留档，管理员入口`/admin/inquiries`；原反馈鉴权和用户归属不变。回滚应用时保留新增表，不删除咨询数据。上线后核对匿名提交、管理员限制及已确认的IP滑动窗口（5分钟5次），不调用付费生成。

官网使用`ops/publish-website.ps1`分为PrepareOnly和激活两步。公开资源包经现有HTTPS工作台临时路径传输，包中只有公开文件；ECS核对归档SHA256、精确文件清单、常规文件类型及每个文件SHA256后解包。传输完成移除临时公开包，不开放新端口。

PrepareOnly在`/root/shoumiren-homepage-20261017-site02`备份主站配置和旧homepage snippet；激活前比较备份与当前文件，只替换snippet，nginx检查/reload或公开资源/画布就绪检查失败时恢复旧snippet。手工回滚前比较当前snippet与备份homepage.after，确认没有后续改动，再恢复homepage.before并检查/reload；不覆盖主站其他配置，不改旧画布/API/媒体代理。
