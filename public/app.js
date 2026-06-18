const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;
const MAX_BUCKETS = {
  hour: 24 * 7 + 1,
  day: 190,
  week: 260,
  month: 120
};
const GRANULARITY_MIN_DAYS = {
  week: 7,
  month: 28
};
const DISPLAY_TIME_ZONE = "Asia/Shanghai";
const DISPLAY_TIME_ZONE_LABEL = "北京时间";
const DISPLAY_TIME_ZONE_OFFSET_LABEL = "UTC+8";
const displayClockFormatter = new Intl.DateTimeFormat("en-US-u-nu-latn", {
  timeZone: DISPLAY_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

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
window.fbDashboardMetricFields = metricFields.map(({ id, label, unit, color }) => ({ id, label, unit, color }));
const defaultFields = ["spend", "roas", "ctr_all", "clicks_all", "add_to_cart", "initiate_checkout", "purchases"];
const coreFields = ["spend", "roas", "ctr_all", "clicks_all", "results", "cost_per_result"];
const sumKeys = ["budget", "spend", "impressions", "clicks_all", "reach", "add_to_cart", "initiate_checkout", "purchases", "revenue", "results", "actions"];
const ACTIVE_RESOURCE_ACCOUNT_ID = "8462513793771963";
const RESOURCE_LIMITS = {
  campaigns: Number.POSITIVE_INFINITY,
  ads: Number.POSITIVE_INFINITY
};
const RESOURCE_SELECTED_PAGE_SIZE = 8;
const COLLECTION_PAGE_SIZE = 50;
const COLLECTION_REFRESH_INTERVAL_MS = 2000;
const MONITOR_STATUS_REFRESH_INTERVAL_MS = 15000;

const state = {
  appReady: false,
  eventsBound: false,
  auth: {
    authenticated: false,
    user: null,
    permissions: new Set(),
    csrfToken: "",
    loginVisible: false,
    loginMessage: ""
  },
  activeView: "chart",
  activeSettingsTab: "monitors",
  listMode: "campaigns",
  selectedAdId: "",
  granularity: "day",
  selectedFields: new Set(defaultFields),
  selectedCampaigns: new Set(),
  selectedAds: new Set(),
  delivery: "all",
  normalize: true,
  from: "",
  to: "",
  activeWindowPreset: "",
  monitoredAccounts: [],
  monitorStatus: null,
  collectionQueue: null,
  collectionRunner: null,
  collectionWatchdog: null,
  collectionWatchdogManual: false,
  collectionWatchdogManualUntil: 0,
  collectionPage: 1,
  collectionRunId: "",
  collectionRunPreviewResolver: null,
  monitorRunFilter: "all",
  collectionLoading: false,
  collectionRefreshTimer: null,
  monitorStatusRefreshTimer: null,
  environmentSettings: null,
  environmentError: "",
  resourceCatalog: {
    account_id: ACTIVE_RESOURCE_ACCOUNT_ID,
    stale: true,
    campaigns: [],
    ads: [],
    counts: {
      campaigns: { total: 0, active: 0 },
      adsets: { total: 0, active: 0 },
      ads: { total: 0, active: 0, chain_active: 0 }
    },
    last_synced_at: ""
  },
  resourceRefresh: null,
  resourceUi: {
    campaigns: {
      open: false,
      query: "",
      editingId: "",
      selectedPage: 1
    },
    ads: {
      open: false,
      query: "",
      editingId: "",
      selectedPage: 1
    }
  },
  filterPickers: {
    campaigns: { open: false, query: "" },
    ads: { open: false, query: "" },
    delivery: { open: false, query: "" },
    fields: { open: false, query: "" }
  },
  savedSettingsSnapshot: "",
  settingsLoaded: false,
  settingsLoading: false,
  settingsLoadPromise: null,
  settingsMessage: "",
  samplingSettings: {
    campaignMonitor: {
      enabled: true,
      intervalMinutes: 180,
      accountIds: [],
      autoActiveCampaigns: true,
      campaignIds: [],
      datePreset: "",
      resultAction: "",
      hourly: true,
      concurrency: 20,
      qps: 5,
      requestTimeoutMs: 7000,
      maxAttempts: 8
    },
    adMonitor: {
      enabled: true,
      intervalMinutes: 60,
      adIds: [],
      datePreset: "",
      resultAction: "",
      hourly: true,
      concurrency: 20,
      qps: 5,
      requestTimeoutMs: 7000,
      maxAttempts: 8
    },
    targeted: {
      enabled: false,
      level: "ads",
      ids: [],
      intervalMinutes: 15,
      datePreset: "",
      resultAction: "",
      hourly: true
    },
    activeCampaigns: {
      enabled: true,
      intervalMinutes: 60,
      datePreset: "",
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
  list: {
    title: "FB 广告列表看板",
    subtitle: "查看核心指标、广告系列与广告明细，并从列表下钻单个广告趋势。"
  },
  alerts: {
    title: "广告预警监控",
    subtitle: "管理预警模板、历史预警消息和消息推送记录。"
  },
  analysis: {
    title: "AI 分析报告",
    subtitle: "调用 DeepSeek 分析真实采集数据并输出结论。"
  },
  settings: {
    title: "设置",
    subtitle: "配置用于采集和看板展示的监控账户。"
  },
  tasks: {
    title: "任务进度",
    subtitle: "按采集批次查看当前进度、历史批次和队列运行状态。"
  }
};

let chart;
let listChart;
let rawRows = [];
let lastChartData = [];
let lastChartRows = [];
let lastCampaignRows = [];
let currentSeriesRaw = {};
let adOptions = [];
let isSyncingSelects = false;
let iconRefreshPending = false;

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

const iconPaths = {
  "layout-dashboard": ["M3 3h8v8H3z", "M13 3h8v5h-8z", "M13 10h8v11h-8z", "M3 13h8v8H3z"],
  "area-chart": ["M3 3v18h18", "M7 15l4-4 4 4 5-8"],
  "gauge": ["M4 14a8 8 0 0 1 16 0", "M12 14l4-4", "M8 18h8"],
  "list-filter": ["M3 6h18", "M6 12h12", "M10 18h4"],
  "bell-ring": ["M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9", "M10.3 21a2 2 0 0 0 3.4 0", "M4 2 2 4", "M20 2l2 2"],
  "settings": ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8", "M12 2v3", "M12 19v3", "M4.9 4.9l2.1 2.1", "M17 17l2.1 2.1", "M2 12h3", "M19 12h3", "M4.9 19.1 7 17", "M17 7l2.1-2.1"],
  "rotate-ccw": ["M3 12a9 9 0 1 0 3-6.7", "M3 3v6h6"],
  "sliders-horizontal": ["M3 6h10", "M17 6h4", "M14 4v4", "M3 12h4", "M11 12h10", "M8 10v4", "M3 18h12", "M19 18h2", "M16 16v4"],
  "chevron-down": ["M6 9l6 6 6-6"],
  "chevron-left": ["M15 18l-6-6 6-6"],
  "chevron-right": ["M9 18l6-6-6-6"],
  "chevrons-left": ["M11 17l-5-5 5-5", "M18 17l-5-5 5-5"],
  "chevrons-right": ["M6 17l5-5-5-5", "M13 17l5-5-5-5"],
  "refresh-cw": ["M21 12a9 9 0 0 1-15.5 6.2", "M21 3v6h-6", "M3 12a9 9 0 0 1 15.5-6.2", "M3 21v-6h6"],
  "database-zap": ["M4 6c0 2 4 3 8 3s8-1 8-3-4-3-8-3-8 1-8 3z", "M4 6v6c0 2 4 3 8 3h1", "M4 12v6c0 2 4 3 8 3h1", "M17 12l-3 5h4l-2 5 5-7h-4l2-3z"],
  "undo-2": ["M9 14 4 9l5-5", "M4 9h10a6 6 0 0 1 0 12h-2"],
  "save": ["M5 3h14l2 2v16H3V3h2z", "M7 3v6h10V3", "M7 21v-8h10v8"],
  "search": ["M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z", "M21 21l-4.3-4.3"],
  "check": ["M20 6 9 17l-5-5"],
  "x": ["M18 6 6 18", "M6 6l12 12"],
  "plus": ["M12 5v14", "M5 12h14"],
  "pencil": ["M17 3l4 4L8 20H4v-4L17 3z", "M15 5l4 4"],
  "copy": ["M8 8h12v12H8z", "M4 16V4h12"],
  "download": ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"],
  "send": ["M22 2 11 13", "M22 2l-7 20-4-9-9-4 20-7z"],
  "sparkles": ["M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z", "M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z", "M5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14z"],
  "file-text": ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6", "M8 13h8", "M8 17h8", "M8 9h2"],
  "triangle-alert": ["M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z", "M12 9v4", "M12 17h.01"],
  "trash-2": ["M3 6h18", "M8 6V4h8v2", "M6 6l1 16h10l1-16", "M10 11v6", "M14 11v6"],
  "wrench": ["M14.7 6.3a4 4 0 0 0-5 5L3 18v3h3l6.7-6.7a4 4 0 0 0 5-5l-3 3-3-3 3-3z"]
};

const els = {
  pageTitle: document.getElementById("pageTitle"),
  pageSubtitle: document.getElementById("pageSubtitle"),
  moreOptionsToggle: document.getElementById("moreOptionsToggle"),
  optionsPanel: document.getElementById("optionsPanel"),
  activeChips: document.getElementById("activeChips"),
  fromDate: document.getElementById("fromDate"),
  toDate: document.getElementById("toDate"),
  campaignFilter: document.getElementById("campaignFilter"),
  campaignFilterToggle: document.getElementById("campaignFilterToggle"),
  campaignFilterLabel: document.getElementById("campaignFilterLabel"),
  campaignFilterDropdown: document.getElementById("campaignFilterDropdown"),
  campaignFilterSearch: document.getElementById("campaignFilterSearch"),
  campaignFilterOptionList: document.getElementById("campaignFilterOptionList"),
  campaignFilterSelectedList: document.getElementById("campaignFilterSelectedList"),
  adFilter: document.getElementById("adFilter"),
  adFilterToggle: document.getElementById("adFilterToggle"),
  adFilterLabel: document.getElementById("adFilterLabel"),
  adFilterDropdown: document.getElementById("adFilterDropdown"),
  adFilterSearch: document.getElementById("adFilterSearch"),
  adFilterOptionList: document.getElementById("adFilterOptionList"),
  adFilterSelectedList: document.getElementById("adFilterSelectedList"),
  deliveryFilter: document.getElementById("deliveryFilter"),
  deliveryFilterToggle: document.getElementById("deliveryFilterToggle"),
  deliveryFilterLabel: document.getElementById("deliveryFilterLabel"),
  deliveryFilterDropdown: document.getElementById("deliveryFilterDropdown"),
  deliveryFilterSearch: document.getElementById("deliveryFilterSearch"),
  deliveryFilterOptionList: document.getElementById("deliveryFilterOptionList"),
  fieldFilter: document.getElementById("fieldFilter"),
  fieldFilterToggle: document.getElementById("fieldFilterToggle"),
  fieldFilterLabel: document.getElementById("fieldFilterLabel"),
  fieldFilterDropdown: document.getElementById("fieldFilterDropdown"),
  fieldFilterSearch: document.getElementById("fieldFilterSearch"),
  fieldFilterOptionList: document.getElementById("fieldFilterOptionList"),
  fieldFilterSelectedList: document.getElementById("fieldFilterSelectedList"),
  fieldSummary: document.getElementById("fieldSummary"),
  viewToolbar: document.getElementById("viewToolbar"),
  chartCaption: document.getElementById("chartCaption"),
  metricCaption: document.getElementById("metricCaption"),
  metricGrid: document.getElementById("metricGrid"),
  tableTitle: document.getElementById("tableTitle"),
  tableCaption: document.getElementById("tableCaption"),
  tableCount: document.getElementById("tableCount"),
  listAdChartPanel: document.getElementById("listAdChartPanel"),
  listAdChartTitle: document.getElementById("listAdChartTitle"),
  listAdChartCaption: document.getElementById("listAdChartCaption"),
  listAdChart: document.getElementById("listAdChart"),
  listAdChartEmpty: document.getElementById("listAdChartEmpty"),
  clearAdDrilldownButton: document.getElementById("clearAdDrilldownButton"),
  normalizeToggle: document.getElementById("normalizeToggle"),
  kpiGrid: document.getElementById("kpiGrid"),
  tableHead: document.getElementById("tableHead"),
  tableBody: document.getElementById("tableBody"),
  chartEmpty: document.getElementById("chartEmpty"),
  mainChart: document.getElementById("mainChart"),
  resetWindowButton: document.getElementById("resetWindowButton"),
  settingsCaption: document.getElementById("settingsCaption"),
  monitorStatusGrid: document.getElementById("monitorStatusGrid"),
  collectionConsoleGrid: document.getElementById("collectionConsoleGrid"),
  collectionJobsList: document.getElementById("collectionJobsList"),
  collectionRunList: document.getElementById("collectionRunList"),
  collectionQueueCaption: document.getElementById("collectionQueueCaption"),
  collectionCurrentCaption: document.getElementById("collectionCurrentCaption"),
  collectionProgressFill: document.getElementById("collectionProgressFill"),
  collectionProgressLabel: document.getElementById("collectionProgressLabel"),
  collectionPageInfo: document.getElementById("collectionPageInfo"),
  collectionRunModeSelect: document.getElementById("collectionRunModeSelect"),
  refreshCollectionQueueButton: document.getElementById("refreshCollectionQueueButton"),
  recoverCollectionQueueButton: document.getElementById("recoverCollectionQueueButton"),
  runCollectionQueueButton: document.getElementById("runCollectionQueueButton"),
  collectionRunPreviewModal: document.getElementById("collectionRunPreviewModal"),
  collectionRunPreviewBody: document.getElementById("collectionRunPreviewBody"),
  collectionRunPreviewCloseButton: document.getElementById("collectionRunPreviewCloseButton"),
  collectionRunPreviewCancelButton: document.getElementById("collectionRunPreviewCancelButton"),
  collectionRunPreviewConfirmButton: document.getElementById("collectionRunPreviewConfirmButton"),
  envConfigCaption: document.getElementById("envConfigCaption"),
  envFileStatus: document.getElementById("envFileStatus"),
  envConfigGrid: document.getElementById("envConfigGrid"),
  monitorAccountsInput: document.getElementById("monitorAccountsInput"),
  settingsStatus: document.getElementById("settingsStatus"),
  reloadSettingsButton: document.getElementById("reloadSettingsButton"),
  refreshResourcesButton: document.getElementById("refreshResourcesButton"),
  resetSettingsButton: document.getElementById("resetSettingsButton"),
  saveSettingsButton: document.getElementById("saveSettingsButton"),
  campaignMonitorEnabled: document.getElementById("campaignMonitorEnabled"),
  campaignIntervalInput: document.getElementById("campaignIntervalInput"),
  campaignResultActionInput: document.getElementById("campaignResultActionInput"),
  campaignConcurrencyInput: document.getElementById("campaignConcurrencyInput"),
  campaignQpsInput: document.getElementById("campaignQpsInput"),
  campaignTimeoutInput: document.getElementById("campaignTimeoutInput"),
  campaignMaxAttemptsInput: document.getElementById("campaignMaxAttemptsInput"),
  campaignAutoActiveInput: document.getElementById("campaignAutoActiveInput"),
  campaignIdsInput: document.getElementById("campaignIdsInput"),
  campaignPickerToggle: document.getElementById("campaignPickerToggle"),
  campaignPickerDropdown: document.getElementById("campaignPickerDropdown"),
  campaignPickerLabel: document.getElementById("campaignPickerLabel"),
  campaignPickerMeta: document.getElementById("campaignPickerMeta"),
  campaignSearchInput: document.getElementById("campaignSearchInput"),
  campaignManualIdInput: document.getElementById("campaignManualIdInput"),
  campaignOptionList: document.getElementById("campaignOptionList"),
  campaignSelectedList: document.getElementById("campaignSelectedList"),
  adMonitorEnabled: document.getElementById("adMonitorEnabled"),
  adIntervalInput: document.getElementById("adIntervalInput"),
  adResultActionInput: document.getElementById("adResultActionInput"),
  adConcurrencyInput: document.getElementById("adConcurrencyInput"),
  adQpsInput: document.getElementById("adQpsInput"),
  adTimeoutInput: document.getElementById("adTimeoutInput"),
  adMaxAttemptsInput: document.getElementById("adMaxAttemptsInput"),
  adIdsInput: document.getElementById("adIdsInput"),
  adPickerToggle: document.getElementById("adPickerToggle"),
  adPickerDropdown: document.getElementById("adPickerDropdown"),
  adPickerLabel: document.getElementById("adPickerLabel"),
  adPickerMeta: document.getElementById("adPickerMeta"),
  adSearchInput: document.getElementById("adSearchInput"),
  adManualIdInput: document.getElementById("adManualIdInput"),
  adOptionList: document.getElementById("adOptionList"),
  adSelectedList: document.getElementById("adSelectedList"),
  recentRunsFilter: document.getElementById("recentRunsFilter"),
  recentRunsBody: document.getElementById("recentRunsBody")
};

const dataSourceName = document.getElementById("dataSourceName");
const dataSourceMeta = document.getElementById("dataSourceMeta");
const nativeFetch = window.fetch.bind(window);

function hasPermission(permission) {
  return state.auth.permissions.has(permission) || state.auth.user?.role === "admin";
}

function dashboardPermission(permission) {
  if (permission === "alerts.manage") return false;
  return hasPermission(permission);
}

function setAuthState(payload = {}) {
  state.auth.authenticated = Boolean(payload.user);
  state.auth.user = payload.user || null;
  state.auth.permissions = new Set(Array.isArray(payload.permissions) ? payload.permissions : []);
  state.auth.csrfToken = payload.csrfToken || "";
}

async function apiFetch(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = {
    ...(options.headers || {})
  };
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers["X-CSRF-Token"] = state.auth.csrfToken;
  }
  const response = await nativeFetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    ...options,
    headers
  });
  if (response.status === 401) {
    setAuthState({});
    redirectToPlatformLogin("/ads");
    throw new Error("请先登录");
  }
  if (response.status === 403) {
    throw new Error("当前账号没有权限执行该操作");
  }
  return response;
}

window.apiFetch = apiFetch;
window.fbHasPermission = dashboardPermission;

function redirectToPlatformLogin(returnPath = window.location.pathname + window.location.search) {
  const safePath = String(returnPath || "/ads");
  window.location.href = `/login.html?return=${encodeURIComponent(safePath)}`;
}

function authOverlayHtml(message = "") {
  return `
    <div class="auth-panel">
      <div class="auth-brand">
        <img src="/favicon.svg?v=20260611-4" alt="">
        <div>
          <strong>广告看板</strong>
          <span>Meta Insights</span>
        </div>
      </div>
      <form id="authLoginForm" class="auth-form">
        <h2>登录</h2>
        <label>
          <span>用户名</span>
          <input id="authUsernameInput" name="username" autocomplete="username" required>
        </label>
        <label>
          <span>密码</span>
          <input id="authPasswordInput" name="password" type="password" autocomplete="current-password" required>
        </label>
        <p class="auth-message" id="authLoginMessage">${escapeHtml(message)}</p>
        <button class="primary-button" type="submit">
          <i data-lucide="check"></i>
          <span>登录</span>
        </button>
      </form>
    </div>
  `;
}

function ensureLoginOverlay() {
  let overlay = document.getElementById("authOverlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "authOverlay";
  overlay.className = "auth-overlay";
  overlay.hidden = true;
  document.body.appendChild(overlay);
  overlay.addEventListener("submit", async (event) => {
    if (event.target.id !== "authLoginForm") return;
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector("button[type='submit']");
    const message = form.querySelector("#authLoginMessage");
    button.disabled = true;
    message.textContent = "登录中";
    try {
      const response = await nativeFetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          username: form.username.value,
          password: form.password.value
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || "登录失败");
      }
      setAuthState(payload);
      hideLogin();
      await initializeApplication();
    } catch (error) {
      message.textContent = error.message || "登录失败";
    } finally {
      button.disabled = false;
    }
  });
  return overlay;
}

