# 安全检查发现

- 密码使用 Argon2id；会话使用随机 32 字节令牌，数据库存 SHA-256。
- Cookie 代码设置 HttpOnly、SameSite=Lax；Secure 取决于环境，尚未核验运行配置。
- unsafe API 请求检查来源；验证码 Redis 原子限流与一次性消费已实现。
- 项目访问代码采用成员角色检查和参数化查询；仍需复核各调用路径。
- 待核查：密码登录限流、代理头可信边界、媒体代理与上传对象隔离。
- 线上未登录请求 /api/auth/me、/api/admin/users、/api/admin/providers、/api/projects、/api/billing/account 均返回 401；媒体代理也返回 401。
- 外站 Origin 和 cross-site 元数据的空密码登录请求均被 403 UNTRUSTED_ORIGIN 拒绝。
- /.env、/.git/config、/server/api/.env 返回与首页同大小的 SPA HTML，不是配置文件泄露。/config.js 仅 31 字节。
- 首页 HSTS、CSP、X-Frame-Options=DENY、nosniff 均存在。
- 两个密码登录入口当前直接查用户并校验密码，尚未发现应用层失败限流。线上未做重复尝试，不能断言外围无 WAF。
- clientIp 优先信任 cf-connecting-ip、x-real-ip，其次 X-Forwarded-For 首项；仓库内 nginx 仅追加 X-Forwarded-For，生产外层是否清洗这些头尚未核验。
- 上传契约接受任意 image/*（包括 SVG），完成阶段仅核对对象大小、声明 MIME 和自报 SHA 元数据；媒体接口同域返回原 MIME。需确认主动内容隔离，不在生产上传测试载荷。
- 任务 references.url 只验证 HTTP(S) 协议；RunningHub 上传参考素材时直接 fetch URL，未见私网或重定向检查。准备本地拦截网络的无害验证。

## 本地无害验证结果
- 两个密码入口各 12 次不存在的测试账号失败，全部 401 且 24 次都进入查询，无 429。仅证明应用层缺少限流，不证明线上外围防护缺失。
- createJobSchema 接受回环 HTTP 地址；RunningHubProvider.uploadReference 会把该地址传给 fetch。fetch 被本地替身拦截，真实网络请求为零。已确认危险取址原语；能否在线利用取决于启用模型、账户额度和网络边界。
- beginAssetUploadSchema 接受 image/svg+xml；使用假会话和假存储的媒体接口原 MIME 返回 SVG，未加 CSP 或 Content-Disposition。没有生产上传或浏览器脚本执行验证，因此标记潜在存储型 XSS，而不是已攻破管理员账号。

## 加固实现中的决定
- 用户已确认最终阈值，密码与验证码校验共享 IP 失败冷却；发送与校验账户计数分开，保留旧发送间隔/日额度。
- Redis sorted sets 保存滑动窗口与并发占位；真正失败单独计数，避免并发成功请求误触发三小时冷却。成功/非凭据业务错误释放占位。
- 仅可信私网/回环 socket 对端允许使用 XFF，从右侧取最近公网地址；忽略用户提供的 CF/X-Real-IP 和左侧伪造值。API 不得绕过代理公开，公网入口必须追加/覆盖真实来源。
- 公共媒体连接使用 undici 连接器校验实际 DNS 地址，IP 解析交给 ipaddr.js；已有对象存储读取不受该过滤影响。返回的生成媒体下载也使用同一检查。
- CSP 同时放到 API 和边缘缓存响应，覆盖旧缓存；保留媒体显示与下载，不迁移或删除素材。对象存储临时链接默认附件，避免绕过同域媒体接口隔离。
