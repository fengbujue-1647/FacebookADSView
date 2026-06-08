# FB 广告数据看板

一个独立运行的 Facebook 广告数据看板模块，前端用于展示 Ads Insights 类数据。看板会优先读取本地 SQLite 采集库；没有真实采集数据时，才回退到 Demo 数据。

## 功能

- 按时、日、周、月聚合时间序列数据。
- 支持开始日期、结束日期和快捷时间窗口。
- 支持广告系列、投放状态筛选。
- 支持字段下拉勾选，字段包含广告系列、投放、操作、预算、已花费金额、CPC、成效、单次成效费用、加购、发起结账、ROAS、CTR、点击量、覆盖人数、展示次数等。
- 使用 Apache ECharts 的区域面积折线图展示多指标聚合趋势，并启用底部 `dataZoom` 时间窗口拖动和缩放。
- 提供 `/api/health`，便于接入智在 EAH 大厅。

## 组件选择

图表组件选择 Apache ECharts。选择理由：

- 官方支持折线图、区域面积图和多系列图。
- 内置 `legend`、`tooltip`、`dataZoom` 等交互组件。
- 不需要自己实现图表、缩放、拖动窗口和悬浮提示。

## 启动

```bash
npm start
```

默认地址：

```text
http://127.0.0.1:3100/
```

健康检查：

```text
http://127.0.0.1:3100/api/health
```

最新采集数据接口：

```text
http://127.0.0.1:3100/api/fb-ads/latest
```

页面启动时会优先读取 `cli/data/fb-ads.sqlite` 中最新完成批次；如果数据库还没有数据，会回退读取 `cli/data/output/` 下最新一次非空 JSON；如果两者都没有真实采集数据，会自动回退到 Demo 数据。

## 接入真实 API 数据

采集模块放在 `cli/` 目录，密钥只保存在 CLI 的 `.env` 中，不会进入前端代码。

本地 API 文档入口：

```text
docs/facebook_ads_api_data_guide.md
docs/yinolink_api_quick_reference.md
```

`docs/yinolink_api_quick_reference.md` 已整理 YinoLink Apifox 四个相关接口、Meta breakdowns 入口，以及 2026-06-05 对 ACTIVE 维表筛选、`level=ad`、hourly 桶和 QPS 限制的实测结论。

时间口径规则：

- 取数侧按广告账户 `timezone_name` 解释 `today/yesterday` 和 hourly 桶，不按服务器本地时区，也不按北京时间。
- 默认监控不传 `date_preset=today`，会先按账户时区算出明确的 `since=until=YYYY-MM-DD` 再请求 YinoLink。
- 前端筛选、聚合、批次时间和数据更新时间统一显示为北京时间 `Asia/Shanghai`。
- 旧 SQLite 行如果缺少北京时间字段，服务端会用最近一次 `accounts_*.json` 的账户时区即时补算后再返回前端。

安装 CLI 依赖：

```bash
npm run cli:install
```

复制配置文件：

```text
cli/.env.example -> cli/.env
```

在 `cli/.env` 填入 YinoCloud 审核通过后的应用 ID 和 API Key：

```text
YINO_CLIENT_ID=...
YINO_CLIENT_SECRET=...
```

配置监控账户：

```text
cli/config/monitored-accounts.example.json -> cli/config/monitored-accounts.json
```

`monitored-accounts.json` 只放本机要采集的账户 ID。配置后，CLI 在没有传 `--accounts` 时会优先使用这些账户，避免默认扫描全部账户。

检查配置：

```bash
npm run cli:doctor
```

初始化本地 SQLite 数据库：

```bash
npm run cli:db-init
```

如果已经有 `cli/data/output/facebook_ads_*.json`，可以先导入最新非空文件到 SQLite：

```bash
npm run cli:db-import-output
```

拉取昨天广告层级数据：

```bash
npm run cli:pull -- --date-preset yesterday --level ads
```

联调时建议先限制数量：

```bash
npm run cli:pull -- --date-preset yesterday --level ads --limit 10
```

