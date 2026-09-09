# 基线与恢复契约

## 本地代码基线

- 仓库：`H:\CodexStorage\infinite-canvas-upgrade`
- 分支：`main`
- 提交：`d31c74e253232c4a6314b7461b7e2f0d9c948ee8`
- `origin/main`：与本地提交一致。
- 上游：`basketikun/infinite-canvas`，审计时上游基线为 `d213a74614e0e4bd8a26383d1e1e907249e9c61b`。
- 本轮工作区改动仅为未提交的规划与契约文件。

## ECS 运行基线

- 当前对外容器：`infinite-canvas`
- 当前镜像：`infinite-canvas:global`
- 镜像 ID：`sha256:a13b4d47de32276972cb9481a148e4e7019d14770d4a201a6625c34f81a734b8`
- 对外端口：`3000`
- 旧 Compose 项目目录：`/opt/jingjie-studio`
- 旧 Web/Worker：已停止。
- 旧 PostgreSQL、Redis、MinIO：仍运行并仅绑定本机回环地址。
- 持久数据卷：`jingjie-studio_postgres_data`、`jingjie-studio_minio_data` 和 Redis 匿名卷。

当前生产容器的 `/healthz` 返回前端页面而不是健康 JSON。第 8 部分部署时必须以新版健康探针通过为切流条件。

## 敏感配置清单

只登记变量名，不登记值：

- `TOKEN360_API_KEY`
- `TOKEN360_UPSTREAM`
- `TOKEN360_CATALOG_URL`
- 后续新增的 `DATABASE_URL`、`REDIS_URL`、`SESSION_SECRET`
- 后续新增的 `OSS_*` 或 `MINIO_*` 凭据变量

浏览器、Git、错误响应、SSE、普通日志和前端运行期配置都不得包含这些值。

## 已创建备份

### ECS

位置：`/opt/jingjie-backups/part0-20260908T141423Z`

内容：

- 当前生产镜像压缩归档。
- 当前及旧服务的容器 inspect 快照；这些文件可能包含密钥，仅允许 root 读取。
- `/opt/jingjie-studio` 源码与配置归档。
- PostgreSQL 自定义格式转储。
- MinIO 数据归档。
- `SHA256SUMS` 和独立恢复说明。

创建完成后全部 SHA-256 校验通过；期间没有重启容器、切换镜像或写入业务数据。

### 本地

位置：`H:\CodexStorage\backups\infinite-canvas-upgrade\part0-20260908T141423Z`

内容：完整 Git bundle、Docker/反向代理配置样本和 SHA-256 清单。`git bundle verify` 已通过。

## 恢复原则

1. 恢复前先停止写流量，并再次备份待替换目标。
2. 校验 `SHA256SUMS`，再读取归档。
3. 镜像回滚使用已保存镜像并恢复原容器参数，不重新构建同名标签。
4. PostgreSQL 只恢复到空库或已明确备份的目标库，禁止对未知库直接 `--clean`。
5. MinIO 恢复前停止 MinIO，并再次验证目标路径严格位于对应数据卷。
6. 恢复后依次验证健康接口、登录、画布读取和旧资产，不先开放写流量。

第 0 部分不执行恢复演练；完整停机恢复演练安排在第 8 部分。

