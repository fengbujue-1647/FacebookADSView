const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;

const CAMPAIGNS = [
  { id: "camp_us_brf_v2", name: "US - BRF V2 - Prospecting", delivery: "投放中", objective: "Purchase", dailyBudget: 320, scale: 1.18, ctr: 2.4, aov: 64 },
  { id: "camp_ca_ret_01", name: "CA - Retargeting - 7D", delivery: "学习期", objective: "Purchase", dailyBudget: 180, scale: 0.92, ctr: 3.1, aov: 58 },
  { id: "camp_uk_ugc_03", name: "UK - UGC Creative Test", delivery: "投放中", objective: "Add to cart", dailyBudget: 240, scale: 1.05, ctr: 2.8, aov: 52 },
  { id: "camp_au_broad_02", name: "AU - Broad Purchase", delivery: "暂停", objective: "Purchase", dailyBudget: 160, scale: 0.58, ctr: 1.9, aov: 61 },
  { id: "camp_de_interest", name: "DE - Interest Stack", delivery: "已完成", objective: "Checkout", dailyBudget: 120, scale: 0.44, ctr: 2.1, aov: 49 }
];

const FIELDS = [
  { id: "campaign", label: "广告系列", api: "campaign_name", type: "dimension" },
  { id: "delivery", label: "投放", api: "delivery_info", type: "dimension" },
  { id: "objective", label: "目标", api: "objective", type: "dimension" },
  { id: "actions", label: "操作", api: "actions", type: "metric", unit: "count", color: "#2563eb" },
  { id: "budget", label: "预算", api: "daily_budget", type: "metric", unit: "money", color: "#0f766e" },
  { id: "spend", label: "已花费金额", api: "spend", type: "metric", unit: "money", color: "#b45309" },
  { id: "cpc_all", label: "单次点击费用(全部)", api: "cpc", type: "metric", unit: "money", color: "#7c3aed" },
  { id: "results", label: "成效", api: "results", type: "metric", unit: "count", color: "#15803d" },
  { id: "cost_per_result", label: "单次成效费用", api: "cost_per_result", type: "metric", unit: "money", color: "#be123c" },
  { id: "add_to_cart", label: "加入购物车次数", api: "actions:add_to_cart", type: "metric", unit: "count", color: "#0891b2" },
  { id: "initiate_checkout", label: "结账发起次数", api: "actions:initiate_checkout", type: "metric", unit: "count", color: "#c2410c" },
  { id: "roas", label: "广告花费回报(ROAS)", api: "purchase_roas", type: "metric", unit: "ratio", color: "#0d9488" },
  { id: "ctr_all", label: "点击率(全部)", api: "ctr", type: "metric", unit: "percent", color: "#1d4ed8" },
  { id: "clicks_all", label: "点击量(全部)", api: "clicks", type: "metric", unit: "count", color: "#4f46e5" },
  { id: "reach", label: "覆盖人数", api: "reach", type: "metric", unit: "count", color: "#16a34a" },
  { id: "impressions", label: "展示次数", api: "impressions", type: "metric", unit: "count", color: "#9333ea" },
  { id: "purchases", label: "购买次数", api: "actions:purchase", type: "metric", unit: "count", color: "#dc2626" },
  { id: "revenue", label: "购买转化价值", api: "action_values:purchase", type: "metric", unit: "money", color: "#0369a1" },
  { id: "cpm", label: "千次展示费用", api: "cpm", type: "metric", unit: "money", color: "#a16207" },
  { id: "frequency", label: "频次", api: "frequency", type: "metric", unit: "ratio", color: "#475569" }
];

const fieldById = new Map(FIELDS.map((field) => [field.id, field]));
const metricFields = FIELDS.filter((field) => field.type === "metric");
const defaultFields = ["campaign", "delivery", "spend", "roas", "ctr_all", "clicks_all", "add_to_cart", "initiate_checkout", "purchases"];
const coreFields = ["campaign", "delivery", "spend", "roas", "ctr_all", "clicks_all", "results", "cost_per_result"];
const sumKeys = ["budget", "spend", "impressions", "clicks_all", "reach", "add_to_cart", "initiate_checkout", "purchases", "revenue", "results", "actions"];

const state = {
  activeView: "chart",
  granularity: "day",
  selectedFields: new Set(defaultFields),
  campaign: "all",
  delivery: "all",
  normalize: true,
  from: "",
  to: ""
};

