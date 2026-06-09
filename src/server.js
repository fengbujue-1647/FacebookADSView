const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const zlib = require("node:zlib");
const { randomUUID } = require("node:crypto");
const {
  readLatestInsightData,
  readMonitorOverview,
  readActiveResourceCandidates,
  readAnalysisEntityOptions,
  readInsightRowsForAnalysis
} = require("./database");
const { DISPLAY_TIME_ZONE, enrichInsightRowsWithTimeZone } = require("./time");

const port = Number(process.env.PORT || 3100);
const host = process.env.HOST || "127.0.0.1";
const publicDir = path.resolve(__dirname, "..", "public");
const repoRoot = path.resolve(__dirname, "..");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const index = trimmed.indexOf("=");
    if (index <= 0) return;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
}

loadEnvFile(path.join(repoRoot, ".env"));
loadEnvFile(path.join(repoRoot, "cli", ".env"));

const databaseFile = path.join(repoRoot, "cli", "data", "fb-ads.sqlite");
const cliRawDir = path.join(repoRoot, "cli", "data", "raw");
const cliOutputDir = path.join(repoRoot, "cli", "data", "output");
const monitoredAccountsFile = path.join(repoRoot, "cli", "config", "monitored-accounts.json");
const samplingSettingsFile = path.join(repoRoot, "cli", "config", "sampling-plans.json");
const alertAiDataDir = path.join(repoRoot, "data", "alert-ai");
const alertTemplateFile = path.join(alertAiDataDir, "templates.json");
const alertMessageFile = path.join(alertAiDataDir, "messages.json");
const alertPushRecordFile = path.join(alertAiDataDir, "push-records.json");
const analysisReportFile = path.join(alertAiDataDir, "analysis-reports.json");
const displayTimeZone = DISPLAY_TIME_ZONE;
const activeResourceAccountId = process.env.ACTIVE_RESOURCE_ACCOUNT_ID || "8462513793771963";
const activeResourceRefreshIntervalMs = 120 * 60 * 1000;
const alertReportMaxDays = 90;
const alertReportPromptMaxLength = 1600;
const defaultFeishuWebhookUrl = process.env.FEISHU_ALERT_WEBHOOK_URL || "";
const deepSeekBaseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const deepSeekModel = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
let activeReportGeneration = false;
let resourceRefreshPromise = null;
let resourceRefreshStatus = {
  running: false,
  status: "idle",
  account_id: activeResourceAccountId,
  last_started_at: "",
  last_completed_at: "",
  reason: "",
  error: ""
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function writeResponse(res, statusCode, headers, body) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  if (res.shouldGzip && buffer.length > 1024 && !headers["Content-Encoding"]) {
    zlib.gzip(buffer, (error, compressed) => {
      if (error) {
        res.writeHead(statusCode, headers);
        res.end(buffer);
        return;
      }
      res.writeHead(statusCode, {
        ...headers,
        "Content-Encoding": "gzip",
        "Content-Length": compressed.length
      });
      res.end(compressed);
    });
    return;
  }

  res.writeHead(statusCode, {
    ...headers,
    "Content-Length": buffer.length
  });
  res.end(buffer);
}

function writeJson(res, statusCode, body) {
  writeResponse(res, statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  }, JSON.stringify(body));
}

function cacheHeaderFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") {
    return "no-store";
  }
  return "public, max-age=31536000, immutable";
}

function isCompressibleFile(filePath) {
  return [".html", ".css", ".js", ".json", ".svg"].includes(path.extname(filePath).toLowerCase());
}

