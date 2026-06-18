# FB 广告数据看板

本仓库是一个本地运行的 Facebook 广告监控看板。服务端优先读取 `cli/data/fb-ads.sqlite` 中的真实采集数据；如果 SQLite 没有可用批次，再回退到 `cli/data/output/` 的最新非空 JSON；两者都没有时才使用前端 Demo 数据。

## 当前页面

- 首页入口 `/`：当前是轻量入口页，为后续 cloudflared 域名开屏首页预留结构，不加载业务数据 API。
- 平台登录 `/login`：统一登录入口，可通过 `return` 参数回到工作台或具体业务模块；静态兼容路径为 `/login.html`。
- 平台工作台 `/console`：登录后的模块选择层，负责身份、权限和模块分流，避免首页与 FB 广告看板强耦合；静态兼容路径为 `/console.html`。
- 用户广告看板 `/ads`：包含图表看板、列表看板、历史预警查看和 AI 分析。这个页面不出现设置、采集队列、用户管理、预警模板管理等管理员配置选项。
- 管理员设置系统 `/admin`：独立子页面，需管理员账号登录并通过服务端 PIN 校验后进入；承载用户管理、服务端设置、采集队列、预警模板管理和审计日志。
- 兼容静态路径：`/ads.html` 指向用户广告看板，`/admin.html` 指向管理员设置系统。

## 数据和配置文件

```text
cli/data/fb-ads.sqlite                  # 本地 SQLite 采集库，不提交
cli/data/output/facebook_ads_*.json     # 采集输出，不提交
cli/data/output/facebook_ads_*.csv      # 采集输出，不提交
cli/config/monitored-accounts.json      # 本地监控账户，不提交
cli/config/sampling-plans.json          # 设置页保存的监控列表和频率，不提交
data/alert-ai/*.json                    # 预警/AI 本地运行数据，不提交
cli/.env                                # 本地密钥和运行配置，不提交
```

服务端启动时会读取仓库根目录 `.env` 和 `cli/.env`。已有的进程环境变量优先，文件里的密钥只在服务端和 CLI 使用；设置页只展示“已配置/缺失/默认值”，不会把 secret、API key 或 webhook 明文返回给前端。

## 环境变量

示例文件在 `cli/.env.example`。复制为 `cli/.env` 后填入本机配置：

```text
cli/.env.example -> cli/.env
```

