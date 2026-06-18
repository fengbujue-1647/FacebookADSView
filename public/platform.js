const nativeFetch = window.fetch.bind(window);

const pageMode = document.body.classList.contains("platform-login-page") ? "login" : "console";
const messageNode = document.querySelector("[data-platform-message]");
const registerMessageNode = document.querySelector("[data-register-message]");
let csrfToken = "";
let registerCodeCooldown = 0;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setMessage(message = "") {
  if (messageNode) {
    messageNode.textContent = message;
  }
}

function setRegisterMessage(message = "") {
  if (registerMessageNode) {
    registerMessageNode.textContent = message;
  }
}

function safeReturnPath() {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("return") || "/console.html";
  if (!value.startsWith("/") || value.startsWith("//")) return "/console.html";
  if (value.startsWith("/api/")) return "/console.html";
  return value;
}

function hasPermission(session, permission) {
  if (!permission) return true;
  if (session?.user?.role === "admin") return true;
  return Array.isArray(session?.permissions) && session.permissions.includes(permission);
}

async function fetchSession() {
  const response = await nativeFetch("/api/auth/me", {
    credentials: "same-origin",
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) return null;
  csrfToken = payload.csrfToken || "";
  return payload;
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
  csrfToken = payload.csrfToken || "";
  return payload;
}

async function sendRegisterCode(email) {
  const response = await nativeFetch("/api/auth/register/code", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "验证码发送失败");
  }
  return payload;
}

async function register(email, code, password) {
  const response = await nativeFetch("/api/auth/register", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code, password })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "注册失败");
  }
  csrfToken = payload.csrfToken || "";
  return payload;
}

async function logout() {
  try {
    await nativeFetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken
      },
      body: "{}"
    });
  } finally {
    window.location.href = "/login.html";
  }
}

function bindLoginForm() {
  const form = document.querySelector("[data-login-form]");
  const submit = document.querySelector("[data-login-submit]");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("");
    if (submit) {
      submit.disabled = true;
      submit.textContent = "正在登录...";
    }
    try {
      const formData = new FormData(form);
      await login(String(formData.get("username") || "").trim(), String(formData.get("password") || ""));
      window.location.href = safeReturnPath();
    } catch (error) {
      setMessage(error.message || "登录失败");
      if (submit) {
        submit.disabled = false;
        submit.textContent = "登录";
      }
    }
  });
}

function setAuthMode(mode) {
  const normalized = mode === "register" ? "register" : "login";
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    const active = button.dataset.authMode === normalized;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll("[data-auth-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.authPanel !== normalized;
  });
  setMessage("");
  setRegisterMessage("");
}

function startRegisterCodeCooldown(button) {
  registerCodeCooldown = 60;
  button.disabled = true;
  const timer = window.setInterval(() => {
    registerCodeCooldown -= 1;
    if (registerCodeCooldown <= 0) {
      window.clearInterval(timer);
      button.disabled = false;
      button.textContent = "发送验证码";
      return;
    }
    button.textContent = `${registerCodeCooldown}s`;
  }, 1000);
}

function bindRegisterForm() {
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
  });

  const form = document.querySelector("[data-register-form]");
  const codeButton = document.querySelector("[data-register-code]");
  const submit = document.querySelector("[data-register-submit]");
  if (!form) return;

  codeButton?.addEventListener("click", async () => {
    const emailInput = form.elements.email;
    setRegisterMessage("");
    if (emailInput && !emailInput.checkValidity()) {
      emailInput.reportValidity();
      return;
    }
    const email = String(new FormData(form).get("email") || "").trim();
    codeButton.disabled = true;
    codeButton.textContent = "发送中...";
    try {
      await sendRegisterCode(email);
      setRegisterMessage("验证码已发送");
      startRegisterCodeCooldown(codeButton);
    } catch (error) {
      setRegisterMessage(error.message || "验证码发送失败");
      codeButton.disabled = false;
      codeButton.textContent = "发送验证码";
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setRegisterMessage("");
    if (submit) {
      submit.disabled = true;
      submit.textContent = "注册中...";
    }
    try {
      const formData = new FormData(form);
      await register(
        String(formData.get("email") || "").trim(),
        String(formData.get("code") || "").trim(),
        String(formData.get("password") || "")
      );
      window.location.href = safeReturnPath();
    } catch (error) {
      setRegisterMessage(error.message || "注册失败");
      if (submit) {
        submit.disabled = false;
        submit.textContent = "注册";
      }
    }
  });
}

