const fs = require("node:fs");
const path = require("node:path");
const {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  randomUUID
} = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const repoRoot = path.resolve(__dirname, "..");
const authDatabaseFile = path.join(repoRoot, "data", "auth.sqlite");
const sessionIdleTimeoutMs = Math.max(5 * 60_000, Number.parseInt(process.env.AUTH_SESSION_IDLE_MS || "1800000", 10) || 1_800_000);
const sessionAbsoluteTimeoutMs = Math.max(sessionIdleTimeoutMs, Number.parseInt(process.env.AUTH_SESSION_ABSOLUTE_MS || "43200000", 10) || 43_200_000);
const maxFailedLogins = Math.max(3, Number.parseInt(process.env.AUTH_MAX_FAILED_LOGINS || "5", 10) || 5);
const lockoutMs = Math.max(60_000, Number.parseInt(process.env.AUTH_LOCKOUT_MS || "900000", 10) || 900_000);

const rolePermissions = {
  admin: [
    "dashboard.read",
    "alerts.read",
    "alerts.manage",
    "reports.read",
    "reports.generate",
    "settings.read",
    "settings.write",
    "env.read",
    "env.write",
    "resources.refresh",
    "collection.read",
    "collection.run",
    "collection.recover",
    "collection.delete",
    "users.manage",
    "audit.read"
  ],
  user: [
    "dashboard.read",
    "alerts.read",
    "reports.read",
    "reports.generate"
  ]
};

const validRoles = new Set(Object.keys(rolePermissions));
const validStatuses = new Set(["active", "disabled"]);

function ensureAuthDatabaseDir(databaseFile = authDatabaseFile) {
  fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
}

function openAuthDatabase(databaseFile = authDatabaseFile) {
  ensureAuthDatabaseDir(databaseFile);
  const db = new DatabaseSync(databaseFile);
  db.exec(`
    PRAGMA busy_timeout = 10000;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
  `);
  return db;
}

function initAuthDatabase(databaseFile = authDatabaseFile) {
  const db = openAuthDatabase(databaseFile);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        display_name TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        password_alg TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        failed_login_count INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT NOT NULL DEFAULT '',
        password_changed_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS user_account_scopes (
        user_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        PRIMARY KEY (user_id, account_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS user_resource_scopes (
        user_id TEXT NOT NULL,
        level TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        PRIMARY KEY (user_id, level, resource_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        csrf_token_hash TEXT NOT NULL,
        user_agent_hash TEXT NOT NULL DEFAULT '',
        ip_prefix TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_user
        ON sessions(user_id, expires_at);

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        actor_user_id TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        target_type TEXT NOT NULL DEFAULT '',
        target_id TEXT NOT NULL DEFAULT '',
        ip TEXT NOT NULL DEFAULT '',
        user_agent_hash TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_events_created
        ON audit_events(created_at DESC);
    `);
    ensureColumn(db, "users", "email", "TEXT NOT NULL DEFAULT ''");
    ensureUniqueIndex(db, "idx_users_email_unique", "users", "email", "email <> ''");
    return databaseFile;
  } finally {
    db.close();
  }
}

function tableColumns(db, tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name);
}

function ensureColumn(db, tableName, columnName, definition) {
  if (!tableColumns(db, tableName).includes(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function ensureUniqueIndex(db, indexName, tableName, columnName, where = "") {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${tableName}(${columnName}) ${where ? `WHERE ${where}` : ""}`);
}

function nowIso() {
  return new Date().toISOString();
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRole(value) {
  const role = String(value || "user").trim();
  return validRoles.has(role) ? role : "user";
}

function normalizeStatus(value) {
  const status = String(value || "active").trim();
  return validStatuses.has(status) ? status : "active";
}

function normalizeAccountIds(accountIds = []) {
  const source = Array.isArray(accountIds) ? accountIds : String(accountIds || "").split(/[\s,;，；]+/);
  return [...new Set(source
    .map((id) => String(id || "").trim())
    .filter((id) => /^\d{3,32}$/.test(id)))];
}

function normalizeResourceIds(ids = []) {
  return normalizeAccountIds(ids);
}

function normalizeResourceScope(scope = {}, fallbackAccountIds = []) {
  const source = scope && typeof scope === "object" ? scope : {};
  return {
    accountIds: normalizeAccountIds(source.accountIds || source.account_ids || fallbackAccountIds),
    campaignIds: normalizeResourceIds(source.campaignIds || source.campaign_ids || []),
    adsetIds: normalizeResourceIds(source.adsetIds || source.adset_ids || []),
    adIds: normalizeResourceIds(source.adIds || source.ad_ids || [])
  };
}

function assertUsername(username) {
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    throw new Error("用户名必须为 3-32 位小写字母、数字、点、下划线或横线，并以字母或数字开头");
  }
}

function assertEmail(email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""))) {
    throw new Error("请输入有效邮箱");
  }
}

