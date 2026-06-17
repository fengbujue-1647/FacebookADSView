# 账号管理与安全加固计划

本文档用于规划本项目的账号管理系统和基础安全防护改造。当前目标是区分管理员和普通用户，并降低本地看板在多人访问或局域网/远程暴露时被未授权访问、误操作或跨站请求攻击的风险。

## 1. 当前基线

当前 Web 服务由 `src/server.js` 使用 Node 原生 `http` 分发静态文件和 API。代码里暂时没有登录、会话、角色校验和 CSRF 校验。

高风险接口包括：

- `/api/settings/environment`：读取和保存 `.env` 配置状态。
- `/api/settings/accounts`：读取和保存监控广告账户。
- `/api/settings/sampling`：读取和保存采样/监控计划。
- `/api/settings/resources/refresh`：触发 ACTIVE 资源刷新。
- `/api/collection/queue/run`：投递并运行采集任务。
- `/api/collection/queue/recover`：诊断和恢复采集队列。
- `/api/collection/queue/runs/:id`：删除采集批次记录。
- `/api/alert-ai/templates*`：创建、修改、复制、删除或启停预警模板。
- `/api/alert-ai/alerts/evaluate`：手动评估并推送预警。
- `/api/alert-ai/reports/stream`：生成 AI 分析报告。

结论：前端菜单隐藏不能作为权限控制，必须在服务端每个 API 入口做认证和授权。

## 2. 总体目标

1. 增加登录系统，支持管理员和普通用户。
2. 普通用户只能查看被分配的广告账户数据，不能修改系统配置或运行采集任务。
3. 管理员可以管理用户、权限、配置、采集队列、预警模板和系统安全项。
4. 所有写操作必须经过 session、角色权限和 CSRF 校验。
5. 关键操作写入审计日志，方便追踪谁在什么时间改了什么。
6. 不提交 `.env`、SQLite 运行库、采集输出、截图、日志、token cache 等敏感或临时文件。
7. 匿名状态不开放任何业务 API；除登录入口外，最多只保留一个极简健康检查 API。

## 3. 前端新增内容规模估算

以下为按当前原生 HTML/CSS/JS 架构估算的新增量。实际行数会随 UI 精简程度变化。

| 文件 | 预计新增/修改量 | 内容 |
| --- | ---: | --- |
| `public/index.html` | 80-150 行 | 登录视图或登录弹窗、顶部用户信息、退出按钮、受权限控制的导航标记。 |
| `public/styles.css` | 120-260 行 | 登录页/弹窗样式、用户菜单、权限禁用态、401/403 状态提示。 |
| `public/app.js` | 260-520 行 | `apiFetch` 封装、登录态初始化、CSRF 自动注入、权限控制菜单、退出登录、401/403 统一处理。 |
| `public/alert-ai.js` | 80-180 行 | 预警模板编辑按钮按权限隐藏/禁用，AI 报告接口使用统一请求封装。 |
| 可能新增 `public/auth.js` | 180-320 行 | 如果不想继续扩大 `app.js`，可抽出认证客户端模块。 |

前端合计预计 540-1,430 行。推荐控制在 800 行以内，优先通过统一请求封装减少重复改动。

## 4. 后端新增内容规模估算

| 文件 | 预计新增/修改量 | 内容 |
| --- | ---: | --- |
| 新增 `src/authStore.js` | 350-650 行 | 创建认证库表、用户 CRUD、密码哈希、session 存取、审计日志。 |
| 新增 `src/auth.js` | 300-600 行 | Cookie 解析、session 校验、CSRF 校验、权限判断、限速工具。 |
| 修改 `src/server.js` | 350-700 行 | 认证路由、统一 API 守卫、路由权限表、数据范围传递、安全响应头。 |
| 修改 `src/database.js` | 180-360 行 | 增加 `allowedAccountIds` 过滤，避免普通用户越权读取其他账户数据。 |
| 新增 `cli/src/authCli.js` 或 `scripts/create-admin.js` | 100-220 行 | 首个管理员创建、重置密码、禁用用户等本机命令。 |
| 修改 `package.json` | 5-20 行 | 增加 `auth:create-admin`、`auth:reset-password` 等脚本。 |
| 修改 `README.md` | 80-160 行 | 账号初始化、权限模型、安全部署和验证命令。 |