function showLogin(message = "") {
  const overlay = ensureLoginOverlay();
  state.auth.loginVisible = true;
  overlay.innerHTML = authOverlayHtml(message);
  overlay.hidden = false;
  initIcons();
  requestAnimationFrame(() => overlay.querySelector("#authUsernameInput")?.focus());
}

function hideLogin() {
  const overlay = ensureLoginOverlay();
  overlay.hidden = true;
  overlay.innerHTML = "";
  state.auth.loginVisible = false;
}

async function loadAuthSession() {
  try {
    const response = await nativeFetch("/api/auth/me", {
      credentials: "same-origin",
      cache: "no-store"
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      setAuthState({});
      return false;
    }
    setAuthState(payload);
    return true;
  } catch {
    setAuthState({});
    return false;
  }
}

async function logout() {
  try {
    await apiFetch("/api/auth/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: "{}"
    });
  } catch {
    // The local session is cleared even when the request cannot complete.
  }
  setAuthState({});
  state.appReady = false;
  window.location.reload();
}

function renderAuthUser() {
  let authBar = document.getElementById("authUserBar");
  if (!authBar) {
    authBar = document.createElement("div");
    authBar.id = "authUserBar";
    authBar.className = "auth-user-bar";
    document.querySelector(".top-actions")?.appendChild(authBar);
  }
  const user = state.auth.user;
  authBar.innerHTML = user ? `
    <span>${escapeHtml(user.displayName || user.username)}</span>
    <small>${escapeHtml(user.role === "admin" ? "管理员" : "用户")}</small>
    <button class="secondary-button" id="logoutButton" type="button">退出</button>
  ` : "";
  authBar.querySelector("#logoutButton")?.addEventListener("click", logout);
}

function applyPermissionVisibility() {
  const visibility = {
    settings: false,
    tasks: false,
    alerts: hasPermission("alerts.read"),
    analysis: hasPermission("reports.generate")
  };
  Object.entries(visibility).forEach(([view, visible]) => {
    document.querySelectorAll(`[data-view="${view}"]`).forEach((button) => {
      button.hidden = !visible;
    });
  });
  if (state.activeView === "settings" && !visibility.settings) state.activeView = "chart";
  if (state.activeView === "tasks" && !visibility.tasks) state.activeView = "chart";
  if (state.activeView === "alerts" && !visibility.alerts) state.activeView = "chart";
  if (state.activeView === "analysis" && !visibility.analysis) state.activeView = "chart";
  renderAuthUser();
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function invalidDate() {
  return new Date(Number.NaN);
}

function displayPartsFromInstant(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  const parts = Object.fromEntries(
    displayClockFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second
  };
}

function clockDateFromParts(parts) {
  return new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour || 0,
    parts.minute || 0,
    parts.second || 0,
    0
  ));
}

function clockDateFromInstant(value) {
  const parts = displayPartsFromInstant(value);
  return parts ? clockDateFromParts(parts) : invalidDate();
}

function nowDisplayClockDate() {
  return clockDateFromInstant(new Date());
}

function parseDateTimeParts(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?/);
  if (!match) {
    return null;
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: match[4] === undefined ? 0 : Number(match[4]),
    minute: match[5] === undefined ? 0 : Number(match[5]),
    second: match[6] === undefined ? 0 : Number(match[6]),
    hasTime: match[4] !== undefined
  };
}

function hasExplicitOffset(value) {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(value || "").trim());
}

function toDateValue(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function toDateTimeInputValue(date) {
  return `${toDateValue(date)}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function startOfDay(date) {
  const next = new Date(date);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date) {
  const next = new Date(date);
  next.setUTCHours(23, 0, 0, 0);
  return next;
}

function parseDateInput(value, endOfRange = false) {
  const parts = parseDateTimeParts(value);
  if (!parts) return invalidDate();
  const date = clockDateFromParts(parts);
  if (endOfRange && !parts.hasTime) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
}

function timestampFromCollectedTime(value) {
  if (!value) return Number.NaN;
  if (hasExplicitOffset(value)) {
    return clockDateFromInstant(value).getTime();
  }
  return parseDateInput(value).getTime();
}

function formatInstantInDisplayTimeZone(value) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  const clockDate = clockDateFromInstant(date);
  if (!Number.isFinite(clockDate.getTime())) {
    return String(value).slice(0, 19).replace("T", " ");
  }
  return `${toDateTimeInputValue(clockDate).replace("T", " ")} ${DISPLAY_TIME_ZONE_OFFSET_LABEL}`;
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function startOfWeek(date) {
  const next = new Date(date);
  const day = next.getUTCDay() || 7;
  next.setUTCDate(next.getUTCDate() - day + 1);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function labelForBucket(date, granularity) {
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hour = pad(date.getUTCHours());

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
    next.setUTCMinutes(0, 0, 0);
    return next;
  }
  if (granularity === "week") {
    return startOfWeek(next);
  }
  if (granularity === "month") {
    next.setUTCDate(1);
  }
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function nextBucketDate(date, granularity) {
  const next = new Date(date);
  if (granularity === "hour") {
    next.setUTCHours(next.getUTCHours() + 1, 0, 0, 0);
    return next;
  }
  if (granularity === "day") {
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(0, 0, 0, 0);
    return next;
  }
  if (granularity === "week") {
    next.setUTCDate(next.getUTCDate() + 7);
    next.setUTCHours(0, 0, 0, 0);
    return next;
  }
  next.setUTCMonth(next.getUTCMonth() + 1, 1);
  next.setUTCHours(0, 0, 0, 0);
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
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() + 1;
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
  const today = nowDisplayClockDate();
  today.setUTCHours(23, 0, 0, 0);
  const start = addDays(today, -180);
  start.setUTCHours(0, 0, 0, 0);
  const rows = [];

  for (let time = start.getTime(); time <= today.getTime(); time += MS_HOUR) {
    const date = new Date(time);
    const dayIndex = Math.floor((time - start.getTime()) / MS_DAY);
    const hour = date.getUTCHours();
    const weekday = date.getUTCDay();
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
      const adIndex = 1 + Math.floor(seededNoise(dayIndex * 29 + hour * 7 + index * 11) * 3);
      const adId = `${campaign.id}_ad_${adIndex}`;
      const adsetId = `${campaign.id}_set_${adIndex}`;

      rows.push({
        timestamp: time,
        account: "Demo Account",
        accountId: "demo_account",
        campaign: campaign.name,
        campaignId: campaign.id,
        campaignName: campaign.name,
        adsetId,
        adsetName: `${campaign.name} · Set ${adIndex}`,
        adId,
        adName: `${campaign.name} · Creative ${adIndex}`,
        delivery: campaign.delivery,
        objective: campaign.objective,
        dataDate: labelForBucket(new Date(time), "day"),
        dataUpdatedAt: new Date(time + MS_HOUR).toISOString(),
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
  const timestampSource = row.hour_start_beijing
    || row.date_start_beijing
    || row.hour_start
    || (dateValue ? `${dateValue}T00:00:00` : '');
  const timestamp = timestampSource ? timestampFromCollectedTime(timestampSource) : nowDisplayClockDate().getTime();
  const spend = Number(row.spend || 0);
  const roas = Number(row.roas || 0);
  const purchaseValue = Number(row.purchase_value || 0) || spend * roas;
  const campaignId = row.campaign_id || row.adset_id || row.ad_id || row.campaign_name || "unknown";
  const campaignName = row.campaign_name || "";
  const adsetId = row.adset_id || "";
  const adsetName = row.adset_name || "";
  const adId = row.ad_id || "";
  const adName = row.ad_name || "";

  return {
    timestamp,
    account: row.account_name || row.account_id || "",
    accountId: row.account_id || "",
    campaign: campaignName || adsetName || adName || campaignId,
    campaignId,
    campaignName,
    adsetId,
    adsetName,
    adId,
    adName,
    delivery: row.effective_status || "未知",
    objective: row.result_type || "",
    dataDate: row.date_start_beijing || row.date_start || "",
    dataUpdatedAt: row.updated_at || "",
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
  const ads = new Map();
  rows.forEach((row) => {
    if (!campaigns.has(row.campaignId)) {
      campaigns.set(row.campaignId, {
        id: row.campaignId,
        name: row.campaignName || row.campaign,
        delivery: row.delivery,
        objective: row.objective,
        dailyBudget: 0,
        scale: 1,
        ctr: 0,
        aov: 0
      });
    }
    if (row.adId && !ads.has(row.adId)) {
      ads.set(row.adId, {
        id: row.adId,
        name: row.adName || row.adId,
        campaignId: row.campaignId,
        campaignName: row.campaignName || row.campaign || "",
        adsetId: row.adsetId || "",
        adsetName: row.adsetName || ""
      });
    }
  });

  if (campaigns.size > 0) {
    CAMPAIGNS.splice(0, CAMPAIGNS.length, ...campaigns.values());
  }
  adOptions = [...ads.values()].sort((a, b) => (
    String(a.campaignName || "").localeCompare(String(b.campaignName || ""), "zh-CN")
      || String(a.adsetName || "").localeCompare(String(b.adsetName || ""), "zh-CN")
      || String(a.name || "").localeCompare(String(b.name || ""), "zh-CN")
      || String(a.id).localeCompare(String(b.id))
  ));
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

function normalizeStoredDatePreset(value) {
  const text = String(value ?? "").trim();
  return text === "today" ? "" : text;
}

function normalizeSamplingSettings(settings = {}) {
  const targeted = settings.targeted || {};
  const activeCampaigns = settings.activeCampaigns || {};
  const campaignMonitor = settings.campaignMonitor || {};
  const adMonitor = settings.adMonitor || {};
  return {
    campaignMonitor: {
      enabled: campaignMonitor.enabled !== false,
      intervalMinutes: clampNumber(campaignMonitor.intervalMinutes, 180, 60, 360),
      accountIds: Array.isArray(campaignMonitor.accountIds) ? campaignMonitor.accountIds.filter((id) => /^\d{3,32}$/.test(String(id))) : [],
      autoActiveCampaigns: campaignMonitor.autoActiveCampaigns !== false,
      campaignIds: Array.isArray(campaignMonitor.campaignIds) ? campaignMonitor.campaignIds.filter((id) => /^\d{3,32}$/.test(String(id))) : [],
      datePreset: String(campaignMonitor.datePreset || "").trim(),
      resultAction: String(campaignMonitor.resultAction || "").trim(),
      hourly: campaignMonitor.hourly !== false,
      concurrency: clampNumber(campaignMonitor.concurrency, 20, 1, 20),
      qps: clampNumber(campaignMonitor.qps, 5, 1, 20),
      requestTimeoutMs: clampNumber(campaignMonitor.requestTimeoutMs, 7000, 1000, 60000),
      maxAttempts: clampNumber(campaignMonitor.maxAttempts, 8, 1, 20)
    },
    adMonitor: {
      enabled: adMonitor.enabled !== false,
      intervalMinutes: clampNumber(adMonitor.intervalMinutes, 60, 30, 180),
      adIds: Array.isArray(adMonitor.adIds) ? adMonitor.adIds.filter((id) => /^\d{3,32}$/.test(String(id))) : [],
      datePreset: String(adMonitor.datePreset || "").trim(),
      resultAction: String(adMonitor.resultAction || "").trim(),
      hourly: adMonitor.hourly !== false,
      concurrency: clampNumber(adMonitor.concurrency, 20, 1, 20),
      qps: clampNumber(adMonitor.qps, 5, 1, 20),
      requestTimeoutMs: clampNumber(adMonitor.requestTimeoutMs, 7000, 1000, 60000),
      maxAttempts: clampNumber(adMonitor.maxAttempts, 8, 1, 20)
    },
    targeted: {
      enabled: targeted.enabled === true,
      level: ["ads", "adsets"].includes(targeted.level) ? targeted.level : "ads",
      ids: Array.isArray(targeted.ids) ? targeted.ids.filter((id) => /^\d{3,32}$/.test(String(id))) : [],
      intervalMinutes: clampNumber(targeted.intervalMinutes, 15, 15, 30),
      datePreset: normalizeStoredDatePreset(targeted.datePreset),
      resultAction: String(targeted.resultAction || "").trim(),
      hourly: targeted.hourly !== false
    },
    activeCampaigns: {
      enabled: activeCampaigns.enabled !== false,
      intervalMinutes: clampNumber(activeCampaigns.intervalMinutes, 60, 30, 180),
      datePreset: normalizeStoredDatePreset(activeCampaigns.datePreset),
      resultAction: String(activeCampaigns.resultAction || "").trim(),
      limit: Math.max(0, Number.parseInt(activeCampaigns.limit, 10) || 0),
      hourly: activeCampaigns.hourly !== false
    }
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatIso(value) {
  return formatInstantInDisplayTimeZone(value);
}

function formatIsoWithSeconds(value) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  const clockDate = clockDateFromInstant(date);
  if (!Number.isFinite(clockDate.getTime())) {
    return String(value).slice(0, 19).replace("T", " ");
  }
  return `${toDateTimeInputValue(clockDate).replace("T", " ")}:${String(clockDate.getUTCSeconds()).padStart(2, "0")} ${DISPLAY_TIME_ZONE_OFFSET_LABEL}`;
}

function formatDuration(ms) {
  const value = Number(ms || 0);
  if (!value) return "-";
  if (value < 1000) return `${value}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
  return `${(value / 60_000).toFixed(1)}m`;
}

function formatPreviewSeconds(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  return value ? formatDuration(value * 1000) : "-";
}

function resourceKindConfig(kind) {
  if (kind === "campaigns") {
    return {
      idsKey: "campaignIds",
      monitorKey: "campaignMonitor",
      optionList: els.campaignOptionList,
      selectedList: els.campaignSelectedList,
      toggle: els.campaignPickerToggle,
      dropdown: els.campaignPickerDropdown,
      label: els.campaignPickerLabel,
      meta: els.campaignPickerMeta,
      search: els.campaignSearchInput,
      manualInput: els.campaignManualIdInput,
      limit: RESOURCE_LIMITS.campaigns,
      itemName: "广告系列"
    };
  }
  return {
    idsKey: "adIds",
    monitorKey: "adMonitor",
    optionList: els.adOptionList,
    selectedList: els.adSelectedList,
    toggle: els.adPickerToggle,
    dropdown: els.adPickerDropdown,
    label: els.adPickerLabel,
    meta: els.adPickerMeta,
    search: els.adSearchInput,
    manualInput: els.adManualIdInput,
    limit: RESOURCE_LIMITS.ads,
    itemName: "ad"
  };
}

function mapDashboardColumnRows(rows = [], columns = []) {
  const indexByColumn = new Map(columns.map((column, index) => [column, index]));
  const valueAt = (values, column, fallback = 0) => {
    const index = indexByColumn.get(column);
    return index === undefined ? fallback : values[index];
  };

  return rows.map((values) => ({
    timestamp: Number(valueAt(values, "timestamp", Number.NaN)),
    account: valueAt(values, "account", ""),
    accountId: valueAt(values, "accountId", ""),
    campaign: valueAt(values, "campaign", ""),
    campaignId: valueAt(values, "campaignId", "unknown"),
    campaignName: valueAt(values, "campaignName", ""),
    adsetId: valueAt(values, "adsetId", ""),
    adsetName: valueAt(values, "adsetName", ""),
    adId: valueAt(values, "adId", ""),
    adName: valueAt(values, "adName", ""),
    delivery: valueAt(values, "delivery", "未知"),
    objective: valueAt(values, "objective", ""),
    dataDate: valueAt(values, "dataDate", ""),
    dataUpdatedAt: valueAt(values, "dataUpdatedAt", ""),
    budget: Number(valueAt(values, "budget", 0)),
    spend: Number(valueAt(values, "spend", 0)),
    impressions: Number(valueAt(values, "impressions", 0)),
    clicks_all: Number(valueAt(values, "clicks_all", 0)),
    reach: Number(valueAt(values, "reach", 0)),
    add_to_cart: Number(valueAt(values, "add_to_cart", 0)),
    initiate_checkout: Number(valueAt(values, "initiate_checkout", 0)),
    purchases: Number(valueAt(values, "purchases", 0)),
    revenue: Number(valueAt(values, "revenue", 0)),
    results: Number(valueAt(values, "results", 0)),
    actions: Number(valueAt(values, "actions", 0))
  })).filter((row) => Number.isFinite(row.timestamp));
}

function resourceId(row, kind) {
  if (kind === "campaigns") return String(row?.campaign_id || row?.id || "").trim();
  return String(row?.ad_id || row?.id || "").trim();
}

function nameIdLabel(name, id) {
  const cleanName = String(name || "").trim();
  const cleanId = String(id || "").trim();
  return cleanName ? `${cleanName}|${cleanId}` : cleanId;
}

function resourcePrimaryLabel(row, kind) {
  const id = resourceId(row, kind);
  return nameIdLabel(row?.name, id);
}

function resourceSecondaryLabel(row, kind) {
  const freshness = [
    row?.latest_updated_at ? `更新 ${formatInstantInDisplayTimeZone(row.latest_updated_at)}` : "暂无采集更新",
    `最近一天消耗 ${formatValue("spend", row?.latest_day_spend || 0)}`
  ].join(" · ");
  if (kind === "campaigns") {
    return [
      row?.account_id ? `账户 ${row.account_id}` : "",
      row?.effective_status || row?.status || "ACTIVE",
      freshness
    ].filter(Boolean).join(" · ");
  }
  return [
    row?.campaign_name ? `广告系列 ${nameIdLabel(row.campaign_name, row.campaign_id)}` : `广告系列 ${row?.campaign_id || "-"}`,
    row?.adset_name ? `广告组 ${nameIdLabel(row.adset_name, row.adset_id)}` : `广告组 ${row?.adset_id || "-"}`,
    freshness
  ].join(" · ");
}

function resourceSearchText(row, kind) {
  return [
    resourcePrimaryLabel(row, kind),
    row?.account_id,
    row?.campaign_id,
    row?.campaign_name,
    row?.adset_id,
    row?.adset_name,
    row?.status,
    row?.effective_status
  ].filter(Boolean).join(" ").toLowerCase();
}

function resourceTooltip(row, kind) {
  return [
    resourcePrimaryLabel(row, kind),
    resourceSecondaryLabel(row, kind),
    `最近一天展示：${Number(row?.latest_impressions || 0).toLocaleString("en-US")}`,
    `最近一天点击：${Number(row?.latest_clicks || 0).toLocaleString("en-US")}`,
    `采集明细行数：${Number(row?.insight_row_count || 0).toLocaleString("en-US")}`,
    row?.synced_at ? `资源同步：${formatInstantInDisplayTimeZone(row.synced_at)}` : ""
  ].filter(Boolean).join("\n");
}

function selectedIdsForKind(kind) {
  const config = resourceKindConfig(kind);
  return state.samplingSettings[config.monitorKey][config.idsKey] || [];
}

function setSelectedIdsForKind(kind, ids) {
  const config = resourceKindConfig(kind);
  const normalized = [...new Set(ids.map((id) => String(id || "").trim()).filter((id) => /^\d{3,32}$/.test(id)))];
  state.samplingSettings[config.monitorKey][config.idsKey] = normalized.slice(0, config.limit);
  if (kind === "ads") {
    state.samplingSettings.targeted.ids = [...state.samplingSettings.adMonitor.adIds];
  }
  if (kind === "campaigns") {
    state.samplingSettings.activeCampaigns.limit = state.samplingSettings.campaignMonitor.campaignIds.length;
  }
}

function candidateRowsForKind(kind) {
  const rows = kind === "campaigns" ? state.resourceCatalog.campaigns : state.resourceCatalog.ads;
  return Array.isArray(rows) ? rows : [];
}

function candidateMapForKind(kind) {
  return new Map(candidateRowsForKind(kind).map((row) => [resourceId(row, kind), row]).filter(([id]) => id));
}

function filteredCandidateRows(kind) {
  const query = state.resourceUi[kind].query.trim().toLowerCase();
  const rows = candidateRowsForKind(kind);
  if (!query) return rows;
  return rows.filter((row) => resourceSearchText(row, kind).includes(query));
}

function selectedResourceRows(kind) {
  const candidates = candidateMapForKind(kind);
  return selectedIdsForKind(kind).map((id) => {
    const row = candidates.get(String(id));
    return row || { id, name: "", stale: true };
  });
}

function selectedResourcePageState(kind, rows) {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / RESOURCE_SELECTED_PAGE_SIZE));
  const requestedPage = Number.parseInt(state.resourceUi[kind].selectedPage, 10) || 1;
  const page = Math.min(pageCount, Math.max(1, requestedPage));
  const start = (page - 1) * RESOURCE_SELECTED_PAGE_SIZE;
  const end = Math.min(total, start + RESOURCE_SELECTED_PAGE_SIZE);
  state.resourceUi[kind].selectedPage = page;
  return {
    page,
    pageCount,
    total,
    start,
    end,
    rows: rows.slice(start, end)
  };
}