const viewCopy = {
  chart: {
    title: "FB 广告图表看板",
    subtitle: "按时间查看广告指标走势和窗口变化。"
  },
  data: {
    title: "FB 广告数据看板",
    subtitle: "查看当前时间窗口内的核心指标和指标总览。"
  },
  list: {
    title: "FB 广告列表看板",
    subtitle: "按广告系列查看投放状态、花费和转化表现。"
  }
};

let chart;
let rawRows = [];
let lastChartData = [];
let lastCampaignRows = [];
let currentSeriesRaw = {};

const els = {
  pageTitle: document.getElementById("pageTitle"),
  pageSubtitle: document.getElementById("pageSubtitle"),
  moreOptionsToggle: document.getElementById("moreOptionsToggle"),
  optionsPanel: document.getElementById("optionsPanel"),
  activeChips: document.getElementById("activeChips"),
  fromDate: document.getElementById("fromDate"),
  toDate: document.getElementById("toDate"),
  campaignFilter: document.getElementById("campaignFilter"),
  deliveryFilter: document.getElementById("deliveryFilter"),
  fieldSummary: document.getElementById("fieldSummary"),
  fieldSearch: document.getElementById("fieldSearch"),
  fieldList: document.getElementById("fieldList"),
  chartCaption: document.getElementById("chartCaption"),
  metricCaption: document.getElementById("metricCaption"),
  metricGrid: document.getElementById("metricGrid"),
  tableCaption: document.getElementById("tableCaption"),
  tableCount: document.getElementById("tableCount"),
  normalizeToggle: document.getElementById("normalizeToggle"),
  kpiGrid: document.getElementById("kpiGrid"),
  tableHead: document.getElementById("tableHead"),
  tableBody: document.getElementById("tableBody"),
  chartEmpty: document.getElementById("chartEmpty"),
  mainChart: document.getElementById("mainChart")
};

function pad(value) {
  return String(value).padStart(2, "0");
}

function toDateInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateInput(value, endOfDay = false) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  }
  return date;
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function startOfWeek(date) {
  const next = new Date(date);
  const day = next.getDay() || 7;
  next.setDate(next.getDate() - day + 1);
  next.setHours(0, 0, 0, 0);
  return next;
}

function labelForBucket(date, granularity) {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());

  if (granularity === "hour") {
    return `${month}-${day} ${hour}:00`;
  }
  if (granularity === "week") {
    return `${month}-${day} 周`;
  }
  if (granularity === "month") {
    return `${year}-${month}`;
  }
  return `${year}-${month}-${day}`;
}

function bucketDate(date, granularity) {
  const next = new Date(date);
  if (granularity === "hour") {
    next.setMinutes(0, 0, 0);
    return next;
  }
  if (granularity === "week") {
    return startOfWeek(next);
  }
  if (granularity === "month") {
    next.setDate(1);
  }
  next.setHours(0, 0, 0, 0);
  return next;
}