后端合计预计 1,365-2,710 行。若先做最小可用版本，建议先实现登录、角色、CSRF、关键 API 权限和账户范围过滤，用户管理页面可放到第二阶段。

## 5. 推荐数据设计

推荐独立认证库：

```text
data/auth.sqlite
```

认证库不提交 Git，不和广告采集库混用。

核心表：

```text
users(
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  password_alg TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT NOT NULL DEFAULT '',
  password_changed_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL DEFAULT ''
)

user_account_scopes(
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  PRIMARY KEY(user_id, account_id)
)

sessions(
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  csrf_token_hash TEXT NOT NULL,
  user_agent_hash TEXT NOT NULL DEFAULT '',
  ip_prefix TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT NOT NULL DEFAULT ''
)

audit_events(
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  user_agent_hash TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
)
```

如果后续坚持不独立做库，也可以把这些表放进 `cli/data/fb-ads.sqlite`，但需要额外保证认证表不参与广告数据导出、不被采集库重建覆盖、CLI 采集逻辑不操作认证表。

## 6. 角色和权限设计

权限命名建议：

```text
dashboard.read
alerts.read
alerts.manage
reports.read
reports.generate
settings.read
settings.write
env.read
env.write
resources.refresh
collection.read
collection.run
collection.recover
collection.delete
users.manage
audit.read
```

角色映射：

| 权限 | 管理员 | 普通用户 |
| --- | --- | --- |
| `dashboard.read` | 是 | 是 |
| `alerts.read` | 是 | 是 |
| `reports.read` | 是 | 是 |
| `reports.generate` | 是 | 是 |
| `alerts.manage` | 是 | 否 |
| `settings.read` | 是 | 否 |
| `settings.write` | 是 | 否 |
| `env.read` | 是 | 否 |
| `env.write` | 是 | 否 |
| `resources.refresh` | 是 | 否 |
| `collection.read` | 是 | 否，或只读可选 |
| `collection.run` | 是 | 否 |
| `collection.recover` | 是 | 否 |
| `collection.delete` | 是 | 否 |
| `users.manage` | 是 | 否 |
| `audit.read` | 是 | 否 |

普通用户必须绑定 `user_account_scopes`。当普通用户没有任何账户范围时，默认返回空数据，而不是返回全部数据。

## 7. API 权限规划

匿名访问原则：

- 匿名用户不允许访问任何广告数据、配置数据、预警数据、AI 报告数据或采集队列数据。
- `/api/auth/login` 是认证入口，必须允许未登录调用，但它不返回业务数据。
- `/api/auth/me` 未登录时只返回 401，不返回用户、权限或系统配置。
- `/api/health` 是唯一可选匿名健康检查接口；对外只返回 `ok/module/time` 这类最少信息，不返回配置、路径、版本细节、采集状态或错误堆栈。
- 如果后续部署到公网或共享网络，`/api/health` 也建议改为仅本机可访问，或要求哨兵专用 token。

