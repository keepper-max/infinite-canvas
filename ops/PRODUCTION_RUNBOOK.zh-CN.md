# 生产发布与恢复手册

## 发布边界

- 短信、积分扣费和在线支付适配器默认关闭；只上线表结构和接口边界。
- API Key 只写服务器 `.env`，不进入代码、日志、截图或备份校验输出。
- `ADMIN_EMAILS` 只填写明确授权的账号；生产环境必须启用 HTTPS、`COOKIE_SECURE=true` 并填写准确的 `TRUSTED_ORIGINS`。
- 限流、日志保留大小/份数、磁盘告警阈值尚未擅自设默认值；上线前由负责人确认后再启用。

## 1. 只读预检

1. 确认当前目录、Git 提交、工作区状态和 `docker compose ps`。
2. 确认 `.env` 权限只允许部署账号读取，并检查必填变量是否存在；禁止打印变量值。
3. 确认磁盘空间、数据库和 Redis 就绪，记录当前 Web/API/Worker 镜像 ID。
4. 确认公网域名已启用 HTTPS，MinIO 控制台与 API 不直接暴露公网。

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
