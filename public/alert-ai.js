(() => {
  const root = document.getElementById("alertAiModule");
  if (!root) return;

  const promptMaxLength = 1600;
  const templatePageSize = 8;
  const reportPresets = [
    {
      id: "efficiency",
      title: "效率下滑诊断",
      prompt: "请重点分析 ROAS、单次成效费用、CTR 与购买次数的变化，找出效率下滑的主要对象，并给出预算与素材层面的处理建议。"
    },
    {
      id: "scaling",
      title: "放量风险检查",
      prompt: "请判断当前对象是否适合继续放量，重点比较花费、展示、覆盖、频次和转化效率，标出需要暂停放大的异常对象。"
    },
    {
      id: "creative",
      title: "素材疲劳排查",
      prompt: "请从 CTR、点击量、频次、加购和购买链路判断是否存在素材疲劳，并输出可执行的素材测试和淘汰建议。"
    }
  ];

  const state = {
    initialized: false,
    metadata: null,
    activeTab: "templates",
    templates: {
      loading: false,
      search: "",
      metricCategory: "all",
      status: "all",
      page: 1,
      total: 0,
      pageCount: 1,
      items: [],
      timers: new Map()
    },
    drawer: {
      open: false,
      mode: "create",
      id: "",
      recipients: [],
      conditions: []
    },
    monitor: {
      evaluating: false,
      messages: [],
      pushRecords: []
    },
    entities: {
      level: "campaign",
      query: "",
      loading: false,
      open: false,
      options: [],
      selectedIds: new Set(),
      selectedMap: new Map(),
      debounceTimer: null
    },
    report: {
      generating: false,
      lastRequest: null,
      final: null,
      visibleMarkdown: "",
      pendingMarkdown: "",
      typing: false,
      error: null
    }
  };

  const $ = (selector) => root.querySelector(selector);
  const $$ = (selector) => [...root.querySelectorAll(selector)];

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function refreshIcons() {
    window.fbRefreshIcons?.();
  }

  function debounce(callback, delay = 320) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => callback(...args), delay);
    };
  }

  async function apiJson(url, options = {}) {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.message || `请求失败 (${response.status})`);
      error.status = response.status;
      error.fields = payload.fields || {};
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function todayString() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US-u-nu-latn", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date())
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function addDays(dateText, amount) {
    const date = new Date(`${dateText}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  }

  function dayDiffInclusive(since, until) {
    const from = new Date(`${since}T00:00:00Z`);
    const to = new Date(`${until}T00:00:00Z`);
    return Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  }

  function renderShell() {
    root.innerHTML = `
      <div class="alert-tabs module-inner-tabs" role="tablist" aria-label="广告预警与 AI 分析" hidden>
        <button class="alert-tab active" type="button" role="tab" data-alert-tab="templates">
          <i data-lucide="bell-ring"></i>
          <span>广告预警模板</span>
        </button>
        <button class="alert-tab" type="button" role="tab" data-alert-tab="report">
          <i data-lucide="sparkles"></i>
          <span>Agent 分析报告</span>
        </button>
      </div>

      <section class="alert-pane active" data-alert-pane="templates">
        <section class="panel alert-panel">
          <div class="panel-head alert-panel-head">
            <div>
              <h2>广告预警模板管理</h2>
              <span id="alertTemplateCaption">加载中</span>
            </div>
            <button class="primary-button" id="newAlertTemplateButton" type="button">
              <i data-lucide="plus"></i>
              <span>新建模板</span>
            </button>
            <button class="secondary-button" id="evaluateAlertsButton" type="button">
              <i data-lucide="send"></i>
              <span>立即评估</span>
            </button>
          </div>
          <div class="alert-filter-grid">
            <div class="control-group">
              <label for="alertTemplateSearch">搜索模板</label>
              <input id="alertTemplateSearch" type="search" placeholder="模板名称、指标或通知渠道">
            </div>
            <div class="control-group">
              <label for="alertMetricCategoryFilter">指标类别</label>
              <select id="alertMetricCategoryFilter"></select>
            </div>
            <div class="control-group">
              <label for="alertStatusFilter">状态</label>
              <select id="alertStatusFilter">
                <option value="all">全部状态</option>
                <option value="enabled">已启用</option>
                <option value="disabled">已停用</option>
              </select>
            </div>
          </div>
          <div class="alert-table-wrap">
            <table class="alert-table">
              <thead>
                <tr>
                  <th>模板名称</th>
                  <th>监控指标</th>
                  <th>预警规则</th>
                  <th>通知渠道</th>
                  <th>更新时间</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody id="alertTemplateBody"></tbody>
            </table>
            <div class="alert-empty" id="alertTemplateEmpty" hidden>
              <div class="alert-empty-art" aria-hidden="true">
                <svg viewBox="0 0 160 112" role="img">
                  <path d="M24 84h112" />
                  <rect x="34" y="20" width="92" height="58" rx="8" />
                  <path d="M52 40h56M52 56h38" />
                  <circle cx="118" cy="70" r="18" />
                  <path d="M111 70l5 5 11-12" />
                </svg>
              </div>
              <strong>暂无预警模板</strong>
              <span>新建一个模板后即可在这里统一管理状态、规则和通知渠道。</span>
            </div>
          </div>
          <div class="alert-pagination" id="alertTemplatePagination"></div>
        </section>

        <section class="alert-history-grid">
          <section class="panel alert-panel">
            <div class="panel-head alert-panel-head">
              <div>
                <h2>历史预警消息</h2>
                <span id="alertMessageCaption">等待评估</span>
              </div>
            </div>
            <div class="alert-table-wrap compact-history">
              <table class="alert-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>对象</th>
                    <th>模板</th>
                    <th>内容</th>
                  </tr>
                </thead>
                <tbody id="alertMessageBody"></tbody>
              </table>
            </div>
          </section>
          <section class="panel alert-panel">
            <div class="panel-head alert-panel-head">
              <div>
                <h2>消息推送记录</h2>
                <span id="alertPushCaption">等待评估</span>
              </div>
            </div>
            <div class="alert-table-wrap compact-history">
              <table class="alert-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>渠道</th>
                    <th>状态</th>
                    <th>对象</th>
                  </tr>
                </thead>
                <tbody id="alertPushBody"></tbody>
              </table>
            </div>
          </section>
        </section>
      </section>

      <section class="alert-pane" data-alert-pane="report" hidden>
        <div class="alert-report-layout">
          <section class="panel alert-panel report-input-panel">
            <div class="panel-head alert-panel-head">
              <div>
                <h2>范围与分析目标</h2>
                <span id="reportScopeCaption">最长查询 90 天</span>
              </div>
              <button class="primary-button" id="generateReportButton" type="button">
                <i data-lucide="send"></i>
                <span>生成报告</span>
              </button>
            </div>
            <div class="report-input-body" id="reportInputBody">
              <div class="report-grid">
                <div class="control-group">
                  <label for="reportSince">开始日期</label>
                  <input id="reportSince" data-report-input type="date">
                  <span class="field-error" data-error-for="since"></span>
                </div>
                <div class="control-group">
                  <label for="reportUntil">结束日期</label>
                  <input id="reportUntil" data-report-input type="date">
                  <span class="field-error" data-error-for="until"></span>
                </div>
                <div class="control-group quick-report-group">
                  <label>快捷时间</label>
                  <div class="quick-window report-quick">
                    <button type="button" data-report-input data-report-range="today">今天</button>
                    <button type="button" data-report-input data-report-range="yesterday">昨天</button>
                    <button type="button" data-report-input data-report-range="7">近 7 天</button>
                    <button type="button" data-report-input data-report-range="14">近 14 天</button>
                    <button type="button" data-report-input data-report-range="30">近 30 天</button>
                  </div>
                </div>
              </div>

              <div class="control-group report-level-group">
                <label>分析层级</label>
                <div class="report-levels" id="reportLevelGroup"></div>
                <span class="field-error" data-error-for="level"></span>
              </div>

              <div class="control-group entity-field">
                <label for="entityPickerSearch">分析对象</label>
                <div class="entity-picker">
                  <button class="select-button entity-toggle" id="entityPickerToggle" data-report-input type="button" aria-expanded="false">
                    <span id="entityPickerLabel">选择分析对象</span>
                    <i data-lucide="chevron-down"></i>
                  </button>
                  <div class="entity-dropdown" id="entityPickerDropdown" hidden>
                    <div class="resource-search">
                      <i data-lucide="search"></i>
                      <input id="entityPickerSearch" data-report-input type="search" placeholder="搜索名称或 ID">
                    </div>
                    <div class="resource-toolbar">
                      <button type="button" data-report-input data-entity-action="select-all">全选当前</button>
                      <button type="button" data-report-input data-entity-action="clear">清空已选</button>
                    </div>
                    <div class="entity-option-list" id="entityOptionList"></div>
                  </div>
                </div>
                <div class="entity-selected-list" id="entitySelectedList"></div>
                <span class="field-error" data-error-for="entityIds"></span>
              </div>

              <div class="control-group">
                <label for="reportPrompt">方案 A 文本输入</label>
                <textarea id="reportPrompt" data-report-input maxlength="${promptMaxLength}" rows="5" placeholder="例如：帮我分析最近 7 天哪些广告系列出现花费上涨但 ROAS 下滑，并输出下一步预算和素材处理建议。"></textarea>
                <div class="prompt-meta">
                  <span class="field-error" data-error-for="prompt"></span>
                  <strong id="reportPromptCount">0 / ${promptMaxLength}</strong>
                </div>
              </div>

              <div class="preset-grid" id="reportPresetGrid"></div>
            </div>
          </section>

          <section class="panel alert-panel report-output-panel">
            <div class="panel-head alert-panel-head">
              <div>
                <h2>生成结果</h2>
                <span id="reportStatusText">等待生成</span>
              </div>
              <div class="report-actions" id="reportActions" hidden>
                <button class="secondary-button" id="copyReportButton" type="button">
                  <i data-lucide="copy"></i>
                  <span>复制 Markdown</span>
                </button>
                <button class="secondary-button" id="exportReportButton" type="button">
                  <i data-lucide="download"></i>
                  <span>导出</span>
                </button>
              </div>
            </div>
            <div class="report-progress" id="reportProgress"></div>
            <div class="report-output" id="reportOutput">
              <div class="alert-empty report-empty">
                <div class="alert-empty-art" aria-hidden="true">
                  <svg viewBox="0 0 160 112" role="img">
                    <path d="M24 88h112" />
                    <rect x="32" y="18" width="64" height="76" rx="8" />
                    <path d="M46 38h36M46 54h28M46 70h40" />
                    <path d="M112 30l5 14 14 5-14 5-5 14-5-14-14-5 14-5 5-14z" />
                  </svg>
                </div>
                <strong>尚未生成报告</strong>
                <span>选择范围并输入分析目标后，报告会以流式方式显示在这里。</span>
              </div>
            </div>
          </section>
        </div>
      </section>

      <div class="alert-drawer" id="templateDrawer" hidden>
        <div class="alert-drawer-backdrop" data-drawer-close></div>
        <form class="alert-drawer-panel" id="templateForm" novalidate>
          <div class="alert-drawer-head">
            <div>
              <h2 id="templateDrawerTitle">新建预警模板</h2>
              <span id="templateRulePreview">配置规则后自动生成描述</span>
            </div>
            <button class="icon-button" type="button" data-drawer-close aria-label="关闭">
              <i data-lucide="x"></i>
            </button>
          </div>
          <div class="alert-form-grid">
            <div class="control-group alert-field wide" data-field="name">
              <label for="templateName">模板名称</label>
              <input id="templateName" name="name" type="text" maxlength="60" autocomplete="off">
              <span class="field-error" data-error-for="name"></span>
            </div>
            <div class="control-group alert-field" data-field="targetLevel">
              <label for="templateTargetLevel">监控层级</label>
              <select id="templateTargetLevel" name="targetLevel"></select>
              <span class="field-error" data-error-for="targetLevel"></span>
            </div>
            <div class="control-group alert-field" data-field="logic">
              <label for="templateLogic">条件组合</label>
              <select id="templateLogic" name="logic">
                <option value="and">全部满足 AND</option>
                <option value="or">任一满足 OR</option>
              </select>
            </div>
            <div class="control-group alert-field wide" data-field="targetIds">
              <label for="templateTargetIds">监控目标 ID</label>
              <textarea id="templateTargetIds" name="targetIds" rows="3" placeholder="留空表示监控该层级全部对象；多个 ID 可换行或逗号分隔。"></textarea>
              <span class="field-error" data-error-for="targetIds"></span>
            </div>
            <div class="control-group alert-field wide" data-field="conditions">
              <div class="condition-head">
                <label>指标监控条件</label>
                <button type="button" class="secondary-button mini-button" id="addConditionButton">
                  <i data-lucide="plus"></i>
                  <span>添加条件</span>
                </button>
              </div>
              <div class="condition-list" id="templateConditionList"></div>
              <span class="field-error" data-error-for="conditions"></span>
            </div>
            <div class="control-group alert-field" data-field="windowType">
              <label for="templateWindowType">时间窗口</label>
              <select id="templateWindowType" name="windowType"></select>
              <span class="field-error" data-error-for="windowType"></span>
            </div>
            <div class="control-group alert-field" data-field="windowMinutes" id="customWindowGroup" hidden>
              <label for="templateWindowMinutes">自定义分钟数</label>
              <input id="templateWindowMinutes" name="windowMinutes" type="number" min="5" max="1440" step="1">
              <span class="field-error" data-error-for="windowMinutes"></span>
            </div>
            <div class="control-group alert-field">
              <label for="templateSeverity">异常等级</label>
              <select id="templateSeverity" name="severity">
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
            </div>
            <div class="control-group alert-field wide" data-field="channels">
              <label>通知渠道</label>
              <div class="channel-grid" id="templateChannels"></div>
            </div>
            <div class="control-group alert-field wide" data-field="recipients" id="recipientGroup" hidden>
              <label for="recipientInput">接收人邮箱</label>
              <div class="recipient-box">
                <div class="recipient-tags" id="recipientTags"></div>
                <input id="recipientInput" type="text" placeholder="输入邮箱后按回车">
              </div>
              <span class="field-error" data-error-for="recipients"></span>
            </div>
            <div class="control-group alert-field wide" data-field="webhookUrl" id="webhookGroup" hidden>
              <label for="templateWebhookUrl">外部接口 URL</label>
              <input id="templateWebhookUrl" name="webhookUrl" type="url" placeholder="https://example.com/webhook">
              <span class="field-error" data-error-for="webhookUrl"></span>
            </div>
            <div class="control-group alert-field wide" data-field="feishuWebhookUrl" id="feishuGroup" hidden>
              <label for="templateFeishuWebhookUrl">飞书机器人 Webhook</label>
              <input id="templateFeishuWebhookUrl" name="feishuWebhookUrl" type="url" placeholder="留空使用服务端 FEISHU_ALERT_WEBHOOK_URL">
              <span class="field-error" data-error-for="feishuWebhookUrl"></span>
            </div>
          </div>
          <div class="alert-drawer-foot">
            <button class="secondary-button" type="button" data-drawer-close>取消</button>
            <button class="primary-button" id="saveTemplateButton" type="submit">
              <i data-lucide="save"></i>
              <span>保存模板</span>
            </button>
          </div>
        </form>
      </div>

      <div class="alert-toast-stack" id="alertToastStack" aria-live="polite"></div>
    `;
  }

  function renderMetadataControls() {
    const metadata = state.metadata;
    const categorySelect = $("#alertMetricCategoryFilter");
    categorySelect.innerHTML = `<option value="all">全部类别</option>${metadata.metricCategories.map((category) => (
      `<option value="${category.id}">${escapeHtml(category.label)}</option>`
    )).join("")}`;

    $("#templateTargetLevel").innerHTML = metadata.targetLevels.map((level) => (
      `<option value="${level.id}">${escapeHtml(level.label)}</option>`
    )).join("");
    $("#templateWindowType").innerHTML = metadata.windows.map((item) => (
      `<option value="${item.id}">${escapeHtml(item.label)}</option>`
    )).join("");
    $("#templateChannels").innerHTML = metadata.channels.map((channel) => `
      <label class="channel-option">
        <input type="checkbox" name="templateChannels" value="${channel.id}">
        <span>${escapeHtml(channel.label)}</span>
      </label>
    `).join("");
    $("#reportLevelGroup").innerHTML = metadata.report.levels.map((level) => `
      <label class="level-option">
        <input data-report-input type="radio" name="reportLevel" value="${level.id}" ${level.id === state.entities.level ? "checked" : ""}>
        <span>${escapeHtml(level.label)}</span>
      </label>
    `).join("");
    $("#reportPresetGrid").innerHTML = reportPresets.map((preset) => `
      <button class="preset-card" type="button" data-report-input data-preset-id="${preset.id}">
        <strong>${escapeHtml(preset.title)}</strong>
        <span>${escapeHtml(preset.prompt)}</span>
      </button>
    `).join("");
  }

  function toast(message, tone = "success") {
    const stack = $("#alertToastStack");
    const item = document.createElement("div");
    item.className = `alert-toast ${tone}`;
    item.textContent = message;
    stack.appendChild(item);
    setTimeout(() => item.remove(), 3200);
  }

  function setActiveTab(tab) {
    state.activeTab = tab;
    $$("[data-alert-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.alertTab === tab);
    });
    $$("[data-alert-pane]").forEach((pane) => {
      const active = pane.dataset.alertPane === tab;
      pane.hidden = !active;
      pane.classList.toggle("active", active);
    });
    refreshIcons();
  }

  function renderTemplateTable() {
    const body = $("#alertTemplateBody");
    const empty = $("#alertTemplateEmpty");
    const caption = $("#alertTemplateCaption");
    const pagination = $("#alertTemplatePagination");
    caption.textContent = state.templates.loading ? "加载中" : `${state.templates.total} 个模板`;

    if (state.templates.loading) {
      empty.hidden = true;
      body.innerHTML = `<tr><td colspan="7" class="alert-loading-row">正在读取预警模板</td></tr>`;
      pagination.innerHTML = "";
      refreshIcons();
      return;
    }

    if (state.templates.items.length === 0) {
      body.innerHTML = "";
      empty.hidden = false;
      pagination.innerHTML = "";
      return;
    }

    empty.hidden = true;
    body.innerHTML = state.templates.items.map((item) => `
      <tr data-template-row="${item.id}">
        <td>
          <strong class="template-name">${escapeHtml(item.name)}</strong>
          <span class="template-severity ${item.severity}">${severityLabel(item.severity)}</span>
        </td>
        <td>
          <span>${escapeHtml(item.metricLabel)}</span>
          <small>${escapeHtml(item.metricCategoryLabel)}</small>
        </td>
        <td class="rule-cell">${escapeHtml(item.ruleDescription)}</td>
        <td>${escapeHtml(item.channelDescription)}</td>
        <td>${formatDateTime(item.updated_at)}</td>
        <td>
          <label class="alert-switch">
            <input type="checkbox" data-template-status="${item.id}" ${item.enabled ? "checked" : ""}>
            <span></span>
          </label>
        </td>
        <td>
          <div class="row-actions">
            <button type="button" data-template-action="edit" data-template-id="${item.id}" title="编辑" aria-label="编辑">
              <i data-lucide="pencil"></i>
            </button>
            <button type="button" data-template-action="copy" data-template-id="${item.id}" title="复制" aria-label="复制">
              <i data-lucide="copy"></i>
            </button>
            <button type="button" data-template-action="delete" data-template-id="${item.id}" title="删除" aria-label="删除">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </td>
      </tr>
    `).join("");

    pagination.innerHTML = `
      <span>第 ${state.templates.page} / ${state.templates.pageCount} 页</span>
      <div>
        <button type="button" data-template-page="prev" ${state.templates.page <= 1 ? "disabled" : ""}>上一页</button>
        <button type="button" data-template-page="next" ${state.templates.page >= state.templates.pageCount ? "disabled" : ""}>下一页</button>
      </div>
    `;
    refreshIcons();
  }

  function severityLabel(value) {
    return { low: "低", medium: "中", high: "高" }[value] || "中";
  }

  function formatDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return String(value).slice(0, 16).replace("T", " ");
    return date.toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hourCycle: "h23",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  async function loadTemplates() {
    state.templates.loading = true;
    renderTemplateTable();
    const params = new URLSearchParams({
      search: state.templates.search,
      metric_category: state.templates.metricCategory,
      status: state.templates.status,
      page: String(state.templates.page),
      page_size: String(templatePageSize)
    });
    try {
      const payload = await apiJson(`/api/alert-ai/templates?${params}`);
      state.templates.items = payload.items || [];
      state.templates.total = payload.total || 0;
      state.templates.page = payload.page || 1;
      state.templates.pageCount = payload.pageCount || 1;
    } catch (error) {
      toast(error.message, "error");
      state.templates.items = [];
      state.templates.total = 0;
      state.templates.pageCount = 1;
    } finally {
      state.templates.loading = false;
      renderTemplateTable();
    }
  }

  const debouncedTemplateSearch = debounce(() => {
    state.templates.page = 1;
    loadTemplates();
  });

  function renderAlertHistory() {
    $("#alertMessageCaption").textContent = `${state.monitor.messages.length} 条消息`;
    $("#alertPushCaption").textContent = `${state.monitor.pushRecords.length} 条记录`;
    $("#alertMessageBody").innerHTML = state.monitor.messages.length
      ? state.monitor.messages.map((message) => `
        <tr>
          <td>${formatDateTime(message.created_at)}</td>
          <td>
            <strong class="template-name">${escapeHtml(message.target_name || message.target_id)}</strong>
            <small>${escapeHtml(message.target_level_label || message.target_level || "")}</small>
          </td>
          <td>${escapeHtml(message.template_name || "-")}</td>
          <td class="rule-cell">${escapeHtml(message.body || "-")}</td>
        </tr>
      `).join("")
      : `<tr><td colspan="4" class="alert-loading-row">暂无历史预警消息</td></tr>`;
    $("#alertPushBody").innerHTML = state.monitor.pushRecords.length
      ? state.monitor.pushRecords.map((record) => `
        <tr>
          <td>${formatDateTime(record.created_at)}</td>
          <td>${escapeHtml(record.channel || "-")}</td>
          <td><span class="template-severity ${record.status === "sent" || record.status === "recorded" ? "low" : "high"}">${escapeHtml(record.status || "-")}</span></td>
          <td>${escapeHtml(record.target_id || "-")}</td>
        </tr>
      `).join("")
      : `<tr><td colspan="4" class="alert-loading-row">暂无消息推送记录</td></tr>`;
  }

  async function loadAlertHistory() {
    try {
      const [messages, pushes] = await Promise.all([
        apiJson("/api/alert-ai/alerts/messages?limit=20"),
        apiJson("/api/alert-ai/alerts/push-records?limit=20")
      ]);
      state.monitor.messages = messages.messages || [];
      state.monitor.pushRecords = pushes.records || [];
    } catch (error) {
      toast(error.message, "error");
    } finally {
      renderAlertHistory();
    }
  }

  async function evaluateAlerts() {
    if (state.monitor.evaluating) return;
    state.monitor.evaluating = true;
    $("#evaluateAlertsButton").disabled = true;
    try {
      const result = await apiJson("/api/alert-ai/alerts/evaluate", {
        method: "POST",
        body: JSON.stringify({ push: true })
      });
      toast(`评估完成：${result.messagesCreated} 条预警，${result.pushRecordsCreated} 条推送记录`);
      await loadAlertHistory();
    } catch (error) {
      toast(error.message, "error");
    } finally {
      state.monitor.evaluating = false;
      $("#evaluateAlertsButton").disabled = false;
    }
  }

  function clearFieldErrors(scope = root) {
    scope.querySelectorAll(".field-error").forEach((item) => {
      item.textContent = "";
    });
    scope.querySelectorAll(".is-invalid").forEach((item) => {
      item.classList.remove("is-invalid");
    });
  }

  function applyFieldErrors(fields = {}, scope = root) {
    Object.entries(fields).forEach(([field, message]) => {
      const errorEl = scope.querySelector(`[data-error-for="${field}"]`);
      const fieldEl = scope.querySelector(`[data-field="${field}"]`);
      if (errorEl) errorEl.textContent = message;
      if (fieldEl) fieldEl.classList.add("is-invalid");
    });
  }

  function scrollToFirstError(scope = root) {
    const first = scope.querySelector(".is-invalid, .field-error:not(:empty)");
    first?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function openTemplateDrawer(template = null) {
    state.drawer.open = true;
    state.drawer.mode = template ? "edit" : "create";
    state.drawer.id = template?.id || "";
    state.drawer.recipients = [...(template?.recipients || [])];
    $("#templateDrawer").hidden = false;
    $("#templateDrawerTitle").textContent = template ? "编辑预警模板" : "新建预警模板";
    fillTemplateForm(template || defaultTemplate());
    clearFieldErrors($("#templateForm"));
    updateTemplateDynamic();
    requestAnimationFrame(() => $("#templateName").focus());
  }

  function closeTemplateDrawer() {
    state.drawer.open = false;
    $("#templateDrawer").hidden = true;
  }

  function defaultTemplate() {
    return {
      name: "",
      targetLevel: "campaign",
      targetIds: [],
      logic: "and",
      conditions: [
        { id: crypto.randomUUID(), metric: "spend", comparison: "gt", threshold: 100, thresholdMax: 500 }
      ],
      windowType: "rolling_60",
      windowMinutes: 60,
      severity: "medium",
      channels: state.metadata?.defaults?.feishuWebhookConfigured ? ["dashboard", "feishu"] : ["dashboard"],
      recipients: [],
      feishuWebhookUrl: "",
      webhookUrl: "",
      enabled: true
    };
  }

  function fillTemplateForm(template) {
    $("#templateName").value = template.name || "";
    $("#templateTargetLevel").value = template.targetLevel || "campaign";
    $("#templateTargetIds").value = (template.targetIds || []).join("\n");
    $("#templateLogic").value = template.logic || "and";
    state.drawer.conditions = (template.conditions && template.conditions.length ? template.conditions : [{
      metric: template.metric || "spend",
      comparison: template.comparison || "gt",
      threshold: template.threshold ?? 100,
      thresholdMax: template.thresholdMax ?? 500
    }]).map((condition) => ({
      id: condition.id || crypto.randomUUID(),
      metric: condition.metric || "spend",
      comparison: condition.comparison || "gt",
      threshold: condition.threshold ?? "",
      thresholdMax: condition.thresholdMax ?? ""
    }));
    $("#templateWindowType").value = template.windowType || "rolling_60";
    $("#templateWindowMinutes").value = template.windowMinutes || 60;
    $("#templateSeverity").value = template.severity || "medium";
    $("#templateFeishuWebhookUrl").value = template.feishuWebhookUrl || "";
    $("#templateWebhookUrl").value = template.webhookUrl || "";
    $$('input[name="templateChannels"]').forEach((input) => {
      input.checked = (template.channels || ["dashboard"]).includes(input.value);
    });
    renderConditions();
    renderRecipients();
  }

  function metricById(id) {
    return state.metadata.metrics.find((metric) => metric.id === id) || state.metadata.metrics[0];
  }

  function comparisonById(id) {
    return state.metadata.comparisons.find((comparison) => comparison.id === id) || state.metadata.comparisons[0];
  }

  function conditionOptions(kind, selected) {
    const source = kind === "metric" ? state.metadata.metrics : state.metadata.comparisons;
    return source.map((item) => `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("");
  }

  function renderConditions() {
    const list = $("#templateConditionList");
    list.innerHTML = state.drawer.conditions.map((condition, index) => {
      const comparison = comparisonById(condition.comparison);
      const metric = metricById(condition.metric);
      const unit = comparison.id.startsWith("change_") ? "%" : metric.unit;
      const needsRange = comparison.valueCount === 2;
      return `
        <div class="condition-row" data-condition-id="${escapeHtml(condition.id)}">
          <select data-condition-field="metric">${conditionOptions("metric", condition.metric)}</select>
          <select data-condition-field="comparison">${conditionOptions("comparison", condition.comparison)}</select>
          <label>
            <span>阈值 ${unit ? `(${escapeHtml(unit)})` : ""}</span>
            <input data-condition-field="threshold" type="number" step="0.01" value="${escapeHtml(condition.threshold)}">
          </label>
          <label ${needsRange ? "" : "hidden"}>
            <span>区间上限 ${unit ? `(${escapeHtml(unit)})` : ""}</span>
            <input data-condition-field="thresholdMax" type="number" step="0.01" value="${escapeHtml(condition.thresholdMax)}">
          </label>
          <button type="button" class="icon-button" data-condition-remove="${escapeHtml(condition.id)}" ${state.drawer.conditions.length <= 1 ? "disabled" : ""} aria-label="删除条件">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      `;
    }).join("");
    refreshIcons();
  }

  function syncConditionFromInput(target) {
    const row = target.closest("[data-condition-id]");
    if (!row) return;
    const condition = state.drawer.conditions.find((item) => item.id === row.dataset.conditionId);
    if (!condition) return;
    condition[target.dataset.conditionField] = target.value;
    if (["metric", "comparison"].includes(target.dataset.conditionField)) {
      renderConditions();
    }
    updateTemplateDynamic();
  }

  function updateTemplateDynamic() {
    $("#customWindowGroup").hidden = $("#templateWindowType").value !== "custom";

    const channels = selectedChannels();
    $("#recipientGroup").hidden = !channels.includes("email");
    $("#webhookGroup").hidden = !channels.includes("webhook");
    $("#feishuGroup").hidden = !channels.includes("feishu");
    $("#templateRulePreview").textContent = buildRulePreview();
  }

  function selectedChannels() {
    return $$('input[name="templateChannels"]:checked').map((input) => input.value);
  }

  function buildRulePreview() {
    const windowType = $("#templateWindowType").value;
    const windowMinutes = windowType === "custom"
      ? $("#templateWindowMinutes").value || "-"
      : (state.metadata.windows.find((item) => item.id === windowType)?.minutes || "-");
    const connector = $("#templateLogic").value === "or" ? " OR " : " AND ";
    const conditions = state.drawer.conditions.map((condition) => {
      const metric = metricById(condition.metric);
      const comparison = comparisonById(condition.comparison);
      const unit = comparison.id.startsWith("change_") ? "%" : metric.unit;
      const threshold = condition.threshold || "-";
      const thresholdMax = condition.thresholdMax || "-";
      const valueText = comparison.valueCount === 2 ? `${threshold} 到 ${thresholdMax} ${unit}` : `${threshold} ${unit}`;
      return `${metric.label}${comparison.label} ${valueText}`;
    }).join(connector);
    return `${conditions}，窗口 ${windowMinutes} 分钟`;
  }

  function renderRecipients() {
    const box = $("#recipientTags");
    box.innerHTML = state.drawer.recipients.map((email) => `
      <span class="recipient-tag">
        ${escapeHtml(email)}
        <button type="button" data-remove-recipient="${escapeHtml(email)}" aria-label="删除 ${escapeHtml(email)}">
          <i data-lucide="x"></i>
        </button>
      </span>
    `).join("");
    refreshIcons();
  }

  function addRecipientsFromInput() {
    const input = $("#recipientInput");
    const values = input.value.split(/[\s,;，；]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
    if (!values.length) return;
    const invalid = values.find((email) => !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email));
    if (invalid) {
      applyFieldErrors({ recipients: `邮箱格式不正确：${invalid}` }, $("#templateForm"));
      return;
    }
    state.drawer.recipients = [...new Set([...state.drawer.recipients, ...values])];
    input.value = "";
    clearFieldErrors($("#templateForm"));
    renderRecipients();
  }

  function templatePayloadFromForm() {
    return {
      name: $("#templateName").value.trim(),
      targetLevel: $("#templateTargetLevel").value,
      targetIds: $("#templateTargetIds").value.split(/[\s,;，；]+/).map((item) => item.trim()).filter(Boolean),
      logic: $("#templateLogic").value,
      conditions: state.drawer.conditions.map((condition) => ({
        metric: condition.metric,
        comparison: condition.comparison,
        threshold: condition.threshold,
        thresholdMax: condition.thresholdMax
      })),
      windowType: $("#templateWindowType").value,
      windowMinutes: $("#templateWindowMinutes").value,
      severity: $("#templateSeverity").value,
      channels: selectedChannels(),
      recipients: state.drawer.recipients,
      feishuWebhookUrl: $("#templateFeishuWebhookUrl").value.trim(),
      webhookUrl: $("#templateWebhookUrl").value.trim(),
      enabled: true
    };
  }

  function validateTemplatePayload(payload) {
    const fields = {};
    if (!payload.name) fields.name = "模板名称不能为空";
    if (payload.name.length > 60) fields.name = "模板名称不能超过 60 个字符";
    if (payload.name && !/^[\u4e00-\u9fa5A-Za-z0-9 _（）()\-[\].#]+$/.test(payload.name)) {
      fields.name = "模板名称包含非法特殊字符";
    }
    if (!payload.conditions.length) fields.conditions = "至少需要一个监控条件";
    payload.conditions.forEach((condition) => {
      const metric = metricById(condition.metric);
      const comparison = comparisonById(condition.comparison);
      const threshold = Number(condition.threshold);
      if (!Number.isFinite(threshold)) fields.conditions = "每个条件都需要数字阈值";
      const min = comparison.id.startsWith("change_") ? 0 : metric.min;
      const max = comparison.id.startsWith("change_") ? 500 : metric.max;
      if (Number.isFinite(threshold) && (threshold < min || threshold > max)) {
        fields.conditions = `阈值范围应为 ${min} 到 ${max}`;
      }
      if (comparison.valueCount === 2) {
        const thresholdMax = Number(condition.thresholdMax);
        if (!Number.isFinite(thresholdMax)) fields.conditions = "区间条件需要填写上限";
        if (Number.isFinite(threshold) && Number.isFinite(thresholdMax) && threshold > thresholdMax) {
          fields.conditions = "区间上限必须大于或等于下限";
        }
      }
    });
    if (payload.windowType === "custom") {
      const minutes = Number.parseInt(payload.windowMinutes, 10);
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) {
        fields.windowMinutes = "自定义时间窗口必须在 5 到 1440 分钟之间";
      }
    }
    if (payload.channels.includes("email") && payload.recipients.length === 0) {
      fields.recipients = "邮件通知至少需要一个接收人";
    }
    if (payload.channels.includes("webhook")) {
      try {
        const url = new URL(payload.webhookUrl);
        if (!["http:", "https:"].includes(url.protocol)) fields.webhookUrl = "URL 必须是 http 或 https 地址";
      } catch {
        fields.webhookUrl = "URL 必须是有效地址";
      }
    }
    if (payload.channels.includes("feishu") && !payload.feishuWebhookUrl && !state.metadata?.defaults?.feishuWebhookConfigured) {
      fields.feishuWebhookUrl = "需要填写飞书地址，或在服务端配置 FEISHU_ALERT_WEBHOOK_URL";
    }
    if (payload.channels.includes("feishu") && payload.feishuWebhookUrl) {
      try {
        const url = new URL(payload.feishuWebhookUrl);
        if (!["http:", "https:"].includes(url.protocol)) fields.feishuWebhookUrl = "飞书地址必须是 http 或 https 地址";
      } catch {
        fields.feishuWebhookUrl = "飞书地址必须是有效地址";
      }
    }
    return fields;
  }

  async function saveTemplate(event) {
    event.preventDefault();
    addRecipientsFromInput();
    clearFieldErrors($("#templateForm"));
    const payload = templatePayloadFromForm();
    const fields = validateTemplatePayload(payload);
    if (Object.keys(fields).length) {
      applyFieldErrors(fields, $("#templateForm"));
      scrollToFirstError($("#templateForm"));
      return;
    }
    const button = $("#saveTemplateButton");
    button.disabled = true;
    try {
      if (state.drawer.mode === "edit") {
        await apiJson(`/api/alert-ai/templates/${encodeURIComponent(state.drawer.id)}`, {
          method: "PUT",
          body: JSON.stringify(payload)
        });
        toast("模板已保存");
      } else {
        await apiJson("/api/alert-ai/templates", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        toast("模板已创建");
      }
      closeTemplateDrawer();
      await loadTemplates();
    } catch (error) {
      applyFieldErrors(error.fields || {}, $("#templateForm"));
      toast(error.message, "error");
      scrollToFirstError($("#templateForm"));
    } finally {
      button.disabled = false;
    }
  }

  async function openTemplateForEdit(id) {
    try {
      const payload = await apiJson(`/api/alert-ai/templates/${encodeURIComponent(id)}`);
      openTemplateDrawer(payload.template);
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function copyTemplate(id) {
    try {
      const payload = await apiJson(`/api/alert-ai/templates/${encodeURIComponent(id)}/copy`, {
        method: "POST",
        body: JSON.stringify({})
      });
      toast("模板已复制");
      await loadTemplates();
      openTemplateDrawer(payload.template);
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function deleteTemplate(id) {
    if (!confirm("确认删除这个预警模板？")) return;
    try {
      await apiJson(`/api/alert-ai/templates/${encodeURIComponent(id)}`, { method: "DELETE" });
      toast("模板已删除");
      if (state.templates.items.length === 1 && state.templates.page > 1) {
        state.templates.page -= 1;
      }
      await loadTemplates();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function updateTemplateStatus(id, enabled) {
    const item = state.templates.items.find((template) => template.id === id);
    if (!item) return;
    const previous = item.enabled;
    item.enabled = enabled;
    renderTemplateTable();
    clearTimeout(state.templates.timers.get(id));
    state.templates.timers.set(id, setTimeout(async () => {
      try {
        await apiJson(`/api/alert-ai/templates/${encodeURIComponent(id)}/status`, {
          method: "PATCH",
          body: JSON.stringify({ enabled })
        });
        toast(enabled ? "模板已启用" : "模板已停用");
      } catch (error) {
        item.enabled = previous;
        renderTemplateTable();
        toast(error.message, "error");
      }
    }, 420));
  }

  function renderEntityPicker() {
    const selectedCount = state.entities.selectedIds.size;
    $("#entityPickerLabel").textContent = selectedCount ? `已选 ${selectedCount} 个对象` : "选择分析对象";
    $("#entityPickerToggle").setAttribute("aria-expanded", String(state.entities.open));
    $("#entityPickerDropdown").hidden = !state.entities.open;
    const optionList = $("#entityOptionList");
    if (state.entities.loading) {
      optionList.innerHTML = `<div class="entity-empty-row">正在读取对象</div>`;
    } else if (!state.entities.options.length) {
      optionList.innerHTML = `<div class="entity-empty-row">当前范围没有可选对象</div>`;
    } else {
      optionList.innerHTML = state.entities.options.map((entity) => {
        const checked = state.entities.selectedIds.has(String(entity.id));
        const meta = [entity.campaign_name, entity.adset_name, entity.account_id].filter(Boolean).join(" · ");
        return `
          <label class="entity-option">
            <input data-report-input type="checkbox" data-entity-id="${escapeHtml(entity.id)}" ${checked ? "checked" : ""}>
            <span>
              <strong>${escapeHtml(entity.name || entity.id)}</strong>
              <small>${escapeHtml(meta || entity.id)}</small>
            </span>
          </label>
        `;
      }).join("");
    }
    $("#entitySelectedList").innerHTML = [...state.entities.selectedIds].map((id) => {
      const entity = state.entities.selectedMap.get(id);
      return `
        <span class="selected-entity">
          ${escapeHtml(entity?.name || id)}
          <button data-report-input type="button" data-remove-entity="${escapeHtml(id)}" aria-label="删除 ${escapeHtml(id)}">
            <i data-lucide="x"></i>
          </button>
        </span>
      `;
    }).join("");
    refreshIcons();
  }

  async function loadEntities() {
    state.entities.loading = true;
    renderEntityPicker();
    const params = new URLSearchParams({
      level: state.entities.level,
      search: state.entities.query,
      limit: "120"
    });
    try {
      const payload = await apiJson(`/api/alert-ai/entities?${params}`);
      state.entities.options = payload.entities || [];
      state.entities.options.forEach((entity) => {
        if (state.entities.selectedIds.has(String(entity.id))) {
          state.entities.selectedMap.set(String(entity.id), entity);
        }
      });
    } catch (error) {
      toast(error.message, "error");
      state.entities.options = [];
    } finally {
      state.entities.loading = false;
      renderEntityPicker();
    }
  }

  const debouncedEntitySearch = debounce(loadEntities, 280);

  function selectEntity(entity) {
    const id = String(entity.id);
    state.entities.selectedIds.add(id);
    state.entities.selectedMap.set(id, entity);
  }

  function toggleEntity(id, checked) {
    const entity = state.entities.options.find((item) => String(item.id) === String(id)) || state.entities.selectedMap.get(String(id));
    if (checked && entity) {
      selectEntity(entity);
    } else {
      state.entities.selectedIds.delete(String(id));
      state.entities.selectedMap.delete(String(id));
    }
    clearFieldErrors(root);
    renderEntityPicker();
  }

  function setReportDefaults() {
    const today = todayString();
    $("#reportSince").max = today;
    $("#reportUntil").max = today;
    $("#reportUntil").value = today;
    $("#reportSince").value = addDays(today, -6);
    $("#reportPrompt").value = reportPresets[0].prompt;
    updatePromptCount();
    updateReportProgress([]);
  }

  function setReportRange(value) {
    const today = todayString();
    if (value === "today") {
      $("#reportSince").value = today;
      $("#reportUntil").value = today;
    } else if (value === "yesterday") {
      const yesterday = addDays(today, -1);
      $("#reportSince").value = yesterday;
      $("#reportUntil").value = yesterday;
    } else {
      const days = Number(value);
      $("#reportSince").value = addDays(today, -(days - 1));
      $("#reportUntil").value = today;
    }
    clearFieldErrors(root);
  }

  function updatePromptCount() {
    const value = $("#reportPrompt").value;
    if (value.length > promptMaxLength) {
      $("#reportPrompt").value = value.slice(0, promptMaxLength);
    }
    $("#reportPromptCount").textContent = `${$("#reportPrompt").value.length} / ${promptMaxLength}`;
    autoSizeTextarea($("#reportPrompt"));
  }

  function autoSizeTextarea(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(260, Math.max(118, textarea.scrollHeight))}px`;
  }

  function reportRequestFromForm() {
    return {
      since: $("#reportSince").value,
      until: $("#reportUntil").value,
      level: $('input[name="reportLevel"]:checked')?.value || state.entities.level,
      entityIds: [...state.entities.selectedIds],
      prompt: $("#reportPrompt").value.trim()
    };
  }

  function validateReportRequest(request) {
    const fields = {};
    const today = todayString();
    if (!request.since) fields.since = "请选择开始日期";
    if (!request.until) fields.until = "请选择结束日期";
    if (request.since && request.until) {
      if (request.since > request.until) fields.until = "结束日期不能早于开始日期";
      if (request.until > today) fields.until = "结束日期不能选择未来";
      if (dayDiffInclusive(request.since, request.until) > 90) fields.until = "最长查询区间为 90 天";
    }
    if (!request.entityIds.length) fields.entityIds = "请选择至少一个分析对象";
    if (request.prompt.length < 8) fields.prompt = "请输入至少 8 个字符的分析目标";
    if (request.prompt.length > promptMaxLength) fields.prompt = `不能超过 ${promptMaxLength} 个字符`;
    return fields;
  }

  function setReportLocked(locked) {
    state.report.generating = locked;
    $$("[data-report-input]").forEach((input) => {
      input.disabled = locked;
    });
    $("#generateReportButton").disabled = locked;
    $("#reportInputBody").classList.toggle("is-locked", locked);
  }

  function updateReportProgress(activeKeys = []) {
    const stages = [
      ["validate", "校验"],
      ["load", "取数"],
      ["compare", "对比"],
      ["diagnose", "诊断"],
      ["finish", "完成"]
    ];
    $("#reportProgress").innerHTML = stages.map(([key, label]) => `
      <span class="${activeKeys.includes(key) ? "active" : ""}">
        <i></i>${label}
      </span>
    `).join("");
  }

  function resetReportOutput() {
    state.report.final = null;
    state.report.visibleMarkdown = "";
    state.report.pendingMarkdown = "";
    state.report.typing = false;
    state.report.error = null;
    $("#reportActions").hidden = true;
    $("#reportOutput").innerHTML = `
      <div class="streaming-report">
        <div class="report-board" id="reportBoard" hidden></div>
        <article class="markdown-body" id="streamMarkdown"></article>
        <div class="action-list" id="reportActionList" hidden></div>
      </div>
    `;
  }

  function inlineMarkdown(value) {
    let text = escapeHtml(value);
    text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
    return text;
  }

  function markdownToHtml(markdown) {
    const lines = String(markdown || "").split(/\r?\n/);
    const html = [];
    let listType = "";
    const closeList = () => {
      if (listType) {
        html.push(`</${listType}>`);
        listType = "";
      }
    };
    lines.forEach((line) => {
      if (/^###\s+/.test(line)) {
        closeList();
        html.push(`<h3>${inlineMarkdown(line.replace(/^###\s+/, ""))}</h3>`);
      } else if (/^##\s+/.test(line)) {
        closeList();
        html.push(`<h2>${inlineMarkdown(line.replace(/^##\s+/, ""))}</h2>`);
      } else if (/^#\s+/.test(line)) {
        closeList();
        html.push(`<h1>${inlineMarkdown(line.replace(/^#\s+/, ""))}</h1>`);
      } else if (/^\s*-\s+/.test(line)) {
        if (listType !== "ul") {
          closeList();
          listType = "ul";
          html.push("<ul>");
        }
        html.push(`<li>${inlineMarkdown(line.replace(/^\s*-\s+/, ""))}</li>`);
      } else if (/^\s*\d+\.\s+/.test(line)) {
        if (listType !== "ol") {
          closeList();
          listType = "ol";
          html.push("<ol>");
        }
        html.push(`<li>${inlineMarkdown(line.replace(/^\s*\d+\.\s+/, ""))}</li>`);
      } else if (!line.trim()) {
        closeList();
      } else {
        closeList();
        html.push(`<p>${inlineMarkdown(line)}</p>`);
      }
    });
    closeList();
    return html.join("");
  }

  function renderMarkdownNow() {
    const target = $("#streamMarkdown");
    if (target) {
      target.innerHTML = markdownToHtml(state.report.visibleMarkdown);
    }
  }

  function enqueueMarkdown(text) {
    state.report.pendingMarkdown += text;
    if (!state.report.typing) {
      state.report.typing = true;
      requestAnimationFrame(typeMarkdown);
    }
  }

  function typeMarkdown() {
    const take = state.report.pendingMarkdown.slice(0, 9);
    state.report.pendingMarkdown = state.report.pendingMarkdown.slice(9);
    state.report.visibleMarkdown += take;
    renderMarkdownNow();
    if (state.report.pendingMarkdown) {
      requestAnimationFrame(typeMarkdown);
    } else {
      state.report.typing = false;
    }
  }

  function flushMarkdown(markdown) {
    state.report.pendingMarkdown = "";
    state.report.visibleMarkdown = markdown;
    renderMarkdownNow();
  }

  function renderReportFinal(report) {
    state.report.final = report;
    flushMarkdown(report.markdown);
    $("#reportActions").hidden = false;
    const providerText = report.provider === "deepseek" ? `DeepSeek ${report.model || ""}`.trim() : "本地规则";
    $("#reportStatusText").textContent = `生成完成 · ${providerText} · ${report.rowsAnalyzed} 行`;
    const board = $("#reportBoard");
    board.hidden = false;
    board.innerHTML = report.board.map((card) => `
      <article class="report-metric-card ${card.anomalyLevel}">
        <span>${escapeHtml(card.label)}</span>
        <strong>${escapeHtml(card.formattedValue)}</strong>
        <small>波动 ${formatSigned(card.changePct)}%</small>
        <div class="volatility-bar">
          <i style="width:${Math.min(100, Math.abs(card.changePct))}%"></i>
        </div>
      </article>
    `).join("");
    const list = $("#reportActionList");
    list.hidden = false;
    list.innerHTML = `
      <h3>行动项</h3>
      ${report.actions.map((action) => `
        <article class="action-card ${action.priority}">
          <div>
            <strong>${escapeHtml(action.title)}</strong>
            <span>${escapeHtml(action.detail)}</span>
          </div>
          <button type="button" data-copy-action="${escapeHtml(`${action.title}\n${action.detail}`)}">
            <i data-lucide="copy"></i>
            <span>${escapeHtml(action.quickAction || "复制")}</span>
          </button>
        </article>
      `).join("")}
    `;
    refreshIcons();
  }

  function formatSigned(value) {
    const number = Number(value || 0);
    return `${number > 0 ? "+" : ""}${number.toFixed(2)}`;
  }

  function renderReportError(error) {
    state.report.error = error;
    $("#reportActions").hidden = true;
    $("#reportStatusText").textContent = "生成失败";
    $("#reportOutput").innerHTML = `
      <div class="report-error">
        <i data-lucide="triangle-alert"></i>
        <strong>${escapeHtml(error.message || "报告生成失败")}</strong>
        <span>已保留当前筛选范围和文本输入。</span>
        <button class="primary-button" type="button" id="retryReportButton">
          <i data-lucide="refresh-cw"></i>
          <span>重试</span>
        </button>
      </div>
    `;
    refreshIcons();
  }

  async function generateReport(requestOverride = null) {
    if (state.report.generating) return;
    clearFieldErrors(root);
    const request = requestOverride || reportRequestFromForm();
    const fields = validateReportRequest(request);
    if (Object.keys(fields).length) {
      applyFieldErrors(fields, root);
      scrollToFirstError(root);
      return;
    }

    state.report.lastRequest = request;
    resetReportOutput();
    setReportLocked(true);
    $("#reportStatusText").textContent = "正在生成";
    updateReportProgress(["validate"]);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 55_000);

    try {
      const response = await fetch("/api/alert-ai/reports/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const error = new Error(payload.message || `报告请求失败 (${response.status})`);
        error.fields = payload.fields || {};
        throw error;
      }
      await readSseStream(response);
    } catch (error) {
      if (error.name === "AbortError") {
        renderReportError(new Error("报告生成超时，请稍后重试"));
      } else {
        if (error.fields) applyFieldErrors(error.fields, root);
        renderReportError(error);
      }
    } finally {
      clearTimeout(timeoutId);
      setReportLocked(false);
    }
  }

  async function readSseStream(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    const completed = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        handleSseBlock(block, completed);
        boundary = buffer.indexOf("\n\n");
      }
    }
  }

  function handleSseBlock(block, completed) {
    const lines = block.split(/\r?\n/);
    const eventLine = lines.find((line) => line.startsWith("event:"));
    const dataLines = lines.filter((line) => line.startsWith("data:"));
    const event = eventLine ? eventLine.slice(6).trim() : "message";
    const dataText = dataLines.map((line) => line.slice(5).trim()).join("\n");
    const payload = dataText ? JSON.parse(dataText) : {};
    if (event === "stage") {
      if (!completed.includes(payload.key)) completed.push(payload.key);
      updateReportProgress([...completed]);
      $("#reportStatusText").textContent = payload.label || "正在生成";
    }
    if (event === "delta") {
      enqueueMarkdown(payload.text || "");
    }
    if (event === "final") {
      renderReportFinal(payload.report);
    }
    if (event === "error") {
      throw new Error(payload.message || "报告生成失败");
    }
  }

  async function copyText(text, successMessage = "已复制") {
    try {
      await navigator.clipboard.writeText(text);
      toast(successMessage);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      toast(successMessage);
    }
  }

  function exportReport() {
    if (!state.report.final) return;
    const report = state.report.final;
    const filename = `fb-agent-report-${report.request.since}-${report.request.until}.md`;
    const blob = new Blob([report.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast("报告已导出");
  }

  function bindEvents() {
    $$("[data-alert-tab]").forEach((button) => {
      button.addEventListener("click", () => setActiveTab(button.dataset.alertTab));
    });

    $("#newAlertTemplateButton").addEventListener("click", () => openTemplateDrawer());
    $("#evaluateAlertsButton").addEventListener("click", evaluateAlerts);
    $("#alertTemplateSearch").addEventListener("input", (event) => {
      state.templates.search = event.target.value;
      debouncedTemplateSearch();
    });
    $("#alertMetricCategoryFilter").addEventListener("change", (event) => {
      state.templates.metricCategory = event.target.value;
      state.templates.page = 1;
      loadTemplates();
    });
    $("#alertStatusFilter").addEventListener("change", (event) => {
      state.templates.status = event.target.value;
      state.templates.page = 1;
      loadTemplates();
    });

    $("#templateForm").addEventListener("submit", saveTemplate);
    $$("[data-drawer-close]").forEach((button) => button.addEventListener("click", closeTemplateDrawer));
    ["templateTargetLevel", "templateLogic", "templateTargetIds", "templateWindowType", "templateWindowMinutes"].forEach((id) => {
      $(`#${id}`).addEventListener("input", updateTemplateDynamic);
      $(`#${id}`).addEventListener("change", updateTemplateDynamic);
    });
    $("#addConditionButton").addEventListener("click", () => {
      state.drawer.conditions.push({ id: crypto.randomUUID(), metric: "spend", comparison: "gt", threshold: 100, thresholdMax: 500 });
      renderConditions();
      updateTemplateDynamic();
    });
    $("#templateConditionList").addEventListener("input", (event) => {
      if (event.target.dataset.conditionField) syncConditionFromInput(event.target);
    });
    $("#templateConditionList").addEventListener("change", (event) => {
      if (event.target.dataset.conditionField) syncConditionFromInput(event.target);
    });
    $("#templateName").addEventListener("blur", (event) => {
      event.target.value = event.target.value.trim();
    });
    $("#templateChannels").addEventListener("change", updateTemplateDynamic);
    $("#recipientInput").addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === "," || event.key === "，") {
        event.preventDefault();
        addRecipientsFromInput();
      }
    });
    $("#recipientInput").addEventListener("blur", addRecipientsFromInput);

    $("#reportSince").addEventListener("change", () => clearFieldErrors(root));
    $("#reportUntil").addEventListener("change", () => clearFieldErrors(root));
    $("#reportPrompt").addEventListener("input", updatePromptCount);
    $("#generateReportButton").addEventListener("click", () => generateReport());
    $("#entityPickerToggle").addEventListener("click", () => {
      state.entities.open = !state.entities.open;
      renderEntityPicker();
    });
    $("#entityPickerSearch").addEventListener("input", (event) => {
      state.entities.query = event.target.value;
      debouncedEntitySearch();
    });
    $("#copyReportButton").addEventListener("click", () => {
      if (state.report.final) copyText(state.report.final.markdown, "报告 Markdown 已复制");
    });
    $("#exportReportButton").addEventListener("click", exportReport);

    root.addEventListener("click", (event) => {
      const pageButton = event.target.closest("[data-template-page]");
      if (pageButton) {
        state.templates.page += pageButton.dataset.templatePage === "next" ? 1 : -1;
        loadTemplates();
        return;
      }
      const actionButton = event.target.closest("[data-template-action]");
      if (actionButton) {
        const id = actionButton.dataset.templateId;
        const action = actionButton.dataset.templateAction;
        if (action === "edit") openTemplateForEdit(id);
        if (action === "copy") copyTemplate(id);
        if (action === "delete") deleteTemplate(id);
        return;
      }
      const removeRecipient = event.target.closest("[data-remove-recipient]");
      if (removeRecipient) {
        state.drawer.recipients = state.drawer.recipients.filter((email) => email !== removeRecipient.dataset.removeRecipient);
        renderRecipients();
        return;
      }
      const removeCondition = event.target.closest("[data-condition-remove]");
      if (removeCondition) {
        state.drawer.conditions = state.drawer.conditions.filter((condition) => condition.id !== removeCondition.dataset.conditionRemove);
        renderConditions();
        updateTemplateDynamic();
        return;
      }
      const rangeButton = event.target.closest("[data-report-range]");
      if (rangeButton) {
        setReportRange(rangeButton.dataset.reportRange);
        return;
      }
      const preset = event.target.closest("[data-preset-id]");
      if (preset) {
        const found = reportPresets.find((item) => item.id === preset.dataset.presetId);
        if (found) {
          $("#reportPrompt").value = found.prompt;
          $$(".preset-card").forEach((card) => card.classList.toggle("active", card === preset));
          updatePromptCount();
        }
        return;
      }
      const entityAction = event.target.closest("[data-entity-action]");
      if (entityAction) {
        if (entityAction.dataset.entityAction === "select-all") {
          state.entities.options.forEach(selectEntity);
        }
        if (entityAction.dataset.entityAction === "clear") {
          state.entities.selectedIds.clear();
          state.entities.selectedMap.clear();
        }
        clearFieldErrors(root);
        renderEntityPicker();
        return;
      }
      const removeEntity = event.target.closest("[data-remove-entity]");
      if (removeEntity) {
        toggleEntity(removeEntity.dataset.removeEntity, false);
        return;
      }
      const copyAction = event.target.closest("[data-copy-action]");
      if (copyAction) {
        copyText(copyAction.dataset.copyAction, "行动项已复制");
        return;
      }
      const retryButton = event.target.closest("#retryReportButton");
      if (retryButton && state.report.lastRequest) {
        generateReport(state.report.lastRequest);
        return;
      }
      if (!event.target.closest(".entity-picker")) {
        state.entities.open = false;
        renderEntityPicker();
      }
    });

    root.addEventListener("change", (event) => {
      const statusInput = event.target.closest("[data-template-status]");
      if (statusInput) {
        updateTemplateStatus(statusInput.dataset.templateStatus, statusInput.checked);
        return;
      }
      const entityInput = event.target.closest("[data-entity-id]");
      if (entityInput) {
        toggleEntity(entityInput.dataset.entityId, entityInput.checked);
        return;
      }
      const levelInput = event.target.closest('input[name="reportLevel"]');
      if (levelInput) {
        state.entities.level = levelInput.value;
        state.entities.query = "";
        state.entities.options = [];
        state.entities.selectedIds.clear();
        state.entities.selectedMap.clear();
        $("#entityPickerSearch").value = "";
        clearFieldErrors(root);
        loadEntities();
      }
    });
  }

  async function init() {
    if (state.initialized) return;
    state.initialized = true;
    renderShell();
    try {
      const metadataPayload = await apiJson("/api/alert-ai/metadata");
      state.metadata = metadataPayload.metadata;
      renderMetadataControls();
      setReportDefaults();
      bindEvents();
      renderAlertHistory();
      await Promise.all([loadTemplates(), loadEntities(), loadAlertHistory()]);
      refreshIcons();
    } catch (error) {
      root.innerHTML = `
        <section class="panel alert-panel">
          <div class="report-error">
            <i data-lucide="triangle-alert"></i>
            <strong>${escapeHtml(error.message || "模块加载失败")}</strong>
            <span>请检查本地服务接口状态后刷新页面。</span>
          </div>
        </section>
      `;
      refreshIcons();
    }
  }

  window.AlertAiModule = {
    activate(tab = "templates") {
      init().then(() => {
        setActiveTab(tab);
        refreshIcons();
      });
    }
  };

  init();
})();