| 变量 | 必填 | 默认值 | 用途 |
| --- | --- | --- | --- |
| `HOST` | 否 | `127.0.0.1` | Web 服务监听地址；局域网访问可改为 `0.0.0.0`。 |
| `PORT` | 否 | `3100` | Web 服务端口。 |
| `ADMIN_PAGE_PIN` | 否 | 空 | 管理员设置系统 `/admin` 的二次 PIN；本地开发可用，生产建议改用哈希。 |
| `ADMIN_PAGE_PIN_HASH` | 否 | 空 | 管理员 PIN 的 SHA-256 哈希，优先级高于 `ADMIN_PAGE_PIN`。 |
| `ADMIN_PAGE_PIN_SECRET` | 否 | 派生值 | 签发管理员 PIN 会话 Cookie 的 HMAC 密钥；远程部署建议显式配置。 |
| `ADMIN_PAGE_PIN_TTL_MS` | 否 | `3600000` | 管理员 PIN 通过状态有效期，默认 1 小时。 |
| `YINO_CLIENT_ID` | 是 | 无 | YinoCloud 应用 ID，CLI 采集和设置页刷新 ACTIVE 资源需要。 |
| `YINO_CLIENT_SECRET` | 是 | 无 | YinoCloud API Key，用于换取 token。 |
| `YINO_BASE_URL` | 否 | `https://yl-open-api-lfnsrvbmgm.ap-northeast-1.fcapp.run` | YinoLink Open API 根地址。 |
| `YINO_CONCURRENCY` | 否 | `3` | CLI 默认请求并发。 |
| `YINO_REQUEST_TIMEOUT_MS` | 否 | `30000` | CLI 默认请求超时。 |
| `ACTIVE_RESOURCE_ACCOUNT_ID` | 否 | `8462513793771963` | 设置页刷新 ACTIVE 广告系列、广告组和广告候选的默认账户。 |
| `FEISHU_ALERT_WEBHOOK_URL` | 否 | 空 | 预警模板未单独填写飞书地址时使用的默认群机器人 Webhook。 |
| `SENTINEL_WEBHOOK_URL` | 否 | `FEISHU_ALERT_WEBHOOK_URL` | 哨兵达到每日崩溃重启上限时推送报告；为空时回退到飞书预警 Webhook。 |
| `SENTINEL_MAX_DAILY_RESTARTS` | 否 | `3` | 哨兵按北京时间自然日允许的错误崩溃重启次数。 |
| `SENTINEL_BACKOFF_INITIAL_MS` | 否 | `5000` | 第一次错误重启前等待时间，后续指数退避。 |
| `SENTINEL_BACKOFF_MAX_MS` | 否 | `300000` | 指数退避最大等待时间。 |
| `SENTINEL_HEALTH_URL` | 否 | `http://127.0.0.1:{PORT}/api/health` | 哨兵健康检查地址。 |
| `SENTINEL_HEALTH_INTERVAL_MS` | 否 | `30000` | 哨兵健康检查间隔。 |
| `SENTINEL_HEALTH_FAILURES_BEFORE_RESTART` | 否 | `3` | 连续健康检查失败多少次后终止并重启服务。 |
| `DEEPSEEK_API_KEY` | 否 | 空 | AI 分析页调用 DeepSeek；为空时使用本地规则分析。 |
| `DEEPSEEK_BASE_URL` | 否 | `https://api.deepseek.com` | DeepSeek 兼容 Chat Completions 接口地址。 |
| `DEEPSEEK_MODEL` | 否 | `deepseek-v4-flash` | AI 分析页使用的模型。 |
| `SMTP_HOST` | 否 | 空 | 注册邮箱验证码使用的 SMTP 主机；未配置时注册验证码接口返回未配置错误。 |
| `SMTP_PORT` | 否 | `587` | SMTP 端口，常见为 465 或 587。 |
| `SMTP_SECURE` | 否 | `0` | 设为 `1` 使用 SSL 直连；465 端口默认启用。 |
| `SMTP_USER` | 否 | 空 | SMTP 登录用户名。 |
| `SMTP_PASS` | 否 | 空 | SMTP 登录密码或授权码。 |
| `SMTP_FROM` | 否 | 空 | 验证码邮件发件邮箱。 |

Resend 可作为 SMTP 服务使用：`SMTP_HOST=smtp.resend.com`、`SMTP_USER=resend`、`SMTP_PASS=<Resend API Key>`。Resend 测试模式只允许向账号自己的邮箱发送测试邮件；要给任意注册邮箱发送验证码，必须先在 Resend 验证 `zhizai.art` 这类发信域名，并把 `SMTP_FROM` 改成该域名下的地址，例如 `智在 AI <no-reply@zhizai.art>`。

## 启动方式

### 账号和安全

本看板启用账号体系后，匿名状态不开放任何业务 API。未登录用户只能访问静态登录页面、`POST /api/auth/login` 和可选的极简健康检查 `GET /api/health`；广告数据、设置、采集队列、预警和 AI 报告接口都必须先登录。

首次启用前，在本机创建管理员：

```bash
npm run auth:create-admin -- --username admin
```

重置管理员密码：

```bash
npm run auth:reset-admin-password -- --username admin
```

进入管理员设置系统前，还需要配置二次 PIN。开发环境可直接配置：

```powershell
$env:ADMIN_PAGE_PIN="123456"
```

