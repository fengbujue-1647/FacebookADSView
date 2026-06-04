import pLimit from 'p-limit';
import { config } from './config.js';
import { YinoClient } from './yinoClient.js';
import { info } from './logger.js';
import { normalizeInsight, insightColumns } from './normalizer.js';
import { outputFile, outputJsonFile, rawFile, writeCsv, writeJson } from './storage.js';

const ACCOUNT_FIELDS = [
  'account_id',
  'name',
  'account_status',
  'account_status_label',
  'timezone_name',
  'remainder',
  'daily_spent_limit',
  'amount_spent',
  'spend_cap'
];

const INSIGHT_FIELDS = [
  'account_id',
  'account_name',
  'campaign_id',
  'campaign_name',
  'adset_id',
  'adset_name',
  'ad_id',
  'ad_name',
  'spend',
  'cpc',
  'ctr',
  'clicks',
  'reach',
  'impressions',
  'frequency',
  'cpm',
  'actions',
  'cost_per_action_type',
  'action_values',
  'purchase_roas',
  'website_purchase_roas',
  'date_start',
  'date_stop'
];

function chunks(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function mapById(rows, idField) {
  return new Map(rows.filter((row) => row?.[idField]).map((row) => [String(row[idField]), row]));
}

function resourceTypeForLevel(level) {
  if (level === 'campaigns') return 'campaigns';
  if (level === 'adsets') return 'adsets';
  return 'ads';
}

export class SyncService {
  constructor({ client = new YinoClient(), concurrency = config.concurrency } = {}) {
    this.client = client;
    this.limit = pLimit(concurrency);
  }

  async syncAccounts({ accountIds = [] } = {}) {
    const ids = accountIds.length ? accountIds.map(String) : await this.client.getAllAccountIds();
    info(`账户数量：${ids.length}`);

    const detailBatches = await Promise.all(chunks(ids, 100).map((batch) => (
      this.client.getAccountInfo(batch, ACCOUNT_FIELDS)
    )));

    const accounts = detailBatches.flatMap((payload) => payload.data || []);
    await writeJson(rawFile('accounts'), { ids, accounts });
    return { ids, accounts };
  }

  async syncResources({ accountIds, limitPerType = 0 } = {}) {
    const types = ['campaigns', 'adsets', 'ads'];
    const result = { campaigns: [], adsets: [], ads: [] };

    for (const accountId of accountIds) {
      for (const getType of types) {
        info(`拉取账户 ${accountId} 的 ${getType}`);
        const rows = await this.client.getAllResources({
          accountId,
          getType,
          limit: limitPerType || undefined
        });
        result[getType].push(...rows);
      }
    }

    await writeJson(rawFile('resources'), result);
    return result;
  }

  async syncInsights({ resources, accounts, level = 'ads', datePreset = 'yesterday', since, until, limit = 0, resultAction = '' }) {
    const resourceType = resourceTypeForLevel(level);
    const sourceRows = (resources[resourceType] || []).slice(0, limit || undefined);
    info(`Insights 层级：${resourceType}，待拉取对象：${sourceRows.length}`);

    const tasks = sourceRows.map((resource) => this.limit(async () => {
      const rows = await this.client.getAllInsights({
        id: resource.id,
        fields: INSIGHT_FIELDS,
        datePreset,
        since,
        until
      });
      return rows.map((row) => ({ ...row, id: resource.id }));
    }));

    const rawRows = (await Promise.all(tasks)).flat();
    const accountMap = mapById(accounts, 'account_id');
    const resourceMap = new Map([
      ...(resources.campaigns || []).map((row) => [String(row.id), row]),
      ...(resources.adsets || []).map((row) => [String(row.id), row]),
      ...(resources.ads || []).map((row) => [String(row.id), row])
    ]);

    const normalizedRows = rawRows.map((row) => normalizeInsight(row, {
      accountsById: accountMap,
      resourcesById: resourceMap,
      resultAction
    }));

    await writeJson(rawFile('insights'), rawRows);
    const jsonPath = await writeJson(outputJsonFile('facebook_ads_daily'), normalizedRows);
    const csvPath = await writeCsv(outputFile('facebook_ads_daily'), normalizedRows, insightColumns);

    return {
      csvPath,
      jsonPath,
      rawRows,
      normalizedRows
    };
  }

  async findActiveAds({ accountIds, limit = 5 }) {
    const activeAds = [];

    for (const accountId of accountIds) {
      if (activeAds.length >= limit) break;

      info(`扫描账户 ${accountId} 的 ACTIVE ads`);
      let after = '';
      const seen = new Set();

      do {
        const payload = await this.client.getResourcePage({
          accountId,
          getType: 'ads',
          after
        });

        const pageRows = payload.data?.data || [];
        for (const row of pageRows) {
          if (String(row.effective_status || '').toUpperCase() === 'ACTIVE') {
            activeAds.push(row);
            if (activeAds.length >= limit) break;
          }
        }

        if (activeAds.length >= limit) break;

        const next = payload.data?.paging?.cursors?.after || '';
        if (!next || seen.has(next)) break;
        seen.add(next);
        after = next;
      } while (true);
    }

    return activeAds;
  }

  async pullActiveAds({ accounts: accountIds = [], datePreset = 'yesterday', since, until, limit = 5, resultAction = '' } = {}) {
    const accountsResult = await this.syncAccounts({ accountIds });
    const activeAds = await this.findActiveAds({
      accountIds: accountsResult.ids,
      limit
    });

    info(`ACTIVE 广告数量：${activeAds.length}`);

    const tasks = activeAds.map((ad) => this.limit(async () => {
      const rows = await this.client.getAllInsights({
        id: ad.id,
        fields: INSIGHT_FIELDS,
        datePreset,
        since,
        until
      });
      return rows.map((row) => ({ ...row, id: ad.id }));
    }));

    const rawRows = (await Promise.all(tasks)).flat();
    const accountMap = mapById(accountsResult.accounts, 'account_id');
    const resourceMap = new Map(activeAds.map((row) => [String(row.id), row]));
    const normalizedRows = rawRows.map((row) => normalizeInsight(row, {
      accountsById: accountMap,
      resourcesById: resourceMap,
      resultAction
    }));

    await writeJson(rawFile('active_ads'), { activeAds, rawRows });
    const jsonPath = await writeJson(outputJsonFile('facebook_ads_active_ads'), normalizedRows);
    const csvPath = await writeCsv(outputFile('facebook_ads_active_ads'), normalizedRows, insightColumns);

    return {
      accounts: accountsResult.accounts,
      activeAds,
      insights: {
        csvPath,
        jsonPath,
        rawRows,
        normalizedRows
      }
    };
  }

  async pull(options = {}) {
    const accountIds = options.accounts?.length ? options.accounts : [];
    const accountsResult = await this.syncAccounts({ accountIds });
    const resources = await this.syncResources({
      accountIds: accountsResult.ids,
      limitPerType: options.resourceLimit || 0
    });
    const insights = await this.syncInsights({
      resources,
      accounts: accountsResult.accounts,
      level: options.level,
      datePreset: options.datePreset,
      since: options.since,
      until: options.until,
      limit: options.limit,
      resultAction: options.resultAction
    });

    return {
      accounts: accountsResult.accounts,
      resources,
      insights
    };
  }
}