function seededNoise(value) {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function buildRawRows() {
  const today = new Date();
  today.setHours(23, 0, 0, 0);
  const start = addDays(today, -180);
  start.setHours(0, 0, 0, 0);
  const rows = [];

  for (let time = start.getTime(); time <= today.getTime(); time += MS_HOUR) {
    const date = new Date(time);
    const dayIndex = Math.floor((time - start.getTime()) / MS_DAY);
    const hour = date.getHours();
    const weekday = date.getDay();
    const hourWave = 0.72 + 0.38 * Math.sin(((hour - 9) / 24) * Math.PI * 2);
    const weekWave = weekday === 0 || weekday === 6 ? 0.84 : 1.06;
    const trend = 0.92 + Math.min(dayIndex / 220, 0.38);

    CAMPAIGNS.forEach((campaign, index) => {
      const noise = 0.8 + seededNoise(dayIndex * 17 + hour * 31 + index * 53) * 0.42;
      const deliveryFactor = campaign.delivery === "暂停" ? 0.08 : campaign.delivery === "已完成" ? 0.18 : campaign.delivery === "学习期" ? 0.88 : 1;
      const spend = Math.max(0, (campaign.dailyBudget / 24) * campaign.scale * deliveryFactor * hourWave * weekWave * trend * noise);
      const impressionRate = 72 + index * 11 + seededNoise(dayIndex + index) * 18;
      const impressions = Math.round(spend * impressionRate);
      const ctr = Math.max(0.35, campaign.ctr + Math.sin((dayIndex + index * 7) / 11) * 0.42 + seededNoise(time / MS_HOUR + index) * 0.22);
      const clicks = Math.max(0, Math.round(impressions * (ctr / 100)));
      const cartRate = 0.12 + index * 0.01 + seededNoise(dayIndex * 9 + index) * 0.035;
      const checkoutRate = 0.42 + seededNoise(dayIndex * 5 + hour + index) * 0.12;
      const purchaseRate = 0.34 + seededNoise(dayIndex * 3 + index * 19) * 0.1;
      const addToCart = Math.round(clicks * cartRate);
      const initiateCheckout = Math.round(addToCart * checkoutRate);
      const purchases = Math.round(initiateCheckout * purchaseRate);
      const revenue = purchases * campaign.aov * (0.86 + seededNoise(dayIndex * 13 + hour + index) * 0.34);
      const reach = Math.round(impressions / (1.08 + seededNoise(dayIndex + hour + index) * 0.62));

      rows.push({
        timestamp: time,
        campaign: campaign.name,
        campaignId: campaign.id,
        delivery: campaign.delivery,
        objective: campaign.objective,
        budget: campaign.dailyBudget / 24,
        spend,
        impressions,
        clicks_all: clicks,
        reach,
        add_to_cart: addToCart,
        initiate_checkout: initiateCheckout,
        purchases,
        revenue,
        results: purchases,
        actions: clicks + addToCart + initiateCheckout + purchases
      });
    });
  }

  return rows;
}

function deriveMetrics(row) {
  const spend = row.spend || 0;
  const clicks = row.clicks_all || 0;
  const impressions = row.impressions || 0;
  const results = row.results || 0;
  const reach = row.reach || 0;

  return {
    ...row,
    cpc_all: clicks ? spend / clicks : 0,
    cost_per_result: results ? spend / results : 0,
    ctr_all: impressions ? (clicks / impressions) * 100 : 0,
    roas: spend ? row.revenue / spend : 0,
    cpm: impressions ? (spend / impressions) * 1000 : 0,
    frequency: reach ? impressions / reach : 0
  };
}

function createAccumulator() {
  return {
    budget: 0,
    spend: 0,
    impressions: 0,
    clicks_all: 0,
    reach: 0,
    add_to_cart: 0,
    initiate_checkout: 0,
    purchases: 0,
    revenue: 0,
    results: 0,
    actions: 0
  };
}

function addToAccumulator(acc, row) {
  sumKeys.forEach((key) => {
    acc[key] += row[key] || 0;
  });
}

function getFilteredRows() {
  const from = parseDateInput(state.from);
  const to = parseDateInput(state.to, true);
  return rawRows.filter((row) => {
    if (row.timestamp < from.getTime() || row.timestamp > to.getTime()) {
      return false;
    }
    if (state.campaign !== "all" && row.campaignId !== state.campaign) {
      return false;
    }
    if (state.delivery !== "all" && row.delivery !== state.delivery) {
      return false;
    }
    return true;
  });
}

function aggregateByTime(rows) {
  const buckets = new Map();

  rows.forEach((row) => {
    const date = bucketDate(new Date(row.timestamp), state.granularity);
    const key = date.getTime();
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        label: labelForBucket(date, state.granularity),
        sortDate: date,
        ...createAccumulator()
      });
    }
    addToAccumulator(buckets.get(key), row);
  });

  return [...buckets.values()]
    .sort((a, b) => a.key - b.key)
    .map(deriveMetrics);
}

function aggregateByCampaign(rows) {
  const buckets = new Map();

  rows.forEach((row) => {
    if (!buckets.has(row.campaignId)) {
      buckets.set(row.campaignId, {
        id: row.campaignId,
        campaign: row.campaign,
        delivery: row.delivery,
        objective: row.objective,
        ...createAccumulator()
      });
    }
    addToAccumulator(buckets.get(row.campaignId), row);
  });

  return [...buckets.values()]
    .map(deriveMetrics)
    .sort((a, b) => b.spend - a.spend);
}

function selectedMetricIds() {
  return [...state.selectedFields].filter((id) => fieldById.get(id)?.type === "metric");
}

function selectedTableFields() {
  const selected = [...state.selectedFields];
  const required = ["campaign", "delivery"];
  return [...new Set([...required, ...selected])];
}

