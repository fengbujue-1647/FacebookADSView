const root = document.getElementById("adminRoot");
const nativeFetch = window.fetch.bind(window);

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
  queue: null,
  auditEvents: [],
  status: "",
  pin: {
    configured: false,
    verified: false
  }
};

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
    renderLogin("登录已过期，请重新登录");
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
  renderLogin();
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
        <a class="secondary-button admin-side-link" href="/ads">广告看板</a>
        <a class="secondary-button admin-side-link" href="/">首页</a>
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

async function loadSettingsData() {
  const [accounts, sampling, environment, resources] = await Promise.all([
    jsonFetch("/api/settings/accounts"),
    jsonFetch("/api/settings/sampling"),
    jsonFetch("/api/settings/environment"),
    jsonFetch("/api/settings/resources")
  ]);
  state.accounts = Array.isArray(accounts.accounts) ? accounts.accounts : [];
  state.sampling = sampling.settings || {};
  state.environment = environment.environment || null;
  state.resources = {
    catalog: resources.catalog || null,
    refresh: resources.refresh || null
  };
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
    <section class="admin-layout">
      <section class="panel">
        <div class="panel-head">
          <div><h2>用户列表</h2><span>${state.users.length} 个用户</span></div>
          <button class="secondary-button" id="reloadUsersButton" type="button">刷新</button>
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
                  <td>${user.role === "admin" ? "全部" : `${(user.accountIds || []).length} 个`}</td>
                  <td class="row-actions">
                    <button type="button" data-edit-user="${escapeHtml(user.id)}">载入</button>
                    <button type="button" data-toggle-user="${escapeHtml(user.id)}">${user.status === "disabled" ? "启用" : "禁用"}</button>
                    <button type="button" data-password-user="${escapeHtml(user.id)}">重置密码</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel admin-form-panel">
        <div class="panel-head"><div><h2 id="userFormTitle">新增用户</h2><span>管理员可创建用户或调整账户范围</span></div></div>
        <form id="userForm" class="admin-form">
          <input type="hidden" name="id">
          <label><span>用户名</span><input name="username" required></label>
          <label><span>显示名</span><input name="displayName"></label>
          <label><span>初始密码</span><input name="password" type="password" autocomplete="new-password"></label>
          <label><span>角色</span><select name="role"><option value="user">普通用户</option><option value="admin">管理员</option></select></label>
          <label><span>状态</span><select name="status"><option value="active">启用</option><option value="disabled">禁用</option></select></label>
          <label class="wide"><span>账户范围，每行一个账户 ID</span><textarea name="accountIds" rows="5" placeholder="123456789012345"></textarea></label>
          <p class="muted-inline">普通用户没有账户范围时可登录，但不会看到业务数据。</p>
          <div class="admin-form-actions">
            <button class="secondary-button" type="button" id="newUserButton">新建模式</button>
            <button class="primary-button" type="submit">保存用户</button>
          </div>
        </form>
        <form id="passwordForm" class="admin-form compact-admin-form">
          <input type="hidden" name="id">
          <label><span>重置密码</span><input name="password" type="password" autocomplete="new-password"></label>
          <button class="secondary-button" type="submit">提交新密码</button>
        </form>
      </section>
    </section>
  `;
}

function selectedUser(id) {
  return state.users.find((user) => user.id === id);
}

function parseAccountIds(text) {
  return String(text || "").split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean);
}

function bindUsersEvents() {
  root.querySelector("#reloadUsersButton")?.addEventListener("click", async () => {
    await loadUsers();
    renderAdminApp();
  });
  root.querySelector("#newUserButton")?.addEventListener("click", () => {
    const form = root.querySelector("#userForm");
    form.reset();
    form.elements.id.value = "";
    form.elements.username.disabled = false;
    root.querySelector("#userFormTitle").textContent = "新增用户";
  });
  root.querySelectorAll("[data-edit-user]").forEach((button) => {
    button.addEventListener("click", () => {
      const user = selectedUser(button.dataset.editUser);
      const form = root.querySelector("#userForm");
      form.elements.id.value = user.id;
      form.elements.username.value = user.username;
      form.elements.username.disabled = true;
      form.elements.displayName.value = user.displayName || "";
      form.elements.password.value = "";
      form.elements.role.value = user.role;
      form.elements.status.value = user.status;
      form.elements.accountIds.value = accountLines(user.accountIds);
      root.querySelector("#userFormTitle").textContent = `编辑 ${user.username}`;
    });
  });
  root.querySelectorAll("[data-toggle-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      const user = selectedUser(button.dataset.toggleUser);
      await updateUser(user.id, {
        displayName: user.displayName,
        role: user.role,
        status: user.status === "disabled" ? "active" : "disabled",
        accountIds: user.accountIds || []
      });
      await loadUsers();
      setStatus("用户状态已更新");
      renderAdminApp();
    });
  });
  root.querySelectorAll("[data-password-user]").forEach((button) => {
    button.addEventListener("click", () => {
      const form = root.querySelector("#passwordForm");
      form.elements.id.value = button.dataset.passwordUser;
      form.elements.password.focus();
    });
  });
  root.querySelector("#userForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = {
      username: formValue(form, "username"),
      password: String(new FormData(form).get("password") || ""),
      displayName: formValue(form, "displayName"),
      role: formValue(form, "role"),
      status: formValue(form, "status"),
      accountIds: parseAccountIds(formValue(form, "accountIds"))
    };
    const id = form.elements.id.value;
    if (id) {
      await updateUser(id, payload);
    } else {
      await createUser(payload);
    }
    await loadUsers();
    setStatus("用户已保存");
    renderAdminApp();
  });
  root.querySelector("#passwordForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const id = form.elements.id.value;
    const password = String(new FormData(form).get("password") || "");
    if (!id || !password) {
      setStatus("请选择用户并输入新密码");
      return;
    }
    await jsonFetch(`/api/admin/users/${encodeURIComponent(id)}/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    form.reset();
    setStatus("密码已重置");
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

function renderSettings() {
  const envGroups = state.environment?.groups || [];
  const accountsText = state.accounts.map((account) => [account.id, account.name].filter(Boolean).join(" ")).join("\n");
  return `
    <section class="admin-layout">
      <section class="panel">
        <div class="panel-head"><div><h2>环境变量</h2><span>敏感值留空并勾选保留时不会覆盖原值</span></div></div>
        <form id="envForm" class="env-admin-grid">
          ${envGroups.map((group) => `
            <section class="environment-card">
              <div class="environment-head"><div><h3>${escapeHtml(group.title)}</h3></div></div>
              ${(group.items || []).map((item) => `
                <label class="admin-env-row">
                  <span>${escapeHtml(item.label)} <small>${escapeHtml(item.key)}</small></span>
                  <input data-env-key="${escapeHtml(item.key)}" value="${escapeHtml(item.editValue || "")}" placeholder="${escapeHtml(item.displayValue || "")}">
                  ${item.sensitive ? `<label class="inline-check"><input type="checkbox" data-env-preserve="${escapeHtml(item.key)}" ${item.preserveOnEmpty ? "checked" : ""}>保留原值</label>` : ""}
                </label>
              `).join("")}
            </section>
          `).join("")}
        </form>
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>监控账户</h2><span>每行：账户ID 可选名称</span></div></div>
        <textarea id="accountsText" class="admin-code-textarea" rows="7">${escapeHtml(accountsText)}</textarea>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div><h2>采样计划 JSON</h2><span>完整保存 List 1 / List 2 / 定向监控设置</span></div>
          <button class="secondary-button" id="refreshResourcesAdminButton" type="button">刷新 ACTIVE 资源</button>
        </div>
        <textarea id="samplingJson" class="admin-code-textarea" rows="18">${escapeHtml(JSON.stringify(state.sampling || {}, null, 2))}</textarea>
        <div class="admin-resource-summary">${renderResourceSummary()}</div>
      </section>
      <section class="admin-actions-row">
        <button class="secondary-button" id="reloadSettingsAdminButton" type="button">重新读取</button>
        <button class="primary-button" id="saveSettingsAdminButton" type="button">保存服务端设置</button>
      </section>
    </section>
  `;
}

function renderResourceSummary() {
  const catalog = state.resources?.catalog || {};
  const counts = catalog.counts || {};
  return `
    <span>账户：${escapeHtml(catalog.account_id || "-")}</span>
    <span>Campaigns：${counts.campaigns?.active || 0}/${counts.campaigns?.total || 0}</span>
    <span>Ads：${counts.ads?.active || 0}/${counts.ads?.total || 0}</span>
    <span>刷新状态：${escapeHtml(state.resources?.refresh?.status || "idle")}</span>
  `;
}

function parseAccounts(text) {
  return String(text || "").split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const [id, ...nameParts] = trimmed.split(/\s+/);
    return { id, name: nameParts.join(" ") };
  }).filter(Boolean);
}