function settingsSnapshotFromCurrentForm() {
  return JSON.stringify({
    accounts: parseAccountInput(els.monitorAccountsInput.value),
    settings: collectSamplingSettings(),
    environment: collectEnvironmentEntries()
  });
}

function captureSavedSettingsSnapshot() {
  state.savedSettingsSnapshot = settingsSnapshotFromCurrentForm();
  updateDirtyState("");
}

function settingsStatusTone(message) {
  if (!message) return "";
  if (/失败|错误|无效/.test(message)) return "error";
  if (/未保存|保存中|刷新中|读取中/.test(message)) return "pending";
  return "success";
}

function setSettingsStatus(message = "", tone = "") {
  state.settingsMessage = message;
  els.settingsStatus.textContent = message;
  const nextTone = tone || settingsStatusTone(message);
  if (nextTone) {
    els.settingsStatus.dataset.tone = nextTone;
  } else {
    delete els.settingsStatus.dataset.tone;
  }
}

function updateDirtyState(message = "") {
  const hasSnapshot = Boolean(state.savedSettingsSnapshot);
  const dirty = hasSnapshot && settingsSnapshotFromCurrentForm() !== state.savedSettingsSnapshot;
  els.resetSettingsButton.disabled = !dirty;
  if (message) {
    setSettingsStatus(message);
    return;
  }
  setSettingsStatus(dirty ? "有未保存变更" : "", dirty ? "pending" : "");
}

function resourcePickerDomReady() {
  return Boolean(
    els.campaignIdsInput
    && els.adIdsInput
    && els.campaignPickerToggle
    && els.campaignPickerDropdown
    && els.campaignPickerLabel
    && els.campaignPickerMeta
    && els.campaignSearchInput
    && els.campaignOptionList
    && els.campaignSelectedList
    && els.adPickerToggle
    && els.adPickerDropdown
    && els.adPickerLabel
    && els.adPickerMeta
    && els.adSearchInput
    && els.adOptionList
    && els.adSelectedList
  );
}

function syncHiddenResourceInputs() {
  if (!els.campaignIdsInput || !els.adIdsInput) return;
  els.campaignIdsInput.value = selectedIdsForKind("campaigns").join("\n");
  els.adIdsInput.value = selectedIdsForKind("ads").join("\n");
}

function renderResourceOption(row, kind, selectedIds) {
  const id = resourceId(row, kind);
  const label = resourcePrimaryLabel(row, kind);
  const secondary = resourceSecondaryLabel(row, kind);
  return `
    <label class="resource-option" title="${escapeHtml(resourceTooltip(row, kind))}">
      <input type="checkbox" data-resource-kind="${kind}" data-resource-id="${escapeHtml(id)}" ${selectedIds.has(id) ? "checked" : ""}>
      <span class="resource-option-main">
        <strong>${escapeHtml(label)}</strong>
        <small>${escapeHtml(secondary)}</small>
      </span>
      <span class="resource-status">ACTIVE</span>
    </label>
  `;
}

function renderSelectedResourceRow(row, kind) {
  const id = resourceId(row, kind);
  const isStale = row?.stale === true;
  const label = isStale ? id : resourcePrimaryLabel(row, kind);
  const secondary = isStale ? "不在 ACTIVE 候选中，可保留或删除" : resourceSecondaryLabel(row, kind);
  const editing = state.resourceUi[kind].editingId === id;
  if (editing) {
    return `
      <article class="selected-resource-row editing">
        <div class="selected-resource-edit">
          <input value="${escapeHtml(id)}" data-resource-edit-input="${kind}" aria-label="编辑 ${kind} ID">
          <button type="button" title="保存编辑" aria-label="保存编辑" data-resource-action="edit-save" data-resource-kind="${kind}" data-resource-id="${escapeHtml(id)}">
            <i data-lucide="check"></i>
          </button>
          <button type="button" title="取消编辑" aria-label="取消编辑" data-resource-action="edit-cancel" data-resource-kind="${kind}">
            <i data-lucide="x"></i>
          </button>
        </div>
      </article>
    `;
  }
  return `
    <article class="selected-resource-row ${isStale ? "stale" : ""}" title="${escapeHtml(isStale ? secondary : resourceTooltip(row, kind))}">
      <span class="selected-resource-main">
        <strong>${escapeHtml(label)}</strong>
        <small>${escapeHtml(secondary)}</small>
      </span>
      <span class="selected-resource-actions">
        <button type="button" title="编辑" aria-label="编辑" data-resource-action="edit" data-resource-kind="${kind}" data-resource-id="${escapeHtml(id)}">
          <i data-lucide="pencil"></i>
        </button>
        <button type="button" title="删除" aria-label="删除" data-resource-action="delete" data-resource-kind="${kind}" data-resource-id="${escapeHtml(id)}">
          <i data-lucide="trash-2"></i>
        </button>
      </span>
    </article>
  `;
}

function renderResourcePagination(kind, pageState) {
  if (pageState.total <= RESOURCE_SELECTED_PAGE_SIZE) {
    return "";
  }
  const previousDisabled = pageState.page <= 1 ? "disabled" : "";
  const nextDisabled = pageState.page >= pageState.pageCount ? "disabled" : "";
  return `
    <nav class="resource-pagination" aria-label="${kind} 已选列表分页">
      <span class="resource-page-info">第 ${pageState.page} / ${pageState.pageCount} 页 · ${pageState.start + 1}-${pageState.end} / ${pageState.total}</span>
      <span class="resource-page-controls">
        <button type="button" title="第一页" aria-label="第一页" data-resource-action="page-first" data-resource-kind="${kind}" ${previousDisabled}>
          <i data-lucide="chevrons-left"></i>
        </button>
        <button type="button" title="上一页" aria-label="上一页" data-resource-action="page-prev" data-resource-kind="${kind}" ${previousDisabled}>
          <i data-lucide="chevron-left"></i>
        </button>
        <button type="button" title="下一页" aria-label="下一页" data-resource-action="page-next" data-resource-kind="${kind}" ${nextDisabled}>
          <i data-lucide="chevron-right"></i>
        </button>
        <button type="button" title="最后一页" aria-label="最后一页" data-resource-action="page-last" data-resource-kind="${kind}" ${nextDisabled}>
          <i data-lucide="chevrons-right"></i>
        </button>
      </span>
    </nav>
  `;
}

function renderResourcePicker(kind) {
  const config = resourceKindConfig(kind);
  const selectedIds = new Set(selectedIdsForKind(kind));
  const candidates = candidateRowsForKind(kind);
  const filtered = filteredCandidateRows(kind);
  const selectedRows = selectedResourceRows(kind);
  const pageState = selectedResourcePageState(kind, selectedRows);
  const staleCount = selectedRows.filter((row) => row.stale).length;
  const candidateText = kind === "ads"
    ? `${candidates.length} 个全链路 ACTIVE ad`
    : `${candidates.length} 个 ACTIVE 广告系列`;
  const staleText = staleCount ? ` · ${staleCount} 个不在候选` : "";
  const staleCatalogText = state.resourceCatalog.stale ? " · 资源需刷新" : "";

  config.label.textContent = selectedIds.size
    ? `已选 ${selectedIds.size} 个 ${config.itemName}`
    : `选择 ${config.itemName}`;
  config.meta.textContent = `${candidateText}${staleText}${staleCatalogText}`;
  config.toggle.setAttribute("aria-expanded", String(state.resourceUi[kind].open));
  config.dropdown.hidden = !state.resourceUi[kind].open;
  config.search.value = state.resourceUi[kind].query;

  if (state.resourceUi[kind].open) {
    if (!candidates.length) {
      config.optionList.innerHTML = `<div class="empty-inline">还没有 ACTIVE 候选资源，请刷新 ACTIVE 资源。</div>`;
    } else if (!filtered.length) {
      config.optionList.innerHTML = `<div class="empty-inline">没有匹配的候选项。</div>`;
    } else {
      config.optionList.innerHTML = filtered.map((row) => renderResourceOption(row, kind, selectedIds)).join("");
    }
  } else {
    config.optionList.innerHTML = "";
  }

  config.selectedList.innerHTML = selectedRows.length
    ? `${pageState.rows.map((row) => renderSelectedResourceRow(row, kind)).join("")}${renderResourcePagination(kind, pageState)}`
    : `<div class="empty-inline">当前未选择 ${config.itemName}。</div>`;
  scheduleIconRefresh();
}

function renderResourcePickers() {
  if (!resourcePickerDomReady()) return;
  syncHiddenResourceInputs();
  renderResourcePicker("campaigns");
  renderResourcePicker("ads");
  scheduleIconRefresh();
}

function toggleResourceDropdown(kind, open = !state.resourceUi[kind].open) {
  state.resourceUi.campaigns.open = false;
  state.resourceUi.ads.open = false;
  state.resourceUi[kind].open = open;
  renderResourcePickers();
  if (open) {
    resourceKindConfig(kind).search.focus();
  }
}

function addSelectedResource(kind, id) {
  const config = resourceKindConfig(kind);
  const selected = selectedIdsForKind(kind);
  if (selected.includes(id)) {
    updateDirtyState(`${id} 已在列表中`);
    return;
  }
  if (selected.length >= config.limit) {
    updateDirtyState(`${config.itemName} 最多选择 ${config.limit} 个`);
    return;
  }
  setSelectedIdsForKind(kind, [...selected, id]);
  state.resourceUi[kind].selectedPage = Number.MAX_SAFE_INTEGER;
  state.samplingSettings = collectSamplingSettings();
  renderSamplingSettings();
  updateDirtyState();
}

function removeSelectedResource(kind, id) {
  setSelectedIdsForKind(kind, selectedIdsForKind(kind).filter((item) => item !== id));
  state.resourceUi[kind].editingId = "";
  state.samplingSettings = collectSamplingSettings();
  renderSamplingSettings();
  updateDirtyState();
}

function selectFilteredResources(kind) {
  const config = resourceKindConfig(kind);
  const current = selectedIdsForKind(kind);
  const additions = filteredCandidateRows(kind).map((row) => resourceId(row, kind)).filter(Boolean);
  setSelectedIdsForKind(kind, [...current, ...additions].slice(0, config.limit));
  state.resourceUi[kind].selectedPage = 1;
  state.samplingSettings = collectSamplingSettings();
  renderSamplingSettings();
  updateDirtyState();
}

function clearSelectedResources(kind) {
  setSelectedIdsForKind(kind, []);
  state.resourceUi[kind].editingId = "";
  state.resourceUi[kind].selectedPage = 1;
  state.samplingSettings = collectSamplingSettings();
  renderSamplingSettings();
  updateDirtyState();
}

function setSelectedResourcePage(kind, action) {
  const selectedCount = selectedIdsForKind(kind).length;
  const pageCount = Math.max(1, Math.ceil(selectedCount / RESOURCE_SELECTED_PAGE_SIZE));
  const currentPage = Number.parseInt(state.resourceUi[kind].selectedPage, 10) || 1;
  if (action === "page-first") state.resourceUi[kind].selectedPage = 1;
  if (action === "page-prev") state.resourceUi[kind].selectedPage = Math.max(1, currentPage - 1);
  if (action === "page-next") state.resourceUi[kind].selectedPage = Math.min(pageCount, currentPage + 1);
  if (action === "page-last") state.resourceUi[kind].selectedPage = pageCount;
  state.resourceUi[kind].editingId = "";
  renderResourcePickers();
}

