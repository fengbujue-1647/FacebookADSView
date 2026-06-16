# Project Working Rules

本文件是 Codex 在本项目以及后续同类项目中必须读取和执行的长期开发记忆。它不是普通说明文档，而是开发约束、UI 风格、接口习惯和踩坑记录。

本项目后续所有代码修改、提交和推送，都必须在最终说明或提交说明中写清楚相对上一次提交的改动点。

要求：

- Always 在最终说明或提交说明中写清楚本次相对上一次提交改了哪些功能、机制、页面或样式。
- Always 写清楚验证方式，例如 `node --check`、接口检查、浏览器截图、手动交互结果或未运行原因。
- Always 明确列出未完成事项、残留风险、推测风险。
- Never 提交 `.env`、采集输出数据、截图产物、浏览器 profile、缓存、日志、SQLite 数据库、AI 报告输出等敏感或临时文件。
- Never 回滚用户已有未提交修改；遇到无关脏文件时只说明并绕开。

# 1. 项目定位记忆

- Always 将本项目视为 `Node.js + HTML` 的广告监控 / 数据监控 / 后台管理 / 运营工具项目。
- Always 保持轻量化架构：后端使用 Node.js 原生 `http` + 文件/SQLite 读取，前端使用静态 HTML/CSS/JavaScript，不主动引入复杂前端框架。
- Prefer 可用、清晰、稳定、样式统一，优先于抽象层级、框架迁移或过度工程化。
- Prefer 一个本地可启动、易部署、易排查的工具型项目：`npm start` 启动服务，`public/` 承载页面，`src/` 承载服务端，`cli/` 承载采集与数据处理。
- Never 为了“规范化”把项目改造成大型框架工程；除非用户明确要求，否则不要引入 React/Vue/Next/Express/Nest 等新体系。
- When building future similar projects, continue this positioning: 单机/内网优先、接口明确、页面直接可用、数据状态可解释、异常状态可见。

# 2. 当前项目真实结构记忆

Always 先理解这些目录职责，再修改代码：

```text
.
├─ AGENTS.md                         # Codex 长期项目记忆和开发规范
├─ README.md                         # 用户可读说明、启动方式、接口说明、时间口径说明
├─ package.json                      # 根服务启动脚本，Node >= 24
├─ src/
│  ├─ server.js                      # Node 原生 http 服务、API、静态资源、调度器
│  ├─ database.js                    # SQLite 读取、监控状态、队列统计、资源候选
│  └─ time.js                        # 服务端时间口径，显示时区 Asia/Shanghai
├─ public/
│  ├─ index.html                     # 单页监控后台，sidebar + workspace 布局
│  ├─ styles.css                     # 主 UI 风格和响应式规则
│  ├─ app.js                         # 主页面状态、筛选、图表、表格、任务、设置
│  ├─ alert-ai.css                   # 预警/AI 模块样式，继承主变量
│  └─ alert-ai.js                    # 预警/AI 模块状态、表单、报告流式生成
├─ cli/
│  ├─ package.json                   # CLI ESM 子工程
│  └─ src/                           # 采集、队列、Yino API、SQLite 写入、时间工具
├─ data/                             # 本地运行数据，必须忽略
├─ logs/                             # 运行日志，必须忽略
├─ artifacts/                        # 截图/浏览器 profile/临时产物，必须忽略
└─ .cache/                           # 缓存，必须忽略
```

- Always 保持 `src/server.js`、`src/database.js`、`src/time.js` 之间的职责边界：路由和 HTTP 在 `server.js`，数据库查询在 `database.js`，时区和日期转换在 `time.js`。
- Always 保持 `public/app.js` 负责主页面状态和渲染，`public/alert-ai.js` 负责预警/AI 子模块，样式分别在 `styles.css` 与 `alert-ai.css`。
- Prefer 通过 `data-*` 属性连接 DOM 与行为，例如 `data-view`、`data-view-panel`、`data-resource-action`、`data-filter-picker`、`data-collection-page`。
- Never 把采集输出、临时截图、日志、浏览器缓存或本地数据库加入版本控制。

# 3. 后端 Node.js 开发规则

## 3.1 服务启动规则

- Always 使用根目录 `npm start` 或 `npm run dev` 启动服务；当前脚本为 `node --disable-warning=ExperimentalWarning src/server.js`。
- Always 记住本项目依赖 `node:sqlite`，运行环境必须满足 `Node >= 24`；上线或换机器前先检查 `node -v`。
- Always 通过 `PORT` 和 `HOST` 读取监听配置；默认 `PORT=3100`、`HOST=127.0.0.1`。
- Prefer 本地开发使用 `127.0.0.1`；只有需要局域网访问时才使用 `0.0.0.0`。
- Never 在代码中硬编码生产端口、密钥、账号 ID 或绝对部署路径。
- 示例场景：如果服务无法启动，先检查 Node 版本、端口占用、`.env`、`cli/data/fb-ads.sqlite` 是否被锁，而不是立即改业务代码。

## 3.2 路由设计规则

- Always 使用清晰、稳定的 REST-like 路径；当前项目主要接口包括：
  - `/api/health`
  - `/api/fb-ads/latest?shape=dashboard`
  - `/api/monitor/status`
  - `/api/settings/environment`
  - `/api/settings/accounts`
  - `/api/settings/sampling`
  - `/api/settings/resources`
  - `/api/settings/resources/refresh`
  - `/api/collection/queue/status`
  - `/api/collection/queue/run`
  - `/api/collection/queue/runs/:run_id`
  - `/api/alert-ai/*`
