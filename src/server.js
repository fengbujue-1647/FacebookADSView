const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const zlib = require("node:zlib");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const {
  handleAuthRoutes,
  applyApiPolicy,
  parseCookies,
  audit
} = require("./auth");
const {
  pinConfigured,
  verifyPin,
  adminPinVerified,
  setAdminPinCookie,
  clearAdminPinCookie,
  pinTtlMs
} = require("./adminPin");
const {
  createUser,
  updateUser,
  resetUserPassword,
  listUsers,
  listAuditEvents,
  normalizeAccountIds
} = require("./authStore");
const {
  readLatestInsightData,
  readMonitorOverview,
  readCollectionQueueOverview,
  recoverStaleCollectionJobs,
  deleteCollectionRun,
  readActiveResourceCandidates,
  readAnalysisEntityOptions,
  readInsightRowsForAnalysis,
  readAccountIdsForAnalysisEntities
} = require("./database");
const { DISPLAY_TIME_ZONE, enrichInsightRowsWithTimeZone } = require("./time");

const publicDir = path.resolve(__dirname, "..", "public");
const repoRoot = path.resolve(__dirname, "..");
const envSources = new Map();
const envFiles = [
  { filePath: path.join(repoRoot, ".env"), label: ".env", loaded: true },
  { filePath: path.join(repoRoot, "cli", ".env"), label: "cli/.env", loaded: true },
  { filePath: path.join(repoRoot, "cli", ".env.example"), label: "cli/.env.example", loaded: false }
];

function parseEnvFile(filePath) {
  const entries = new Map();
  if (!fs.existsSync(filePath)) return entries;
  const lines = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const index = normalized.indexOf("=");
    if (index <= 0) return;
    const key = normalized.slice(0, index).trim();
    let value = normalized.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) {
      entries.set(key, value);
    }
  });
  return entries;
}

function loadEnvFile(filePath, sourceLabel) {
  const entries = parseEnvFile(filePath);
  entries.forEach((value, key) => {
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
      envSources.set(key, sourceLabel);
    }
  });
}

envFiles.filter((file) => file.loaded).forEach((file) => {
  loadEnvFile(file.filePath, file.label);
});

const parsedPort = Number(process.env.PORT || 3100);
const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3100;
const host = process.env.HOST || "127.0.0.1";

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
const monitorSchedulerIntervalMs = 30 * 1000;
const collectionQueueWatchdogMs = 5 * 60 * 1000;
const alertReportMaxDays = 90;
const alertReportPromptMaxLength = 1600;
let activeReportGeneration = false;
let resourceRefreshPromise = null;
let collectionRunProcess = null;
let resourceRefreshStatus = {
  running: false,
  status: "idle",
  account_id: activeResourceAccountId,
  last_started_at: "",
  last_completed_at: "",
  reason: "",
  error: ""
};
let collectionRunStatus = {
  running: false,
  status: "idle",
  mode: "",
  trigger_source: "",
  run_id: "",
  last_started_at: "",
  last_completed_at: "",
  exit_code: null,
  error: ""
};
let monitorSchedulerStatus = {
  enabled: true,
  running: false,
  status: "idle",
  last_checked_at: "",
  last_started_at: "",
  last_completed_at: "",
  last_mode: "",
  next_due_at: "",
  due: [],
  reason: "",
  error: ""
};

const environmentGroups = [
  {
    id: "runtime",
    title: "服务启动",
    items: [
      {
        key: "HOST",
        label: "监听地址",
        description: "Web 服务绑定地址；局域网访问时通常改成 0.0.0.0。",
        defaultValue: "127.0.0.1",
        displayValue: host,
        usedBy: "npm start"
      },
      {
        key: "PORT",
        label: "监听端口",
        description: "Web 服务端口，默认打开 http://127.0.0.1:3100/。",
        defaultValue: "3100",
        displayValue: String(port),
        usedBy: "npm start"
      },
      {
        key: "ACTIVE_RESOURCE_ACCOUNT_ID",
        label: "ACTIVE 资源账户",
        description: "设置页刷新 ACTIVE 广告系列、广告组和广告候选时使用的默认账户。",
        defaultValue: "8462513793771963",
        displayValue: activeResourceAccountId,
        usedBy: "设置页资源刷新"
      }
    ]
  },
  {
    id: "yinolink",
    title: "YinoLink API",
    items: [
      {
        key: "YINO_CLIENT_ID",
        label: "应用 ID",
        description: "YinoCloud 审核通过后的应用 ID，CLI 采集和资源刷新必填。",
        required: true,
        usedBy: "CLI / Tool 1-3"
      },
      {
        key: "YINO_CLIENT_SECRET",
        label: "API Key",
        description: "YinoCloud 应用密钥，CLI 会用它换取 token；不在前端显示明文。",
        required: true,
        sensitive: true,
        usedBy: "CLI / Tool 1-3"
      },
      {
        key: "YINO_BASE_URL",
        label: "接口 Base URL",
        description: "YinoLink Open API 根地址。",
        defaultValue: "https://yl-open-api-lfnsrvbmgm.ap-northeast-1.fcapp.run",
        usedBy: "YinoClient"
      },
      {
        key: "YINO_CONCURRENCY",
        label: "默认并发",
        description: "CLI 未单独指定并发时使用的 YinoLink 请求并发。",
        defaultValue: "3",
        usedBy: "CLI"
      },
      {
        key: "YINO_REQUEST_TIMEOUT_MS",
        label: "请求超时",
        description: "CLI 未单独指定超时时使用的 YinoLink 请求超时毫秒数。",
        defaultValue: "30000",
        usedBy: "CLI"
      }
    ]
  },
  {
    id: "alert-ai",
    title: "预警与 AI",
    items: [
      {
        key: "FEISHU_ALERT_WEBHOOK_URL",
        label: "飞书机器人 Webhook",
        description: "预警模板未单独填写飞书地址时使用的默认群机器人 Webhook。",
        sensitive: true,
        usedBy: "预警监控"
      },
      {
        key: "DEEPSEEK_API_KEY",
        label: "DeepSeek API Key",
        description: "AI 分析报告调用 DeepSeek 时使用；未配置时返回本地规则分析。",
        sensitive: true,
        usedBy: "AI 分析"
      },
      {
        key: "DEEPSEEK_BASE_URL",
        label: "DeepSeek Base URL",
        description: "DeepSeek 兼容 Chat Completions 接口地址。",
        defaultValue: "https://api.deepseek.com",
        usedBy: "AI 分析"
      },
      {
        key: "DEEPSEEK_MODEL",
        label: "DeepSeek 模型",
        description: "AI 分析报告使用的模型名称。",
        defaultValue: "deepseek-v4-flash",
        usedBy: "AI 分析"
      }
    ]
  },
  {
    id: "sentinel",
    title: "服务哨兵",
    items: [
      {
        key: "SENTINEL_SERVICE_NAME",
        label: "哨兵服务名",
        description: "哨兵报告中展示的服务名称。",
        defaultValue: "fb-ads-dashboard",
        usedBy: "服务哨兵"
      },
      {
        key: "SENTINEL_WEBHOOK_URL",
        label: "哨兵报告 Webhook",
        description: "达到每日崩溃重启上限时推送报告；未配置时回退 FEISHU_ALERT_WEBHOOK_URL。",
        sensitive: true,
        usedBy: "服务哨兵"
      },
      {
        key: "SENTINEL_MAX_DAILY_RESTARTS",
        label: "每日重启上限",
        description: "按北京时间自然日统计的错误崩溃重启次数上限。",
        defaultValue: "3",
        usedBy: "服务哨兵"
      },
      {
        key: "SENTINEL_BACKOFF_INITIAL_MS",
        label: "初始退避毫秒",
        description: "第一次错误重启前等待时间，后续按指数退避递增。",
        defaultValue: "5000",
        usedBy: "服务哨兵"
      },
      {
        key: "SENTINEL_BACKOFF_MAX_MS",
        label: "最大退避毫秒",
        description: "指数退避的最大等待时间。",
        defaultValue: "300000",
        usedBy: "服务哨兵"
      },
      {
        key: "SENTINEL_HEALTH_URL",
        label: "健康检查地址",
        description: "哨兵用于判断 Web 看板是否可用的健康检查地址。",
        defaultValue: `http://127.0.0.1:${port}/api/health`,
        usedBy: "服务哨兵"
      },
      {
        key: "SENTINEL_HEALTH_INTERVAL_MS",
        label: "健康检查间隔",
        description: "哨兵两次健康检查之间的等待毫秒数。",
        defaultValue: "30000",
        usedBy: "服务哨兵"
      },
      {
        key: "SENTINEL_HEALTH_TIMEOUT_MS",
        label: "健康检查超时",
        description: "单次健康检查请求超时毫秒数。",
        defaultValue: "5000",
        usedBy: "服务哨兵"
      },
      {
        key: "SENTINEL_HEALTH_FAILURES_BEFORE_RESTART",
        label: "失败重启阈值",
        description: "连续健康检查失败达到该次数后终止并重启 Web 看板。",
        defaultValue: "3",
        usedBy: "服务哨兵"
      }
    ]
  }
];

function envSourceFor(key, configured) {
  if (!configured) return "";
  return envSources.get(key) || "启动进程环境";
}