如果确实需要忽略监控账户并扫描全部账户，显式加 `--all-accounts`：

```bash
npm run cli:pull -- --all-accounts --date-preset yesterday --level ads --limit 10
```

只拉前 5 个 ACTIVE 广告：

```bash
npm run cli:active-ads -- --date-preset yesterday --limit 5
```

指定账户范围，只扫描这些账户直到找到前 5 个 ACTIVE 广告：

```bash
npm run cli:active-ads -- --accounts 8462513793771963,2152108598945788 --date-preset yesterday --limit 5
```

拉取少量 ACTIVE 广告的小时级数据，适合验证时间分布图：

```bash
npm run cli:active-ads-hourly -- --accounts 8462513793771963 --date-preset yesterday --limit 30
```

三个生产取数工具：

```bash
# Tool 1：1-50 个 ad_id，20 worker、7s Abort、429/Abort 重试，写 SQLite/JSON/CSV
npm run cli:ad-insights -- --accounts 8462513793771963 --ids 120000000000000001,120000000000000002 --date-preset yesterday

# Tool 2：账户资源维表，优先 resource?effective_status=["ACTIVE"]，并本地二次过滤
npm run cli:resource-list -- --accounts 8462513793771963 --type all --active

# Tool 3：campaign 聚合 hourly insights，覆盖同一 campaign + hour
npm run cli:campaign-insights -- --accounts 8462513793771963 --ids 120000000000000001 --date-preset yesterday
```

评估两条取样监控方案的数据量，并可抽样探测 ACTIVE 广告中数据量最大的对象：

```bash
npm run cli:sampling-evaluate -- --accounts 8462513793771963 --resource-limit 100 --probe-level ads --probe-limit 10 --date-preset yesterday
```

按设置页或命令行指定的广告/广告组 ID 拉取小时级伪实时监控数据：

```bash
npm run cli:targeted-monitor -- --level ads --ids 120238379067340623
```

扫描并拉取 ACTIVE 广告系列的小时级监控数据：

```bash
npm run cli:active-campaigns -- --accounts 8462513793771963
```

按设置页配置执行一次或循环执行取样监控：

```bash
npm run cli:sampling-run -- --mode all
npm run cli:sampling-loop -- --mode all --max-cycles 1
```

按新设置页的两个监控列表执行或循环执行：

```bash
npm run cli:monitor-bootstrap -- --accounts 8462513793771963
npm run cli:monitor-run -- --mode all
npm run cli:monitor-loop -- --mode all
```

输出文件：

```text
cli/data/output/facebook_ads_*.json
cli/data/output/facebook_ads_*.csv
```

取样监控配置文件：

```text
cli/config/sampling-plans.json
```

本地数据库：

```text
cli/data/fb-ads.sqlite
```

如果要改端口：

```bash
$env:PORT=3101; npm start
```

## 数据和安全

- `.env`、本地 SQLite 数据库、采集输出 JSON/CSV、Token 缓存都不提交到 Git 仓库。
- 不要把访问令牌、client secret、Cookie 或 API key 写进前端代码。
- SQLite 适合当前本机单服务采集和看板读取；如果后续需要多机采集、多人远程访问、集中备份或千万级以上长期明细查询，再迁移到 MySQL/Postgres。

## 接入智在 EAH 大厅

可以在 `D:\test\Agent_repo\apps\portal\modules.json` 增加类似配置：

```json
{
  "id": "fb-ads-dashboard",
  "name": "FB 广告数据看板",
  "short_name": "FB",
  "category": "投放监控",
  "description": "Facebook 广告数据的时间分布、指标勾选和聚合趋势看板。",
  "url": "http://localhost:3100/",
  "health_url": "http://localhost:3100/api/health",
  "repo_path": "C:\\Users\\Win10\\Documents\\Facebook",
  "workspace_path": "C:\\Users\\Win10\\Documents\\Facebook",
  "docs": [
    "README.md"
  ],
  "tags": [
    "Facebook",
    "广告",
    "投放监控"
  ]
}
```
