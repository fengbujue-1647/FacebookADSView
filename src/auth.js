const fs = require("node:fs");
const path = require("node:path");
const { createHmac, randomBytes, randomInt, timingSafeEqual } = require("node:crypto");
const {
  authenticateUser,
  createUser,
  getUserById,
  getUserByEmail,
  getUserByUsername,
  normalizeResourceScope,
  permissionsForRole,
  readSession,
  rotateCsrfToken,
  revokeSession,
  validateCsrf,
  writeAuditEvent,
  sessionAbsoluteTimeoutMs
} = require("./authStore");
const { clearAdminPinCookie } = require("./adminPin");
const { sendVerificationCode } = require("./email");

const repoRoot = path.resolve(__dirname, "..");
const sessionCookieName = "id";
const csrfCookieName = "csrf";
const csrfHeaderName = "x-csrf-token";
const loginBodyLimit = 32 * 1024;
const signedAuthStateFile = path.join(repoRoot, "data", "auth-token-state.json");
const signedAuthVersion = 2;
const defaultSignedAuthTtlMs = 30 * 24 * 60 * 60 * 1000;
const defaultSignedAuthRefreshMs = 7 * 24 * 60 * 60 * 1000;
const loginAttempts = new Map();
const registerCodes = new Map();
const registerCodeAttempts = new Map();
const userTokenInvalidAfter = new Map();
const revokedSignedTokenIds = new Map();
const loginRateWindowMs = 10 * 60 * 1000;
const loginRateMaxAttempts = 20;
const registerCodeTtlMs = 10 * 60 * 1000;
const registerCodeRateWindowMs = 10 * 60 * 1000;
const registerCodeRateMaxAttempts = 5;
const registerCodeMinIntervalMs = 60 * 1000;

function readSignedAuthState() {
  try {
    if (!fs.existsSync(signedAuthStateFile)) {
      return { invalidAfter: {}, revoked: {} };
    }
    const payload = JSON.parse(fs.readFileSync(signedAuthStateFile, "utf8") || "{}");
    return {
      invalidAfter: payload.invalidAfter && typeof payload.invalidAfter === "object" ? payload.invalidAfter : {},
      revoked: payload.revoked && typeof payload.revoked === "object" ? payload.revoked : {}
    };
  } catch {
    return { invalidAfter: {}, revoked: {} };
  }
}

function writeSignedAuthState() {
  fs.mkdirSync(path.dirname(signedAuthStateFile), { recursive: true });
  const tempFile = `${signedAuthStateFile}.${process.pid}.${Date.now()}.tmp`;
  const payload = {
    version: 1,
    updated_at: new Date().toISOString(),
    invalidAfter: Object.fromEntries(userTokenInvalidAfter.entries()),
    revoked: Object.fromEntries(revokedSignedTokenIds.entries())
  };
  fs.writeFileSync(tempFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tempFile, signedAuthStateFile);
}

function loadSignedAuthState() {
  const payload = readSignedAuthState();
  Object.entries(payload.invalidAfter).forEach(([userId, value]) => {
    const timestamp = Number(value);
    if (userId && Number.isFinite(timestamp)) {
      userTokenInvalidAfter.set(String(userId), timestamp);
    }
  });
  Object.entries(payload.revoked).forEach(([tokenId, value]) => {
    const timestamp = Number(value);
    if (tokenId && Number.isFinite(timestamp)) {
      revokedSignedTokenIds.set(String(tokenId), timestamp);
    }
  });
}

function parsePositiveMs(value, fallback, minimum = 60_000) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function signedAuthTtlMs() {
  return parsePositiveMs(
    process.env.AUTH_SIGNED_COOKIE_TTL_MS || process.env.AUTH_TOKEN_TTL_MS,
    defaultSignedAuthTtlMs,
    5 * 60_000
  );
}

function signedAuthRefreshMs() {
  return Math.min(
    signedAuthTtlMs(),
    parsePositiveMs(
      process.env.AUTH_SIGNED_COOKIE_REFRESH_MS || process.env.AUTH_TOKEN_REFRESH_MS,
      defaultSignedAuthRefreshMs,
      60_000
    )
  );
}