function saveResourceEdit(kind, oldId) {
  const input = document.querySelector(`[data-resource-edit-input="${kind}"]`);
  const nextId = String(input?.value || "").trim();
  if (!/^\d{3,32}$/.test(nextId)) {
    updateDirtyState("请输入有效数字 ID");
    return;
  }
  const ids = selectedIdsForKind(kind).map((id) => (id === oldId ? nextId : id));
  setSelectedIdsForKind(kind, ids);
  state.resourceUi[kind].editingId = "";
  state.samplingSettings = collectSamplingSettings();
  renderSamplingSettings();
  updateDirtyState();
}

function addManualResource(kind) {
  const input = resourceKindConfig(kind).manualInput;
  const ids = parseIdInput(input.value);
  if (!ids.length) {
    updateDirtyState("请输入有效数字 ID");
    return;
  }
  ids.forEach((id) => addSelectedResource(kind, id));
  input.value = "";
  updateDirtyState();
}

function stateForList(listType) {
  return (state.monitorStatus?.state || []).find((item) => item.list_type === listType) || null;
}

function statusLabel(value) {
  if (value === "success") return "成功";
  if (value === "partial") return "部分成功";
  if (value === "failed") return "失败";
  return "未运行";
}

function schedulerStatusLabel(scheduler = {}) {
  if (scheduler.running || scheduler.status === "running") return "自动采集中";
  if (scheduler.status === "blocked") return "等待队列空闲";
  if (scheduler.status === "failed") return "调度异常";
  return "自动调度已启用";
}

function schedulerTileStatus(scheduler = {}) {
  if (scheduler.running || scheduler.status === "running") return "success";
  if (scheduler.status === "blocked") return "partial";
  if (scheduler.status === "failed") return "failed";
  return "success";
}

function schedulerStatusMeta(scheduler = {}) {
  const due = Array.isArray(scheduler.due) ? scheduler.due : [];
  if (due.length) {
    const names = due.map((item) => (item.list_type === "ads" ? "List 2" : "List 1")).join("、");
    return `到期 ${names}`;
  }
  return scheduler.next_due_at ? `下次 ${formatIso(scheduler.next_due_at)}` : "等待下一次计划";
}

function historyLabel(run) {
  const slices = Array.isArray(run?.metadata?.slices) ? run.metadata.slices : [];
  if (slices.length) {
    const reasonSet = new Set(slices.map((slice) => slice.reason).filter(Boolean));
    const uniqueObjects = new Set(slices.map((slice) => String(slice.objectId || "")).filter(Boolean));
    const objectLabel = uniqueObjects.size
      ? uniqueObjects.size === slices.length
        ? `${uniqueObjects.size} 个对象`
        : `${uniqueObjects.size} 个对象 / ${slices.length} 个窗口`
      : `${slices.length} 个窗口`;
    const missingBuckets = slices.reduce((sum, slice) => sum + Math.max(0, Number(slice.missingBucketCount || 0)), 0);
    const rowCount = Number(run?.metadata?.rowCount);
    const baseLabel = reasonSet.has("initial-90d-backfill") || reasonSet.has("expanded-90d-backfill")
      ? "90天回补"
      : reasonSet.has("initial-7d-backfill")
        ? "首次回补"
        : reasonSet.has("manual-range")
          ? "手动范围"
          : missingBuckets > 0
            ? "增量采集"
            : "增量检查";
    const parts = [
      baseLabel,
      objectLabel,
      missingBuckets > 0 ? `缺失 ${missingBuckets} 个小时桶` : "无缺失小时桶"
    ];
    if (Number.isFinite(rowCount)) {
      parts.push(`写入 ${rowCount} 行`);
    }
    return parts.join(" · ");
  }
  const requestedCount = Number(run?.requested_count || 0);
  if (requestedCount > 0) return `本轮采集 · ${requestedCount} 个对象`;
  return "等待运行";
}

function updatedAtLabel(value) {
  return value ? `更新 ${formatInstantInDisplayTimeZone(value)}` : "更新 -";
}

function latestMonitorUpdateTime(run, monitorState) {
  return run?.completed_at || run?.started_at || monitorState?.last_run_at || monitorState?.updated_at || "";
}

function envStatusLabel(status) {
  if (status === "configured") return "已配置";
  if (status === "default") return "默认值";
  if (status === "missing") return "缺失";
  return "可选";
}

function collectEnvironmentEntries() {
  return [...document.querySelectorAll("[data-env-key]")].map((input) => {
    const key = input.dataset.envKey;
    const clear = document.querySelector(`[data-env-clear="${CSS.escape(key)}"]`)?.checked === true;
    const preserve = input.dataset.envSensitive === "true" && !clear && input.value === "" && input.dataset.envConfigured === "true";
    return {
      key,
      value: clear ? "" : input.value,
      preserve
    };
  });
}

function renderEnvironmentSettings() {
  const environment = state.environmentSettings;
  if (!environment) {
    els.envConfigCaption.textContent = state.environmentError || "读取中";
    els.envFileStatus.innerHTML = "";
    els.envConfigGrid.innerHTML = `<div class="empty-inline">正在读取环境变量配置状态。</div>`;
    return;
  }

  const summary = environment.summary || {};
  const missingRequired = Math.max(0, Number(summary.requiredTotal || 0) - Number(summary.requiredConfigured || 0));
  els.envConfigCaption.textContent = missingRequired
    ? `必填缺失 ${missingRequired} 项 · 已配置 ${Number(summary.configuredTotal || 0)} / ${Number(summary.total || 0)} 项`
    : `必填已齐 · 已配置 ${Number(summary.configuredTotal || 0)} / ${Number(summary.total || 0)} 项`;

  const files = Array.isArray(environment.files) ? environment.files : [];
  els.envFileStatus.innerHTML = files.map((file) => `
    <span class="env-file-chip ${file.exists ? "exists" : "missing"}">
      ${escapeHtml(file.path)}
      <small>${file.exists ? `${Number(file.keys || 0)} 项${file.loaded ? " · 已加载" : ""}` : "未创建"}</small>
    </span>
  `).join("");

  const groups = Array.isArray(environment.groups) ? environment.groups : [];
  els.envConfigGrid.innerHTML = groups.map((group) => `
    <section class="env-group">
      <div class="env-group-head">
        <strong>${escapeHtml(group.title)}</strong>
        <span>${Number(group.items?.filter?.((item) => item.configured).length || 0)} / ${Number(group.items?.length || 0)} 已配置</span>
      </div>
      <div class="env-item-list">
        ${(group.items || []).map((item) => `
          <article class="env-item ${escapeHtml(item.status)}">
            <div class="env-item-main">
              <div class="env-key-line">
                <code>${escapeHtml(item.key)}</code>
                <span class="env-badge ${escapeHtml(item.status)}">${envStatusLabel(item.status)}</span>
                ${item.required ? `<span class="env-badge required">必填</span>` : ""}
              </div>
              <strong>${escapeHtml(item.label)}</strong>
              <small>${escapeHtml(item.description)}</small>
            </div>
            <div class="env-edit-row">
              <input
                data-env-key="${escapeHtml(item.key)}"
                data-env-sensitive="${item.sensitive ? "true" : "false"}"
                data-env-configured="${item.configured ? "true" : "false"}"
                type="${item.sensitive ? "password" : "text"}"
                spellcheck="false"
                autocomplete="off"
                value="${escapeHtml(item.editValue || "")}"
                placeholder="${escapeHtml(item.sensitive && item.configured ? "已配置，输入新值覆盖" : item.defaultValue ? `默认 ${item.defaultValue}` : `${item.key}= 可留空`)}"
              >
              ${item.sensitive && item.configured ? `
                <label class="env-clear-check">
                  <input type="checkbox" data-env-clear="${escapeHtml(item.key)}">
                  <span>清空</span>
                </label>
              ` : ""}
            </div>
            <div class="env-item-meta">
              <span>${escapeHtml(item.displayValue)}</span>
              <small>${escapeHtml(item.source || "-")}${item.usedBy ? ` · ${escapeHtml(item.usedBy)}` : ""}</small>
            </div>
          </article>
        `).join("")}
      </div>
    </section>
  `).join("") || `<div class="empty-inline">暂无环境变量配置项。</div>`;
}

function renderMonitorStatus() {
  const overview = state.monitorStatus;
  const campaignState = stateForList("campaigns");
  const adState = stateForList("ads");
  const resourceCounts = state.resourceCatalog?.counts || overview?.resourceCounts || {};
  const latestCampaignRun = (overview?.recentRuns || []).find((run) => run.list_type === "campaigns");
  const latestAdRun = (overview?.recentRuns || []).find((run) => run.list_type === "ads");
  const resourceAccountId = state.resourceCatalog?.account_id || ACTIVE_RESOURCE_ACCOUNT_ID;
  const resourceUpdateTime = state.resourceCatalog?.last_synced_at || state.resourceRefresh?.last_completed_at || "";
  const scheduler = overview?.scheduler || {};

  els.monitorStatusGrid.innerHTML = [
    {
      title: "List 1 广告系列",
      value: statusLabel(campaignState?.last_status),
      meta: `${state.samplingSettings.campaignMonitor.intervalMinutes} 分钟 · ${historyLabel(latestCampaignRun)}`,
      updated: updatedAtLabel(latestMonitorUpdateTime(latestCampaignRun, campaignState)),
      status: campaignState?.last_status || "idle"
    },
    {
      title: "List 2 广告",
      value: statusLabel(adState?.last_status),
      meta: `${state.samplingSettings.adMonitor.intervalMinutes} 分钟 · ${historyLabel(latestAdRun)}`,
      updated: updatedAtLabel(latestMonitorUpdateTime(latestAdRun, adState)),
      status: adState?.last_status || "idle"
    },
    {
      title: "当前监控账户 ACTIVE 资源",
      value: `${Number(resourceCounts.ads?.chain_active || resourceCounts.ads?.active || 0).toLocaleString("en-US")} 个广告`,
      meta: `账户 ${resourceAccountId} · ${Number(resourceCounts.campaigns?.active || 0)} 个广告系列 · ${Number(resourceCounts.adsets?.active || 0)} 个广告组`,
      updated: updatedAtLabel(resourceUpdateTime),
      status: state.resourceCatalog?.stale ? "partial" : "success"
    },
    {
      title: "自动采集调度",
      value: schedulerStatusLabel(scheduler),
      meta: schedulerStatusMeta(scheduler),
      updated: scheduler.last_checked_at ? `检查 ${formatIso(scheduler.last_checked_at)}` : "检查 -",
      status: schedulerTileStatus(scheduler)
    }
  ].map((item) => `
    <article class="status-tile ${item.status}">
      <span>${escapeHtml(item.title)}</span>
      <strong>${escapeHtml(item.value)}</strong>
      <small>${escapeHtml(item.meta)}</small>
      <small class="status-updated">${escapeHtml(item.updated)}</small>
    </article>
  `).join("");

  const allRuns = overview?.recentRuns || [];
  const runFilter = ["campaigns", "ads"].includes(state.monitorRunFilter) ? state.monitorRunFilter : "all";
  els.recentRunsFilter.value = runFilter;
  const runs = runFilter === "all" ? allRuns : allRuns.filter((run) => run.list_type === runFilter);
  els.recentRunsBody.innerHTML = runs.length
    ? runs.map((run) => {
      const note = run.error_summary || historyLabel(run);
      return `
        <tr>
          <td>${run.list_type === "ads" ? "List 2" : "List 1"}</td>
          <td><span class="run-badge ${escapeHtml(run.status)}">${statusLabel(run.status)}</span></td>
          <td>${formatIso(run.completed_at || run.started_at)}</td>
          <td>${formatIso(run.next_run_at)}</td>
          <td>${Number(run.success_count || 0)} / ${Number(run.failed_count || 0)}</td>
          <td>${Number(run.retry_count || 0)}</td>
          <td>${formatDuration(run.duration_ms)}</td>
          <td class="error-cell ${run.error_summary ? "has-error" : ""}" title="${escapeHtml(note)}">${escapeHtml(note)}</td>
        </tr>
      `;
    }).join("")
    : `<tr><td colspan="8">${runFilter === "all" ? "还没有监控批次，运行 monitor-run 后显示。" : "当前筛选下还没有监控批次。"}</td></tr>`;
}

function collectionStatusText(status) {
  return {
    waiting: "等待",
    running: "进行中",
    completed: "完成",
    failed: "失败",
    retry: "重试"
  }[status] || status || "-";
}

function collectionRunStatusText(status) {
  return {
    running: "运行中",
    pending: "待继续",
    partial: "部分完成",
    completed: "已完成"
  }[status] || status || "-";
}

function collectionObjectTypeText(value) {
  return {
    campaigns: "广告系列",
    adsets: "广告组",
    ads: "广告"
  }[value] || value || "-";
}

function collectionRunObjectText(run) {
  const types = Array.isArray(run?.objectTypes) ? run.objectTypes : [];
  return types.length ? types.map(collectionObjectTypeText).join("、") : "未知层级";
}

function collectionRunTitle(run) {
  return `${collectionRunObjectText(run)} · ${Number(run?.total || 0)} 个任务`;
}

function collectionRunMeta(run) {
  const pending = Number(run?.pendingJobs || 0);
  const retry = Number(run?.retry || 0);
  const failed = Number(run?.failed || 0);
  return [
    `${Number(run?.completed || 0)} / ${Number(run?.total || 0)} · ${Number(run?.percent || 0).toFixed(1)}%`,
    pending ? `${pending} 个待处理` : "",
    retry ? `${retry} 个重试` : "",
    failed ? `${failed} 个失败` : "",
    run?.nextAttemptAt ? `下次 ${formatIso(run.nextAttemptAt)}` : ""
  ].filter(Boolean).join(" · ");
}

function collectionRunCanDelete(run) {
  return !["running", "pending"].includes(run?.status)
    && Number(run?.pendingJobs || 0) === 0
    && Number(run?.running || 0) === 0
    && Number(run?.waiting || 0) === 0
    && Number(run?.retry || 0) === 0;
}

function renderCollectionRunHistory() {
  if (!els.collectionRunList) return;
  const runs = state.collectionQueue?.runSummaries || [];
  const currentRunId = state.collectionQueue?.currentRun?.runId || state.collectionRunId || "";
  els.collectionRunList.innerHTML = runs.length
    ? runs.map((run) => {
      const active = run.runId === currentRunId;
      const canDelete = collectionRunCanDelete(run);
      return `
        <article class="collection-run-item ${active ? "active" : ""}" role="button" tabindex="0" data-collection-run-id="${escapeHtml(run.runId)}">
          <span class="run-badge ${escapeHtml(run.status)}">${escapeHtml(collectionRunStatusText(run.status))}</span>
          <strong>${escapeHtml(collectionRunTitle(run))}</strong>
          <small>${escapeHtml(collectionRunMeta(run))}</small>
          <em>${escapeHtml(formatIso(run.updatedAt || run.createdAt))}</em>
          <button class="collection-run-delete" type="button" data-delete-collection-run="${escapeHtml(run.runId)}" title="${canDelete ? "删除采集批次" : "运行中或待重试批次不能删除"}" aria-label="删除采集批次" ${canDelete ? "" : "disabled"}>
            <i data-lucide="trash-2"></i>
          </button>
        </article>
      `;
    }).join("")
    : `<div class="empty-inline">还没有历史采集批次。</div>`;
  scheduleIconRefresh();
}

function collectionJobProgress(job) {
  const status = job?.status || "";
  if (status === "completed") return 100;
  if (status === "failed") return 100;
  if (status === "running") return 65;
  if (status === "retry") {
    const attempts = Number(job?.attempts || 0);
    const maxAttempts = Math.max(1, Number(job?.max_attempts || 1));
    return Math.min(95, Math.max(12, Math.round((attempts / maxAttempts) * 100)));
  }
  return 0;
}

function collectionJobTone(job) {
  if (job?.status === "completed") return "completed";
  if (job?.status === "failed") return "failed";
  if (job?.status === "running") return "running";
  if (job?.status === "retry") return "retry";
  return "waiting";
}

function collectionJobTitle(job) {
  const level = collectionObjectTypeText(job?.object_type);
  const idCount = Number(job?.id_count || 0);
  const bucket = job?.bucket_key || job?.date_start || "-";
  return `${level} · ${idCount} ID · ${bucket}`;
}

function collectionJobMeta(job) {
  const flags = [
    job?.rate_limited ? "限流" : "",
    job?.quota_limited ? "超配额" : ""
  ].filter(Boolean);
  return [
    `尝试 ${Number(job?.attempts || 0)} / ${Number(job?.max_attempts || 0)}`,
    `行数 ${Number(job?.row_count || 0)} / 原始 ${Number(job?.raw_row_count || 0)}`,
    `耗时 ${formatDuration(job?.duration_ms)}`,
    flags.join(" · ")
  ].filter(Boolean).join(" · ");
}

function collectionWatchdogText(watchdog, { includeEmpty = false } = {}) {
  if (!watchdog || (!includeEmpty && Number(watchdog.scanned || 0) <= 0)) return "";
  return `watchdog 扫描 ${Number(watchdog.scanned || 0)} · 补完成 ${Number(watchdog.completedFromSuccess || 0)} · 转重试 ${Number(watchdog.retried || 0)}`;
}

