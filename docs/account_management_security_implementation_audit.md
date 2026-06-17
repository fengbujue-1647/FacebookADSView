# 账号管理与安全加固实现审计

审计日期：2026-06-16

对应计划：`docs/account_management_security_plan.md`

## 结论

本次已实现账号登录、管理员/普通用户角色区分、服务端 API 权限网关、CSRF 校验、账户范围过滤、审计日志、安全响应头、前端登录态和权限隐藏。匿名状态下不开放业务 API；除认证入口 `/api/auth/login` 外，仅保留极简健康检查 `/api/health`。

## 实现证据

| 计划目标 | 状态 | 实现证据 |
| --- | --- | --- |
| 独立认证存储 | 已完成 | 新增 `src/authStore.js`，认证数据写入 `data/auth.sqlite`，与采集库分离。 |
| 管理员创建 CLI | 已完成 | `package.json` 增加 `auth:create-admin`、`auth:reset-admin-password`；实现位于 `scripts/create-admin.js`。 |
| 密码慢哈希 | 已完成 | `src/authStore.js` 使用 `crypto.scryptSync`、随机 salt、`timingSafeEqual`。 |
| Session 只存哈希 | 已完成 | session id 只以 SHA-256 哈希写入 `sessions.id_hash`。 |
| CSRF token | 已完成 | 登录创建 CSRF token；非 GET/HEAD/OPTIONS 写操作统一校验 `X-CSRF-Token`。 |
| 管理员/普通用户权限 | 已完成 | `src/authStore.js` 定义角色权限；`src/auth.js` 在网关校验权限。 |
| 匿名不开放业务 API | 已完成 | `src/server.js` 对未知或未授权 `/api/*` 默认拒绝；未登录业务 API 返回 401。 |
| 账户范围隔离 | 已完成 | `src/database.js` 增加 `allowedAccountIds` SQL 过滤；普通用户空账户范围返回空数据。 |
| 预警/报告范围控制 | 已完成 | 预警消息、模板、报告带 `account_ids/accountIds`；普通用户只看命中自己账户范围的历史记录。旧记录无账户字段时普通用户不可见。 |
| 审计日志 | 已完成 | 认证、权限拒绝、用户管理、配置、采集、预警、报告生成等关键操作写入 `audit_events`。 |
| 安全响应头 | 已完成 | 所有 JSON 和静态响应统一加 CSP、`X-Frame-Options`、`X-Content-Type-Options`、`Referrer-Policy`、`Permissions-Policy`。 |
| 前端登录态 | 已完成 | `public/app.js` 增加登录遮罩、`/api/auth/me` 初始化、退出登录、401/403 处理。 |
| 前端 CSRF 无感 | 已完成 | `public/app.js` 的 `apiFetch` 对写操作自动注入 `X-CSRF-Token`；`public/alert-ai.js` 复用该封装。 |
| 前端权限体验 | 已完成 | 普通用户隐藏设置、采集任务、预警管理按钮；服务端仍做最终拒绝。 |
| 缓存更新 | 已完成 | `public/index.html` 更新 `styles.css`、`app.js`、`alert-ai.js` 版本号，避免浏览器继续使用旧脚本。 |
| 使用文档 | 已完成 | `README.md` 增加账号和安全说明、管理员创建命令、安全验证示例。 |

## 阶段验收