function authSigningSecret() {
  return String(
    process.env.AUTH_SIGNED_COOKIE_SECRET
    || process.env.AUTH_TOKEN_SECRET
    || process.env.ADMIN_PAGE_PIN_SECRET
    || process.env.ADMIN_PAGE_PIN_HASH
    || "fb-ads-dashboard-local-auth-cookie-secret"
  );
}

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function sha256Text(value) {
  return createHmac("sha256", authSigningSecret()).update(String(value || "")).digest("hex");
}

function signAuthPayload(payloadText) {
  return createHmac("sha256", authSigningSecret()).update(payloadText).digest("base64url");
}

function timingSafeTextEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function encodeJsonBase64Url(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeJsonBase64Url(text) {
  return JSON.parse(Buffer.from(String(text || ""), "base64url").toString("utf8"));
}

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

function authContextFromUser(user, {
  csrfToken = "",
  tokenId = "",
  issuedAt = "",
  expiresAt = ""
} = {}) {
  if (!user || user.status !== "active") return null;
  const resourceScope = normalizeResourceScope(user.resourceScope || {}, user.accountIds || []);
  const allowedResourceScope = user.role === "admin" && resourceScope.accountIds.length === 0
    ? null
    : resourceScope;
  return {
    session: {
      idHash: tokenId ? sha256Text(tokenId) : "",
      csrfTokenHash: csrfToken ? sha256Text(csrfToken) : "",
      expiresAt,
      createdAt: issuedAt
    },
    user: {
      ...user,
      accountIds: resourceScope.accountIds,
      resourceScope
    },
    permissions: permissionsForRole(user.role),
    allowedAccountIds: allowedResourceScope === null ? null : allowedResourceScope.accountIds,
    allowedResourceScope,
    csrfToken,
    signedAuth: Boolean(tokenId),
    tokenId
  };
}

function signedAuthPayloadFromContext(authContext, { tokenId, csrfToken, issuedAt, expiresAt } = {}) {
  const user = authContext.user;
  const resourceScope = normalizeResourceScope(user.resourceScope || {}, user.accountIds || []);
  return {
    v: signedAuthVersion,
    j: tokenId,
    c: csrfToken,
    u: user.id,
    n: user.username,
    e: user.email || "",
    d: user.displayName || user.username,
    r: user.role,
    sc: {
      a: resourceScope.accountIds,
      c: resourceScope.campaignIds,
      s: resourceScope.adsetIds,
      ad: resourceScope.adIds
    },
    iat: issuedAt,
    exp: expiresAt
  };
}

function authContextFromSignedPayload(payload) {
  if (!payload || payload.v !== signedAuthVersion) return null;
  const tokenId = String(payload.j || "");
  const userId = String(payload.u || "");
  const issuedAt = String(payload.iat || "");
  const expiresAt = String(payload.exp || "");
  if (!tokenId || !userId || !issuedAt || !expiresAt) return null;
  const issuedAtMs = Date.parse(issuedAt);
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(issuedAtMs)) return null;
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return null;
  const invalidAfter = userTokenInvalidAfter.get(userId);
  if (invalidAfter && issuedAtMs <= invalidAfter) return null;
  if (revokedSignedTokenIds.has(tokenId)) return null;
  const resourceScope = normalizeResourceScope({
    accountIds: payload.sc?.a || [],
    campaignIds: payload.sc?.c || [],
    adsetIds: payload.sc?.s || [],
    adIds: payload.sc?.ad || []
  });
  return authContextFromUser({
    id: userId,
    username: String(payload.n || ""),
    email: String(payload.e || ""),
    displayName: String(payload.d || payload.n || ""),
    role: payload.r === "admin" ? "admin" : "user",
    status: "active",
    accountIds: resourceScope.accountIds,
    resourceScope
  }, {
    csrfToken: String(payload.c || ""),
    tokenId,
    issuedAt,
    expiresAt
  });
}