- Always 在新增 API 时同步检查前端 `fetch()` 路径、错误态、加载态、空态和 README 接口说明。
- Always 将设置类接口放在 `/api/settings/*`，采集队列放在 `/api/collection/queue/*`，预警 AI 放在 `/api/alert-ai/*`。
- Prefer 按资源和功能命名，不按页面命名；例如资源刷新用 `/api/settings/resources/refresh`，不要写成 `/api/refreshButtonClick`。
- Never 只改后端路由而不搜索前端引用；必须 `rg "/api/xxx" public src cli README.md`。
- 示例场景：新增“素材监控”接口时，优先使用 `/api/assets/latest` 或 `/api/settings/assets`，并同步 `public/app.js` 的 fetch、错误提示和空数据渲染。

## 3.3 API 返回格式规则

- Always API 返回 JSON，并设置 no-store；不要让浏览器缓存动态数据。
- Always 错误响应使用 `{ ok: false, error, message, fields? }`，并通过统一 `writeApiError()` 输出。
- Prefer 成功响应包含 `ok: true` 或明确数据根字段；不要同一个接口有时返回数组、有时返回对象。
- Always 为时间类数据返回元信息，例如 `display_time_zone`、`granularity`、`source`、`read_mode`、`time_zone_enriched_fields`。
- Never 在 API 中返回密钥明文；环境变量接口只能返回“已配置 / 缺失 / 默认值”等状态。
- 示例场景：保存设置失败时返回 `422` 和字段级 `fields`，前端用 `.field-error` 标记具体输入框。

## 3.4 字段命名和映射规则

- Always 修改字段前同时检查三端：CLI 采集字段、后端数据库读取字段、前端展示字段。
- Always 维护当前字段映射习惯：
  - 后端 / SQLite 原始字段：`result_count`、`purchase_value`、`purchase_count`、`add_to_cart_count`、`initiate_checkout_count`、`cpc`、`ctr`、`clicks`。
  - 前端指标 ID：`results`、`revenue`、`purchases`、`add_to_cart`、`initiate_checkout`、`cpc_all`、`ctr_all`、`clicks_all`。
  - 时间展示字段：`date_start_beijing`、`hour_start_beijing`、`account_timezone`。
- Always 对旧 SQLite schema 做兼容读取；`database.js` 中缺失列应返回空字符串或默认值，不应直接崩溃。
- Prefer 用明确的 `mapCollectedRow()` / `mapDashboardColumnRows()` 转换数据，不要在渲染函数里临时猜字段。
- Never 假设前后端字段名天然一致；任何字段改名都必须搜索全仓库。
- 示例场景：新增 `video_views` 指标时，必须确认 Yino/Meta 原始字段、SQLite 列、`FIELDS` 配置、表格列、图表聚合、导出/报告是否一致。

## 3.5 请求参数处理规则

- Always 在使用请求参数前做类型、范围、枚举和长度校验。
- Always 限制请求体大小；当前 `readRequestBody()` 限制约 256KB，超出返回 `request_body_too_large`。
- Always 对 ID 使用严格数字字符串规则；当前账号/资源 ID 常用 `^\d{3,32}$`。
- Always 对分页参数做 clamp，例如 `page`、`page_size` 必须有上下限。
- Always 对 `mode`、`datePreset`、`interval`、`concurrency`、`qps` 等业务参数做白名单和范围校验。
- Prefer 将前端传入的空值规范化为 `""` 或 `null`，不要混用 `undefined`、`"all"`、`"today"`。
- Never 信任前端传入的并发和 QPS 覆盖定时任务配置；定时采集必须使用 List 1 / List 2 自己的设置。
- 示例场景：手动触发采集队列时，前端只发送 `{ mode }`，服务端不要把前端 concurrency/qps 透传给所有列表。

## 3.6 数据读取、写入、缓存和存储规则

- Always 数据源读取顺序保持当前机制：优先 `cli/data/fb-ads.sqlite`，不可用时回退到 `cli/data/output/facebook_ads_*.json`，再由前端使用 demo 数据。
- Always 对旧数据、空表、缺表做防御式读取；数据库不可用时 API 应返回可解释错误或空状态，不应导致服务崩溃。
- Always 写 JSON 文件使用原子写入：先写临时文件，再 rename。
- Always 对设置、模板、报告、推送记录等本地 JSON 数据设置数量上限，避免无限增长。
- Always 对静态 HTML/CSS/JS 和 API 使用 no-store；对 vendor 资源可使用 immutable 缓存。
- Prefer 将采集输出、AI 报告、运行状态保存在 ignored 目录，例如 `data/`、`logs/`、`artifacts/`。
- Never 把 `.env`、SQLite、输出 JSON、日志作为默认可提交文件。
- 示例场景：新增“报警消息历史”时，写入 `data/alert-ai/*.json`，限制最大条数，使用原子写入并确保 `.gitignore` 覆盖。

## 3.7 异步处理和调度规则

- Always 对外部 API 请求设置超时、重试和可解释错误；不要让 Promise 永远悬挂。
- Always 对长任务使用队列、批次、状态表和可恢复机制；不要让一次 HTTP 请求承担全部采集过程。
- Always 在后台 timer 上使用 `unref?.()`，避免测试或脚本被无意义 timer 挂住。
- Always 对队列运行状态做防重入保护；同一批次 running/waiting/retry 时不要重复启动。
- Prefer 将启动采集和读取进度拆开：`POST /run` 只启动任务，`GET /status` 展示进度。
- Never 用前端刷新轮询来代替服务端状态机；刷新只读取状态，不制造状态。
- 示例场景：定时采集恢复时，服务端每 2 秒检查 due/locked 批次并恢复，前端任务页每 2 秒只刷新展示。

## 3.8 错误处理规则

- Always 对 JSON 解析失败、参数错误、数据库不可用、外部接口失败、AI 服务超时分别给出可识别错误码。
- Always 捕获异步错误并返回 JSON；不要让未捕获异常终止 Node 服务。
- Always DeepSeek/AI 分析失败时保留本地规则分析 fallback，并在结果中标记 `ai_status` 和 `ai_message`。
- Always 对删除类操作做保护；例如 collection run 仍有 waiting/running/retry job 时返回 `409`，不能删除。
- Prefer 在错误里保留用户能理解的中文 `message`，日志里保留技术细节。
- Never 因为 AI、外部 API 或单个数据文件失败导致整个页面不可用。
- 示例场景：AI 返回 HTTP 200 但 body 不是合法 JSON，应生成本地规则报告并展示“AI 响应异常”，而不是让报告页空白。

