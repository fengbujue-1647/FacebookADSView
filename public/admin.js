const root = document.getElementById("adminRoot");
const nativeFetch = window.fetch.bind(window);
const DISPLAY_TIME_ZONE = "Asia/Shanghai";
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
const ACTIVE_RESOURCE_ACCOUNT_ID = "8462513793771963";
const RESOURCE_LIMITS = {
  campaigns: Number.POSITIVE_INFINITY,
  ads: Number.POSITIVE_INFINITY
};
const RESOURCE_SELECTED_PAGE_SIZE = 8;

const state = {
  user: null,
  permissions: new Set(),
  csrfToken: "",
  activeTab: "overview",
  users: [],
  accounts: [],
  environment: null,
  sampling: null,
  resources: null,
  monitoredAccounts: [],
  monitorStatus: null,
  monitorRunFilter: "all",
  environmentSettings: null,
  environmentError: "",
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
  },
  resourceCatalog: {
    account_id: ACTIVE_RESOURCE_ACCOUNT_ID,
    stale: true,
    campaigns: [],
    adsets: [],
    ads: [],
    counts: {
      campaigns: { total: 0, active: 0 },
      adsets: { total: 0, active: 0 },
      ads: { total: 0, active: 0, chain_active: 0 }
    },
    last_synced_at: ""
  },
  userScopeDraft: {
    accountIds: [],
    campaignIds: [],
    adsetIds: [],
    adIds: []
  },
  userScopeUi: {
    open: "",
    query: {
      accounts: "",
      campaigns: "",
      adsets: "",
      ads: ""
    }
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
  savedSettingsSnapshot: "",
  queue: null,
  auditEvents: [],
  status: "",
  pin: {
    configured: false,
    verified: false
  }
};
let userModalEscapeBound = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hasPermission(permission) {
  return state.user?.role === "admin" || state.permissions.has(permission);
}

const iconPaths = {
  "bell-ring": ["M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9", "M10.3 21a2 2 0 0 0 3.4 0", "M4 2 2 4", "M20 2l2 2"],
  "sparkles": ["M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z", "M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z", "M5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14z"],
  "plus": ["M12 5v14", "M5 12h14"],
  "send": ["M22 2 11 13", "M22 2l-7 20-4-9-9-4 20-7z"],
  "chevron-down": ["M6 9l6 6 6-6"],
  "search": ["M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z", "M21 21l-4.3-4.3"],
  "copy": ["M8 8h12v12H8z", "M4 16V4h12"],
  "download": ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"],
  "refresh-cw": ["M21 12a9 9 0 0 1-15.5 6.2", "M21 3v6h-6", "M3 12a9 9 0 0 1 15.5-6.2", "M3 21v-6h6"],
  "x": ["M18 6 6 18", "M6 6l12 12"],
  "save": ["M5 3h14l2 2v16H3V3h2z", "M7 3v6h10V3", "M7 21v-8h10v8"],
  "pencil": ["M17 3l4 4L8 20H4v-4L17 3z", "M15 5l4 4"],
  "trash-2": ["M3 6h18", "M8 6V4h8v2", "M6 6l1 16h10l1-16", "M10 11v6", "M14 11v6"],
  "database-zap": ["M4 6c0 2 4 3 8 3s8-1 8-3-4-3-8-3-8 1-8 3z", "M4 6v6c0 2 4 3 8 3h1", "M4 12v6c0 2 4 3 8 3h1", "M17 12l-3 5h4l-2 5 5-7h-4l2-3z"],
  "undo-2": ["M9 14 4 9l5-5", "M4 9h10a6 6 0 0 1 0 12h-2"],
  "check": ["M20 6 9 17l-5-5"],
  "chevron-left": ["M15 18l-6-6 6-6"],
  "chevron-right": ["M9 18l6-6-6-6"],
  "chevrons-left": ["M11 17l-5-5 5-5", "M18 17l-5-5 5-5"],
  "chevrons-right": ["M6 17l5-5-5-5", "M13 17l5-5-5-5"],
  "home": ["M3 11l9-8 9 8", "M5 10v10h14V10", "M9 20v-6h6v6"],
  "layout-dashboard": ["M3 3h8v8H3z", "M13 3h8v5h-8z", "M13 10h8v11h-8z", "M3 13h8v8H3z"],
  "eye": ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  "triangle-alert": ["M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z", "M12 9v4", "M12 17h.01"]
};

function refreshIcons() {
  root.querySelectorAll("i[data-lucide]").forEach((icon) => {
    const paths = iconPaths[icon.dataset.lucide];
    if (!paths) return;
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
  });
}

window.fbHasPermission = hasPermission;
window.fbRefreshIcons = refreshIcons;

function setAuth(payload = {}) {
  state.user = payload.user || null;
  state.permissions = new Set(Array.isArray(payload.permissions) ? payload.permissions : []);
  state.csrfToken = payload.csrfToken || "";
}

async function apiFetch(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = {
    ...(options.headers || {})
  };
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers["X-CSRF-Token"] = state.csrfToken;
  }
  const response = await nativeFetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers
  });
  if (response.status === 401) {
    setAuth({});
    redirectToPlatformLogin("/admin");
    throw new Error("请先登录");
  }
  if (response.status === 403) {
    const payload = await response.clone().json().catch(() => ({}));
    if (payload.error === "admin_pin_required" || payload.error === "admin_pin_not_configured") {
      renderPin(payload.message || "需要先完成管理员 PIN 校验");
    }
  }
  return response;
}

window.apiFetch = apiFetch;

function redirectToPlatformLogin(returnPath = window.location.pathname + window.location.search) {
  const safePath = String(returnPath || "/admin");
  window.location.href = `/login.html?return=${encodeURIComponent(safePath)}`;
}

async function jsonFetch(url, options = {}) {
  const response = await apiFetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || payload.error || `请求失败 (${response.status})`);
  }
  return payload;
}

async function loadAuth() {
  const response = await nativeFetch("/api/auth/me", {
    credentials: "same-origin",
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    setAuth({});
    return false;
  }
  setAuth(payload);
  return true;
}

async function login(username, password) {
  const response = await nativeFetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "登录失败");
  }
  setAuth(payload);
}

async function logout() {
  try {
    await apiFetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
  } catch {
    // local state is cleared regardless of network result
  }
  setAuth({});
  redirectToPlatformLogin("/admin");
}

function formValue(form, name) {
  return String(new FormData(form).get(name) || "").trim();
}

function renderLogin(message = "") {
  root.innerHTML = `
    <section class="admin-gate">
      <form class="auth-panel auth-form" id="adminLoginForm">
        <div class="auth-brand">
          <img src="/favicon.svg?v=20260611-4" alt="">
          <div>
            <strong>管理员系统</strong>
            <span>账号登录</span>
          </div>
        </div>
        <h2>登录</h2>
        <label>
          <span>用户名</span>
          <input name="username" autocomplete="username" required>
        </label>
        <label>
          <span>密码</span>
          <input name="password" type="password" autocomplete="current-password" required>
        </label>
        <p class="auth-message">${escapeHtml(message)}</p>
        <button class="primary-button" type="submit">登录</button>
        <a class="secondary-button home-link" href="/">返回首页</a>
      </form>
    </section>
  `;
  root.querySelector("#adminLoginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await login(formValue(form, "username"), String(new FormData(form).get("password") || ""));
      await continueAfterAuth();
    } catch (error) {
      renderLogin(error.message || "登录失败");
    }
  });
}

function renderDenied() {
  root.innerHTML = `
    <section class="admin-gate">
      <div class="auth-panel">
        <div class="auth-brand">
          <img src="/favicon.svg?v=20260611-4" alt="">
          <div>
            <strong>管理员系统</strong>
            <span>无权限</span>
          </div>
        </div>
        <h2>当前账号不是管理员</h2>
        <p class="auth-message">请使用管理员账号登录。</p>
        <button class="secondary-button" id="adminLogoutButton" type="button">退出登录</button>
      </div>
    </section>
  `;
  root.querySelector("#adminLogoutButton").addEventListener("click", logout);
}

function renderPin(message = "") {
  root.innerHTML = `
    <section class="admin-gate">
      <form class="auth-panel auth-form" id="adminPinForm">
        <div class="auth-brand">
          <img src="/favicon.svg?v=20260611-4" alt="">
          <div>
            <strong>管理员系统</strong>
            <span>PIN 校验</span>
          </div>
        </div>
        <h2>输入管理员 PIN</h2>
        <label>
          <span>PIN</span>
          <input name="pin" type="password" inputmode="numeric" autocomplete="one-time-code" required>
        </label>
        <p class="auth-message">${escapeHtml(message)}</p>
        <button class="primary-button" type="submit">进入管理员系统</button>
        <button class="secondary-button" id="adminPinLogoutButton" type="button">退出登录</button>
      </form>
    </section>
  `;
  root.querySelector("#adminPinLogoutButton").addEventListener("click", logout);
  root.querySelector("#adminPinForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const payload = await jsonFetch("/api/admin/pin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: String(new FormData(form).get("pin") || "") })
      });
      state.pin.verified = payload.verified === true;
      await loadAdminData();
      renderAdminApp();
    } catch (error) {
      renderPin(error.message || "PIN 校验失败");
    }
  });
}

async function continueAfterAuth() {
  if (!state.user || !hasPermission("users.manage")) {
    renderDenied();
    return;
  }
  const pinStatus = await jsonFetch("/api/admin/pin/status");
  state.pin = {
    configured: pinStatus.configured === true,
    verified: pinStatus.verified === true
  };
  if (!state.pin.configured) {
    renderPin("管理员 PIN 未配置，请先在服务端配置 ADMIN_PAGE_PIN 或 ADMIN_PAGE_PIN_HASH");
    return;
  }
  if (!state.pin.verified) {
    renderPin();
    return;
  }
  await loadAdminData();
  renderAdminApp();
}

