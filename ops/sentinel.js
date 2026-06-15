const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const envSources = new Map();
const envFiles = [
  { filePath: path.join(repoRoot, ".env"), label: ".env" },
  { filePath: path.join(repoRoot, "cli", ".env"), label: "cli/.env" }
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
    if (key) entries.set(key, value);
  });
  return entries;
}

function loadEnvFile(filePath, sourceLabel) {
  parseEnvFile(filePath).forEach((value, key) => {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      envSources.set(key, sourceLabel);
    }
  });
}

envFiles.forEach((file) => loadEnvFile(file.filePath, file.label));

function readIntegerEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function readUrlEnv(name, fallback) {
  const value = String(process.env[name] || "").trim();
  if (!value) return fallback;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : fallback;
  } catch {
    return fallback;
  }
}

function getBeijingDayKey(date = new Date()) {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isoNow() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

const parsedPort = readIntegerEnv("PORT", 3100, 1, 65535);
const config = {
  serviceName: process.env.SENTINEL_SERVICE_NAME || "fb-ads-dashboard",
  nodePath: process.execPath,
  repoRoot,
  serverScript: path.join(repoRoot, "src", "server.js"),
  serverArgs: ["--disable-warning=ExperimentalWarning", path.join(repoRoot, "src", "server.js")],
  host: process.env.HOST || "127.0.0.1",
  port: parsedPort,
  healthUrl: readUrlEnv("SENTINEL_HEALTH_URL", `http://127.0.0.1:${parsedPort}/api/health`),
  maxDailyRestarts: readIntegerEnv("SENTINEL_MAX_DAILY_RESTARTS", 3, 1, 24),
  backoffInitialMs: readIntegerEnv("SENTINEL_BACKOFF_INITIAL_MS", 5000, 1000, 60 * 60 * 1000),
  backoffMaxMs: readIntegerEnv("SENTINEL_BACKOFF_MAX_MS", 5 * 60 * 1000, 1000, 60 * 60 * 1000),
  healthIntervalMs: readIntegerEnv("SENTINEL_HEALTH_INTERVAL_MS", 30000, 5000, 10 * 60 * 1000),
  healthTimeoutMs: readIntegerEnv("SENTINEL_HEALTH_TIMEOUT_MS", 5000, 1000, 60 * 1000),
  healthGraceMs: readIntegerEnv("SENTINEL_HEALTH_GRACE_MS", 15000, 0, 10 * 60 * 1000),
  healthFailuresBeforeRestart: readIntegerEnv("SENTINEL_HEALTH_FAILURES_BEFORE_RESTART", 3, 1, 20),
  stableResetMs: readIntegerEnv("SENTINEL_STABLE_RESET_MS", 10 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000),
  webhookUrl: readUrlEnv("SENTINEL_WEBHOOK_URL", readUrlEnv("FEISHU_ALERT_WEBHOOK_URL", "")),
  stateFile: path.join(repoRoot, "data", "sentinel", "state.json"),
  pidFile: path.join(repoRoot, "data", "sentinel", "sentinel.pid"),
  sentinelLogFile: path.join(repoRoot, "logs", "sentinel.log"),
  childOutLogFile: path.join(repoRoot, "logs", "server-sentinel.out.log"),
  childErrLogFile: path.join(repoRoot, "logs", "server-sentinel.err.log")
};

ensureDir(path.dirname(config.stateFile));
ensureDir(path.dirname(config.sentinelLogFile));

function log(level, message, fields = {}) {
  const suffix = Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : "";
  const line = `${isoNow()} ${level.toUpperCase()} ${message}${suffix}`;
  fs.appendFileSync(config.sentinelLogFile, `${line}\n`);
  console.log(line);
}

function readState() {
  try {
    if (!fs.existsSync(config.stateFile)) {
      return createFreshState();
    }
    const parsed = JSON.parse(fs.readFileSync(config.stateFile, "utf8"));
    return normalizeState(parsed);
  } catch (error) {
    log("warn", "failed to read sentinel state, starting with empty state", { error: error.message });
    return createFreshState();
  }
}

function createFreshState() {
  return normalizeState({
    dayKey: getBeijingDayKey(),
    restartCount: 0,
    failureStreak: 0,
    limitReportSent: false,
    lastStartedAt: "",
    lastExit: null,
    lastHealth: null,
    crashes: []
  });
}

function normalizeState(input) {
  const dayKey = getBeijingDayKey();
  const state = {
    dayKey: input && typeof input.dayKey === "string" ? input.dayKey : dayKey,
    restartCount: Number.isFinite(Number(input?.restartCount)) ? Math.max(0, Number(input.restartCount)) : 0,
    failureStreak: Number.isFinite(Number(input?.failureStreak)) ? Math.max(0, Number(input.failureStreak)) : 0,
    limitReportSent: Boolean(input?.limitReportSent),
    lastStartedAt: typeof input?.lastStartedAt === "string" ? input.lastStartedAt : "",
    lastExit: input?.lastExit && typeof input.lastExit === "object" ? input.lastExit : null,
    lastHealth: input?.lastHealth && typeof input.lastHealth === "object" ? input.lastHealth : null,
    crashes: Array.isArray(input?.crashes) ? input.crashes.slice(-20) : []
  };
  if (state.dayKey !== dayKey) {
    state.dayKey = dayKey;
    state.restartCount = 0;
    state.failureStreak = 0;
    state.limitReportSent = false;
    state.crashes = [];
  }
  return state;
}

function saveState() {
  writeJsonAtomic(config.stateFile, state);
}

let state = readState();
let child = null;
let childStartedAt = 0;
let healthTimer = null;
let restartTimer = null;
let dayResetTimer = null;
let stopping = false;
let forcedRestartReason = "";
let consecutiveHealthFailures = 0;

function sanitizedConfig() {
  return {
    serviceName: config.serviceName,
    nodePath: config.nodePath,
    repoRoot: config.repoRoot,
    serverScript: config.serverScript,
    healthUrl: config.healthUrl,
    maxDailyRestarts: config.maxDailyRestarts,
    backoffInitialMs: config.backoffInitialMs,
    backoffMaxMs: config.backoffMaxMs,
    healthIntervalMs: config.healthIntervalMs,
    healthTimeoutMs: config.healthTimeoutMs,
    healthGraceMs: config.healthGraceMs,
    healthFailuresBeforeRestart: config.healthFailuresBeforeRestart,
    stableResetMs: config.stableResetMs,
    webhookConfigured: Boolean(config.webhookUrl),
    webhookSource: config.webhookUrl ? envSources.get("SENTINEL_WEBHOOK_URL") || envSources.get("FEISHU_ALERT_WEBHOOK_URL") || "process.env" : "",
    stateFile: config.stateFile,
    sentinelLogFile: config.sentinelLogFile,
    childOutLogFile: config.childOutLogFile,
    childErrLogFile: config.childErrLogFile
  };
}

if (process.argv.includes("--check-config")) {
  console.log(JSON.stringify(sanitizedConfig(), null, 2));
  process.exit(0);
}

function writePidFile() {
  writeJsonAtomic(config.pidFile, {
    pid: process.pid,
    startedAt: isoNow(),
    serviceName: config.serviceName
  });
}

function clearPidFile() {
  try {
    if (fs.existsSync(config.pidFile)) fs.unlinkSync(config.pidFile);
  } catch {
    // Best effort only.
  }
}

function nextBackoffDelay() {
  const exponent = Math.max(0, state.failureStreak - 1);
  return Math.min(config.backoffMaxMs, config.backoffInitialMs * 2 ** exponent);
}

function buildLimitReport(trigger, detail = {}) {
  const recent = state.crashes.slice(-5).map((item, index) => {
    const code = item.code === null || item.code === undefined ? "-" : item.code;
    const signal = item.signal || "-";
    const uptime = item.uptimeMs === null || item.uptimeMs === undefined ? "-" : `${Math.round(item.uptimeMs / 1000)}s`;
    return `${index + 1}. ${item.at} reason=${item.reason} code=${code} signal=${signal} uptime=${uptime}`;
  });
  return [
    "FB 广告看板哨兵报告",
    `状态：当日崩溃重启已达到 ${config.maxDailyRestarts} 次`,
    `服务：${config.serviceName}`,
    `日期：${state.dayKey} (Asia/Shanghai)`,
    `健康检查：${config.healthUrl}`,
    `触发原因：${trigger}`,
    detail.message ? `详情：${detail.message}` : "",
    `最近启动：${state.lastStartedAt || "-"}`,
    `最近退出：${state.lastExit?.at || "-"}`,
    "最近失败：",
    recent.length ? recent.join("\n") : "-",
    "",
    "哨兵已停止继续重启该服务，等待下一天重置重启额度。"
  ].filter(Boolean).join("\n");
}

async function postLimitReport(trigger, detail = {}) {
  if (state.limitReportSent) return;
  const text = buildLimitReport(trigger, detail);
  state.limitReportSent = true;
  saveState();

  if (!config.webhookUrl) {
    log("warn", "daily restart limit reached but webhook is not configured", { trigger });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        msg_type: "text",
        content: { text }
      }),
      signal: controller.signal
    });
    const body = await response.text().catch(() => "");
    if (!response.ok) {
      throw new Error(`webhook http ${response.status}: ${body.slice(0, 300)}`);
    }
    log("info", "sent daily restart limit report", { status: response.status });
  } catch (error) {
    state.limitReportSent = false;
    saveState();
    log("error", "failed to send daily restart limit report", { error: error.message });
  } finally {
    clearTimeout(timer);
  }
}

