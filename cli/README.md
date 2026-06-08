# Facebook Ads View CLI

这个项目提供一个 YinoCloud Facebook 广告数据同步 CLI，用来完成：

```text
client_id/client_secret -> token -> 账户/广告资源/Insights -> SQLite + 标准 CSV/JSON
```

## 快速开始

1. 安装依赖：

```bash
npm install
```

2. 复制 `.env.example` 为 `.env`，填入 YinoCloud 审核通过后的应用 ID 和 API Key：

```text
YINO_CLIENT_ID=...
YINO_CLIENT_SECRET=...
```

3. 配置监控账户：

```text
config/monitored-accounts.example.json -> config/monitored-accounts.json
```

`monitored-accounts.json` 只放本机要采集的账户 ID。配置后，CLI 在没有传 `--accounts` 时会优先使用这些账户；需要扫描全部账户时加 `--all-accounts`。

4. 检查配置：

```bash
npm run doctor
```

5. 拉取昨天广告层级数据并导出 CSV：

```bash
npm run pull -- --date-preset yesterday --level ads
```

输出目录：

```text
data/output/
```

SQLite 数据库：

```text
data/fb-ads.sqlite
```

原始接口返回目录：

```text
data/raw/
```

## 常用命令

获取并缓存 token：

```bash
npm run token
```

只拉账户列表和账户详情：

```bash
npm run accounts
```

拉指定账户：

```bash
npm run pull -- --accounts 123456789,987654321 --date-preset yesterday
```

拉指定日期范围：

```bash
npm run pull -- --since 2026-06-01 --until 2026-06-04 --level ads
```

限制拉取数量，便于联调：

```bash
npm run pull -- --limit 10
```

忽略监控账户并扫描全部账户：

```bash
npm run pull -- --all-accounts --date-preset yesterday --level ads --limit 10
```

初始化本地 SQLite：

```bash
npm run db-init
```

把最新非空 output JSON 导入 SQLite：

```bash
npm run db-import-output
```

指定文件导入：

```bash
npm run db-import-output -- --file data/output/facebook_ads_daily_2026-06-05_000000000.json
```

查看或生成取样监控配置：

```bash
npm run sampling-config
npm run sampling-config -- --write
```

评估定向伪实时监控和 ACTIVE 广告系列全量监控：

```bash
npm run sampling-evaluate -- --accounts 8462513793771963 --resource-limit 100 --probe-level ads --probe-limit 10 --date-preset yesterday
```

三个生产取数工具：

```bash
npm run resource-list -- --accounts 8462513793771963 --type all --active
npm run ad-insights -- --ids 120000000000000001,120000000000000002 --accounts 8462513793771963 --date-preset yesterday
npm run campaign-insights -- --ids 120000000000000001 --accounts 8462513793771963 --date-preset yesterday
```

时间口径：

- `--since/--until` 是广告账户时区下的日期，不是北京时间日期。
- 自动监控在未显式传 `--date-preset` 时，会按账户 `timezone_name` 计算明确的单日 `time_range`。
- Web 看板只负责把返回的账户时区小时桶转换成北京时间显示；不要把前端北京时间反向当成 YinoLink 请求日期。

按广告或广告组 ID 拉取小时级伪实时数据：

```bash
npm run targeted-monitor -- --level ads --ids 120238379067340623
```

扫描 ACTIVE 广告系列并拉取 campaign 层级小时级数据：

```bash
npm run active-campaigns -- --accounts 8462513793771963
```

按配置执行一次或循环执行：

```bash
npm run sampling-run -- --mode all
npm run sampling-loop -- --mode all --max-cycles 1
```

按设置页的 List 1/List 2 执行一次或循环执行：

```bash
npm run monitor-bootstrap -- --accounts 8462513793771963
npm run monitor-run -- --mode all
npm run monitor-loop -- --mode all
```

## 重要说明

- API Key 不能提交到 Git 仓库，必须放在 `.env` 或密钥管理服务中。
- `config/monitored-accounts.json` 是本地配置，不提交到 Git 仓库。
- `config/sampling-plans.json` 是本地取样监控配置，不提交到 Git 仓库。
- `data/fb-ads.sqlite`、`data/raw/`、`data/output/` 是本地采集数据，不提交到 Git 仓库。
- 首次联调建议使用 `--limit 10`，确认字段和口径无误后再全量拉取。
- `成效` 默认从购买、加购、发起结账、线索、链接点击等 action 中自动选择第一个有值的动作；也可以用 `--result-action omni_purchase` 指定。
