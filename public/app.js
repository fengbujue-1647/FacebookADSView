const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;
const MAX_BUCKETS = {
  hour: 96,
  day: 190,
  week: 260,
  month: 120
};
const GRANULARITY_MIN_DAYS = {
  week: 7,
  month: 28
};

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
const metricFieldIds = metricFields.map((field) => field.id);
const defaultFields = ["spend", "roas", "ctr_all", "clicks_all", "add_to_cart", "initiate_checkout", "purchases"];
const coreFields = ["spend", "roas", "ctr_all", "clicks_all", "results", "cost_per_result"];
const sumKeys = ["budget", "spend", "impressions", "clicks_all", "reach", "add_to_cart", "initiate_checkout", "purchases", "revenue", "results", "actions"];

const state = {
  activeView: "chart",
  granularity: "day",
  selectedFields: new Set(defaultFields),
  selectedCampaigns: new Set(),
  delivery: "all",
  normalize: true,
  from: "",
  to: "",
  activeWindowPreset: "",
  monitoredAccounts: [],
  activeSettingsTab: "accounts",
  samplingSettings: {
    targeted: {
      enabled: false,
      level: "ads",
      ids: [],
      intervalMinutes: 15,
      datePreset: "today",
      resultAction: "",
      hourly: true
    },
    activeCampaigns: {
      enabled: true,
      intervalMinutes: 60,
      datePreset: "today",
      resultAction: "",
      limit: 0,
      hourly: true
    }
  }
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
  },
  settings: {
    title: "设置",
    subtitle: "配置用于采集和看板展示的监控账户。"
  }
};

let chart;
let rawRows = [];
let lastChartData = [];
let lastChartRows = [];
let lastCampaignRows = [];
let currentSeriesRaw = {};
let campaignSelect;
let fieldSelect;
let isSyncingSelects = false;

const chartPalette = [
  "#2563eb",
  "#0f766e",
  "#b45309",
  "#7c3aed",
  "#be123c",
  "#0891b2",
  "#15803d",
  "#c2410c",
  "#4f46e5",
  "#475569"
];

const els = {
  pageTitle: document.getElementById("pageTitle"),
  pageSubtitle: document.getElementById("pageSubtitle"),
  moreOptionsToggle: document.getElementById("moreOptionsToggle"),
  optionsPanel: document.getElementById("optionsPanel"),
  activeChips: document.getElementById("activeChips"),
  fromDate: document.getElementById("fromDate"),
  toDate: document.getElementById("toDate"),
  fromMonth: document.getElementById("fromMonth"),
  toMonth: document.getElementById("toMonth"),
  campaignFilter: document.getElementById("campaignFilter"),
  deliveryFilter: document.getElementById("deliveryFilter"),
  fieldFilter: document.getElementById("fieldFilter"),
  fieldSummary: document.getElementById("fieldSummary"),
  viewToolbar: document.getElementById("viewToolbar"),
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
  mainChart: document.getElementById("mainChart"),
  resetWindowButton: document.getElementById("resetWindowButton"),
  settingsCaption: document.getElementById("settingsCaption"),
  monitorAccountsInput: document.getElementById("monitorAccountsInput"),
  settingsAccountList: document.getElementById("settingsAccountList"),
  settingsStatus: document.getElementById("settingsStatus"),
  reloadSettingsButton: document.getElementById("reloadSettingsButton"),
  saveSettingsButton: document.getElementById("saveSettingsButton"),
  targetedEnabled: document.getElementById("targetedEnabled"),
  targetedLevelSelect: document.getElementById("targetedLevelSelect"),
  targetedIdsInput: document.getElementById("targetedIdsInput"),
  targetedIntervalInput: document.getElementById("targetedIntervalInput"),
  targetedDatePresetSelect: document.getElementById("targetedDatePresetSelect"),
  targetedResultActionInput: document.getElementById("targetedResultActionInput"),
  targetedSummary: document.getElementById("targetedSummary"),
  activeCampaignsEnabled: document.getElementById("activeCampaignsEnabled"),
  activeCampaignIntervalInput: document.getElementById("activeCampaignIntervalInput"),
  activeCampaignDatePresetSelect: document.getElementById("activeCampaignDatePresetSelect"),
  activeCampaignLimitInput: document.getElementById("activeCampaignLimitInput"),
  activeCampaignResultActionInput: document.getElementById("activeCampaignResultActionInput"),
  activeCampaignSummary: document.getElementById("activeCampaignSummary")
};

const dataSourceName = document.getElementById("dataSourceName");
const dataSourceMeta = document.getElementById("dataSourceMeta");