function sendFile(res, filePath) {
  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      writeJson(res, 404, { ok: false, error: "not_found" });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": cacheHeaderFor(filePath)
    };

    if (res.shouldGzip && isCompressibleFile(filePath) && stats.size > 1024) {
      fs.readFile(filePath, (readError, body) => {
        if (readError) {
          writeJson(res, 500, { ok: false, error: "read_failed", message: readError.message });
          return;
        }
        writeResponse(res, 200, headers, body);
      });
      return;
    }

    res.writeHead(200, {
      ...headers,
      "Content-Length": stats.size
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 256) {
        reject(new Error("request_body_too_large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function resolvePublicPath(pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const resolved = path.resolve(publicDir, `.${cleanPath}`);
  const insidePublic = resolved === publicDir || resolved.startsWith(`${publicDir}${path.sep}`);
  return insidePublic ? resolved : null;
}

function normalizeAccounts(accounts = []) {
  const seen = new Set();
  const normalized = [];

  accounts.forEach((account) => {
    const rawId = typeof account === "string" ? account : account?.id;
    const id = String(rawId || "").trim();
    if (!/^\d{3,32}$/.test(id) || seen.has(id)) {
      return;
    }
    seen.add(id);
    normalized.push({
      id,
      name: String(account?.name || "").trim()
    });
  });

  return normalized;
}

function readMonitoredAccounts() {
  if (!fs.existsSync(monitoredAccountsFile)) {
    return [];
  }

  const text = fs.readFileSync(monitoredAccountsFile, "utf8").replace(/^\uFEFF/, "");
  const payload = JSON.parse(text);
  return normalizeAccounts(payload.accounts || []);
}

function writeMonitoredAccounts(accounts) {
  const normalized = normalizeAccounts(accounts);
  fs.mkdirSync(path.dirname(monitoredAccountsFile), { recursive: true });
  fs.writeFileSync(monitoredAccountsFile, `${JSON.stringify({
    accounts: normalized,
    updated_at: new Date().toISOString()
  }, null, 2)}\n`, "utf8");
  return normalized;
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeIds(ids = []) {
  const items = Array.isArray(ids)
    ? ids
    : String(ids || "").split(/[\s,;，；]+/);
  const seen = new Set();
  const normalized = [];

  items.forEach((item) => {
    const id = String(item || "").trim();
    if (!/^\d{3,32}$/.test(id) || seen.has(id)) {
      return;
    }
    seen.add(id);
    normalized.push(id);
  });

  return normalized;
}

function normalizeStoredDatePreset(value) {
  const text = String(value ?? "").trim();
  return text === "today" ? "" : text;
}

function normalizeSamplingSettings(input = {}) {
  const targetedInput = input.targeted || {};
  const activeInput = input.activeCampaigns || {};
  const campaignInput = input.campaignMonitor || {};
  const adInput = input.adMonitor || {};
  const targetedLevel = ["ads", "adsets"].includes(targetedInput.level) ? targetedInput.level : "ads";
  const campaignMonitor = {
    enabled: campaignInput.enabled !== false,
    intervalMinutes: clampInteger(campaignInput.intervalMinutes, 180, 60, 360),
    accountIds: normalizeIds(campaignInput.accountIds),
    autoActiveCampaigns: campaignInput.autoActiveCampaigns !== false,
    campaignIds: normalizeIds(campaignInput.campaignIds),
    datePreset: String(campaignInput.datePreset ?? "").trim(),
    resultAction: String(campaignInput.resultAction || "").trim(),
    hourly: campaignInput.hourly !== false
  };
  const adMonitor = {
    enabled: adInput.enabled !== false,
    intervalMinutes: clampInteger(adInput.intervalMinutes, 60, 30, 180),
    adIds: normalizeIds(adInput.adIds || (targetedLevel === "ads" ? targetedInput.ids : [])),
    datePreset: String(adInput.datePreset ?? "").trim(),
    resultAction: String(adInput.resultAction || "").trim(),
    hourly: adInput.hourly !== false,
    concurrency: clampInteger(adInput.concurrency, 20, 1, 20),
    qps: clampInteger(adInput.qps, 5, 1, 20),
    requestTimeoutMs: clampInteger(adInput.requestTimeoutMs, 7000, 1000, 60000),
    maxAttempts: clampInteger(adInput.maxAttempts, 8, 1, 20)
  };

  return {
    campaignMonitor,
    adMonitor,
    targeted: {
      enabled: targetedInput.enabled === true,
      level: targetedLevel,
      ids: normalizeIds(targetedInput.ids),
      intervalMinutes: clampInteger(targetedInput.intervalMinutes, 15, 15, 30),
      datePreset: normalizeStoredDatePreset(targetedInput.datePreset),
      resultAction: String(targetedInput.resultAction || "").trim(),
      hourly: targetedInput.hourly !== false
    },
    activeCampaigns: {
      enabled: activeInput.enabled !== false,
      intervalMinutes: clampInteger(activeInput.intervalMinutes, 60, 30, 180),
      datePreset: normalizeStoredDatePreset(activeInput.datePreset),
      resultAction: String(activeInput.resultAction || "").trim(),
      limit: Math.max(0, Number.parseInt(activeInput.limit, 10) || 0),
      hourly: activeInput.hourly !== false
    }
  };
}

function readSamplingSettings() {
  if (!fs.existsSync(samplingSettingsFile)) {
    return normalizeSamplingSettings();
  }

  const text = fs.readFileSync(samplingSettingsFile, "utf8").replace(/^\uFEFF/, "");
  return normalizeSamplingSettings(JSON.parse(text));
}

function writeSamplingSettings(settings) {
  const normalized = normalizeSamplingSettings(settings);
  fs.mkdirSync(path.dirname(samplingSettingsFile), { recursive: true });
  fs.writeFileSync(samplingSettingsFile, `${JSON.stringify({
    ...normalized,
    updated_at: new Date().toISOString()
  }, null, 2)}\n`, "utf8");
  return normalized;
}

const alertMetricCategories = [
  { id: "cost", label: "成本效率" },
  { id: "conversion", label: "转化表现" },
  { id: "traffic", label: "流量质量" },
  { id: "delivery", label: "投放规模" }
];

const alertMetrics = {
  spend: { label: "已花费金额", category: "cost", unit: "USD", min: 0, max: 1_000_000, precision: 2, direction: "lower" },
  cost_per_result: { label: "单次成效费用", category: "cost", unit: "USD", min: 0, max: 100_000, precision: 2, direction: "lower" },
  cpc_all: { label: "单次点击费用", category: "cost", unit: "USD", min: 0, max: 100_000, precision: 2, direction: "lower" },
  cpm: { label: "千次展示费用", category: "cost", unit: "USD", min: 0, max: 100_000, precision: 2, direction: "lower" },
  roas: { label: "广告花费回报", category: "conversion", unit: "倍", min: 0, max: 100, precision: 2, direction: "higher" },
  purchases: { label: "购买次数", category: "conversion", unit: "次", min: 0, max: 1_000_000, precision: 0, direction: "higher" },
  revenue: { label: "购买转化价值", category: "conversion", unit: "USD", min: 0, max: 10_000_000, precision: 2, direction: "higher" },
  results: { label: "成效", category: "conversion", unit: "次", min: 0, max: 10_000_000, precision: 0, direction: "higher" },
  add_to_cart: { label: "加入购物车次数", category: "conversion", unit: "次", min: 0, max: 10_000_000, precision: 0, direction: "higher" },
  ctr_all: { label: "点击率", category: "traffic", unit: "%", min: 0, max: 100, precision: 2, direction: "higher" },
  clicks_all: { label: "点击量", category: "traffic", unit: "次", min: 0, max: 100_000_000, precision: 0, direction: "higher" },
  reach: { label: "覆盖人数", category: "delivery", unit: "人", min: 0, max: 100_000_000, precision: 0, direction: "higher" },
  impressions: { label: "展示次数", category: "delivery", unit: "次", min: 0, max: 500_000_000, precision: 0, direction: "higher" },
  frequency: { label: "频次", category: "delivery", unit: "次/人", min: 0, max: 100, precision: 2, direction: "balanced" }
};

const alertComparisons = {
  gt: { label: "高于", valueCount: 1 },
  gte: { label: "高于或等于", valueCount: 1 },
  lt: { label: "低于", valueCount: 1 },
  lte: { label: "低于或等于", valueCount: 1 },
  between: { label: "介于区间", valueCount: 2 },
  change_gt: { label: "上涨超过", valueCount: 1, unit: "%" },
  change_lt: { label: "下跌超过", valueCount: 1, unit: "%" }
};

const alertWindowMinutes = {
  rolling_5: 5,
  rolling_15: 15,
  rolling_60: 60
};

const alertChannels = {
  dashboard: { label: "站内提示" },
  feishu: { label: "飞书群机器人" },
  email: { label: "邮件" },
  webhook: { label: "外部接口" }
};

const alertTargetLevels = [
  { id: "account", label: "账户" },
  { id: "campaign", label: "广告系列" },
  { id: "adset", label: "广告组" },
  { id: "ad", label: "广告" }
];

function alertMetadata() {
  return {
    metricCategories: alertMetricCategories,
    metrics: Object.entries(alertMetrics).map(([id, metric]) => ({ id, ...metric })),
    comparisons: Object.entries(alertComparisons).map(([id, comparison]) => ({ id, ...comparison })),
    windows: [
      { id: "rolling_5", label: "近 5 分钟", minutes: 5 },
      { id: "rolling_15", label: "近 15 分钟", minutes: 15 },
      { id: "rolling_60", label: "近 60 分钟", minutes: 60 },
      { id: "custom", label: "自定义分钟", minutes: 0 }
    ],
    channels: Object.entries(alertChannels).map(([id, channel]) => ({ id, ...channel })),
    targetLevels: alertTargetLevels,
    defaults: {
      feishuWebhookConfigured: Boolean(defaultFeishuWebhookUrl),
      deepSeekConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
      deepSeekModel
    },
    report: {
      maxDays: alertReportMaxDays,
      promptMaxLength: alertReportPromptMaxLength,
      levels: alertTargetLevels
    }
  };
}

function makeValidationError(message, fields = {}, statusCode = 422) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.fields = fields;
  return error;
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(text || "null") ?? fallback;
}

function writeJsonFileAtomic(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function readAlertTemplates() {
  const payload = readJsonFile(alertTemplateFile, { templates: [] });
  return Array.isArray(payload.templates) ? payload.templates : [];
}

function writeAlertTemplates(templates) {
  writeJsonFileAtomic(alertTemplateFile, {
    version: 1,
    updated_at: new Date().toISOString(),
    templates
  });
  return templates;
}

function readRecordList(filePath, key) {
  const payload = readJsonFile(filePath, { [key]: [] });
  return Array.isArray(payload[key]) ? payload[key] : [];
}

function writeRecordList(filePath, key, records, limit = 500) {
  const list = records
    .toSorted((a, b) => String(b.created_at || b.sent_at || b.generated_at || "").localeCompare(String(a.created_at || a.sent_at || a.generated_at || "")))
    .slice(0, limit);
  writeJsonFileAtomic(filePath, {
    version: 1,
    updated_at: new Date().toISOString(),
    [key]: list
  });
  return list;
}

function readAlertMessages() {
  return readRecordList(alertMessageFile, "messages");
}

function writeAlertMessages(messages) {
  return writeRecordList(alertMessageFile, "messages", messages, 800);
}

function readAlertPushRecords() {
  return readRecordList(alertPushRecordFile, "records");
}

function writeAlertPushRecords(records) {
  return writeRecordList(alertPushRecordFile, "records", records, 1200);
}

function readAnalysisReports() {
  return readRecordList(analysisReportFile, "reports");
}

function writeAnalysisReports(reports) {
  return writeRecordList(analysisReportFile, "reports", reports, 120);
}

function normalizeStringList(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[\s,;，；]+/);
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function normalizeChannels(value) {
  const selected = normalizeStringList(value).filter((channel) => Object.hasOwn(alertChannels, channel));
  return selected.length ? selected : ["dashboard"];
}

function validateEmail(email) {
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email);
}

function validateHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function clampMetricValue(value, metric, fieldName, fields) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    fields[fieldName] = "阈值必须是数字";
    return 0;
  }
  if (parsed < metric.min || parsed > metric.max) {
    fields[fieldName] = `阈值范围应为 ${metric.min} 到 ${metric.max} ${metric.unit}`;
  }
  return Number(parsed.toFixed(metric.precision));
}

function normalizeAlertCondition(input = {}, fields = {}, index = 0) {
  const prefix = `conditions.${index}`;
  const metricId = Object.hasOwn(alertMetrics, input.metric) ? input.metric : "";
  if (!metricId) {
    fields.conditions = "每个条件都必须选择监控指标";
  }
  const metric = alertMetrics[metricId] || alertMetrics.spend;
  const comparison = Object.hasOwn(alertComparisons, input.comparison) ? input.comparison : "";
  if (!comparison) {
    fields.conditions = "每个条件都必须选择比较关系";
  }
  const comparisonMeta = alertComparisons[comparison] || alertComparisons.gt;
  const comparisonMetric = comparison.startsWith("change_")
    ? { ...metric, min: 0, max: 500, unit: "%", precision: 2 }
    : metric;
  const threshold = clampMetricValue(input.threshold, comparisonMetric, `${prefix}.threshold`, fields);
  const thresholdMax = comparisonMeta.valueCount === 2
    ? clampMetricValue(input.thresholdMax, comparisonMetric, `${prefix}.thresholdMax`, fields)
    : null;
  if (comparisonMeta.valueCount === 2 && Number.isFinite(threshold) && Number.isFinite(thresholdMax) && threshold > thresholdMax) {
    fields.conditions = "区间上限必须大于或等于下限";
  }

  return {
    id: String(input.id || randomUUID()),
    metric: metricId,
    metricCategory: metric.category,
    comparison,
    threshold,
    thresholdMax,
    unit: comparisonMetric.unit
  };
}

function templateInputConditions(input = {}) {
  if (Array.isArray(input.conditions) && input.conditions.length) {
    return input.conditions;
  }
  return [{
    metric: input.metric,
    comparison: input.comparison,
    threshold: input.threshold,
    thresholdMax: input.thresholdMax
  }];
}

function normalizeAlertTemplate(input = {}, existing = null) {
  const fields = {};
  const now = new Date().toISOString();
  const name = String(input.name || "").trim();
  if (!name) {
    fields.name = "模板名称不能为空";
  } else if (name.length > 60) {
    fields.name = "模板名称不能超过 60 个字符";
  } else if (!/^[\u4e00-\u9fa5A-Za-z0-9 _（）()\-[\].#]+$/.test(name)) {
    fields.name = "模板名称只能包含中文、英文、数字、空格、括号、横线、点和 #";
  }

  const targetLevel = alertTargetLevels.some((item) => item.id === input.targetLevel) ? input.targetLevel : "campaign";
  const targetIds = normalizeStringList(input.targetIds).filter((id) => /^[A-Za-z0-9_.:-]{1,80}$/.test(id));
  if (Array.isArray(input.targetIds) && input.targetIds.length !== targetIds.length) {
    fields.targetIds = "监控目标 ID 包含非法字符";
  }

  const logic = input.logic === "or" ? "or" : "and";
  const rawConditions = templateInputConditions(input).slice(0, 8);
  if (rawConditions.length === 0) {
    fields.conditions = "至少需要一个监控条件";
  }
  const conditions = rawConditions.map((condition, index) => normalizeAlertCondition(condition, fields, index));

  const windowType = Object.hasOwn(alertWindowMinutes, input.windowType) || input.windowType === "custom"
    ? input.windowType
    : "";
  if (!windowType) {
    fields.windowType = "请选择时间窗口";
  }
  let windowMinutes = alertWindowMinutes[windowType] || 0;
  if (windowType === "custom") {
    windowMinutes = Number.parseInt(input.windowMinutes, 10);
    if (!Number.isInteger(windowMinutes) || windowMinutes < 5 || windowMinutes > 1440) {
      fields.windowMinutes = "自定义时间窗口必须在 5 到 1440 分钟之间";
      windowMinutes = 5;
    }
  }

  const channels = normalizeChannels(input.channels);
  const recipients = normalizeStringList(input.recipients).map((email) => email.toLowerCase());
  const invalidEmail = recipients.find((email) => !validateEmail(email));
  if (channels.includes("email") && recipients.length === 0) {
    fields.recipients = "邮件通知至少需要一个接收人";
  } else if (invalidEmail) {
    fields.recipients = `邮箱格式不正确：${invalidEmail}`;
  }

  const webhookUrl = String(input.webhookUrl || "").trim();
  if (channels.includes("webhook")) {
    if (!webhookUrl) {
      fields.webhookUrl = "外部接口推送需要填写 URL";
    } else if (webhookUrl.length > 2048 || !validateHttpUrl(webhookUrl)) {
      fields.webhookUrl = "URL 必须是有效的 http 或 https 地址";
    }
  }

  const feishuWebhookUrl = String(input.feishuWebhookUrl || defaultFeishuWebhookUrl || "").trim();
  if (channels.includes("feishu") && (!feishuWebhookUrl || !validateHttpUrl(feishuWebhookUrl))) {
    fields.feishuWebhookUrl = "飞书推送需要有效的机器人 Webhook";
  }

  const severity = ["low", "medium", "high"].includes(input.severity) ? input.severity : "medium";
  if (Object.keys(fields).length) {
    throw makeValidationError("预警模板校验失败", fields);
  }

  const primary = conditions[0] || {};
  return {
    id: existing?.id || randomUUID(),
    name,
    targetLevel,
    targetIds,
    logic,
    conditions,
    metric: primary.metric,
    metricCategory: primary.metricCategory,
    comparison: primary.comparison,
    threshold: primary.threshold,
    thresholdMax: primary.thresholdMax,
    unit: primary.unit,
    windowType,
    windowMinutes,
    severity,
    channels,
    recipients,
    feishuWebhookUrl: channels.includes("feishu") ? feishuWebhookUrl : "",
    webhookUrl: channels.includes("webhook") ? webhookUrl : "",
    enabled: input.enabled !== undefined ? input.enabled === true : existing?.enabled !== false,
    created_at: existing?.created_at || now,
    updated_at: now
  };
}

function formatThreshold(condition) {
  const metric = alertMetrics[condition.metric] || {};
  const comparison = alertComparisons[condition.comparison] || {};
  const unit = condition.unit || comparison.unit || metric.unit || "";
  if (comparison.valueCount === 2) {
    return `${condition.threshold} 到 ${condition.thresholdMax} ${unit}`;
  }
  return `${condition.threshold} ${unit}`;
}

function templateRuleDescription(template) {
  const conditions = Array.isArray(template.conditions) && template.conditions.length
    ? template.conditions
    : templateInputConditions(template);
  const connector = template.logic === "or" ? " 或 " : " 且 ";
  const ruleText = conditions.map((condition) => {
    const metric = alertMetrics[condition.metric] || { label: condition.metric };
    const comparison = alertComparisons[condition.comparison] || { label: condition.comparison };
    return `${metric.label}${comparison.label} ${formatThreshold(condition)}`;
  }).join(connector);
  const target = alertTargetLevels.find((item) => item.id === template.targetLevel)?.label || "广告系列";
  const targetText = template.targetIds?.length ? `${target} ${template.targetIds.length} 个对象` : `全部${target}`;
  return `${targetText}，${ruleText}，窗口 ${template.windowMinutes} 分钟`;
}

function templateChannelDescription(template) {
  return template.channels.map((channel) => alertChannels[channel]?.label || channel).join("、");
}

function templateListItem(template) {
  const conditions = Array.isArray(template.conditions) && template.conditions.length
    ? template.conditions
    : templateInputConditions(template);
  const metricLabels = conditions.map((condition) => alertMetrics[condition.metric]?.label || condition.metric).filter(Boolean);
  const metric = alertMetrics[conditions[0]?.metric] || { label: template.metric, category: template.metricCategory };
  return {
    id: template.id,
    name: template.name,
    metric: template.metric,
    metricLabel: metricLabels.join("、"),
    metricCategory: metric.category || template.metricCategory,
    metricCategoryLabel: alertMetricCategories.find((item) => item.id === (metric.category || template.metricCategory))?.label || "",
    ruleDescription: templateRuleDescription(template),
    targetLevel: template.targetLevel || "campaign",
    targetIds: template.targetIds || [],
    logic: template.logic || "and",
    channels: template.channels,
    channelDescription: templateChannelDescription(template),
    enabled: template.enabled !== false,
    updated_at: template.updated_at,
    severity: template.severity
  };
}

function filterAlertTemplates(templates, searchParams) {
  const query = String(searchParams.get("search") || "").trim().toLowerCase();
  const metricCategory = String(searchParams.get("metric_category") || "all").trim();
  const status = String(searchParams.get("status") || "all").trim();
  return templates.filter((template) => {
    const listItem = templateListItem(template);
    if (metricCategory !== "all" && listItem.metricCategory !== metricCategory) {
      return false;
    }
    if (status === "enabled" && !listItem.enabled) {
      return false;
    }
    if (status === "disabled" && listItem.enabled) {
      return false;
    }
    if (!query) {
      return true;
    }
    return [
      listItem.name,
      listItem.metricLabel,
      listItem.metricCategoryLabel,
      listItem.ruleDescription,
      listItem.channelDescription
    ].join(" ").toLowerCase().includes(query);
  });
}

function paginate(items, searchParams) {
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(searchParams.get("page_size"), 10) || 10));
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, Number.parseInt(searchParams.get("page"), 10) || 1));
  const start = (page - 1) * pageSize;
  return {
    page,
    pageSize,
    pageCount,
    total: items.length,
    items: items.slice(start, start + pageSize)
  };
}

