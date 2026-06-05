import { config } from './config.js';
import { getToken } from './tokenManager.js';

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
  return error?.name === 'AbortError' || /network|timeout|aborted/i.test(error?.message || '');
}

export class YinoClient {
  constructor({ baseUrl = config.baseUrl } = {}) {
    this.baseUrl = baseUrl;
  }

  async request(pathname, query = {}, { retryAuth = true, attempt = 0 } = {}) {
    const url = new URL(pathname, this.baseUrl);
    appendQuery(url, query);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    try {
      const token = await getToken();
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`
        },
        signal: controller.signal
      });

      const payload = await response.json();
      if ((response.status === 401 || payload.code === 401) && retryAuth) {
        await getToken({ forceRefresh: true });
        return this.request(pathname, query, { retryAuth: false, attempt });
      }

      if ((response.status === 429 || payload.code === 429 || payload.code === 203) && attempt < 2) {
        await sleep(800 * (attempt + 1));
        return this.request(pathname, query, { retryAuth, attempt: attempt + 1 });
      }

      if (!response.ok || payload.code !== 200) {
        throw new Error(`请求失败 ${pathname}: HTTP ${response.status}, code=${payload.code}, msg=${payload.msg}, request_id=${payload.request_id || ''}`);
      }

      return payload;
    } catch (error) {
      if (isRetryableError(error) && attempt < 2) {
        await sleep(800 * (attempt + 1));
        return this.request(pathname, query, { retryAuth, attempt: attempt + 1 });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
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

  async getResourcePage({ accountId, getType, after, before }) {
    return this.request('/api/v1/meta_api/resource', {
      account_id: accountId,
      get_type: getType,
      after,
      before
    });
  }

  async getAllResources({ accountId, getType, limit }) {
    const rows = [];
    let after = '';
    const seen = new Set();

    do {
      const payload = await this.getResourcePage({ accountId, getType, after });
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
}