function pipeChildLogs(childProcess) {
  const stdout = fs.createWriteStream(config.childOutLogFile, { flags: "a" });
  const stderr = fs.createWriteStream(config.childErrLogFile, { flags: "a" });
  childProcess.stdout?.pipe(stdout);
  childProcess.stderr?.pipe(stderr);
  childProcess.once("close", () => {
    stdout.end();
    stderr.end();
  });
}

function startChild(reason = "initial", options = {}) {
  state = normalizeState(state);
  saveState();
  if (state.restartCount >= config.maxDailyRestarts && !options.allowAtLimit) {
    postLimitReport("restart_limit_reached", { message: `skip restart after ${reason}` });
    scheduleDayResetCheck();
    return;
  }

  consecutiveHealthFailures = 0;
  forcedRestartReason = "";
  childStartedAt = Date.now();
  state.lastStartedAt = isoNow();
  saveState();

  log("info", "starting dashboard service", { reason, port: config.port, host: config.host });
  child = spawn(config.nodePath, config.serverArgs, {
    cwd: config.repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  pipeChildLogs(child);

  child.once("exit", (code, signal) => {
    const exitedChild = child;
    child = null;
    stopHealthTimer();
    if (stopping) return;
    const uptimeMs = childStartedAt ? Date.now() - childStartedAt : null;
    const reasonText = forcedRestartReason || "process_exit";
    handleServiceFailure(reasonText, {
      code,
      signal,
      pid: exitedChild.pid,
      uptimeMs
    });
  });

  startHealthTimer();
}

function handleServiceFailure(reason, detail = {}) {
  state = normalizeState(state);
  const uptimeMs = Number.isFinite(Number(detail.uptimeMs)) ? Number(detail.uptimeMs) : null;
  state.lastExit = {
    at: isoNow(),
    reason,
    code: detail.code ?? null,
    signal: detail.signal || "",
    pid: detail.pid || null,
    uptimeMs
  };
  if (uptimeMs !== null && uptimeMs >= config.stableResetMs) {
    state.failureStreak = 0;
  }
  if (state.restartCount >= config.maxDailyRestarts) {
    state.crashes.push({ ...state.lastExit, restartCount: state.restartCount, nextDelayMs: null });
    state.crashes = state.crashes.slice(-20);
    saveState();
    postLimitReport(reason, { message: "restart limit was already exhausted" });
    scheduleDayResetCheck();
    return;
  }

  state.restartCount += 1;
  state.failureStreak += 1;
  const delayMs = nextBackoffDelay();
  state.crashes.push({ ...state.lastExit, restartCount: state.restartCount, nextDelayMs: delayMs });
  state.crashes = state.crashes.slice(-20);
  saveState();

  log("warn", "dashboard service stopped, scheduling restart", {
    reason,
    code: detail.code ?? null,
    signal: detail.signal || "",
    restartCount: state.restartCount,
    maxDailyRestarts: config.maxDailyRestarts,
    delayMs
  });

  if (state.restartCount >= config.maxDailyRestarts) {
    postLimitReport(reason, { message: "final daily restart attempt is being scheduled" });
  }
  scheduleRestart(delayMs, reason);
}

function scheduleRestart(delayMs, reason) {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startChild(`restart_after_${reason}`, { allowAtLimit: true });
  }, delayMs);
  restartTimer.unref?.();
}