| API | 方法 | 权限 | 备注 |
| --- | --- | --- | --- |
| `/api/auth/login` | POST | 匿名认证入口 | 校验密码，创建 session 和 CSRF token；不返回业务数据。 |
| `/api/auth/logout` | POST | authenticated | 撤销当前 session。 |
| `/api/auth/me` | GET | authenticated | 已登录时返回用户、权限、CSRF token；未登录只返回 401。 |
| `/api/health` | GET | 匿名健康检查或本机/哨兵 token | 唯一可选匿名 API；只返回最少健康信息。 |
| `/api/fb-ads/latest` | GET | `dashboard.read` | 普通用户必须按 `account_id` 过滤。 |
| `/api/monitor/status` | GET | `collection.read` 或 admin | 普通用户建议不可见。 |
| `/api/settings/environment` | GET | `env.read` | 不返回密钥明文。 |
| `/api/settings/environment` | POST | `env.write` | 必须 CSRF 和审计。 |
| `/api/settings/accounts` | GET | `settings.read` | 管理员。 |
| `/api/settings/accounts` | POST | `settings.write` | 管理员。 |
| `/api/settings/sampling` | GET | `settings.read` | 管理员。 |
| `/api/settings/sampling` | POST | `settings.write` | 管理员。 |
| `/api/settings/resources` | GET | `settings.read` | 管理员。 |
| `/api/settings/resources/refresh` | POST | `resources.refresh` | 管理员。 |
| `/api/collection/queue/status` | GET | `collection.read` | 管理员，或只读管理员助理。 |
| `/api/collection/queue/preview` | POST | `collection.run` | 管理员。 |
| `/api/collection/queue/run` | POST | `collection.run` | 管理员。 |
| `/api/collection/queue/recover` | POST | `collection.recover` | 管理员。 |
| `/api/collection/queue/runs/:id` | DELETE | `collection.delete` | 管理员。 |
| `/api/alert-ai/metadata` | GET | `alerts.read` | 可普通用户。 |
| `/api/alert-ai/entities` | GET | `reports.generate` | 普通用户按账户范围过滤。 |
| `/api/alert-ai/templates` | GET | `alerts.read` | 普通用户只读。 |
| `/api/alert-ai/templates*` | POST/PUT/PATCH/DELETE | `alerts.manage` | 管理员。 |
| `/api/alert-ai/alerts/messages` | GET | `alerts.read` | 普通用户按账户范围过滤，若消息没有 account_id 需补字段或只给管理员。 |
| `/api/alert-ai/alerts/evaluate` | POST | `alerts.manage` | 管理员。 |
| `/api/alert-ai/reports` | GET | `reports.read` | 普通用户按账户范围过滤。 |
| `/api/alert-ai/reports/stream` | POST | `reports.generate` | 普通用户请求的 entityIds 必须落在账户范围内。 |
| `/api/admin/users*` | 全部 | `users.manage` | 管理员用户管理。 |
| `/api/admin/audit-events` | GET | `audit.read` | 管理员。 |

## 8. 后端具体修改方案

### 8.1 新增认证存储层

新增 `src/authStore.js`：

- 初始化 `data/auth.sqlite`。
- 创建用户、更新用户、禁用用户、重置密码。
- 使用 `crypto.scrypt` 生成密码哈希。
- 校验密码时使用 `crypto.timingSafeEqual`。
- 创建 session，数据库只保存 session id 的哈希。
- 创建并校验 CSRF token。
- 写入审计事件。
- 清理过期 session。

首个管理员不从网页创建，使用 CLI：

```bash
npm run auth:create-admin -- --username admin
```

### 8.2 新增认证和授权工具

新增 `src/auth.js`：

- `parseCookies(req)`。
- `readClientIp(req)`。
- `getCurrentUser(req)`。
- `requireAuth(req, res)`。
- `requirePermission(req, res, permission)`。
- `requireCsrf(req, res)`。
- `writeAuthError(res, statusCode, code)`。
- `withSecurityHeaders(headers)`。
- 登录限速：按 IP + username 计数，连续失败锁定。

### 8.3 改造 `src/server.js`

建议在创建 `url` 后、进入 API 分发前做统一处理：

1. 为所有响应加基础安全响应头。
2. 静态资源允许匿名访问，但只用于加载登录界面和前端脚本，不包含业务数据。
3. `/api/auth/login` 允许匿名访问，但它只是认证入口，不算业务 public API。
4. `/api/health` 可匿名访问时只能返回最小健康状态；也可以配置为仅本机或哨兵 token 可访问。
5. `/api/auth/me` 要求已登录；未登录只返回 401。
6. 其他所有 `/api/*` 必须先认证，未登录一律返回 401。
7. 对 `POST/PUT/PATCH/DELETE` 校验 CSRF。
8. 根据路由权限表校验权限。
9. 将 `req.authUser`、`req.permissions`、`req.allowedAccountIds` 传给实际 handler。

推荐引入路由策略表，避免每个分支手写不同逻辑：