function findTemplateOrThrow(templates, id) {
  const template = templates.find((item) => item.id === id);
  if (!template) {
    throw makeValidationError("预警模板不存在", {}, 404);
  }
  return template;
}

function uniqueCopiedName(baseName, templates) {
  const names = new Set(templates.map((template) => template.name));
  let index = 1;
  let candidate = `${baseName} 副本`;
  while (names.has(candidate)) {
    index += 1;
    candidate = `${baseName} 副本 ${index}`;
  }
  return candidate;
}

function readResourceCandidates(accountId = activeResourceAccountId) {
  return readActiveResourceCandidates({
    databaseFile,
    accountId,
    refreshIntervalMs: activeResourceRefreshIntervalMs
  });
}

async function refreshActiveResources({ accountId = activeResourceAccountId, reason = "manual", force = false } = {}) {
  if (resourceRefreshPromise) {
    return resourceRefreshPromise;
  }

  const before = readResourceCandidates(accountId);
  if (!force && !before.stale) {
    return {
      ok: true,
      skipped: true,
      reason: "fresh",
      candidates: before,
      refresh: resourceRefreshStatus
    };
  }

  resourceRefreshStatus = {
    running: true,
    status: "running",
    account_id: accountId,
    last_started_at: new Date().toISOString(),
    last_completed_at: "",
    reason,
    error: ""
  };

  resourceRefreshPromise = (async () => {
    try {
      process.env.DOTENV_CONFIG_PATH = process.env.DOTENV_CONFIG_PATH || path.join(repoRoot, "cli", ".env");
      const syncServiceUrl = pathToFileURL(path.join(repoRoot, "cli", "src", "syncService.js")).href;
      const { SyncService } = await import(syncServiceUrl);
      const service = new SyncService({ concurrency: 1 });
      const result = await service.pullResourceList({
        accounts: [accountId],
        getType: "all",
        activeOnly: true
      });
      const candidates = readResourceCandidates(accountId);
      resourceRefreshStatus = {
        ...resourceRefreshStatus,
        running: false,
        status: "success",
        last_completed_at: new Date().toISOString(),
        error: "",
        counts: {
          campaigns: result.resources?.campaigns?.length || 0,
          adsets: result.resources?.adsets?.length || 0,
          ads: result.resources?.ads?.length || 0
        }
      };
      return {
        ok: true,
        skipped: false,
        candidates,
        refresh: resourceRefreshStatus
      };
    } catch (error) {
      const candidates = readResourceCandidates(accountId);
      resourceRefreshStatus = {
        ...resourceRefreshStatus,
        running: false,
        status: "failed",
        last_completed_at: new Date().toISOString(),
        error: error.message
      };
      return {
        ok: false,
        skipped: false,
        error: "refresh_active_resources_failed",
        message: error.message,
        candidates,
        refresh: resourceRefreshStatus
      };
    } finally {
      resourceRefreshPromise = null;
    }
  })();

  return resourceRefreshPromise;
}

