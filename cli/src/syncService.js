import pLimit from 'p-limit';
import { config } from './config.js';
import { YinoClient } from './yinoClient.js';
import { info } from './logger.js';
import { normalizeInsight, insightColumns } from './normalizer.js';
import { outputFile, outputJsonFile, rawFile, writeCsv, writeJson } from './storage.js';
import { writeInsightBatch } from './database.js';

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

const HOURLY_BREAKDOWN = 'hourly_stats_aggregated_by_advertiser_time_zone';

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

function isActive(row) {
  return String(row?.effective_status || row?.status || '').toUpperCase() === 'ACTIVE';
}

function resourceIdentity(row, level) {
  const id = String(row?.id || row?.ad_id || row?.adset_id || row?.campaign_id || '').trim();
  const resource = {
    ...row,
    id,
    __level: level
  };

  if (level === 'campaigns') {
    resource.campaign_id = resource.campaign_id || id;
  }
  if (level === 'adsets') {
    resource.adset_id = resource.adset_id || id;
  }
  if (level === 'ads') {
    resource.ad_id = resource.ad_id || id;
  }

  return resource;
}

function resourcesForLevel(level, rows) {
  return {
    campaigns: level === 'campaigns' ? rows : [],
    adsets: level === 'adsets' ? rows : [],
    ads: level === 'ads' ? rows : []
  };
}

