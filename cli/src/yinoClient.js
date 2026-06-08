import { config } from './config.js';
import { getToken } from './tokenManager.js';

export class YinoApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'YinoApiError';
    Object.assign(this, details);
  }
}

function appendQuery(url, query) {
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableError(error) {
  return error?.retryable === true
    || error?.name === 'AbortError'
    || error?.code === 429
    || error?.code === 203
    || /network|timeout|aborted|abort/i.test(error?.message || '');
}

export class YinoClient {
  constructor({ baseUrl = config.baseUrl } = {}) {
    this.baseUrl = baseUrl;
  }

  async requestOnce(pathname, query = {}, { retryAuth = true, timeoutMs = config.requestTimeoutMs } = {}) {
    const url = new URL(pathname, this.baseUrl);
    appendQuery(url, query);

    const controller = new AbortController();
    const startedAt = Date.now();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const token = await getToken();
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`
        },
        signal: controller.signal
      });

      const bodyText = await response.text();
      const bodySize = Buffer.byteLength(bodyText || '', 'utf8');
      let payload = {};
      try {
        payload = bodyText ? JSON.parse(bodyText) : {};
      } catch {
        payload = {
          code: response.status,
          msg: bodyText.slice(0, 500)
        };
      }

      if ((response.status === 401 || payload.code === 401) && retryAuth) {
        await getToken({ forceRefresh: true });
        return this.requestOnce(pathname, query, { retryAuth: false, timeoutMs });
      }

      if (!response.ok || payload.code !== 200) {
        throw new YinoApiError(`请求失败 ${pathname}: HTTP ${response.status}, code=${payload.code}, msg=${payload.msg}, request_id=${payload.request_id || ''}`, {
          httpStatus: response.status,
          code: payload.code || response.status,
          requestId: payload.request_id || '',
          bodySize,
          durationMs: Date.now() - startedAt,
          retryable: response.status === 429 || payload.code === 429 || payload.code === 203
        });
      }

      return {
        payload,
        httpStatus: response.status,
        code: payload.code,
        requestId: payload.request_id || '',
        bodySize,
        durationMs: Date.now() - startedAt
      };
    } catch (error) {
      if (error instanceof YinoApiError) {
        throw error;
      }
      if (error?.name === 'AbortError') {
        throw new YinoApiError(`请求超时 ${pathname}: Abort after ${timeoutMs}ms`, {
          httpStatus: 0,
          code: 'ABORT',
          bodySize: 0,
          durationMs: Date.now() - startedAt,
          retryable: true
        });
      }
      throw new YinoApiError(`请求失败 ${pathname}: ${error.message}`, {
        httpStatus: 0,
        code: 'NETWORK',
        bodySize: 0,
        durationMs: Date.now() - startedAt,
        retryable: true
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async request(pathname, query = {}, { retryAuth = true, attempt = 0 } = {}) {
    try {
      const result = await this.requestOnce(pathname, query, { retryAuth });
      return result.payload;
    } catch (error) {
      if (isRetryableError(error) && attempt < 2) {
        await sleep(800 * (attempt + 1));
        return this.request(pathname, query, { retryAuth, attempt: attempt + 1 });
      }
      throw error;
    }
  }

  async getAccountList({ page = 1, pageSize = 1000 } = {}) {
    return this.request('/api/v1/account/list', {
      page,
      page_size: pageSize
    });
  }

  async getAllAccountIds() {
    const accounts = [];
    let page = 1;
    let totalPages = 1;

    do {
      const payload = await this.getAccountList({ page, pageSize: 1000 });
      accounts.push(...(payload.data.accounts || []));
      totalPages = payload.data.total_pages || page;
      page += 1;
    } while (page <= totalPages);

    return accounts.map(String);
  }

  async getAccountInfo(accountIds, fields) {
    return this.request('/api/v1/account/info', {
      account_ids: accountIds.join(','),
      fields: fields.join(',')
    });
  }

  async getResourcePage({ accountId, getType, effectiveStatus, after, before }) {
    return this.request('/api/v1/meta_api/resource', {
      account_id: accountId,
      get_type: getType,
      effective_status: Array.isArray(effectiveStatus) && effectiveStatus.length ? JSON.stringify(effectiveStatus) : effectiveStatus,
      after,
      before
    });
  }

  async getAllResources({ accountId, getType, effectiveStatus, limit }) {
    const rows = [];
    let after = '';
    const seen = new Set();

    do {
      const payload = await this.getResourcePage({ accountId, getType, effectiveStatus, after });
      const pageRows = payload.data?.data || [];
      rows.push(...pageRows);

      const next = payload.data?.paging?.cursors?.after || '';
      if (!next || seen.has(next)) break;
      seen.add(next);
      after = next;
    } while (!limit || rows.length < limit);

    return limit ? rows.slice(0, limit) : rows;
  }

  async getInfo(id, fields) {
    return this.request('/api/v1/meta_api/info', {
      id,
      fields: fields.join(',')
    });
  }

  async getInsightsPage({ id, fields, datePreset, since, until, breakdowns, actionBreakdowns = 'action_type', actionAttributionWindows, after, before }) {
    const query = {
      id,
      fields: fields.join(','),
      breakdowns,
      action_breakdowns: actionBreakdowns,
      action_attribution_windows: actionAttributionWindows,
      after,
      before
    };

    if (since && until) {
      query.time_range = JSON.stringify({ since, until });
    } else {
      query.date_preset = datePreset || 'yesterday';
    }

    return this.request('/api/v1/meta_api/insights', query);
  }

  async getInsightsPageDetailed({ id, fields, datePreset, since, until, breakdowns, actionBreakdowns = 'action_type', actionAttributionWindows, after, before, timeoutMs }) {
    const query = {
      id,
      fields: fields.join(','),
      breakdowns,
      action_breakdowns: actionBreakdowns,
      action_attribution_windows: actionAttributionWindows,
      after,
      before
    };

    if (since && until) {
      query.time_range = JSON.stringify({ since, until });
    } else {
      query.date_preset = datePreset || 'yesterday';
    }

    return this.requestOnce('/api/v1/meta_api/insights', query, { timeoutMs });
  }

  async getAllInsights(options) {
    const rows = [];
    let after = '';
    const seen = new Set();

    do {
      const payload = await this.getInsightsPage({ ...options, after });
      rows.push(...(payload.data?.data || []));

      const next = payload.data?.paging?.cursors?.after || '';
      if (!next || seen.has(next)) break;
      seen.add(next);
      after = next;
    } while (true);

    return rows;
  }

  async getAllInsightsWithStats(options) {
    const rows = [];
    const requestIds = [];
    let after = '';
    let bodySize = 0;
    let durationMs = 0;
    let pages = 0;
    let code = 200;
    let httpStatus = 200;
    const seen = new Set();

    do {
      const result = await this.getInsightsPageDetailed({ ...options, after });
      const payload = result.payload;
      rows.push(...(payload.data?.data || []));
      requestIds.push(result.requestId);
      bodySize += result.bodySize || 0;
      durationMs += result.durationMs || 0;
      code = result.code;
      httpStatus = result.httpStatus;
      pages += 1;

      const next = payload.data?.paging?.cursors?.after || '';
      if (!next || seen.has(next)) break;
      seen.add(next);
      after = next;
    } while (true);

    return {
      rows,
      pages,
      bodySize,
      durationMs,
      code,
      httpStatus,
      requestIds: requestIds.filter(Boolean)
    };
  }
}
