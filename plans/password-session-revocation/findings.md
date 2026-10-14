# 初步发现

- repository.updatePasswordAndRevokeSessions 支持 keepTokenHash，可能保留当前会话，需追踪调用。
- 修改密码弹窗成功后仅关闭并提示，未显式清理当前前端登录态。
- 前端鉴权 provider 不在 components/auth/auth-provider.tsx，需通过文件搜索定位，不猜路径。
- 根因已确认：password/change 显式传当前 tokenHash 保留当前会话，现有测试也断言当前 Cookie 仍有效；密码重置本来已撤销全部会话。
- AuthGate 原先仅挂载检查，不响应平台 UNAUTHENTICATED；修复采用共享失效清理、特定 401 事件和 focus/visibility 核验，不引入定时轮询，不将错误密码、403、网络错误当失效。
