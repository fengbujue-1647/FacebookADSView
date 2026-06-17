const { createHash, createHmac, randomBytes, timingSafeEqual } = require("node:crypto");

const pinCookieName = "admin_pin";
const defaultPinTtlMs = 60 * 60 * 1000;

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function configuredPinHash() {
  const hash = String(process.env.ADMIN_PAGE_PIN_HASH || "").trim();
  if (hash) {
    return hash.toLowerCase();
  }
  const pin = String(process.env.ADMIN_PAGE_PIN || "").trim();
  return pin ? sha256(pin) : "";
}

function pinConfigured() {
  return Boolean(configuredPinHash());
}

function timingSafeTextEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyPin(pin) {
  const expected = configuredPinHash();
  if (!expected) return false;
  return timingSafeTextEqual(sha256(pin), expected);
}

function pinTtlMs() {
  const configured = Number.parseInt(process.env.ADMIN_PAGE_PIN_TTL_MS || "", 10);
  return Number.isFinite(configured) && configured >= 60_000 ? configured : defaultPinTtlMs;
}

function signingSecret() {
  return String(process.env.ADMIN_PAGE_PIN_SECRET || "").trim()
    || configuredPinHash()
    || "fb-ads-admin-pin-local-secret";
}

function signPayload(payload) {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

function tokenForUser(userId) {
  const expiresAt = Date.now() + pinTtlMs();
  const nonce = randomBytes(16).toString("base64url");
  const payload = [userId, expiresAt, nonce].join(".");
  return `${payload}.${signPayload(payload)}`;
}

function tokenVerifiedForUser(token, userId) {
  const text = String(token || "");
  const parts = text.split(".");
  if (parts.length !== 4) return false;
  const [tokenUserId, expiresAtText, nonce, signature] = parts;
  if (!tokenUserId || !expiresAtText || !nonce || !signature) return false;
  if (tokenUserId !== userId) return false;
  const expiresAt = Number(expiresAtText);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  const payload = [tokenUserId, expiresAtText, nonce].join(".");
  return timingSafeTextEqual(signPayload(payload), signature);
}

function shouldUseSecureCookie(req) {
  if (process.env.AUTH_COOKIE_SECURE === "1") return true;
  if (process.env.AUTH_COOKIE_SECURE === "0") return false;
  return req.headers["x-forwarded-proto"] === "https";
}

function cookieAttributes(req, maxAgeSeconds = 0) {
  const parts = [
    "Path=/",
    "SameSite=Lax",
    "HttpOnly",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`
  ];
  if (shouldUseSecureCookie(req)) parts.push("Secure");
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

function setAdminPinCookie(req, res, userId) {
  const token = tokenForUser(userId);
  appendSetCookie(res, `${pinCookieName}=${encodeURIComponent(token)}; ${cookieAttributes(req, pinTtlMs() / 1000)}`);
}

function clearAdminPinCookie(req, res) {
  appendSetCookie(res, `${pinCookieName}=; ${cookieAttributes(req, 0)}`);
}

function adminPinVerified(req, authContext) {
  if (!pinConfigured()) return false;
  return tokenVerifiedForUser(req.cookies?.[pinCookieName], authContext?.user?.id || "");
}

module.exports = {
  pinCookieName,
  pinConfigured,
  verifyPin,
  adminPinVerified,
  setAdminPinCookie,
  clearAdminPinCookie,
  pinTtlMs
};