function adminShell(content) {
  const tabs = [
    ["overview", "总览"],
    ["users", "用户管理"],
    ["settings", "服务端设置"],
    ["queue", "采集队列"],
    ["alerts", "预警管理"],
    ["audit", "审计日志"]
  ];
  return `
    <div class="admin-shell">
      <aside class="admin-sidebar">
        <div class="brand">
          <div class="brand-mark"><img src="/favicon.svg?v=20260611-4" alt=""></div>
          <div><strong>管理员系统</strong><span>Settings Console</span></div>
        </div>
        <nav class="nav-list">
          ${tabs.map(([id, label]) => `
            <button class="nav-item ${state.activeTab === id ? "active" : ""}" type="button" data-admin-tab="${id}">
              <span>${label}</span>
            </button>
          `).join("")}
        </nav>
        <div class="admin-sidebar-footer" aria-label="快捷跳转">
          <a class="admin-quick-link" href="/" data-tooltip="返回主页" aria-label="返回主页">
            <i data-lucide="home"></i>
          </a>
          <a class="admin-quick-link" href="/console.html" data-tooltip="模块选择页" aria-label="模块选择页">
            <i data-lucide="layout-dashboard"></i>
          </a>
        </div>
      </aside>
      <main class="admin-workspace">
        <header class="topbar admin-topbar">
          <div>
            <p class="eyebrow">ADMIN</p>
            <h1>${tabs.find(([id]) => id === state.activeTab)?.[1] || "管理员系统"}</h1>
            <p class="page-subtitle">${escapeHtml(state.status || "管理员操作会写入审计日志。")}</p>
          </div>
          <div class="top-actions">
            <div class="auth-user-bar"><span>${escapeHtml(state.user?.displayName || state.user?.username || "")}</span><small>管理员</small></div>
            <button class="secondary-button" id="adminClearPinButton" type="button">锁定 PIN</button>
            <button class="secondary-button" id="adminLogoutButton" type="button">退出</button>
          </div>
        </header>
        ${content}
      </main>
    </div>
  `;
}

function setStatus(message) {
  state.status = message || "";
  const subtitle = root.querySelector(".admin-topbar .page-subtitle");
  if (subtitle) subtitle.textContent = state.status || "管理员操作会写入审计日志。";
}

function renderAdminApp() {
  const renderers = {
    overview: renderOverview,
    users: renderUsers,
    settings: renderSettings,
    queue: renderQueue,
    alerts: renderAlerts,
    audit: renderAudit
  };
  root.innerHTML = adminShell(renderers[state.activeTab]?.() || renderOverview());
  bindShellEvents();
  refreshIcons();
  if (state.activeTab === "alerts") {
    window.AlertAiModule?.activate?.("templates");
  }
}

function bindShellEvents() {
  root.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.adminTab;
      renderAdminApp();
    });
  });
  root.querySelector("#adminLogoutButton")?.addEventListener("click", logout);
  root.querySelector("#adminClearPinButton")?.addEventListener("click", async () => {
    await jsonFetch("/api/admin/pin/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    state.pin.verified = false;
    renderPin("PIN 已锁定");
  });
  bindUsersEvents();
  bindSettingsEvents();
  bindQueueEvents();
  bindAuditEvents();
}

async function loadAdminData() {
  await Promise.all([
    loadUsers(),
    loadSettingsData(),
    loadQueue(),
    loadAudit()
  ]);
}

async function loadUsers() {
  const payload = await jsonFetch("/api/admin/users");
  state.users = Array.isArray(payload.users) ? payload.users : [];
}

async function loadQueue() {
  const payload = await jsonFetch("/api/collection/queue/status?page_size=50&page=1");
  state.queue = payload;
}

async function loadAudit() {
  const payload = await jsonFetch("/api/admin/audit-events?limit=80");
  state.auditEvents = Array.isArray(payload.events) ? payload.events : [];
}

function renderOverview() {
  const queue = state.queue?.queue || {};
  const summary = state.environment?.summary || {};
  return `
    <section class="admin-grid">
      ${metricCard("用户", state.users.length, "当前认证库用户数")}
      ${metricCard("监控账户", state.accounts.length, "已配置账户")}
      ${metricCard("环境配置", `${summary.configuredTotal || 0}/${summary.total || 0}`, "已配置变量")}
      ${metricCard("队列任务", queue.jobPage?.total || 0, "当前批次任务数")}
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>最近审计事件</h2><span>最新 8 条</span></div></div>
      ${auditTable(state.auditEvents.slice(0, 8))}
    </section>
  `;
}

function metricCard(label, value, hint) {
  return `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(hint)}</small></article>`;
}

function roleText(role) {
  return role === "admin" ? "管理员" : "用户";
}

function statusText(status) {
  return status === "disabled" ? "禁用" : "启用";
}

function accountLines(accountIds = []) {
  return (Array.isArray(accountIds) ? accountIds : []).join("\n");
}