function renderCollectionJobCard(job) {
  const tone = collectionJobTone(job);
  const percent = collectionJobProgress(job);
  const updatedAt = formatIso(job?.updated_at || job?.completed_at || job?.created_at);
  const ids = Array.isArray(job?.objectIds) ? job.objectIds : [];
  const idTotal = Math.max(ids.length, Number(job?.objectIdTotal || job?.id_count || ids.length));
  const idPreview = ids.slice(0, 4).join(", ");
  const idExtra = idTotal > ids.length ? ` 等 ${idTotal} 个` : "";
  return `
    <article class="task-progress-row ${escapeHtml(tone)}">
      <div class="task-progress-main">
        <span class="run-badge ${escapeHtml(job.status)}">${escapeHtml(collectionStatusText(job.status))}</span>
        <div class="task-progress-title">
          <strong>${escapeHtml(collectionJobTitle(job))}</strong>
          <small>${escapeHtml(collectionJobMeta(job))}</small>
        </div>
      </div>
      <div class="task-progress-body">
        <div class="task-progress-track" aria-label="任务进度 ${percent}%">
          <span style="width: ${percent}%"></span>
        </div>
        <div class="task-progress-foot">
          <span>${percent}%</span>
          <span>${escapeHtml(updatedAt)}</span>
        </div>
      </div>
      <div class="task-progress-side">
        <span>${escapeHtml(job.account_timezone || "-")}</span>
        <small title="${escapeHtml(ids.join(", "))}">${escapeHtml(idPreview || "-")}${escapeHtml(idExtra)}</small>
      </div>
      ${job.error ? `<div class="task-progress-error">${escapeHtml(job.error)}</div>` : ""}
    </article>
  `;
}

function renderCollectionConsole() {
  const queue = state.collectionQueue;
  const runner = state.collectionRunner;
  if (!els.collectionConsoleGrid || !els.collectionJobsList) {
    return;
  }
  renderCollectionRunHistory();
  const currentRun = queue?.currentRun || null;
  const counts = queue?.statusCounts || {};
  const progress = queue?.progress || {};
  const page = queue?.jobPage || { page: state.collectionPage, pageSize: COLLECTION_PAGE_SIZE, total: 0, pageCount: 1, offset: 0 };
  const recentWindow = queue?.recentWindow || {};
  const totals = queue?.totals || {};
  const runnerLabel = runner?.running
    ? `运行中 · ${runner.mode || "采集"}`
    : runner?.last_completed_at
      ? `${runner.status === "success" ? "上次完成" : "上次失败"} · ${formatIso(runner.last_completed_at)}`
      : "空闲";
  const currentObjectTypes = Array.isArray(currentRun?.objectTypes) ? currentRun.objectTypes : [];
  const usesCampaigns = currentObjectTypes.includes("campaigns");
  const usesAds = currentObjectTypes.includes("ads") || currentObjectTypes.includes("adsets");
  const configuredConcurrency = Math.max(
    usesCampaigns ? Number(state.samplingSettings.campaignMonitor.concurrency || 1) : 0,
    usesAds ? Number(state.samplingSettings.adMonitor.concurrency || 1) : 0,
    !usesCampaigns && !usesAds ? Number(state.samplingSettings.campaignMonitor.concurrency || 1) : 0,
    !usesCampaigns && !usesAds ? Number(state.samplingSettings.adMonitor.concurrency || 1) : 0
  );
  const workerMeta = currentRun
    ? `${collectionRunStatusText(currentRun.status)} / 配置并发`
    : "无当前批次";

  els.collectionQueueCaption.textContent = queue?.generatedAt
    ? `${runnerLabel} · 自动刷新 ${COLLECTION_REFRESH_INTERVAL_MS / 1000}s · ${formatIsoWithSeconds(queue.generatedAt)}`
    : runnerLabel;
  const watchdogLabel = collectionWatchdogText(state.collectionWatchdog, {
    includeEmpty: state.collectionWatchdogManual && Date.now() < state.collectionWatchdogManualUntil
  });
  if (queue?.generatedAt && watchdogLabel) {
    els.collectionQueueCaption.textContent = [runnerLabel, watchdogLabel, `自动刷新 ${COLLECTION_REFRESH_INTERVAL_MS / 1000}s`, formatIsoWithSeconds(queue.generatedAt)].join(" · ");
  }
  if (els.collectionCurrentCaption) {
    els.collectionCurrentCaption.textContent = currentRun
      ? `${collectionRunStatusText(currentRun.status)} · ${collectionRunTitle(currentRun)} · ${formatIso(currentRun.createdAt)}`
      : "暂无当前采集批次";
  }
  els.collectionProgressLabel.textContent = `${Number(progress.completed || 0)} / ${Number(progress.total || 0)} · ${Number(progress.percent || 0).toFixed(1)}%`;
  els.collectionProgressFill.style.width = `${Math.max(0, Math.min(100, Number(progress.percent || 0)))}%`;
  els.collectionConsoleGrid.innerHTML = [
    {
      title: "当前 worker",
      value: `${Number(queue?.activeWorkers || 0)} / ${configuredConcurrency}`,
      meta: workerMeta
    },
    {
      title: "待处理 / 重试",
      value: `${Number(counts.waiting || 0)} / ${Number(counts.retry || 0)}`,
      meta: currentRun?.nextAttemptAt ? `下次 ${formatIso(currentRun.nextAttemptAt)}` : "当前批次任务"
    },
    {
      title: "当前批次进度",
      value: `${Number(progress.percent || 0).toFixed(1)}%`,
      meta: `${Number(progress.completed || 0)} / ${Number(progress.total || 0)}`
    },
    {
      title: "失败任务 / 限流",
      value: `${Number(counts.failed || 0)} / ${Number(totals.rateLimited || 0)}`,
      meta: `超配额 ${Number(totals.quotaLimited || 0)}`
    },
    {
      title: "返回行数",
      value: Number(totals.rows || 0).toLocaleString("en-US"),
      meta: `原始 ${Number(totals.rawRows || 0).toLocaleString("en-US")}`
    },
    {
      title: "近窗口平均耗时",
      value: formatDuration(recentWindow.avgDurationMs),
      meta: `${Number(recentWindow.batchCount || 0)} 个批次`
    }
  ].map((item) => `
    <article class="status-tile">
      <span>${escapeHtml(item.title)}</span>
      <strong>${escapeHtml(item.value)}</strong>
      <small>${escapeHtml(item.meta)}</small>
    </article>
  `).join("");

  const jobs = queue?.recentJobs || [];
  els.collectionJobsList.innerHTML = jobs.length
    ? jobs.map(renderCollectionJobCard).join("")
    : `<div class="empty-inline">当前采集批次还没有可展示的任务。点击“投递并运行”后，这里会显示批次内任务。</div>`;

  const total = Number(page.total || progress.total || 0);
  const pageSize = Number(page.pageSize || COLLECTION_PAGE_SIZE);
  const pageCount = Math.max(1, Number(page.pageCount || Math.ceil(total / pageSize) || 1));
  const currentPage = Math.min(pageCount, Math.max(1, Number(page.page || state.collectionPage || 1)));
  const start = total ? Number(page.offset || 0) + 1 : 0;
  const end = total ? Math.min(total, Number(page.offset || 0) + jobs.length) : 0;
  els.collectionPageInfo.textContent = `第 ${currentPage} / ${pageCount} 页 · ${start}-${end} / ${total} · 每页 ${pageSize}`;
  document.querySelectorAll("[data-collection-page]").forEach((button) => {
    const action = button.dataset.collectionPage;
    const disabled = (action === "first" || action === "prev") ? currentPage <= 1 : currentPage >= pageCount;
    button.disabled = disabled;
  });
}

function renderAccountSettings(message = "") {
  const accounts = state.samplingSettings.campaignMonitor.accountIds.length
    ? state.samplingSettings.campaignMonitor.accountIds
    : state.monitoredAccounts.map((account) => account.id);
  renderSettingsCaption();
  els.monitorAccountsInput.value = accounts.join("\n");
  if (message) {
    setSettingsStatus(message);
  }
}

function renderSettingsCaption() {
  const campaign = state.samplingSettings.campaignMonitor;
  const ad = state.samplingSettings.adMonitor;
  els.settingsCaption.textContent = [
    `账户 ${campaign.accountIds.length || state.monitoredAccounts.length} 个`,
    `广告系列 ${campaign.campaignIds.length} 个`,
    `ad ${ad.adIds.length} 个`
  ].join(" · ");
}

function renderSamplingSettings() {
  const settings = state.samplingSettings;
  const campaign = settings.campaignMonitor;
  const ad = settings.adMonitor;

  els.campaignMonitorEnabled.checked = campaign.enabled;
  els.campaignIntervalInput.value = campaign.intervalMinutes;
  els.campaignResultActionInput.value = campaign.resultAction;
  els.campaignConcurrencyInput.value = campaign.concurrency;
  els.campaignQpsInput.value = campaign.qps;
  els.campaignTimeoutInput.value = campaign.requestTimeoutMs;
  els.campaignMaxAttemptsInput.value = campaign.maxAttempts;
  els.campaignAutoActiveInput.checked = campaign.autoActiveCampaigns;

  els.adMonitorEnabled.checked = ad.enabled;
  els.adIntervalInput.value = ad.intervalMinutes;
  els.adResultActionInput.value = ad.resultAction;
  els.adConcurrencyInput.value = ad.concurrency;
  els.adQpsInput.value = ad.qps;
  els.adTimeoutInput.value = ad.requestTimeoutMs;
  els.adMaxAttemptsInput.value = ad.maxAttempts;
  renderSettingsCaption();
  renderResourcePickers();
  renderMonitorStatus();
  renderCollectionConsole();
}

function collectSamplingSettings() {
  const accountIds = parseIdInput(els.monitorAccountsInput.value);
  const campaignIds = selectedIdsForKind("campaigns");
  const adIds = selectedIdsForKind("ads");
  return normalizeSamplingSettings({
    campaignMonitor: {
      enabled: els.campaignMonitorEnabled.checked,
      intervalMinutes: els.campaignIntervalInput.value,
      accountIds,
      autoActiveCampaigns: els.campaignAutoActiveInput.checked,
      campaignIds,
      datePreset: "",
      resultAction: els.campaignResultActionInput.value,
      hourly: true,
      concurrency: els.campaignConcurrencyInput.value,
      qps: els.campaignQpsInput.value,
      requestTimeoutMs: els.campaignTimeoutInput.value,
      maxAttempts: els.campaignMaxAttemptsInput.value
    },
    adMonitor: {
      enabled: els.adMonitorEnabled.checked,
      intervalMinutes: els.adIntervalInput.value,
      adIds,
      datePreset: "",
      resultAction: els.adResultActionInput.value,
      hourly: true,
      concurrency: els.adConcurrencyInput.value,
      qps: els.adQpsInput.value,
      requestTimeoutMs: els.adTimeoutInput.value,
      maxAttempts: els.adMaxAttemptsInput.value
    },
    targeted: {
      enabled: els.adMonitorEnabled.checked,
      level: "ads",
      ids: adIds,
      intervalMinutes: 15,
      datePreset: "",
      resultAction: els.adResultActionInput.value,
      hourly: true
    },
    activeCampaigns: {
      enabled: els.campaignMonitorEnabled.checked,
      intervalMinutes: els.campaignIntervalInput.value,
      datePreset: "",
      limit: campaignIds.length,
      resultAction: els.campaignResultActionInput.value,
      hourly: true
    }
  });
}

async function loadAccountSettings(message = "") {
  try {
    const response = await apiFetch("/api/settings/accounts", { cache: "no-store" });
    const payload = await response.json();
    state.monitoredAccounts = payload.ok && Array.isArray(payload.accounts) ? payload.accounts : [];
    renderAccountSettings(message);
  } catch {
    renderAccountSettings("账户设置读取失败");
  }
}

async function loadSamplingSettings(message = "") {
  try {
    const response = await apiFetch("/api/settings/sampling", { cache: "no-store" });
    const payload = await response.json();
    state.samplingSettings = normalizeSamplingSettings(payload.ok ? payload.settings : {});
    renderSamplingSettings();
    if (message) {
      setSettingsStatus(message);
    }
  } catch {
    renderSamplingSettings();
    setSettingsStatus("取样设置读取失败", "error");
  }
}

async function loadMonitorStatus() {
  try {
    const response = await apiFetch("/api/monitor/status", { cache: "no-store" });
    const payload = await response.json();
    state.monitorStatus = payload.ok ? payload.status : null;
  } catch {
    state.monitorStatus = null;
  }
  renderMonitorStatus();
}

async function loadCollectionQueueStatus(page = state.collectionPage, runId = state.collectionRunId) {
  if (state.collectionLoading) {
    return;
  }
  state.collectionLoading = true;
  state.collectionPage = Math.max(1, Number.parseInt(page, 10) || 1);
  try {
    const params = new URLSearchParams({
      page: String(state.collectionPage),
      page_size: String(COLLECTION_PAGE_SIZE)
    });
    const selectedRunId = String(runId || "").trim();
    if (selectedRunId) {
      params.set("run_id", selectedRunId);
    }
    const response = await apiFetch(`/api/collection/queue/status?${params}`, { cache: "no-store" });
    const payload = await response.json();
    state.collectionQueue = payload.ok ? payload.queue : null;
    state.collectionRunner = payload.ok ? payload.runner : null;
    const nextWatchdog = payload.ok ? payload.watchdog || null : null;
    const keepManualWatchdog = state.collectionWatchdogManual
      && Date.now() < state.collectionWatchdogManualUntil
      && Number(nextWatchdog?.scanned || 0) <= 0;
    if (!keepManualWatchdog) {
      state.collectionWatchdog = nextWatchdog;
      state.collectionWatchdogManual = false;
      state.collectionWatchdogManualUntil = 0;
    }
    if (!selectedRunId && state.collectionQueue?.currentRun?.runId) {
      state.collectionRunId = state.collectionQueue.currentRun.runId;
    }
    const pageInfo = state.collectionQueue?.jobPage;
    if (pageInfo?.page) {
      state.collectionPage = pageInfo.page;
    }
  } catch {
    state.collectionQueue = null;
    state.collectionRunner = null;
    state.collectionWatchdog = null;
    state.collectionWatchdogManual = false;
    state.collectionWatchdogManualUntil = 0;
  } finally {
    state.collectionLoading = false;
  }
  renderCollectionConsole();
}

async function runCollectionQueueLegacy() {
  els.runCollectionQueueButton.disabled = true;
  els.collectionQueueCaption.textContent = "正在投递";
  try {
    const mode = els.collectionRunModeSelect.value || "all";
    const response = await apiFetch("/api/collection/queue/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ mode })
    });
    const payload = await response.json();
    state.collectionRunner = payload.run || state.collectionRunner;
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || "采集任务启动失败");
    }
    state.collectionRunId = "";
    await loadCollectionQueueStatus(1);
  } catch (error) {
    els.collectionQueueCaption.textContent = error.message || "采集任务启动失败";
  } finally {
    els.runCollectionQueueButton.disabled = false;
  }
}

function closeCollectionRunPreview(confirmed = false) {
  if (els.collectionRunPreviewModal) {
    els.collectionRunPreviewModal.hidden = true;
  }
  if (state.collectionRunPreviewResolver) {
    state.collectionRunPreviewResolver(Boolean(confirmed));
    state.collectionRunPreviewResolver = null;
  }
}

function renderCollectionRunPreviewItem(item = {}) {
  const range = item.range || {};
  const warning = item.warning
    ? `<div class="confirm-modal-warning">${escapeHtml(item.warning)}</div>`
    : "";
  return `
    <article class="confirm-modal-item">
      <div>
        <h4>${escapeHtml(item.label || item.objectType || "采集项")}</h4>
        <small>${escapeHtml(range.since || "-")} 至 ${escapeHtml(range.until || "-")} · ${Number(item.backfillDays || 0)} 天回补窗口</small>
      </div>
      <div class="confirm-modal-item-grid">
        <div><small>对象数</small><strong>${Number(item.objectCount || 0).toLocaleString("en-US")}</strong></div>
        <div><small>待取 Job</small><strong>${Number(item.plannedJobs || 0).toLocaleString("en-US")}</strong></div>
        <div><small>缺口小时桶</small><strong>${Number(item.missingBuckets || 0).toLocaleString("en-US")}</strong></div>
        <div><small>预计耗时</small><strong>${formatPreviewSeconds(item.estimatedSeconds)}</strong></div>
        <div><small>已覆盖小时桶</small><strong>${Number(item.coveredBuckets || 0).toLocaleString("en-US")}</strong></div>
        <div><small>并发 / QPS</small><strong>${Number(item.concurrency || 0)} / ${Number(item.qps || 0)}</strong></div>
        <div><small>请求超时</small><strong>${formatDuration(item.timeoutMs || 0)}</strong></div>
        <div><small>资源缓存</small><strong>${Number(item.resourceCount || 0).toLocaleString("en-US")}</strong></div>
      </div>
      ${warning}
    </article>
  `;
}