## 3.9 日志输出规则

- Always CLI 日志使用当前 `[info]`、`[warn]`、`[error]` 风格。
- Always 后端关键启动、采集触发、恢复、失败要有简洁日志，避免刷屏。
- Prefer 日志包含 `run_id`、`batch_id`、`mode`、账号 ID、任务状态，方便定位。
- Never 在日志中打印 access token、client secret、完整 `.env` 或用户隐私数据。
- 示例场景：采集失败日志应写清楚是 timeout、429、203、network 还是 invalid response，不能只写 `failed`。

## 3.10 静态资源路径规则

- Always 静态文件只能从 `public/` 安全解析，必须防止路径穿越。
- Always vendor 资源通过服务端显式映射，例如 `/vendor/echarts.min.js`、`/vendor/tom-select.complete.min.js`。
- Always HTML 引用 CSS/JS 时使用版本 query 或 no-store 缓存策略，避免浏览器拿旧文件。
- Prefer 使用相对当前服务根路径的 URL，例如 `/styles.css?v=...`，不要写机器绝对路径。
- Never 让用户可控路径直接拼接成磁盘路径。
- 示例场景：新增页面脚本 `foo.js` 时，放入 `public/`，在 HTML 中用 `/foo.js?v=YYYYMMDD` 引用，并确认服务端 no-store 生效。

## 3.11 本地开发和部署差异规则

- Always 区分根 `.env` 与 `cli/.env`；服务端会读取两者，但已有 `process.env` 优先。
- Always 在设置页只展示配置状态，不展示敏感值。
- Always 部署前确认 Node 版本、端口、HOST、文件权限、SQLite 可写、ignored 数据目录存在。
- Prefer 在 README 或最终说明中写明本地检查命令。
- Never 假设开发机上的 `data/`、`cli/data/`、`.cache/` 会存在于部署环境。
- 示例场景：新机器上页面无数据，应先检查 `/api/health`、`/api/fb-ads/latest?shape=dashboard`、数据库路径和采集命令，而不是改图表代码。

# 4. 前端结构与交互规则

## 4.1 页面结构规则

- Always 使用当前单页后台结构：左侧深色 sidebar、右侧 workspace、顶部 topbar、下方按 `data-view-panel` 切换功能区。
- Always 业务主页面优先是可操作界面，不要做营销落地页或大 hero。
- Always 使用 `.panel`、`.kpi-grid`、`.table-panel`、`.monitor-card`、`.environment-card`、`.task-progress-panel` 等清晰模块承载数据。
- Prefer “筛选区 + 活跃筛选 chips + 数据区 + 空/错状态”的布局。
- Never 把页面堆成多层嵌套卡片；卡片只用于单个信息块、重复项、抽屉或真正需要框选的工具面板。
- 示例场景：新增“素材监控”视图时，应加入 sidebar nav、topbar 标题、toolbar 筛选、panel 数据区，而不是另做完全不同布局。

## 4.2 DOM 命名和事件绑定规则

- Always DOM `id` 使用清晰业务名，例如 `campaignFilterToggle`、`collectionQueueCaption`、`resourceRefreshButton`。
- Always 可交互元素使用 `data-*` 标识动作和类型，便于事件委托。
- Always 在 JS 中集中绑定事件；动态列表优先通过父容器事件委托处理。
- Prefer 保留隐藏原生 select/input 作为状态源，再用自定义 picker 提升体验。
- Never 在大量动态 HTML 中内联复杂 onclick；不要让结构和行为散落。
- 示例场景：表格行里的“查看趋势”按钮应使用 `data-trend-ad-id`，由统一 click handler 处理。

## 4.3 数据渲染规则

- Always 前端维护单一 `state` 对象管理视图、筛选、字段、数据、任务、设置和模块状态。
- Always 数据进入页面前先 normalize/map，再聚合和渲染。
- Always 对动态 HTML 文本使用 `escapeHtml()`，不要直接插入接口返回字符串。
- Always 渲染前处理缺失字段、非法数字、空数组和未知状态。
- Prefer 将指标定义集中在 `FIELDS` 或等价配置中，包含 `id`、`label`、`field`、`unit`、`color`、格式化规则。
- Never 在表格单元格、图表 tooltip 和 KPI 卡里重复写同一套指标转换逻辑。
- 示例场景：新增一个指标时，先补 `FIELDS`，再让 KPI、图表、表格复用配置。

## 4.4 前后端数据交互规则

- Always `fetch()` 使用明确路径和 `cache: "no-store"`。
- Always 前端 API wrapper 要能处理：HTTP 非 2xx、`ok:false`、非 JSON、超时、字段错误。
- Always 每个接口调用对应加载态、成功态、空态、失败态。
- Always 在失败时给用户可理解提示，而不是只 `console.error()`。
- Prefer 保持 API 一次返回页面需要的元信息，减少前端二次猜测。
- Never 静默吞掉生产接口失败；当前 demo fallback 只适合本地演示，生产页面必须能提示真实数据不可用。
- 示例场景：`/api/fb-ads/latest` 失败时，页面可以显示 demo，但必须明确标识 `Demo Insights` 或“接口失败，正在展示示例数据”。

## 4.5 表格、卡片、筛选、搜索、排序、刷新规则