生产或 cloudflared 隧道域名暴露前，建议改用 `ADMIN_PAGE_PIN_HASH` 并显式设置 `ADMIN_PAGE_PIN_SECRET`。未配置 PIN 时，管理员页只会提示服务端缺少 PIN 配置，不会放行到管理系统。

认证数据保存在 `data/auth.sqlite`，不提交 Git。密码使用慢哈希保存，浏览器只持有 HttpOnly session Cookie；所有写操作会自动携带并校验 CSRF token。管理员可以访问设置、采集队列、预警模板管理、用户管理和审计日志；普通用户只能查看分配到账户范围内的数据和报告。

上线或局域网多人访问前，必须确认：

- 不要把 Node 服务裸露到公网；远程访问应放在 HTTPS 反向代理或 VPN 后面。
- 如果 `HOST=0.0.0.0`，必须先创建管理员并验证未登录业务 API 返回 401。
- 配置 `ADMIN_PAGE_PIN` 或 `ADMIN_PAGE_PIN_HASH`，并确认 `/admin` 未通过 PIN 时不能访问任何管理数据。
- 不提交 `data/auth.sqlite`、`.env`、采集输出、日志、截图和 token cache。

安全验证示例：

```powershell
Invoke-RestMethod http://127.0.0.1:3100/api/health
Invoke-WebRequest "http://127.0.0.1:3100/api/fb-ads/latest?shape=dashboard"
Invoke-WebRequest http://127.0.0.1:3100/api/settings/environment
```

预期：健康检查只返回最小状态；未登录访问看板数据和设置接口都返回 401。

### 基础启动

安装依赖：

```bash
npm install
npm run cli:install
```

启动 Web 看板：

```bash
npm start
```

默认地址：

```text
http://127.0.0.1:3100/
```

页面入口：

```text
http://127.0.0.1:3100/       # 首页入口
http://127.0.0.1:3100/login   # 平台登录，兼容 /login.html
http://127.0.0.1:3100/console # 平台工作台，兼容 /console.html
http://127.0.0.1:3100/ads    # 用户广告看板
http://127.0.0.1:3100/admin  # 管理员设置系统
```

临时改端口：

```powershell
$env:PORT=3101; npm start
```

启动哨兵托管 Web 看板：

```bash
npm run sentinel:start
```

哨兵会启动 `src/server.js`，并通过 `/api/health` 监控进程。进程退出或健康检查连续失败时，按 `SENTINEL_BACKOFF_INITIAL_MS`、`2x`、`4x` 指数退避重启；每个北京时间自然日最多重启 `SENTINEL_MAX_DAILY_RESTARTS` 次，达到上限后向 `SENTINEL_WEBHOOK_URL` 推送报告，未配置时回退 `FEISHU_ALERT_WEBHOOK_URL`。哨兵状态保存在 `data/sentinel/state.json`，日志保存在 `logs/sentinel.log`、`logs/server-sentinel.*.log`，均不提交。

检查哨兵配置：

```bash
npm run sentinel:check
```

安装为 Windows 服务需要管理员 PowerShell：

```powershell
npm run service:install
```

该脚本会编译本地 Windows Service wrapper 到 `data/sentinel/FbAdsDashboardSentinelService.exe`，创建自动启动服务 `FbAdsDashboardSentinel`，并启动哨兵。卸载服务：

```powershell
npm run service:uninstall
```

日常查看、启动和重启 Windows 服务：

```powershell
npm run service:status
npm run service:start
npm run service:restart
```

`service:start`、`service:stop`、`service:restart` 需要管理员 PowerShell。普通权限运行时脚本会输出需要在管理员 PowerShell 中执行的命令，不会静默假装成功。需要 UAC 弹窗时也可以直接运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ops/manage-windows-service.ps1 -Action restart -Elevate
```

安装全局服务管理命令后，可以在任意目录执行：

```powershell
npm run service:global
zai-service status
zai-service restart
zai-service elevate-restart
```

首次采集前检查配置并初始化数据库：

```bash
npm run cli:doctor
npm run cli:db-init
```

## 采集和监控命令

常用一次性拉取：

```bash
npm run cli:pull -- --date-preset yesterday --level ads --limit 10
```

三个生产取数工具：

```bash
# Tool 1：指定多个 ad_id 拉广告层级小时数据；请求内部按最多 50 个 ID 分批，写 SQLite/JSON/CSV
npm run cli:ad-insights -- --accounts 8462513793771963 --ids 120000000000000001,120000000000000002 --date-preset yesterday

