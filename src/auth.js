const {
  authenticateUser,
  createSession,
  readSession,
  rotateCsrfToken,
  revokeSession,
  validateCsrf,
  writeAuditEvent,
  sessionAbsoluteTimeoutMs
} = require("./authStore");
const { clearAdminPinCookie } = require("./adminPin");

const sessionCookieName = "id";
const csrfCookieName = "csrf";
const csrfHeaderName = "x-csrf-token";
const loginBodyLimit = 32 * 1024;
const loginAttempts = new Map();
const loginRateWindowMs = 10 * 60 * 1000;
const loginRateMaxAttempts = 20;

function parseCookies(req) {
  const header = String(req.headers.cookie || "");
  const cookies = {};
  header.split(";").forEach((item) => {
    const index = item.indexOf("=");
    if (index <= 0) return;
    const key = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();
    if (!key) return;
    cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

function cookieAttributes({ maxAgeSeconds = 0, httpOnly = true, secure = false } = {}) {
  const parts = [
    "Path=/",
    "SameSite=Lax"
  ];
  if (maxAgeSeconds > 0) {
    parts.push(`Max-Age=${Math.floor(maxAgeSeconds)}`);
  } else {
    parts.push("Max-Age=0");
  }
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function appendSetCookie(res, cookie) {
  const current = res.getHeader?.("Set-Cookie");
  if (!current) {
    res.setHeader("Set-Cookie", cookie);
    return;
  }
  res.setHeader("Set-Cookie", Array.isArray(current) ? [...current, cookie] : [current, cookie]);
}

function shouldUseSecureCookie(req) {
  if (process.env.AUTH_COOKIE_SECURE === "1") return true;
  if (process.env.AUTH_COOKIE_SECURE === "0") return false;
  return req.headers["x-forwarded-proto"] === "https";
}

function setSessionCookies(req, res, { sessionId, csrfToken, maxAgeSeconds } = {}) {
  const secure = shouldUseSecureCookie(req);
  appendSetCookie(res, `${sessionCookieName}=${encodeURIComponent(sessionId)}; ${cookieAttributes({
    maxAgeSeconds,
    httpOnly: true,
    secure
  })}`);
  appendSetCookie(res, `${csrfCookieName}=${encodeURIComponent(csrfToken)}; ${cookieAttributes({
    maxAgeSeconds,
    httpOnly: false,
    secure
  })}`);
}

function clearAuthCookies(req, res) {
  const secure = shouldUseSecureCookie(req);
  appendSetCookie(res, `${sessionCookieName}=; ${cookieAttributes({ maxAgeSeconds: 0, httpOnly: true, secure })}`);
  appendSetCookie(res, `${csrfCookieName}=; ${cookieAttributes({ maxAgeSeconds: 0, httpOnly: false, secure })}`);
  clearAdminPinCookie(req, res);
}

function readClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "";
}

function ipPrefix(ip) {
  const text = String(ip || "");
  if (text.includes(":")) {
    return text.split(":").slice(0, 4).join(":");
  }
  return text.split(".").slice(0, 3).join(".");
}

function readRequestBodyLimited(req, limit = loginBodyLimit) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error("request_body_too_large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function rateKey(req, username) {
  return `${readClientIp(req)}:${String(username || "").trim().toLowerCase()}`;
}

function loginRateLimited(req, username) {
  const key = rateKey(req, username);
  const now = Date.now();
  const record = loginAttempts.get(key) || { count: 0, startedAt: now };
  if (now - record.startedAt > loginRateWindowMs) {
    loginAttempts.set(key, { count: 0, startedAt: now });
    return false;
  }
  return record.count >= loginRateMaxAttempts;
}

function recordLoginAttempt(req, username, success) {
  const key = rateKey(req, username);
  if (success) {
    loginAttempts.delete(key);
    return;
  }
  const now = Date.now();
  const record = loginAttempts.get(key) || { count: 0, startedAt: now };
  if (now - record.startedAt > loginRateWindowMs) {
    loginAttempts.set(key, { count: 1, startedAt: now });
    return;
  }
  record.count += 1;
  loginAttempts.set(key, record);
}

function publicUser(authContext) {
  const user = authContext.user;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    accountIds: user.role === "admin" ? [] : user.accountIds || []
  };
}

function authContextFromRequest(req) {
  const cookies = parseCookies(req);
  const context = readSession(cookies[sessionCookieName]);
  if (!context) return null;
  return {
    ...context,
    sessionId: cookies[sessionCookieName],
    csrfToken: cookies[csrfCookieName] || ""
  };
}

function hasPermission(authContext, permission) {
  if (!permission) return true;
  if (authContext?.user?.role === "admin") return true;
  return Array.isArray(authContext?.permissions) && authContext.permissions.includes(permission);
}

function requireCsrf(req, authContext) {
  const headerToken = String(req.headers[csrfHeaderName] || "");
  return Boolean(headerToken && validateCsrf(authContext.session, headerToken));
}

async function handleAuthRoutes(req, res, url, writeJson) {
  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    try {
      const body = await readRequestBodyLimited(req);
      const payload = JSON.parse(body || "{}");
      const username = String(payload.username || "").trim();
      const password = String(payload.password || "");
      if (loginRateLimited(req, username)) {
        writeAuditEvent({
          action: "auth.login_rate_limited",
          targetType: "user",
          targetId: username,
          ip: readClientIp(req),
          userAgent: req.headers["user-agent"] || ""
        });
        writeJson(res, 429, {
          ok: false,
          error: "too_many_login_attempts",
          message: "请求过于频繁，请稍后再试"
        });
        return true;
      }
      const result = authenticateUser(username, password);
      recordLoginAttempt(req, username, result.ok);
      if (!result.ok) {
        writeAuditEvent({
          action: "auth.login_failed",
          targetType: "user",
          targetId: username,
          ip: readClientIp(req),
          userAgent: req.headers["user-agent"] || "",
          metadata: { reason: result.reason }
        });
        writeJson(res, 401, {
          ok: false,
          error: "invalid_credentials",
          message: "账号或密码错误"
        });
        return true;
      }
      const session = createSession({
        userId: result.user.id,
        userAgent: req.headers["user-agent"] || "",
        ipPrefix: ipPrefix(readClientIp(req))
      });
      const authContext = readSession(session.sessionId);
      setSessionCookies(req, res, session);
      writeAuditEvent({
        actorUserId: result.user.id,
        action: "auth.login_success",
        targetType: "user",
        targetId: result.user.id,
        ip: readClientIp(req),
        userAgent: req.headers["user-agent"] || ""
      });
      writeJson(res, 200, {
        ok: true,
        user: publicUser(authContext),
        permissions: authContext.permissions,
        csrfToken: session.csrfToken,
        session: {
          expiresAt: session.expiresAt
        }
      });
    } catch (error) {
      writeJson(res, error.message === "request_body_too_large" ? 413 : 400, {
        ok: false,
        error: "login_failed",
        message: error.message
      });
    }
    return true;
  }

  if (url.pathname === "/api/auth/me" && req.method === "GET") {
    const authContext = authContextFromRequest(req);
    if (!authContext) {
      clearAuthCookies(req, res);
      writeJson(res, 401, {
        ok: false,
        error: "unauthenticated"
      });
      return true;
    }
    let csrfToken = authContext.csrfToken;
    if (!validateCsrf(authContext.session, csrfToken)) {
      csrfToken = rotateCsrfToken(authContext.session.idHash);
      setSessionCookies(req, res, {
        sessionId: authContext.sessionId,
        csrfToken,
        maxAgeSeconds: Math.floor(sessionAbsoluteTimeoutMs / 1000)
      });
    }
    writeJson(res, 200, {
      ok: true,
      user: publicUser(authContext),
      permissions: authContext.permissions,
      csrfToken,
      session: {
        expiresAt: authContext.session.expiresAt
      }
    });
    return true;
  }

  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    const authContext = authContextFromRequest(req);
    if (authContext) {
      if (!requireCsrf(req, authContext)) {
        writeJson(res, 403, {
          ok: false,
          error: "csrf_invalid",
          message: "页面安全令牌已失效，请刷新后重试"
        });
        return true;
      }
      revokeSession(authContext.sessionId);
      writeAuditEvent({
        actorUserId: authContext.user.id,
        action: "auth.logout",
        targetType: "user",
        targetId: authContext.user.id,
        ip: readClientIp(req),
        userAgent: req.headers["user-agent"] || ""
      });
    }
    clearAuthCookies(req, res);
    writeJson(res, 200, {
      ok: true
    });
    return true;
  }

  return false;
}