```js
const routePolicies = [
  { method: "GET", pattern: /^\/api\/fb-ads\/latest$/, permission: "dashboard.read" },
  { method: "POST", pattern: /^\/api\/collection\/queue\/run$/, permission: "collection.run", csrf: true },
  { method: "POST", pattern: /^\/api\/settings\/environment$/, permission: "env.write", csrf: true }
];
```

### 8.4 数据范围过滤

修改 `src/database.js` 中读数据的函数，增加 `allowedAccountIds`：

- `readLatestInsightData({ allowedAccountIds })`
- `readAnalysisEntityOptions({ allowedAccountIds })`
- `readInsightRowsForAnalysis({ allowedAccountIds })`

普通用户所有 SQL 增加：

```sql
AND account_id IN (?, ?, ...)
```

管理员不传限制，保持现有行为。

### 8.5 审计日志

必须记录：

- 登录成功。
- 登录失败。
- 登出。
- 权限拒绝。
- 修改 `.env`。
- 修改监控账户。
- 修改采样计划。
- 刷新 ACTIVE 资源。
- 投递采集任务。
- 诊断/恢复采集队列。
- 删除采集批次。
- 创建/修改/删除/启停预警模板。
- 手动评估并推送预警。
- 创建/禁用用户、重置密码、修改角色。

审计日志不能记录：

- 明文密码。
- session id。
- CSRF token。
- API key、client secret、webhook 完整 URL。
- DeepSeek key。

## 9. 前端具体修改方案

### 9.1 统一请求封装

新增或内置 `apiFetch()`：

- 自动带 `X-CSRF-Token`。
- 自动处理 JSON。
- 401 时显示登录。
- 403 时显示“无权限”并阻止继续操作。
- 非 GET 请求统一加 `Content-Type: application/json`。

示例：

```js
async function apiFetch(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = {
    ...(options.headers || {})
  };
  if (method !== "GET" && method !== "HEAD") {
    headers["X-CSRF-Token"] = state.auth.csrfToken;
  }
  const response = await fetch(url, {
    ...options,
    headers,
    credentials: "same-origin"
  });
  if (response.status === 401) {
    showLogin();
    throw new Error("请先登录");
  }
  if (response.status === 403) {
    throw new Error("当前账号没有权限执行该操作");
  }
  return response;
}
```

### 9.2 登录态初始化

应用启动时先调用：

```text
GET /api/auth/me
```

返回：

```json
{
  "ok": true,
  "user": {
    "id": "...",
    "username": "admin",
    "displayName": "管理员",
    "role": "admin"
  },
  "permissions": ["dashboard.read", "settings.write"],
  "csrfToken": "..."
}
```

未登录则显示登录视图，不加载敏感 API。

### 9.3 菜单和按钮权限

普通用户隐藏或禁用：

- 设置页入口。
- 任务进度入口，除非后续允许只读。
- 保存设置。
- 刷新 ACTIVE 资源。
- 投递并运行采集。
- 诊断/恢复。
- 删除采集批次。
- 预警模板新增、复制、编辑、删除、启停。
- 手动评估预警。
- 用户管理入口。

注意：隐藏只是体验，服务端仍必须拒绝。

### 9.4 错误提示

建议统一提示：

- 401：登录已过期，请重新登录。
- 403：当前账号没有权限执行该操作。
- 419 或自定义 `csrf_invalid`：页面安全令牌已失效，请刷新后重试。
- 429：请求过于频繁，请稍后再试。

## 10. 可能的错误点

### 10.1 Cookie 和本地环境

- 本地 `http://localhost:3100` 不能使用 `Secure` Cookie，否则浏览器不会发送 Cookie。
- 远程 HTTPS 部署必须开启 `Secure` Cookie。
- `localhost` 和 `127.0.0.1` 是不同站点上下文，登录到一个地址后访问另一个地址可能没有 Cookie。
- `SameSite=Strict` 更安全，但某些外部跳转场景可能影响登录后返回；本项目优先用 `Lax` 或 `Strict` 都可以。

### 10.2 CSRF