# Tool 2：账户资源维表，优先 resource?effective_status=["ACTIVE"]，并本地二次过滤
npm run cli:resource-list -- --accounts 8462513793771963 --type all --active

# Tool 3：campaign 聚合 hourly insights，覆盖同一 campaign + hour
npm run cli:campaign-insights -- --accounts 8462513793771963 --ids 120000000000000001 --date-preset yesterday
```

按设置页 List 1/List 2 执行：

```bash
npm run cli:monitor-bootstrap -- --accounts 8462513793771963
npm run cli:monitor-run -- --mode all
npm run cli:monitor-loop -- --mode all
```

旧取样监控命令仍可用：

```bash
npm run cli:sampling-config -- --write
npm run cli:sampling-evaluate -- --accounts 8462513793771963 --resource-limit 100 --probe-level ads --probe-limit 10 --date-preset yesterday
npm run cli:sampling-run -- --mode all
npm run cli:sampling-loop -- --mode all --max-cycles 1
```

## 关键接口

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/api/health` | GET | 健康检查。 |
| `/api/auth/login` | POST | 登录账号并签发 HttpOnly session Cookie。 |
| `/api/auth/register/code` | POST | 向注册邮箱发送 6 位验证码，需要 SMTP 配置。 |
| `/api/auth/register` | POST | 使用邮箱、验证码和密码注册普通用户并登录。 |
| `/api/auth/me` | GET | 返回当前登录用户、权限和 CSRF token。 |
| `/api/fb-ads/latest?shape=dashboard` | GET | 看板数据；优先 SQLite，其次 output JSON，最后 Demo。 |
| `/api/monitor/status` | GET | List 1/List 2 最近批次、状态和资源计数。 |
| `/api/admin/pin/status` | GET | 管理员 PIN 配置和当前浏览器通过状态，不返回 PIN。 |
| `/api/admin/pin/verify` | POST | 校验管理员 PIN，成功后写入短期 HttpOnly PIN Cookie。 |
| `/api/admin/pin/clear` | POST | 清除当前浏览器 PIN 通过状态。 |
| `/api/admin/users` | GET/POST | 管理员用户列表和新增用户。 |
| `/api/admin/users/:id` | PUT/DELETE | 管理员编辑或删除用户，支持账户 / 广告系列 / 广告组 / 广告四层数据范围；不能删除当前登录管理员账号。 |
| `/api/admin/users/:id/password` | POST | 管理员重置用户密码。 |
| `/api/admin/audit-events` | GET | 管理员查看审计日志。 |
| `/api/settings/environment` | GET | 设置页 `.env` 配置状态，不返回密钥明文。 |
| `/api/settings/accounts` | GET/POST | 读取或保存监控账户。 |
| `/api/settings/sampling` | GET/POST | 读取或保存 List 1/List 2 监控配置。 |
| `/api/settings/resources` | GET | 读取当前 `ACTIVE_RESOURCE_ACCOUNT_ID` 的 ACTIVE 候选资源。 |
| `/api/settings/resources/refresh` | POST | 刷新 ACTIVE 候选资源。 |
| `/api/alert-ai/metadata` | GET | 预警/AI 元数据和默认配置状态。 |
| `/api/alert-ai/templates` | GET/POST | 查询或创建预警模板。 |
| `/api/alert-ai/templates/:id` | GET/PUT/DELETE | 读取、更新或删除预警模板。 |
| `/api/alert-ai/templates/:id/copy` | POST | 复制预警模板。 |
| `/api/alert-ai/templates/:id/status` | PATCH | 启停预警模板。 |
| `/api/alert-ai/entities` | GET | 按账户、广告系列、广告组、广告读取 AI/预警候选对象。 |
| `/api/alert-ai/alerts/messages` | GET | 历史预警消息。 |
| `/api/alert-ai/alerts/push-records` | GET | 推送记录。 |
| `/api/alert-ai/alerts/evaluate` | POST | 手动评估预警模板。 |
| `/api/alert-ai/reports` | GET | 历史 AI 分析报告。 |
| `/api/alert-ai/reports/stream` | POST | 流式生成 AI 分析报告。 |