function renderCollectionRunPreview(preview = {}) {
  const items = preview.items || [];
  const warnings = preview.warnings || [];
  const disabled = Boolean(preview.runnerBusy) || Number(preview.totalJobs || 0) <= 0 || preview.canRun === false;
  if (els.collectionRunPreviewConfirmButton) {
    els.collectionRunPreviewConfirmButton.disabled = disabled;
  }
  const warningHtml = [
    preview.runnerBusy ? "当前已有采集进程运行中，不能重复投递。" : "",
    preview.canRun === false && Number(preview.totalJobs || 0) > 0 && !preview.runnerBusy
      ? "当前选择包含不可执行的采集项，请调整模式或配置后再投递。"
      : "",
    ...warnings
  ].filter(Boolean).map((text) => (
    `<div class="confirm-modal-warning">${escapeHtml(text)}</div>`
  )).join("");
  els.collectionRunPreviewBody.innerHTML = `
    <div class="confirm-modal-summary">
      <div class="confirm-modal-metric"><span>总待取 Job</span><strong>${Number(preview.totalJobs || 0).toLocaleString("en-US")}</strong></div>
      <div class="confirm-modal-metric"><span>对象数</span><strong>${Number(preview.totalObjects || 0).toLocaleString("en-US")}</strong></div>
      <div class="confirm-modal-metric"><span>预计耗时</span><strong>${formatPreviewSeconds(preview.estimatedSeconds)}</strong></div>
    </div>
    ${warningHtml}
    ${items.length ? items.map(renderCollectionRunPreviewItem).join("") : '<div class="empty-inline">没有可投递的采集项。</div>'}
  `;
}

function confirmCollectionRunPreview(preview = {}) {
  if (!els.collectionRunPreviewModal || !els.collectionRunPreviewBody) {
    if (preview.canRun === false) {
      return Promise.resolve(false);
    }
    return Promise.resolve(window.confirm(`预计投递 ${Number(preview.totalJobs || 0).toLocaleString("en-US")} 个 Job，预计耗时 ${formatPreviewSeconds(preview.estimatedSeconds)}。确认继续？`));
  }
  renderCollectionRunPreview(preview);
  els.collectionRunPreviewModal.hidden = false;
  if (window.lucide) {
    window.lucide.createIcons();
  }
  return new Promise((resolve) => {
    state.collectionRunPreviewResolver = resolve;
  });
}

const runCollectionQueue = async function runCollectionQueueWithPreview() {
  els.runCollectionQueueButton.disabled = true;
  els.collectionQueueCaption.textContent = "正在生成投递预估";
  try {
    const mode = els.collectionRunModeSelect.value || "all";
    const previewResponse = await apiFetch("/api/collection/queue/preview", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ mode })
    });
    const previewPayload = await previewResponse.json();
    if (!previewResponse.ok || !previewPayload.ok) {
      throw new Error(previewPayload.message || "采集任务预估失败");
    }
    const confirmed = await confirmCollectionRunPreview(previewPayload.preview || {});
    if (!confirmed) {
      els.collectionQueueCaption.textContent = "已取消投递";
      return;
    }
    els.collectionQueueCaption.textContent = "正在投递";
    const response = await apiFetch("/api/collection/queue/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ mode })
    });
    const payload = await response.json();
    state.collectionRunner = payload.run || state.collectionRunner;
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || "采集任务启动失败");
    }
    state.collectionRunId = "";
    await loadCollectionQueueStatus(1);
  } catch (error) {
    els.collectionQueueCaption.textContent = error.message || "采集任务启动失败";
  } finally {
    els.runCollectionQueueButton.disabled = false;
  }
};

async function recoverCollectionQueue() {
  if (!els.recoverCollectionQueueButton) return;
  els.recoverCollectionQueueButton.disabled = true;
  els.collectionQueueCaption.textContent = "正在诊断卡住任务";
  try {
    const response = await apiFetch("/api/collection/queue/recover", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        run_id: state.collectionRunId || state.collectionQueue?.currentRun?.runId || ""
      })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || payload.watchdog?.error || "队列诊断恢复失败");
    }
    state.collectionWatchdog = payload.watchdog || null;
    state.collectionWatchdogManual = true;
    state.collectionWatchdogManualUntil = Date.now() + 10_000;
    state.collectionQueue = payload.queue || state.collectionQueue;
    state.collectionRunner = payload.runner || state.collectionRunner;
    const watchdog = state.collectionWatchdog || {};
    els.collectionQueueCaption.textContent = `诊断完成：扫描 ${Number(watchdog.scanned || 0)}，补完成 ${Number(watchdog.completedFromSuccess || 0)}，转重试 ${Number(watchdog.retried || 0)}`;
    renderCollectionConsole();
  } catch (error) {
    els.collectionQueueCaption.textContent = error.message || "队列诊断恢复失败";
  } finally {
    els.recoverCollectionQueueButton.disabled = false;
  }
}

function setCollectionPage(action) {
  const page = state.collectionQueue?.jobPage || {};
  const pageCount = Math.max(1, Number(page.pageCount || 1));
  const currentPage = Math.min(pageCount, Math.max(1, Number(state.collectionPage || page.page || 1)));
  const nextPage = {
    first: 1,
    prev: Math.max(1, currentPage - 1),
    next: Math.min(pageCount, currentPage + 1),
    last: pageCount
  }[action] || currentPage;
  if (nextPage !== currentPage) {
    loadCollectionQueueStatus(nextPage, state.collectionRunId);
  }
}

function selectCollectionRun(runId) {
  state.collectionRunId = String(runId || "").trim();
  state.collectionPage = 1;
  loadCollectionQueueStatus(1, state.collectionRunId);
}

async function deleteCollectionRun(runId) {
  const normalizedRunId = String(runId || "").trim();
  if (!normalizedRunId) return;
  const confirmed = window.confirm("删除这个历史采集批次？只清理队列记录，不删除已写入的 Insights 数据。");
  if (!confirmed) return;
  if (els.collectionQueueCaption) {
    els.collectionQueueCaption.textContent = "正在删除采集批次";
  }
  try {
    const response = await apiFetch(`/api/collection/queue/runs/${encodeURIComponent(normalizedRunId)}`, {
      method: "DELETE"
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || "采集批次删除失败");
    }
    if (state.collectionRunId === normalizedRunId) {
      state.collectionRunId = "";
      state.collectionPage = 1;
    }
    await loadCollectionQueueStatus(1, state.collectionRunId);
  } catch (error) {
    if (els.collectionQueueCaption) {
      els.collectionQueueCaption.textContent = error.message || "采集批次删除失败";
    }
  }
}

function stopCollectionAutoRefresh() {
  if (state.collectionRefreshTimer) {
    clearInterval(state.collectionRefreshTimer);
    state.collectionRefreshTimer = null;
  }
}

function startCollectionAutoRefresh() {
  if (state.collectionRefreshTimer) return;
  state.collectionRefreshTimer = setInterval(() => {
    if (state.activeView === "tasks") {
      loadCollectionQueueStatus(state.collectionPage, state.collectionRunId);
    }
  }, COLLECTION_REFRESH_INTERVAL_MS);
}

function syncCollectionAutoRefresh() {
  if (state.activeView === "tasks") {
    startCollectionAutoRefresh();
  } else {
    stopCollectionAutoRefresh();
  }
}

function stopMonitorStatusAutoRefresh() {
  if (state.monitorStatusRefreshTimer) {
    clearInterval(state.monitorStatusRefreshTimer);
    state.monitorStatusRefreshTimer = null;
  }
}

function startMonitorStatusAutoRefresh() {
  if (state.monitorStatusRefreshTimer) return;
  state.monitorStatusRefreshTimer = setInterval(() => {
    if (state.activeView === "settings") {
      loadMonitorStatus();
    }
  }, MONITOR_STATUS_REFRESH_INTERVAL_MS);
}

function syncMonitorStatusAutoRefresh() {
  if (state.activeView === "settings") {
    startMonitorStatusAutoRefresh();
  } else {
    stopMonitorStatusAutoRefresh();
  }
}

async function loadEnvironmentSettings() {
  try {
    const response = await apiFetch("/api/settings/environment", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || "环境变量配置读取失败");
    }
    state.environmentSettings = payload.environment || null;
    state.environmentError = "";
  } catch (error) {
    state.environmentSettings = null;
    state.environmentError = error.message || "环境变量配置读取失败";
  }
  renderEnvironmentSettings();
}

async function loadResourceCatalog(message = "") {
  try {
    const response = await apiFetch("/api/settings/resources", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || "ACTIVE 候选读取失败");
    }
    state.resourceCatalog = {
      ...state.resourceCatalog,
      ...payload.catalog,
      campaigns: Array.isArray(payload.catalog?.campaigns) ? payload.catalog.campaigns : [],
      ads: Array.isArray(payload.catalog?.ads) ? payload.catalog.ads : []
    };
    state.resourceRefresh = payload.refresh || null;
    renderResourcePickers();
    renderMonitorStatus();
    if (message) {
      updateDirtyState(message);
    }
  } catch (error) {
    renderResourcePickers();
    updateDirtyState(error.message || "ACTIVE 候选读取失败");
  }
}

async function loadSettings(message = "") {
  if (state.settingsLoading && state.settingsLoadPromise) {
    return state.settingsLoadPromise;
  }

  state.settingsLoading = true;
  setSettingsStatus(message || "设置读取中");
  state.settingsLoadPromise = (async () => {
    try {
      await Promise.all([
        loadAccountSettings(),
        loadSamplingSettings(),
        loadEnvironmentSettings()
      ]);
      renderAccountSettings();
      renderSamplingSettings();
      renderEnvironmentSettings();
      captureSavedSettingsSnapshot();
      state.settingsLoaded = true;
      await Promise.all([
        loadResourceCatalog(),
        loadMonitorStatus()
      ]);
      if (message) {
        updateDirtyState(message);
      }
    } finally {
      state.settingsLoading = false;
      state.settingsLoadPromise = null;
    }
  })();
  return state.settingsLoadPromise;
}

function ensureSettingsLoaded(message = "") {
  if (state.settingsLoaded && !message) {
    return Promise.resolve();
  }
  return loadSettings(message);
}

async function refreshActiveResources() {
  els.refreshResourcesButton.disabled = true;
  updateDirtyState("ACTIVE 资源刷新中");
  try {
    const response = await apiFetch("/api/settings/resources/refresh", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        force: true
      })
    });
    const payload = await response.json();
    state.resourceCatalog = {
      ...state.resourceCatalog,
      ...payload.candidates,
      campaigns: Array.isArray(payload.candidates?.campaigns) ? payload.candidates.campaigns : [],
      ads: Array.isArray(payload.candidates?.ads) ? payload.candidates.ads : []
    };
    state.resourceRefresh = payload.refresh || null;
    renderSamplingSettings();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || "ACTIVE 资源刷新失败");
    }
    updateDirtyState("ACTIVE 资源已刷新");
  } catch (error) {
    renderSamplingSettings();
    updateDirtyState(error.message || "ACTIVE 资源刷新失败");
  } finally {
    els.refreshResourcesButton.disabled = false;
  }
}