function rankProbeRows(rowsById) {
  return [...rowsById.entries()]
    .map(([id, rows]) => ({
      id,
      rows: rows.length,
      spend: rows.reduce((total, row) => total + Number(row.spend || 0), 0),
      impressions: rows.reduce((total, row) => total + Number(row.impressions || 0), 0),
      clicks: rows.reduce((total, row) => total + Number(row.clicks || 0), 0)
    }))
    .sort((a, b) => (b.impressions - a.impressions) || (b.spend - a.spend));
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

  async syncResourceType({ accountIds, getType, limitPerAccount = 0 } = {}) {
    const rows = [];

    for (const accountId of accountIds) {
      info(`拉取账户 ${accountId} 的 ${getType}`);
      rows.push(...await this.client.getAllResources({
        accountId,
        getType,
        limit: limitPerAccount || undefined
      }));
    }

    await writeJson(rawFile(getType), rows);
    return rows;
  }

  async syncInsights({
    resources,
    accounts = [],
    level = 'ads',
    datePreset = 'yesterday',
    since,
    until,
    limit = 0,
    resultAction = '',
    hourly = false,
    source = '',
    outputName = ''
  }) {
    const resourceType = resourceTypeForLevel(level);
    const sourceRows = (resources[resourceType] || [])
      .map((row) => resourceIdentity(row, resourceType))
      .filter((row) => row.id)
      .slice(0, limit || undefined);
    info(`Insights 层级：${resourceType}，待拉取对象：${sourceRows.length}`);

    const tasks = sourceRows.map((resource) => this.limit(async () => {
      const rows = await this.client.getAllInsights({
        id: resource.id,
        fields: INSIGHT_FIELDS,
        datePreset,
        since,
        until,
        breakdowns: hourly ? HOURLY_BREAKDOWN : ''
      });
      return rows.map((row) => ({ ...row, id: resource.id }));
    }));

    const rawRows = (await Promise.all(tasks)).flat();
    const accountMap = mapById(accounts, 'account_id');
    const resourceMap = new Map([
      ...(resources.campaigns || []).map((row) => resourceIdentity(row, 'campaigns')).map((row) => [String(row.id), row]),
      ...(resources.adsets || []).map((row) => resourceIdentity(row, 'adsets')).map((row) => [String(row.id), row]),
      ...(resources.ads || []).map((row) => resourceIdentity(row, 'ads')).map((row) => [String(row.id), row])
    ]);

    const normalizedRows = rawRows.map((row) => normalizeInsight(row, {
      accountsById: accountMap,
      resourcesById: resourceMap,
      resultAction
    }));

    await writeJson(rawFile('insights'), rawRows);
    const baseOutputName = outputName || (hourly ? 'facebook_ads_hourly' : 'facebook_ads_daily');
    const jsonPath = await writeJson(outputJsonFile(baseOutputName), normalizedRows);
    const csvPath = await writeCsv(outputFile(baseOutputName), normalizedRows, insightColumns);
    const db = writeInsightBatch({
      source: source || `pull:${resourceType}`,
      level: resourceType,
      accountIds: accounts.map((account) => account.account_id).filter(Boolean),
      rows: normalizedRows,
      metadata: {
        datePreset,
        since: since || '',
        until: until || '',
        resultAction,
        hourly,
        requestedObjectCount: sourceRows.length,
        jsonPath,
        csvPath,
        rawRowCount: rawRows.length
      }
    });

    return {
      csvPath,
      jsonPath,
      db,
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

  async pullActiveAds({ accounts: accountIds = [], datePreset = 'yesterday', since, until, limit = 5, resultAction = '', hourly = false } = {}) {
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
        until,
        breakdowns: hourly ? 'hourly_stats_aggregated_by_advertiser_time_zone' : ''
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
    const outputName = hourly ? 'facebook_ads_active_ads_hourly' : 'facebook_ads_active_ads';
    const jsonPath = await writeJson(outputJsonFile(outputName), normalizedRows);
    const csvPath = await writeCsv(outputFile(outputName), normalizedRows, insightColumns);
    const db = writeInsightBatch({
      source: hourly ? 'active-ads-hourly' : 'active-ads',
      level: 'ads',
      accountIds: accountsResult.ids,
      rows: normalizedRows,
      metadata: {
        datePreset,
        since: since || '',
        until: until || '',
        resultAction,
        hourly,
        activeAdCount: activeAds.length,
        jsonPath,
        csvPath,
        rawRowCount: rawRows.length
      }
    });

    return {
      accounts: accountsResult.accounts,
      activeAds,
      insights: {
        csvPath,
        jsonPath,
        db,
        rawRows,
        normalizedRows
      }
    };
  }

  async pullTargets({
    accounts: accountIds = [],
    level = 'ads',
    ids = [],
    datePreset = 'today',
    since,
    until,
    resultAction = '',
    hourly = true
  } = {}) {
    const resourceType = resourceTypeForLevel(level);
    const accountsResult = accountIds.length
      ? await this.syncAccounts({ accountIds })
      : { ids: [], accounts: [] };
    const targets = ids.map((id) => resourceIdentity({ id, name: id }, resourceType));

    const insights = await this.syncInsights({
      resources: resourcesForLevel(resourceType, targets),
      accounts: accountsResult.accounts,
      level: resourceType,
      datePreset,
      since,
      until,
      resultAction,
      hourly,
      source: hourly ? `targeted-${resourceType}-hourly` : `targeted-${resourceType}`,
      outputName: hourly ? `facebook_ads_targeted_${resourceType}_hourly` : `facebook_ads_targeted_${resourceType}`
    });

    return {
      accounts: accountsResult.accounts,
      targets,
      insights
    };
  }

  async pullActiveCampaigns({
    accounts: accountIds = [],
    datePreset = 'today',
    since,
    until,
    limit = 0,
    resourceLimit = 0,
    resultAction = '',
    hourly = true
  } = {}) {
    const accountsResult = await this.syncAccounts({ accountIds });
    const campaigns = await this.syncResourceType({
      accountIds: accountsResult.ids,
      getType: 'campaigns',
      limitPerAccount: resourceLimit
    });
    const activeCampaigns = campaigns
      .filter(isActive)
      .map((row) => resourceIdentity(row, 'campaigns'));
    const selectedCampaigns = activeCampaigns.slice(0, limit || undefined);

    info(`ACTIVE 广告系列：${activeCampaigns.length}`);
    info(`本次拉取广告系列：${selectedCampaigns.length}`);

    const insights = await this.syncInsights({
      resources: resourcesForLevel('campaigns', selectedCampaigns),
      accounts: accountsResult.accounts,
      level: 'campaigns',
      datePreset,
      since,
      until,
      resultAction,
      hourly,
      source: hourly ? 'active-campaigns-hourly' : 'active-campaigns',
      outputName: hourly ? 'facebook_ads_active_campaigns_hourly' : 'facebook_ads_active_campaigns',
      limit: 0
    });

    return {
      accounts: accountsResult.accounts,
      campaigns,
      activeCampaigns,
      selectedCampaigns,
      insights
    };
  }

  async evaluateMonitoringPlans({
    accounts: accountIds = [],
    resourceLimit = 0,
    probeLevel = 'ads',
    probeLimit = 0,
    datePreset = 'yesterday',
    since,
    until,
    resultAction = ''
  } = {}) {
    const accountsResult = await this.syncAccounts({ accountIds });
    const resources = {};

    for (const getType of ['campaigns', 'adsets', 'ads']) {
      resources[getType] = await this.syncResourceType({
        accountIds: accountsResult.ids,
        getType,
        limitPerAccount: resourceLimit
      });
    }

    const counts = Object.fromEntries(Object.entries(resources).map(([type, rows]) => [
      type,
      {
        total: rows.length,
        active: rows.filter(isActive).length
      }
    ]));
    const activeCampaigns = resources.campaigns.filter(isActive);
    const activeAds = resources.ads.filter(isActive);
    const activeAdsets = resources.adsets.filter(isActive);
    const probeType = resourceTypeForLevel(probeLevel);
    const probeCandidates = (resources[probeType] || [])
      .filter(isActive)
      .slice(0, probeLimit || 0)
      .map((row) => resourceIdentity(row, probeType));
    const rowsById = new Map();
    const probeErrors = [];

    if (probeCandidates.length) {
      info(`抽样验证 ${probeCandidates.length} 个 ${probeType}`);
      const tasks = probeCandidates.map((resource) => this.limit(async () => {
        try {
          const rows = await this.client.getAllInsights({
            id: resource.id,
            fields: INSIGHT_FIELDS,
            datePreset,
            since,
            until
          });
          rowsById.set(resource.id, rows);
        } catch (error) {
          rowsById.set(resource.id, []);
          probeErrors.push({
            id: resource.id,
            message: error.message
          });
        }
      }));
      await Promise.all(tasks);
    }

    const probeRanking = rankProbeRows(rowsById);
    const report = {
      generatedAt: new Date().toISOString(),
      accounts: {
        requested: accountIds,
        resolved: accountsResult.ids,
        count: accountsResult.ids.length
      },
      resourceLimit,
      counts,
      feasibility: {
        targetedAdsOrAdsets: {
          intervalMinutes: '15-30',
          callsPerCycle: '等于配置的广告或广告组 ID 数量',
          activeAds: activeAds.length,
          activeAdsets: activeAdsets.length,
          assessment: '适合少量定向对象伪实时监控；不适合把所有 ACTIVE 广告或广告组都放入 15-30 分钟循环。'
        },
        activeCampaigns: {
          intervalMinutes: '30-60',
          callsPerCycle: activeCampaigns.length,
          assessment: activeCampaigns.length <= 100
            ? '当前 ACTIVE 广告系列数量适合全量轮询；建议保留并发限制和 SQLite 覆盖写。'
            : 'ACTIVE 广告系列数量偏高；建议先限流或分账户分批，再做全量轮询。'
        }
      },
      probe: {
        level: probeType,
        datePreset,
        since: since || '',
        until: until || '',
        resultAction,
        candidates: probeCandidates.map((row) => ({
          id: row.id,
          name: row.name || '',
          account_id: row.account_id || '',
          campaign_id: row.campaign_id || '',
          adset_id: row.adset_id || ''
        })),
        ranking: probeRanking,
        errors: probeErrors,
        recommendedTarget: probeRanking[0] || null
      }
    };

    await writeJson(rawFile('sampling_evaluation'), {
      resources,
      probeRows: Object.fromEntries(rowsById)
    });
    report.jsonPath = await writeJson(outputJsonFile('facebook_ads_sampling_evaluation'), report);
    return report;
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