除 `/api/health` 和登录相关接口外，业务 API 都需要登录。管理员设置、采集队列、用户管理、审计日志和预警模板管理写操作需要管理员权限；管理员设置系统内的管理 API 还会校验 `/admin` 的 PIN 通过状态。

## 时间口径

- YinoLink 请求侧按广告账户 `timezone_name` 解释 `today/yesterday` 和 hourly 桶。
- 自动监控未显式传 `date_preset` 时，会先按账户时区算出明确的 `since=until=YYYY-MM-DD` 再请求。
- 前端筛选、聚合、批次时间和数据更新时间统一显示为北京时间 `Asia/Shanghai`。
- 旧 SQLite 行如果缺少北京时间字段，服务端会用最近一次账户时区信息即时补算后返回前端。

## 验证命令

语法检查：

```bash
node --check src/server.js
node --check src/adminPin.js
node --check ops/sentinel.js
node --check public/home.js
node --check public/app.js
node --check public/alert-ai.js
node --check public/admin.js
```

接口检查：

```powershell
npm start
Invoke-RestMethod http://127.0.0.1:3100/api/health
Invoke-WebRequest "http://127.0.0.1:3100/api/fb-ads/latest?shape=dashboard"
Invoke-WebRequest http://127.0.0.1:3100/api/settings/environment
npm run sentinel:check
```

预期：健康检查返回 200；未登录访问看板数据和设置接口返回 401。

CLI 检查：

```bash
npm run cli:doctor
npm run cli:sampling-config
```

浏览器检查：

- 打开 `http://127.0.0.1:3100/`，确认只显示入口首页，主按钮进入平台工作台。
- 打开 `http://127.0.0.1:3100/console` 或 `/console.html`，未登录时应跳转平台登录；登录后显示模块选择。
- 打开 `http://127.0.0.1:3100/ads`，未登录时应跳转平台登录；登录后确认图表看板能加载，且页面没有设置、采集任务、用户管理或预警模板管理按钮。
- 打开 `http://127.0.0.1:3100/admin`，确认未登录进入平台登录；管理员登录后仍需 PIN；PIN 正确后才能进入管理员设置系统。
- 切到列表看板，在广告明细模式点击单个 ad，确认单广告趋势下钻出现并可清除。
- 切到预警监控和 AI 分析，确认模板列表、历史预警、分析表单和默认配置状态可加载；用户看板只读模式不显示模板新建、编辑、复制、删除、启停或立即评估。

## 数据和安全

- 不提交 `.env`、本地 SQLite、采集输出 JSON/CSV、日志、截图、Token 缓存和本地运行数据。
- 不要把访问令牌、client secret、Cookie、API key 或飞书 webhook 写进前端代码。
- SQLite 适合当前本机单服务采集和看板读取；如果后续需要多机采集、多人远程访问、集中备份或千万级以上长期明细查询，再迁移到 MySQL/Postgres。

## 本地 API 文档

```text
docs/facebook_ads_api_data_guide.md
docs/yinolink_api_quick_reference.md
cli/README.md
```

`docs/yinolink_api_quick_reference.md` 记录了 YinoLink Apifox 相关接口、Meta breakdowns 入口，以及对 ACTIVE 维表筛选、`level=ad`、hourly 桶和 QPS 限制的实测结论。