- Always 表格使用 sticky header、横向滚动容器、固定最小宽度，避免列挤压错乱。
- Always 对表格空数据展示明确空态，不要只显示空白 tbody。
- Always 卡片数据必须处理 `null`、`undefined`、`NaN` 和缺失字段。
- Always 搜索和筛选结果为 0 时显示“无匹配结果”，并保留清空筛选入口。
- Always 排序逻辑要定义空值位置和数字/字符串/日期类型，不要依赖浏览器隐式转换。
- Always 刷新按钮触发时显示 loading 或禁用状态，避免重复点击制造并发请求。
- Prefer 任务页自动刷新只在对应视图激活时运行，离开视图暂停或降频。
- Never 修改筛选字段后忘记更新 active chips、隐藏 select、自定义 picker 和数据聚合。
- 示例场景：新增投放状态筛选时，要同步更新 select、picker、chip、过滤函数、空态文案和 URL/API 参数。

## 4.6 时间、日期、状态展示规则

- Always 展示时间统一使用北京时间 `Asia/Shanghai`，并在必要位置标注 `UTC+8` 或 `display_time_zone`。
- Always 请求 Meta/Yino 数据时使用广告账户自身 `timezone_name` 计算日期范围；不要把北京时间当作 API 请求时区。
- Always 避免使用 `date_preset=today` 作为自动监控默认值；定时采集应计算明确的 `since=until=YYYY-MM-DD`。
- Always 同时保留账户时区字段和显示时区字段，例如 `account_timezone`、`date_start_beijing`、`hour_start_beijing`。
- Always 状态字段使用白名单渲染：`running`、`waiting`、`retry`、`completed`、`failed`、`partial`、`paused`、`learning` 等。
- Prefer 不认识的状态显示为中性标签，并保留原始文本。
- Never 让本地机器时区、服务器时区、账户时区、页面显示时区混用。
- 示例场景：小时级图表的 bucket 应使用 `hour_start_beijing` 排序和展示，tooltip 再补充账户时区信息。

## 4.7 空态、加载态、错误态规则

- Always 不只做正常数据状态；任何页面都必须处理空数据、接口失败、字段缺失、异常状态。
- Always 空态使用当前样式体系：虚线边框、浅背景、muted 文案、可操作按钮或清空筛选入口。
- Always 加载态要让用户知道正在读取、保存、刷新或生成报告。
- Always 错误态要说明“发生了什么”和“下一步怎么做”，例如重试、检查配置、刷新资源。
- Prefer 错误态保留当前页面结构，不要整页白屏。
- Never 因为一个图表无数据导致整个 view 无法渲染。
- 示例场景：AI 报告生成失败时，保留表单输入和历史报告，报告区显示错误卡片与重试按钮。

# 5. UI 样式记忆

## 5.1 当前视觉风格

- Always 继承当前项目的“轻量后台工具”视觉：浅灰蓝背景、白色面板、深色 sidebar、克制阴影、8px 圆角、清晰表格、紧凑筛选。
- Always 使用系统中文字体：`Microsoft YaHei`、`PingFang SC`、Arial、sans-serif。
- Always 页面背景保持 `#f5f7fb`，主体卡片保持白色，边框使用浅蓝灰。
- Always 主操作色使用 teal/blue，不要突然改成大面积紫色、橙色、黑金、渐变或营销风。
- Always 保持文字层级：页面标题约 28px，面板标题约 18px，正文 14px，辅助说明 12-13px。
- Prefer 线性、清爽、可扫描的信息密度；不要使用夸张 hero、插画背景、装饰光斑或大面积渐变。

## 5.2 CSS 变量记忆

当前项目 `public/styles.css` 已使用这些变量。后续同类项目应直接复用或贴近它们：

```css
:root {
  --bg: #f5f7fb;
  --paper: #ffffff;
  --ink: #17202a;
  --muted: #5d6978;
  --line: #dbe3ef;
  --line-strong: #cbd5e1;
  --sidebar: #152033;
  --sidebar-soft: #22314a;
  --blue: #2563eb;
  --blue-soft: #e8f0ff;
  --teal: #0f766e;
  --teal-soft: #e1f4f1;
  --amber: #b45309;
  --amber-soft: #fff3d8;
  --green: #15803d;
  --green-soft: #e6f6ea;
  --red: #b91c1c;
  --red-soft: #fee2e2;
  --shadow: 0 12px 36px rgba(21, 34, 52, 0.09);
  --radius: 8px;
}
```

- Always 新增样式优先使用这些变量，不要散落新的近似颜色。
- Prefer 新增状态色从 `blue/teal/green/amber/red` 中选择。
- Never 引入与现有体系冲突的一整套新主题。

## 5.3 布局规则

- Always 根布局使用 `.app-shell`：sidebar 固定宽度约 250px，workspace 自适应。
- Always workspace 使用 24px 左右 padding；窄屏降到 16px。
- Always panel/card 使用 `border: 1px solid var(--line)`、`border-radius: var(--radius)`、白底。
- Prefer 重要主面板使用 `var(--shadow)`，普通小卡片只用边框和轻背景。
- Never 让内容在移动端横向溢出；必须使用 `min-width: 0`、`overflow-x:auto`、`overflow-wrap:anywhere`。

## 5.4 组件规则

- Buttons:
  - Always `.primary-button` 用 teal 填充、白字、38px 左右高度。
  - Always `.secondary-button` 用白底、浅边框、深色文字。
  - Always `.icon-button` 固定 38x38，图标居中，并提供 title/aria-label。
  - Never 用不熟悉的大胶囊按钮替代已有图标按钮体系。
- Tables:
  - Always 表格容器支持横向滚动，表头 sticky，表头背景 `#f8fafc`。
  - Always 数字列右对齐或保持清晰列宽，文本列使用 ellipsis/title。
  - Never 让表格列在窄屏硬挤导致文字重叠。
- Cards:
  - Always KPI/metric/status 卡使用 8px 圆角、浅边框、白底或极浅底色。
  - Always 卡片内标题小而粗，主数字大但不过度英雄化。
  - Never 卡片套卡片。