function scheduleActiveResourceRefresh() {
  const timer = setInterval(() => {
    refreshActiveResources({
      accountId: activeResourceAccountId,
      reason: "interval",
      force: false
    }).catch((error) => {
      console.warn(`ACTIVE resource refresh failed: ${error.message}`);
    });
  }, activeResourceRefreshIntervalMs);
  timer.unref?.();
}

function displayDateString(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US-u-nu-latn", {
    timeZone: displayTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseDateOnlyForReport(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (!Number.isFinite(date.getTime())) return null;
  return date;
}

function daysBetweenInclusive(sinceDate, untilDate) {
  return Math.floor((untilDate.getTime() - sinceDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
}

function normalizeReportRequest(input = {}) {
  const fields = {};
  const since = String(input.since || "").trim();
  const until = String(input.until || "").trim();
  const sinceDate = parseDateOnlyForReport(since);
  const untilDate = parseDateOnlyForReport(until);
  const today = displayDateString();
  if (!sinceDate) fields.since = "请选择有效的开始日期";
  if (!untilDate) fields.until = "请选择有效的结束日期";
  if (sinceDate && untilDate) {
    if (sinceDate > untilDate) {
      fields.until = "结束日期不能早于开始日期";
    }
    if (until > today) {
      fields.until = "结束日期不能选择未来";
    }
    const days = daysBetweenInclusive(sinceDate, untilDate);
    if (days > alertReportMaxDays) {
      fields.until = `最长查询区间为 ${alertReportMaxDays} 天`;
    }
  }

  const level = ["account", "campaign", "adset", "ad"].includes(input.level) ? input.level : "";
  if (!level) {
    fields.level = "请选择分析层级";
  }
  const entityIds = [...new Set((Array.isArray(input.entityIds) ? input.entityIds : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean))];
  if (entityIds.length === 0) {
    fields.entityIds = "请选择至少一个分析对象";
  }
  if (entityIds.length > 200) {
    fields.entityIds = "单次报告最多选择 200 个对象";
  }
  if (entityIds.some((id) => !/^[A-Za-z0-9_.:-]{1,80}$/.test(id))) {
    fields.entityIds = "分析对象 ID 包含非法字符";
  }

  const prompt = String(input.prompt || "").trim();
  if (prompt.length < 8) {
    fields.prompt = "请输入至少 8 个字符的分析目标";
  }
  if (prompt.length > alertReportPromptMaxLength) {
    fields.prompt = `分析目标不能超过 ${alertReportPromptMaxLength} 个字符`;
  }
  if (Object.keys(fields).length) {
    throw makeValidationError("报告参数校验失败", fields);
  }

  return {
    since,
    until,
    level,
    entityIds,
    prompt
  };
}

function rowNumber(row, key) {
  const value = Number(row[key] || 0);
  return Number.isFinite(value) ? value : 0;
}

function rowSpend(row) {
  return rowNumber(row, "spend");
}

function aggregateInsightRows(rows = []) {
  const total = {
    spend: 0,
    impressions: 0,
    clicks_all: 0,
    reach: 0,
    add_to_cart: 0,
    initiate_checkout: 0,
    purchases: 0,
    revenue: 0,
    results: 0,
    frequencyWeightedReach: 0,
    row_count: rows.length
  };

  rows.forEach((row) => {
    const spend = rowSpend(row);
    const clicks = rowNumber(row, "clicks");
    const reach = rowNumber(row, "reach");
    const results = rowNumber(row, "result_count") || rowNumber(row, "purchase_count");
    const purchases = rowNumber(row, "purchase_count");
    const revenue = rowNumber(row, "purchase_value") || spend * rowNumber(row, "roas");
    total.spend += spend;
    total.impressions += rowNumber(row, "impressions");
    total.clicks_all += clicks;
    total.reach += reach;
    total.add_to_cart += rowNumber(row, "add_to_cart_count");
    total.initiate_checkout += rowNumber(row, "initiate_checkout_count");
    total.purchases += purchases;
    total.revenue += revenue;
    total.results += results;
    total.frequencyWeightedReach += rowNumber(row, "frequency") * reach;
  });

  total.roas = total.spend > 0 ? total.revenue / total.spend : 0;
  total.ctr_all = total.impressions > 0 ? (total.clicks_all / total.impressions) * 100 : 0;
  total.cpc_all = total.clicks_all > 0 ? total.spend / total.clicks_all : 0;
  total.cost_per_result = total.results > 0 ? total.spend / total.results : 0;
  total.cpm = total.impressions > 0 ? (total.spend / total.impressions) * 1000 : 0;
  total.frequency = total.reach > 0 ? total.frequencyWeightedReach / total.reach : 0;
  return total;
}

function reportEntityId(row, level) {
  if (level === "account") return row.account_id || "unknown";
  if (level === "campaign") return row.campaign_id || "unknown";
  if (level === "adset") return row.adset_id || "unknown";
  return row.ad_id || "unknown";
}

function reportEntityName(row, level) {
  if (level === "account") return row.account_name || row.account_id || "未命名账户";
  if (level === "campaign") return row.campaign_name || row.campaign_id || "未命名广告系列";
  if (level === "adset") return row.adset_name || row.adset_id || "未命名广告组";
  return row.ad_name || row.ad_id || "未命名广告";
}

function splitRowsByPeriod(rows, since, until) {
  const sinceDate = parseDateOnlyForReport(since);
  const untilDate = parseDateOnlyForReport(until);
  const days = Math.max(1, daysBetweenInclusive(sinceDate, untilDate));
  const midpoint = new Date(sinceDate.getTime() + Math.floor(days / 2) * 24 * 60 * 60 * 1000);
  const midpointText = midpoint.toISOString().slice(0, 10);
  return {
    previousRows: rows.filter((row) => String(row.date_start || "") < midpointText),
    currentRows: rows.filter((row) => String(row.date_start || "") >= midpointText),
    midpoint: midpointText
  };
}

function pctChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return 0;
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function levelByVolatility(value) {
  const absolute = Math.abs(value);
  if (absolute >= 45) return "high";
  if (absolute >= 20) return "medium";
  return "low";
}

function formatNumber(value, precision = 0) {
  return Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: precision,
    minimumFractionDigits: precision
  });
}

function formatMetricValue(metric, value) {
  if (metric === "spend" || metric === "revenue" || metric === "cost_per_result" || metric === "cpc_all" || metric === "cpm") {
    return `$${formatNumber(value, 2)}`;
  }
  if (metric === "roas") return `${formatNumber(value, 2)}x`;
  if (metric === "ctr_all") return `${formatNumber(value, 2)}%`;
  if (metric === "frequency") return formatNumber(value, 2);
  return formatNumber(value, 0);
}

function buildComparisonBoard(current, previous) {
  const cards = [
    { id: "spend", label: "花费", direction: "lower" },
    { id: "roas", label: "ROAS", direction: "higher" },
    { id: "ctr_all", label: "CTR", direction: "higher" },
    { id: "purchases", label: "购买", direction: "higher" },
    { id: "cost_per_result", label: "单次成效费用", direction: "lower" },
    { id: "impressions", label: "展示", direction: "balanced" }
  ].map((item) => {
    const change = pctChange(current[item.id], previous[item.id]);
    const level = levelByVolatility(change);
    return {
      ...item,
      value: current[item.id] || 0,
      previous: previous[item.id] || 0,
      formattedValue: formatMetricValue(item.id, current[item.id]),
      changePct: Number(change.toFixed(2)),
      anomalyLevel: level,
      volatility: Math.min(100, Math.abs(Number(change.toFixed(2))))
    };
  });
  return cards;
}

function topEntityRows(rows, level) {
  const groups = new Map();
  rows.forEach((row) => {
    const id = reportEntityId(row, level);
    const current = groups.get(id) || {
      id,
      name: reportEntityName(row, level),
      rows: []
    };
    current.rows.push(row);
    groups.set(id, current);
  });

  return [...groups.values()].map((group) => ({
    id: group.id,
    name: group.name,
    metrics: aggregateInsightRows(group.rows)
  })).sort((a, b) => b.metrics.spend - a.metrics.spend).slice(0, 8);
}

function buildActionItems({ board, current, topEntities, rowCount }) {
  if (rowCount === 0) {
    return [{
      id: randomUUID(),
      priority: "high",
      title: "确认监控范围是否已有采集数据",
      detail: "当前筛选条件没有命中可分析的 Insights 明细，先检查时间范围、对象选择和采集批次状态。",
      quickAction: "打开设置"
    }];
  }

  const actions = [];
  const spendCard = board.find((item) => item.id === "spend");
  const roasCard = board.find((item) => item.id === "roas");
  const ctrCard = board.find((item) => item.id === "ctr_all");
  const cpaCard = board.find((item) => item.id === "cost_per_result");
  const topEntity = topEntities[0];

  if (spendCard?.changePct > 20 && current.roas < 1.5) {
    actions.push({
      id: randomUUID(),
      priority: "high",
      title: "压缩高花费低回报对象预算",
      detail: topEntity ? `${topEntity.name} 当前花费最高，优先核查预算、受众和出价，避免继续放大亏损流量。` : "当前花费上涨但回报不足，优先收紧预算并检查主要消耗对象。",
      quickAction: "复制建议"
    });
  }

  if (roasCard?.changePct < -20 || cpaCard?.changePct > 25) {
    actions.push({
      id: randomUUID(),
      priority: "high",
      title: "复核转化链路与成效口径",
      detail: "ROAS 下滑或单次成效费用上升时，优先检查落地页、Pixel 事件、成效口径和折扣活动是否发生变化。",
      quickAction: "生成排查清单"
    });
  }

  if (ctrCard?.changePct < -20) {
    actions.push({
      id: randomUUID(),
      priority: "medium",
      title: "更新低点击率素材组合",
      detail: "CTR 明显下滑通常意味着素材疲劳或受众匹配下降，建议补充新素材并缩小低响应版位。",
      quickAction: "复制素材任务"
    });
  }

  if (actions.length === 0) {
    actions.push({
      id: randomUUID(),
      priority: "medium",
      title: "保持当前监控并标记观察窗口",
      detail: "当前异常等级可控，建议保留监控模板并在下一轮数据更新后复查波动是否扩大。",
      quickAction: "复制观察项"
    });
  }

  return actions.slice(0, 5);
}

function insightRowTimestamp(row) {
  return timestampFromDashboardSource(
    row.hour_start_beijing
      || row.date_start_beijing
      || row.hour_start
      || (row.date_start ? `${row.date_start}T00:00:00` : "")
  );
}

function groupRowsByLevel(rows, level) {
  const groups = new Map();
  rows.forEach((row) => {
    const id = reportEntityId(row, level);
    if (!id || id === "unknown") return;
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        name: reportEntityName(row, level),
        rows: []
      });
    }
    groups.get(id).rows.push(row);
  });
  return groups;
}