function moduleDefinitions(session) {
  return [
    {
      key: "ads",
      label: "Live Module",
      title: "FB 广告监控",
      description: "查看 Meta 广告指标、预警、AI 分析和采集队列状态。",
      href: "/ads",
      permission: "dashboard.read",
      meta: ["已接入", "数据监控"]
    },
    {
      key: "admin",
      label: "Admin",
      title: "平台管理",
      description: "管理账号、权限、环境变量、采集参数和审计日志。",
      href: "/admin",
      permission: "users.manage",
      meta: ["管理员", "权限配置"]
    },
    {
      key: "knowledge",
      label: "Next",
      title: "专属资料库",
      description: "沉淀产品资料、FAQ、制度文档和业务规则，供内部 AI 助手调用。",
      href: "",
      permission: "",
      disabled: true,
      meta: ["规划中", "RAG"]
    },
    {
      key: "tiktok",
      label: "Next",
      title: "TikTok 内容流水线",
      description: "围绕 SKU、素材、脚本和剪辑任务做内容生产自动化。",
      href: "",
      permission: "",
      disabled: true,
      meta: ["规划中", "内容运营"]
    },
    {
      key: "crawler",
      label: "Next",
      title: "竞品与素材监控",
      description: "采集竞品、素材和舆情数据，生成日报和异常提醒。",
      href: "",
      permission: "",
      disabled: true,
      meta: ["规划中", "采集任务"]
    },
    {
      key: "workflow",
      label: "Next",
      title: "业务输出模板",
      description: "自动生成报价单、日报、邮件、脚本和审批材料。",
      href: "",
      permission: "",
      disabled: true,
      meta: ["规划中", "自动输出"]
    }
  ].map((item) => ({
    ...item,
    allowed: !item.disabled && hasPermission(session, item.permission)
  }));
}

function renderUserBar(session) {
  const userBar = document.querySelector("[data-user-bar]");
  if (!userBar) return;
  const name = session.user?.displayName || session.user?.username || "用户";
  const role = session.user?.role === "admin" ? "管理员" : "用户";
  userBar.innerHTML = `
    <span>${escapeHtml(name)}</span>
    <small>${escapeHtml(role)}</small>
    <button class="secondary-button" type="button" data-logout>退出</button>
  `;
  userBar.querySelector("[data-logout]")?.addEventListener("click", logout);
}

function renderModules(session) {
  const grid = document.querySelector("[data-module-grid]");
  if (!grid) return;
  grid.innerHTML = moduleDefinitions(session).map((item) => {
    const disabled = item.disabled || !item.allowed;
    const tagText = item.disabled ? "规划中" : item.allowed ? "进入模块" : "无权限";
    const content = `
      <span>${escapeHtml(item.label)}</span>
      <h2>${escapeHtml(item.title)}</h2>
      <p>${escapeHtml(disabled && !item.disabled ? "当前账号暂无该模块权限。" : item.description)}</p>
      <div class="platform-module-meta">
        ${[tagText, ...item.meta].map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
      </div>
    `;
    if (disabled) {
      return `<article class="platform-module-card is-disabled" aria-disabled="true">${content}</article>`;
    }
    return `<a class="platform-module-card" href="${escapeHtml(item.href)}">${content}</a>`;
  }).join("");
}

async function initLoginPage() {
  bindLoginForm();
  bindRegisterForm();
  setAuthMode("login");
  const session = await fetchSession();
  if (session) {
    window.location.replace(safeReturnPath());
  }
}

async function initConsolePage() {
  const session = await fetchSession();
  if (!session) {
    window.location.replace(`/login.html?return=${encodeURIComponent("/console.html")}`);
    return;
  }
  renderUserBar(session);
  renderModules(session);
}

(pageMode === "login" ? initLoginPage : initConsolePage)().catch((error) => {
  setMessage(error.message || "页面加载失败");
});