function pad(value) {
  return String(value).padStart(2, "0");
}

function toDateValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toDateTimeInputValue(date) {
  return `${toDateValue(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toMonthInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date) {
  const next = new Date(date);
  next.setHours(23, 0, 0, 0);
  return next;
}

function parseDateInput(value, endOfRange = false) {
  if (!value) {
    return new Date(Number.NaN);
  }

  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour = 0, minute = 0] = (timePart || "").split(":").map(Number);
  const date = new Date(year, month - 1, day, hour, minute || 0, 0, 0);

  if (endOfRange && !timePart) {
    date.setHours(23, 59, 59, 999);
  }
  return date;
}

function monthStart(value) {
  const [year, month] = value.split("-").map(Number);
  return new Date(year, month - 1, 1, 0, 0, 0, 0);
}

function monthEnd(value) {
  const [year, month] = value.split("-").map(Number);
  return new Date(year, month, 0, 23, 0, 0, 0);
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

function nextBucketDate(date, granularity) {
  const next = new Date(date);
  if (granularity === "hour") {
    next.setHours(next.getHours() + 1, 0, 0, 0);
    return next;
  }
  if (granularity === "day") {
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
    return next;
  }
  if (granularity === "week") {
    next.setDate(next.getDate() + 7);
    next.setHours(0, 0, 0, 0);
    return next;
  }
  next.setMonth(next.getMonth() + 1, 1);
  next.setHours(0, 0, 0, 0);
  return next;
}

function selectedRangeBounds() {
  const from = parseDateInput(state.from);
  const to = parseDateInput(state.to);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    return null;
  }
  return from <= to ? { from, to } : { from: to, to: from };
}

function rangeDays(bounds = selectedRangeBounds()) {
  if (!bounds) {
    return 0;
  }
  return Math.max(1, Math.ceil((bounds.to.getTime() - bounds.from.getTime() + 1) / MS_DAY));
}

function bucketCountFor(granularity, bounds = selectedRangeBounds()) {
  if (!bounds) {
    return 0;
  }
  const start = bucketDate(bounds.from, granularity);
  const end = bucketDate(bounds.to, granularity);

  if (granularity === "hour") {
    return Math.floor((end.getTime() - start.getTime()) / MS_HOUR) + 1;
  }
  if (granularity === "day") {
    return Math.floor((end.getTime() - start.getTime()) / MS_DAY) + 1;
  }
  if (granularity === "week") {
    return Math.floor((end.getTime() - start.getTime()) / (MS_DAY * 7)) + 1;
  }
  return (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1;
}

function granularityAvailability(granularity) {
  const bounds = selectedRangeBounds();
  if (!bounds) {
    return { allowed: true, reason: "" };
  }

  const days = rangeDays(bounds);
  const minDays = GRANULARITY_MIN_DAYS[granularity] || 0;
  if (days < minDays) {
    return {
      allowed: false,
      reason: `当前窗口不足 ${minDays} 天，不适合按${getGranularityShortLabel(granularity)}聚合`
    };
  }

  const buckets = bucketCountFor(granularity, bounds);
  const maxBuckets = MAX_BUCKETS[granularity];
  if (buckets > maxBuckets) {
    return {
      allowed: false,
      reason: `当前窗口会生成 ${buckets} 个点，超过 ${maxBuckets} 个点上限`
    };
  }

  return { allowed: true, reason: "" };
}

function coerceGranularity() {
  if (granularityAvailability(state.granularity).allowed) {
    return;
  }

  const fallback = ["hour", "day", "week", "month"].find((granularity) => granularityAvailability(granularity).allowed);
  if (fallback) {
    state.granularity = fallback;
  }
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

function mapCollectedRow(row) {
  const dateValue = row.date_stop || row.date_start;
  const timestampSource = row.hour_start || (dateValue ? `${dateValue}T00:00:00` : '');
  const timestamp = timestampSource ? new Date(timestampSource).getTime() : Date.now();
  const spend = Number(row.spend || 0);
  const roas = Number(row.roas || 0);
  const purchaseValue = Number(row.purchase_value || 0) || spend * roas;
  const campaignId = row.campaign_id || row.adset_id || row.ad_id || row.campaign_name || "unknown";

  return {
    timestamp,
    campaign: row.campaign_name || row.adset_name || row.ad_name || campaignId,
    campaignId,
    delivery: row.effective_status || "未知",
    objective: row.result_type || "",
    budget: 0,
    spend,
    impressions: Number(row.impressions || 0),
    clicks_all: Number(row.clicks || 0),
    reach: Number(row.reach || 0),
    add_to_cart: Number(row.add_to_cart_count || 0),
    initiate_checkout: Number(row.initiate_checkout_count || 0),
    purchases: Number(row.purchase_count || 0),
    revenue: purchaseValue,
    results: Number(row.result_count || row.purchase_count || 0),
    actions: Number(row.result_count || 0) + Number(row.add_to_cart_count || 0) + Number(row.initiate_checkout_count || 0) + Number(row.purchase_count || 0)
  };
}

function applyCampaignsFromRows(rows) {
  const campaigns = new Map();
  rows.forEach((row) => {
    if (!campaigns.has(row.campaignId)) {
      campaigns.set(row.campaignId, {
        id: row.campaignId,
        name: row.campaign,
        delivery: row.delivery,
        objective: row.objective,
        dailyBudget: 0,
        scale: 1,
        ctr: 0,
        aov: 0
      });
    }
  });

  if (campaigns.size > 0) {
    CAMPAIGNS.splice(0, CAMPAIGNS.length, ...campaigns.values());
  }
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function parseIdInput(value) {
  const ids = value.split(/[\s,;，；]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => /^\d{3,32}$/.test(item));
  return [...new Set(ids)];
}

function parseAccountInput(value) {
  return parseIdInput(value).map((id) => ({ id, name: "" }));
}

function normalizeSamplingSettings(settings = {}) {
  const targeted = settings.targeted || {};
  const activeCampaigns = settings.activeCampaigns || {};
  return {
    targeted: {
      enabled: targeted.enabled === true,
      level: ["ads", "adsets"].includes(targeted.level) ? targeted.level : "ads",
      ids: Array.isArray(targeted.ids) ? targeted.ids.filter((id) => /^\d{3,32}$/.test(String(id))) : [],
      intervalMinutes: clampNumber(targeted.intervalMinutes, 15, 15, 30),
      datePreset: targeted.datePreset || "today",
      resultAction: String(targeted.resultAction || "").trim(),
      hourly: targeted.hourly !== false
    },
    activeCampaigns: {
      enabled: activeCampaigns.enabled !== false,
      intervalMinutes: clampNumber(activeCampaigns.intervalMinutes, 60, 30, 60),
      datePreset: activeCampaigns.datePreset || "today",
      resultAction: String(activeCampaigns.resultAction || "").trim(),
      limit: Math.max(0, Number.parseInt(activeCampaigns.limit, 10) || 0),
      hourly: activeCampaigns.hourly !== false
    }
  };
}

function summaryChips(items) {
  return items.map((item) => `<span>${item}</span>`).join("");
}

function renderAccountSettings(message = "") {
  const accounts = state.monitoredAccounts;
  renderSettingsCaption();
  els.monitorAccountsInput.value = accounts.map((account) => account.id).join("\n");
  els.settingsAccountList.innerHTML = accounts.map((account) => `
    <span class="account-pill">${account.id}</span>
  `).join("") || `<div class="empty-inline">暂无监控账户</div>`;
  els.settingsStatus.textContent = message;
}

function renderSettingsCaption() {
  const targeted = state.samplingSettings.targeted;
  const activeCampaigns = state.samplingSettings.activeCampaigns;
  els.settingsCaption.textContent = [
    `账户 ${state.monitoredAccounts.length} 个`,
    `定向 ${targeted.ids.length} 个`,
    `ACTIVE ${activeCampaigns.intervalMinutes} 分钟`
  ].join(" · ");
}

function renderSamplingSettings() {
  const settings = state.samplingSettings;
  const targeted = settings.targeted;
  const activeCampaigns = settings.activeCampaigns;

  els.targetedEnabled.checked = targeted.enabled;
  els.targetedLevelSelect.value = targeted.level;
  els.targetedIdsInput.value = targeted.ids.join("\n");
  els.targetedIntervalInput.value = targeted.intervalMinutes;
  els.targetedDatePresetSelect.value = targeted.datePreset;
  els.targetedResultActionInput.value = targeted.resultAction;
  els.targetedSummary.innerHTML = summaryChips([
    targeted.enabled ? "启用" : "停用",
    targeted.level === "ads" ? "广告" : "广告组",
    `${targeted.ids.length} 个对象`,
    `${targeted.intervalMinutes} 分钟`
  ]);

  els.activeCampaignsEnabled.checked = activeCampaigns.enabled;
  els.activeCampaignIntervalInput.value = activeCampaigns.intervalMinutes;
  els.activeCampaignDatePresetSelect.value = activeCampaigns.datePreset;
  els.activeCampaignLimitInput.value = activeCampaigns.limit;
  els.activeCampaignResultActionInput.value = activeCampaigns.resultAction;
  els.activeCampaignSummary.innerHTML = summaryChips([
    activeCampaigns.enabled ? "启用" : "停用",
    `${activeCampaigns.intervalMinutes} 分钟`,
    activeCampaigns.limit > 0 ? `上限 ${activeCampaigns.limit}` : "全量"
  ]);
  renderSettingsCaption();
}

function collectSamplingSettings() {
  return normalizeSamplingSettings({
    targeted: {
      enabled: els.targetedEnabled.checked,
      level: els.targetedLevelSelect.value,
      ids: parseIdInput(els.targetedIdsInput.value),
      intervalMinutes: els.targetedIntervalInput.value,
      datePreset: els.targetedDatePresetSelect.value,
      resultAction: els.targetedResultActionInput.value,
      hourly: true
    },
    activeCampaigns: {
      enabled: els.activeCampaignsEnabled.checked,
      intervalMinutes: els.activeCampaignIntervalInput.value,
      datePreset: els.activeCampaignDatePresetSelect.value,
      limit: els.activeCampaignLimitInput.value,
      resultAction: els.activeCampaignResultActionInput.value,
      hourly: true
    }
  });
}

async function loadAccountSettings(message = "") {
  try {
    const response = await fetch("/api/settings/accounts", { cache: "no-store" });
    const payload = await response.json();
    state.monitoredAccounts = payload.ok && Array.isArray(payload.accounts) ? payload.accounts : [];
    renderAccountSettings(message);
  } catch {
    renderAccountSettings("账户设置读取失败");
  }
}

async function loadSamplingSettings(message = "") {
  try {
    const response = await fetch("/api/settings/sampling", { cache: "no-store" });
    const payload = await response.json();
    state.samplingSettings = normalizeSamplingSettings(payload.ok ? payload.settings : {});
    renderSamplingSettings();
    if (message) {
      els.settingsStatus.textContent = message;
    }
  } catch {
    renderSamplingSettings();
    els.settingsStatus.textContent = "取样设置读取失败";
  }
}

async function loadSettings(message = "") {
  await Promise.all([
    loadAccountSettings(),
    loadSamplingSettings()
  ]);
  if (message) {
    els.settingsStatus.textContent = message;
  }
}

async function saveSettings() {
  const accounts = parseAccountInput(els.monitorAccountsInput.value);
  const samplingSettings = collectSamplingSettings();
  els.saveSettingsButton.disabled = true;
  els.settingsStatus.textContent = "保存中";
  try {
    const accountResponse = await fetch("/api/settings/accounts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ accounts })
    });
    const accountPayload = await accountResponse.json();
    if (!accountResponse.ok || !accountPayload.ok) {
      throw new Error(accountPayload.message || "账户保存失败");
    }
    const samplingResponse = await fetch("/api/settings/sampling", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ settings: samplingSettings })
    });
    const samplingPayload = await samplingResponse.json();
    if (!samplingResponse.ok || !samplingPayload.ok) {
      throw new Error(samplingPayload.message || "取样设置保存失败");
    }
    state.monitoredAccounts = accountPayload.accounts;
    state.samplingSettings = normalizeSamplingSettings(samplingPayload.settings);
    renderAccountSettings("已保存");
    renderSamplingSettings();
  } catch (error) {
    els.settingsStatus.textContent = error.message || "保存失败";
  } finally {
    els.saveSettingsButton.disabled = false;
  }
}

async function loadCollectedRows() {
  try {
    const response = await fetch("/api/fb-ads/latest", { cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json();
    if (!payload.ok || !Array.isArray(payload.rows) || payload.rows.length === 0) return null;

    const rows = payload.rows.map(mapCollectedRow).filter((row) => Number.isFinite(row.timestamp));
    if (rows.length === 0) return null;

    if (payload.rows.some((row) => row.hour_start)) {
      state.granularity = "hour";
    }
    applyCampaignsFromRows(rows);
    dataSourceName.textContent = payload.storage === "sqlite" ? "SQLite Insights" : "Collected Insights";
    const rowText = `${rows.length.toLocaleString("en-US")} 行`;
    const updateText = payload.updated_at ? `更新于 ${payload.updated_at.slice(0, 19).replace("T", " ")}` : payload.source;
    dataSourceMeta.textContent = [rowText, updateText].filter(Boolean).join(" · ");
    return rows;
  } catch {
    return null;
  }
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
  const bounds = selectedRangeBounds();
  if (!bounds) {
    return [];
  }
  return rawRows.filter((row) => {
    if (row.timestamp < bounds.from.getTime() || row.timestamp > bounds.to.getTime()) {
      return false;
    }
    if (state.selectedCampaigns.size > 0 && !state.selectedCampaigns.has(row.campaignId)) {
      return false;
    }
    if (state.delivery !== "all" && row.delivery !== state.delivery) {
      return false;
    }
    return true;
  });
}

function aggregateByTime(rows) {
  const bounds = selectedRangeBounds();
  if (!bounds || rows.length === 0) {
    return [];
  }

  const buckets = new Map();
  const firstDataTime = Math.min(...rows.map((row) => row.timestamp));
  const start = bucketDate(new Date(Math.max(bounds.from.getTime(), firstDataTime)), state.granularity);
  const end = bucketDate(bounds.to, state.granularity);

  for (let cursor = start, guard = 0; cursor.getTime() <= end.getTime() && guard < 1200; cursor = nextBucketDate(cursor, state.granularity), guard += 1) {
    const key = cursor.getTime();
    buckets.set(key, {
      key,
      label: labelForBucket(cursor, state.granularity),
      sortDate: new Date(cursor),
      ...createAccumulator()
    });
  }

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

function campaignCompareEnabled() {
  return state.selectedCampaigns.size > 1;
}

function selectedCampaignsInDisplayOrder() {
  return CAMPAIGNS.filter((campaign) => state.selectedCampaigns.has(campaign.id));
}

function aggregateByCampaignTime(rows, timePoints) {
  if (!campaignCompareEnabled() || timePoints.length === 0) {
    return [];
  }

  const campaigns = selectedCampaignsInDisplayOrder();
  const pointKeys = new Set(timePoints.map((point) => point.key));
  const campaignBuckets = new Map();

  campaigns.forEach((campaign) => {
    const buckets = new Map();
    timePoints.forEach((point) => {
      buckets.set(point.key, {
        key: point.key,
        label: point.label,
        sortDate: point.sortDate,
        ...createAccumulator()
      });
    });
    campaignBuckets.set(campaign.id, buckets);
  });

  rows.forEach((row) => {
    const buckets = campaignBuckets.get(row.campaignId);
    if (!buckets) {
      return;
    }
    const key = bucketDate(new Date(row.timestamp), state.granularity).getTime();
    if (!pointKeys.has(key)) {
      return;
    }
    addToAccumulator(buckets.get(key), row);
  });

  return campaigns.map((campaign) => ({
    campaign,
    points: timePoints.map((point) => deriveMetrics(campaignBuckets.get(campaign.id).get(point.key)))
  }));
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

function getGranularityShortLabel(granularity) {
  return {
    hour: "小时",
    day: "日",
    week: "周",
    month: "月"
  }[granularity];
}

function setSelectOptions(select, items, selectedValues = new Set()) {
  select.innerHTML = "";
  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    option.selected = selectedValues.has(item.value);
    select.appendChild(option);
  });
}

function selectedSelectValues(select) {
  return [...select.selectedOptions].map((option) => option.value);
}

function selectedControlValues(select, instance) {
  if (!instance) {
    return selectedSelectValues(select);
  }
  const value = instance.getValue();
  return Array.isArray(value) ? value : String(value || "").split(",").filter(Boolean);
}

function pruneSelectedCampaigns() {
  const campaignIds = new Set(CAMPAIGNS.map((campaign) => campaign.id));
  state.selectedCampaigns.forEach((id) => {
    if (!campaignIds.has(id)) {
      state.selectedCampaigns.delete(id);
    }
  });
}

function renderFilters() {
  pruneSelectedCampaigns();
  setSelectOptions(els.campaignFilter, CAMPAIGNS.map((campaign) => ({
    value: campaign.id,
    label: campaign.name
  })), state.selectedCampaigns);

  setSelectOptions(els.fieldFilter, metricFields.map((field) => ({
    value: field.id,
    label: field.label
  })), state.selectedFields);

  const deliveries = [...new Set(CAMPAIGNS.map((campaign) => campaign.delivery))];
  els.deliveryFilter.innerHTML = [
    `<option value="all">全部投放状态</option>`,
    ...deliveries.map((delivery) => `<option value="${delivery}">${delivery}</option>`)
  ].join("");

  syncFieldSummary();
}

function selectedCampaignLabel() {
  if (state.selectedCampaigns.size === 0) {
    return "全部广告系列";
  }
  if (state.selectedCampaigns.size === 1) {
    const [campaignId] = state.selectedCampaigns;
    return CAMPAIGNS.find((campaign) => campaign.id === campaignId)?.name || "未知广告系列";
  }
  return `广告系列：${state.selectedCampaigns.size} 个`;
}

function selectedDeliveryLabel() {
  return state.delivery === "all" ? "全部投放状态" : state.delivery;
}

function formatDateTimeLabel(value) {
  return value ? value.replace("T", " ") : "-";
}

function formatRangeText() {
  return `${formatDateTimeLabel(state.from)} 至 ${formatDateTimeLabel(state.to)}`;
}

function renderActiveChips() {
  const metricCount = selectedMetricIds().length;
  const chips = [
    `时间：${formatRangeText()}`,
    getGranularityLabel(),
    selectedCampaignLabel(),
    selectedDeliveryLabel(),
    `图表指标：${metricCount} 项`
  ];

  els.activeChips.innerHTML = chips.map((chip) => `<span class="filter-chip"><strong>${chip}</strong></span>`).join("");
}

function syncFieldSummary() {
  els.fieldSummary.textContent = `已选 ${state.selectedFields.size} 个指标`;
}

function syncFieldChoiceSelection() {
  isSyncingSelects = true;
  const selectedIds = [...state.selectedFields];
  [...els.fieldFilter.options].forEach((option) => {
    option.selected = state.selectedFields.has(option.value);
  });
  if (fieldSelect) {
    fieldSelect.setValue(selectedIds, true);
  }
  isSyncingSelects = false;
  syncFieldSummary();
}

function initChoicePickers() {
  if (!window.TomSelect) {
    syncFieldSummary();
    return;
  }

  const commonOptions = {
    plugins: ["checkbox_options", "remove_button"],
    controlInput: null,
    create: false,
    closeAfterSelect: false,
    hideSelected: false,
    maxOptions: null,
    sortField: [{ field: "$order" }],
    render: {
      no_results() {
        return '<div class="no-results">没有可选项</div>';
      }
    }
  };

  campaignSelect = new TomSelect(els.campaignFilter, {
    ...commonOptions,
    placeholder: "全部广告系列"
  });

  fieldSelect = new TomSelect(els.fieldFilter, {
    ...commonOptions,
    placeholder: "选择指标"
  });

  syncFieldSummary();
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

  els.metricCaption.textContent = formatRangeText();
  els.metricGrid.innerHTML = cards.join("") || `<div class="empty-inline">请选择至少一个数值指标</div>`;
}

function renderView() {
  const copy = viewCopy[state.activeView];
  els.pageTitle.textContent = copy.title;
  els.pageSubtitle.textContent = copy.subtitle;
  els.viewToolbar.hidden = state.activeView === "settings";
  els.resetWindowButton.hidden = state.activeView === "settings";

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
  if (state.activeView === "settings") {
    renderAccountSettings();
    renderSamplingSettings();
  }
}

function renderSettingsTabs() {
  document.querySelectorAll("[data-settings-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.settingsTab === state.activeSettingsTab);
  });

  document.querySelectorAll("[data-settings-pane]").forEach((pane) => {
    const active = pane.dataset.settingsPane === state.activeSettingsTab;
    pane.hidden = !active;
    pane.classList.toggle("active", active);
  });
}

function renderChart(points, rows = lastChartRows) {
  const metrics = selectedMetricIds();
  const compareMode = campaignCompareEnabled();
  const compareGroups = compareMode ? aggregateByCampaignTime(rows, points) : [];
  const compareSuffix = compareMode ? ` · ${compareGroups.length} 个广告系列对比` : "";
  els.chartCaption.textContent = `${getGranularityLabel()} · ${formatRangeText()}${compareSuffix}`;
  els.chartEmpty.textContent = metrics.length === 0 ? "请选择至少一个数值指标" : "当前时间窗口没有可展示数据";
  els.chartEmpty.hidden = metrics.length > 0 && points.length > 0;

  if (!window.echarts || metrics.length === 0 || points.length === 0) {
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

  const createSeries = ({ name, field, values, color, seriesIndex }) => {
    currentSeriesRaw[name] = { id: field.id, values };
    const chartValues = state.normalize && metrics.length > 1 ? normalizeValues(values) : values;

    return {
      name,
      type: "line",
      smooth: true,
      showSymbol: points.length <= 1,
      symbolSize: 6,
      data: chartValues,
      lineStyle: {
        width: 2
      },
      areaStyle: {
        opacity: compareMode ? 0.06 : 0.14
      },
      emphasis: {
        focus: "series"
      },
      color: color || chartPalette[seriesIndex % chartPalette.length]
    };
  };

  const series = compareMode
    ? compareGroups.flatMap((group, campaignIndex) => metrics.map((id, metricIndex) => {
      const field = fieldById.get(id);
      const values = group.points.map((point) => Number(point[id] || 0));
      const name = metrics.length === 1 ? group.campaign.name : `${group.campaign.name} · ${field.label}`;
      return createSeries({
        name,
        field,
        values,
        color: chartPalette[(campaignIndex * metrics.length + metricIndex) % chartPalette.length],
        seriesIndex: campaignIndex * metrics.length + metricIndex
      });
    }))
    : metrics.map((id, seriesIndex) => {
      const field = fieldById.get(id);
      const values = points.map((point) => Number(point[id] || 0));
      return createSeries({
        name: field.label,
        field,
        values,
        color: field.color,
        seriesIndex
      });
    });

  chart.setOption({
    animationDuration: 420,
    color: series.map((item) => item.color),
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
  els.tableCaption.textContent = formatRangeText();
}

function calculateTotals(rows) {
  const total = createAccumulator();
  rows.forEach((row) => addToAccumulator(total, row));
  return deriveMetrics(total);
}

function renderDashboard() {
  coerceGranularity();
  syncGranularityButtons();
  const rows = getFilteredRows();
  const timePoints = aggregateByTime(rows);
  const campaignRows = aggregateByCampaign(rows);
  const total = calculateTotals(rows);

  lastChartData = timePoints;
  lastChartRows = rows;
  lastCampaignRows = campaignRows;

  renderKpis(total);
  renderMetricGrid(total);
  renderChart(timePoints, rows);
  renderTable(campaignRows);
  syncFieldSummary();
  renderActiveChips();
}

function latestDataDate() {
  if (rawRows.length === 0) {
    return new Date();
  }
  const maxTimestamp = Math.max(...rawRows.map((row) => row.timestamp));
  return new Date(maxTimestamp);
}

function sameDate(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function currentHour() {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  return now;
}

function updateTimeControls() {
  els.fromDate.value = state.from;
  els.toDate.value = state.to;
  const bounds = selectedRangeBounds();
  if (bounds) {
    els.fromMonth.value = toMonthInputValue(bounds.from);
    els.toMonth.value = toMonthInputValue(bounds.to);
  }
}

function syncQuickWindowButtons() {
  document.querySelectorAll("[data-window-days], [data-window-preset]").forEach((button) => {
    const key = button.dataset.windowPreset || `last${button.dataset.windowDays}`;
    button.classList.toggle("active", key === state.activeWindowPreset);
  });
}

function setWindowRange(from, to, preset = "", preferredGranularity = "") {
  if (from > to) {
    [from, to] = [to, from];
  }
  state.from = toDateTimeInputValue(from);
  state.to = toDateTimeInputValue(to);
  state.activeWindowPreset = preset;
  updateTimeControls();
  syncQuickWindowButtons();
  coerceGranularity();
  if (preferredGranularity && granularityAvailability(preferredGranularity).allowed) {
    state.granularity = preferredGranularity;
  }
  syncGranularityButtons();
}

function setWindowDays(days) {
  const to = currentHour();
  const from = startOfDay(addDays(to, -(days - 1)));
  setWindowRange(from, to, `last${days}`, days <= 3 ? "hour" : "day");
}

function setWindowPreset(preset) {
  const now = currentHour();
  if (preset === "today") {
    setWindowRange(startOfDay(now), now, "today", "hour");
    return;
  }

  if (preset === "yesterday") {
    const yesterday = addDays(now, -1);
    setWindowRange(startOfDay(yesterday), endOfDay(yesterday), "yesterday", "hour");
    return;
  }

  if (preset === "last3") {
    const from = startOfDay(addDays(now, -2));
    setWindowRange(from, now, "last3", "hour");
  }
}

function applyMonthWindow() {
  if (!els.fromMonth.value || !els.toMonth.value) {
    return;
  }

  let from = monthStart(els.fromMonth.value);
  let to = monthEnd(els.toMonth.value);
  if (from > to) {
    [from, to] = [monthStart(els.toMonth.value), monthEnd(els.fromMonth.value)];
  }
  setWindowRange(from, to, "", "month");
}

function normalizeDateInputs() {
  const from = parseDateInput(els.fromDate.value);
  const to = parseDateInput(els.toDate.value);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    return;
  }
  setWindowRange(from, to);
}

function setDefaultWindow() {
  const latest = latestDataDate();
  const now = currentHour();
  if (sameDate(latest, now)) {
    setWindowPreset("today");
    return;
  }
  const yesterday = addDays(now, -1);
  if (sameDate(latest, yesterday)) {
    setWindowPreset("yesterday");
    return;
  }
  setWindowRange(startOfDay(latest), endOfDay(latest));
}

function syncGranularityButtons() {
  document.querySelectorAll("[data-granularity]").forEach((button) => {
    const availability = granularityAvailability(button.dataset.granularity);
    button.classList.toggle("active", button.dataset.granularity === state.granularity);
    button.classList.toggle("is-disabled", !availability.allowed);
    button.setAttribute("aria-disabled", String(!availability.allowed));
    button.title = availability.reason;
    button.dataset.tooltip = availability.reason;
  });
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.view;
      renderView();
    });
  });

  document.querySelectorAll("[data-settings-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeSettingsTab = button.dataset.settingsTab;
      renderSettingsTabs();
    });
  });

  els.moreOptionsToggle.addEventListener("click", () => {
    const nextOpen = els.optionsPanel.hidden;
    els.optionsPanel.hidden = !nextOpen;
    els.moreOptionsToggle.setAttribute("aria-expanded", String(nextOpen));
    if (nextOpen) {
      els.campaignFilter.focus();
    }
  });

  els.fromDate.addEventListener("change", () => {
    normalizeDateInputs();
    renderDashboard();
  });

  els.toDate.addEventListener("change", () => {
    normalizeDateInputs();
    renderDashboard();
  });

  els.fromMonth.addEventListener("change", () => {
    applyMonthWindow();
    renderDashboard();
  });

  els.toMonth.addEventListener("change", () => {
    applyMonthWindow();
    renderDashboard();
  });

  document.querySelectorAll("[data-granularity]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextGranularity = button.dataset.granularity;
      if (!granularityAvailability(nextGranularity).allowed) {
        return;
      }
      state.granularity = nextGranularity;
      syncGranularityButtons();
      renderDashboard();
    });
  });

  els.campaignFilter.addEventListener("change", () => {
    if (isSyncingSelects) {
      return;
    }
    state.selectedCampaigns = new Set(selectedControlValues(els.campaignFilter, campaignSelect));
    renderDashboard();
  });

  els.deliveryFilter.addEventListener("change", () => {
    state.delivery = els.deliveryFilter.value;
    renderDashboard();
  });

  els.normalizeToggle.addEventListener("change", () => {
    state.normalize = els.normalizeToggle.checked;
    renderChart(lastChartData, lastChartRows);
  });

  els.fieldFilter.addEventListener("change", () => {
    if (isSyncingSelects) {
      return;
    }
    state.selectedFields = new Set(selectedControlValues(els.fieldFilter, fieldSelect));
    renderDashboard();
  });

  document.querySelectorAll("[data-field-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.fieldAction;
      if (action === "core") {
        state.selectedFields = new Set(coreFields);
      }
      if (action === "allMetrics") {
        state.selectedFields = new Set(metricFieldIds);
      }
      if (action === "clear") {
        state.selectedFields = new Set();
      }
      syncFieldChoiceSelection();
      renderDashboard();
    });
  });

  document.querySelectorAll("[data-window-days]").forEach((button) => {
    button.addEventListener("click", () => {
      setWindowDays(Number(button.dataset.windowDays));
      renderDashboard();
    });
  });

  document.querySelectorAll("[data-window-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      setWindowPreset(button.dataset.windowPreset);
      renderDashboard();
    });
  });

  els.resetWindowButton.addEventListener("click", () => {
    setDefaultWindow();
    if (chart) {
      chart.dispatchAction({ type: "dataZoom", start: 0, end: 100 });
    }
    renderDashboard();
  });

  els.reloadSettingsButton.addEventListener("click", () => {
    loadSettings("已刷新");
  });

  els.saveSettingsButton.addEventListener("click", () => {
    saveSettings();
  });

  [
    els.targetedEnabled,
    els.targetedLevelSelect,
    els.targetedIdsInput,
    els.targetedIntervalInput,
    els.targetedDatePresetSelect,
    els.targetedResultActionInput,
    els.activeCampaignsEnabled,
    els.activeCampaignIntervalInput,
    els.activeCampaignDatePresetSelect,
    els.activeCampaignLimitInput,
    els.activeCampaignResultActionInput
  ].forEach((input) => {
    input.addEventListener("change", () => {
      state.samplingSettings = collectSamplingSettings();
      renderSamplingSettings();
    });
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

async function init() {
  rawRows = await loadCollectedRows() || buildRawRows();
  await loadSettings();
  renderFilters();
  initChoicePickers();
  setDefaultWindow();
  els.normalizeToggle.checked = state.normalize;
  bindEvents();
  renderDashboard();
  renderView();
  renderSettingsTabs();
  initIcons();
}

init();