- 登录后刷新页面，如果前端没有重新调用 `/api/auth/me`，CSRF token 可能为空。
- 修改密码、修改角色、重新登录后要刷新 session 和 CSRF token。
- 如果多个标签页同时打开，退出登录后其他标签页的写请求应返回 401。
- 不要把 CSRF token 放进 URL，避免进入日志和浏览器历史。

### 10.3 权限判断

- 不能只按前端菜单判断权限。
- 新增 API 时容易忘记加路由策略，因此必须默认拒绝未知 `/api/*` 路由。
- 普通用户没有账户范围时必须返回空结果，不要 fallback 到全部账户。
- 管理员和普通用户都要经过认证，只是管理员账户范围不受限。

### 10.4 数据过滤

- `/api/fb-ads/latest` 如果只在前端过滤，会泄露全部账户数据。
- 分析实体搜索必须按 `account_id` 过滤，否则可以通过搜索猜到其他账户的 campaign/ad 名称。
- AI 报告请求里的 `entityIds` 必须二次校验归属账户，不能信任前端传参。
- 预警消息和报告历史如果当前数据结构没有 `account_id`，需要补字段或普通用户不可见。

### 10.5 SQLite 和并发

- 采集库高频写入时，如果认证表放同一个 SQLite，登录和审计可能被锁影响。
- 独立 `auth.sqlite` 可以降低锁冲突，但仍需设置 `busy_timeout`、WAL 和 retry。
- 审计写入失败不能导致主要业务崩溃，但关键权限拒绝和配置修改应尽量保证可记录。

### 10.6 密码和 session

- 不能存明文密码。
- 不能用 SHA256/MD5 直接存密码。
- 不能把 session id 原文写入数据库或日志。
- 密码校验要用恒定时间比较，避免时序侧信道。
- 登录失败提示不能区分“用户名不存在”和“密码错误”。

### 10.7 安全响应头

- CSP 太严会导致现有内联逻辑、ECharts 或动态样式异常；需要先用 Report-Only 或逐步收紧。
- `X-Frame-Options` 或 `frame-ancestors` 会影响嵌入场景；本项目默认不允许被嵌入。
- 静态资源 cache header 不要缓存登录态 JSON。

### 10.8 前端改造

- 现有 `fetch()` 分散在 `public/app.js` 和 `public/alert-ai.js`，漏改会导致没有 CSRF header。
- 如果先初始化图表再确认登录，会短暂请求敏感接口。
- 普通用户隐藏设置页后，直接访问已有 DOM 或手动调用 API 仍要被后端拒绝。
- 401 自动弹登录时，不要重复触发多个登录弹窗。

### 10.9 运维部署

- 如果把 `HOST` 改为 `0.0.0.0`，局域网其他机器可以访问，必须先启用登录。
- 如果公网访问，必须使用 HTTPS 反向代理，不要裸露 Node 服务端口。
- Windows Service 运行账号权限过大时，Web 漏洞可能扩大到本机文件系统。

## 11. 最重要的注意事项

1. 服务端默认拒绝，任何新 API 没有明确权限策略就返回 403。
2. 匿名用户不开放业务 API；除 `/api/auth/login` 外，最多只保留 `/api/health` 作为极简健康检查。
3. 普通用户的数据隔离必须在 SQL/服务端完成，不能依赖前端过滤。
4. 所有写操作必须同时满足登录、权限和 CSRF 校验。
5. 密码只存慢哈希，session 只存哈希，不写日志。
6. 不要通过网页创建首个管理员，使用本机 CLI 初始化。
7. 管理员操作 `.env`、采集队列、预警推送必须写审计日志。
8. 远程访问必须 HTTPS，Cookie 才能安全使用 `Secure`。
9. 不提交 `data/auth.sqlite`、`.env`、日志、截图、采集输出和 token cache。

## 12. 分阶段实施计划

### 阶段 1：认证基础

- 新增认证库和表结构。
- 新增管理员创建 CLI。
- 实现登录、登出、`/api/auth/me`。
- 实现 Cookie session。
- 实现密码哈希和登录失败锁定。

验收：

- 可以通过 CLI 创建管理员。
- 未登录访问 `/api/auth/me` 返回 401。
- 登录成功后返回用户、权限和 CSRF token。
- 退出后旧 session 失效。