function scheduleDayResetCheck() {
  clearTimeout(dayResetTimer);
  dayResetTimer = setTimeout(() => {
    state = normalizeState(state);
    saveState();
    if (!child && !stopping && state.restartCount < config.maxDailyRestarts) {
      startChild("daily_restart_budget_reset");
    } else if (!child && !stopping) {
      scheduleDayResetCheck();
    }
  }, 60 * 1000);
  dayResetTimer.unref?.();
}

function startHealthTimer() {
  stopHealthTimer();
  healthTimer = setInterval(runHealthCheck, config.healthIntervalMs);
  healthTimer.unref?.();
  setTimeout(runHealthCheck, config.healthGraceMs).unref?.();
}

function stopHealthTimer() {
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
}

async function runHealthCheck() {
  if (!child || stopping) return;
  if (Date.now() - childStartedAt < config.healthGraceMs) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.healthTimeoutMs);
  try {
    const response = await fetch(config.healthUrl, { cache: "no-store", signal: controller.signal });
    if (!response.ok) {
      throw new Error(`health http ${response.status}`);
    }
    const payload = await response.json().catch(() => ({}));
    if (payload && payload.ok === false) {
      throw new Error(`health payload ok=false`);
    }
    consecutiveHealthFailures = 0;
    state.lastHealth = { at: isoNow(), ok: true, status: response.status };
    saveState();
  } catch (error) {
    consecutiveHealthFailures += 1;
    state.lastHealth = {
      at: isoNow(),
      ok: false,
      failures: consecutiveHealthFailures,
      error: error.message
    };
    saveState();
    log("warn", "health check failed", {
      failures: consecutiveHealthFailures,
      threshold: config.healthFailuresBeforeRestart,
      error: error.message
    });
    if (consecutiveHealthFailures >= config.healthFailuresBeforeRestart && child) {
      forcedRestartReason = "health_check_failed";
      log("error", "health check threshold reached, terminating dashboard service", { pid: child.pid });
      child.kill();
    }
  } finally {
    clearTimeout(timer);
  }
}

function stopChild() {
  if (!child) return;
  const pid = child.pid;
  log("info", "stopping dashboard service", { pid });
  try {
    child.kill();
  } catch (error) {
    log("warn", "failed to stop dashboard service cleanly", { error: error.message });
  }
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log("info", "sentinel shutting down", { signal });
  clearTimeout(restartTimer);
  clearTimeout(dayResetTimer);
  stopHealthTimer();
  stopChild();
  clearPidFile();
  setTimeout(() => process.exit(0), 1500).unref?.();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (error) => {
  log("error", "uncaught sentinel exception", { error: error.stack || error.message });
});
process.on("unhandledRejection", (error) => {
  log("error", "unhandled sentinel rejection", { error: error && (error.stack || error.message || String(error)) });
});
process.on("exit", clearPidFile);

writePidFile();
log("info", "sentinel started", sanitizedConfig());
startChild("initial");