function renderUsers() {
  return `
    <section class="panel">
      <div class="panel-head">
        <div><h2>用户列表</h2><span>${state.users.length} 个用户</span></div>
        <div class="settings-actions">
          <button class="secondary-button" id="reloadUsersButton" type="button">刷新</button>
          <button class="primary-button" id="openCreateUserButton" type="button">
            <i data-lucide="plus"></i>
            <span>新增用户</span>
          </button>
        </div>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>用户名</th><th>显示名</th><th>角色</th><th>状态</th><th>账户范围</th><th>操作</th></tr></thead>
          <tbody>
            ${state.users.map((user) => `
              <tr>
                <td>${escapeHtml(user.username)}</td>
                <td>${escapeHtml(user.displayName || "")}</td>
                <td>${roleText(user.role)}</td>
                <td><span class="status-pill ${user.status === "disabled" ? "paused" : ""}">${statusText(user.status)}</span></td>
                <td>${escapeHtml(userScopeSummary(user))}</td>
                <td class="row-actions">
                  <button type="button" data-edit-user="${escapeHtml(user.id)}">编辑</button>
                  <button type="button" data-toggle-user="${escapeHtml(user.id)}">${user.status === "disabled" ? "启用" : "禁用"}</button>
                  <button type="button" data-password-user="${escapeHtml(user.id)}">重置密码</button>
                  <button type="button" data-delete-user="${escapeHtml(user.id)}" ${state.user?.id === user.id ? "disabled" : ""}>删除</button>
                </td>
              </tr>
            `).join("") || `<tr><td colspan="6">暂无用户。</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>

    <div class="modal-backdrop" id="userModal" hidden>
      <section class="confirm-modal admin-user-modal" role="dialog" aria-modal="true" aria-labelledby="userModalTitle">
        <div class="confirm-modal-head">
          <div>
            <span class="monitor-kicker">USER</span>
            <h3 id="userModalTitle">新增用户</h3>
          </div>
          <button class="icon-button" id="closeUserModalButton" type="button" aria-label="关闭">
            <i data-lucide="x"></i>
          </button>
        </div>
        <form id="userForm" class="admin-form confirm-modal-body">
          <input type="hidden" name="id">
          <div class="admin-form-grid">
            <label><span>用户名</span><input name="username" required autocomplete="username"></label>
            <label><span>显示名</span><input name="displayName"></label>
            <label data-password-field><span>初始密码</span><input name="password" type="password" autocomplete="new-password"></label>
            <label><span>角色</span><select name="role"><option value="user">普通用户</option><option value="admin">管理员</option></select></label>
            <label><span>状态</span><select name="status"><option value="active">启用</option><option value="disabled">禁用</option></select></label>
            <div class="wide user-scope-builder" id="userScopeBuilder"></div>
          </div>
          <p class="muted-inline">普通用户没有账户范围时可登录，但不会看到业务数据。</p>
          <p class="auth-message" id="userFormMessage"></p>
          <div class="confirm-modal-actions">
            <button class="secondary-button" id="cancelUserModalButton" type="button">取消</button>
            <button class="primary-button" type="submit">保存用户</button>
          </div>
        </form>
      </section>
    </div>

    <div class="modal-backdrop" id="passwordModal" hidden>
      <section class="confirm-modal compact-modal" role="dialog" aria-modal="true" aria-labelledby="passwordModalTitle">
        <div class="confirm-modal-head">
          <div>
            <span class="monitor-kicker">PASSWORD</span>
            <h3 id="passwordModalTitle">重置密码</h3>
          </div>
          <button class="icon-button" id="closePasswordModalButton" type="button" aria-label="关闭">
            <i data-lucide="x"></i>
          </button>
        </div>
        <form id="passwordForm" class="admin-form confirm-modal-body">
          <input type="hidden" name="id">
          <label><span>新密码</span><input name="password" type="password" autocomplete="new-password" required></label>
          <p class="auth-message" id="passwordFormMessage"></p>
          <div class="confirm-modal-actions">
            <button class="secondary-button" id="cancelPasswordModalButton" type="button">取消</button>
            <button class="primary-button" type="submit">提交新密码</button>
          </div>
        </form>
      </section>
    </div>

    <div class="modal-backdrop" id="deleteUserModal" hidden>
      <section class="confirm-modal compact-modal" role="dialog" aria-modal="true" aria-labelledby="deleteUserModalTitle">
        <div class="confirm-modal-head">
          <div>
            <span class="monitor-kicker">DELETE</span>
            <h3 id="deleteUserModalTitle">删除用户</h3>
          </div>
          <button class="icon-button" id="closeDeleteUserModalButton" type="button" aria-label="关闭">
            <i data-lucide="x"></i>
          </button>
        </div>
        <div class="confirm-modal-body">
          <input type="hidden" id="deleteUserId">
          <div class="confirm-modal-warning user-delete-warning" id="deleteUserMessage"></div>
          <p class="muted-inline">删除后会清理该用户的账户范围和会话，操作会写入审计日志。</p>
        </div>
        <div class="confirm-modal-actions">
          <button class="secondary-button" id="cancelDeleteUserButton" type="button">取消</button>
          <button class="primary-button danger-button" id="confirmDeleteUserButton" type="button">删除用户</button>
        </div>
      </section>
    </div>
  `;
}

function selectedUser(id) {
  return state.users.find((user) => user.id === id);
}

function parseAccountIds(text) {
  return String(text || "").split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean);
}

function normalizeUserScopeIds(ids = []) {
  return [...new Set((Array.isArray(ids) ? ids : [])
    .map((id) => String(id || "").trim())
    .filter((id) => /^\d{3,32}$/.test(id)))];
}

function normalizeUserResourceScope(scope = {}, fallbackAccountIds = []) {
  const source = scope && typeof scope === "object" ? scope : {};
  return {
    accountIds: normalizeUserScopeIds(source.accountIds || source.account_ids || fallbackAccountIds),
    campaignIds: normalizeUserScopeIds(source.campaignIds || source.campaign_ids || []),
    adsetIds: normalizeUserScopeIds(source.adsetIds || source.adset_ids || []),
    adIds: normalizeUserScopeIds(source.adIds || source.ad_ids || [])
  };
}

function userScopeSummary(user) {
  const scope = normalizeUserResourceScope(user?.resourceScope || {}, user?.accountIds || []);
  if (!scope.accountIds.length) {
    return user?.role === "admin" ? "全部账户" : "无账户";
  }
  const parts = [`账户 ${scope.accountIds.length}`];
  if (scope.campaignIds.length) parts.push(`广告系列 ${scope.campaignIds.length}`);
  if (scope.adsetIds.length) parts.push(`广告组 ${scope.adsetIds.length}`);
  if (scope.adIds.length) parts.push(`广告 ${scope.adIds.length}`);
  if (parts.length === 1) parts.push("广告系列默认全选");
  return parts.join(" · ");
}

function userScopeIdForKind(row, kind) {
  if (kind === "accounts") return String(row?.id || row?.account_id || "").trim();
  if (kind === "campaigns") return String(row?.campaign_id || row?.id || "").trim();
  if (kind === "adsets") return String(row?.adset_id || row?.id || "").trim();
  return String(row?.ad_id || row?.id || "").trim();
}

function accountScopeCandidates() {
  const map = new Map();
  state.monitoredAccounts.forEach((account) => {
    const id = String(account.id || account.account_id || "").trim();
    if (id) map.set(id, { id, name: account.name || id });
  });
  [...(state.resourceCatalog.campaigns || []), ...(state.resourceCatalog.adsets || []), ...(state.resourceCatalog.ads || [])].forEach((row) => {
    const id = String(row.account_id || "").trim();
    if (id && !map.has(id)) map.set(id, { id, name: id });
  });
  return [...map.values()];
}

function userScopeCandidates(kind) {
  const scope = state.userScopeDraft || normalizeUserResourceScope();
  const accountIds = new Set(scope.accountIds);
  const campaignIds = new Set(scope.campaignIds);
  const adsetIds = new Set(scope.adsetIds);
  if (kind === "accounts") return accountScopeCandidates();
  if (kind === "campaigns") {
    if (!accountIds.size) return [];
    return (state.resourceCatalog.campaigns || []).filter((row) => accountIds.has(String(row.account_id || "")));
  }
  if (kind === "adsets") {
    if (!accountIds.size || !campaignIds.size) return [];
    return (state.resourceCatalog.adsets || []).filter((row) => (
      accountIds.has(String(row.account_id || ""))
      && campaignIds.has(String(row.campaign_id || ""))
    ));
  }
  if (!accountIds.size || !campaignIds.size || !adsetIds.size) return [];
  return (state.resourceCatalog.ads || []).filter((row) => (
    accountIds.has(String(row.account_id || ""))
    && campaignIds.has(String(row.campaign_id || ""))
    && adsetIds.has(String(row.adset_id || ""))
  ));
}

function userScopeSearchText(row, kind) {
  return [
    userScopeLabel(row, kind),
    row?.id,
    row?.account_id,
    row?.campaign_id,
    row?.campaign_name,
    row?.adset_id,
    row?.adset_name,
    row?.ad_id,
    row?.name
  ].filter(Boolean).join(" ").toLowerCase();
}

function filteredUserScopeCandidates(kind) {
  const query = String(state.userScopeUi.query[kind] || "").trim().toLowerCase();
  const rows = userScopeCandidates(kind);
  if (!query) return rows;
  return rows.filter((row) => userScopeSearchText(row, kind).includes(query));
}

function userScopeLabel(row, kind) {
  if (kind === "accounts") return nameIdLabel(row?.name, userScopeIdForKind(row, kind));
  return nameIdLabel(row?.name, userScopeIdForKind(row, kind));
}

function userScopeSecondary(row, kind) {
  if (kind === "accounts") return `账户 ${userScopeIdForKind(row, kind)}`;
  if (kind === "campaigns") {
    return [
      row?.account_id ? `账户 ${row.account_id}` : "",
      row?.effective_status || row?.status || "ACTIVE"
    ].filter(Boolean).join(" · ");
  }
  if (kind === "adsets") {
    return [
      row?.campaign_name ? `广告系列 ${nameIdLabel(row.campaign_name, row.campaign_id)}` : `广告系列 ${row?.campaign_id || "-"}`,
      row?.account_id ? `账户 ${row.account_id}` : ""
    ].filter(Boolean).join(" · ");
  }
  return [
    row?.campaign_name ? `广告系列 ${nameIdLabel(row.campaign_name, row.campaign_id)}` : `广告系列 ${row?.campaign_id || "-"}`,
    row?.adset_name ? `广告组 ${nameIdLabel(row.adset_name, row.adset_id)}` : `广告组 ${row?.adset_id || "-"}`
  ].join(" · ");
}

function userScopeConfig(kind) {
  const configs = {
    accounts: { key: "accountIds", label: "账户", placeholder: "搜索账户名称或 ID", defaultText: "普通用户无账户，管理员全账户" },
    campaigns: { key: "campaignIds", label: "广告系列", placeholder: "搜索广告系列名称或 ID", defaultText: "默认全选所选账户下广告系列" },
    adsets: { key: "adsetIds", label: "广告组", placeholder: "搜索广告组、广告系列或 ID", defaultText: "默认全选所选广告系列下广告组" },
    ads: { key: "adIds", label: "广告", placeholder: "搜索广告、广告组、广告系列或 ID", defaultText: "默认全选所选广告组下广告" }
  };
  return configs[kind];
}

function pruneUserScopeDraft() {
  const scope = normalizeUserResourceScope(state.userScopeDraft);
  if (!scope.accountIds.length) {
    state.userScopeDraft = normalizeUserResourceScope();
    return;
  }
  if (!scope.campaignIds.length) {
    scope.adsetIds = [];
    scope.adIds = [];
  }
  if (!scope.adsetIds.length) {
    scope.adIds = [];
  }
  state.userScopeDraft = scope;
}

function selectedUserScopeRows(kind) {
  const config = userScopeConfig(kind);
  const selectedIds = state.userScopeDraft[config.key] || [];
  const candidates = new Map(userScopeCandidates(kind).map((row) => [userScopeIdForKind(row, kind), row]));
  return selectedIds.map((id) => candidates.get(id) || { id, name: "", stale: true });
}

function renderUserScopeOption(row, kind, selectedIds) {
  const id = userScopeIdForKind(row, kind);
  return `
    <label class="resource-option">
      <input type="checkbox" data-user-scope-kind="${kind}" data-user-scope-id="${escapeHtml(id)}" ${selectedIds.has(id) ? "checked" : ""}>
      <span class="resource-option-main">
        <strong>${escapeHtml(userScopeLabel(row, kind))}</strong>
        <small>${escapeHtml(userScopeSecondary(row, kind))}</small>
      </span>
      <span class="resource-status">可选</span>
    </label>
  `;
}

function renderSelectedUserScope(kind) {
  const config = userScopeConfig(kind);
  const rows = selectedUserScopeRows(kind);
  const candidateCount = userScopeCandidates(kind).length;
  if (!rows.length) {
    return `<div class="empty-inline">${escapeHtml(config.defaultText)}${candidateCount ? ` · 候选 ${candidateCount} 个` : ""}</div>`;
  }
  return rows.map((row) => {
    const id = userScopeIdForKind(row, kind);
    const stale = row?.stale === true;
    return `
      <article class="selected-resource-row ${stale ? "stale" : ""}">
        <span class="selected-resource-main">
          <strong>${escapeHtml(stale ? id : userScopeLabel(row, kind))}</strong>
          <small>${escapeHtml(stale ? "不在当前候选资源中，可保留或删除" : userScopeSecondary(row, kind))}</small>
        </span>
        <span class="selected-resource-actions">
          <button type="button" title="删除" aria-label="删除" data-user-scope-action="remove" data-user-scope-kind="${kind}" data-user-scope-id="${escapeHtml(id)}">
            <i data-lucide="trash-2"></i>
          </button>
        </span>
      </article>
    `;
  }).join("");
}

function shouldShowUserScopeKind(kind) {
  const scope = state.userScopeDraft || normalizeUserResourceScope();
  if (kind === "accounts") return true;
  if (kind === "campaigns") return scope.accountIds.length > 0;
  if (kind === "adsets") return scope.campaignIds.length > 0;
  return scope.adsetIds.length > 0;
}

function renderUserScopeSection(kind) {
  if (!shouldShowUserScopeKind(kind)) return "";
  const config = userScopeConfig(kind);
  const selectedIds = new Set(state.userScopeDraft[config.key] || []);
  const rows = filteredUserScopeCandidates(kind);
  const isOpen = state.userScopeUi.open === kind;
  return `
    <section class="user-scope-section" data-user-scope-section="${kind}">
      <div class="resource-field-head">
        <label>${escapeHtml(config.label)}范围</label>
        <span>${selectedIds.size ? `已选 ${selectedIds.size} 个` : "默认规则"}</span>
      </div>
      <div class="resource-picker" data-user-scope-picker="${kind}">
        <button class="select-button resource-picker-toggle" type="button" data-user-scope-toggle="${kind}" aria-expanded="${String(isOpen)}">
          <span>${escapeHtml(selectedIds.size ? `已选 ${selectedIds.size} 个${config.label}` : config.defaultText)}</span>
          <i data-lucide="chevron-down"></i>
        </button>
        <div class="resource-dropdown" ${isOpen ? "" : "hidden"}>
          <div class="resource-search">
            <i data-lucide="search"></i>
            <input type="search" value="${escapeHtml(state.userScopeUi.query[kind] || "")}" placeholder="${escapeHtml(config.placeholder)}" data-user-scope-search="${kind}">
          </div>
          <div class="resource-toolbar">
            <button type="button" data-user-scope-action="select-filtered" data-user-scope-kind="${kind}">选择当前</button>
            <button type="button" data-user-scope-action="clear" data-user-scope-kind="${kind}">清空选择</button>
          </div>
          <div class="resource-option-list">
            ${rows.length ? rows.map((row) => renderUserScopeOption(row, kind, selectedIds)).join("") : `<div class="empty-inline">没有匹配的候选项。</div>`}
          </div>
        </div>
      </div>
      <div class="selected-resource-list compact-selected-list">${renderSelectedUserScope(kind)}</div>
    </section>
  `;
}

function renderUserScopeBuilder() {
  pruneUserScopeDraft();
  const container = root.querySelector("#userScopeBuilder");
  if (!container) return;
  const form = root.querySelector("#userForm");
  const role = formValue(form, "role") || "user";
  const accountCount = state.userScopeDraft.accountIds.length;
  const defaultText = accountCount
    ? "账户已收窄；下级不选择时默认全选。"
    : role === "admin" ? "管理员未选择账户时默认拥有全部账户。" : "普通用户未选择账户时没有任何账户数据权限。";
  container.innerHTML = `
    <div class="user-scope-head">
      <span>数据权限</span>
      <small>${escapeHtml(defaultText)}</small>
    </div>
    <div class="user-scope-stack">
      ${["accounts", "campaigns", "adsets", "ads"].map(renderUserScopeSection).join("")}
    </div>
  `;
  refreshIcons();
}

function setUserScopeSelection(kind, ids) {
  const config = userScopeConfig(kind);
  state.userScopeDraft[config.key] = normalizeUserScopeIds(ids);
  if (kind === "accounts") {
    state.userScopeDraft.campaignIds = [];
    state.userScopeDraft.adsetIds = [];
    state.userScopeDraft.adIds = [];
  }
  if (kind === "campaigns") {
    state.userScopeDraft.adsetIds = [];
    state.userScopeDraft.adIds = [];
  }
  if (kind === "adsets") {
    state.userScopeDraft.adIds = [];
  }
  pruneUserScopeDraft();
  renderUserScopeBuilder();
}

function toggleUserScopeDropdown(kind) {
  state.userScopeUi.open = state.userScopeUi.open === kind ? "" : kind;
  renderUserScopeBuilder();
  if (state.userScopeUi.open) {
    window.setTimeout(() => root.querySelector(`[data-user-scope-search="${kind}"]`)?.focus(), 0);
  }
}

function handleUserScopeClick(event) {
  const toggle = event.target.closest("[data-user-scope-toggle]");
  if (toggle) {
    toggleUserScopeDropdown(toggle.dataset.userScopeToggle);
    return;
  }
  const actionButton = event.target.closest("[data-user-scope-action]");
  if (!actionButton) return;
  const kind = actionButton.dataset.userScopeKind;
  const action = actionButton.dataset.userScopeAction;
  const config = userScopeConfig(kind);
  const current = state.userScopeDraft[config.key] || [];
  if (action === "select-filtered") {
    const additions = filteredUserScopeCandidates(kind).map((row) => userScopeIdForKind(row, kind)).filter(Boolean);
    setUserScopeSelection(kind, [...current, ...additions]);
  }
  if (action === "clear") {
    setUserScopeSelection(kind, []);
  }
  if (action === "remove") {
    setUserScopeSelection(kind, current.filter((id) => id !== actionButton.dataset.userScopeId));
  }
}

function handleUserScopeInput(event) {
  const input = event.target.closest("[data-user-scope-search]");
  if (!input) return;
  const kind = input.dataset.userScopeSearch;
  const value = input.value;
  state.userScopeUi.query[kind] = value;
  renderUserScopeBuilder();
  window.setTimeout(() => {
    const nextInput = root.querySelector(`[data-user-scope-search="${kind}"]`);
    nextInput?.focus();
    nextInput?.setSelectionRange?.(value.length, value.length);
  }, 0);
}

function handleUserScopeChange(event) {
  const checkbox = event.target.closest("[data-user-scope-kind][data-user-scope-id]");
  if (!checkbox) return;
  const kind = checkbox.dataset.userScopeKind;
  const config = userScopeConfig(kind);
  const current = new Set(state.userScopeDraft[config.key] || []);
  if (checkbox.checked) {
    current.add(checkbox.dataset.userScopeId);
  } else {
    current.delete(checkbox.dataset.userScopeId);
  }
  setUserScopeSelection(kind, [...current]);
}

function setModalOpen(id, isOpen) {
  const modal = root.querySelector(`#${id}`);
  if (modal) modal.hidden = !isOpen;
}