- Forms:
  - Always input/select/textarea 使用浅边框、8px 圆角、36-38px 控件高度。
  - Always invalid 状态加 `.is-invalid` 和 `.field-error`。
  - Never 只用颜色表示错误；需要文字说明。
- Status tags:
  - Always 使用 `.status-pill`、`.run-badge`、`.env-badge` 这类小标签。
  - Always 成功绿、运行蓝、等待/重试琥珀、失败红、暂停红或中性灰。
  - Never 用整行大色块淹没数据。
- Empty/Error:
  - Always 空态用 dashed border、浅背景、muted 文案。
  - Always 错误态用 red-soft 背景或红色边框，文字可读。

## 5.5 响应式规则

- Always 至少覆盖当前断点习惯：
  - `1180px`：多列任务/监控布局收敛。
  - `860px`：sidebar 变为顶部/静态布局，app-shell 单列。
  - `620px`：筛选、KPI、表单、按钮区尽量单列，按钮文字可隐藏但图标保留。
- Always 检查移动端：顶部、筛选 popover、表格横滚、弹窗/抽屉、按钮文字是否溢出。
- Never 使用 viewport width 动态缩放字体；当前项目坚持固定字体层级和响应式布局。

# 6. 已踩坑问题记忆

以下问题来自 git commit history、代码防御逻辑、README 说明和当前实现痕迹。Confirmed issue 表示已从提交记录或代码修复痕迹确认；Potential risk 表示从结构和实现推断，需要后续注意。

### Avoid: 采集队列模式参数来源错误

- Status: Confirmed issue.
- Symptom: 手动或全量采集时，一个前端传入的 `concurrency/qps` 可能覆盖 List 1 和 List 2 各自配置，导致采集节奏不符合设置。
- Cause: 前端和服务端将通用并发/QPS 参数透传给 `monitor-run`，all mode 没有按列表配置拆分。
- Wrong pattern: `POST /api/collection/queue/run` 同时发送 `{ mode, concurrency, qps }`，服务端无条件追加 CLI 参数。
- Correct pattern: 前端只发送 `{ mode }`；CLI 在 all mode 使用各列表自己的 sampling settings，只有单列表手动模式才允许显式覆盖。
- Future rule: Never 让前端临时参数覆盖定时采集的长期配置；修改采集参数时必须检查 List 1、List 2、all mode、single mode。

### Avoid: DeepSeek/AI 失败导致报告生成失败

- Status: Confirmed issue.
- Symptom: AI 请求超时、网络错误、非 JSON 响应或异常 body 时，报告流可能失败或页面无法拿到完整分析。
- Cause: 外部 AI 结果被当成唯一成功路径，没有足够 fallback。
- Wrong pattern: AI 请求失败后直接抛错终止报告。
- Correct pattern: 生成本地规则分析报告，并附带 `ai_status`、`ai_message` 标记 AI 失败原因。
- Future rule: Always 把外部 AI 当作增强能力，不当作核心页面可用性的唯一依赖。

### Avoid: 监控运行状态与最终队列状态不一致

- Status: Confirmed issue.
- Symptom: 页面显示 `partial/failed`，但持久化队列后续已经重试完成，最终结果实际成功。
- Cause: 监控运行记录使用瞬时状态，没有用 `collection_jobs` 最终统计回填。
- Wrong pattern: 只读取 `monitor_runs` 的旧状态作为最终状态。
- Correct pattern: 用 collection queue 的 completed/failed/retry/waiting/running 统计归一化 recent monitor runs。
- Future rule: Always 区分瞬时状态和最终状态；进度页必须以可恢复队列的最终统计为准。

### Avoid: 定时采集进度控件缺失或刷新逻辑断裂

- Status: Confirmed issue.
- Symptom: 页面无法清楚看到自动采集队列进度、运行历史、当前任务和删除保护。
- Cause: 服务端调度、前端任务页和持久化队列状态没有形成闭环。
- Wrong pattern: 只启动任务，不提供 current run、history、job page、scheduler snapshot。
- Correct pattern: Node 侧调度器 + 队列状态 API + 任务页 2 秒自动刷新 + 删除保护 + run history。
- Future rule: When adding long-running jobs, always add start/status/history/protection UI together.

### Avoid: 重启后采集批次无法恢复

- Status: Confirmed issue.
- Symptom: 服务或 CLI 重启后，waiting/running/retry 批次可能停留在旧状态，任务页统计不准。
- Cause: 队列缺少恢复机制或恢复逻辑没有 run-scoped。
- Wrong pattern: 用内存状态保存采集进度。
- Correct pattern: 使用 SQLite 持久化 collection jobs/batches，启动后由 queue-run 和 Node scheduler 恢复 due/locked 批次。
- Future rule: Never 用内存状态作为长任务唯一进度来源；采集任务必须可恢复。

### Avoid: 监控时区口径混乱

- Status: Confirmed issue.
- Symptom: “今天”、小时桶、图表展示、采集请求日期在账户时区、服务器时区、北京时间之间不一致。
- Cause: `date_preset=today`、本地时间和展示时间混用。
- Wrong pattern: 前端用浏览器本地日期展示，CLI 用默认 today 请求，服务端不补时区元数据。
- Correct pattern: 请求按广告账户 `timezone_name` 计算 `since/until`，展示统一 `Asia/Shanghai`，数据补 `date_start_beijing`、`hour_start_beijing`。
- Future rule: Always 明确 API 请求时区、存储时区、展示时区；新增时间字段必须写入字段说明。

### Avoid: 任务/报告页面信息层级和文案误导

- Status: Confirmed issue.
- Symptom: run notes、backfill 天数、Error 列、AI 面板并排等文案或布局让用户误解任务状态。
- Cause: 技术字段直接暴露给用户，没有转成业务可读说明。
- Wrong pattern: 表格列直接显示 `Error`、`backfill 257 days`、长 JSON 或难懂元数据。
- Correct pattern: 使用 `Notes`、history label、垂直面板、简洁状态标签和 title tooltip。
- Future rule: Always 把内部状态转成用户可理解的中文说明；不要让监控后台看起来像原始日志浏览器。