function collectEnvEntries() {
  return [...root.querySelectorAll("[data-env-key]")].map((input) => {
    const key = input.dataset.envKey;
    return {
      key,
      value: input.value,
      preserve: root.querySelector(`[data-env-preserve="${CSS.escape(key)}"]`)?.checked === true
    };
  });
}

function bindSettingsEvents() {
  root.querySelector("#reloadSettingsAdminButton")?.addEventListener("click", async () => {
    await loadSettingsData();
    setStatus("设置已重新读取");
    renderAdminApp();
  });
  root.querySelector("#refreshResourcesAdminButton")?.addEventListener("click", async () => {
    await jsonFetch("/api/settings/resources/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true })
    });
    await loadSettingsData();
    setStatus("ACTIVE 资源已刷新");
    renderAdminApp();
  });
  root.querySelector("#saveSettingsAdminButton")?.addEventListener("click", async () => {
    const accounts = parseAccounts(root.querySelector("#accountsText").value);
    const sampling = JSON.parse(root.querySelector("#samplingJson").value || "{}");
    const entries = collectEnvEntries();
    await jsonFetch("/api/settings/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accounts })
    });
    await jsonFetch("/api/settings/sampling", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: sampling })
    });
    await jsonFetch("/api/settings/environment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries })
    });
    await loadSettingsData();
    await loadAudit();
    setStatus("服务端设置已保存");
    renderAdminApp();
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
    renderLogin();
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