function metricForCondition(metrics, previousMetrics, condition) {
  const currentValue = Number(metrics[condition.metric] || 0);
  if (condition.comparison.startsWith("change_")) {
    return pctChange(currentValue, Number(previousMetrics?.[condition.metric] || 0));
  }
  return currentValue;
}

function conditionMatches(value, condition) {
  const threshold = Number(condition.threshold);
  if (condition.comparison === "gt") return value > threshold;
  if (condition.comparison === "gte") return value >= threshold;
  if (condition.comparison === "lt") return value < threshold;
  if (condition.comparison === "lte") return value <= threshold;
  if (condition.comparison === "between") return value >= threshold && value <= Number(condition.thresholdMax);
  if (condition.comparison === "change_gt") return value > threshold;
  if (condition.comparison === "change_lt") return value < -threshold;
  return false;
}

function describeConditionResult(condition, value) {
  const metric = alertMetrics[condition.metric] || { label: condition.metric };
  const comparison = alertComparisons[condition.comparison] || { label: condition.comparison };
  const formatted = condition.comparison.startsWith("change_")
    ? `${formatNumber(value, 2)}%`
    : formatMetricValue(condition.metric, value);
  return `${metric.label}${comparison.label} ${formatThreshold(condition)}，当前 ${formatted}`;
}

function buildAlertMessagesForTemplate(template) {
  const allRows = readInsightRowsForAnalysis({
    databaseFile,
    level: template.targetLevel || "campaign",
    entityIds: template.targetIds || [],
    limit: 250_000
  }).map((row) => ({
    ...row,
    __timestamp: insightRowTimestamp(row)
  })).filter((row) => Number.isFinite(row.__timestamp));

  if (!allRows.length) {
    return [];
  }

  const latestTimestamp = Math.max(...allRows.map((row) => row.__timestamp));
  const windowMs = Math.max(5, Number(template.windowMinutes || 60)) * 60_000;
  const currentRows = allRows.filter((row) => row.__timestamp >= latestTimestamp - windowMs);
  const previousRows = allRows.filter((row) => row.__timestamp < latestTimestamp - windowMs && row.__timestamp >= latestTimestamp - windowMs * 2);
  const currentGroups = groupRowsByLevel(currentRows, template.targetLevel || "campaign");
  const previousGroups = groupRowsByLevel(previousRows, template.targetLevel || "campaign");
  const targetIds = new Set(template.targetIds || []);
  const conditions = Array.isArray(template.conditions) && template.conditions.length
    ? template.conditions
    : templateInputConditions(template);

  return [...currentGroups.values()].flatMap((group) => {
    if (targetIds.size && !targetIds.has(group.id)) return [];
    const current = aggregateInsightRows(group.rows);
    const previous = aggregateInsightRows(previousGroups.get(group.id)?.rows || []);
    const conditionResults = conditions.map((condition) => {
      const value = metricForCondition(current, previous, condition);
      return {
        condition,
        value,
        matched: conditionMatches(value, condition),
        description: describeConditionResult(condition, value)
      };
    });
    const matched = template.logic === "or"
      ? conditionResults.some((item) => item.matched)
      : conditionResults.every((item) => item.matched);
    if (!matched) return [];
    const levelLabel = alertTargetLevels.find((item) => item.id === template.targetLevel)?.label || "对象";
    return [{
      id: randomUUID(),
      template_id: template.id,
      template_name: template.name,
      severity: template.severity,
      target_level: template.targetLevel || "campaign",
      target_level_label: levelLabel,
      target_id: group.id,
      target_name: group.name,
      title: `${levelLabel} ${group.name} 触发预警`,
      body: conditionResults.map((item) => item.description).join(template.logic === "or" ? "；或 " : "；且 "),
      metrics: current,
      conditions: conditionResults.map((item) => ({
        metric: item.condition.metric,
        comparison: item.condition.comparison,
        threshold: item.condition.threshold,
        thresholdMax: item.condition.thresholdMax,
        value: item.value,
        matched: item.matched
      })),
      window_minutes: template.windowMinutes,
      created_at: new Date().toISOString(),
      status: "active"
    }];
  });
}

function alertTextForPush(message) {
  return [
    `【FB 广告预警】${message.title}`,
    `等级：${message.severity}`,
    `对象：${message.target_name} (${message.target_id})`,
    `规则：${message.body}`,
    `时间：${new Date(message.created_at).toLocaleString("zh-CN", { timeZone: displayTimeZone, hourCycle: "h23" })}`
  ].join("\n");
}

async function postJsonWithTimeout(url, payload, timeoutMs = 10_000, maxBodyLength = 1000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: maxBodyLength ? text.slice(0, maxBodyLength) : text
    };
  } finally {
    clearTimeout(timer);
  }
}

async function pushAlertMessage(template, message, channel) {
  const record = {
    id: randomUUID(),
    message_id: message.id,
    template_id: template.id,
    channel,
    target_id: message.target_id,
    created_at: new Date().toISOString(),
    status: "skipped",
    status_code: 0,
    error: ""
  };

  try {
    if (channel === "dashboard") {
      return { ...record, status: "recorded" };
    }
    if (channel === "email") {
      return { ...record, status: "skipped", error: "当前版本未配置邮件发送服务" };
    }
    if (channel === "feishu") {
      const url = template.feishuWebhookUrl || defaultFeishuWebhookUrl;
      const result = await postJsonWithTimeout(url, {
        msg_type: "text",
        content: { text: alertTextForPush(message) }
      });
      return {
        ...record,
        status: result.ok ? "sent" : "failed",
        status_code: result.status,
        response: result.body
      };
    }
    if (channel === "webhook") {
      const result = await postJsonWithTimeout(template.webhookUrl, {
        type: "fb_ads_alert",
        message
      });
      return {
        ...record,
        status: result.ok ? "sent" : "failed",
        status_code: result.status,
        response: result.body
      };
    }
    return record;
  } catch (error) {
    return {
      ...record,
      status: "failed",
      error: error.message || "推送失败"
    };
  }
}

async function evaluateAlertTemplates({ templateIds = [], push = true } = {}) {
  const selected = new Set(templateIds.map((id) => String(id)));
  const templates = readAlertTemplates()
    .filter((template) => template.enabled !== false)
    .filter((template) => !selected.size || selected.has(template.id));
  const generatedMessages = templates.flatMap(buildAlertMessagesForTemplate);
  const pushRecords = [];

  if (push) {
    for (const template of templates) {
      const messages = generatedMessages.filter((message) => message.template_id === template.id);
      for (const message of messages) {
        for (const channel of template.channels || ["dashboard"]) {
          pushRecords.push(await pushAlertMessage(template, message, channel));
        }
      }
    }
  }

  if (generatedMessages.length) {
    writeAlertMessages([...generatedMessages, ...readAlertMessages()]);
  }
  if (pushRecords.length) {
    writeAlertPushRecords([...pushRecords, ...readAlertPushRecords()]);
  }

  return {
    templatesChecked: templates.length,
    messagesCreated: generatedMessages.length,
    pushRecordsCreated: pushRecords.length,
    messages: generatedMessages,
    pushRecords
  };
}