### Avoid: 样式缓存和静态资源旧版本

- Status: Confirmed issue.
- Symptom: 已修复的进度控件或样式在浏览器里仍显示旧版本。
- Cause: HTML/CSS/JS 缓存策略不明确。
- Wrong pattern: 静态资源长期缓存但没有版本 query。
- Correct pattern: API/HTML/CSS/JS no-store，必要时 HTML 引入资源加版本号。
- Future rule: When changing frontend assets, always consider cache busting and verify browser actually loaded new CSS/JS.

### Avoid: 品牌/水印样式不符合当前后台质感

- Status: Confirmed issue.
- Symptom: studio watermark / lockup 视觉不统一或太突兀。
- Cause: 小型品牌元素没有遵守现有字体、透明度、尺寸和 sidebar 风格。
- Wrong pattern: 随意加入醒目 logo、粗大文本或不透明装饰。
- Correct pattern: 使用透明、低干扰、约 13px 的 lockup，贴合 sidebar footer。
- Future rule: UI 品牌元素必须服务于工具页面，不要抢占数据监控层级。

### Avoid: 接口失败被 demo fallback 完全掩盖

- Status: Potential risk.
- Symptom: `/api/fb-ads/latest` 失败或无数据时，前端回退 demo，用户可能误以为是真实数据。
- Cause: 本地演示和生产监控共用一套 fallback 路径。
- Wrong pattern: 静默使用 demo rows，不突出数据源状态。
- Correct pattern: 明确显示数据源、fallback 原因和接口错误；生产模式可禁用 demo fallback。
- Future rule: Always 标明当前数据是真实采集、JSON fallback 还是 demo。

### Avoid: 手写路由文件过大导致漏改

- Status: Potential risk.
- Symptom: 新增或修改 API 时，只改 `server.js` 某段逻辑，忘记前端 fetch、README、错误态或字段映射。
- Cause: `src/server.js` 和 `public/app.js` 都较大，功能集中。
- Wrong pattern: 凭记忆改一处，不做 `rg` 全局确认。
- Correct pattern: 修改路由前先搜索路径、字段、状态；必要时按当前风格提取小 helper，但不迁移框架。
- Future rule: Before changing APIs, always inspect both server and frontend call sites.

### Avoid: 前后端 normalize 逻辑重复后漂移

- Status: Potential risk.
- Symptom: 前端、服务端、CLI 对 sampling settings、ID、datePreset、并发范围的校验结果不一致。
- Cause: 相同规则分散在 `public/app.js`、`src/server.js`、`cli/src/samplingSettings.js`。
- Wrong pattern: 只改其中一份 normalize 逻辑。
- Correct pattern: 全局搜索规则名和字段名，三端同步；如果重复导致 bug，再抽取共享说明或生成测试样例。
- Future rule: Any setting rule change must update CLI, server, frontend together.

### Avoid: 浏览器兼容性假设过强

- Status: Potential risk.
- Symptom: 老旧浏览器不支持 CSS `:has()` 或现代 JS 特性，picker 选中样式可能失效。
- Cause: 当前样式使用现代 CSS，JS 使用较新的浏览器 API。
- Wrong pattern: 不声明浏览器目标，却依赖现代特性。
- Correct pattern: 默认面向现代 Chromium；如需要兼容旧浏览器，先列兼容矩阵并替换 `:has()` 等特性。
- Future rule: Always state browser target when adding modern CSS/JS behavior.

### Avoid: 本地 SQLite 或输出文件锁定影响验证

- Status: Potential risk.
- Symptom: 验证采集或接口时出现 database locked、文件不可读或旧数据残留。
- Cause: 服务、CLI、浏览器或外部工具同时占用本地数据文件。
- Wrong pattern: 看到接口异常就改业务逻辑。
- Correct pattern: 检查运行进程、锁、队列状态和数据文件，再定位代码。
- Future rule: Before debugging data issues, verify process state and data source health.

# 7. Rules for Future Similar Projects

## Must Do

- Always 先规划目录结构：`src/` 后端、`public/` 前端、`cli/` 可选采集、`data/logs/artifacts` ignored。
- Always 保持 Node.js + HTML 的简单架构，先做可用闭环，再考虑抽象。
- Always 为每个页面提供正常、加载、空数据、接口失败、字段缺失状态。
- Always 为每个 API 写清楚路径、方法、参数、响应、错误码和前端调用点。
- Always 使用统一字段映射表，新增字段必须贯穿 CLI、DB、server、frontend。
- Always 使用统一时间口径：请求时区、存储时区、展示时区分开说明。
- Always 使用当前 UI 变量、8px 圆角、浅色后台、深色 sidebar、克制阴影。
- Always 在最终说明中写变更点、验证方式、风险和未完成事项。

## Never Do

- Never 引入复杂框架替代当前简单架构，除非用户明确要求。
- Never 只做 happy path；空数据、失败、异常字段必须可见。
- Never 让前端字段名和后端字段名凭感觉对应。
- Never 把 `.env`、输出数据、日志、截图、浏览器 profile、SQLite 数据提交。
- Never 用内存状态保存长任务唯一进度。
- Never 静默吞掉接口失败并展示假数据而不标注。
- Never 添加与当前 UI 冲突的新主题、渐变装饰、过大圆角或营销 hero。
- Never 修改旧代码前不读相关接口、字段和页面状态。

## Prefer

- Prefer 原生 Node `http` + 明确 helper，而不是引入 Express。
- Prefer 静态 HTML/CSS/JS + 少量 vendor 库，例如 ECharts、Tom Select。
- Prefer `data-*` 事件委托、集中 `state`、配置驱动指标。
- Prefer SQLite / JSON 原子写入作为本地工具存储。
- Prefer no-store 动态资源和版本 query，减少缓存误判。
- Prefer 小而明确的 helper，而不是大规模重构。