async function saveSettings() {
  const accounts = parseAccountInput(els.monitorAccountsInput.value);
  const samplingSettings = collectSamplingSettings();
  const environmentEntries = collectEnvironmentEntries();
  els.saveSettingsButton.disabled = true;
  updateDirtyState("保存中");
  try {
    const accountResponse = await apiFetch("/api/settings/accounts", {
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
    const samplingResponse = await apiFetch("/api/settings/sampling", {
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
    const environmentResponse = await apiFetch("/api/settings/environment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ entries: environmentEntries })
    });
    const environmentPayload = await environmentResponse.json();
    if (!environmentResponse.ok || !environmentPayload.ok) {
      throw new Error(environmentPayload.message || "环境变量保存失败");
    }
    state.monitoredAccounts = accountPayload.accounts;
    state.samplingSettings = normalizeSamplingSettings(samplingPayload.settings);
    state.environmentSettings = environmentPayload.environment || state.environmentSettings;
    renderAccountSettings();
    renderSamplingSettings();
    renderEnvironmentSettings();
    await loadMonitorStatus();
    captureSavedSettingsSnapshot();
    updateDirtyState("已保存");
  } catch (error) {
    updateDirtyState(error.message || "保存失败");
  } finally {
    els.saveSettingsButton.disabled = false;
  }
}

async function loadCollectedRows() {
  try {
    const response = await apiFetch("/api/fb-ads/latest?shape=dashboard", { cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json();
    if (!payload.ok || !Array.isArray(payload.rows)) return null;
    if (payload.rows.length === 0) {
      dataSourceName.textContent = payload.storage === "sqlite" ? "SQLite Insights" : "Collected Insights";
      dataSourceMeta.textContent = "0 行";
      return [];
    }

    const rows = payload.shape === "dashboard_columns"
      ? mapDashboardColumnRows(payload.rows, payload.columns)
      : payload.shape === "dashboard"
        ? payload.rows.filter((row) => Number.isFinite(row.timestamp))
      : payload.rows.map(mapCollectedRow).filter((row) => Number.isFinite(row.timestamp));
    if (rows.length === 0) return [];

    if (payload.metadata?.granularity === "hour" || payload.rows.some((row) => row.hour_start)) {
      state.granularity = "hour";
    }
    applyCampaignsFromRows(rows);
    dataSourceName.textContent = payload.storage === "sqlite" ? "SQLite Insights" : "Collected Insights";
    const rowText = `${rows.length.toLocaleString("en-US")} 行`;
    const updateText = payload.updated_at ? `更新于 ${formatInstantInDisplayTimeZone(payload.updated_at)}` : payload.source;
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
    if (!state.selectedAdId && state.selectedAds.size > 0 && !state.selectedAds.has(String(row.adId || ""))) {
      return false;
    }
    if (state.delivery !== "all" && row.delivery !== state.delivery) {
      return false;
    }
    if (state.selectedAdId && String(row.adId || "") !== state.selectedAdId) {
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
  return !adCompareEnabled() && !state.selectedAdId && state.selectedCampaigns.size > 1;
}

function selectedCampaignsInDisplayOrder() {
  return CAMPAIGNS.filter((campaign) => state.selectedCampaigns.has(campaign.id));
}

function adCompareEnabled() {
  return !state.selectedAdId && state.selectedAds.size > 1;
}

function selectedAdsInDisplayOrder() {
  return adOptions.filter((ad) => state.selectedAds.has(ad.id));
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

function aggregateByAdTime(rows, timePoints) {
  if (!adCompareEnabled() || timePoints.length === 0) {
    return [];
  }

  const ads = selectedAdsInDisplayOrder();
  const pointKeys = new Set(timePoints.map((point) => point.key));
  const adBuckets = new Map();

  ads.forEach((ad) => {
    const buckets = new Map();
    timePoints.forEach((point) => {
      buckets.set(point.key, {
        key: point.key,
        label: point.label,
        sortDate: point.sortDate,
        ...createAccumulator()
      });
    });
    adBuckets.set(ad.id, buckets);
  });

  rows.forEach((row) => {
    const buckets = adBuckets.get(String(row.adId || ""));
    if (!buckets) {
      return;
    }
    const key = bucketDate(new Date(row.timestamp), state.granularity).getTime();
    if (!pointKeys.has(key)) {
      return;
    }
    addToAccumulator(buckets.get(key), row);
  });

  return ads.map((ad) => ({
    ad,
    points: timePoints.map((point) => deriveMetrics(adBuckets.get(ad.id).get(point.key)))
  }));
}

function aggregateByCampaign(rows) {
  const buckets = new Map();

  rows.forEach((row) => {
    if (!buckets.has(row.campaignId)) {
      buckets.set(row.campaignId, {
        id: row.campaignId,
        campaign: row.campaignName || row.campaign,
        campaignId: row.campaignId,
        account: row.account,
        accountId: row.accountId,
        delivery: row.delivery,
        objective: row.objective,
        latestTimestamp: 0,
        latestUpdateAt: "",
        latestDayKey: "",
        latestDaySpend: 0,
        rowCount: 0,
        ...createAccumulator()
      });
    }
    const bucket = buckets.get(row.campaignId);
    addToAccumulator(bucket, row);
    addRowFreshness(bucket, row);
  });

  return [...buckets.values()]
    .map(deriveMetrics)
    .sort((a, b) => b.spend - a.spend);
}

function aggregateByAd(rows) {
  const buckets = new Map();

  rows.filter((row) => row.adId).forEach((row) => {
    if (!buckets.has(row.adId)) {
      buckets.set(row.adId, {
        id: row.adId,
        adId: row.adId,
        adName: row.adName || row.adId,
        campaign: row.campaignName || row.campaign,
        campaignId: row.campaignId,
        adsetName: row.adsetName,
        adsetId: row.adsetId,
        account: row.account,
        accountId: row.accountId,
        delivery: row.delivery,
        objective: row.objective,
        latestTimestamp: 0,
        latestUpdateAt: "",
        latestDayKey: "",
        latestDaySpend: 0,
        rowCount: 0,
        ...createAccumulator()
      });
    }
    const bucket = buckets.get(row.adId);
    addToAccumulator(bucket, row);
    addRowFreshness(bucket, row);
  });

  return [...buckets.values()]
    .map(deriveMetrics)
    .sort((a, b) => b.latestDaySpend - a.latestDaySpend || b.spend - a.spend);
}

function addRowFreshness(bucket, row) {
  bucket.rowCount += 1;
  const timestamp = Number(row.timestamp || 0);
  const dayKey = toDateValue(new Date(timestamp));
  if (timestamp > bucket.latestTimestamp) {
    if (dayKey !== bucket.latestDayKey) {
      bucket.latestDaySpend = 0;
    }
    bucket.latestTimestamp = timestamp;
    bucket.latestDayKey = dayKey;
    bucket.latestUpdateAt = row.dataUpdatedAt || "";
    bucket.delivery = row.delivery || bucket.delivery;
  }
  if (dayKey === bucket.latestDayKey) {
    bucket.latestDaySpend += Number(row.spend || 0);
  }
}

function latestUpdateLabel(row) {
  return row.latestUpdateAt ? formatInstantInDisplayTimeZone(row.latestUpdateAt) : "-";
}

function latestSpendLabel(row) {
  return formatValue("spend", row.latestDaySpend || 0);
}

function objectTooltip(row, mode) {
  const name = mode === "ads" ? (row.adName || row.adId) : (row.campaign || row.campaignId);
  const parent = mode === "ads"
    ? [`广告系列：${row.campaign || "-"}`, `广告组：${row.adsetName || row.adsetId || "-"}`]
    : [`账户：${row.account || row.accountId || "-"}`];
  return [
    name,
    ...parent,
    `最近一天消耗：${latestSpendLabel(row)}`,
    `数据更新时间：${latestUpdateLabel(row)}`,
    `窗口消耗：${formatValue("spend", row.spend)}`,
    `ROAS：${formatValue("roas", row.roas)}`,
    `明细行数：${row.rowCount || 0}`
  ].join("\n");
}

function selectedAdLabel() {
  if (!state.selectedAdId) return "";
  const row = rawRows.find((item) => String(item.adId || "") === state.selectedAdId);
  return row?.adName || state.selectedAdId;
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

function loadStyleOnce(href) {
  if ([...document.styleSheets].some((sheet) => sheet.href && sheet.href.includes(href))) {
    return Promise.resolve();
  }
  if (document.querySelector(`link[href="${href}"]`)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = resolve;
    link.onerror = () => reject(new Error(`${href} 加载失败`));
    document.head.appendChild(link);
  });
}

function loadScriptOnce(src, globalName) {
  if (globalName && window[globalName]) {
    return Promise.resolve();
  }
  const existing = document.querySelector(`script[src="${src}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", () => reject(new Error(`${src} 加载失败`)), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`${src} 加载失败`));
    document.head.appendChild(script);
  });
}

function pruneSelectedCampaigns() {
  const campaignIds = new Set(CAMPAIGNS.map((campaign) => campaign.id));
  state.selectedCampaigns.forEach((id) => {
    if (!campaignIds.has(id)) {
      state.selectedCampaigns.delete(id);
    }
  });
}

function pruneSelectedAds() {
  const adIds = new Set(adOptions.map((ad) => ad.id));
  state.selectedAds.forEach((id) => {
    if (!adIds.has(id)) {
      state.selectedAds.delete(id);
    }
  });
}

function renderFilters() {
  pruneSelectedCampaigns();
  pruneSelectedAds();
  setSelectOptions(els.campaignFilter, CAMPAIGNS.map((campaign) => ({
    value: campaign.id,
    label: campaign.name
  })), state.selectedCampaigns);

  setSelectOptions(els.adFilter, adOptions.map((ad) => ({
    value: ad.id,
    label: `${ad.name} · ${ad.id}${ad.campaignName ? ` · ${ad.campaignName}` : ""}`
  })), state.selectedAds);

  setSelectOptions(els.fieldFilter, metricFields.map((field) => ({
    value: field.id,
    label: field.label
  })), state.selectedFields);

  const deliveries = [...new Set(CAMPAIGNS.map((campaign) => campaign.delivery))];
  els.deliveryFilter.innerHTML = [
    `<option value="all" ${state.delivery === "all" ? "selected" : ""}>全部投放状态</option>`,
    ...deliveries.map((delivery) => `<option value="${delivery}" ${state.delivery === delivery ? "selected" : ""}>${delivery}</option>`)
  ].join("");

  syncFieldSummary();
  renderFilterPickers();
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

function selectedAdFilterLabel() {
  if (state.selectedAds.size === 0) {
    return "";
  }
  if (state.selectedAds.size === 1) {
    const [adId] = state.selectedAds;
    return adOptions.find((ad) => ad.id === adId)?.name || adId;
  }
  return `单广告：${state.selectedAds.size} 个`;
}

function selectedDeliveryLabel() {
  return state.delivery === "all" ? "全部投放状态" : state.delivery;
}

function formatDateTimeLabel(value) {
  return value ? value.replace("T", " ") : "-";
}

function formatRangeText() {
  return `${formatDateTimeLabel(state.from)} 至 ${formatDateTimeLabel(state.to)} · ${DISPLAY_TIME_ZONE_LABEL}`;
}

function renderActiveChips() {
  const metricCount = selectedMetricIds().length;
  const chips = [
    `时间：${formatRangeText()}`,
    getGranularityLabel(),
    selectedCampaignLabel(),
    selectedAdFilterLabel(),
    selectedDeliveryLabel(),
    state.selectedAdId ? `AD：${selectedAdLabel()}` : "",
    `图表指标：${metricCount} 项`
  ].filter(Boolean);

  els.activeChips.innerHTML = chips.map((chip) => `<span class="filter-chip"><strong>${chip}</strong></span>`).join("");
}

function syncFieldSummary() {
  els.fieldSummary.textContent = `已选 ${state.selectedFields.size} 个指标`;
}

function filterPickerElements(kind) {
  if (kind === "campaigns") {
    return {
      select: els.campaignFilter,
      toggle: els.campaignFilterToggle,
      label: els.campaignFilterLabel,
      dropdown: els.campaignFilterDropdown,
      search: els.campaignFilterSearch,
      optionList: els.campaignFilterOptionList,
      selectedList: els.campaignFilterSelectedList
    };
  }
  if (kind === "ads") {
    return {
      select: els.adFilter,
      toggle: els.adFilterToggle,
      label: els.adFilterLabel,
      dropdown: els.adFilterDropdown,
      search: els.adFilterSearch,
      optionList: els.adFilterOptionList,
      selectedList: els.adFilterSelectedList
    };
  }
  if (kind === "delivery") {
    return {
      select: els.deliveryFilter,
      toggle: els.deliveryFilterToggle,
      label: els.deliveryFilterLabel,
      dropdown: els.deliveryFilterDropdown,
      search: els.deliveryFilterSearch,
      optionList: els.deliveryFilterOptionList,
      selectedList: null
    };
  }
  return {
    select: els.fieldFilter,
    toggle: els.fieldFilterToggle,
    label: els.fieldFilterLabel,
    dropdown: els.fieldFilterDropdown,
    search: els.fieldFilterSearch,
    optionList: els.fieldFilterOptionList,
    selectedList: els.fieldFilterSelectedList
  };
}

function filterPickerOptions(kind) {
  if (kind === "campaigns") {
    return CAMPAIGNS.map((campaign) => ({
      id: campaign.id,
      label: campaign.name,
      meta: campaign.id,
      search: `${campaign.name} ${campaign.id}`.toLowerCase()
    }));
  }
  if (kind === "ads") {
    return adOptions.map((ad) => ({
      id: ad.id,
      label: ad.name,
      meta: [ad.id, ad.campaignName].filter(Boolean).join(" · "),
      search: `${ad.name} ${ad.id} ${ad.campaignName || ""}`.toLowerCase()
    }));
  }
  if (kind === "delivery") {
    const deliveries = ["all", ...new Set(CAMPAIGNS.map((campaign) => campaign.delivery).filter(Boolean))];
    return deliveries.map((delivery) => ({
      id: delivery,
      label: delivery === "all" ? "全部投放状态" : delivery,
      meta: delivery === "all" ? "不限制投放状态" : "投放状态",
      search: `${delivery === "all" ? "全部投放状态" : delivery} ${delivery}`.toLowerCase()
    }));
  }
  return metricFields.map((field) => ({
    id: field.id,
    label: field.label,
    meta: field.api || field.id,
    search: `${field.label} ${field.id} ${field.api || ""}`.toLowerCase()
  }));
}

function filterPickerSelection(kind) {
  if (kind === "campaigns") return state.selectedCampaigns;
  if (kind === "ads") return state.selectedAds;
  if (kind === "delivery") return new Set([state.delivery || "all"]);
  return state.selectedFields;
}

function filterPickerEmptyLabel(kind) {
  if (kind === "campaigns") return "全部广告系列";
  if (kind === "ads") return "全部单广告";
  if (kind === "delivery") return "全部投放状态";
  return "选择指标";
}

function filterPickerLabel(kind) {
  const selected = filterPickerSelection(kind);
  if (selected.size === 0) return filterPickerEmptyLabel(kind);
  if (kind === "delivery") return selectedDeliveryLabel();
  if (kind === "fields") return `已选 ${selected.size} 个指标`;
  if (selected.size === 1) {
    const [id] = selected;
    return filterPickerOptions(kind).find((item) => item.id === id)?.label || id;
  }
  return `${kind === "campaigns" ? "广告系列" : "单广告"}：${selected.size} 个`;
}

function filteredPickerOptions(kind) {
  const query = state.filterPickers[kind].query.trim().toLowerCase();
  const options = filterPickerOptions(kind);
  if (!query) return options;
  return options.filter((option) => option.search.includes(query));
}

function setFilterPickerOpen(kind, open) {
  Object.keys(state.filterPickers).forEach((key) => {
    state.filterPickers[key].open = key === kind ? open : false;
  });
  renderFilterPickers();
  if (open) {
    requestAnimationFrame(() => filterPickerElements(kind).search?.focus());
  }
}

function renderFilterPicker(kind) {
  const elements = filterPickerElements(kind);
  const selected = filterPickerSelection(kind);
  const filteredOptions = filteredPickerOptions(kind);
  const stateItem = state.filterPickers[kind];

  elements.label.textContent = filterPickerLabel(kind);
  elements.toggle.setAttribute("aria-expanded", String(stateItem.open));
  elements.dropdown.hidden = !stateItem.open;
  if (elements.search.value !== stateItem.query) {
    elements.search.value = stateItem.query;
  }

  elements.optionList.innerHTML = filteredOptions.length
    ? filteredOptions.map((option) => `
      <label class="entity-option" title="${escapeHtml(option.meta)}">
        <input type="checkbox" data-filter-picker="${escapeHtml(kind)}" data-filter-picker-id="${escapeHtml(option.id)}" ${selected.has(option.id) ? "checked" : ""}>
        <span>
          <strong>${escapeHtml(option.label)}</strong>
          <small>${escapeHtml(option.meta)}</small>
        </span>
      </label>
    `).join("")
    : '<div class="empty-inline">当前筛选没有可选项</div>';

  const selectedItems = [...selected]
    .map((id) => filterPickerOptions(kind).find((item) => item.id === id) || { id, label: id, meta: id });
  if (elements.selectedList) {
    elements.selectedList.innerHTML = selectedItems.map((item) => `
      <span class="entity-pill">
        ${escapeHtml(item.label)}
        <button type="button" data-remove-filter-picker="${escapeHtml(kind)}" data-filter-picker-id="${escapeHtml(item.id)}" aria-label="移除 ${escapeHtml(item.label)}">×</button>
      </span>
    `).join("");
  }
}

function renderFilterPickers() {
  ["campaigns", "ads", "delivery", "fields"].forEach(renderFilterPicker);
  syncFieldSummary();
}

function setFilterPickerSelection(kind, ids) {
  const normalized = new Set(ids.map((id) => String(id || "").trim()).filter(Boolean));
  if (kind === "campaigns") {
    state.selectedCampaigns = normalized;
    state.selectedAdId = "";
    if (normalized.size) {
      state.selectedAds = new Set();
    }
  } else if (kind === "ads") {
    state.selectedAds = normalized;
    state.selectedAdId = "";
    if (normalized.size) {
      state.selectedCampaigns = new Set();
    }
  } else if (kind === "delivery") {
    const [delivery] = normalized;
    state.delivery = delivery || "all";
  } else {
    state.selectedFields = normalized;
  }
  syncCampaignChoiceSelection();
  syncAdChoiceSelection();
  syncDeliveryChoiceSelection();
  syncFieldChoiceSelection();
  renderDashboard();
}

function syncFieldChoiceSelection() {
  isSyncingSelects = true;
  [...els.fieldFilter.options].forEach((option) => {
    option.selected = state.selectedFields.has(option.value);
  });
  isSyncingSelects = false;
  syncFieldSummary();
  renderFilterPicker("fields");
}

function syncCampaignChoiceSelection() {
  isSyncingSelects = true;
  [...els.campaignFilter.options].forEach((option) => {
    option.selected = state.selectedCampaigns.has(option.value);
  });
  isSyncingSelects = false;
  renderFilterPicker("campaigns");
}

function syncAdChoiceSelection() {
  isSyncingSelects = true;
  [...els.adFilter.options].forEach((option) => {
    option.selected = state.selectedAds.has(option.value);
  });
  isSyncingSelects = false;
  renderFilterPicker("ads");
}

function syncDeliveryChoiceSelection() {
  isSyncingSelects = true;
  els.deliveryFilter.value = state.delivery || "all";
  isSyncingSelects = false;
  renderFilterPicker("delivery");
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
  applyPermissionVisibility();
  const copy = viewCopy[state.activeView];
  els.pageTitle.textContent = copy.title;
  els.pageSubtitle.textContent = copy.subtitle;
  const usesDashboardToolbar = !["settings", "alerts", "analysis", "tasks"].includes(state.activeView);
  els.viewToolbar.hidden = !usesDashboardToolbar;
  els.resetWindowButton.hidden = !usesDashboardToolbar;
  const activePanelView = ["alerts", "analysis"].includes(state.activeView) ? "alert-ai" : state.activeView;

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.activeView);
  });

  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    const active = panel.dataset.viewPanel === activePanelView;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  syncCollectionAutoRefresh();
  syncMonitorStatusAutoRefresh();

  if (state.activeView === "chart" && chart) {
    requestAnimationFrame(() => chart.resize());
  }
  if (state.activeView === "list" && listChart) {
    requestAnimationFrame(() => listChart.resize());
  }
  if (state.activeView === "settings") {
    renderAccountSettings();
    renderSamplingSettings();
    renderEnvironmentSettings();
    ensureSettingsLoaded().catch((error) => {
      updateDirtyState(error.message || "设置读取失败");
    });
  }
  if (state.activeView === "tasks") {
    renderCollectionConsole();
    loadCollectionQueueStatus(state.collectionPage, state.collectionRunId).catch(() => {
      renderCollectionConsole();
    });
  }
  if (state.activeView === "alerts") {
    window.AlertAiModule?.activate?.("templates");
  }
  if (state.activeView === "analysis") {
    window.AlertAiModule?.activate?.("report");
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
  const compareAdsMode = adCompareEnabled();
  const compareMode = campaignCompareEnabled();
  const compareAdGroups = compareAdsMode ? aggregateByAdTime(rows, points) : [];
  const compareGroups = compareMode ? aggregateByCampaignTime(rows, points) : [];
  const compareSuffix = compareAdsMode
    ? ` · ${compareAdGroups.length} 个单广告对比`
    : compareMode ? ` · ${compareGroups.length} 个广告系列对比` : "";
  const adSuffix = state.selectedAdId ? ` · AD：${selectedAdLabel()}` : "";
  els.chartCaption.textContent = `${getGranularityLabel()} · ${formatRangeText()}${compareSuffix}${adSuffix}`;
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
        opacity: compareAdsMode || compareMode ? 0.06 : 0.14
      },
      emphasis: {
        focus: "series"
      },
      color: color || chartPalette[seriesIndex % chartPalette.length]
    };
  };

  const series = compareAdsMode
    ? compareAdGroups.flatMap((group, adIndex) => metrics.map((id, metricIndex) => {
      const field = fieldById.get(id);
      const values = group.points.map((point) => Number(point[id] || 0));
      const name = metrics.length === 1 ? group.ad.name : `${group.ad.name} · ${field.label}`;
      return createSeries({
        name,
        field,
        values,
        color: chartPalette[(adIndex * metrics.length + metricIndex) % chartPalette.length],
        seriesIndex: adIndex * metrics.length + metricIndex
      });
    }))
    : compareMode
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
          const metricId = raw?.id || item.seriesName;
          const rawValue = raw?.values?.[index] ?? item.value;
          return `${item.marker}${item.seriesName}: <strong>${formatValue(metricId, rawValue)}</strong>`;
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

function renderListAdChart() {
  if (!state.selectedAdId) {
    els.listAdChartPanel.hidden = true;
    if (listChart) listChart.clear();
    return;
  }

  els.listAdChartPanel.hidden = false;
  const points = lastChartData;
  const metrics = selectedMetricIds();
  const label = selectedAdLabel();
  els.listAdChartTitle.textContent = "单广告趋势";
  els.listAdChartCaption.textContent = `${label} · ${getGranularityLabel()} · ${formatRangeText()}`;
  els.listAdChartEmpty.textContent = metrics.length === 0 ? "请选择至少一个数值指标" : "当前广告没有可展示趋势";
  els.listAdChartEmpty.hidden = metrics.length > 0 && points.length > 0;

  if (!window.echarts || metrics.length === 0 || points.length === 0) {
    if (listChart) listChart.clear();
    return;
  }

  if (!listChart) {
    listChart = echarts.init(els.listAdChart, null, { renderer: "canvas" });
  }

  const labels = points.map((point) => point.label);
  const series = metrics.map((id, index) => {
    const field = fieldById.get(id);
    const values = points.map((point) => Number(point[id] || 0));
    return {
      name: field.label,
      type: "line",
      smooth: true,
      showSymbol: points.length <= 1,
      symbolSize: 6,
      data: state.normalize && metrics.length > 1 ? normalizeValues(values) : values,
      rawValues: values,
      color: field.color || chartPalette[index % chartPalette.length],
      areaStyle: { opacity: 0.12 },
      lineStyle: { width: 2 },
      emphasis: { focus: "series" }
    };
  });

  listChart.setOption({
    animationDuration: 360,
    color: series.map((item) => item.color),
    tooltip: {
      trigger: "axis",
      confine: true,
      formatter(params) {
        const index = params[0]?.dataIndex || 0;
        const rows = params.map((item) => {
          const metricId = metrics[item.seriesIndex];
          return `${item.marker}${item.seriesName}: <strong>${formatValue(metricId, series[item.seriesIndex].rawValues[index])}</strong>`;
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
      textStyle: { color: "#526071" }
    },
    grid: {
      top: 58,
      left: 56,
      right: 24,
      bottom: 52,
      containLabel: true
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: labels,
      axisLabel: { color: "#64748b", hideOverlap: true },
      axisLine: { lineStyle: { color: "#cbd5e1" } }
    },
    yAxis: {
      type: "value",
      name: state.normalize && metrics.length > 1 ? "统一比例" : "数值",
      nameTextStyle: { color: "#64748b" },
      axisLabel: { color: "#64748b" },
      splitLine: { lineStyle: { color: "#edf1f7" } }
    },
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
  const mode = state.listMode;
  const metricColumns = selectedMetricIds().filter((id) => fieldById.has(id));
  const objectHeader = mode === "ads" ? "广告" : "广告系列";
  els.tableTitle.textContent = mode === "ads" ? "广告汇总" : "广告系列汇总";
  els.tableHead.innerHTML = `
    <tr>
      <th>${objectHeader}</th>
      <th>最近一天消耗</th>
      <th>数据更新时间(北京时间)</th>
      <th>投放</th>
      ${metricColumns.map((id) => `<th>${fieldById.get(id).label}</th>`).join("")}
      <th>操作</th>
    </tr>
  `;

  els.tableBody.innerHTML = rows.map((row) => {
    const tooltip = escapeHtml(objectTooltip(row, mode));
    const name = mode === "ads" ? (row.adName || row.adId) : (row.campaign || row.campaignId);
    const id = mode === "ads" ? row.adId : row.campaignId;
    const secondary = mode === "ads"
      ? [`广告系列：${row.campaign || "-"}`, `广告组：${row.adsetName || row.adsetId || "-"}`].join(" · ")
      : `账户：${row.account || row.accountId || "-"}`;
    const trendButton = mode === "ads"
      ? `<button class="row-action-button" type="button" data-ad-drilldown="${escapeHtml(row.adId)}"><i data-lucide="area-chart"></i><span>趋势</span></button>`
      : "";
    return `
      <tr title="${tooltip}">
        <td class="object-cell">
          <strong>${escapeHtml(name || "-")}</strong>
          <small>${escapeHtml(id || "-")}</small>
          <small>${escapeHtml(secondary)}</small>
        </td>
        <td>${latestSpendLabel(row)}</td>
        <td>${escapeHtml(latestUpdateLabel(row))}</td>
        <td><span class="status-pill ${statusClass(row.delivery)}">${escapeHtml(row.delivery || "未知")}</span></td>
        ${metricColumns.map((metricId) => `<td>${formatValue(metricId, row[metricId])}</td>`).join("")}
        <td><div class="row-actions table-row-actions">${trendButton}</div></td>
      </tr>
    `;
  }).join("");

  els.tableCount.textContent = `${rows.length} 行`;
  els.tableCaption.textContent = formatRangeText();
  scheduleIconRefresh();
}

function calculateTotals(rows) {
  const total = createAccumulator();
  rows.forEach((row) => addToAccumulator(total, row));
  return deriveMetrics(total);
}

function setAdDrilldown(adId, targetView = state.activeView) {
  state.selectedAdId = String(adId || "");
  if (state.selectedAdId) {
    state.selectedAds = new Set();
    syncAdChoiceSelection();
    const row = rawRows.find((item) => String(item.adId || "") === state.selectedAdId);
    if (row?.campaignId) {
      state.selectedCampaigns = new Set([row.campaignId]);
      syncCampaignChoiceSelection();
    }
    state.listMode = "ads";
  }
  if (targetView && targetView !== state.activeView) {
    state.activeView = targetView;
    renderView();
  }
  renderDashboard();
}

function clearAdDrilldown() {
  state.selectedAdId = "";
  renderDashboard();
}

function renderDashboard() {
  coerceGranularity();
  syncGranularityButtons();
  const rows = getFilteredRows();
  const timePoints = aggregateByTime(rows);
  const baseRows = state.selectedAdId
    ? rawRows.filter((row) => {
      const bounds = selectedRangeBounds();
      return bounds
        && row.timestamp >= bounds.from.getTime()
        && row.timestamp <= bounds.to.getTime()
        && (state.selectedCampaigns.size === 0 || state.selectedCampaigns.has(row.campaignId))
        && (state.delivery === "all" || row.delivery === state.delivery);
    })
    : rows;
  const campaignRows = aggregateByCampaign(baseRows);
  const adRows = aggregateByAd(baseRows);
  const total = calculateTotals(rows);

  lastChartData = timePoints;
  lastChartRows = rows;
  lastCampaignRows = campaignRows;

  renderKpis(total);
  renderMetricGrid(total);
  renderChart(timePoints, rows);
  renderTable(state.listMode === "ads" ? adRows : campaignRows);
  renderListAdChart();
  syncFieldSummary();
  renderActiveChips();
}

function latestDataDate() {
  if (rawRows.length === 0) {
    return nowDisplayClockDate();
  }
  const maxTimestamp = Math.max(...rawRows.map((row) => row.timestamp));
  return new Date(maxTimestamp);
}

function sameDate(a, b) {
  return a.getUTCFullYear() === b.getUTCFullYear()
    && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCDate() === b.getUTCDate();
}

function currentHour() {
  const now = nowDisplayClockDate();
  now.setUTCMinutes(0, 0, 0);
  return now;
}

function updateTimeControls() {
  els.fromDate.value = state.from;
  els.toDate.value = state.to;
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
      els.campaignFilterToggle.focus();
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

  document.querySelectorAll("[data-list-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.listMode = button.dataset.listMode;
      document.querySelectorAll("[data-list-mode]").forEach((item) => {
        item.classList.toggle("active", item.dataset.listMode === state.listMode);
      });
      renderDashboard();
    });
  });

  els.campaignFilter.addEventListener("change", () => {
    if (isSyncingSelects) {
      return;
    }
    state.selectedCampaigns = new Set(selectedControlValues(els.campaignFilter));
    state.selectedAdId = "";
    if (state.selectedCampaigns.size > 0) {
      state.selectedAds = new Set();
      syncAdChoiceSelection();
    }
    renderDashboard();
  });

  els.adFilter.addEventListener("change", () => {
    if (isSyncingSelects) {
      return;
    }
    state.selectedAds = new Set(selectedControlValues(els.adFilter));
    state.selectedAdId = "";
    if (state.selectedAds.size > 0) {
      state.selectedCampaigns = new Set();
      syncCampaignChoiceSelection();
    }
    renderDashboard();
  });

  els.deliveryFilter.addEventListener("change", () => {
    state.delivery = els.deliveryFilter.value;
    syncDeliveryChoiceSelection();
    renderDashboard();
  });

  els.normalizeToggle.addEventListener("change", () => {
    state.normalize = els.normalizeToggle.checked;
    renderChart(lastChartData, lastChartRows);
    renderListAdChart();
  });

  els.fieldFilter.addEventListener("change", () => {
    if (isSyncingSelects) {
      return;
    }
    state.selectedFields = new Set(selectedControlValues(els.fieldFilter));
    renderDashboard();
  });

  ["campaigns", "ads", "delivery", "fields"].forEach((kind) => {
    const elements = filterPickerElements(kind);
    elements.toggle.addEventListener("click", () => {
      setFilterPickerOpen(kind, !state.filterPickers[kind].open);
    });
    elements.search.addEventListener("input", () => {
      state.filterPickers[kind].query = elements.search.value;
      state.filterPickers[kind].open = true;
      renderFilterPicker(kind);
    });
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest(".filter-entity-picker")) {
      return;
    }
    if (Object.values(state.filterPickers).some((picker) => picker.open)) {
      Object.values(state.filterPickers).forEach((picker) => {
        picker.open = false;
      });
      renderFilterPickers();
    }
  });

  document.addEventListener("change", (event) => {
    const input = event.target.closest("[data-filter-picker-id][data-filter-picker]");
    if (!input) {
      return;
    }
    const kind = input.dataset.filterPicker;
    if (kind === "delivery") {
      setFilterPickerSelection(kind, input.checked ? [input.dataset.filterPickerId] : ["all"]);
      state.filterPickers.delivery.open = false;
      renderFilterPicker("delivery");
      return;
    }
    const current = new Set(filterPickerSelection(kind));
    if (input.checked) {
      current.add(input.dataset.filterPickerId);
    } else {
      current.delete(input.dataset.filterPickerId);
    }
    setFilterPickerSelection(kind, [...current]);
  });

  document.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-filter-picker-action]");
    if (actionButton) {
      const kind = actionButton.dataset.filterPicker;
      const action = actionButton.dataset.filterPickerAction;
      if (action === "select-all") {
        setFilterPickerSelection(kind, filteredPickerOptions(kind).map((option) => option.id));
      }
      if (action === "clear") {
        setFilterPickerSelection(kind, []);
      }
      return;
    }

    const removeButton = event.target.closest("[data-remove-filter-picker]");
    if (removeButton) {
      const kind = removeButton.dataset.removeFilterPicker;
      const current = new Set(filterPickerSelection(kind));
      current.delete(removeButton.dataset.filterPickerId);
      setFilterPickerSelection(kind, [...current]);
    }
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
    clearAdDrilldown();
    if (chart) {
      chart.dispatchAction({ type: "dataZoom", start: 0, end: 100 });
    }
    renderDashboard();
  });

  els.clearAdDrilldownButton.addEventListener("click", clearAdDrilldown);

  els.reloadSettingsButton?.addEventListener("click", () => {
    loadSettings("已刷新");
  });

  els.refreshResourcesButton?.addEventListener("click", () => {
    refreshActiveResources();
  });

  els.refreshCollectionQueueButton?.addEventListener("click", () => {
    loadCollectionQueueStatus(state.collectionPage, state.collectionRunId);
  });

  els.recoverCollectionQueueButton?.addEventListener("click", () => {
    recoverCollectionQueue();
  });

  els.runCollectionQueueButton?.addEventListener("click", () => {
    runCollectionQueue();
  });

  els.collectionRunPreviewCloseButton?.addEventListener("click", () => {
    closeCollectionRunPreview(false);
  });

  els.collectionRunPreviewCancelButton?.addEventListener("click", () => {
    closeCollectionRunPreview(false);
  });

  els.collectionRunPreviewConfirmButton?.addEventListener("click", () => {
    closeCollectionRunPreview(true);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && els.collectionRunPreviewModal && !els.collectionRunPreviewModal.hidden) {
      closeCollectionRunPreview(false);
    }
  });

  document.querySelectorAll("[data-collection-page]").forEach((button) => {
    button.addEventListener("click", () => {
      setCollectionPage(button.dataset.collectionPage);
    });
  });

  els.collectionRunList?.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-delete-collection-run]");
    if (deleteButton) {
      event.stopPropagation();
      if (!deleteButton.disabled) {
        deleteCollectionRun(deleteButton.dataset.deleteCollectionRun);
      }
      return;
    }
    const button = event.target.closest("[data-collection-run-id]");
    if (!button) return;
    selectCollectionRun(button.dataset.collectionRunId);
  });

  els.collectionRunList?.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    const item = event.target.closest("[data-collection-run-id]");
    if (!item || event.target.closest("[data-delete-collection-run]")) return;
    event.preventDefault();
    selectCollectionRun(item.dataset.collectionRunId);
  });

  els.resetSettingsButton?.addEventListener("click", () => {
    loadSettings("已取消未保存改动");
  });

  els.saveSettingsButton?.addEventListener("click", () => {
    saveSettings();
  });

  els.recentRunsFilter?.addEventListener("change", () => {
    state.monitorRunFilter = els.recentRunsFilter.value;
    renderMonitorStatus();
  });

  els.campaignPickerToggle?.addEventListener("click", () => {
    toggleResourceDropdown("campaigns");
  });

  els.adPickerToggle?.addEventListener("click", () => {
    toggleResourceDropdown("ads");
  });

  els.campaignSearchInput?.addEventListener("input", () => {
    state.resourceUi.campaigns.query = els.campaignSearchInput.value;
    state.resourceUi.campaigns.open = true;
    renderResourcePicker("campaigns");
  });

  els.adSearchInput?.addEventListener("input", () => {
    state.resourceUi.ads.query = els.adSearchInput.value;
    state.resourceUi.ads.open = true;
    renderResourcePicker("ads");
  });

  document.addEventListener("change", (event) => {
    if (event.target.closest("[data-env-key], [data-env-clear]")) {
      updateDirtyState();
      return;
    }
    const checkbox = event.target.closest(".resource-option input[type='checkbox']");
    if (!checkbox) {
      return;
    }
    const kind = checkbox.dataset.resourceKind;
    const id = checkbox.dataset.resourceId;
    if (checkbox.checked) {
      addSelectedResource(kind, id);
    } else {
      removeSelectedResource(kind, id);
    }
  });

  document.addEventListener("click", (event) => {
    const adDrilldownButton = event.target.closest("[data-ad-drilldown]");
    if (adDrilldownButton) {
      setAdDrilldown(adDrilldownButton.dataset.adDrilldown, state.activeView === "chart" ? "chart" : "list");
      return;
    }

    const actionButton = event.target.closest("[data-resource-action]");
    if (actionButton) {
      const kind = actionButton.dataset.resourceKind;
      const action = actionButton.dataset.resourceAction;
      const id = actionButton.dataset.resourceId;
      if (action.startsWith("page-")) {
        setSelectedResourcePage(kind, action);
        return;
      }
      if (action === "select-filtered") selectFilteredResources(kind);
      if (action === "clear") clearSelectedResources(kind);
      if (action === "reload") loadResourceCatalog("候选已重读");
      if (action === "manual-add") addManualResource(kind);
      if (action === "edit") {
        state.resourceUi[kind].editingId = id;
        renderResourcePickers();
      }
      if (action === "delete") removeSelectedResource(kind, id);
      if (action === "edit-save") saveResourceEdit(kind, id);
      if (action === "edit-cancel") {
        state.resourceUi[kind].editingId = "";
        renderResourcePickers();
      }
      return;
    }

    if (resourcePickerDomReady()
      && (state.resourceUi.campaigns.open || state.resourceUi.ads.open)
      && !event.target.closest("[data-resource-picker]")) {
      state.resourceUi.campaigns.open = false;
      state.resourceUi.ads.open = false;
      renderResourcePickers();
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target.closest("[data-env-key]")) {
      updateDirtyState();
    }
  });

  [
    els.campaignMonitorEnabled,
    els.campaignIntervalInput,
    els.campaignResultActionInput,
    els.campaignConcurrencyInput,
    els.campaignQpsInput,
    els.campaignTimeoutInput,
    els.campaignMaxAttemptsInput,
    els.campaignAutoActiveInput,
    els.monitorAccountsInput,
    els.adMonitorEnabled,
    els.adIntervalInput,
    els.adResultActionInput,
    els.adConcurrencyInput,
    els.adQpsInput,
    els.adTimeoutInput,
    els.adMaxAttemptsInput
  ].filter(Boolean).forEach((input) => {
    input.addEventListener("change", () => {
      state.samplingSettings = collectSamplingSettings();
      renderSamplingSettings();
      updateDirtyState();
    });
  });

  window.addEventListener("resize", () => {
    if (chart) {
      chart.resize();
    }
    if (listChart) {
      listChart.resize();
    }
  });
}

function initIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
    return;
  }
  document.querySelectorAll("i[data-lucide]").forEach((icon) => {
    const name = icon.dataset.lucide;
    const paths = iconPaths[name];
    if (!paths || icon.dataset.iconReady === name) {
      return;
    }

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    paths.forEach((definition) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", definition);
      svg.appendChild(path);
    });
    icon.replaceChildren(svg);
    icon.dataset.iconReady = name;
  });
}

function scheduleIconRefresh() {
  if (iconRefreshPending) {
    return;
  }
  iconRefreshPending = true;
  requestAnimationFrame(() => {
    iconRefreshPending = false;
    initIcons();
  });
}

window.fbRefreshIcons = scheduleIconRefresh;

async function initializeApplication() {
  if (state.appReady) {
    applyPermissionVisibility();
    renderView();
    return;
  }
  applyPermissionVisibility();
  rawRows = await loadCollectedRows() || buildRawRows();
  renderFilters();
  setDefaultWindow();
  els.normalizeToggle.checked = state.normalize;
  if (!state.eventsBound) {
    bindEvents();
    state.eventsBound = true;
  }
  renderDashboard();
  renderView();
  renderSettingsTabs();
  initIcons();
  state.appReady = true;
}

async function init() {
  const authenticated = await loadAuthSession();
  if (!authenticated) {
    redirectToPlatformLogin("/ads");
    return;
  }
  await initializeApplication();
}

init();
