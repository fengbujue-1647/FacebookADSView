# FB 广告数据看板

本仓库是一个本地运行的 Facebook 广告监控看板。服务端优先读取 `cli/data/fb-ads.sqlite` 中的真实采集数据；如果 SQLite 没有可用批次，再回退到 `cli/data/output/` 的最新非空 JSON；两者都没有时才使用前端 Demo 数据。

## 当前页面

- 图表看板：按时、日、周、月聚合 Ads Insights 指标，支持北京时间窗口、快捷日期、广告系列、投放状态和指标多选。
- 列表看板：合并后的列表入口，包含 KPI、指标总览和明细表；表格可在广告系列汇总与广告明细之间切换。
- 单广告趋势下钻：在广告明细列表点击 ad 后，页面下方显示该广告在当前时间窗口内的趋势图，可一键清除下钻。
- 预警监控：通过 `public/alert-ai.js` 管理预警模板、历史预警消息和推送记录。
- AI 分析：基于真实采集数据生成报告；配置 `DEEPSEEK_API_KEY` 后调用 DeepSeek，未配置时返回本地规则分析。
- 设置：维护 List 1 广告系列监控、List 2 广告监控、ACTIVE 资源候选、最近批次，并展示 `.env` 环境变量配置状态。

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

## 启动方式

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
| `/api/fb-ads/latest?shape=dashboard` | GET | 看板数据；优先 SQLite，其次 output JSON，最后 Demo。 |
| `/api/monitor/status` | GET | List 1/List 2 最近批次、状态和资源计数。 |
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

## 时间口径

- YinoLink 请求侧按广告账户 `timezone_name` 解释 `today/yesterday` 和 hourly 桶。
- 自动监控未显式传 `date_preset` 时，会先按账户时区算出明确的 `since=until=YYYY-MM-DD` 再请求。
- 前端筛选、聚合、批次时间和数据更新时间统一显示为北京时间 `Asia/Shanghai`。
- 旧 SQLite 行如果缺少北京时间字段，服务端会用最近一次账户时区信息即时补算后返回前端。

## 验证命令

语法检查：

```bash
node --check src/server.js
node --check ops/sentinel.js
node --check public/app.js
node --check public/alert-ai.js
```

接口检查：

```powershell
npm start
Invoke-RestMethod http://127.0.0.1:3100/api/health
Invoke-RestMethod http://127.0.0.1:3100/api/settings/environment
Invoke-RestMethod "http://127.0.0.1:3100/api/fb-ads/latest?shape=dashboard"
npm run sentinel:check
```

CLI 检查：

```bash
npm run cli:doctor
npm run cli:sampling-config
```

浏览器检查：

- 打开 `http://127.0.0.1:3100/`，确认图表看板能加载。
- 切到列表看板，在广告明细模式点击单个 ad，确认单广告趋势下钻出现并可清除。
- 切到预警监控和 AI 分析，确认模板列表、分析表单和默认配置状态可加载。
- 切到设置页，确认 `.env` 配置区、List 1/List 2、ACTIVE 候选和最近批次均可显示。

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