function buildMarkdownReport({ request, rows, current, previous, board, topEntities, actions }) {
  const levelLabel = alertMetadata().report.levels.find((item) => item.id === request.level)?.label || request.level;
  const highest = board.toSorted((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))[0];
  const abnormalCards = board.filter((item) => item.anomalyLevel !== "low");
  const topLines = topEntities.slice(0, 5).map((entity, index) => (
    `${index + 1}. ${entity.name}: 花费 ${formatMetricValue("spend", entity.metrics.spend)}，ROAS ${formatMetricValue("roas", entity.metrics.roas)}，购买 ${formatMetricValue("purchases", entity.metrics.purchases)}`
  ));
  const actionLines = actions.map((action, index) => `${index + 1}. ${action.title}: ${action.detail}`);

  if (rows.length === 0) {
    return [
      "# Agent 智能分析报告",
      "",
      `分析范围：${request.since} 至 ${request.until}，层级：${levelLabel}。`,
      "",
      "## 数据状态",
      "当前筛选条件没有命中可分析的广告明细。系统已保留本次筛选和输入内容，建议先确认采集任务是否覆盖该日期和对象。",
      "",
      "## 建议行动",
      actionLines.join("\n")
    ].join("\n");
  }

  return [
    "# Agent 智能分析报告",
    "",
    `分析范围：${request.since} 至 ${request.until}，层级：${levelLabel}，对象数：${request.entityIds.length}，命中明细：${rows.length} 行。`,
    "",
    "## 用户分析目标",
    request.prompt,
    "",
    "## 关键结论",
    `- 当前花费 ${formatMetricValue("spend", current.spend)}，ROAS ${formatMetricValue("roas", current.roas)}，CTR ${formatMetricValue("ctr_all", current.ctr_all)}，购买 ${formatMetricValue("purchases", current.purchases)}。`,
    `- 最大波动指标是 ${highest?.label || "无"}，相对前半段变化 ${formatNumber(highest?.changePct || 0, 2)}%，异常等级 ${highest?.anomalyLevel || "low"}。`,
    `- ${abnormalCards.length ? `需要关注 ${abnormalCards.map((item) => item.label).join("、")}。` : "当前核心指标没有出现中高等级异常。"}`,
    "",
    "## 数据对比",
    board.map((item) => `- ${item.label}: 当前 ${item.formattedValue}，前段 ${formatMetricValue(item.id, item.previous)}，变化 ${formatNumber(item.changePct, 2)}%。`).join("\n"),
    "",
    "## 重点对象",
    topLines.length ? topLines.join("\n") : "暂无可排序对象。",
    "",
    "## 诊断",
    "本次诊断按所选窗口拆分前后两个阶段，优先比较花费、ROAS、CTR、购买和单次成效费用。异常等级由波动幅度与效率方向共同决定；当高花费伴随低 ROAS 或单次成效费用上升时，系统会把预算控制和转化链路排查提前。",
    "",
    "## 行动项",
    actionLines.join("\n")
  ].join("\n");
}

function buildAnalysisReport(request) {
  const rows = readInsightRowsForAnalysis({
    databaseFile,
    since: request.since,
    until: request.until,
    level: request.level,
    entityIds: request.entityIds
  });
  const { previousRows, currentRows } = splitRowsByPeriod(rows, request.since, request.until);
  const current = aggregateInsightRows(currentRows.length ? currentRows : rows);
  const previous = aggregateInsightRows(previousRows);
  const board = buildComparisonBoard(current, previous);
  const topEntities = topEntityRows(rows, request.level);
  const actions = buildActionItems({
    board,
    current,
    topEntities,
    rowCount: rows.length
  });
  const markdown = buildMarkdownReport({
    request,
    rows,
    current,
    previous,
    board,
    topEntities,
    actions
  });

  return {
    id: randomUUID(),
    generated_at: new Date().toISOString(),
    provider: "local",
    model: "",
    request,
    rowsAnalyzed: rows.length,
    summary: {
      current,
      previous,
      topEntities
    },
    board,
    markdown,
    actions
  };
}

function buildDeepSeekPrompt(report) {
  return [
    "你是 Facebook 广告投放数据分析助手。请基于以下已采集数据摘要输出中文分析报告。",
    "要求：结论明确、指出异常或机会、给出可执行动作；不要编造未提供的数据；所有时间口径按北京时间理解。",
    "",
    `分析请求：${report.request.prompt}`,
    `分析范围：${report.request.since} 至 ${report.request.until}`,
    `分析层级：${report.request.level}`,
    `命中明细行数：${report.rowsAnalyzed}`,
    "",
    "核心指标：",
    JSON.stringify(report.summary.current, null, 2),
    "",
    "前段对比指标：",
    JSON.stringify(report.summary.previous, null, 2),
    "",
    "波动看板：",
    JSON.stringify(report.board, null, 2),
    "",
    "重点对象：",
    JSON.stringify(report.summary.topEntities.slice(0, 8), null, 2),
    "",
    "本地规则初稿：",
    report.markdown
  ].join("\n");
}

async function callDeepSeekAnalysis(report) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return {
      ...report,
      provider: "local",
      model: "",
      ai_status: "not_configured",
      ai_message: "未配置 DEEPSEEK_API_KEY，已返回本地规则分析。"
    };
  }

  const result = await postJsonWithTimeout(`${deepSeekBaseUrl.replace(/\/+$/, "")}/chat/completions`, {
    model: deepSeekModel,
    messages: [
      {
        role: "system",
        content: "你是严谨的广告数据分析师，只基于用户提供的数据做判断，使用中文输出 Markdown。"
      },
      {
        role: "user",
        content: buildDeepSeekPrompt(report)
      }
    ],
    stream: false
  }, 45_000, 0);

  if (!result.ok) {
    return {
      ...report,
      provider: "local",
      model: deepSeekModel,
      ai_status: "failed",
      ai_message: `DeepSeek 调用失败：HTTP ${result.status}`,
      markdown: [
        "# Agent 智能分析报告",
        "",
        `> DeepSeek 调用失败：HTTP ${result.status}。以下为本地规则分析结果。`,
        "",
        report.markdown
      ].join("\n")
    };
  }

  const payload = JSON.parse(result.body || "{}");
  const content = payload.choices?.[0]?.message?.content || "";
  if (!content.trim()) {
    return {
      ...report,
      provider: "local",
      model: deepSeekModel,
      ai_status: "empty_response",
      ai_message: "DeepSeek 返回内容为空，已返回本地规则分析。"
    };
  }

  return {
    ...report,
    provider: "deepseek",
    model: payload.model || deepSeekModel,
    ai_status: "success",
    ai_message: "DeepSeek 分析完成",
    localMarkdown: report.markdown,
    markdown: content
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function streamReportGeneration(req, res, request) {
  if (activeReportGeneration) {
    writeJson(res, 409, {
      ok: false,
      error: "report_generation_locked",
      message: "已有报告正在生成，请等待完成后重试。"
    });
    return;
  }

  activeReportGeneration = true;
  let closed = false;
  res.on("close", () => {
    closed = true;
  });
  const startedAt = Date.now();
  const timeoutMs = 45_000;

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });

  const stages = [
    ["validate", "校验参数与锁定输入"],
    ["load", "读取广告明细与实体范围"],
    ["compare", "计算前后阶段波动"],
    ["diagnose", "生成诊断与行动项"],
    ["finish", "整理结构化报告"]
  ];

  try {
    for (const [key, label] of stages.slice(0, 3)) {
      if (closed) return;
      if (Date.now() - startedAt > timeoutMs) {
        throw makeValidationError("报告生成超时", {}, 408);
      }
      writeSse(res, "stage", { key, label });
      await sleep(180);
    }

    const localReport = buildAnalysisReport(request);
    writeSse(res, "stage", { key: "diagnose", label: "生成诊断与行动项" });
    const report = await callDeepSeekAnalysis(localReport);
    writeAnalysisReports([report, ...readAnalysisReports()]);
    const chunks = report.markdown.match(/[\s\S]{1,72}/g) || [];
    for (const chunk of chunks) {
      if (closed) return;
      if (Date.now() - startedAt > timeoutMs) {
        throw makeValidationError("报告生成超时", {}, 408);
      }
      writeSse(res, "delta", { text: chunk });
      await sleep(24);
    }

    writeSse(res, "stage", { key: "finish", label: "整理结构化报告" });
    writeSse(res, "final", {
      ok: true,
      report
    });
    res.end();
  } catch (error) {
    if (!closed) {
      writeSse(res, "error", {
        ok: false,
        error: error.statusCode === 408 ? "report_timeout" : "report_generation_failed",
        message: error.message || "报告生成失败"
      });
      res.end();
    }
  } finally {
    activeReportGeneration = false;
  }
}