function formatValue(id, value) {
  const field = fieldById.get(id);
  if (!field) {
    return String(value ?? "");
  }
  if (field.type === "dimension") {
    return value || "-";
  }
  if (field.unit === "money") {
    return `$${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
  if (field.unit === "percent") {
    return `${Number(value || 0).toFixed(2)}%`;
  }
  if (field.unit === "ratio") {
    return Number(value || 0).toFixed(2);
  }
  return Math.round(Number(value || 0)).toLocaleString("en-US");
}

function formatKpiValue(id, value) {
  if (id === "spend" || id === "revenue") {
    return `$${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  return formatValue(id, value);
}

function normalizeValues(values) {
  const max = Math.max(...values.map((value) => Math.abs(value)), 0);
  if (!max) {
    return values.map(() => 0);
  }
  return values.map((value) => Number(((value / max) * 100).toFixed(2)));
}

function getGranularityLabel() {
  return {
    hour: "按小时聚合",
    day: "按日聚合",
    week: "按周聚合",
    month: "按月聚合"
  }[state.granularity];
}

function renderFilters() {
  els.campaignFilter.innerHTML = [
    `<option value="all">全部广告系列</option>`,
    ...CAMPAIGNS.map((campaign) => `<option value="${campaign.id}">${campaign.name}</option>`)
  ].join("");

  const deliveries = [...new Set(CAMPAIGNS.map((campaign) => campaign.delivery))];
  els.deliveryFilter.innerHTML = [
    `<option value="all">全部投放状态</option>`,
    ...deliveries.map((delivery) => `<option value="${delivery}">${delivery}</option>`)
  ].join("");
}

function selectedCampaignLabel() {
  if (state.campaign === "all") {
    return "全部广告系列";
  }
  return CAMPAIGNS.find((campaign) => campaign.id === state.campaign)?.name || "未知广告系列";
}

function selectedDeliveryLabel() {
  return state.delivery === "all" ? "全部投放状态" : state.delivery;
}

function renderActiveChips() {
  const metricCount = selectedMetricIds().length;
  const chips = [
    `时间：${state.from} 至 ${state.to}`,
    getGranularityLabel(),
    selectedCampaignLabel(),
    selectedDeliveryLabel(),
    `字段：${state.selectedFields.size} 项`,
    `图表指标：${metricCount} 项`
  ];

  els.activeChips.innerHTML = chips.map((chip) => `<span class="filter-chip"><strong>${chip}</strong></span>`).join("");
}

function renderFieldList() {
  const query = els.fieldSearch.value.trim().toLowerCase();
  const rows = FIELDS.filter((field) => {
    const haystack = `${field.label} ${field.api}`.toLowerCase();
    return haystack.includes(query);
  }).map((field) => {
    const checked = state.selectedFields.has(field.id) ? "checked" : "";
    const tagClass = field.type === "dimension" ? "dimension" : "";
    const tag = field.type === "dimension" ? "维度" : "指标";
    return `
      <label class="field-row">
        <input type="checkbox" value="${field.id}" ${checked}>
        <span class="field-main">
          <strong>${field.label}</strong>
          <small>${field.api}</small>
        </span>
        <span class="field-tag ${tagClass}">${tag}</span>
      </label>
    `;
  });

  els.fieldList.innerHTML = rows.join("") || `<div class="empty-inline">没有匹配字段</div>`;
  els.fieldSummary.textContent = `已选 ${state.selectedFields.size} 项`;
}

function renderKpis(total) {
  const cards = [
    { id: "spend", sub: "当前窗口总花费" },
    { id: "roas", sub: "购买价值 / 花费" },
    { id: "ctr_all", sub: "点击量 / 展示次数" },
    { id: "clicks_all", sub: "全部点击量" },
    { id: "results", sub: "购买成效" }
  ];

  els.kpiGrid.innerHTML = cards.map((card) => {
    const field = fieldById.get(card.id);
    return `
      <article class="kpi-card">
        <span>${field.label}</span>
        <strong>${formatKpiValue(card.id, total[card.id])}</strong>
        <small>${card.sub}</small>
      </article>
    `;
  }).join("");
}

function renderMetricGrid(total) {
  const cards = selectedMetricIds().map((id) => {
    const field = fieldById.get(id);
    return `
      <article class="metric-card">
        <span>${field.label}</span>
        <strong>${formatValue(id, total[id])}</strong>
        <small>${field.api}</small>
      </article>
    `;
  });

  els.metricCaption.textContent = `${state.from} 至 ${state.to}`;
  els.metricGrid.innerHTML = cards.join("") || `<div class="empty-inline">请选择至少一个数值指标</div>`;
}

function renderView() {
  const copy = viewCopy[state.activeView];
  els.pageTitle.textContent = copy.title;
  els.pageSubtitle.textContent = copy.subtitle;

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.activeView);
  });

  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    const active = panel.dataset.viewPanel === state.activeView;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });

  if (state.activeView === "chart" && chart) {
    requestAnimationFrame(() => chart.resize());
  }
}