## Before Coding

- Always 先运行或阅读：
  - `rg --files`
  - `Get-Content -Raw README.md`
  - `Get-Content -Raw package.json`
  - 相关 `public/*.js`、`public/*.css`、`src/*.js`
- Always 先确认当前 git status，识别用户已有未提交修改。
- Always 搜索要改的 API 路径、字段名、DOM id、CSS class。
- Always 明确改动会影响哪些页面、接口、数据源和样式。

## Before Finishing

- Always 对 JS 改动至少运行：
  - `node --check src/server.js`
  - `node --check public/app.js`
  - `node --check public/alert-ai.js`
  - 按实际修改范围补充 CLI 文件检查。
- Always 对文档改动运行 `git diff --check`。
- Always 对接口改动用浏览器或 HTTP 请求检查成功、错误、空数据。
- Always 对前端样式改动用浏览器检查桌面和移动视口，确认无重叠、无横向溢出、无旧缓存。
- Always 最终说明列出未运行的检查和原因。

## Before Changing Existing Code

- Always 先理解数据流：CLI 采集 -> SQLite/JSON -> `src/database.js` -> API -> `public/app.js` mapping -> UI render。
- Always 先理解当前字段名的原始来源和展示名。
- Always 先确认是否存在已修复问题的历史，避免回退修复。
- Always 如果看到无关用户改动，保持不动并在最终说明中提示。

## UI Consistency Rules

- Always 新增 UI 先复用 `.panel`、`.primary-button`、`.secondary-button`、`.status-pill`、`.run-badge`、`.empty-inline` 等现有模式。
- Always 使用 CSS 变量，不新增随意色值。
- Always 保持控件高度、间距、圆角和字体与现有后台一致。
- Always 表格/卡片/筛选区适配移动端。
- Never 创建新的视觉系统。

## API Consistency Rules

- Always API 名称按资源归类，路径可读。
- Always 参数校验先于业务使用。
- Always 返回结构稳定，错误格式统一。
- Always 前端和后端字段映射写在明确位置。
- Never 改接口不改前端 fetch 和错误态。

## Error Handling Rules

- Always 对空数据、接口失败、字段缺失、状态未知展示明确 UI。
- Always 对外部服务失败提供 fallback 或可恢复提示。
- Always 长任务可恢复、可查询、可删除保护。
- Always 日志简洁但足够定位，不能泄露密钥。

# 8. 可复用项目模板建议

未来新建广告监控、数据监控、后台管理、运营工具类项目时，Prefer 以下初始化模板：

```text
project-name/
├─ AGENTS.md
├─ README.md
├─ package.json
├─ .gitignore
├─ src/
│  ├─ server.js
│  ├─ database.js
│  ├─ time.js
│  └─ config.js                 # 可选，配置较多时再拆
├─ public/
│  ├─ index.html
│  ├─ styles.css
│  ├─ app.js
│  └─ module-name.js            # 可选，复杂模块再拆
├─ cli/                         # 有采集/同步任务时再建
│  ├─ package.json
│  └─ src/
│     ├─ cli.js
│     ├─ client.js
│     ├─ normalizer.js
│     ├─ database.js
│     ├─ storage.js
│     └─ logger.js
├─ data/                        # ignored
├─ logs/                        # ignored
└─ artifacts/                   # ignored
```

推荐 `package.json` 风格：

```json
{
  "scripts": {
    "start": "node --disable-warning=ExperimentalWarning src/server.js",
    "dev": "node --disable-warning=ExperimentalWarning src/server.js",
    "check": "node --check src/server.js && node --check public/app.js"
  },
  "engines": {
    "node": ">=24"
  }
}
```

推荐基础 API 结构：

```text
GET  /api/health
GET  /api/<resource>/latest
GET  /api/<resource>/status
GET  /api/settings/<name>
PUT  /api/settings/<name>
POST /api/<job>/run
GET  /api/<job>/status
DELETE /api/<job>/runs/:run_id
```

推荐基础页面结构：

```html
<div class="app-shell">
  <aside class="sidebar">...</aside>
  <main class="workspace">
    <header class="topbar">...</header>
    <section class="view-toolbar">...</section>
    <section class="view-panel is-active" data-view-panel="dashboard">...</section>
  </main>
</div>
```

推荐通用组件：

- Sidebar nav：`button.nav-item[data-view]`
- Toolbar：筛选按钮、active chips、popover
- KPI cards：`.kpi-grid` + `.kpi-card`
- Tables：`.table-wrap` + sticky header
- Status tags：`.status-pill` / `.run-badge`
- Empty states：`.empty-inline` / `.empty-state`
- Error states：`.error-inline` / `.report-error`
- Settings cards：`.environment-card` / `.monitor-card`
- Toast：短暂操作反馈

推荐开发流程：

1. 写 README 与目录结构。
2. 搭 Node 原生服务和 `/api/health`。
3. 搭 HTML shell、sidebar、toolbar、空数据面板。
4. 加真实数据 API 和字段 mapping。
5. 加筛选、表格、图表、状态标签。
6. 加设置页和错误态。
7. 加采集队列或后台任务。
8. 做 `node --check`、接口检查、浏览器桌面/移动检查。
9. 更新 AGENTS.md，把新增踩坑写入长期记忆。

# 9. 前端样式复用模板

新项目可从以下基础片段开始，但必须根据实际页面复用当前变量和类名：