function defaultFeishuWebhookUrl() {
  return process.env.FEISHU_ALERT_WEBHOOK_URL || "";
}

function deepSeekBaseUrl() {
  return process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
}

function deepSeekModelName() {
  return process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
}

function allEnvironmentSpecs() {
  return environmentGroups.flatMap((group) => group.items.map((item) => ({
    ...item,
    groupId: group.id,
    groupTitle: group.title
  })));
}

function buildEnvironmentItem(spec) {
  const rawValue = process.env[spec.key];
  const configured = rawValue !== undefined && String(rawValue).trim() !== "";
  const hasDefault = spec.defaultValue !== undefined && String(spec.defaultValue) !== "";
  const displayValue = configured
    ? spec.sensitive ? "已配置（不显示明文）" : String(spec.displayValue ?? rawValue)
    : hasDefault ? String(spec.defaultValue) : "未配置";
  const status = configured ? "configured" : hasDefault ? "default" : spec.required ? "missing" : "optional";

  return {
    key: spec.key,
    label: spec.label,
    description: spec.description,
    required: spec.required === true,
    sensitive: spec.sensitive === true,
    usedBy: spec.usedBy || "",
    configured,
    source: configured ? envSourceFor(spec.key, configured) : hasDefault ? "默认值" : "未配置",
    displayValue,
    editValue: spec.sensitive && configured ? "" : String(rawValue ?? spec.defaultValue ?? ""),
    preserveOnEmpty: spec.sensitive === true && configured,
    defaultValue: spec.defaultValue || "",
    status
  };
}

function buildEnvironmentSettings() {
  const groups = environmentGroups.map((group) => ({
    id: group.id,
    title: group.title,
    items: group.items.map(buildEnvironmentItem)
  }));
  const allItems = groups.flatMap((group) => group.items);
  const requiredItems = allItems.filter((item) => item.required);
  const envFileStatus = envFiles.map((file) => {
    const entries = parseEnvFile(file.filePath);
    return {
      path: file.label,
      exists: fs.existsSync(file.filePath),
      loaded: file.loaded,
      keys: entries.size
    };
  });

  return {
    files: envFileStatus,
    groups,
    summary: {
      requiredTotal: requiredItems.length,
      requiredConfigured: requiredItems.filter((item) => item.configured).length,
      configuredTotal: allItems.filter((item) => item.configured).length,
      total: allItems.length
    }
  };
}

function quoteEnvValue(value) {
  const text = String(value ?? "");
  if (!text || /^[A-Za-z0-9_./:@?&%+=,\-]+$/.test(text)) {
    return text;
  }
  return JSON.stringify(text);
}

function normalizeEnvironmentPostEntries(input = {}) {
  const source = Array.isArray(input.entries) ? input.entries : [];
  const byKey = new Map(source.map((entry) => [String(entry.key || "").trim(), entry]));
  const existingCliEntries = parseEnvFile(path.join(repoRoot, "cli", ".env"));
  const allowed = new Set(allEnvironmentSpecs().map((item) => item.key));
  const fields = {};

  source.forEach((entry) => {
    const key = String(entry.key || "").trim();
    if (!allowed.has(key)) {
      fields.environment = `不支持的环境变量：${key || "-"}`;
    }
  });
  if (Object.keys(fields).length) {
    throw makeValidationError("环境变量校验失败", fields);
  }

  return allEnvironmentSpecs().map((spec) => {
    const entry = byKey.get(spec.key) || {};
    const rawValue = entry.value === undefined ? "" : String(entry.value);
    const preserve = entry.preserve === true;
    const value = spec.sensitive && preserve && existingCliEntries.has(spec.key)
      ? existingCliEntries.get(spec.key)
      : rawValue;
    return {
      key: spec.key,
      value,
      groupTitle: spec.groupTitle
    };
  });
}

function writeCliEnv(entries) {
  const cliEnvPath = path.join(repoRoot, "cli", ".env");
  const existing = parseEnvFile(cliEnvPath);
  const managedKeys = new Set(entries.map((entry) => entry.key));
  const lines = [
    "# Managed by FB 广告数据看板设置页",
    "# Empty values are kept intentionally, for example APPID=."
  ];
  let currentGroup = "";
  entries.forEach((entry) => {
    if (entry.groupTitle !== currentGroup) {
      currentGroup = entry.groupTitle;
      lines.push("", `# ${currentGroup}`);
    }
    lines.push(`${entry.key}=${quoteEnvValue(entry.value)}`);
    process.env[entry.key] = String(entry.value ?? "");
    envSources.set(entry.key, "cli/.env");
  });

  const customEntries = [...existing.entries()].filter(([key]) => !managedKeys.has(key));
  if (customEntries.length) {
    lines.push("", "# Other existing entries");
    customEntries.forEach(([key, value]) => {
      lines.push(`${key}=${quoteEnvValue(value)}`);
    });
  }

  fs.mkdirSync(path.dirname(cliEnvPath), { recursive: true });
  fs.writeFileSync(cliEnvPath, `${lines.join("\n")}\n`, "utf8");
}

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

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  };
}

function withSecurityHeaders(headers = {}) {
  return {
    ...securityHeaders(),
    ...headers
  };
}