function signedAuthTokenFromContext(authContext, { now = Date.now(), tokenId = randomToken(16), csrfToken = randomToken() } = {}) {
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + signedAuthTtlMs()).toISOString();
  const payloadText = signedAuthPayloadFromContext(authContext, {
    tokenId,
    csrfToken,
    issuedAt,
    expiresAt
  });
  const encodedPayload = encodeJsonBase64Url(payloadText);
  return {
    token: `${encodedPayload}.${signAuthPayload(encodedPayload)}`,
    tokenId,
    csrfToken,
    issuedAt,
    expiresAt,
    maxAgeSeconds: Math.floor(signedAuthTtlMs() / 1000)
  };
}

function readSignedAuthToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  const [payloadText, signature] = parts;
  if (!payloadText || !signature || !timingSafeTextEqual(signAuthPayload(payloadText), signature)) {
    return null;
  }
  try {
    return authContextFromSignedPayload(decodeJsonBase64Url(payloadText));
  } catch {
    return null;
  }
}

function setSignedAuthCookies(req, res, authContext, options = {}) {
  const signed = signedAuthTokenFromContext(authContext, options);
  const secure = shouldUseSecureCookie(req);
  appendSetCookie(res, `${sessionCookieName}=${encodeURIComponent(signed.token)}; ${cookieAttributes({
    maxAgeSeconds: signed.maxAgeSeconds,
    httpOnly: true,
    secure
  })}`);
  appendSetCookie(res, `${csrfCookieName}=${encodeURIComponent(signed.csrfToken)}; ${cookieAttributes({
    maxAgeSeconds: signed.maxAgeSeconds,
    httpOnly: false,
    secure
  })}`);
  return {
    ...authContextFromSignedPayload(signedAuthPayloadFromContext(authContext, signed)),
    sessionId: signed.token,
    csrfToken: signed.csrfToken
  };
}

function maybeRefreshSignedAuth(req, res, authContext) {
  if (!authContext?.signedAuth || !res) return authContext;
  const expiresAt = Date.parse(authContext.session?.expiresAt || "");
  if (!Number.isFinite(expiresAt)) return authContext;
  if (expiresAt - Date.now() > signedAuthRefreshMs()) return authContext;
  return setSignedAuthCookies(req, res, authContext, {
    tokenId: authContext.tokenId,
    csrfToken: authContext.csrfToken
  });
}

function clearAuthCookies(req, res) {
  const secure = shouldUseSecureCookie(req);
  appendSetCookie(res, `${sessionCookieName}=; ${cookieAttributes({ maxAgeSeconds: 0, httpOnly: true, secure })}`);
  appendSetCookie(res, `${csrfCookieName}=; ${cookieAttributes({ maxAgeSeconds: 0, httpOnly: false, secure })}`);
  clearAdminPinCookie(req, res);
}

function revokeCurrentSignedAuth(authContext) {
  if (authContext?.tokenId) {
    revokedSignedTokenIds.set(authContext.tokenId, Date.now());
    writeSignedAuthState();
  }
}

function invalidateUserAuth(userId) {
  const id = String(userId || "");
  if (id) {
    userTokenInvalidAfter.set(id, Date.now());
    writeSignedAuthState();
  }
}

function cleanupAuthMemory() {
  const now = Date.now();
  for (const [tokenId, revokedAt] of revokedSignedTokenIds.entries()) {
    if (now - revokedAt > signedAuthTtlMs()) {
      revokedSignedTokenIds.delete(tokenId);
    }
  }
  writeSignedAuthState();
}

loadSignedAuthState();
const authMemoryCleanupTimer = setInterval(cleanupAuthMemory, 60 * 60 * 1000);
authMemoryCleanupTimer.unref?.();

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

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function assertEmail(email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("请输入有效邮箱");
  }
}

function assertRegisterPassword(password) {
  if (String(password || "").length < 10) {
    throw new Error("密码至少需要 10 个字符");
  }
}

