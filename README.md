# FB 广告数据看板

一个独立运行的 Facebook 广告数据看板模块，前端用于展示 Ads Insights 类数据。当前版本使用 Demo 数据模拟真实广告账户表现，后续可替换为 Marketing API 或本地采集后的数据源。

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

如果要改端口：

```bash
$env:PORT=3101; npm start
```

## 数据和安全

- 当前页面里的广告数据是前端 Demo 数据，不包含真实账号、Token、Cookie 或 API key。
- 后续接入真实数据时，不要把访问令牌写进前端代码或仓库。
- 建议把采集后的本地数据放进 `data/`，该目录已加入 `.gitignore`。

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