function writeResponse(res, statusCode, headers, body) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  const responseHeaders = withSecurityHeaders(headers);
  if (res.shouldGzip && buffer.length > 1024 && !headers["Content-Encoding"]) {
    zlib.gzip(buffer, (error, compressed) => {
      if (error) {
        res.writeHead(statusCode, responseHeaders);
        res.end(buffer);
        return;
      }
      res.writeHead(statusCode, {
        ...responseHeaders,
        "Content-Encoding": "gzip",
        "Content-Length": compressed.length
      });
      res.end(compressed);
    });
    return;
  }

  res.writeHead(statusCode, {
    ...responseHeaders,
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
  if ([".html", ".css", ".js"].includes(ext)) {
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
      ...withSecurityHeaders(headers),
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
  let cleanPath = "";
  try {
    const routeMap = new Map([
      ["/", "/index.html"],
      ["/ads", "/ads.html"],
      ["/admin", "/admin.html"]
    ]);
    cleanPath = routeMap.get(pathname) || decodeURIComponent(pathname);
  } catch {
    return { filePath: null, error: "malformed_uri" };
  }
  const resolved = path.resolve(publicDir, `.${cleanPath}`);
  const insidePublic = resolved === publicDir || resolved.startsWith(`${publicDir}${path.sep}`);
  return insidePublic ? { filePath: resolved, error: "" } : { filePath: null, error: "forbidden" };
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
    hourly: campaignInput.hourly !== false,
    concurrency: clampInteger(campaignInput.concurrency, 20, 1, 20),
    qps: clampInteger(campaignInput.qps, 5, 1, 20),
    requestTimeoutMs: clampInteger(campaignInput.requestTimeoutMs, 7000, 1000, 60000),
    maxAttempts: clampInteger(campaignInput.maxAttempts, 8, 1, 20)
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
  rolling_60: 60,
  rolling_240: 240,
  rolling_1440: 1440,
  rolling_4320: 4320
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
  const sampling = readSamplingSettings();
  const campaignMinutes = Number(sampling.campaignMonitor?.intervalMinutes || 180);
  const adMinutes = Number(sampling.adMonitor?.intervalMinutes || 60);
  const targetedMinutes = Number(sampling.targeted?.intervalMinutes || adMinutes);
  return {
    metricCategories: alertMetricCategories,
    metrics: Object.entries(alertMetrics).map(([id, metric]) => ({ id, ...metric })),
    comparisons: Object.entries(alertComparisons).map(([id, comparison]) => ({ id, ...comparison })),
    windows: [
      { id: "rolling_60", label: "近 60 分钟", minutes: 60 },
      { id: "rolling_240", label: "近 4 小时", minutes: 240 },
      { id: "rolling_1440", label: "近 1 天", minutes: 1440 },
      { id: "rolling_4320", label: "近 3 天", minutes: 4320 },
      { id: "custom", label: "自定义分钟", minutes: 0 }
    ],
    channels: Object.entries(alertChannels).map(([id, channel]) => ({ id, ...channel })),
    targetLevels: alertTargetLevels,
    monitorWindows: {
      account: { minMinutes: campaignMinutes, label: `账户/广告系列监控约 ${campaignMinutes} 分钟更新` },
      campaign: { minMinutes: campaignMinutes, label: `广告系列监控约 ${campaignMinutes} 分钟更新` },
      adset: { minMinutes: targetedMinutes, label: `广告组定向监控约 ${targetedMinutes} 分钟更新` },
      ad: { minMinutes: adMinutes, label: `广告监控约 ${adMinutes} 分钟更新` }
    },
    defaults: {
      feishuWebhookConfigured: Boolean(defaultFeishuWebhookUrl()),
      deepSeekConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
      deepSeekModel: deepSeekModelName()
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
    logic: index === 0 ? "and" : input.logic === "or" ? "or" : "and",
    metric: metricId,
    metricCategory: metric.category,
    comparison,
    threshold,
    thresholdMax,
    unit: comparisonMetric.unit
  };
}

function minAlertWindowMinutesForLevel(targetLevel) {
  const sampling = readSamplingSettings();
  if (targetLevel === "ad") return Number(sampling.adMonitor?.intervalMinutes || 60);
  if (targetLevel === "adset") return Number(sampling.targeted?.intervalMinutes || sampling.adMonitor?.intervalMinutes || 60);
  return Number(sampling.campaignMonitor?.intervalMinutes || 180);
}

function alertCheckIntervalMinutes(template = {}) {
  const minMinutes = minAlertWindowMinutesForLevel(template.targetLevel || "campaign");
  return clampInteger(template.checkIntervalMinutes, minMinutes, minMinutes, 10_080);
}

function nextAlertCheckAt(template = {}) {
  const base = new Date(template.last_checked_at || template.updated_at || template.created_at || Date.now());
  const baseMs = Number.isFinite(base.getTime()) ? base.getTime() : Date.now();
  return new Date(baseMs + alertCheckIntervalMinutes(template) * 60_000).toISOString();
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
    if (!Number.isInteger(windowMinutes) || windowMinutes < 5 || windowMinutes > 4320) {
      fields.windowMinutes = "自定义时间窗口必须在 5 到 4320 分钟之间";
      windowMinutes = 5;
    }
  }
  const minWindowMinutes = minAlertWindowMinutesForLevel(targetLevel);
  if (Number.isFinite(windowMinutes) && windowMinutes > 0 && windowMinutes < minWindowMinutes) {
    fields.windowMinutes = `时间窗口不能小于当前层级数据更新间隔 ${minWindowMinutes} 分钟`;
  }

  const checkIntervalMinutes = Number.parseInt(input.checkIntervalMinutes ?? existing?.checkIntervalMinutes ?? minWindowMinutes, 10);
  if (!Number.isInteger(checkIntervalMinutes) || checkIntervalMinutes < minWindowMinutes || checkIntervalMinutes > 10_080) {
    fields.checkIntervalMinutes = `检查间隔必须在 ${minWindowMinutes} 到 10080 分钟之间`;
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

  const feishuWebhookUrl = String(input.feishuWebhookUrl || defaultFeishuWebhookUrl() || "").trim();
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
    checkIntervalMinutes,
    severity,
    channels,
    recipients,
    feishuWebhookUrl: channels.includes("feishu") ? feishuWebhookUrl : "",
    webhookUrl: channels.includes("webhook") ? webhookUrl : "",
    enabled: input.enabled !== undefined ? input.enabled === true : existing?.enabled !== false,
    created_at: existing?.created_at || now,
    last_checked_at: existing?.last_checked_at || "",
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
  const ruleText = conditions.map((condition, index) => {
    const metric = alertMetrics[condition.metric] || { label: condition.metric };
    const comparison = alertComparisons[condition.comparison] || { label: condition.comparison };
    const prefix = index === 0 ? "" : condition.logic === "or" ? "；或 " : "；且 ";
    return `${prefix}${metric.label}${comparison.label} ${formatThreshold(condition)}`;
  }).join("");
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
    account_ids: Array.isArray(template.account_ids) ? template.account_ids : [],
    logic: template.logic || "and",
    channels: template.channels,
    channelDescription: templateChannelDescription(template),
    enabled: template.enabled !== false,
    checkIntervalMinutes: alertCheckIntervalMinutes(template),
    last_checked_at: template.last_checked_at || "",
    next_check_at: nextAlertCheckAt(template),
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

function accountIdsForAlertTemplate(template = {}) {
  const targetIds = Array.isArray(template.targetIds) ? template.targetIds : [];
  if (!targetIds.length) {
    return readMonitoredAccounts().map((account) => account.id);
  }
  return resolveEntityAccountIds(template.targetLevel || "campaign", targetIds, null);
}

function withAlertTemplateAccountIds(template = {}) {
  return {
    ...template,
    account_ids: accountIdsForAlertTemplate(template)
  };
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

function normalizeCollectionRunMode(value) {
  return ["all", "campaigns", "ads"].includes(value) ? value : "all";
}

async function loadCliSyncService() {
  const moduleUrl = pathToFileURL(path.join(repoRoot, "cli", "src", "syncService.js")).href;
  const module = await import(moduleUrl);
  return module.SyncService;
}

function previewAccountRows() {
  return readMonitoredAccounts().map((account) => ({
    account_id: account.id,
    name: account.name || account.id
  }));
}

function resourceById(rows = []) {
  return new Map(rows.map((row) => [String(row.id || row.ad_id || row.campaign_id || ""), row]));
}

function mergeActiveResourceCandidates(accounts = []) {
  const accountIds = [...new Set(accounts.map((account) => String(account.account_id || "").trim()).filter(Boolean))];
  if (!accountIds.length && activeResourceAccountId) {
    accountIds.push(activeResourceAccountId);
  }

  const campaigns = new Map();
  const ads = new Map();
  const warnings = [];

  for (const accountId of accountIds) {
    const candidates = readActiveResourceCandidates({
      databaseFile,
      accountId,
      limit: 5000,
      refreshIntervalMs: activeResourceRefreshIntervalMs
    });

    for (const row of candidates.campaigns || []) {
      campaigns.set(String(row.id || row.campaign_id || ""), row);
    }
    for (const row of candidates.ads || []) {
      ads.set(String(row.id || row.ad_id || ""), row);
    }
    if (candidates.error) {
      warnings.push(`ACTIVE 资源缓存读取失败：${accountId} ${candidates.error}`);
    }
  }

  return {
    campaigns: [...campaigns.values()],
    ads: [...ads.values()],
    warnings
  };
}

function rangeFromSlices(slices = []) {
  const starts = slices.map((slice) => slice.since).filter(Boolean).sort();
  const ends = slices.map((slice) => slice.until).filter(Boolean).sort();
  return {
    since: starts[0] || "",
    until: ends.at(-1) || ""
  };
}

function summarizeCollectionPreviewItem({ label, objectType, ids, resources, config, plan, warning = "", blocking = false }) {
  const totalBuckets = plan.plannedSlices.reduce((total, item) => total + Number(item.bucketCount || 0), 0);
  const missingBuckets = plan.plannedSlices.reduce((total, item) => total + Number(item.missingBucketCount || 0), 0);
  const qps = Math.max(1, Number(config.qps || 1));
  const estimatedSeconds = Math.ceil(Number(plan.jobs.length || 0) / qps);
  return {
    label,
    objectType,
    objectCount: ids.length,
    resourceCount: resources.length,
    plannedJobs: plan.jobs.length,
    totalBuckets,
    missingBuckets,
    coveredBuckets: Math.max(0, totalBuckets - missingBuckets),
    range: rangeFromSlices(plan.plannedSlices),
    backfillDays: Math.max(0, ...plan.plannedSlices.map((item) => Number(item.backfillDays || 0))),
    concurrency: Number(config.concurrency || 1),
    qps,
    timeoutMs: Number(config.requestTimeoutMs || 7000),
    estimatedSeconds,
    warning,
    blocking: Boolean(blocking)
  };
}

async function buildCollectionRunPreview({ mode = "all" } = {}) {
  const normalizedMode = normalizeCollectionRunMode(mode);
  const settings = readSamplingSettings();
  const SyncService = await loadCliSyncService();
  const service = new SyncService();
  const accounts = previewAccountRows();
  const accountMap = new Map(accounts.map((account) => [String(account.account_id), account]));
  const candidates = mergeActiveResourceCandidates(accounts);
  const campaignCandidates = resourceById(candidates.campaigns || []);
  const adCandidates = resourceById(candidates.ads || []);
  const items = [];
  const warnings = [...(candidates.warnings || [])];

  if (normalizedMode === "all" || normalizedMode === "campaigns") {
    const config = settings.campaignMonitor || {};
    let ids = [...new Set(config.campaignIds || [])];
    let warning = "";
    let blocking = false;
    if (config.autoActiveCampaigns) {
      if (!accounts.length) {
        warning = "List 1 启用自动 ACTIVE 广告系列，但当前没有监控账户；真实运行时 List 1 会失败，请先配置监控账户或关闭自动 ACTIVE。";
        warnings.push(warning);
        blocking = true;
        ids = [];
      } else {
        ids = [...new Set([...campaignCandidates.keys(), ...ids])];
      }
    }
    const resources = ids.map((id) => ({
      ...(campaignCandidates.get(String(id)) || {}),
      id: String(id),
      campaign_id: String(id),
      account_id: campaignCandidates.get(String(id))?.account_id || activeResourceAccountId
    }));
    const plan = ids.length
      ? service.planHourlyCollectionJobs({
        sourceRows: resources,
        resourceType: "campaigns",
        accountMap,
        runId: "preview",
        resultAction: config.resultAction || "",
        source: "preview:campaigns",
        tool: "preview-campaigns",
        outputName: "preview",
        maxAttempts: config.maxAttempts || 8
      })
      : { jobs: [], plannedSlices: [] };
    items.push(summarizeCollectionPreviewItem({
      label: "List 1 广告系列",
      objectType: "campaigns",
      ids,
      resources,
      config,
      plan,
      warning,
      blocking
    }));
  }

  if (normalizedMode === "all" || normalizedMode === "ads") {
    const config = settings.adMonitor || {};
    const ids = [...new Set(config.adIds || [])];
    const resources = ids.map((id) => ({
      ...(adCandidates.get(String(id)) || {}),
      id: String(id),
      ad_id: String(id),
      account_id: adCandidates.get(String(id))?.account_id || activeResourceAccountId
    }));
    const plan = ids.length
      ? service.planHourlyCollectionJobs({
        sourceRows: resources,
        resourceType: "ads",
        accountMap,
        runId: "preview",
        resultAction: config.resultAction || "",
        source: "preview:ads",
        tool: "preview-ads",
        outputName: "preview",
        maxAttempts: config.maxAttempts || 8
      })
      : { jobs: [], plannedSlices: [] };
    items.push(summarizeCollectionPreviewItem({
      label: "List 2 广告",
      objectType: "ads",
      ids,
      resources,
      config,
      plan
    }));
  }

  const totalJobs = items.reduce((total, item) => total + Number(item.plannedJobs || 0), 0);
  const totalObjects = items.reduce((total, item) => total + Number(item.objectCount || 0), 0);
  const estimatedSeconds = items.reduce((total, item) => total + Number(item.estimatedSeconds || 0), 0);
  const runnerBusy = Boolean(collectionRunProcess);
  const blocking = items.some((item) => item.blocking);

  return {
    mode: normalizedMode,
    generatedAt: new Date().toISOString(),
    runnerBusy,
    canRun: !runnerBusy && totalJobs > 0 && !blocking,
    blocking,
    runner: collectionRunStatus,
    totalJobs,
    totalObjects,
    estimatedSeconds,
    items,
    warnings
  };
}

function startCollectionRun({ mode = "all", triggerSource = "manual" } = {}) {
  if (collectionRunProcess) {
    return {
      ok: false,
      statusCode: 409,
      error: "collection_run_already_running",
      message: "采集任务正在运行",
      run: collectionRunStatus
    };
  }

  const normalizedMode = normalizeCollectionRunMode(mode);
  const args = [
    "--disable-warning=ExperimentalWarning",
    path.join(repoRoot, "cli", "src", "cli.js"),
    "monitor-run",
    "--mode",
    normalizedMode,
    "--force"
  ];

  collectionRunStatus = {
    running: true,
    status: "running",
    mode: normalizedMode,
    trigger_source: triggerSource,
    run_id: "",
    last_started_at: new Date().toISOString(),
    last_completed_at: "",
    exit_code: null,
    error: ""
  };
  collectionRunProcess = spawn(process.execPath, args, {
    cwd: path.join(repoRoot, "cli"),
    env: process.env,
    stdio: "ignore",
    windowsHide: true
  });
  collectionRunProcess.on("error", (error) => {
    const completedAt = new Date().toISOString();
    collectionRunStatus = {
      ...collectionRunStatus,
      running: false,
      status: "failed",
      last_completed_at: completedAt,
      error: error.message
    };
    if (triggerSource === "scheduler") {
      monitorSchedulerStatus = {
        ...monitorSchedulerStatus,
        running: false,
        status: "failed",
        last_completed_at: completedAt,
        error: error.message
      };
    }
    collectionRunProcess = null;
  });
  collectionRunProcess.on("exit", (code) => {
    const completedAt = new Date().toISOString();
    collectionRunStatus = {
      ...collectionRunStatus,
      running: false,
      status: code === 0 ? "success" : "failed",
      last_completed_at: completedAt,
      exit_code: code
    };
    if (triggerSource === "scheduler") {
      monitorSchedulerStatus = {
        ...monitorSchedulerStatus,
        running: false,
        status: code === 0 ? "idle" : "failed",
        last_completed_at: completedAt,
        error: code === 0 ? "" : `采集进程退出码 ${code}`
      };
    }
    collectionRunProcess = null;
  });

  return {
    ok: true,
    statusCode: 202,
    run: collectionRunStatus
  };
}

function collectionResumeSettings(run = {}) {
  const settings = readSamplingSettings();
  const objectTypes = Array.isArray(run.objectTypes) ? run.objectTypes : [];
  const usesCampaigns = objectTypes.includes("campaigns");
  const usesAds = objectTypes.includes("ads") || objectTypes.includes("adsets");
  const candidates = [
    usesCampaigns ? settings.campaignMonitor : null,
    usesAds ? settings.adMonitor : null
  ].filter(Boolean);
  const fallback = [settings.campaignMonitor, settings.adMonitor];
  const pool = candidates.length ? candidates : fallback;
  return {
    concurrency: Math.max(...pool.map((item) => Number(item?.concurrency || 1))),
    qps: Math.max(...pool.map((item) => Number(item?.qps || 1))),
    timeoutMs: Math.max(...pool.map((item) => Number(item?.requestTimeoutMs || 7000)))
  };
}

function startCollectionQueueResume({ runId, reason = "auto", concurrency = 0, qps = 0, timeoutMs = 0 } = {}) {
  if (!runId) {
    return { ok: false, skipped: true, reason: "missing_run_id" };
  }
  if (collectionRunProcess) {
    return { ok: false, skipped: true, reason: "runner_busy", run: collectionRunStatus };
  }

  const args = [
    "--disable-warning=ExperimentalWarning",
    path.join(repoRoot, "cli", "src", "cli.js"),
    "queue-run",
    "--run-id",
    runId,
    "--recover-stale-ms",
    "0"
  ];
  if (concurrency > 0) args.push("--concurrency", String(concurrency));
  if (qps > 0) args.push("--qps", String(qps));
  if (timeoutMs > 0) args.push("--timeout-ms", String(timeoutMs));

  collectionRunStatus = {
    running: true,
    status: "running",
    mode: reason === "startup" ? "恢复当前采集批次" : "续跑当前采集批次",
    trigger_source: "queue-resume",
    run_id: runId,
    last_started_at: new Date().toISOString(),
    last_completed_at: "",
    exit_code: null,
    error: ""
  };
  collectionRunProcess = spawn(process.execPath, args, {
    cwd: path.join(repoRoot, "cli"),
    env: process.env,
    stdio: "ignore",
    windowsHide: true
  });
  collectionRunProcess.on("error", (error) => {
    collectionRunStatus = {
      ...collectionRunStatus,
      running: false,
      status: "failed",
      last_completed_at: new Date().toISOString(),
      error: error.message
    };
    collectionRunProcess = null;
  });
  collectionRunProcess.on("exit", (code) => {
    collectionRunStatus = {
      ...collectionRunStatus,
      running: false,
      status: code === 0 ? "success" : "failed",
      last_completed_at: new Date().toISOString(),
      exit_code: code
    };
    collectionRunProcess = null;
  });

  return { ok: true, run: collectionRunStatus };
}

function ensureCollectionQueueResume({ runId = "", reason = "auto" } = {}) {
  if (collectionRunProcess) {
    return { ok: false, skipped: true, reason: "runner_busy", run: collectionRunStatus };
  }
  const overview = readCollectionQueueOverview({
    databaseFile,
    runId,
    limit: 1,
    pageSize: 1
  });
  const currentRun = overview.currentRun;
  if (!currentRun?.runId) {
    return { ok: false, skipped: true, reason: "no_current_run" };
  }
  const shouldResume = Number(currentRun.dueJobs || 0) > 0 || Number(currentRun.running || 0) > 0;
  if (!shouldResume) {
    return { ok: false, skipped: true, reason: "no_due_jobs", currentRun };
  }
  const settings = collectionResumeSettings(currentRun);
  return startCollectionQueueResume({
    runId: currentRun.runId,
    reason,
    concurrency: settings.concurrency,
    qps: settings.qps,
    timeoutMs: settings.timeoutMs
  });
}

function scheduleCollectionQueueResume() {
  const resume = (reason) => {
    try {
      ensureCollectionQueueResume({ reason });
    } catch (error) {
      console.warn(`Collection queue resume failed: ${error.message}`);
    }
  };
  const bootTimer = setTimeout(() => resume("startup"), 1000);
  bootTimer.unref?.();
  const timer = setInterval(() => resume("interval"), 2000);
  timer.unref?.();
}

function parseTimeMs(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : 0;
}

function monitorConfigForList(settings, listType) {
  return listType === "ads" ? settings.adMonitor : settings.campaignMonitor;
}

function monitorModeForList(listType) {
  return listType === "ads" ? "ads" : "campaigns";
}

function monitorHasTargets(config = {}, listType = "campaigns") {
  if (config.enabled === false) return false;
  if (listType === "ads") {
    return Array.isArray(config.adIds) && config.adIds.length > 0;
  }
  return Boolean(config.autoActiveCampaigns)
    || (Array.isArray(config.campaignIds) && config.campaignIds.length > 0)
    || (Array.isArray(config.accountIds) && config.accountIds.length > 0);
}

function nextMonitorRunAt(config = {}, latestRun = null) {
  if (latestRun?.next_run_at) {
    return latestRun.next_run_at;
  }
  const baseMs = parseTimeMs(latestRun?.completed_at || latestRun?.started_at);
  if (!baseMs) {
    return new Date(0).toISOString();
  }
  const intervalMinutes = Math.max(1, Number(config.intervalMinutes || 60));
  return new Date(baseMs + intervalMinutes * 60 * 1000).toISOString();
}

function evaluateMonitorSchedule(now = new Date()) {
  const settings = readSamplingSettings();
  const overview = readMonitorOverview({ databaseFile, runLimit: 30 });
  const recentRuns = overview.recentRuns || [];
  const nowMs = now.getTime();
  const plans = ["campaigns", "ads"].map((listType) => {
    const config = monitorConfigForList(settings, listType) || {};
    const latestRun = recentRuns.find((run) => run.list_type === listType) || null;
    const enabled = config.enabled !== false && monitorHasTargets(config, listType);
    const nextRunAt = enabled ? nextMonitorRunAt(config, latestRun) : "";
    const due = enabled && (!nextRunAt || parseTimeMs(nextRunAt) <= nowMs);
    return {
      list_type: listType,
      mode: monitorModeForList(listType),
      enabled,
      due,
      interval_minutes: Number(config.intervalMinutes || 0),
      next_run_at: nextRunAt,
      latest_status: latestRun?.status || "",
      latest_completed_at: latestRun?.completed_at || ""
    };
  });
  const due = plans.filter((plan) => plan.due);
  const nextDueAt = plans
    .filter((plan) => plan.enabled && plan.next_run_at)
    .map((plan) => plan.next_run_at)
    .sort((a, b) => parseTimeMs(a) - parseTimeMs(b))[0] || "";
  return {
    plans,
    due,
    next_due_at: nextDueAt
  };
}

function monitorSchedulerSnapshot() {
  try {
    const schedule = evaluateMonitorSchedule();
    return {
      ...monitorSchedulerStatus,
      running: Boolean(collectionRunProcess && collectionRunStatus.trigger_source === "scheduler"),
      runner: collectionRunStatus,
      due: schedule.due,
      plans: schedule.plans,
      next_due_at: schedule.next_due_at || monitorSchedulerStatus.next_due_at
    };
  } catch (error) {
    return {
      ...monitorSchedulerStatus,
      status: "failed",
      error: error.message
    };
  }
}

function triggerDueMonitorRuns(reason = "interval") {
  const checkedAt = new Date().toISOString();
  const schedule = evaluateMonitorSchedule(new Date());
  const due = schedule.due;
  monitorSchedulerStatus = {
    ...monitorSchedulerStatus,
    enabled: true,
    last_checked_at: checkedAt,
    next_due_at: schedule.next_due_at,
    due,
    reason,
    error: ""
  };

  if (!due.length) {
    monitorSchedulerStatus = {
      ...monitorSchedulerStatus,
      running: false,
      status: "idle"
    };
    return { ok: true, skipped: true, reason: "not_due", schedule };
  }

  if (collectionRunProcess) {
    const schedulerOwnedRun = collectionRunStatus.trigger_source === "scheduler";
    monitorSchedulerStatus = {
      ...monitorSchedulerStatus,
      running: schedulerOwnedRun,
      status: schedulerOwnedRun ? "running" : "blocked",
      reason: schedulerOwnedRun ? "scheduler_running" : "runner_busy"
    };
    return { ok: false, skipped: true, reason: monitorSchedulerStatus.reason, schedule };
  }

  const mode = due.length > 1 ? "all" : due[0].mode;
  const result = startCollectionRun({
    mode,
    triggerSource: "scheduler"
  });
  monitorSchedulerStatus = {
    ...monitorSchedulerStatus,
    running: Boolean(result.ok),
    status: result.ok ? "running" : "failed",
    last_started_at: result.ok ? result.run.last_started_at : monitorSchedulerStatus.last_started_at,
    last_mode: mode,
    error: result.ok ? "" : result.message || result.error || "自动采集触发失败"
  };
  return { ...result, schedule };
}

function scheduleMonitorCollectionTriggers() {
  const tick = (reason) => {
    try {
      triggerDueMonitorRuns(reason);
    } catch (error) {
      monitorSchedulerStatus = {
        ...monitorSchedulerStatus,
        running: false,
        status: "failed",
        last_checked_at: new Date().toISOString(),
        error: error.message
      };
      console.warn(`Monitor scheduler failed: ${error.message}`);
    }
  };
  const bootTimer = setTimeout(() => tick("startup"), 5000);
  bootTimer.unref?.();
  const timer = setInterval(() => tick("interval"), monitorSchedulerIntervalMs);
  timer.unref?.();
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
  const rowDate = (row) => row.__display_date || String(row.hour_start_beijing || row.date_start_beijing || row.date_start || "").slice(0, 10);
  return {
    previousRows: rows.filter((row) => rowDate(row) < midpointText),
    currentRows: rows.filter((row) => rowDate(row) >= midpointText),
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

function combinedConditionMatched(conditionResults) {
  if (!conditionResults.length) return false;
  return conditionResults.reduce((matched, item, index) => {
    if (index === 0) return item.matched;
    return item.condition.logic === "or" ? matched || item.matched : matched && item.matched;
  }, false);
}

function combinedConditionDescription(conditionResults) {
  return conditionResults.map((item, index) => {
    const prefix = index === 0 ? "" : item.condition.logic === "or" ? "；或 " : "；且 ";
    return `${prefix}${item.description}`;
  }).join("");
}

function buildAlertMessagesForTemplate(template) {
  const allRows = readInsightRowsForAnalysis({
    databaseFile,
    level: template.targetLevel || "campaign",
    entityIds: template.targetIds || [],
    limit: 250_000,
    accountTimeZones: readRecentAccountTimeZonesCached()
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
    const matched = combinedConditionMatched(conditionResults);
    if (!matched) return [];
    const levelLabel = alertTargetLevels.find((item) => item.id === template.targetLevel)?.label || "对象";
    return [{
      id: randomUUID(),
      template_id: template.id,
      template_name: template.name,
      account_ids: listAccountIdsFromRows(group.rows),
      severity: template.severity,
      target_level: template.targetLevel || "campaign",
      target_level_label: levelLabel,
      target_id: group.id,
      target_name: group.name,
      title: `${levelLabel} ${group.name} 触发预警`,
      body: combinedConditionDescription(conditionResults),
      metrics: current,
      conditions: conditionResults.map((item) => ({
        logic: item.condition.logic || "and",
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

function feishuCardTemplate(severity) {
  if (severity === "high") return "red";
  if (severity === "medium") return "orange";
  return "blue";
}

function feishuMarkdown(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("*", "\\*")
    .replaceAll("_", "\\_")
    .replaceAll("`", "\\`");
}

function alertCardForFeishu(message) {
  const metrics = message.metrics || {};
  const createdAt = new Date(message.created_at).toLocaleString("zh-CN", { timeZone: displayTimeZone, hourCycle: "h23" });
  const metricLine = [
    `花费 ${formatMetricValue("spend", metrics.spend)}`,
    `ROAS ${formatMetricValue("roas", metrics.roas)}`,
    `购买 ${formatMetricValue("purchases", metrics.purchases)}`,
    `CTR ${formatMetricValue("ctr_all", metrics.ctr_all)}`
  ].join(" | ");

  return {
    schema: "2.0",
    config: {
      update_multi: true
    },
    header: {
      title: {
        tag: "plain_text",
        content: "FB 广告预警"
      },
      subtitle: {
        tag: "plain_text",
        content: message.template_name || ""
      },
      template: feishuCardTemplate(message.severity),
      padding: "12px 12px 12px 12px"
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 12px 12px",
      elements: [
        {
          tag: "markdown",
          content: `**${feishuMarkdown(message.title)}**\n${feishuMarkdown(message.target_level_label)}：${feishuMarkdown(message.target_name)} (${feishuMarkdown(message.target_id)})\n等级：${feishuMarkdown(message.severity)}\n时间：${feishuMarkdown(createdAt)}`
        },
        {
          tag: "hr"
        },
        {
          tag: "markdown",
          content: `**触发规则**\n${feishuMarkdown(message.body)}`
        },
        {
          tag: "markdown",
          content: `**当前指标**\n${feishuMarkdown(metricLine)}`
        }
      ]
    }
  };
}

async function postJsonWithTimeout(url, payload, timeoutMs = 10_000, maxBodyLength = 1000, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers
      },
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
    account_ids: Array.isArray(message.account_ids) ? message.account_ids : [],
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
      const url = template.feishuWebhookUrl || defaultFeishuWebhookUrl();
      const result = await postJsonWithTimeout(url, {
        msg_type: "interactive",
        card: alertCardForFeishu(message)
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
  const allTemplates = readAlertTemplates();
  const templates = allTemplates
    .filter((template) => template.enabled !== false)
    .filter((template) => !selected.size || selected.has(template.id));
  const generatedMessages = templates.flatMap(buildAlertMessagesForTemplate);
  const pushRecords = [];
  const checkedAt = new Date().toISOString();

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
  if (templates.length) {
    const checkedIds = new Set(templates.map((template) => template.id));
    writeAlertTemplates(allTemplates.map((template) => (
      checkedIds.has(template.id)
        ? { ...template, last_checked_at: checkedAt }
        : template
    )));
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

function buildAnalysisReport(request, { allowedAccountIds = null } = {}) {
  const rows = readInsightRowsForAnalysis({
    databaseFile,
    since: request.since,
    until: request.until,
    level: request.level,
    entityIds: request.entityIds,
    accountTimeZones: readRecentAccountTimeZonesCached(),
    allowedAccountIds
  });
  const reportAccountIds = listAccountIdsFromRows(rows);
  if (!reportAccountIds.length && request.entityIds?.length) {
    reportAccountIds.push(...resolveEntityAccountIds(request.level, request.entityIds, allowedAccountIds));
  }
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
    accountIds: [...new Set(reportAccountIds)],
    request: {
      ...request,
      accountIds: [...new Set(reportAccountIds)]
    },
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

  const model = deepSeekModelName();
  let result;
  try {
    result = await postJsonWithTimeout(`${deepSeekBaseUrl().replace(/\/+$/, "")}/chat/completions`, {
      model,
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
    }, 45_000, 0, {
      Authorization: `Bearer ${apiKey}`
    });
  } catch (error) {
    return {
      ...report,
      provider: "local",
      model,
      ai_status: "request_error",
      ai_message: `DeepSeek 调用异常：${error.message || "请求失败"}，已返回本地规则分析。`,
      markdown: [
        "# Agent 智能分析报告",
        "",
        `> DeepSeek 调用异常：${error.message || "请求失败"}。以下为本地规则分析结果。`,
        "",
        report.markdown
      ].join("\n")
    };
  }

  if (!result.ok) {
    return {
      ...report,
      provider: "local",
      model,
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

  let payload = {};
  try {
    payload = JSON.parse(result.body || "{}");
  } catch {
    return {
      ...report,
      provider: "local",
      model,
      ai_status: "invalid_response",
      ai_message: "DeepSeek 返回格式异常，已返回本地规则分析。",
      markdown: [
        "# Agent 智能分析报告",
        "",
        "> DeepSeek 返回格式异常。以下为本地规则分析结果。",
        "",
        report.markdown
      ].join("\n")
    };
  }
  const content = payload.choices?.[0]?.message?.content || "";
  if (!content.trim()) {
    return {
      ...report,
      provider: "local",
      model,
      ai_status: "empty_response",
      ai_message: "DeepSeek 返回内容为空，已返回本地规则分析。"
    };
  }

  return {
    ...report,
    provider: "deepseek",
    model: payload.model || model,
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

    const localReport = buildAnalysisReport(request, {
      allowedAccountIds: allowedAccountIdsForRequest(req)
    });
    writeSse(res, "stage", { key: "diagnose", label: "生成诊断与行动项" });
    const report = await callDeepSeekAnalysis(localReport);
    writeAnalysisReports([report, ...readAnalysisReports()]);
    audit(req, "reports.generate", {
      targetType: "analysis_report",
      targetId: report.id,
      metadata: {
        level: request.level,
        entityCount: request.entityIds.length,
        accountCount: report.accountIds?.length || 0,
        provider: report.provider,
        rowsAnalyzed: report.rowsAnalyzed
      }
    });
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

function filterRowsByAllowedAccountIds(rows = [], allowedAccountIds = null) {
  if (allowedAccountIds === null || allowedAccountIds === undefined) return rows;
  const allowed = new Set(allowedAccountIds.map((id) => String(id)));
  if (!allowed.size) return [];
  return rows.filter((row) => allowed.has(String(row.account_id || row.accountId || "")));
}

function emptyLatestAdsPayload({ dashboardShape = false, source = "scope:empty" } = {}) {
  return {
    ok: true,
    shape: dashboardShape ? "dashboard_columns" : "raw",
    columns: dashboardShape ? dashboardInsightColumns : undefined,
    source,
    storage: "sqlite",
    batch: null,
    updated_at: "",
    display_time_zone: displayTimeZone,
    metadata: {
      time_zone_enriched_fields: 0,
      granularity: "day"
    },
    rows: []
  };
}

function sendLatestAdsData(res, { dashboardShape = false, allowedAccountIds = null } = {}) {
  if (Array.isArray(allowedAccountIds) && allowedAccountIds.length === 0) {
    writeJson(res, 200, emptyLatestAdsPayload({ dashboardShape }));
    return;
  }
  const accountTimeZones = readRecentAccountTimeZonesCached();
  try {
    const latestFromDb = readLatestInsightData({ databaseFile, accountTimeZones, allowedAccountIds });
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
    if (Array.isArray(allowedAccountIds)) {
      writeJson(res, 200, emptyLatestAdsPayload({ dashboardShape, source: "scope:no_collected_data" }));
      return;
    }
    writeJson(res, 404, { ok: false, error: "no_collected_data" });
    return;
  }

  try {
    const enriched = enrichInsightRowsWithTimeZone(latest.rows, accountTimeZones);
    const scopedRows = filterRowsByAllowedAccountIds(enriched.rows, allowedAccountIds);
    const rows = dashboardShape ? toDashboardInsightValueRows(scopedRows) : scopedRows;
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
        granularity: scopedRows.some((row) => row.hour_start || row.hour_start_beijing) ? "hour" : "day"
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
        .filter((template) => recordVisibleToRequest(req, template))
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
          const template = withAlertTemplateAccountIds(normalizeAlertTemplate(payload));
          writeAlertTemplates([...templates, template]);
          audit(req, "alerts.templates.create", {
            targetType: "alert_template",
            targetId: template.id,
            metadata: { name: template.name, accountCount: template.account_ids.length }
          });
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
      if (!recordVisibleToRequest(req, template)) {
        throw makeValidationError("无权访问该预警模板", {}, 403);
      }
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
          const template = withAlertTemplateAccountIds(normalizeAlertTemplate(payload, templates[index]));
          const nextTemplates = [...templates];
          nextTemplates[index] = template;
          writeAlertTemplates(nextTemplates);
          audit(req, "alerts.templates.update", {
            targetType: "alert_template",
            targetId: template.id,
            metadata: { name: template.name, accountCount: template.account_ids.length }
          });
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
          audit(req, "alerts.templates.status", {
            targetType: "alert_template",
            targetId: templateId,
            metadata: { enabled: payload.enabled === true }
          });
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
      audit(req, "alerts.templates.copy", {
        targetType: "alert_template",
        targetId: template.id,
        metadata: { sourceId: source.id, name: template.name }
      });
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
      audit(req, "alerts.templates.delete", {
        targetType: "alert_template",
        targetId: templateId
      });
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
      limit,
      allowedAccountIds: allowedAccountIdsForRequest(req)
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
    const messages = readAlertMessages().filter((message) => recordVisibleToRequest(req, message));
    writeJson(res, 200, {
      ok: true,
      messages: messages.slice(0, Number(url.searchParams.get("limit") || 80))
    });
    return true;
  }

  if (url.pathname === "/api/alert-ai/alerts/push-records" && req.method === "GET") {
    const records = readAlertPushRecords().filter((record) => recordVisibleToRequest(req, record));
    writeJson(res, 200, {
      ok: true,
      records: records.slice(0, Number(url.searchParams.get("limit") || 80))
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
    audit(req, "alerts.evaluate", {
      targetType: "alert_templates",
      metadata: { requestedAt: new Date().toISOString() }
    });
    return true;
  }

  return false;
}

function handleAlertReportRoutes(req, res, url) {
  if (url.pathname !== "/api/alert-ai/reports/stream" || req.method !== "POST") {
    if (url.pathname === "/api/alert-ai/reports" && req.method === "GET") {
      const reports = readAnalysisReports().filter((report) => reportVisibleToRequest(req, report));
      writeJson(res, 200, {
        ok: true,
        reports: reports.slice(0, Number(url.searchParams.get("limit") || 40))
      });
      return true;
    }
    return false;
  }

  readRequestBody(req)
    .then((body) => {
      const payload = JSON.parse(body || "{}");
      const reportRequest = normalizeReportRequest(payload);
      assertEntityScopeForRequest(req, reportRequest);
      return streamReportGeneration(req, res, reportRequest);
    })
    .catch((error) => writeApiError(res, error, "start_report_generation_failed"));
  return true;
}

function apiPolicyFor(method, pathname) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  const policies = [
    { method: "GET", pattern: /^\/api\/fb-ads\/latest$/, permission: "dashboard.read" },
    { method: "GET", pattern: /^\/api\/monitor\/status$/, permission: "collection.read" },
    { method: "GET", pattern: /^\/api\/collection\/queue\/status$/, permission: "collection.read" },
    { method: "POST", pattern: /^\/api\/collection\/queue\/preview$/, permission: "collection.run" },
    { method: "POST", pattern: /^\/api\/collection\/queue\/run$/, permission: "collection.run" },
    { method: "POST", pattern: /^\/api\/collection\/queue\/recover$/, permission: "collection.recover" },
    { method: "DELETE", pattern: /^\/api\/collection\/queue\/runs\/[^/]+$/, permission: "collection.delete" },
    { method: "GET", pattern: /^\/api\/settings\/environment$/, permission: "env.read" },
    { method: "POST", pattern: /^\/api\/settings\/environment$/, permission: "env.write" },
    { method: "GET", pattern: /^\/api\/settings\/accounts$/, permission: "settings.read" },
    { method: "POST", pattern: /^\/api\/settings\/accounts$/, permission: "settings.write" },
    { method: "GET", pattern: /^\/api\/settings\/sampling$/, permission: "settings.read" },
    { method: "POST", pattern: /^\/api\/settings\/sampling$/, permission: "settings.write" },
    { method: "GET", pattern: /^\/api\/settings\/resources$/, permission: "settings.read" },
    { method: "POST", pattern: /^\/api\/settings\/resources\/refresh$/, permission: "resources.refresh" },
    { method: "GET", pattern: /^\/api\/alert-ai\/metadata$/, permission: "alerts.read" },
    { method: "GET", pattern: /^\/api\/alert-ai\/entities$/, permission: "reports.generate" },
    { method: "GET", pattern: /^\/api\/alert-ai\/templates(?:\/[^/]+)?$/, permission: "alerts.read" },
    { method: "POST", pattern: /^\/api\/alert-ai\/templates(?:\/[^/]+\/copy)?$/, permission: "alerts.manage" },
    { method: "PUT", pattern: /^\/api\/alert-ai\/templates\/[^/]+$/, permission: "alerts.manage" },
    { method: "PATCH", pattern: /^\/api\/alert-ai\/templates\/[^/]+\/status$/, permission: "alerts.manage" },
    { method: "DELETE", pattern: /^\/api\/alert-ai\/templates\/[^/]+$/, permission: "alerts.manage" },
    { method: "GET", pattern: /^\/api\/alert-ai\/alerts\/messages$/, permission: "alerts.read" },
    { method: "GET", pattern: /^\/api\/alert-ai\/alerts\/push-records$/, permission: "alerts.read" },
    { method: "POST", pattern: /^\/api\/alert-ai\/alerts\/evaluate$/, permission: "alerts.manage" },
    { method: "GET", pattern: /^\/api\/alert-ai\/reports$/, permission: "reports.read" },
    { method: "POST", pattern: /^\/api\/alert-ai\/reports\/stream$/, permission: "reports.generate" },
    { method: "GET", pattern: /^\/api\/admin\/pin\/status$/, permission: "users.manage" },
    { method: "POST", pattern: /^\/api\/admin\/pin\/verify$/, permission: "users.manage" },
    { method: "POST", pattern: /^\/api\/admin\/pin\/clear$/, permission: "users.manage" },
    { method: "GET", pattern: /^\/api\/admin\/users$/, permission: "users.manage" },
    { method: "POST", pattern: /^\/api\/admin\/users$/, permission: "users.manage" },
    { method: "PUT", pattern: /^\/api\/admin\/users\/[^/]+$/, permission: "users.manage" },
    { method: "POST", pattern: /^\/api\/admin\/users\/[^/]+\/password$/, permission: "users.manage" },
    { method: "GET", pattern: /^\/api\/admin\/audit-events$/, permission: "audit.read" }
  ];
  return policies.find((policy) => policy.method === normalizedMethod && policy.pattern.test(pathname)) || null;
}

const adminPinProtectedPermissions = new Set([
  "env.read",
  "env.write",
  "settings.read",
  "settings.write",
  "resources.refresh",
  "collection.read",
  "collection.run",
  "collection.recover",
  "collection.delete",
  "users.manage",
  "audit.read",
  "alerts.manage"
]);

function routeRequiresAdminPin(pathname, policy) {
  if (/^\/api\/admin\/pin\//.test(pathname)) return false;
  return adminPinProtectedPermissions.has(policy?.permission);
}

function isAdminRequest(req) {
  return req.auth?.user?.role === "admin";
}

function allowedAccountIdsForRequest(req) {
  return isAdminRequest(req) ? null : req.auth?.allowedAccountIds || [];
}

function listAccountIdsFromRows(rows = []) {
  return [...new Set(rows.map((row) => String(row.account_id || row.accountId || "").trim()).filter(Boolean))];
}

function reportVisibleToRequest(req, report) {
  if (isAdminRequest(req)) return true;
  const allowed = new Set(allowedAccountIdsForRequest(req));
  if (!allowed.size) return false;
  const accountIds = Array.isArray(report.accountIds)
    ? report.accountIds
    : Array.isArray(report.request?.accountIds) ? report.request.accountIds : [];
  return accountIds.some((accountId) => allowed.has(String(accountId)));
}

function recordVisibleToRequest(req, record) {
  if (isAdminRequest(req)) return true;
  const allowed = new Set(allowedAccountIdsForRequest(req));
  if (!allowed.size) return false;
  const accountIds = Array.isArray(record.account_ids)
    ? record.account_ids
    : Array.isArray(record.accountIds) ? record.accountIds : [];
  return accountIds.some((accountId) => allowed.has(String(accountId)));
}

function resolveEntityAccountIds(level, entityIds, allowedAccountIds = null) {
  const accountIdsByEntity = readAccountIdsForAnalysisEntities({
    databaseFile,
    level,
    entityIds,
    allowedAccountIds
  });
  return [...new Set([...accountIdsByEntity.values()].flatMap((ids) => [...ids]))];
}

function assertEntityScopeForRequest(req, request) {
  if (isAdminRequest(req)) return;
  const ids = Array.isArray(request.entityIds) ? request.entityIds : [];
  if (!ids.length) return;
  const accountIdsByEntity = readAccountIdsForAnalysisEntities({
    databaseFile,
    level: request.level,
    entityIds: ids,
    allowedAccountIds: allowedAccountIdsForRequest(req)
  });
  const denied = ids.filter((id) => !accountIdsByEntity.get(String(id))?.size);
  if (denied.length) {
    const error = new Error("当前账号无权分析所选对象");
    error.statusCode = 403;
    error.code = "entity_scope_denied";
    throw error;
  }
}

function normalizeAdminUserPayload(payload = {}) {
  return {
    username: String(payload.username || "").trim(),
    password: String(payload.password || ""),
    displayName: String(payload.displayName || payload.display_name || "").trim(),
    role: payload.role === "admin" ? "admin" : "user",
    status: payload.status === "disabled" ? "disabled" : "active",
    accountIds: normalizeAccountIds(payload.accountIds || payload.account_ids || [])
  };
}

function handleAdminRoutes(req, res, url) {
  if (url.pathname === "/api/admin/users" && req.method === "GET") {
    writeJson(res, 200, {
      ok: true,
      users: listUsers()
    });
    return true;
  }

  if (url.pathname === "/api/admin/users" && req.method === "POST") {
    readRequestBody(req)
      .then((body) => {
        const payload = normalizeAdminUserPayload(JSON.parse(body || "{}"));
        const user = createUser(payload);
        audit(req, "users.create", {
          targetType: "user",
          targetId: user.id,
          metadata: {
            username: user.username,
            role: user.role,
            status: user.status,
            accountCount: user.accountIds.length
          }
        });
        writeJson(res, 201, {
          ok: true,
          user
        });
      })
      .catch((error) => writeApiError(res, error, "create_user_failed"));
    return true;
  }

  const userMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (userMatch && req.method === "PUT") {
    readRequestBody(req)
      .then((body) => {
        const payload = normalizeAdminUserPayload(JSON.parse(body || "{}"));
        const user = updateUser(decodeURIComponent(userMatch[1]), {
          displayName: payload.displayName,
          role: payload.role,
          status: payload.status,
          accountIds: payload.accountIds
        });
        audit(req, "users.update", {
          targetType: "user",
          targetId: user.id,
          metadata: {
            username: user.username,
            role: user.role,
            status: user.status,
            accountCount: user.accountIds.length
          }
        });
        writeJson(res, 200, {
          ok: true,
          user
        });
      })
      .catch((error) => writeApiError(res, error, "update_user_failed"));
    return true;
  }

  const passwordMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/password$/);
  if (passwordMatch && req.method === "POST") {
    readRequestBody(req)
      .then((body) => {
        const payload = JSON.parse(body || "{}");
        const user = resetUserPassword(decodeURIComponent(passwordMatch[1]), String(payload.password || ""));
        audit(req, "users.reset_password", {
          targetType: "user",
          targetId: user.id,
          metadata: {
            username: user.username
          }
        });
        writeJson(res, 200, {
          ok: true,
          user
        });
      })
      .catch((error) => writeApiError(res, error, "reset_user_password_failed"));
    return true;
  }

  if (url.pathname === "/api/admin/audit-events" && req.method === "GET") {
    const limit = clampInteger(url.searchParams.get("limit"), 100, 1, 500);
    const offset = clampInteger(url.searchParams.get("offset"), 0, 0, 100_000);
    writeJson(res, 200, {
      ok: true,
      events: listAuditEvents({ limit, offset })
    });
    return true;
  }

  return false;
}

function handleAdminPinRoutes(req, res, url) {
  if (url.pathname === "/api/admin/pin/status" && req.method === "GET") {
    req.cookies = req.cookies || parseCookies(req);
    writeJson(res, 200, {
      ok: true,
      configured: pinConfigured(),
      verified: adminPinVerified(req, req.auth),
      ttlMs: pinTtlMs()
    });
    return true;
  }

  if (url.pathname === "/api/admin/pin/verify" && req.method === "POST") {
    readRequestBody(req)
      .then((body) => {
        if (!pinConfigured()) {
          writeJson(res, 503, {
            ok: false,
            error: "admin_pin_not_configured",
            message: "管理员 PIN 未配置"
          });
          return;
        }
        const payload = JSON.parse(body || "{}");
        const accepted = verifyPin(payload.pin);
        audit(req, accepted ? "admin.pin.verify_success" : "admin.pin.verify_failed", {
          targetType: "admin_pin",
          metadata: { accepted }
        });
        if (!accepted) {
          writeJson(res, 403, {
            ok: false,
            error: "admin_pin_invalid",
            message: "PIN 不正确"
          });
          return;
        }
        setAdminPinCookie(req, res, req.auth.user.id);
        writeJson(res, 200, {
          ok: true,
          verified: true,
          ttlMs: pinTtlMs()
        });
      })
      .catch((error) => writeApiError(res, error, "verify_admin_pin_failed"));
    return true;
  }

  if (url.pathname === "/api/admin/pin/clear" && req.method === "POST") {
    clearAdminPinCookie(req, res);
    audit(req, "admin.pin.clear", {
      targetType: "admin_pin"
    });
    writeJson(res, 200, {
      ok: true
    });
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  res.shouldGzip = /\bgzip\b/i.test(String(req.headers["accept-encoding"] || ""));

  if (url.pathname === "/api/health") {
    writeJson(res, 200, {
      ok: true,
      module: "fb-ads-dashboard",
      time: new Date().toISOString()
    });
    return;
  }

  if (await handleAuthRoutes(req, res, url, writeJson)) {
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    const policy = apiPolicyFor(req.method, url.pathname);
    if (!policy) {
      writeJson(res, 403, {
        ok: false,
        error: "api_route_forbidden",
        message: "该接口未开放"
      });
      return;
    }
    if (!applyApiPolicy(req, res, policy, writeJson)) {
      return;
    }
    req.cookies = parseCookies(req);
    if (routeRequiresAdminPin(url.pathname, policy) && !adminPinVerified(req, req.auth)) {
      writeJson(res, 403, {
        ok: false,
        error: pinConfigured() ? "admin_pin_required" : "admin_pin_not_configured",
        message: pinConfigured() ? "需要先完成管理员 PIN 校验" : "管理员 PIN 未配置"
      });
      return;
    }
  }

  if (handleAdminPinRoutes(req, res, url)) {
    return;
  }

  if (handleAdminRoutes(req, res, url)) {
    return;
  }

  if (url.pathname === "/api/fb-ads/latest") {
    sendLatestAdsData(res, {
      dashboardShape: url.searchParams.get("shape") === "dashboard",
      allowedAccountIds: allowedAccountIdsForRequest(req)
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
      const status = readMonitorOverview({ databaseFile });
      writeJson(res, 200, {
        ok: true,
        status: {
          ...status,
          scheduler: monitorSchedulerSnapshot()
        }
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

  const collectionRunMatch = url.pathname.match(/^\/api\/collection\/queue\/runs\/([^/]+)$/);
  if (collectionRunMatch && req.method === "DELETE") {
    try {
      const runId = decodeURIComponent(collectionRunMatch[1] || "");
      const result = deleteCollectionRun({ databaseFile, runId });
      audit(req, "collection.run.delete", {
        targetType: "collection_run",
        targetId: runId,
        metadata: result.deleted || {}
      });
      writeJson(res, 200, {
        ok: true,
        ...result
      });
    } catch (error) {
      writeApiError(res, error, "delete_collection_run_failed");
    }
    return;
  }

  if (url.pathname === "/api/collection/queue/recover" && req.method === "POST") {
    readRequestBody(req)
      .then((body) => {
        const payload = body ? JSON.parse(body) : {};
        const runId = String(payload.run_id || payload.runId || "").trim();
        const staleAfterMs = clampInteger(payload.stale_after_ms || payload.staleAfterMs, collectionQueueWatchdogMs, 60_000, 30 * 60_000);
        const watchdog = recoverStaleCollectionJobs({
          databaseFile,
          runId,
          staleAfterMs,
          dryRun: Boolean(payload.dry_run || payload.dryRun)
        });
        audit(req, "collection.queue.recover", {
          targetType: "collection_run",
          targetId: runId,
          metadata: {
            dryRun: Boolean(payload.dry_run || payload.dryRun),
            scanned: watchdog.scanned,
            completedFromSuccess: watchdog.completedFromSuccess,
            retried: watchdog.retried
          }
        });
        writeJson(res, watchdog.error ? 500 : 200, {
          ok: !watchdog.error,
          watchdog,
          queue: readCollectionQueueOverview({
            databaseFile,
            runId,
            limit: 50,
            page: 1,
            pageSize: 50
          }),
          runner: collectionRunStatus,
          display_time_zone: displayTimeZone
        });
      })
      .catch((error) => {
        writeJson(res, error.message === "request_body_too_large" ? 413 : 400, {
          ok: false,
          error: "recover_collection_queue_failed",
          message: error.message
        });
      });
    return;
  }

  if (url.pathname === "/api/collection/queue/status" && req.method === "GET") {
    try {
      const pageSize = clampInteger(url.searchParams.get("page_size"), 50, 1, 100);
      const page = clampInteger(url.searchParams.get("page"), 1, 1, 100000);
      const runId = String(url.searchParams.get("run_id") || "").trim();
      const watchdog = recoverStaleCollectionJobs({
        databaseFile,
        runId,
        staleAfterMs: collectionQueueWatchdogMs
      });
      const resume = ensureCollectionQueueResume({ runId, reason: "status" });
      writeJson(res, 200, {
        ok: true,
        queue: readCollectionQueueOverview({
          databaseFile,
          runId,
          limit: pageSize,
          offset: (page - 1) * pageSize,
          page,
          pageSize
        }),
        runner: collectionRunStatus,
        watchdog,
        resume,
        display_time_zone: displayTimeZone
      });
    } catch (error) {
      writeJson(res, 500, {
        ok: false,
        error: "read_collection_queue_failed",
        message: error.message
      });
    }
    return;
  }

  if (url.pathname === "/api/collection/queue/preview" && req.method === "POST") {
    readRequestBody(req)
      .then((body) => {
        const payload = JSON.parse(body || "{}");
        return buildCollectionRunPreview({ mode: payload.mode });
      })
      .then((preview) => {
        writeJson(res, 200, {
          ok: true,
          preview
        });
      })
      .catch((error) => {
        writeJson(res, error.message === "request_body_too_large" ? 413 : 400, {
          ok: false,
          error: "preview_collection_queue_failed",
          message: error.message
        });
      });
    return;
  }

  if (url.pathname === "/api/collection/queue/run" && req.method === "POST") {
    readRequestBody(req)
      .then((body) => {
        const payload = JSON.parse(body || "{}");
        const result = startCollectionRun({
          mode: payload.mode,
          triggerSource: "manual"
        });
        audit(req, "collection.run.start", {
          targetType: "collection_run",
          targetId: result.run?.run_id || "",
          metadata: {
            mode: payload.mode || "all",
            accepted: Boolean(result.ok)
          }
        });
        writeJson(res, result.statusCode || (result.ok ? 202 : 409), result);
      })
      .catch((error) => {
        writeJson(res, error.message === "request_body_too_large" ? 413 : 400, {
          ok: false,
          error: "start_collection_queue_failed",
          message: error.message
        });
      });
    return;
  }

  if (url.pathname === "/api/settings/environment" && req.method === "GET") {
    try {
      writeJson(res, 200, {
        ok: true,
        environment: buildEnvironmentSettings()
      });
    } catch (error) {
      writeJson(res, 500, {
        ok: false,
        error: "read_environment_settings_failed",
        message: error.message
      });
    }
    return;
  }

  if (url.pathname === "/api/settings/environment" && req.method === "POST") {
    readRequestBody(req)
      .then((body) => {
        const payload = body ? JSON.parse(body) : {};
        const entries = normalizeEnvironmentPostEntries(payload);
        writeCliEnv(entries);
        audit(req, "settings.environment.update", {
          targetType: "environment",
          metadata: {
            keys: entries.map((entry) => entry.key),
            configuredCount: entries.filter((entry) => String(entry.value || "").trim() !== "").length
          }
        });
        writeJson(res, 200, {
          ok: true,
          environment: buildEnvironmentSettings()
        });
      })
      .catch((error) => writeApiError(res, error, "update_environment_settings_failed"));
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
        audit(req, "settings.accounts.update", {
          targetType: "settings",
          targetId: "accounts",
          metadata: { accountCount: accounts.length }
        });
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
        audit(req, "settings.sampling.update", {
          targetType: "settings",
          targetId: "sampling",
          metadata: {
            campaignIds: settings.campaignMonitor?.campaignIds?.length || 0,
            adIds: settings.adMonitor?.adIds?.length || 0
          }
        });
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
        audit(req, "settings.resources.refresh", {
          targetType: "account",
          targetId: accountId,
          metadata: {
            ok: Boolean(result.ok),
            skipped: Boolean(result.skipped)
          }
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

  const publicPath = resolvePublicPath(url.pathname);
  if (!publicPath.filePath) {
    const isMalformed = publicPath.error === "malformed_uri";
    writeJson(res, isMalformed ? 400 : 403, {
      ok: false,
      error: publicPath.error || "forbidden"
    });
    return;
  }

  sendFile(res, publicPath.filePath);
});

server.listen(port, host, () => {
  console.log(`FB Ads Dashboard running at http://${host}:${port}/`);
  console.log(`Health check: http://${host}:${port}/api/health`);
});

scheduleActiveResourceRefresh();
scheduleCollectionQueueResume();
scheduleMonitorCollectionTriggers();
