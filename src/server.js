const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { readLatestInsightData, readMonitorOverview } = require("./database");

const port = Number(process.env.PORT || 3100);
const host = process.env.HOST || "127.0.0.1";
const publicDir = path.resolve(__dirname, "..", "public");
const repoRoot = path.resolve(__dirname, "..");
const databaseFile = path.join(repoRoot, "cli", "data", "fb-ads.sqlite");
const cliOutputDir = path.join(repoRoot, "cli", "data", "output");
const monitoredAccountsFile = path.join(repoRoot, "cli", "config", "monitored-accounts.json");
const samplingSettingsFile = path.join(repoRoot, "cli", "config", "sampling-plans.json");
const displayTimeZone = "Asia/Shanghai";

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

function writeJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function sendFile(res, filePath) {
  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      writeJson(res, 404, { ok: false, error: "not_found" });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 64) {
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
      datePreset: String(targetedInput.datePreset || "today").trim() || "today",
      resultAction: String(targetedInput.resultAction || "").trim(),
      hourly: targetedInput.hourly !== false
    },
    activeCampaigns: {
      enabled: activeInput.enabled !== false,
      intervalMinutes: clampInteger(activeInput.intervalMinutes, 60, 30, 180),
      datePreset: String(activeInput.datePreset || "today").trim() || "today",
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

function sendLatestAdsData(res) {
  try {
    const latestFromDb = readLatestInsightData({ databaseFile });
    if (latestFromDb?.rows?.length) {
      writeJson(res, 200, {
        ok: true,
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
        rows: latestFromDb.rows
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
    writeJson(res, 200, {
      ok: true,
      source: latest.file,
      updated_at: new Date(latest.mtimeMs).toISOString(),
      display_time_zone: displayTimeZone,
      rows: latest.rows
    });
  } catch (readError) {
    writeJson(res, 500, {
      ok: false,
      error: "read_failed",
      message: readError.message
    });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

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
    sendLatestAdsData(res);
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

  if (url.pathname === "/vendor/echarts.min.js") {
    sendFile(res, path.join(repoRoot, "node_modules", "echarts", "dist", "echarts.min.js"));
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