function normalizeRegisterUsername(value, email) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw) return raw;
  const base = normalizeEmail(email)
    .split("@")[0]
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 20);
  return base.length >= 3 ? base : "user";
}

function uniqueRegisterUsername(email) {
  const base = normalizeRegisterUsername("", email);
  if (!getUserByUsername(base)) return base;
  for (let index = 0; index < 20; index += 1) {
    const suffix = String(Math.floor(1000 + Math.random() * 9000));
    const candidate = `${base.slice(0, 24)}-${suffix}`;
    if (!getUserByUsername(candidate)) return candidate;
  }
  throw new Error("用户名生成失败，请稍后重试");
}

function randomCode() {
  return String(randomInt(100000, 1000000));
}

function registerCodeRateKey(req, email) {
  return `${readClientIp(req)}:${email}`;
}

function checkRegisterCodeRate(req, email) {
  const key = registerCodeRateKey(req, email);
  const now = Date.now();
  const record = registerCodeAttempts.get(key) || { count: 0, startedAt: now, lastSentAt: 0 };
  if (now - record.startedAt > registerCodeRateWindowMs) {
    registerCodeAttempts.set(key, { count: 0, startedAt: now, lastSentAt: 0 });
    return { ok: true, key };
  }
  if (now - record.lastSentAt < registerCodeMinIntervalMs) {
    return { ok: false, statusCode: 429, message: "验证码发送过于频繁，请稍后再试" };
  }
  if (record.count >= registerCodeRateMaxAttempts) {
    return { ok: false, statusCode: 429, message: "验证码请求过多，请稍后再试" };
  }
  return { ok: true, key };
}

function recordRegisterCodeSent(req, email) {
  const key = registerCodeRateKey(req, email);
  const now = Date.now();
  const record = registerCodeAttempts.get(key) || { count: 0, startedAt: now, lastSentAt: 0 };
  if (now - record.startedAt > registerCodeRateWindowMs) {
    registerCodeAttempts.set(key, { count: 1, startedAt: now, lastSentAt: now });
    return;
  }
  record.count += 1;
  record.lastSentAt = now;
  registerCodeAttempts.set(key, record);
}

function storeRegisterCode(email, code) {
  registerCodes.set(email, {
    code,
    expiresAt: Date.now() + registerCodeTtlMs,
    attempts: 0
  });
}

function verifyRegisterCode(email, code) {
  const record = registerCodes.get(email);
  if (!record || record.expiresAt < Date.now()) {
    registerCodes.delete(email);
    return false;
  }
  record.attempts += 1;
  if (record.attempts > 5) {
    registerCodes.delete(email);
    return false;
  }
  const ok = record.code === String(code || "").trim();
  if (ok) registerCodes.delete(email);
  return ok;
}

function publicUser(authContext) {
  const user = authContext.user;
  const resourceScope = user.resourceScope || {
    accountIds: user.accountIds || [],
    campaignIds: [],
    adsetIds: [],
    adIds: []
  };
  return {
    id: user.id,
    username: user.username,
    email: user.email || "",
    displayName: user.displayName,
    role: user.role,
    accountIds: resourceScope.accountIds || [],
    resourceScope
  };
}

function authContextFromRequest(req) {
  const cookies = parseCookies(req);
  const signedContext = readSignedAuthToken(cookies[sessionCookieName]);
  if (signedContext) {
    return {
      ...signedContext,
      sessionId: cookies[sessionCookieName],
      csrfToken: signedContext.csrfToken || ""
    };
  }
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
  if (authContext?.signedAuth) {
    return Boolean(headerToken && timingSafeTextEqual(headerToken, authContext.csrfToken));
  }
  return Boolean(headerToken && validateCsrf(authContext.session, headerToken));
}