| 阶段 | 验收项 | 结果 |
| --- | --- | --- |
| 阶段 1：认证基础 | CLI 创建管理员 | 已通过：`npm.cmd run auth:create-admin -- --username codex-admin-test --password ...` 可创建管理员。 |
| 阶段 1：认证基础 | 登录返回用户、权限和 CSRF token | 已通过：`POST /api/auth/login` 返回 `ok=true` 和 `csrfToken`。 |
| 阶段 1：认证基础 | 退出后旧 session 失效 | 已通过：`POST /api/auth/logout` 后，同一 cookie 调 `/api/auth/me` 返回 401。 |
| 阶段 2：服务端权限网关 | 未登录业务 API 返回 401 | 已通过：未登录访问 `/api/fb-ads/latest?shape=dashboard` 和 `/api/settings/environment` 均返回 401。 |
| 阶段 2：服务端权限网关 | 未覆盖 API 默认拒绝 | 已通过：未登录访问 `/api/not-open` 返回 403 `api_route_forbidden`。 |
| 阶段 2：服务端权限网关 | 普通用户访问设置返回 403 | 已通过：普通用户访问 `/api/settings/environment` 返回 403。 |
| 阶段 2：服务端权限网关 | 管理员访问设置成功 | 已通过：管理员访问 `/api/settings/environment` 返回 200。 |
| 阶段 2：服务端权限网关 | 缺少 CSRF 的写请求失败 | 已通过：管理员 POST `/api/settings/sampling` 不带 CSRF 返回 403。 |
| 阶段 3：账户范围隔离 | 普通用户只能看分配账户 | 已实现：服务端 SQL 和历史记录按账户过滤。 |
| 阶段 3：账户范围隔离 | 普通用户无账户范围返回空数据 | 已通过：空账户普通用户访问 `/api/fb-ads/latest?shape=dashboard` 返回 `ok=true` 且 `rows=[]`。 |
| 阶段 4：前端登录和权限体验 | 未登录显示登录界面 | 已通过：浏览器未登录显示登录遮罩。 |
| 阶段 4：前端登录和权限体验 | 管理员登录后进入看板 | 已通过：浏览器管理员登录后显示用户条和完整导航。 |
| 阶段 4：前端登录和权限体验 | 普通用户看不到设置/运行采集入口 | 已通过：浏览器普通用户登录后 `settings`、`tasks` 导航为隐藏。 |
| 阶段 4：前端登录和权限体验 | 普通用户看不到预警管理按钮 | 已通过：预警页“新建模板”“立即评估”为隐藏。 |
| 阶段 5：审计与安全头 | 关键操作可进入审计日志 | 已通过：管理员创建用户后，`/api/admin/audit-events` 可查到 `users.create`。配置类写路径已接入同一 `audit()` 机制。 |
| 阶段 5：审计与安全头 | 响应带安全头 | 已通过：`/api/health` 响应包含 CSP、`X-Frame-Options=DENY`、`X-Content-Type-Options=nosniff` 等。 |
| 阶段 6：文档和回归检查 | 文档更新 | 已完成：`README.md` 和本审计文档已更新。 |
| 阶段 6：文档和回归检查 | 浏览器手动验证管理员和普通用户路径 | 已通过：应用内浏览器完成管理员登录、退出、普通用户登录、权限隐藏检查。 |

## 已执行验证

语法检查：

```text
node --check src/authStore.js
node --check src/auth.js
node --check src/database.js
node --check src/server.js
node --check public/app.js
node --check public/alert-ai.js
node --check scripts/create-admin.js
```

接口验收摘要：

```json
{
  "health_ok": true,
  "health_keys": "module,ok,time",
  "unauth_latest_status": 401,
  "unauth_settings_status": 401,
  "unknown_api_status": 403,
  "admin_login_ok": true,
  "admin_latest_status": 200,
  "admin_settings_status": 200,
  "csrf_rejected_status": 403,
  "created_user_role": "user",
  "user_settings_status": 403,
  "scoped_user_latest_ok": true,
  "scoped_user_latest_rows": 0
}
```

退出和审计验收摘要：

```json
{
  "login_ok": true,
  "created_user_ok": true,
  "audit_events_status": true,
  "audit_has_user_create": true,
  "logout_ok": true,
  "me_after_logout_status": 401
}
```

安全响应头验收摘要：

```json
{
  "status": 200,
  "x_content_type_options": "nosniff",
  "x_frame_options": "DENY",
  "referrer_policy": "same-origin",
  "permissions_policy": "geolocation=(), microphone=(), camera=()",
  "content_security_policy": "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors 'none'"
}
```

浏览器验收摘要：

- 未登录：显示登录遮罩。
- 管理员：登录后显示 `Codex Admin 管理员 退出`，设置、采集、预警、分析入口可见。
- 普通用户：登录后显示 `Codex User 用户 退出`，设置和任务进度入口隐藏。
- 普通用户预警页：`新建模板`、`立即评估` 管理按钮隐藏。
- 浏览器控制台：管理员和普通用户路径未发现 error 级日志。

## 剩余风险和明确边界

1. `/api/auth/login` 仍然必须允许匿名调用，因为网页账号密码登录需要认证入口；它不返回业务数据，不计入业务 public API。
2. 旧的预警模板、预警消息和报告如果没有账户字段，普通用户默认不可见；本次没有做历史数据迁移，避免误判归属账户。
3. 本次实现了 `/api/admin/users*` 用户管理 API 和本机 CLI，但没有新增单独的用户管理前端页面；需要图形化管理时可在后续版本补 UI。
4. HTTPS、反向代理、VPN、`AUTH_COOKIE_SECURE=1` 属于部署侧配置；代码已支持安全 Cookie 开关和反向代理协议头，但本地 HTTP 验收不会开启 Secure Cookie。
5. 为避免改动本机真实 `.env` 和采集配置，本轮没有执行真实配置写入验收；配置、账户、采样、资源刷新写路径已在代码中接入同一审计函数，审计存储通过用户创建操作完成运行时验证。
6. `data/auth.sqlite` 是本地运行数据，本轮临时验收库已删除；正式启用前需要重新执行管理员创建命令。