function setMessage(id, message = "") {
  const element = root.querySelector(`#${id}`);
  if (element) element.textContent = message;
}

function openUserModal(user = null) {
  const form = root.querySelector("#userForm");
  if (!form) return;
  form.reset();
  setMessage("userFormMessage");
  const isEdit = Boolean(user);
  form.elements.id.value = user?.id || "";
  form.elements.username.value = user?.username || "";
  form.elements.username.disabled = isEdit;
  form.elements.displayName.value = user?.displayName || "";
  form.elements.role.value = user?.role || "user";
  form.elements.status.value = user?.status || "active";
  state.userScopeDraft = normalizeUserResourceScope(user?.resourceScope || {}, user?.accountIds || []);
  state.userScopeUi = {
    open: "",
    query: {
      accounts: "",
      campaigns: "",
      adsets: "",
      ads: ""
    }
  };
  const passwordField = root.querySelector("[data-password-field]");
  if (passwordField) passwordField.hidden = isEdit;
  form.elements.password.required = !isEdit;
  form.elements.password.value = "";
  const title = root.querySelector("#userModalTitle");
  if (title) title.textContent = isEdit ? `编辑 ${user.username}` : "新增用户";
  renderUserScopeBuilder();
  setModalOpen("userModal", true);
  window.setTimeout(() => {
    const focusTarget = isEdit ? form.elements.displayName : form.elements.username;
    focusTarget?.focus();
  }, 0);
}

function closeUserModal() {
  setModalOpen("userModal", false);
}

function openPasswordModal(user) {
  const form = root.querySelector("#passwordForm");
  if (!form || !user) return;
  form.reset();
  form.elements.id.value = user.id;
  setMessage("passwordFormMessage");
  const title = root.querySelector("#passwordModalTitle");
  if (title) title.textContent = `重置 ${user.username} 密码`;
  setModalOpen("passwordModal", true);
  window.setTimeout(() => form.elements.password?.focus(), 0);
}

function closePasswordModal() {
  setModalOpen("passwordModal", false);
}

function openDeleteUserModal(user) {
  if (!user) return;
  const input = root.querySelector("#deleteUserId");
  if (input) input.value = user.id;
  const message = root.querySelector("#deleteUserMessage");
  if (message) {
    message.textContent = `确认删除用户 ${user.username}？该用户会被立即登出，账户范围也会同步清理。`;
  }
  setModalOpen("deleteUserModal", true);
}

function closeDeleteUserModal() {
  setModalOpen("deleteUserModal", false);
}

function closeActiveUserModal() {
  const deleteModal = root.querySelector("#deleteUserModal");
  const passwordModal = root.querySelector("#passwordModal");
  const userModal = root.querySelector("#userModal");
  if (deleteModal && !deleteModal.hidden) {
    closeDeleteUserModal();
    return true;
  }
  if (passwordModal && !passwordModal.hidden) {
    closePasswordModal();
    return true;
  }
  if (userModal && !userModal.hidden) {
    closeUserModal();
    return true;
  }
  return false;
}

function handleUserModalEscape(event) {
  if (state.activeTab === "users" && event.key === "Escape") {
    closeActiveUserModal();
  }
}