async function handleAuthRoutes(req, res, url, writeJson) {
  if (url.pathname === "/api/auth/register/code" && req.method === "POST") {
    try {
      const body = await readRequestBodyLimited(req);
      const payload = JSON.parse(body || "{}");
      const email = normalizeEmail(payload.email);
      assertEmail(email);
      if (getUserByEmail(email)) {
        writeJson(res, 409, {
          ok: false,
          error: "email_exists",
          message: "该邮箱已注册"
        });
        return true;
      }
      const rate = checkRegisterCodeRate(req, email);
      if (!rate.ok) {
        writeJson(res, rate.statusCode, {
          ok: false,
          error: "too_many_register_code_requests",
          message: rate.message
        });
        return true;
      }
      const code = randomCode();
      await sendVerificationCode(email, code);
      storeRegisterCode(email, code);
      recordRegisterCodeSent(req, email);
      writeAuditEvent({
        action: "auth.register_code_sent",
        targetType: "email",
        targetId: email,
        ip: readClientIp(req),
        userAgent: req.headers["user-agent"] || ""
      });
      writeJson(res, 200, {
        ok: true,
        message: "验证码已发送"
      });
    } catch (error) {
      writeJson(res, error.statusCode || (error.message === "request_body_too_large" ? 413 : 400), {
        ok: false,
        error: error.code || "send_register_code_failed",
        message: error.message
      });
    }
    return true;
  }

  if (url.pathname === "/api/auth/register" && req.method === "POST") {
    try {
      const body = await readRequestBodyLimited(req);
      const payload = JSON.parse(body || "{}");
      const email = normalizeEmail(payload.email);
      const password = String(payload.password || "");
      assertEmail(email);
      assertRegisterPassword(password);
      if (!verifyRegisterCode(email, payload.code)) {
        writeJson(res, 422, {
          ok: false,
          error: "invalid_register_code",
          message: "验证码无效或已过期"
        });
        return true;
      }
      const username = uniqueRegisterUsername(email);
      if (getUserByEmail(email)) {
        writeJson(res, 409, {
          ok: false,
          error: "account_exists",
          message: "该邮箱已注册"
        });
        return true;
      }
      const user = createUser({
        username,
        email,
        password,
        displayName: String(payload.displayName || "").trim(),
        role: "user",
        status: "active",
        accountIds: []
      });
      const authContext = setSignedAuthCookies(req, res, authContextFromUser(user));
      writeAuditEvent({
        actorUserId: user.id,
        action: "auth.register_success",
        targetType: "user",
        targetId: user.id,
        ip: readClientIp(req),
        userAgent: req.headers["user-agent"] || "",
        metadata: { email }
      });
      writeJson(res, 201, {
        ok: true,
        user: publicUser(authContext),
        permissions: authContext.permissions,
        csrfToken: authContext.csrfToken,
        session: {
          expiresAt: authContext.session.expiresAt
        }
      });
    } catch (error) {
      writeJson(res, error.statusCode || (error.message === "request_body_too_large" ? 413 : 400), {
        ok: false,
        error: "register_failed",
        message: error.message
      });
    }
    return true;
  }

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
      const freshUser = getUserById(result.user.id) || result.user;
      const authContext = setSignedAuthCookies(req, res, authContextFromUser(freshUser));
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
        csrfToken: authContext.csrfToken,
        session: {
          expiresAt: authContext.session.expiresAt
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
    let authContext = authContextFromRequest(req);
    if (!authContext) {
      clearAuthCookies(req, res);
      writeJson(res, 401, {
        ok: false,
        error: "unauthenticated"
      });
      return true;
    }
    authContext = maybeRefreshSignedAuth(req, res, authContext);
    let csrfToken = authContext.csrfToken;
    if (!authContext.signedAuth && !validateCsrf(authContext.session, csrfToken)) {
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
      if (authContext.signedAuth) {
        revokeCurrentSignedAuth(authContext);
      } else {
        revokeSession(authContext.sessionId);
      }
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
  let authContext = authContextFromRequest(req);
  if (!authContext) {
    clearAuthCookies(req, res);
    writeAuthError(res, writeJson, 401, "unauthenticated", "请先登录");
    return null;
  }
  authContext = maybeRefreshSignedAuth(req, res, authContext);

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
  invalidateUserAuth,
  readClientIp,
  audit
};
