# YinoLink API 快速参考

> 更新日期：2026-06-05
> 用途：沉淀本项目常用 YinoLink/Meta 文档入口和实测结论，后续排查监控方案时先查本文件，不需要重新让用户提供 Apifox 链接。

## 1. 本项目优先使用的接口

| 用途 | YinoLink 接口 | Apifox 页面 | 当前用途 |
| --- | --- | --- | --- |
| 广告系列/广告组/广告列表 | `GET /api/v1/meta_api/resource` | `https://s.apifox.cn/c385a75f-e176-42f5-899f-bf2ea59ca700/398488189e0` | 维护 campaign/adset/ad 维表和 ACTIVE 列表 |
| 广告系列/广告组/广告 Insights | `GET /api/v1/meta_api/insights` | `https://s.apifox.cn/c385a75f-e176-42f5-899f-bf2ea59ca700/392142609e0` | 拉 spend/clicks/impressions/actions/ROAS 等指标 |
| 广告系列/广告组/广告 Info | `GET /api/v1/meta_api/info` | `https://s.apifox.cn/c385a75f-e176-42f5-899f-bf2ea59ca700/392646820e0` | 拉预算、状态、素材关联等静态字段 |
| 拒登广告账户报告 | `GET /api/v1/fb/larr_api` | `https://s.apifox.cn/c385a75f-e176-42f5-899f-bf2ea59ca700/444065949e0` | 拒登报告，不属于实时投放指标主链路 |

Meta breakdowns 参考：

```text
https://developers.facebook.com/docs/marketing-api/insights/breakdowns/
https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights/breakdowns
```

## 2. 实测结论

### 2.1 resource ACTIVE 筛选可用

2026-06-05 使用账户 `8462513793771963` 实测：

```text
GET /api/v1/meta_api/resource
  account_id=8462513793771963
  get_type=ads
  effective_status=["ACTIVE"]
```

结果：

```text
耗时约 0.71s
返回 256 条 ACTIVE ads
覆盖 48 个 campaign、80 个 adset
```

结论：维表刷新应优先用 YinoLink 服务端 `effective_status=["ACTIVE"]` 筛选，再做本地二次过滤。不要默认全量扫描 13,355 条 ads。

补充实测：

| 请求 | 返回 | 结论 |
| --- | --- | --- |
| `get_type=ads&effective_status=["ACTIVE"]` | 返回账户下 ACTIVE ads 列表 | 可用于维护广告维表 |
| `get_type=ads&effective_status=["ACTIVE"]&adset_id=<adset_id>` | 仍返回账户下 ACTIVE ads 列表 | 当前网关忽略 `adset_id` 过滤 |
| `get_type=ads&effective_status=["ACTIVE"]&campaign_id=<campaign_id>` | 仍返回账户下 ACTIVE ads 列表 | 当前网关忽略 `campaign_id` 过滤 |

`resource` 返回字段只有资源维度，例如 `id/name/account_id/campaign_id/adset_id/effective_status`，不返回 `spend/impressions/clicks/hourly_stats_aggregated_by_advertiser_time_zone` 等时段指标。因此它不能直接“拿下整个 adset 的时段数据”；只能先拿 ad 列表，再用 Insights 拉指标。

### 2.2 Insights level=ad 当前不能下载子级广告明细

Meta 原生 API 通常支持在 account/campaign/adset 对象上加 `level=ad` 获取下级广告指标。但 2026-06-05 实测 YinoLink 网关当前行为如下：

| 请求 | 返回 | 结论 |
| --- | --- | --- |
| `id=<ad_id>` | 24 个小时桶，含 `ad_id/ad_name/adset_id/campaign_id` | 可用于广告级监控 |
| `id=<campaign_id>` | 24 个 campaign 聚合小时桶，不含 `ad_id` | 只能看 campaign 汇总 |
| `id=<campaign_id>&level=ad` | 仍为 campaign 聚合，不含 `ad_id` | 不能一次拿 campaign 下所有 ad |
| `id=<adset_id>&level=ad` | 仍为 adset 聚合，不含 `ad_id` | 不能一次拿 adset 下所有 ad |

当前监控实现仍需按 `ad_id` 拉广告级 Insights。若后续 YinoLink 确认支持并修复 `level=ad` 透传，再改成按 account/campaign/adset 批量拉。

### 2.3 hourly breakdown 只能到小时桶

`breakdowns=hourly_stats_aggregated_by_advertiser_time_zone` 返回固定小时桶，例如：

```text
00:00:00 - 00:59:59
01:00:00 - 01:59:59
...
23:00:00 - 23:59:59
```

它不能切成 15 分钟或 30 分钟。可以每 15/30 分钟轮询同一个小时桶的变化，但那是轮询差值，不是官方 15 分钟指标。

注意：YinoLink 在 `time_range` 跨多天且带 hourly breakdown 时，实测返回 24 个“小时-of-day”聚合桶，不是逐日逐小时明细。单日监控建议使用 `date_preset=today` 或 `date_preset=yesterday`。

### 2.4 QPS 限制

2026-06-05 压测结果：

| 测试 | 结果 |
| --- | --- |
| 10 并发首轮请求 | 10 个广告里 5 成功、4 个 `429 client QPS limit exceeded (limit: 5/s)`、1 个 30 秒 Abort |
| 6 并发连续 20 轮，失败立即重试 | 20 轮全部最终成功，平均 14.32s，中位数 4.37s，总 14 次 429、7 次 Abort |

建议生产默认：

```text
并发 4-5
QPS <= 5/s
429/Abort 立即重新入队并记录
```

## 3. 推荐监控链路

1. 每 120 分钟刷新一次 ACTIVE 维表：
   - `/meta_api/resource?get_type=ads&effective_status=["ACTIVE"]`
   - 本地维护 ad -> adset -> campaign 关系和投放状态。
2. 每 15 或 30 分钟拉一次重点广告指标：
   - `/meta_api/insights?id=<ad_id>&date_preset=today&breakdowns=hourly_stats_aggregated_by_advertiser_time_zone`
   - 用 SQLite upsert 覆盖同一 `ad_id + hour_start + hourly_range`。
3. 告警优先使用最近完整小时，当前小时只做趋势参考。
4. 如果要监控 200 个广告，按实测 10 个广告平均 14.32s 估算约 4.8 分钟一轮；15 分钟刷新可行，但必须限流和重试。

## 4. 待向 YinoLink 确认

1. `/meta_api/insights` 是否支持原生 Meta `level=ad` 子级明细透传。
2. 是否支持 `filtering` 按 campaign/adset/ad 状态或 ID 批量筛选。
3. 是否支持 `limit`、分页游标和更大的 page size。
4. 是否支持 Meta 异步 Insights report run，用于一次下载大批量广告指标。
5. hourly breakdown 与 `time_range/time_ranges` 跨多日组合的明确语义。