function renderChart(points) {
  const metrics = selectedMetricIds();
  els.chartCaption.textContent = `${getGranularityLabel()} · ${state.from} 至 ${state.to}`;
  els.chartEmpty.hidden = metrics.length > 0;

  if (!window.echarts || metrics.length === 0) {
    if (chart) {
      chart.clear();
    }
    return;
  }

  if (!chart) {
    chart = echarts.init(els.mainChart, null, { renderer: "canvas" });
  }

  const labels = points.map((point) => point.label);
  currentSeriesRaw = {};

  const series = metrics.map((id) => {
    const field = fieldById.get(id);
    const rawValues = points.map((point) => Number(point[id] || 0));
    currentSeriesRaw[field.label] = { id, values: rawValues };
    const chartValues = state.normalize && metrics.length > 1 ? normalizeValues(rawValues) : rawValues;

    return {
      name: field.label,
      type: "line",
      smooth: true,
      showSymbol: false,
      symbolSize: 6,
      data: chartValues,
      lineStyle: {
        width: 2
      },
      areaStyle: {
        opacity: 0.14
      },
      emphasis: {
        focus: "series"
      },
      color: field.color
    };
  });

  chart.setOption({
    animationDuration: 420,
    color: metrics.map((id) => fieldById.get(id).color),
    tooltip: {
      trigger: "axis",
      confine: true,
      axisPointer: {
        type: "cross",
        label: {
          backgroundColor: "#152033"
        }
      },
      formatter(params) {
        const index = params[0]?.dataIndex || 0;
        const rows = params.map((item) => {
          const raw = currentSeriesRaw[item.seriesName];
          return `${item.marker}${item.seriesName}: <strong>${formatValue(raw.id, raw.values[index])}</strong>`;
        });
        return `<strong>${labels[index]}</strong><br>${rows.join("<br>")}`;
      }
    },
    legend: {
      top: 12,
      right: 18,
      type: "scroll",
      itemWidth: 10,
      itemHeight: 10,
      textStyle: {
        color: "#526071"
      }
    },
    grid: {
      top: 64,
      left: 56,
      right: 24,
      bottom: 88,
      containLabel: true
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: labels,
      axisLabel: {
        color: "#64748b",
        hideOverlap: true
      },
      axisLine: {
        lineStyle: {
          color: "#cbd5e1"
        }
      }
    },
    yAxis: {
      type: "value",
      name: state.normalize && metrics.length > 1 ? "统一比例" : "数值",
      nameTextStyle: {
        color: "#64748b"
      },
      axisLabel: {
        color: "#64748b"
      },
      splitLine: {
        lineStyle: {
          color: "#edf1f7"
        }
      }
    },
    dataZoom: [
      {
        type: "inside",
        throttle: 50,
        zoomOnMouseWheel: true,
        moveOnMouseMove: true
      },
      {
        type: "slider",
        height: 42,
        bottom: 22,
        borderColor: "#dbe3ef",
        fillerColor: "rgba(15, 118, 110, 0.14)",
        handleStyle: {
          color: "#0f766e",
          borderColor: "#0f766e"
        },
        brushSelect: true
      }
    ],
    series
  }, true);
}

function statusClass(delivery) {
  if (delivery === "暂停") {
    return "paused";
  }
  if (delivery === "学习期" || delivery === "已完成") {
    return "learning";
  }
  return "";
}