function bindUsersEvents() {
  root.querySelector("#reloadUsersButton")?.addEventListener("click", async () => {
    await loadUsers();
    renderAdminApp();
  });
  root.querySelector("#openCreateUserButton")?.addEventListener("click", () => openUserModal());
  root.querySelectorAll("[data-edit-user]").forEach((button) => {
    button.addEventListener("click", () => {
      const user = selectedUser(button.dataset.editUser);
      if (user) openUserModal(user);
    });
  });
  root.querySelectorAll("[data-toggle-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      const user = selectedUser(button.dataset.toggleUser);
      if (!user) return;
      try {
        await updateUser(user.id, {
          displayName: user.displayName,
          role: user.role,
          status: user.status === "disabled" ? "active" : "disabled",
          accountIds: user.accountIds || []
        });
        await Promise.all([loadUsers(), loadAudit()]);
        setStatus("用户状态已更新");
        renderAdminApp();
      } catch (error) {
        setStatus(error.message || "用户状态更新失败");
      }
    });
  });
  root.querySelectorAll("[data-password-user]").forEach((button) => {
    button.addEventListener("click", () => {
      const user = selectedUser(button.dataset.passwordUser);
      if (user) openPasswordModal(user);
    });
  });
  root.querySelectorAll("[data-delete-user]").forEach((button) => {
    button.addEventListener("click", () => {
      const user = selectedUser(button.dataset.deleteUser);
      if (user) openDeleteUserModal(user);
    });
  });
  root.querySelector("#closeUserModalButton")?.addEventListener("click", closeUserModal);
  root.querySelector("#cancelUserModalButton")?.addEventListener("click", closeUserModal);
  root.querySelector("#closePasswordModalButton")?.addEventListener("click", closePasswordModal);
  root.querySelector("#cancelPasswordModalButton")?.addEventListener("click", closePasswordModal);
  root.querySelector("#closeDeleteUserModalButton")?.addEventListener("click", closeDeleteUserModal);
  root.querySelector("#cancelDeleteUserButton")?.addEventListener("click", closeDeleteUserModal);
  root.querySelector("#userForm [name='role']")?.addEventListener("change", renderUserScopeBuilder);
  root.querySelector("#userScopeBuilder")?.addEventListener("click", handleUserScopeClick);
  root.querySelector("#userScopeBuilder")?.addEventListener("input", handleUserScopeInput);
  root.querySelector("#userScopeBuilder")?.addEventListener("change", handleUserScopeChange);
  root.querySelectorAll(".modal-backdrop").forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeActiveUserModal();
    });
  });
  if (!userModalEscapeBound) {
    document.addEventListener("keydown", handleUserModalEscape);
    userModalEscapeBound = true;
  }
  root.querySelector("#userForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = {
      username: formValue(form, "username"),
      password: String(new FormData(form).get("password") || ""),
      displayName: formValue(form, "displayName"),
      role: formValue(form, "role"),
      status: formValue(form, "status"),
      accountIds: normalizeUserResourceScope(state.userScopeDraft).accountIds,
      resourceScope: normalizeUserResourceScope(state.userScopeDraft)
    };
    const id = form.elements.id.value;
    if (id) {
      delete payload.password;
    } else {
      form.elements.password.required = true;
    }
    try {
      if (id) {
        await updateUser(id, payload);
      } else {
        await createUser(payload);
      }
      closeUserModal();
      await Promise.all([loadUsers(), loadAudit()]);
      setStatus("用户已保存");
      renderAdminApp();
    } catch (error) {
      setMessage("userFormMessage", error.message || "用户保存失败");
    }
  });
  root.querySelector("#passwordForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const id = form.elements.id.value;
    const password = String(new FormData(form).get("password") || "");
    if (!id || !password) {
      setMessage("passwordFormMessage", "请选择用户并输入新密码");
      return;
    }
    try {
      await jsonFetch(`/api/admin/users/${encodeURIComponent(id)}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      closePasswordModal();
      await loadAudit();
      setStatus("密码已重置");
      renderAdminApp();
    } catch (error) {
      setMessage("passwordFormMessage", error.message || "密码重置失败");
    }
  });
  root.querySelector("#confirmDeleteUserButton")?.addEventListener("click", async () => {
    const id = root.querySelector("#deleteUserId")?.value || "";
    if (!id) return;
    try {
      await deleteUserRequest(id);
      closeDeleteUserModal();
      await Promise.all([loadUsers(), loadAudit()]);
      setStatus("用户已删除");
      renderAdminApp();
    } catch (error) {
      const message = root.querySelector("#deleteUserMessage");
      if (message) message.textContent = error.message || "用户删除失败";
    }
  });
}

function createUser(payload) {
  return jsonFetch("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

function updateUser(id, payload) {
  return jsonFetch(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

function deleteUserRequest(id) {
  return jsonFetch(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function invalidDate() {
  return new Date(Number.NaN);
}

function displayPartsFromInstant(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
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

function toDateValue(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function toDateTimeInputValue(date) {
  return `${toDateValue(date)}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
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

function formatIso(value) {
  return formatInstantInDisplayTimeZone(value);
}

function formatDuration(ms) {
  const value = Number(ms || 0);
  if (!value) return "-";
  if (value < 1000) return `${value}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
  return `${(value / 60_000).toFixed(1)}m`;
}

function formatMoney(value) {
  return `$${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseIdInput(value) {
  const ids = String(value || "").split(/[\s,;，；]+/)
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

function settingsEls() {
  return {
    settingsCaption: root.querySelector("#settingsCaption"),
    settingsStatus: root.querySelector("#settingsStatus"),
    monitorStatusGrid: root.querySelector("#monitorStatusGrid"),
    envConfigCaption: root.querySelector("#envConfigCaption"),
    envFileStatus: root.querySelector("#envFileStatus"),
    envConfigGrid: root.querySelector("#envConfigGrid"),
    monitorAccountsInput: root.querySelector("#monitorAccountsInput"),
    resetSettingsButton: root.querySelector("#resetSettingsButton"),
    saveSettingsButton: root.querySelector("#saveSettingsButton"),
    reloadSettingsButton: root.querySelector("#reloadSettingsButton"),
    refreshResourcesButton: root.querySelector("#refreshResourcesButton"),
    campaignMonitorEnabled: root.querySelector("#campaignMonitorEnabled"),
    campaignIntervalInput: root.querySelector("#campaignIntervalInput"),
    campaignResultActionInput: root.querySelector("#campaignResultActionInput"),
    campaignConcurrencyInput: root.querySelector("#campaignConcurrencyInput"),
    campaignQpsInput: root.querySelector("#campaignQpsInput"),
    campaignTimeoutInput: root.querySelector("#campaignTimeoutInput"),
    campaignMaxAttemptsInput: root.querySelector("#campaignMaxAttemptsInput"),
    campaignAutoActiveInput: root.querySelector("#campaignAutoActiveInput"),
    campaignIdsInput: root.querySelector("#campaignIdsInput"),
    campaignPickerToggle: root.querySelector("#campaignPickerToggle"),
    campaignPickerDropdown: root.querySelector("#campaignPickerDropdown"),
    campaignPickerLabel: root.querySelector("#campaignPickerLabel"),
    campaignPickerMeta: root.querySelector("#campaignPickerMeta"),
    campaignSearchInput: root.querySelector("#campaignSearchInput"),
    campaignManualIdInput: root.querySelector("#campaignManualIdInput"),
    campaignOptionList: root.querySelector("#campaignOptionList"),
    campaignSelectedList: root.querySelector("#campaignSelectedList"),
    adMonitorEnabled: root.querySelector("#adMonitorEnabled"),
    adIntervalInput: root.querySelector("#adIntervalInput"),
    adResultActionInput: root.querySelector("#adResultActionInput"),
    adConcurrencyInput: root.querySelector("#adConcurrencyInput"),
    adQpsInput: root.querySelector("#adQpsInput"),
    adTimeoutInput: root.querySelector("#adTimeoutInput"),
    adMaxAttemptsInput: root.querySelector("#adMaxAttemptsInput"),
    adIdsInput: root.querySelector("#adIdsInput"),
    adPickerToggle: root.querySelector("#adPickerToggle"),
    adPickerDropdown: root.querySelector("#adPickerDropdown"),
    adPickerLabel: root.querySelector("#adPickerLabel"),
    adPickerMeta: root.querySelector("#adPickerMeta"),
    adSearchInput: root.querySelector("#adSearchInput"),
    adManualIdInput: root.querySelector("#adManualIdInput"),
    adOptionList: root.querySelector("#adOptionList"),
    adSelectedList: root.querySelector("#adSelectedList"),
    recentRunsFilter: root.querySelector("#recentRunsFilter"),
    recentRunsBody: root.querySelector("#recentRunsBody")
  };
}

function resourceKindConfig(kind) {
  const els = settingsEls();
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

function renderSettings() {
  state.samplingSettings = normalizeSamplingSettings(state.samplingSettings || state.sampling || {});
  const settings = state.samplingSettings;
  const accounts = settings.campaignMonitor.accountIds.length
    ? settings.campaignMonitor.accountIds
    : state.monitoredAccounts.map((account) => account.id);
  const statusTextValue = state.savedSettingsSnapshot ? "" : "设置读取中";
  return `
    <section class="panel settings-panel">
      <div class="panel-head">
        <div>
          <h2>监控设置</h2>
          <span id="settingsCaption">List 1 广告系列 · List 2 广告</span>
        </div>
        <div class="settings-actions">
          <button class="icon-button" id="reloadSettingsButton" type="button" title="刷新账户设置" aria-label="刷新账户设置">
            <i data-lucide="refresh-cw"></i>
          </button>
          <button class="secondary-button" id="refreshResourcesButton" type="button">
            <i data-lucide="database-zap"></i>
            <span>刷新 ACTIVE 资源</span>
          </button>
          <button class="secondary-button" id="resetSettingsButton" type="button" disabled>
            <i data-lucide="undo-2"></i>
            <span>取消改动</span>
          </button>
          <span class="settings-status" id="settingsStatus" role="status">${escapeHtml(statusTextValue)}</span>
          <button class="primary-button" id="saveSettingsButton" type="button">
            <i data-lucide="save"></i>
            <span>保存</span>
          </button>
        </div>
      </div>
      <div class="settings-body">
        <div class="monitor-status-strip" id="monitorStatusGrid"></div>

        <section class="environment-card" aria-labelledby="environmentTitle">
          <div class="environment-head">
            <div>
              <span class="monitor-kicker">.ENV</span>
              <h3 id="environmentTitle">环境变量配置</h3>
            </div>
            <span id="envConfigCaption">读取中</span>
          </div>
          <div class="env-file-row" id="envFileStatus"></div>
          <div class="env-config-grid" id="envConfigGrid"></div>
        </section>

        <div class="monitor-grid">
          <section class="monitor-card">
            <div class="monitor-card-head">
              <div>
                <span class="monitor-kicker">List 1</span>
                <h3>广告系列监控</h3>
              </div>
              <label class="switch settings-switch">
                <input id="campaignMonitorEnabled" type="checkbox" ${settings.campaignMonitor.enabled ? "checked" : ""}>
                <span>启用</span>
              </label>
            </div>
            <div class="settings-grid two-col">
              <div class="control-group">
                <label for="campaignIntervalInput">频率(分钟)</label>
                <input id="campaignIntervalInput" type="number" min="60" max="360" step="1" value="${Number(settings.campaignMonitor.intervalMinutes)}">
              </div>
              <div class="control-group">
                <label for="campaignResultActionInput">成效口径</label>
                <input id="campaignResultActionInput" type="text" placeholder="omni_purchase" value="${escapeHtml(settings.campaignMonitor.resultAction)}">
              </div>
              <div class="control-group">
                <label for="campaignConcurrencyInput">并发</label>
                <input id="campaignConcurrencyInput" type="number" min="1" max="20" step="1" value="${Number(settings.campaignMonitor.concurrency)}">
              </div>
              <div class="control-group">
                <label for="campaignQpsInput">QPS</label>
                <input id="campaignQpsInput" type="number" min="1" max="20" step="1" value="${Number(settings.campaignMonitor.qps)}">
              </div>
              <div class="control-group">
                <label for="campaignTimeoutInput">超时(ms)</label>
                <input id="campaignTimeoutInput" type="number" min="1000" max="60000" step="500" value="${Number(settings.campaignMonitor.requestTimeoutMs)}">
              </div>
              <div class="control-group">
                <label for="campaignMaxAttemptsInput">最大尝试</label>
                <input id="campaignMaxAttemptsInput" type="number" min="1" max="20" step="1" value="${Number(settings.campaignMonitor.maxAttempts)}">
              </div>
              <input id="campaignIdsInput" type="hidden" value="${escapeHtml(settings.campaignMonitor.campaignIds.join("\n"))}">
              <div class="control-group settings-field wide resource-field">
                <div class="resource-field-head">
                  <label for="campaignPickerToggle" class="tooltip-label" data-tooltip="List 1 不限制广告系列数量；可从 ACTIVE 候选批量选择，也可手动补充 ID。实际运行频率仍取决于接口 QPS、采集耗时和账户数据量。">广告系列勾选列表</label>
                  <span id="campaignPickerMeta">候选加载中</span>
                </div>
                <div class="resource-picker" data-resource-picker="campaigns">
                  <button class="select-button resource-picker-toggle" id="campaignPickerToggle" type="button" aria-expanded="false" aria-controls="campaignPickerDropdown">
                    <span id="campaignPickerLabel">选择广告系列</span>
                    <i data-lucide="chevron-down"></i>
                  </button>
                  <div class="resource-dropdown" id="campaignPickerDropdown" hidden>
                    <div class="resource-search">
                      <i data-lucide="search"></i>
                      <input id="campaignSearchInput" type="search" placeholder="搜索广告系列名称或 ID">
                    </div>
                    <div class="resource-toolbar">
                      <button type="button" data-resource-action="select-filtered" data-resource-kind="campaigns">全选当前</button>
                      <button type="button" data-resource-action="clear" data-resource-kind="campaigns">清空已选</button>
                      <button type="button" data-resource-action="reload" data-resource-kind="campaigns">重读候选</button>
                    </div>
                    <div class="resource-option-list" id="campaignOptionList"></div>
                  </div>
                </div>
                <div class="manual-add-row">
                  <input id="campaignManualIdInput" type="text" inputmode="numeric" placeholder="手动补充广告系列 ID">
                  <button type="button" data-resource-action="manual-add" data-resource-kind="campaigns">
                    <i data-lucide="plus"></i>
                    <span>添加</span>
                  </button>
                </div>
                <div class="selected-resource-list" id="campaignSelectedList"></div>
              </div>
              <div class="monitor-extra-grid">
                <label class="switch settings-switch tooltip-switch" data-tooltip="开启后，List 1 会按监控账户自动拉取账户下 ACTIVE 广告系列；关闭后只使用上方勾选列表。" title="开启后，List 1 会按监控账户自动拉取账户下 ACTIVE 广告系列；关闭后只使用上方勾选列表。">
                  <input id="campaignAutoActiveInput" type="checkbox" ${settings.campaignMonitor.autoActiveCampaigns ? "checked" : ""}>
                  <span>自动解析 ACTIVE 广告系列</span>
                </label>
                <div class="control-group settings-field">
                  <label for="monitorAccountsInput">监控账户 ID</label>
                  <textarea id="monitorAccountsInput" rows="3" spellcheck="false" placeholder="8462513793771963">${escapeHtml(accounts.join("\n"))}</textarea>
                </div>
              </div>
            </div>
          </section>

          <section class="monitor-card">
            <div class="monitor-card-head">
              <div>
                <span class="monitor-kicker">List 2</span>
                <h3>广告数据监控</h3>
              </div>
              <label class="switch settings-switch">
                <input id="adMonitorEnabled" type="checkbox" ${settings.adMonitor.enabled ? "checked" : ""}>
                <span>启用</span>
              </label>
            </div>
            <div class="settings-grid two-col">
              <div class="control-group">
                <label for="adIntervalInput">频率(分钟)</label>
                <input id="adIntervalInput" type="number" min="30" max="180" step="1" value="${Number(settings.adMonitor.intervalMinutes)}">
              </div>
              <div class="control-group">
                <label for="adResultActionInput">成效口径</label>
                <input id="adResultActionInput" type="text" placeholder="omni_purchase" value="${escapeHtml(settings.adMonitor.resultAction)}">
              </div>
              <div class="control-group">
                <label for="adConcurrencyInput">并发</label>
                <input id="adConcurrencyInput" type="number" min="1" max="20" step="1" value="${Number(settings.adMonitor.concurrency)}">
              </div>
              <div class="control-group">
                <label for="adQpsInput">QPS</label>
                <input id="adQpsInput" type="number" min="1" max="20" step="1" value="${Number(settings.adMonitor.qps)}">
              </div>
              <div class="control-group">
                <label for="adTimeoutInput">超时(ms)</label>
                <input id="adTimeoutInput" type="number" min="1000" max="60000" step="500" value="${Number(settings.adMonitor.requestTimeoutMs)}">
              </div>
              <div class="control-group">
                <label for="adMaxAttemptsInput">最大尝试</label>
                <input id="adMaxAttemptsInput" type="number" min="1" max="20" step="1" value="${Number(settings.adMonitor.maxAttempts)}">
              </div>
              <div class="control-group settings-field wide resource-field">
                <input id="adIdsInput" type="hidden" value="${escapeHtml(settings.adMonitor.adIds.join("\n"))}">
                <div class="resource-field-head">
                  <label for="adPickerToggle" class="tooltip-label" data-tooltip="List 2 不限制 ad 数量；建议优先选择近期有消耗且更新时间较新的广告。数量越大，单轮采集时间和触发限流的概率越高。">ad 勾选列表</label>
                  <span id="adPickerMeta">候选加载中</span>
                </div>
                <div class="resource-picker" data-resource-picker="ads">
                  <button class="select-button resource-picker-toggle" id="adPickerToggle" type="button" aria-expanded="false" aria-controls="adPickerDropdown">
                    <span id="adPickerLabel">选择 ad</span>
                    <i data-lucide="chevron-down"></i>
                  </button>
                  <div class="resource-dropdown" id="adPickerDropdown" hidden>
                    <div class="resource-search">
                      <i data-lucide="search"></i>
                      <input id="adSearchInput" type="search" placeholder="搜索广告系列、广告组、广告名称或 ID">
                    </div>
                    <div class="resource-toolbar">
                      <button type="button" data-resource-action="select-filtered" data-resource-kind="ads">全选当前</button>
                      <button type="button" data-resource-action="clear" data-resource-kind="ads">清空已选</button>
                      <button type="button" data-resource-action="reload" data-resource-kind="ads">重读候选</button>
                    </div>
                    <div class="resource-option-list" id="adOptionList"></div>
                  </div>
                </div>
                <div class="manual-add-row">
                  <input id="adManualIdInput" type="text" inputmode="numeric" placeholder="手动补充 ad ID">
                  <button type="button" data-resource-action="manual-add" data-resource-kind="ads">
                    <i data-lucide="plus"></i>
                    <span>添加</span>
                  </button>
                </div>
                <div class="selected-resource-list" id="adSelectedList"></div>
              </div>
            </div>
          </section>
        </div>

        <section class="recent-runs">
          <div class="recent-runs-head">
            <h3>最近批次</h3>
            <label class="recent-runs-filter">
              <span>列表筛选</span>
              <select id="recentRunsFilter">
                <option value="all">全部</option>
                <option value="campaigns">List 1</option>
                <option value="ads">List 2</option>
              </select>
            </label>
          </div>
          <div class="table-scroll compact-table">
            <table>
              <thead>
                <tr>
                  <th>列表</th>
                  <th>状态</th>
                  <th>上次运行</th>
                  <th>下次运行</th>
                  <th>成功/失败</th>
                  <th>重试</th>
                  <th>耗时</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody id="recentRunsBody"></tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  `;
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
    `最近一天消耗 ${formatMoney(row?.latest_day_spend || 0)}`
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
  if (pageState.total <= RESOURCE_SELECTED_PAGE_SIZE) return "";
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
  if (!config.optionList || !config.selectedList || !config.toggle || !config.dropdown) return;
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
  refreshIcons();
}

function renderResourcePickers() {
  const els = settingsEls();
  if (els.campaignIdsInput) els.campaignIdsInput.value = selectedIdsForKind("campaigns").join("\n");
  if (els.adIdsInput) els.adIdsInput.value = selectedIdsForKind("ads").join("\n");
  renderResourcePicker("campaigns");
  renderResourcePicker("ads");
}

function toggleResourceDropdown(kind, open = !state.resourceUi[kind].open) {
  state.resourceUi.campaigns.open = false;
  state.resourceUi.ads.open = false;
  state.resourceUi[kind].open = open;
  renderResourcePickers();
  if (open) {
    resourceKindConfig(kind).search?.focus();
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
  const input = root.querySelector(`[data-resource-edit-input="${kind}"]`);
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
  const ids = parseIdInput(input?.value || "");
  if (!ids.length) {
    updateDirtyState("请输入有效数字 ID");
    return;
  }
  ids.forEach((id) => addSelectedResource(kind, id));
  input.value = "";
  updateDirtyState();
}

function renderSettingsCaption() {
  const els = settingsEls();
  if (!els.settingsCaption) return;
  const campaign = state.samplingSettings.campaignMonitor;
  const ad = state.samplingSettings.adMonitor;
  els.settingsCaption.textContent = [
    `账户 ${campaign.accountIds.length || state.monitoredAccounts.length} 个`,
    `广告系列 ${campaign.campaignIds.length} 个`,
    `ad ${ad.adIds.length} 个`
  ].join(" · ");
}

function renderAccountSettings(message = "") {
  const els = settingsEls();
  if (!els.monitorAccountsInput) return;
  const accounts = state.samplingSettings.campaignMonitor.accountIds.length
    ? state.samplingSettings.campaignMonitor.accountIds
    : state.monitoredAccounts.map((account) => account.id);
  renderSettingsCaption();
  els.monitorAccountsInput.value = accounts.join("\n");
  if (message) setSettingsStatus(message);
}

function renderSamplingSettings() {
  const els = settingsEls();
  if (!els.campaignMonitorEnabled || !els.adMonitorEnabled) return;
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
}

function collectSamplingSettings() {
  const els = settingsEls();
  const accountIds = parseIdInput(els.monitorAccountsInput?.value || "");
  const campaignIds = selectedIdsForKind("campaigns");
  const adIds = selectedIdsForKind("ads");
  return normalizeSamplingSettings({
    campaignMonitor: {
      enabled: els.campaignMonitorEnabled?.checked,
      intervalMinutes: els.campaignIntervalInput?.value,
      accountIds,
      autoActiveCampaigns: els.campaignAutoActiveInput?.checked,
      campaignIds,
      datePreset: "",
      resultAction: els.campaignResultActionInput?.value,
      hourly: true,
      concurrency: els.campaignConcurrencyInput?.value,
      qps: els.campaignQpsInput?.value,
      requestTimeoutMs: els.campaignTimeoutInput?.value,
      maxAttempts: els.campaignMaxAttemptsInput?.value
    },
    adMonitor: {
      enabled: els.adMonitorEnabled?.checked,
      intervalMinutes: els.adIntervalInput?.value,
      adIds,
      datePreset: "",
      resultAction: els.adResultActionInput?.value,
      hourly: true,
      concurrency: els.adConcurrencyInput?.value,
      qps: els.adQpsInput?.value,
      requestTimeoutMs: els.adTimeoutInput?.value,
      maxAttempts: els.adMaxAttemptsInput?.value
    },
    targeted: {
      enabled: els.adMonitorEnabled?.checked,
      level: "ads",
      ids: adIds,
      intervalMinutes: 15,
      datePreset: "",
      resultAction: els.adResultActionInput?.value,
      hourly: true
    },
    activeCampaigns: {
      enabled: els.campaignMonitorEnabled?.checked,
      intervalMinutes: els.campaignIntervalInput?.value,
      datePreset: "",
      limit: campaignIds.length,
      resultAction: els.campaignResultActionInput?.value,
      hourly: true
    }
  });
}

function envStatusLabel(status) {
  if (status === "configured") return "已配置";
  if (status === "default") return "默认值";
  if (status === "missing") return "缺失";
  return "可选";
}

function collectEnvironmentEntries() {
  return [...root.querySelectorAll("[data-env-key]")].map((input) => {
    const key = input.dataset.envKey;
    const clear = root.querySelector(`[data-env-clear="${CSS.escape(key)}"]`)?.checked === true;
    const preserve = input.dataset.envSensitive === "true" && !clear && input.value === "" && input.dataset.envConfigured === "true";
    return {
      key,
      value: clear ? "" : input.value,
      preserve
    };
  });
}

function renderEnvironmentSettings() {
  const els = settingsEls();
  const environment = state.environmentSettings;
  if (!els.envConfigCaption || !els.envFileStatus || !els.envConfigGrid) return;
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
    if (Number.isFinite(rowCount)) parts.push(`写入 ${rowCount} 行`);
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

function renderMonitorStatus() {
  const els = settingsEls();
  if (!els.monitorStatusGrid || !els.recentRunsBody || !els.recentRunsFilter) return;
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

function settingsSnapshotFromCurrentForm() {
  const els = settingsEls();
  return JSON.stringify({
    accounts: parseAccountInput(els.monitorAccountsInput?.value || ""),
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
  const els = settingsEls();
  if (!els.settingsStatus) return;
  els.settingsStatus.textContent = message;
  const nextTone = tone || settingsStatusTone(message);
  if (nextTone) {
    els.settingsStatus.dataset.tone = nextTone;
  } else {
    delete els.settingsStatus.dataset.tone;
  }
}

function updateDirtyState(message = "") {
  const els = settingsEls();
  const hasSnapshot = Boolean(state.savedSettingsSnapshot);
  const dirty = hasSnapshot && settingsSnapshotFromCurrentForm() !== state.savedSettingsSnapshot;
  if (els.resetSettingsButton) els.resetSettingsButton.disabled = !dirty;
  if (message) {
    setSettingsStatus(message);
    setStatus(message);
    return;
  }
  setSettingsStatus(dirty ? "有未保存变更" : "", dirty ? "pending" : "");
}

async function loadAccountSettings(message = "") {
  try {
    const payload = await jsonFetch("/api/settings/accounts");
    state.monitoredAccounts = Array.isArray(payload.accounts) ? payload.accounts : [];
    state.accounts = state.monitoredAccounts;
    renderAccountSettings(message);
  } catch {
    renderAccountSettings("账户设置读取失败");
  }
}

async function loadSamplingSettings(message = "") {
  try {
    const payload = await jsonFetch("/api/settings/sampling");
    state.samplingSettings = normalizeSamplingSettings(payload.settings || {});
    state.sampling = state.samplingSettings;
    renderSamplingSettings();
    if (message) setSettingsStatus(message);
  } catch {
    state.samplingSettings = normalizeSamplingSettings(state.samplingSettings);
    renderSamplingSettings();
    setSettingsStatus("取样设置读取失败", "error");
  }
}

async function loadEnvironmentSettings() {
  try {
    const payload = await jsonFetch("/api/settings/environment");
    state.environmentSettings = payload.environment || null;
    state.environment = state.environmentSettings;
    state.environmentError = "";
  } catch (error) {
    state.environmentSettings = null;
    state.environmentError = error.message || "环境变量配置读取失败";
  }
  renderEnvironmentSettings();
}

async function loadMonitorStatus() {
  try {
    const payload = await jsonFetch("/api/monitor/status");
    state.monitorStatus = payload.status || null;
  } catch {
    state.monitorStatus = null;
  }
  renderMonitorStatus();
}

async function loadResourceCatalog(message = "") {
  try {
    const accountIds = state.monitoredAccounts.length
      ? state.monitoredAccounts.map((account) => String(account.id || account.account_id || "").trim()).filter(Boolean)
      : [ACTIVE_RESOURCE_ACCOUNT_ID];
    const payloads = await Promise.all([...new Set(accountIds)].map((accountId) => (
      jsonFetch(`/api/settings/resources?account_id=${encodeURIComponent(accountId)}`)
    )));
    const catalogs = payloads.map((payload) => payload.catalog || {});
    const uniqueRows = (rows, key) => {
      const map = new Map();
      rows.flat().forEach((row) => {
        const id = String(row?.[key] || row?.id || "").trim();
        if (id && !map.has(id)) map.set(id, row);
      });
      return [...map.values()];
    };
    const mergedCatalog = {
      ...(catalogs[0] || {}),
      account_id: accountIds.join(","),
      stale: catalogs.some((catalog) => catalog.stale),
      campaigns: uniqueRows(catalogs.map((catalog) => catalog.campaigns || []), "campaign_id"),
      adsets: uniqueRows(catalogs.map((catalog) => catalog.adsets || []), "adset_id"),
      ads: uniqueRows(catalogs.map((catalog) => catalog.ads || []), "ad_id")
    };
    state.resourceCatalog = {
      ...state.resourceCatalog,
      ...mergedCatalog,
      campaigns: mergedCatalog.campaigns,
      adsets: mergedCatalog.adsets,
      ads: mergedCatalog.ads
    };
    state.resourceRefresh = payloads[0]?.refresh || null;
    state.resources = {
      catalog: state.resourceCatalog,
      refresh: state.resourceRefresh
    };
    renderResourcePickers();
    renderMonitorStatus();
    if (message) updateDirtyState(message);
  } catch (error) {
    renderResourcePickers();
    updateDirtyState(error.message || "ACTIVE 候选读取失败");
  }
}

async function loadSettingsData(message = "") {
  setSettingsStatus(message || "设置读取中");
  await Promise.all([
    loadAccountSettings(),
    loadSamplingSettings(),
    loadEnvironmentSettings()
  ]);
  renderAccountSettings();
  renderSamplingSettings();
  renderEnvironmentSettings();
  if (settingsEls().monitorAccountsInput) {
    captureSavedSettingsSnapshot();
  }
  await Promise.all([
    loadResourceCatalog(),
    loadMonitorStatus()
  ]);
  if (message) updateDirtyState(message);
}

async function refreshActiveResources() {
  const els = settingsEls();
  if (els.refreshResourcesButton) els.refreshResourcesButton.disabled = true;
  updateDirtyState("ACTIVE 资源刷新中");
  try {
    const payload = await jsonFetch("/api/settings/resources/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true })
    });
    const catalog = payload.candidates || payload.catalog || {};
    state.resourceCatalog = {
      ...state.resourceCatalog,
      ...catalog,
      campaigns: Array.isArray(catalog.campaigns) ? catalog.campaigns : [],
      adsets: Array.isArray(catalog.adsets) ? catalog.adsets : [],
      ads: Array.isArray(catalog.ads) ? catalog.ads : []
    };
    state.resourceRefresh = payload.refresh || null;
    renderSamplingSettings();
    updateDirtyState("ACTIVE 资源已刷新");
  } catch (error) {
    renderSamplingSettings();
    updateDirtyState(error.message || "ACTIVE 资源刷新失败");
  } finally {
    if (els.refreshResourcesButton) els.refreshResourcesButton.disabled = false;
  }
}

async function saveSettings() {
  const els = settingsEls();
  const accounts = parseAccountInput(els.monitorAccountsInput?.value || "");
  const samplingSettings = collectSamplingSettings();
  const environmentEntries = collectEnvironmentEntries();
  if (els.saveSettingsButton) els.saveSettingsButton.disabled = true;
  updateDirtyState("保存中");
  try {
    const accountPayload = await jsonFetch("/api/settings/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accounts })
    });
    const samplingPayload = await jsonFetch("/api/settings/sampling", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: samplingSettings })
    });
    const environmentPayload = await jsonFetch("/api/settings/environment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: environmentEntries })
    });
    state.monitoredAccounts = accountPayload.accounts || [];
    state.accounts = state.monitoredAccounts;
    state.samplingSettings = normalizeSamplingSettings(samplingPayload.settings);
    state.sampling = state.samplingSettings;
    state.environmentSettings = environmentPayload.environment || state.environmentSettings;
    state.environment = state.environmentSettings;
    renderAccountSettings();
    renderSamplingSettings();
    renderEnvironmentSettings();
    await Promise.all([loadMonitorStatus(), loadAudit()]);
    captureSavedSettingsSnapshot();
    updateDirtyState("已保存");
  } catch (error) {
    updateDirtyState(error.message || "保存失败");
  } finally {
    if (els.saveSettingsButton) els.saveSettingsButton.disabled = false;
  }
}

function bindSettingsEvents() {
  const els = settingsEls();
  if (!els.saveSettingsButton) return;
  renderAccountSettings();
  renderSamplingSettings();
  renderEnvironmentSettings();
  renderMonitorStatus();
  renderResourcePickers();
  captureSavedSettingsSnapshot();

  els.reloadSettingsButton?.addEventListener("click", () => {
    loadSettingsData("已刷新").catch((error) => updateDirtyState(error.message || "设置读取失败"));
  });
  els.refreshResourcesButton?.addEventListener("click", () => {
    refreshActiveResources();
  });
  els.resetSettingsButton?.addEventListener("click", () => {
    loadSettingsData("已取消未保存改动").catch((error) => updateDirtyState(error.message || "设置读取失败"));
  });
  els.saveSettingsButton?.addEventListener("click", () => {
    saveSettings();
  });
  els.recentRunsFilter?.addEventListener("change", () => {
    state.monitorRunFilter = els.recentRunsFilter.value;
    renderMonitorStatus();
  });
  els.campaignPickerToggle?.addEventListener("click", () => toggleResourceDropdown("campaigns"));
  els.adPickerToggle?.addEventListener("click", () => toggleResourceDropdown("ads"));
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

  root.querySelector(".settings-panel")?.addEventListener("change", (event) => {
    if (event.target.closest("[data-env-key], [data-env-clear]")) {
      updateDirtyState();
      return;
    }
    const checkbox = event.target.closest(".resource-option input[type='checkbox']");
    if (checkbox) {
      const kind = checkbox.dataset.resourceKind;
      const id = checkbox.dataset.resourceId;
      if (checkbox.checked) {
        addSelectedResource(kind, id);
      } else {
        removeSelectedResource(kind, id);
      }
      return;
    }
    const input = event.target.closest("input, textarea, select");
    if (!input) return;
    state.samplingSettings = collectSamplingSettings();
    renderSamplingSettings();
    updateDirtyState();
  });

  root.querySelector(".settings-panel")?.addEventListener("input", (event) => {
    if (event.target.closest(".resource-search input, .manual-add-row input, [data-resource-edit-input]")) {
      return;
    }
    if (event.target.closest("input, textarea, select")) {
      updateDirtyState();
    }
  });

  root.querySelector(".settings-panel")?.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-resource-action]");
    if (actionButton) {
      const kind = actionButton.dataset.resourceKind;
      const action = actionButton.dataset.resourceAction;
      const id = actionButton.dataset.resourceId;
      if (action.startsWith("page-")) setSelectedResourcePage(kind, action);
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
    if (!event.target.closest("[data-resource-picker]")) {
      state.resourceUi.campaigns.open = false;
      state.resourceUi.ads.open = false;
      renderResourcePickers();
    }
  });
}

function renderQueue() {
  const queue = state.queue?.queue || {};
  const runs = queue.runSummaries || [];
  const jobs = queue.jobs || [];
  return `
    <section class="panel">
      <div class="panel-head">
        <div><h2>采集队列</h2><span>${escapeHtml(queue.generatedAt || "未读取")}</span></div>
        <div class="settings-actions">
          <select id="queueRunMode"><option value="all">全部</option><option value="campaigns">广告系列</option><option value="ads">广告</option></select>
          <button class="secondary-button" id="reloadQueueButton" type="button">刷新</button>
          <button class="secondary-button" id="recoverQueueButton" type="button">诊断/恢复</button>
          <button class="primary-button" id="runQueueButton" type="button">投递并运行</button>
        </div>
      </div>
      <div class="admin-grid">
        ${metricCard("当前批次", queue.currentRun?.runId || "-", queue.currentRun?.status || "idle")}
        ${metricCard("任务数", queue.jobPage?.total || 0, "当前筛选批次")}
        ${metricCard("运行器", state.queue?.runner?.status || "idle", state.queue?.runner?.run_id || "")}
        ${metricCard("Watchdog", state.queue?.watchdog?.scanned || 0, "扫描任务")}
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>批次</th><th>状态</th><th>任务</th><th>创建时间</th><th>操作</th></tr></thead>
          <tbody>
            ${runs.map((run) => `
              <tr>
                <td>${escapeHtml(run.runId)}</td>
                <td>${escapeHtml(run.status)}</td>
                <td>${Number(run.total || 0)}</td>
                <td>${escapeHtml(run.createdAt || "")}</td>
                <td><button type="button" data-delete-run="${escapeHtml(run.runId)}" ${["running", "queued", "retrying"].includes(run.status) ? "disabled" : ""}>删除</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>对象</th><th>状态</th><th>尝试</th><th>说明</th></tr></thead>
          <tbody>
            ${jobs.slice(0, 50).map((job) => `
              <tr><td>${escapeHtml(job.object_id || "")}</td><td>${escapeHtml(job.status || "")}</td><td>${Number(job.attempts || 0)}</td><td>${escapeHtml(job.last_error || job.completed_at || "")}</td></tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function bindQueueEvents() {
  root.querySelector("#reloadQueueButton")?.addEventListener("click", async () => {
    await loadQueue();
    setStatus("队列已刷新");
    renderAdminApp();
  });
  root.querySelector("#recoverQueueButton")?.addEventListener("click", async () => {
    await jsonFetch("/api/collection/queue/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    await loadQueue();
    setStatus("队列诊断完成");
    renderAdminApp();
  });
  root.querySelector("#runQueueButton")?.addEventListener("click", async () => {
    const mode = root.querySelector("#queueRunMode")?.value || "all";
    await jsonFetch("/api/collection/queue/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode })
    });
    await jsonFetch("/api/collection/queue/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode })
    });
    await loadQueue();
    setStatus("采集任务已投递");
    renderAdminApp();
  });
  root.querySelectorAll("[data-delete-run]").forEach((button) => {
    button.addEventListener("click", async () => {
      await jsonFetch(`/api/collection/queue/runs/${encodeURIComponent(button.dataset.deleteRun)}`, {
        method: "DELETE"
      });
      await loadQueue();
      setStatus("采集批次已删除");
      renderAdminApp();
    });
  });
}

function renderAlerts() {
  return `
    <section class="view-panel active">
      <section id="alertAiModule" class="alert-ai-module" aria-label="广告预警模板管理"></section>
    </section>
  `;
}

function renderAudit() {
  return `
    <section class="panel">
      <div class="panel-head">
        <div><h2>审计日志</h2><span>${state.auditEvents.length} 条</span></div>
        <button class="secondary-button" id="reloadAuditButton" type="button">刷新</button>
      </div>
      ${auditTable(state.auditEvents)}
    </section>
  `;
}

function auditTable(events) {
  return `
    <div class="table-scroll">
      <table>
        <thead><tr><th>时间</th><th>动作</th><th>对象</th><th>用户</th><th>摘要</th></tr></thead>
        <tbody>
          ${events.map((event) => `
            <tr>
              <td>${escapeHtml(event.createdAt || event.created_at || "")}</td>
              <td>${escapeHtml(event.action || "")}</td>
              <td>${escapeHtml([event.targetType || event.target_type, event.targetId || event.target_id].filter(Boolean).join(":"))}</td>
              <td>${escapeHtml(event.actorUserId || event.actor_user_id || "")}</td>
              <td>${escapeHtml(JSON.stringify(event.metadata || {}))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function bindAuditEvents() {
  root.querySelector("#reloadAuditButton")?.addEventListener("click", async () => {
    await loadAudit();
    setStatus("审计日志已刷新");
    renderAdminApp();
  });
}

async function init() {
  const authenticated = await loadAuth();
  if (!authenticated) {
    redirectToPlatformLogin("/admin");
    return;
  }
  await continueAfterAuth();
}

init().catch((error) => {
  root.innerHTML = `
    <section class="admin-gate">
      <div class="auth-panel">
        <h2>管理员系统加载失败</h2>
        <p class="auth-message">${escapeHtml(error.message || "未知错误")}</p>
      </div>
    </section>
  `;
});
