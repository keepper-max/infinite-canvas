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

脚本会先完成预检和备份校验，再构建带提交号的 Web/API 镜像、单独执行迁移并分阶段切换服务。发布记录只包含提交号、备份路径和镜像引用，不包含环境变量值。

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

该操作不会删除新增数据库结构，也不会用备份覆盖当前数据库。需要恢复数据时仍必须先恢复到新数据库并人工确认切换。

## 6. 监控清单

- Web/API：存活与就绪接口、5xx 数、请求延迟、磁盘容量。
- Worker：运行实例数、等待/失败任务数、最长等待时间。
- PostgreSQL：连接数、容量、备份结果和慢查询。
- Redis：连通性、内存、持久化错误和队列积压。
- OSS/MinIO：容量、4xx/5xx、签名失败和临时地址转存失败。

告警阈值、日志轮转大小与保留份数属于生产容量策略，需结合实际并发和磁盘确认后写入 Compose/监控平台。
