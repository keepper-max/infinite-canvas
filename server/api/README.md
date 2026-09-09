# 平台 API

平台 API 负责邮箱账号、服务端 Session、项目成员权限和默认草稿空间。浏览器只持有 HttpOnly Cookie，不保存 Session Token 明文。

## 迁移

API 启动时会按文件名顺序执行 `db/migrations` 中尚未应用的 SQL，并把文件名及 SHA-256 写入 `platform_schema_migrations`。已经应用的迁移不得修改；校验和变化时服务会拒绝启动。

`0006_platform_api_auth.sql` 是增量迁移：保留原有业务表和数据，补齐默认项目字段、项目成员关系和每项目唯一画布记录。生产执行前必须再次完成 PostgreSQL 全库备份。

## 回滚

推荐恢复部署前的完整数据库备份，这是包含数据状态的可靠回滚路径。仅需撤回本次新增结构时，可在确认备份有效后手动执行 `db/rollback/0006_platform_api_auth.down.sql`。

回滚脚本会删除 `canvases` 表及本次新增的项目字段和索引，因此不得由应用自动执行，也不能在没有新备份时直接运行。

## 本地检查

```bash
npm run typecheck
npm test
npm run build
```

设置独立测试库的 `TEST_DATABASE_URL` 后，测试会额外执行真实 PostgreSQL 迁移、Session 持久化、默认项目幂等和跨用户项目隔离检查。
