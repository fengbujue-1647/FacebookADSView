# Facebook Ads View CLI

这个项目提供一个 YinoCloud Facebook 广告数据同步 CLI，用来完成：

```text
client_id/client_secret -> token -> 账户/广告资源/Insights -> 标准 CSV/JSON
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

3. 检查配置：

```bash
npm run doctor
```

4. 拉取昨天广告层级数据并导出 CSV：

```bash
npm run pull -- --date-preset yesterday --level ads
```

输出目录：

```text
data/output/
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

## 重要说明

- API Key 不能提交到 Git 仓库，必须放在 `.env` 或密钥管理服务中。
- 首次联调建议使用 `--limit 10`，确认字段和口径无误后再全量拉取。
- `成效` 默认从购买、加购、发起结账、线索、链接点击等 action 中自动选择第一个有值的动作；也可以用 `--result-action omni_purchase` 指定。