```css
:root {
  --bg: #f5f7fb;
  --paper: #ffffff;
  --ink: #17202a;
  --muted: #5d6978;
  --line: #dbe3ef;
  --line-strong: #cbd5e1;
  --sidebar: #152033;
  --sidebar-soft: #22314a;
  --blue: #2563eb;
  --blue-soft: #e8f0ff;
  --teal: #0f766e;
  --teal-soft: #e1f4f1;
  --amber: #b45309;
  --amber-soft: #fff3d8;
  --green: #15803d;
  --green-soft: #e6f6ea;
  --red: #b91c1c;
  --red-soft: #fee2e2;
  --shadow: 0 12px 36px rgba(21, 34, 52, 0.09);
  --radius: 8px;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--ink);
  font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
  font-size: 14px;
  letter-spacing: 0;
}

.app-shell {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
  min-height: 100vh;
}

.sidebar {
  background: var(--sidebar);
  color: #fff;
  min-height: 100vh;
  position: sticky;
  top: 0;
}

.workspace {
  min-width: 0;
  padding: 24px;
}

.panel,
.card {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.primary-button,
.secondary-button,
.icon-button {
  min-height: 38px;
  border-radius: var(--radius);
  font: inherit;
}

.primary-button {
  border: 1px solid var(--teal);
  background: var(--teal);
  color: #fff;
}

.secondary-button {
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink);
}

.icon-button {
  width: 38px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--line);
  background: #fff;
  color: var(--muted);
}

.table-wrap {
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

table {
  width: 100%;
  min-width: 980px;
  border-collapse: collapse;
}

th {
  position: sticky;
  top: 0;
  background: #f8fafc;
  color: var(--muted);
  font-size: 12px;
  text-align: left;
  z-index: 1;
}

th,
td {
  padding: 12px;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}

.status-pill,
.run-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 4px 9px;
  font-size: 12px;
  font-weight: 700;
  background: var(--green-soft);
  color: var(--green);
}

.run-badge.failed {
  background: var(--red-soft);
  color: var(--red);
}

.run-badge.running {
  background: var(--blue-soft);
  color: var(--blue);
}

.run-badge.retry,
.run-badge.pending {
  background: var(--amber-soft);
  color: var(--amber);
}

.empty-inline {
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius);
  background: #f8fafc;
  color: var(--muted);
  padding: 20px;
  text-align: center;
  font-weight: 700;
}

.field-error {
  color: var(--red);
  font-size: 12px;
  margin-top: 6px;
}

.is-invalid {
  border-color: var(--red) !important;
  box-shadow: 0 0 0 3px rgba(185, 28, 28, 0.08);
}

@media (max-width: 860px) {
  .app-shell {
    grid-template-columns: 1fr;
  }

  .sidebar {
    position: static;
    min-height: auto;
  }

  .workspace {
    padding: 16px;
  }
}

@media (max-width: 620px) {
  table {
    min-width: 760px;
  }
}
```

# 10. 后续给 Codex 使用的开发提示词

以后新开类似项目时，可以直接把下面这段提示词发给 Codex：

```text
请按照 C:\Users\Win10\Documents\Facebook 项目的开发风格开发一个 Node.js + HTML 的轻量数据监控 / 广告监控 / 后台工具项目。

要求：
- 保持 Node.js 原生 http + 静态 HTML/CSS/JS 的简单架构，不要过度工程化，不要默认引入大型前端或后端框架。
- 开发前先规划目录结构，优先使用 src/、public/、cli/、data/、logs/、artifacts/，并确保临时数据和敏感文件被 .gitignore 忽略。
- UI 保持当前项目风格：浅灰蓝背景、深色 sidebar、白色 panel、8px 圆角、浅边框、克制阴影、teal/blue 主色、green/amber/red 状态色。
- 页面必须直接可用，第一屏是实际工具界面，不做营销 landing page。
- API 路径按资源命名，参数必须校验，错误统一返回 { ok:false,error,message,fields? }。
- 前后端字段名必须同步检查，不要假设一致；新增字段要贯穿采集、存储、后端、前端和文档。
- 所有数据页必须处理加载、空数据、接口失败、字段缺失、异常状态。
- 时间字段必须明确请求时区、存储时区和展示时区；展示优先使用 Asia/Shanghai。
- 开发后自查接口、字段、样式、异常状态、移动端布局和缓存问题。
- 输出说明必须包含本次改动点、验证方式、未完成事项和风险。
```

# 11. 新项目开发前必读 checklist

- [ ] 已阅读目标项目的 `AGENTS.md`、`README.md`、`package.json`。
- [ ] 已确认项目类型是否属于 Node.js + HTML 数据监控 / 广告监控 / 后台工具。
- [ ] 已确认是否需要保持本项目 UI 风格和轻量架构。
- [ ] 已规划 `src/`、`public/`、`cli/`、`data/`、`logs/`、`artifacts/`。
- [ ] 已确认 `.env`、输出数据、日志、截图、SQLite、浏览器 profile 被忽略。
- [ ] 已确认 API 命名、字段命名、错误格式和时间口径。
- [ ] 已为每个页面设计加载态、空态、失败态、字段缺失态。
- [ ] 已确认表格、卡片、筛选、搜索、排序、刷新逻辑。
- [ ] 已确认移动端不会文字重叠、按钮溢出、表格挤压。
- [ ] 已列出上线前检查命令和手动检查步骤。

# 12. Codex 自我更新规则

当用户在后续开发中指出 Codex 犯了某个错误、样式不符合、字段不一致、接口有问题、页面显示异常、逻辑跑不通，或者用户说“以后不要这样做”时，Always 主动判断这个问题是否应该写入 `AGENTS.md`。

如果该问题可能在未来项目中重复出现，Always 更新 `AGENTS.md`，把它加入长期记忆，格式如下：

```markdown
### Learned Rule: 规则名称

* User correction:
* Mistake:
* Correct behavior:
* Future rule:
* Related files:
```

- Always 把用户纠正沉淀成可执行规则，而不是只在当前对话里道歉。
- Always 标明相关文件、错误模式和未来避免方式。
- Prefer 在同一次修复中更新 AGENTS.md，除非用户明确要求不要改文档。
- Never 把一次性偏好误写成全局规则；只有可能复发、影响质量或用户明确要求长期记住的问题才写入。
