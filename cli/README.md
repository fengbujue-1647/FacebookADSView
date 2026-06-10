# Facebook Ads View CLI

`cli/` 提供 YinoCloud Facebook 广告数据同步命令：

```text
client_id/client_secret -> token -> 账户/广告资源/Insights -> SQLite + CSV/JSON
```

## 快速开始

安装依赖：

```bash
npm install
```

复制环境变量示例：

```text
.env.example -> .env
```

至少填入：

```text
YINO_CLIENT_ID=...
YINO_CLIENT_SECRET=...
```

配置监控账户：

```text
config/monitored-accounts.example.json -> config/monitored-accounts.json
```

检查配置并初始化数据库：

```bash
npm run doctor
npm run db-init
```

## 环境变量

| 变量 | 必填 | 默认值 | 用途 |
| --- | --- | --- | --- |
| `YINO_CLIENT_ID` | 是 | 无 | YinoCloud 应用 ID。 |
| `YINO_CLIENT_SECRET` | 是 | 无 | YinoCloud API Key。 |
| `YINO_BASE_URL` | 否 | `https://yl-open-api-lfnsrvbmgm.ap-northeast-1.fcapp.run` | YinoLink Open API 根地址。 |
| `YINO_CONCURRENCY` | 否 | `3` | CLI 默认请求并发。 |
| `YINO_REQUEST_TIMEOUT_MS` | 否 | `30000` | CLI 默认请求超时。 |
| `ACTIVE_RESOURCE_ACCOUNT_ID` | 否 | `8462513793771963` | Web 设置页刷新 ACTIVE 候选资源时使用。 |
| `FEISHU_ALERT_WEBHOOK_URL` | 否 | 空 | Web 预警模板默认飞书机器人地址。 |
| `DEEPSEEK_API_KEY` | 否 | 空 | Web AI 分析调用 DeepSeek。 |
| `DEEPSEEK_BASE_URL` | 否 | `https://api.deepseek.com` | DeepSeek 接口地址。 |
| `DEEPSEEK_MODEL` | 否 | `deepseek-v4-flash` | DeepSeek 模型名。 |
| `HOST` | 否 | `127.0.0.1` | Web 服务监听地址。 |
| `PORT` | 否 | `3100` | Web 服务端口。 |

CLI 只强制校验 `YINO_CLIENT_ID` 和 `YINO_CLIENT_SECRET`。其余变量主要给 Web 服务、设置页、预警和 AI 分析使用。

## 常用命令

获取并缓存 token：

```bash
npm run token
```

只拉账户列表和账户详情：

```bash
npm run accounts
```

拉指定账户、日期和层级：

```bash
npm run pull -- --accounts 123456789,987654321 --date-preset yesterday --level ads
npm run pull -- --since 2026-06-01 --until 2026-06-04 --level ads
```

限制数量，便于联调：

```bash
npm run pull -- --date-preset yesterday --level ads --limit 10
```

忽略监控账户并扫描全部账户：

```bash
npm run pull -- --all-accounts --date-preset yesterday --level ads --limit 10
```

三个生产取数工具：

```bash
npm run resource-list -- --accounts 8462513793771963 --type all --active
npm run ad-insights -- --ids 120000000000000001,120000000000000002 --accounts 8462513793771963 --date-preset yesterday
npm run campaign-insights -- --ids 120000000000000001 --accounts 8462513793771963 --date-preset yesterday
```

`ad-insights` 和 `campaign-insights` 支持传入多个 ID，采集时会按 Meta API 单次最多 50 个 ID 自动分批，并继续受 `--qps` 与队列重试限制保护。

设置页 List 1/List 2 对应的监控命令：

```bash
npm run monitor-bootstrap -- --accounts 8462513793771963
npm run monitor-run -- --mode all
npm run monitor-loop -- --mode all
```

## 采集队列与小时桶

- `monitor-run`、`monitor-loop`、`ad-insights`、`campaign-insights` 在 hourly 模式且未显式传 `--date-preset` 时，会先把对象和已结算小时桶规划为 SQLite 持久化 Job，再由 worker 池执行。
- Job 是队列排队、重试和进度统计单位；单个 Job 内的 API Batch 最多包含 50 个广告系列/广告组/广告 ID。
- 小时桶按账户 `timezone_name` 计算，只采集已结算桶；当前正在进行中的小时不会入队。
- 新对象没有水位时检查最近 7 天缺失小时桶；已有水位时从水位日期到最新已结算桶检查缺口。
- 写入 `insight_rows` 仍按同对象加同小时桶覆盖式 upsert，批量写入在 SQLite 事务内完成。
- 队列状态、批次指标、完成小时桶和水位分别记录在 `collection_jobs`、`collection_job_batches`、`collection_completed_buckets`、`collection_watermarks`。

本轮评估过 BullMQ/bull-board 和 SQLite 队列库。BullMQ/bull-board 需要 Redis；SQLite 队列库会引入独立 schema 和面板模型，无法直接表达广告小时桶、水位、批次子项校验和限流指标。因此当前实现复用现有 SQLite，不新增依赖。

旧取样监控命令：

```bash
npm run sampling-config
npm run sampling-config -- --write
npm run sampling-evaluate -- --accounts 8462513793771963 --resource-limit 100 --probe-level ads --probe-limit 10 --date-preset yesterday
npm run sampling-run -- --mode all
npm run sampling-loop -- --mode all --max-cycles 1
```

导入历史 output JSON 到 SQLite：

```bash
npm run db-import-output
npm run db-import-output -- --file data/output/facebook_ads_daily_2026-06-05_000000000.json
```

## 时间口径

- `--since/--until` 是广告账户时区下的日期，不是北京时间日期。
- 自动监控未显式传 `--date-preset` 时，会按账户 `timezone_name` 计算明确的单日 `time_range`。
- Web 看板只负责把返回的账户时区小时桶转换成北京时间显示；不要把前端北京时间反向当成 YinoLink 请求日期。

## 输出

```text
data/fb-ads.sqlite
data/raw/
data/output/facebook_ads_*.json
data/output/facebook_ads_*.csv
```

## 重要说明

- `.env`、`config/monitored-accounts.json`、`config/sampling-plans.json`、`data/`、`.cache/` 都是本地文件，不提交。
- API Key、token、Cookie、client secret、DeepSeek key 和飞书 webhook 不能写进前端代码或提交到 Git。
- 首次联调建议使用 `--limit 10`，确认字段和口径后再全量拉取。
- `成效` 默认从购买、加购、发起结账、线索、链接点击等 action 中自动选择第一个有值的动作；也可以用 `--result-action omni_purchase` 指定。