function latestAdsDataFile() {
  if (!fs.existsSync(cliOutputDir)) return null;
  const files = fs.readdirSync(cliOutputDir)
    .filter((file) => /^facebook_ads_.*\.json$/.test(file))
    .map((file) => {
      const filePath = path.join(cliOutputDir, file);
      return {
        file,
        filePath,
        mtimeMs: fs.statSync(filePath).mtimeMs
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const file of files) {
    try {
      const text = fs.readFileSync(file.filePath, "utf8").replace(/^\uFEFF/, "");
      const rows = JSON.parse(text);
      if (Array.isArray(rows) && rows.length > 0) {
        return {
          ...file,
          rows
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

function readRecentAccountTimeZones(limit = 30) {
  const timeZones = new Map();
  if (!fs.existsSync(cliRawDir)) {
    return timeZones;
  }

  const files = fs.readdirSync(cliRawDir)
    .filter((file) => /^accounts_.*\.json$/.test(file))
    .map((file) => {
      const filePath = path.join(cliRawDir, file);
      return {
        filePath,
        mtimeMs: fs.statSync(filePath).mtimeMs
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit);

  for (const file of files) {
    try {
      const text = fs.readFileSync(file.filePath, "utf8").replace(/^\uFEFF/, "");
      const payload = JSON.parse(text);
      const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
      accounts.forEach((account) => {
        const accountId = String(account.account_id || "").trim();
        const timeZone = String(account.timezone_name || "").trim();
        if (accountId && timeZone && !timeZones.has(accountId)) {
          timeZones.set(accountId, timeZone);
        }
      });
    } catch {
      continue;
    }
  }

  return timeZones;
}

let accountTimeZoneCache = {
  expiresAt: 0,
  value: new Map()
};

function readRecentAccountTimeZonesCached() {
  if (Date.now() < accountTimeZoneCache.expiresAt) {
    return accountTimeZoneCache.value;
  }

  const value = readRecentAccountTimeZones();
  accountTimeZoneCache = {
    value,
    expiresAt: Date.now() + 60_000
  };
  return value;
}

function timestampFromDashboardSource(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?/);
  if (!match) {
    return Number.NaN;
  }

  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    match[4] === undefined ? 0 : Number(match[4]),
    match[5] === undefined ? 0 : Number(match[5]),
    match[6] === undefined ? 0 : Number(match[6]),
    0
  );
}

function toDashboardInsightRow(row) {
  const dateValue = row.date_stop || row.date_start;
  const timestampSource = row.hour_start_beijing
    || row.date_start_beijing
    || row.hour_start
    || (dateValue ? `${dateValue}T00:00:00` : "");
  const spend = Number(row.spend || 0);
  const roas = Number(row.roas || 0);
  const purchaseValue = Number(row.purchase_value || 0) || spend * roas;
  const campaignId = row.campaign_id || row.adset_id || row.ad_id || row.campaign_name || "unknown";
  const addToCart = Number(row.add_to_cart_count || 0);
  const initiateCheckout = Number(row.initiate_checkout_count || 0);
  const purchases = Number(row.purchase_count || 0);
  const results = Number(row.result_count || row.purchase_count || 0);
  const clicks = Number(row.clicks || 0);

  return {
    timestamp: timestampFromDashboardSource(timestampSource),
    account: row.account_name || row.account_id || "",
    accountId: row.account_id || "",
    campaign: row.campaign_name || row.adset_name || row.ad_name || campaignId,
    campaignId,
    campaignName: row.campaign_name || "",
    adsetId: row.adset_id || "",
    adsetName: row.adset_name || "",
    adId: row.ad_id || "",
    adName: row.ad_name || "",
    delivery: row.effective_status || "未知",
    objective: row.result_type || "",
    dataDate: row.date_start_beijing || row.date_start || "",
    dataUpdatedAt: row.updated_at || "",
    budget: 0,
    spend,
    impressions: Number(row.impressions || 0),
    clicks_all: clicks,
    reach: Number(row.reach || 0),
    add_to_cart: addToCart,
    initiate_checkout: initiateCheckout,
    purchases,
    revenue: purchaseValue,
    results,
    actions: results + addToCart + initiateCheckout + purchases
  };
}

const dashboardInsightColumns = [
  "timestamp",
  "account",
  "accountId",
  "campaign",
  "campaignId",
  "campaignName",
  "adsetId",
  "adsetName",
  "adId",
  "adName",
  "delivery",
  "objective",
  "dataDate",
  "dataUpdatedAt",
  "budget",
  "spend",
  "impressions",
  "clicks_all",
  "reach",
  "add_to_cart",
  "initiate_checkout",
  "purchases",
  "revenue",
  "results",
  "actions"
];

function toDashboardInsightValues(row) {
  const item = toDashboardInsightRow(row);
  return dashboardInsightColumns.map((column) => item[column]);
}

function toDashboardInsightRows(rows = []) {
  return rows.map(toDashboardInsightRow).filter((row) => Number.isFinite(row.timestamp));
}

function toDashboardInsightValueRows(rows = []) {
  return rows.map(toDashboardInsightValues).filter((row) => Number.isFinite(row[0]));
}

function sendLatestAdsData(res, { dashboardShape = false } = {}) {
  const accountTimeZones = readRecentAccountTimeZonesCached();
  try {
    const latestFromDb = readLatestInsightData({ databaseFile, accountTimeZones });
    if (latestFromDb?.rows?.length) {
      const rows = dashboardShape ? toDashboardInsightValueRows(latestFromDb.rows) : latestFromDb.rows;
      writeJson(res, 200, {
        ok: true,
        shape: dashboardShape ? "dashboard_columns" : "raw",
        columns: dashboardShape ? dashboardInsightColumns : undefined,
        source: `sqlite:${latestFromDb.batch.source}`,
        storage: "sqlite",
        batch: {
          id: latestFromDb.batch.id,
          source: latestFromDb.batch.source,
          level: latestFromDb.batch.level,
          row_count: latestFromDb.batch.row_count,
          completed_at: latestFromDb.batch.completed_at
        },
        updated_at: latestFromDb.batch.completed_at,
        display_time_zone: displayTimeZone,
        metadata: {
          time_zone_enriched_fields: latestFromDb.batch.metadata.time_zone_enriched_fields || 0,
          granularity: latestFromDb.rows.some((row) => row.hour_start || row.hour_start_beijing) ? "hour" : "day"
        },
        rows
      });
      return;
    }
  } catch (databaseError) {
    console.warn(`SQLite latest read failed: ${databaseError.message}`);
  }

  const latest = latestAdsDataFile();
  if (!latest) {
    writeJson(res, 404, { ok: false, error: "no_collected_data" });
    return;
  }

  try {
    const enriched = enrichInsightRowsWithTimeZone(latest.rows, accountTimeZones);
    const rows = dashboardShape ? toDashboardInsightValueRows(enriched.rows) : enriched.rows;
    writeJson(res, 200, {
      ok: true,
      shape: dashboardShape ? "dashboard_columns" : "raw",
      columns: dashboardShape ? dashboardInsightColumns : undefined,
      source: latest.file,
      updated_at: new Date(latest.mtimeMs).toISOString(),
      display_time_zone: displayTimeZone,
      rows,
      metadata: {
        time_zone_enriched_fields: enriched.enrichedCount,
        granularity: enriched.rows.some((row) => row.hour_start || row.hour_start_beijing) ? "hour" : "day"
      }
    });
  } catch (readError) {
    writeJson(res, 500, {
      ok: false,
      error: "read_failed",
      message: readError.message
    });
  }
}

function writeApiError(res, error, fallbackError = "request_failed") {
  writeJson(res, error.statusCode || 500, {
    ok: false,
    error: error.code || fallbackError,
    message: error.message || "请求失败",
    fields: error.fields || undefined
  });
}

function handleAlertTemplateRoutes(req, res, url) {
  if (url.pathname === "/api/alert-ai/metadata" && req.method === "GET") {
    writeJson(res, 200, {
      ok: true,
      metadata: alertMetadata()
    });
    return true;
  }

  const templateMatch = url.pathname.match(/^\/api\/alert-ai\/templates(?:\/([^/]+)(?:\/(copy|status))?)?$/);
  if (!templateMatch) {
    return false;
  }

  const templateId = templateMatch[1] ? decodeURIComponent(templateMatch[1]) : "";
  const action = templateMatch[2] || "";

  try {
    if (!templateId && req.method === "GET") {
      const templates = readAlertTemplates()
        .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
      const filtered = filterAlertTemplates(templates, url.searchParams).map(templateListItem);
      const page = paginate(filtered, url.searchParams);
      writeJson(res, 200, {
        ok: true,
        ...page
      });
      return true;
    }

    if (!templateId && req.method === "POST") {
      readRequestBody(req)
        .then((body) => {
          const payload = JSON.parse(body || "{}");
          const templates = readAlertTemplates();
          const template = normalizeAlertTemplate(payload);
          writeAlertTemplates([...templates, template]);
          writeJson(res, 201, {
            ok: true,
            template
          });
        })
        .catch((error) => writeApiError(res, error, "create_alert_template_failed"));
      return true;
    }

    if (templateId && !action && req.method === "GET") {
      const templates = readAlertTemplates();
      const template = findTemplateOrThrow(templates, templateId);
      writeJson(res, 200, {
        ok: true,
        template
      });
      return true;
    }

    if (templateId && !action && req.method === "PUT") {
      readRequestBody(req)
        .then((body) => {
          const payload = JSON.parse(body || "{}");
          const templates = readAlertTemplates();
          const index = templates.findIndex((template) => template.id === templateId);
          if (index < 0) {
            throw makeValidationError("预警模板不存在", {}, 404);
          }
          const template = normalizeAlertTemplate(payload, templates[index]);
          const nextTemplates = [...templates];
          nextTemplates[index] = template;
          writeAlertTemplates(nextTemplates);
          writeJson(res, 200, {
            ok: true,
            template
          });
        })
        .catch((error) => writeApiError(res, error, "update_alert_template_failed"));
      return true;
    }

    if (templateId && action === "status" && req.method === "PATCH") {
      readRequestBody(req)
        .then((body) => {
          const payload = JSON.parse(body || "{}");
          const templates = readAlertTemplates();
          const index = templates.findIndex((template) => template.id === templateId);
          if (index < 0) {
            throw makeValidationError("预警模板不存在", {}, 404);
          }
          const nextTemplates = [...templates];
          nextTemplates[index] = {
            ...nextTemplates[index],
            enabled: payload.enabled === true,
            updated_at: new Date().toISOString()
          };
          writeAlertTemplates(nextTemplates);
          writeJson(res, 200, {
            ok: true,
            template: nextTemplates[index]
          });
        })
        .catch((error) => writeApiError(res, error, "update_alert_template_status_failed"));
      return true;
    }

    if (templateId && action === "copy" && req.method === "POST") {
      const templates = readAlertTemplates();
      const source = findTemplateOrThrow(templates, templateId);
      const now = new Date().toISOString();
      const template = {
        ...source,
        id: randomUUID(),
        name: uniqueCopiedName(source.name, templates),
        enabled: false,
        created_at: now,
        updated_at: now
      };
      writeAlertTemplates([...templates, template]);
      writeJson(res, 201, {
        ok: true,
        template
      });
      return true;
    }

    if (templateId && !action && req.method === "DELETE") {
      const templates = readAlertTemplates();
      findTemplateOrThrow(templates, templateId);
      writeAlertTemplates(templates.filter((template) => template.id !== templateId));
      writeJson(res, 200, {
        ok: true
      });
      return true;
    }

    writeJson(res, 405, {
      ok: false,
      error: "method_not_allowed"
    });
    return true;
  } catch (error) {
    writeApiError(res, error, "alert_template_request_failed");
    return true;
  }
}

function handleAlertEntityRoutes(req, res, url) {
  if (url.pathname !== "/api/alert-ai/entities" || req.method !== "GET") {
    return false;
  }

  const level = String(url.searchParams.get("level") || "campaign");
  const search = String(url.searchParams.get("search") || "");
  const limit = Number.parseInt(url.searchParams.get("limit"), 10) || 80;
  try {
    const entities = readAnalysisEntityOptions({
      databaseFile,
      level,
      search,
      limit
    });
    writeJson(res, 200, {
      ok: true,
      level,
      entities
    });
  } catch (error) {
    writeApiError(res, error, "read_alert_ai_entities_failed");
  }
  return true;
}

function handleAlertMonitorRoutes(req, res, url) {
  if (url.pathname === "/api/alert-ai/alerts/messages" && req.method === "GET") {
    writeJson(res, 200, {
      ok: true,
      messages: readAlertMessages().slice(0, Number(url.searchParams.get("limit") || 80))
    });
    return true;
  }

  if (url.pathname === "/api/alert-ai/alerts/push-records" && req.method === "GET") {
    writeJson(res, 200, {
      ok: true,
      records: readAlertPushRecords().slice(0, Number(url.searchParams.get("limit") || 80))
    });
    return true;
  }

  if (url.pathname === "/api/alert-ai/alerts/evaluate" && req.method === "POST") {
    readRequestBody(req)
      .then((body) => {
        const payload = JSON.parse(body || "{}");
        return evaluateAlertTemplates({
        templateIds: Array.isArray(payload.templateIds)
          ? payload.templateIds
          : normalizeStringList(payload.templateIds),
        push: payload.push !== false
        });
      })
      .then((result) => writeJson(res, 200, {
        ok: true,
        ...result
      }))
      .catch((error) => writeApiError(res, error, "evaluate_alerts_failed"));
    return true;
  }

  return false;
}

function handleAlertReportRoutes(req, res, url) {
  if (url.pathname !== "/api/alert-ai/reports/stream" || req.method !== "POST") {
    if (url.pathname === "/api/alert-ai/reports" && req.method === "GET") {
      writeJson(res, 200, {
        ok: true,
        reports: readAnalysisReports().slice(0, Number(url.searchParams.get("limit") || 40))
      });
      return true;
    }
    return false;
  }

  readRequestBody(req)
    .then((body) => {
      const payload = JSON.parse(body || "{}");
      const reportRequest = normalizeReportRequest(payload);
      return streamReportGeneration(req, res, reportRequest);
    })
    .catch((error) => writeApiError(res, error, "start_report_generation_failed"));
  return true;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  res.shouldGzip = /\bgzip\b/i.test(String(req.headers["accept-encoding"] || ""));

  if (url.pathname === "/api/health") {
    writeJson(res, 200, {
      ok: true,
      module: "fb-ads-dashboard",
      time: new Date().toISOString(),
      display_time_zone: displayTimeZone
    });
    return;
  }

  if (url.pathname === "/api/fb-ads/latest") {
    sendLatestAdsData(res, {
      dashboardShape: url.searchParams.get("shape") === "dashboard"
    });
    return;
  }

  if (handleAlertTemplateRoutes(req, res, url)) {
    return;
  }

  if (handleAlertMonitorRoutes(req, res, url)) {
    return;
  }

  if (handleAlertEntityRoutes(req, res, url)) {
    return;
  }

  if (handleAlertReportRoutes(req, res, url)) {
    return;
  }

  if (url.pathname === "/api/monitor/status") {
    try {
      writeJson(res, 200, {
        ok: true,
        status: readMonitorOverview({ databaseFile })
      });
    } catch (error) {
      writeJson(res, 500, {
        ok: false,
        error: "read_monitor_status_failed",
        message: error.message
      });
    }
    return;
  }

  if (url.pathname === "/api/settings/accounts" && req.method === "GET") {
    try {
      writeJson(res, 200, {
        ok: true,
        accounts: readMonitoredAccounts()
      });
    } catch (error) {
      writeJson(res, 500, {
        ok: false,
        error: "read_settings_failed",
        message: error.message
      });
    }
    return;
  }

  if (url.pathname === "/api/settings/accounts" && req.method === "POST") {
    readRequestBody(req)
      .then((body) => {
        const payload = JSON.parse(body || "{}");
        const accounts = writeMonitoredAccounts(payload.accounts || []);
        writeJson(res, 200, { ok: true, accounts });
      })
      .catch((error) => {
        writeJson(res, error.message === "request_body_too_large" ? 413 : 400, {
          ok: false,
          error: "write_settings_failed",
          message: error.message
        });
      });
    return;
  }

  if (url.pathname === "/api/settings/sampling" && req.method === "GET") {
    try {
      writeJson(res, 200, {
        ok: true,
        settings: readSamplingSettings()
      });
    } catch (error) {
      writeJson(res, 500, {
        ok: false,
        error: "read_sampling_settings_failed",
        message: error.message
      });
    }
    return;
  }

  if (url.pathname === "/api/settings/sampling" && req.method === "POST") {
    readRequestBody(req)
      .then((body) => {
        const payload = JSON.parse(body || "{}");
        const settings = writeSamplingSettings(payload.settings || payload);
        writeJson(res, 200, { ok: true, settings });
      })
      .catch((error) => {
        writeJson(res, error.message === "request_body_too_large" ? 413 : 400, {
          ok: false,
          error: "write_sampling_settings_failed",
          message: error.message
        });
      });
    return;
  }

  if (url.pathname === "/api/settings/resources" && req.method === "GET") {
    try {
      const accountId = String(url.searchParams.get("account_id") || activeResourceAccountId).trim();
      writeJson(res, 200, {
        ok: true,
        catalog: readResourceCandidates(accountId),
        refresh: resourceRefreshStatus
      });
    } catch (error) {
      writeJson(res, 500, {
        ok: false,
        error: "read_resource_candidates_failed",
        message: error.message
      });
    }
    return;
  }

  if (url.pathname === "/api/settings/resources/refresh" && req.method === "POST") {
    readRequestBody(req)
      .then(async (body) => {
        const payload = JSON.parse(body || "{}");
        const accountId = String(payload.account_id || activeResourceAccountId).trim();
        const result = await refreshActiveResources({
          accountId,
          reason: "manual",
          force: payload.force !== false
        });
        writeJson(res, result.ok ? 200 : 502, result);
      })
      .catch((error) => {
        writeJson(res, error.message === "request_body_too_large" ? 413 : 400, {
          ok: false,
          error: "refresh_active_resources_failed",
          message: error.message
        });
      });
    return;
  }

  if (url.pathname === "/vendor/echarts.min.js") {
    sendFile(res, path.join(repoRoot, "node_modules", "echarts", "dist", "echarts.min.js"));
    return;
  }

  if (url.pathname === "/vendor/echarts.simple.min.js") {
    sendFile(res, path.join(repoRoot, "node_modules", "echarts", "dist", "echarts.simple.min.js"));
    return;
  }

  if (url.pathname === "/vendor/tom-select.complete.min.js") {
    sendFile(res, path.join(repoRoot, "node_modules", "tom-select", "dist", "js", "tom-select.complete.min.js"));
    return;
  }

  if (url.pathname === "/vendor/tom-select.min.css") {
    sendFile(res, path.join(repoRoot, "node_modules", "tom-select", "dist", "css", "tom-select.min.css"));
    return;
  }

  if (url.pathname === "/meta-relationship-map.html") {
    sendFile(res, path.join(repoRoot, "meta-relationship-map.html"));
    return;
  }

  const filePath = resolvePublicPath(url.pathname);
  if (!filePath) {
    writeJson(res, 403, { ok: false, error: "forbidden" });
    return;
  }

  sendFile(res, filePath);
});

server.listen(port, host, () => {
  console.log(`FB Ads Dashboard running at http://${host}:${port}/`);
  console.log(`Health check: http://${host}:${port}/api/health`);
});

scheduleActiveResourceRefresh();