function writeAuthError(res, writeJson, statusCode, error, message = "") {
  writeJson(res, statusCode, {
    ok: false,
    error,
    message
  });
}

function applyApiPolicy(req, res, policy, writeJson) {
  const authContext = authContextFromRequest(req);
  if (!authContext) {
    clearAuthCookies(req, res);
    writeAuthError(res, writeJson, 401, "unauthenticated", "请先登录");
    return null;
  }

  const method = String(req.method || "GET").toUpperCase();
  const csrfRequired = policy.csrf !== false && !["GET", "HEAD", "OPTIONS"].includes(method);
  if (csrfRequired && !requireCsrf(req, authContext)) {
    writeAuditEvent({
      actorUserId: authContext.user.id,
      action: "auth.csrf_rejected",
      targetType: "route",
      targetId: `${method} ${req.url}`,
      ip: readClientIp(req),
      userAgent: req.headers["user-agent"] || ""
    });
    writeAuthError(res, writeJson, 403, "csrf_invalid", "页面安全令牌已失效，请刷新后重试");
    return null;
  }

  if (!hasPermission(authContext, policy.permission)) {
    writeAuditEvent({
      actorUserId: authContext.user.id,
      action: "auth.permission_denied",
      targetType: "route",
      targetId: `${method} ${req.url}`,
      ip: readClientIp(req),
      userAgent: req.headers["user-agent"] || "",
      metadata: { permission: policy.permission || "" }
    });
    writeAuthError(res, writeJson, 403, "forbidden", "当前账号没有权限执行该操作");
    return null;
  }

  req.auth = authContext;
  return authContext;
}

function audit(req, action, { targetType = "", targetId = "", metadata = {} } = {}) {
  return writeAuditEvent({
    actorUserId: req.auth?.user?.id || "",
    action,
    targetType,
    targetId,
    ip: readClientIp(req),
    userAgent: req.headers["user-agent"] || "",
    metadata
  });
}

module.exports = {
  sessionCookieName,
  csrfCookieName,
  parseCookies,
  handleAuthRoutes,
  applyApiPolicy,
  readClientIp,
  audit
};