function renderTable(rows) {
  const columns = selectedTableFields().filter((id) => fieldById.has(id));

  els.tableHead.innerHTML = `
    <tr>
      ${columns.map((id) => `<th>${fieldById.get(id).label}</th>`).join("")}
    </tr>
  `;

  els.tableBody.innerHTML = rows.map((row) => `
    <tr>
      ${columns.map((id) => {
        if (id === "delivery") {
          return `<td><span class="status-pill ${statusClass(row[id])}">${row[id]}</span></td>`;
        }
        return `<td>${formatValue(id, row[id])}</td>`;
      }).join("")}
    </tr>
  `).join("");

  els.tableCount.textContent = `${rows.length} 行`;
  els.tableCaption.textContent = `${state.from} 至 ${state.to}`;
}

function calculateTotals(rows) {
  const total = createAccumulator();
  rows.forEach((row) => addToAccumulator(total, row));
  return deriveMetrics(total);
}

function renderDashboard() {
  const rows = getFilteredRows();
  const timePoints = aggregateByTime(rows);
  const campaignRows = aggregateByCampaign(rows);
  const total = calculateTotals(rows);

  lastChartData = timePoints;
  lastCampaignRows = campaignRows;

  renderKpis(total);
  renderMetricGrid(total);
  renderChart(timePoints);
  renderTable(campaignRows);
  renderFieldList();
  renderActiveChips();
}

function setWindowDays(days) {
  const to = new Date();
  const from = addDays(to, -(days - 1));
  state.from = toDateInputValue(from);
  state.to = toDateInputValue(to);
  els.fromDate.value = state.from;
  els.toDate.value = state.to;

  document.querySelectorAll("[data-window-days]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.windowDays) === days);
  });
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.view;
      renderView();
    });
  });

  els.moreOptionsToggle.addEventListener("click", () => {
    const nextOpen = els.optionsPanel.hidden;
    els.optionsPanel.hidden = !nextOpen;
    els.moreOptionsToggle.setAttribute("aria-expanded", String(nextOpen));
    if (nextOpen) {
      els.fieldSearch.focus();
    }
  });

  els.fromDate.addEventListener("change", () => {
    state.from = els.fromDate.value;
    renderDashboard();
  });

  els.toDate.addEventListener("change", () => {
    state.to = els.toDate.value;
    renderDashboard();
  });

  document.querySelectorAll("[data-granularity]").forEach((button) => {
    button.addEventListener("click", () => {
      state.granularity = button.dataset.granularity;
      document.querySelectorAll("[data-granularity]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      renderDashboard();
    });
  });

  els.campaignFilter.addEventListener("change", () => {
    state.campaign = els.campaignFilter.value;
    renderDashboard();
  });

  els.deliveryFilter.addEventListener("change", () => {
    state.delivery = els.deliveryFilter.value;
    renderDashboard();
  });

  els.normalizeToggle.addEventListener("change", () => {
    state.normalize = els.normalizeToggle.checked;
    renderChart(lastChartData);
  });

  els.fieldSearch.addEventListener("input", renderFieldList);

  els.fieldList.addEventListener("change", (event) => {
    const checkbox = event.target.closest("input[type='checkbox']");
    if (!checkbox) {
      return;
    }
    if (checkbox.checked) {
      state.selectedFields.add(checkbox.value);
    } else {
      state.selectedFields.delete(checkbox.value);
    }
    renderDashboard();
  });

  document.querySelectorAll("[data-field-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.fieldAction;
      if (action === "core") {
        state.selectedFields = new Set(coreFields);
      }
      if (action === "allMetrics") {
        state.selectedFields = new Set(["campaign", "delivery", ...metricFields.map((field) => field.id)]);
      }
      if (action === "clear") {
        state.selectedFields = new Set(["campaign", "delivery"]);
      }
      renderDashboard();
    });
  });

  document.querySelectorAll("[data-window-days]").forEach((button) => {
    button.addEventListener("click", () => {
      setWindowDays(Number(button.dataset.windowDays));
      renderDashboard();
    });
  });

  document.getElementById("resetWindowButton").addEventListener("click", () => {
    setWindowDays(30);
    if (chart) {
      chart.dispatchAction({ type: "dataZoom", start: 0, end: 100 });
    }
    renderDashboard();
  });

  window.addEventListener("resize", () => {
    if (chart) {
      chart.resize();
    }
  });
}

function initIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function init() {
  rawRows = buildRawRows();
  renderFilters();
  setWindowDays(30);
  els.normalizeToggle.checked = state.normalize;
  bindEvents();
  renderFieldList();
  renderDashboard();
  renderView();
  initIcons();
}

init();