function assertPassword(password) {
  const text = String(password || "");
  if (text.length < 10) {
    throw new Error("密码至少需要 10 个字符");
  }
}

function hashPassword(password) {
  assertPassword(password);
  const salt = randomBytes(16);
  const N = 16_384;
  const r = 8;
  const p = 1;
  const keylen = 64;
  const hash = scryptSync(String(password), salt, keylen, {
    N,
    r,
    p,
    maxmem: 64 * 1024 * 1024
  });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

function verifyPassword(password, storedHash) {
  const parts = String(storedHash || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }
  const [, N, r, p, saltText, hashText] = parts;
  const expected = Buffer.from(hashText, "base64url");
  const actual = scryptSync(String(password || ""), Buffer.from(saltText, "base64url"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function permissionsForRole(role) {
  return rolePermissions[role] || [];
}

function mapUser(row, accountIds = [], resourceScope = null) {
  if (!row) return null;
  const normalizedScope = normalizeResourceScope(resourceScope || {}, accountIds);
  return {
    id: row.id,
    username: row.username,
    email: row.email || "",
    displayName: row.display_name || row.username,
    role: row.role,
    status: row.status,
    lastLoginAt: row.last_login_at || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    accountIds: normalizedScope.accountIds,
    resourceScope: normalizedScope
  };
}

function readAccountScopes(db, userId) {
  return db.prepare(`
    SELECT account_id
    FROM user_account_scopes
    WHERE user_id = ?
    ORDER BY account_id
  `).all(userId).map((row) => row.account_id);
}

function writeAccountScopes(db, userId, accountIds = []) {
  db.prepare("DELETE FROM user_account_scopes WHERE user_id = ?").run(userId);
  const insert = db.prepare("INSERT INTO user_account_scopes (user_id, account_id) VALUES (?, ?)");
  normalizeAccountIds(accountIds).forEach((accountId) => {
    insert.run(userId, accountId);
  });
}

function readResourceScope(db, userId) {
  const accountIds = readAccountScopes(db, userId);
  const rows = db.prepare(`
    SELECT level, resource_id
    FROM user_resource_scopes
    WHERE user_id = ?
    ORDER BY level, resource_id
  `).all(userId);
  const scope = normalizeResourceScope({}, accountIds);
  rows.forEach((row) => {
    if (row.level === "campaign") scope.campaignIds.push(String(row.resource_id));
    if (row.level === "adset") scope.adsetIds.push(String(row.resource_id));
    if (row.level === "ad") scope.adIds.push(String(row.resource_id));
  });
  return normalizeResourceScope(scope, accountIds);
}

function writeResourceScope(db, userId, resourceScope = {}) {
  const scope = normalizeResourceScope(resourceScope);
  writeAccountScopes(db, userId, scope.accountIds);
  db.prepare("DELETE FROM user_resource_scopes WHERE user_id = ?").run(userId);
  const insert = db.prepare("INSERT INTO user_resource_scopes (user_id, level, resource_id) VALUES (?, ?, ?)");
  [
    ["campaign", scope.campaignIds],
    ["adset", scope.adsetIds],
    ["ad", scope.adIds]
  ].forEach(([level, ids]) => {
    ids.forEach((id) => insert.run(userId, level, id));
  });
}

function getUserByUsername(username, databaseFile = authDatabaseFile) {
  initAuthDatabase(databaseFile);
  const db = openAuthDatabase(databaseFile);
  try {
    return db.prepare("SELECT * FROM users WHERE username = ?").get(normalizeUsername(username)) || null;
  } finally {
    db.close();
  }
}

function getUserByEmail(email, databaseFile = authDatabaseFile) {
  initAuthDatabase(databaseFile);
  const db = openAuthDatabase(databaseFile);
  try {
    return db.prepare("SELECT * FROM users WHERE email = ?").get(normalizeEmail(email)) || null;
  } finally {
    db.close();
  }
}

function getUserById(userId, databaseFile = authDatabaseFile) {
  initAuthDatabase(databaseFile);
  const db = openAuthDatabase(databaseFile);
  try {
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    return row ? mapUser(row, readAccountScopes(db, userId), readResourceScope(db, userId)) : null;
  } finally {
    db.close();
  }
}

function listUsers(databaseFile = authDatabaseFile) {
  initAuthDatabase(databaseFile);
  const db = openAuthDatabase(databaseFile);
  try {
    const rows = db.prepare(`
      SELECT *
      FROM users
      ORDER BY created_at DESC
    `).all();
    return rows.map((row) => mapUser(row, readAccountScopes(db, row.id), readResourceScope(db, row.id)));
  } finally {
    db.close();
  }
}

function createUser({
  username,
  email = "",
  password,
  displayName = "",
  role = "user",
  status = "active",
  accountIds = [],
  resourceScope = undefined
} = {}, databaseFile = authDatabaseFile) {
  initAuthDatabase(databaseFile);
  const normalizedUsername = normalizeUsername(username);
  assertUsername(normalizedUsername);
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) assertEmail(normalizedEmail);
  const normalizedRole = normalizeRole(role);
  const normalizedStatus = normalizeStatus(status);
  const passwordHash = hashPassword(password);
  const now = nowIso();
  const userId = randomUUID();
  const db = openAuthDatabase(databaseFile);
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`
        INSERT INTO users (
          id,
          username,
          email,
          display_name,
          password_hash,
          password_alg,
          role,
          status,
          password_changed_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        normalizedUsername,
        normalizedEmail,
        String(displayName || "").trim(),
        passwordHash,
        "scrypt",
        normalizedRole,
        normalizedStatus,
        now,
        now,
        now
      );
      writeResourceScope(db, userId, resourceScope === undefined
        ? normalizeResourceScope({}, accountIds)
        : normalizeResourceScope(resourceScope, accountIds));
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return getUserById(userId, databaseFile);
  } finally {
    db.close();
  }
}

function updateUser(userId, {
  displayName,
  role,
  status,
  accountIds,
  resourceScope
} = {}, databaseFile = authDatabaseFile) {
  initAuthDatabase(databaseFile);
  const db = openAuthDatabase(databaseFile);
  try {
    const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    if (!existing) {
      const error = new Error("用户不存在");
      error.statusCode = 404;
      throw error;
    }
    const nextRole = role === undefined ? existing.role : normalizeRole(role);
    const nextStatus = status === undefined ? existing.status : normalizeStatus(status);
    const nextDisplayName = displayName === undefined ? existing.display_name : String(displayName || "").trim();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`
        UPDATE users
        SET display_name = ?,
          role = ?,
          status = ?,
          updated_at = ?
        WHERE id = ?
      `).run(nextDisplayName, nextRole, nextStatus, nowIso(), userId);
      if (resourceScope !== undefined || accountIds !== undefined) {
        writeResourceScope(db, userId, resourceScope === undefined
          ? normalizeResourceScope({}, accountIds)
          : normalizeResourceScope(resourceScope, accountIds));
      }
      if (nextStatus !== "active" || nextRole !== existing.role) {
        db.prepare(`
          UPDATE sessions
          SET revoked_at = ?
          WHERE user_id = ? AND revoked_at = ''
        `).run(nowIso(), userId);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return getUserById(userId, databaseFile);
  } finally {
    db.close();
  }
}

function resetUserPassword(userId, password, databaseFile = authDatabaseFile) {
  initAuthDatabase(databaseFile);
  const passwordHash = hashPassword(password);
  const now = nowIso();
  const db = openAuthDatabase(databaseFile);
  try {
    const result = db.prepare(`
      UPDATE users
      SET password_hash = ?,
        password_alg = 'scrypt',
        failed_login_count = 0,
        locked_until = '',
        password_changed_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(passwordHash, now, now, userId);
    if (!result.changes) {
      const error = new Error("用户不存在");
      error.statusCode = 404;
      throw error;
    }
    db.prepare(`
      UPDATE sessions
      SET revoked_at = ?
      WHERE user_id = ? AND revoked_at = ''
    `).run(now, userId);
    return getUserById(userId, databaseFile);
  } finally {
    db.close();
  }
}

function deleteUser(userId, databaseFile = authDatabaseFile) {
  initAuthDatabase(databaseFile);
  const db = openAuthDatabase(databaseFile);
  try {
    const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    if (!existing) {
      const error = new Error("用户不存在");
      error.statusCode = 404;
      throw error;
    }
    const user = mapUser(existing, readAccountScopes(db, userId));
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM user_account_scopes WHERE user_id = ?").run(userId);
      db.prepare("DELETE FROM user_resource_scopes WHERE user_id = ?").run(userId);
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
      db.prepare("DELETE FROM users WHERE id = ?").run(userId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return user;
  } finally {
    db.close();
  }
}

function isUserLocked(userRow) {
  const lockedUntil = Date.parse(userRow?.locked_until || "");
  return Number.isFinite(lockedUntil) && lockedUntil > Date.now();
}

function authenticateUser(username, password, databaseFile = authDatabaseFile) {
  initAuthDatabase(databaseFile);
  const normalizedUsername = normalizeUsername(username);
  const db = openAuthDatabase(databaseFile);
  try {
    const row = normalizedUsername.includes("@")
      ? db.prepare("SELECT * FROM users WHERE email = ?").get(normalizeEmail(normalizedUsername))
      : db.prepare("SELECT * FROM users WHERE username = ?").get(normalizedUsername);
    if (!row || row.status !== "active" || isUserLocked(row)) {
      if (row && row.status === "active" && isUserLocked(row)) {
        return { ok: false, reason: "locked" };
      }
      return { ok: false, reason: "invalid" };
    }
    const valid = verifyPassword(password, row.password_hash);
    const now = nowIso();
    if (!valid) {
      const failedCount = Number(row.failed_login_count || 0) + 1;
      const lockedUntil = failedCount >= maxFailedLogins
        ? new Date(Date.now() + lockoutMs).toISOString()
        : "";
      db.prepare(`
        UPDATE users
        SET failed_login_count = ?,
          locked_until = ?,
          updated_at = ?
        WHERE id = ?
      `).run(failedCount, lockedUntil, now, row.id);
      return { ok: false, reason: lockedUntil ? "locked" : "invalid" };
    }
    db.prepare(`
      UPDATE users
      SET failed_login_count = 0,
        locked_until = '',
        last_login_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(now, now, row.id);
    return {
      ok: true,
      user: mapUser(row, readAccountScopes(db, row.id))
    };
  } finally {
    db.close();
  }
}

function cleanupExpiredSessions(db) {
  db.prepare(`
    UPDATE sessions
    SET revoked_at = ?
    WHERE revoked_at = '' AND expires_at <= ?
  `).run(nowIso(), nowIso());
}

function createSession({ userId, userAgent = "", ipPrefix = "" } = {}, databaseFile = authDatabaseFile) {
  initAuthDatabase(databaseFile);
  const sessionId = randomToken();
  const csrfToken = randomToken();
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + sessionAbsoluteTimeoutMs).toISOString();
  const db = openAuthDatabase(databaseFile);
  try {
    cleanupExpiredSessions(db);
    db.prepare(`
      INSERT INTO sessions (
        id_hash,
        user_id,
        csrf_token_hash,
        user_agent_hash,
        ip_prefix,
        created_at,
        last_seen_at,
        expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sha256(sessionId),
      userId,
      sha256(csrfToken),
      sha256(userAgent || ""),
      String(ipPrefix || ""),
      createdAt,
      createdAt,
      expiresAt
    );
    return {
      sessionId,
      csrfToken,
      expiresAt,
      maxAgeSeconds: Math.floor(sessionAbsoluteTimeoutMs / 1000)
    };
  } finally {
    db.close();
  }
}

function rotateCsrfToken(sessionHash, databaseFile = authDatabaseFile) {
  initAuthDatabase(databaseFile);
  const csrfToken = randomToken();
  const db = openAuthDatabase(databaseFile);
  try {
    db.prepare(`
      UPDATE sessions
      SET csrf_token_hash = ?,
        last_seen_at = ?
      WHERE id_hash = ? AND revoked_at = ''
    `).run(sha256(csrfToken), nowIso(), sessionHash);
    return csrfToken;
  } finally {
    db.close();
  }
}

function readSession(sessionId, databaseFile = authDatabaseFile) {
  if (!sessionId) return null;
  initAuthDatabase(databaseFile);
  const sessionHash = sha256(sessionId);
  const db = openAuthDatabase(databaseFile);
  try {
    cleanupExpiredSessions(db);
    const row = db.prepare(`
      SELECT
        s.*,
        u.username,
        u.email,
        u.display_name,
        u.role,
        u.status,
        u.last_login_at,
        u.created_at AS user_created_at,
        u.updated_at AS user_updated_at
      FROM sessions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = ?
      LIMIT 1
    `).get(sessionHash);
    if (!row || row.revoked_at || row.status !== "active") {
      return null;
    }
    const now = Date.now();
    if (Date.parse(row.expires_at || "") <= now || Date.parse(row.last_seen_at || "") + sessionIdleTimeoutMs <= now) {
      db.prepare("UPDATE sessions SET revoked_at = ? WHERE id_hash = ?").run(nowIso(), sessionHash);
      return null;
    }
    db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?").run(nowIso(), sessionHash);
    const resourceScope = readResourceScope(db, row.user_id);
    const allowedResourceScope = row.role === "admin" && resourceScope.accountIds.length === 0
      ? null
      : resourceScope;
    const accountIds = resourceScope.accountIds;
    return {
      session: {
        idHash: sessionHash,
        csrfTokenHash: row.csrf_token_hash,
        expiresAt: row.expires_at,
        createdAt: row.created_at
      },
      user: {
        id: row.user_id,
        username: row.username,
        email: row.email || "",
        displayName: row.display_name || row.username,
        role: row.role,
        status: row.status,
        lastLoginAt: row.last_login_at || "",
        createdAt: row.user_created_at || "",
        updatedAt: row.user_updated_at || "",
        accountIds,
        resourceScope
      },
      permissions: permissionsForRole(row.role),
      allowedAccountIds: allowedResourceScope === null ? null : allowedResourceScope.accountIds,
      allowedResourceScope
    };
  } finally {
    db.close();
  }
}

function revokeSession(sessionId, databaseFile = authDatabaseFile) {
  if (!sessionId) return;
  initAuthDatabase(databaseFile);
  const db = openAuthDatabase(databaseFile);
  try {
    db.prepare(`
      UPDATE sessions
      SET revoked_at = ?
      WHERE id_hash = ?
    `).run(nowIso(), sha256(sessionId));
  } finally {
    db.close();
  }
}

function validateCsrf(session, csrfToken) {
  if (!session?.csrfTokenHash || !csrfToken) return false;
  return sha256(csrfToken) === session.csrfTokenHash;
}

function writeAuditEvent({
  actorUserId = "",
  action,
  targetType = "",
  targetId = "",
  ip = "",
  userAgent = "",
  metadata = {}
} = {}, databaseFile = authDatabaseFile) {
  if (!action) return null;
  initAuthDatabase(databaseFile);
  const db = openAuthDatabase(databaseFile);
  try {
    const event = {
      id: randomUUID(),
      actorUserId: String(actorUserId || ""),
      action: String(action || ""),
      targetType: String(targetType || ""),
      targetId: String(targetId || ""),
      ip: String(ip || ""),
      userAgentHash: userAgent ? sha256(userAgent) : "",
      metadataJson: JSON.stringify(metadata || {}),
      createdAt: nowIso()
    };
    db.prepare(`
      INSERT INTO audit_events (
        id,
        actor_user_id,
        action,
        target_type,
        target_id,
        ip,
        user_agent_hash,
        metadata_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.actorUserId,
      event.action,
      event.targetType,
      event.targetId,
      event.ip,
      event.userAgentHash,
      event.metadataJson,
      event.createdAt
    );
    return event;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

function listAuditEvents({ limit = 100, offset = 0 } = {}, databaseFile = authDatabaseFile) {
  initAuthDatabase(databaseFile);
  const db = openAuthDatabase(databaseFile);
  try {
    const rows = db.prepare(`
      SELECT id, actor_user_id, action, target_type, target_id, ip, user_agent_hash, metadata_json, created_at
      FROM audit_events
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(
      Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 100)),
      Math.max(0, Number.parseInt(offset, 10) || 0)
    );
    return rows.map((row) => ({
      id: row.id,
      actorUserId: row.actor_user_id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      ip: row.ip,
      userAgentHash: row.user_agent_hash,
      metadata: JSON.parse(row.metadata_json || "{}"),
      createdAt: row.created_at
    }));
  } finally {
    db.close();
  }
}

module.exports = {
  authDatabaseFile,
  rolePermissions,
  sessionAbsoluteTimeoutMs,
  initAuthDatabase,
  hashPassword,
  verifyPassword,
  permissionsForRole,
  normalizeAccountIds,
  normalizeResourceScope,
  createUser,
  updateUser,
  deleteUser,
  resetUserPassword,
  getUserById,
  getUserByEmail,
  getUserByUsername,
  listUsers,
  authenticateUser,
  createSession,
  readSession,
  rotateCsrfToken,
  revokeSession,
  validateCsrf,
  writeAuditEvent,
  listAuditEvents,
  sha256
};