### 阶段 2：服务端权限网关

- 增加统一 API 认证入口。
- 增加路由权限表。
- 写操作增加 CSRF 校验。
- 管理员专属接口加权限。
- 未覆盖 API 默认拒绝。

验收：

- 未登录访问 `/api/fb-ads/latest` 返回 401。
- 未登录访问 `/api/settings/environment` 返回 401。
- 普通用户访问 `/api/settings/environment` 返回 403。
- 管理员访问同接口成功。
- 缺少 CSRF token 的 POST 返回 403 或 `csrf_invalid`。
- 匿名状态下，除 `/api/auth/login` 和可选 `/api/health` 外，任何 `/api/*` 都不能返回业务数据。

### 阶段 3：账户范围隔离

- 给数据读取函数增加 `allowedAccountIds`。
- 普通用户看板数据按账户过滤。
- 分析实体和报告生成按账户过滤。
- 预警消息和报告历史补账户字段，或限制为管理员可见。

验收：

- 普通用户只能看到分配账户的数据。
- 手动传入其他账户 entity id 时报告接口拒绝。
- 普通用户无账户范围时返回空数据。

### 阶段 4：前端登录和权限体验

- 新增登录界面。
- 初始化时调用 `/api/auth/me`。
- 改造所有 fetch 为 `apiFetch`。
- 根据权限隐藏或禁用菜单和按钮。
- 增加用户信息和退出登录。

验收：

- 未登录时不加载敏感数据接口。
- 登录后看板正常加载。
- 普通用户看不到设置/运行采集入口。
- 登录过期时自动提示重新登录。

### 阶段 5：审计与安全头

- 写入关键操作审计日志。
- 增加 `/api/admin/audit-events`。
- 增加安全响应头。
- 增加基础登录限速。

验收：

- 修改配置后可以在审计日志看到操作记录。
- 连续登录失败会被临时锁定。
- 响应头包含基础安全头。

### 阶段 6：文档和回归检查

- 更新 `README.md`。
- 补充账号初始化、权限说明、安全部署说明。
- 补充验证命令。

验收：

- `node --check src/server.js`
- `node --check src/auth.js`
- `node --check src/authStore.js`
- `node --check public/app.js`
- `node --check public/alert-ai.js`
- 浏览器手动验证管理员和普通用户路径。

## 13. 建议验证清单

接口验证：

```powershell
Invoke-RestMethod http://127.0.0.1:3100/api/health
Invoke-WebRequest "http://127.0.0.1:3100/api/fb-ads/latest?shape=dashboard"
Invoke-WebRequest http://127.0.0.1:3100/api/settings/environment
```

预期：健康检查只返回最小状态；未登录时看板数据接口和设置接口都返回 401。

管理员验证：

- 登录管理员。
- 打开设置页。
- 保存监控账户。
- 刷新 ACTIVE 资源。
- 投递采集预览和运行。
- 查看审计日志。

普通用户验证：

- 登录普通用户。
- 看图表和列表。
- 尝试直接请求设置接口，必须 403。
- 尝试生成不属于自己账户的报告，必须拒绝或返回空。
- 缺少 CSRF token 的写请求必须失败。

安全验证：

- 连续输错密码触发锁定。
- 登出后旧页面再点保存应返回 401。
- 从另一个标签页退出后，当前标签页写操作失败。
- `.env` 明文、session id、CSRF token 不出现在响应、日志或审计 metadata 中。

## 14. 未完成事项和风险

- 本文档是计划，不包含代码实现。
- 当前项目前端脚本文本较集中，改造 fetch 时容易漏点，需要用 `rg "fetch\\(" public src` 全量检查。
- 普通用户查看预警消息和报告历史需要数据结构支持账户范围；若短期不补字段，应先限制为管理员可见。
- 如果未来要公网访问，需要额外做 HTTPS 反代、访问来源限制、备份加密和更严格的密码策略。
- 如果要求连登录接口都不匿名开放，就需要改成外层反向代理认证、VPN、Basic Auth 或客户端证书；否则网页本身无法完成账号密码登录。
