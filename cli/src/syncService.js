import pLimit from 'p-limit';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { YinoClient } from './yinoClient.js';
import { info, warn } from './logger.js';
import { normalizeInsight, insightColumns } from './normalizer.js';
import { outputFile, outputJsonFile, rawFile, writeCsv, writeJson } from './storage.js';
import {
  claimCollectionJob,
  completeCollectionJobWithSuccessBatch,
  enqueueCollectionJobs,
  failCollectionJob,
  getInsightCoverage,
  readCompletedBucketCoverage,
  readCollectionWatermarks,
  readCollectionRunFinalStats,
  readResources,
  recoverStaleCollectionJobsWithSuccessBatches,
  writeApiTaskRuns,
  writeCollectionJobBatch,
  writeInsightBatch,
  writeResources
} from './database.js';
import { runTaskQueue } from './taskQueue.js';
import {
  API_FALLBACK_TIME_ZONE,
  dateRangeDays,
  enumerateSettledHourBuckets,
  hourFromHourlyRange,
  latestSettledHourBucket,
  normalizeTimeZone,
  recentDays,
  recentSevenDays
} from './time.js';

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

const INFO_FIELDS = [
  'id',
  'name',
  'account_id',
  'campaign_id',
  'adset_id',
  'effective_status',
  'status'
];

const HOURLY_BREAKDOWN = 'hourly_stats_aggregated_by_advertiser_time_zone';
const META_BATCH_ID_LIMIT = 50;
const COLLECTION_BACKFILL_DAYS = 90;
const INITIAL_COLLECTION_BACKFILL_REASON = `initial-${COLLECTION_BACKFILL_DAYS}d-backfill`;
const EXPANDED_COLLECTION_BACKFILL_REASON = `expanded-${COLLECTION_BACKFILL_DAYS}d-backfill`;

function chunks(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapById(rows, idField) {
  return new Map(rows.filter((row) => row?.[idField]).map((row) => [String(row[idField]), row]));
}

function resourceTypeForLevel(level) {
  if (level === 'campaigns') return 'campaigns';
  if (level === 'adsets') return 'adsets';
  return 'ads';
}

function objectIdLabelForResourceType(resourceType) {
  if (resourceType === 'ads') return 'ad_id';
  if (resourceType === 'adsets') return 'adset_id';
  return 'campaign_id';
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

function normalizeObjectIds(ids = [], { min = 1, max = Number.POSITIVE_INFINITY, label = 'ID' } = {}) {
  const normalized = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
  if (normalized.length < min) {
    throw new Error(`${label} 数量必须至少 ${min} 个，当前 ${normalized.length} 个`);
  }
  if (Number.isFinite(max) && normalized.length > max) {
    throw new Error(`${label} 数量必须在 ${min}-${max} 个之间，当前 ${normalized.length} 个`);
  }
  return normalized;
}

function localActiveFilter(rows, activeOnly) {
  return activeOnly ? rows.filter(isActive) : rows;
}

function sourceTimeZoneFor(resource, accountsById) {
  const accountId = String(resource?.account_id || '').trim();
  const account = accountId ? accountsById.get(accountId) : null;
  if (account?.timezone_name) {
    return normalizeTimeZone(account.timezone_name);
  }

  if (accountsById.size === 1) {
    const [onlyAccount] = accountsById.values();
    if (onlyAccount?.timezone_name) {
      return normalizeTimeZone(onlyAccount.timezone_name);
    }
  }

  return API_FALLBACK_TIME_ZONE;
}

function tagSlicesWithTimeZone(slices, sourceTimeZone) {
  const normalized = normalizeTimeZone(sourceTimeZone);
  return slices.map((slice) => ({
    ...slice,
    sourceTimeZone: normalized
  }));
}

function insightTaskSliceKey(task) {
  return [
    task.objectType,
    task.datePreset || '',
    task.since || '',
    task.until || '',
    task.sourceTimeZone || ''
  ].join('|');
}

function batchInsightTasks(tasks, batchSize = META_BATCH_ID_LIMIT) {
  const groups = new Map();
  tasks.forEach((task) => {
    const key = insightTaskSliceKey(task);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  });

  return [...groups.values()].flatMap((group) => chunks(group, batchSize).map((batch, batchIndex) => {
    const first = batch[0];
    const objectIds = batch.map((task) => String(task.objectId));
    return {
      ...first,
      taskId: `${first.objectType}:batch:${first.datePreset || `${first.since}_${first.until}`}:${batchIndex + 1}:${objectIds.join(',')}`,
      objectId: objectIds.join(','),
      objectIds,
      label: batch.length === 1 ? first.label : `${batch.length} 个${first.objectType}`,
      batchSize: batch.length,
      sourceTasks: batch
    };
  }));
}

function extractInfoRows(payload) {
  const data = payload?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (data && typeof data === 'object') {
    return Object.values(data).flatMap((value) => {
      if (Array.isArray(value)) return value;
      return value && typeof value === 'object' ? [value] : [];
    });
  }
  return [];
}

function createRequestStartLimiter(qps = 5) {
  const interval = Math.ceil(1000 / Math.max(1, Number(qps || 1)));
  let nextSlot = 0;
  return async () => {
    const now = Date.now();
    const delay = Math.max(0, nextSlot - now);
    nextSlot = Math.max(now, nextSlot) + interval;
    if (delay > 0) await sleep(delay);
  };
}

function rateLimitFlags(error = {}) {
  const text = `${error.message || ''} ${error.code || ''} ${error.httpStatus || ''}`.toLowerCase();
  return {
    rateLimited: Number(error.code) === 429 || Number(error.httpStatus) === 429 || /rate.?limit|too many requests|qps|限流/.test(text),
    quotaLimited: /quota|over.?quota|超配额|配额/.test(text)
  };
}

function isRetryableJobError(error = {}) {
  if (error.retryable === true) return true;
  if (Number(error.code) === 429 || Number(error.httpStatus) === 429 || Number(error.code) === 203) return true;
  return /timeout|abort|network|fetch|限流|rate.?limit|temporar/i.test(error.message || '');
}

function backoffForAttempt(attempt) {
  return Math.min(15 * 60_000, Math.round(1000 * (2 ** Math.max(0, Number(attempt || 1) - 1))));
}

function objectIdFromNormalized(row, objectType) {
  if (objectType === 'campaigns') return String(row.campaign_id || '').trim();
  if (objectType === 'adsets') return String(row.adset_id || '').trim();
  return String(row.ad_id || '').trim();
}

function rowMatchesBucket(row, bucket) {
  return String(row.date_start || '') === bucket.dateStart
    && hourFromHourlyRange(row.hourly_stats_aggregated_by_advertiser_time_zone) === bucket.hour;
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

  async syncResources({ accountIds, limitPerType = 0, activeOnly = false } = {}) {
    const types = ['campaigns', 'adsets', 'ads'];
    const result = { campaigns: [], adsets: [], ads: [] };

    for (const accountId of accountIds) {
      for (const getType of types) {
        info(`拉取账户 ${accountId} 的 ${getType}`);
        const rows = await this.client.getAllResources({
          accountId,
          getType,
          effectiveStatus: activeOnly ? ['ACTIVE'] : undefined,
          limit: limitPerType || undefined
        });
        result[getType].push(...localActiveFilter(rows, activeOnly));
      }
    }

    for (const getType of types) {
      writeResources({ getType, rows: result[getType] });
    }
    await writeJson(rawFile('resources'), result);
    return result;
  }

  async syncResourceType({ accountIds, getType, limitPerAccount = 0, activeOnly = false } = {}) {
    const rows = [];

    for (const accountId of accountIds) {
      info(`拉取账户 ${accountId} 的 ${getType}`);
      rows.push(...await this.client.getAllResources({
        accountId,
        getType,
        effectiveStatus: activeOnly ? ['ACTIVE'] : undefined,
        limit: limitPerAccount || undefined
      }));
    }

    const filtered = localActiveFilter(rows, activeOnly);
    writeResources({ getType, rows: filtered });
    await writeJson(rawFile(getType), filtered);
    return filtered;
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

  resolveDateSlices({ level, ids, since, until, datePreset, hourly = true, sourceTimeZone = API_FALLBACK_TIME_ZONE }) {
    const resolvedTimeZone = normalizeTimeZone(sourceTimeZone);
    if (since && until) {
      return tagSlicesWithTimeZone(hourly ? dateRangeDays(since, until) : [{ since, until }], resolvedTimeZone);
    }
    if (datePreset) {
      return tagSlicesWithTimeZone([{ datePreset }], resolvedTimeZone);
    }

    const recent = recentSevenDays(resolvedTimeZone);
    const coverage = getInsightCoverage({
      level,
      ids,
      since: recent.since,
      hourlyOnly: hourly
    });
    const requiredDateCount = hourly ? 7 : 1;
    const hasMissingHistory = ids.some((id) => {
      const row = coverage.get(String(id));
      return !row?.row_count || Number(row.date_count || 0) < requiredDateCount;
    });

    if (hasMissingHistory) {
      return tagSlicesWithTimeZone(hourly ? dateRangeDays(recent.since, recent.until) : [recent], resolvedTimeZone);
    }

    const today = recentSevenDays(resolvedTimeZone).until;
    return tagSlicesWithTimeZone([{ since: today, until: today }], resolvedTimeZone);
  }

  async enrichSourceRowsWithInfo(sourceRows, resourceType) {
    const missing = sourceRows.filter((row) => !row.account_id || !row.name);
    if (!missing.length) return sourceRows;

    try {
      const infoRows = [];
      const batches = chunks(missing.map((row) => row.id), META_BATCH_ID_LIMIT);
      for (const [index, batch] of batches.entries()) {
        if (index > 0) await sleep(220);
        const payload = await this.client.getInfo(batch, INFO_FIELDS);
        infoRows.push(...extractInfoRows(payload));
      }
      const infoMap = new Map(infoRows
        .map((row) => resourceIdentity(row, resourceType))
        .filter((row) => row.id)
        .map((row) => [String(row.id), row]));
      return sourceRows.map((row) => ({
        ...infoMap.get(String(row.id)),
        ...row,
        name: row.name && row.name !== row.id ? row.name : infoMap.get(String(row.id))?.name || row.name
      }));
    } catch (error) {
      warn(`批量补充 ${resourceType} info 失败，继续按已有 ID 采集：${error.message}`);
      return sourceRows;
    }
  }

  planHourlyCollectionJobs({
    sourceRows = [],
    resourceType = 'ads',
    accountMap = new Map(),
    since,
    until,
    runId,
    resultAction = '',
    source = '',
    tool = '',
    outputName = '',
    maxAttempts = 8
  } = {}) {
    const ids = sourceRows.map((row) => String(row.id || '')).filter(Boolean);
    const watermarks = readCollectionWatermarks({ objectType: resourceType, ids });
    const groups = new Map();
    const plannedSlices = [];
    const planningRows = [];
    const allBucketKeys = new Set();
    const settledByTimeZone = new Map();
    const recentByTimeZone = new Map();
    const bucketsByWindow = new Map();

    for (const resource of sourceRows) {
      const objectId = String(resource.id || '').trim();
      if (!objectId) continue;
      const sourceTimeZone = sourceTimeZoneFor(resource, accountMap);
      if (!settledByTimeZone.has(sourceTimeZone)) {
        settledByTimeZone.set(sourceTimeZone, latestSettledHourBucket(sourceTimeZone));
      }
      if (!recentByTimeZone.has(sourceTimeZone)) {
        recentByTimeZone.set(sourceTimeZone, recentDays(sourceTimeZone, COLLECTION_BACKFILL_DAYS));
      }
      const latestSettled = settledByTimeZone.get(sourceTimeZone);
      const recent = recentByTimeZone.get(sourceTimeZone);
      const watermark = watermarks.get(objectId)?.last_completed_bucket || '';
      const watermarkDate = watermark ? watermark.slice(0, 10) : '';
      const planSince = since || (watermarkDate && watermarkDate < recent.since ? watermarkDate : recent.since);
      const planUntil = until || latestSettled.dateStart;
      const bucketWindowKey = `${sourceTimeZone}|${planSince}|${planUntil}`;
      if (!bucketsByWindow.has(bucketWindowKey)) {
        bucketsByWindow.set(bucketWindowKey, enumerateSettledHourBuckets({
          since: planSince,
          until: planUntil,
          timeZone: sourceTimeZone
        }));
      }
      const buckets = bucketsByWindow.get(bucketWindowKey);
      for (const bucket of buckets) {
        allBucketKeys.add(bucket.bucketKey);
      }
      planningRows.push({
        resource,
        objectId,
        sourceTimeZone,
        latestSettled,
        recent,
        watermark,
        watermarkDate,
        planSince,
        planUntil,
        buckets
      });
    }

    const coverage = readCompletedBucketCoverage({
      objectType: resourceType,
      ids,
      bucketKeys: [...allBucketKeys],
      includeInsightRows: false
    });

    for (const plan of planningRows) {
      const {
        resource,
        objectId,
        sourceTimeZone,
        latestSettled,
        recent,
        watermark,
        watermarkDate,
        planSince,
        planUntil,
        buckets
      } = plan;
      const covered = coverage.get(objectId) || new Set();
      const missingBuckets = buckets.filter((bucket) => !covered.has(bucket.bucketKey));
      const planReason = since && until
        ? 'manual-range'
        : !watermark
          ? INITIAL_COLLECTION_BACKFILL_REASON
          : planSince === recent.since && watermarkDate > recent.since
            ? EXPANDED_COLLECTION_BACKFILL_REASON
            : 'incremental';

      plannedSlices.push({
        objectId,
        sourceTimeZone,
        reason: planReason,
        backfillDays: COLLECTION_BACKFILL_DAYS,
        since: planSince,
        until: planUntil,
        latestSettledBucket: latestSettled.bucketKey,
        watermark,
        bucketCount: buckets.length,
        missingBucketCount: missingBuckets.length
      });

      for (const bucket of missingBuckets) {
        const accountId = String(resource.account_id || '').trim();
        const groupKey = [
          resourceType,
          accountId,
          sourceTimeZone,
          bucket.bucketKey
        ].join('|');
        if (!groups.has(groupKey)) {
          groups.set(groupKey, {
            resourceType,
            accountId,
            sourceTimeZone,
            bucket,
            resources: []
          });
        }
        groups.get(groupKey).resources.push(resource);
      }
    }

    const jobs = [];
    for (const group of groups.values()) {
      for (const [batchIndex, batch] of chunks(group.resources, META_BATCH_ID_LIMIT).entries()) {
        const objectIds = batch.map((row) => String(row.id));
        const sortedObjectIds = [...objectIds].sort();
        jobs.push({
          runId,
          queueName: 'insights',
          triggerSource: source || tool || `queue:${resourceType}`,
          level: resourceType,
          objectType: resourceType,
          accountId: group.accountId,
          accountTimeZone: group.sourceTimeZone,
          objectIds,
          dateStart: group.bucket.dateStart,
          hourlyRange: group.bucket.hourlyRange,
          bucketKey: group.bucket.bucketKey,
          bucketStartUtc: group.bucket.bucketStartUtc,
          bucketEndUtc: group.bucket.bucketEndUtc,
          maxAttempts,
          dedupeKey: [
            resourceType,
            group.accountId,
            group.sourceTimeZone,
            group.bucket.bucketKey,
            sortedObjectIds.join(',')
          ].join('|'),
          metadata: {
            resultAction,
            tool,
            outputName,
            batchIndex: batchIndex + 1,
            batchMaxSize: META_BATCH_ID_LIMIT,
            resources: batch,
            bucket: group.bucket
          }
        });
      }
    }

    return {
      jobs,
      plannedSlices
    };
  }

  async executeCollectionJob(job, { timeoutMs = 7000 } = {}) {
    const objectIds = job.objectIds || [];
    const bucket = {
      dateStart: job.date_start,
      hour: hourFromHourlyRange(job.hourly_range),
      hourlyRange: job.hourly_range,
      bucketKey: job.bucket_key
    };
    const metadata = job.metadata || {};
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const resourceRows = Array.isArray(metadata.resources) && metadata.resources.length
      ? metadata.resources
      : readResources({
        getType: job.object_type,
        ids: objectIds,
        limit: Math.max(objectIds.length, 1)
      }).map((row) => resourceIdentity(row, job.object_type));
    const resourcesById = new Map(resourceRows.map((row) => resourceIdentity(row, job.object_type)).map((row) => [String(row.id), row]));
    const accountsById = new Map();
    if (job.account_id) {
      accountsById.set(String(job.account_id), {
        account_id: job.account_id,
        timezone_name: job.account_timezone
      });
    }

    const stats = await this.client.getAllInsightsWithStats({
      id: objectIds,
      fields: INSIGHT_FIELDS,
      since: job.date_start,
      until: job.date_start,
      breakdowns: HOURLY_BREAKDOWN,
      timeoutMs
    });
    const rawRows = stats.rows
      .filter((row) => rowMatchesBucket(row, bucket))
      .map((row) => (objectIds.length === 1 ? { ...row, id: objectIds[0] } : row));
    const normalizedRows = rawRows.map((row) => normalizeInsight(row, {
      accountsById,
      resourcesById,
      resultAction: metadata.resultAction || ''
    }));
    const rowCountByObject = {};
    for (const row of normalizedRows) {
      const objectId = objectIdFromNormalized(row, job.object_type);
      if (!objectId) continue;
      rowCountByObject[objectId] = (rowCountByObject[objectId] || 0) + 1;
    }

    const db = writeInsightBatch({
      source: job.trigger_source || metadata.tool || `queue:${job.object_type}`,
      level: job.object_type,
      accountIds: [job.account_id].filter(Boolean),
      rows: normalizedRows,
      metadata: {
        runId: job.run_id,
        collectionJobId: job.id,
        bucketKey: job.bucket_key,
        dateStart: job.date_start,
        hourlyRange: job.hourly_range,
        objectIds,
        resultAction: metadata.resultAction || '',
        hourly: true,
        rawRowCount: rawRows.length
      }
    });
    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startedMs;
    completeCollectionJobWithSuccessBatch({
      jobId: job.id,
      runId: job.run_id,
      kind: 'insights',
      requestIds: stats.requestIds || [],
      idCount: objectIds.length,
      rowCount: normalizedRows.length,
      rawRowCount: rawRows.length,
      pages: stats.pages || 0,
      httpStatus: stats.httpStatus,
      apiCode: stats.code,
      bodySize: stats.bodySize,
      durationMs,
      startedAt,
      completedAt,
      batchMetadata: {
        bucketKey: job.bucket_key,
        dateStart: job.date_start,
        hourlyRange: job.hourly_range
      },
      rowCountByObject,
      metadata: {
        batchId: db.batchId
      }
    });

    return {
      jobId: job.id,
      runId: job.run_id,
      objectType: job.object_type,
      objectIds,
      status: 'success',
      attempts: job.attempts,
      durationMs,
      rows: normalizedRows.length,
      rawRows,
      normalizedRows,
      db
    };
  }

  async runPersistentCollectionQueue({
    queueName = 'insights',
    runId = '',
    concurrency = 20,
    qps = 5,
    timeoutMs = 7000,
    recoverStaleAfterMs = 5 * 60 * 1000
  } = {}) {
    recoverStaleCollectionJobsWithSuccessBatches({ queueName, runId, staleAfterMs: recoverStaleAfterMs });
    const workerCount = Math.max(1, Number.parseInt(concurrency, 10) || 1);
    const waitForStartSlot = createRequestStartLimiter(qps);
    const records = [];
    const results = [];
    const workerPrefix = `pid-${process.pid}-${Date.now()}`;

    const waitForPendingRetry = async () => {
      if (!runId) return false;
      const stats = readCollectionRunFinalStats({ runId, queueName });
      if (!stats || Number(stats.pending || 0) <= 0) return false;
      const nextAttemptMs = Date.parse(stats.nextAttemptAt || '');
      const waitMs = Number.isFinite(nextAttemptMs)
        ? nextAttemptMs - Date.now()
        : 500;
      await sleep(Math.min(5000, Math.max(250, waitMs)));
      return true;
    };

    const workerLoop = async (index) => {
      const workerId = `${workerPrefix}-${index + 1}`;
      while (true) {
        const job = claimCollectionJob({ queueName, runId, workerId });
        if (!job) {
          const shouldContinue = await waitForPendingRetry();
          if (shouldContinue) continue;
          break;
        }
        const startedAt = new Date().toISOString();
        const startedMs = Date.now();
        try {
          await waitForStartSlot();
          const result = await this.executeCollectionJob(job, { timeoutMs });
          results.push(result);
          records.push({
            taskId: job.id,
            runId: job.run_id,
            objectType: job.object_type,
            objectId: (job.objectIds || []).join(','),
            label: `${job.objectIds?.length || 0} 个${job.object_type}`,
            attempts: job.attempts,
            durationMs: result.durationMs,
            status: 'success',
            code: 200,
            bodySize: 0,
            rows: result.rows,
            error: '',
            startedAt,
            completedAt: new Date().toISOString(),
            since: job.date_start,
            until: job.date_start,
            sourceTimeZone: job.account_timezone,
            bucketKey: job.bucket_key
          });
        } catch (error) {
          const durationMs = Date.now() - startedMs;
          const flags = rateLimitFlags(error);
          const completedAt = new Date().toISOString();
          writeCollectionJobBatch({
            jobId: job.id,
            runId: job.run_id,
            kind: 'insights',
            status: 'failed',
            idCount: job.objectIds?.length || 0,
            itemSuccessCount: 0,
            itemFailedCount: job.objectIds?.length || 0,
            rowCount: 0,
            rawRowCount: 0,
            httpStatus: error.httpStatus || '',
            apiCode: error.code || '',
            bodySize: error.bodySize || 0,
            durationMs,
            rateLimited: flags.rateLimited,
            quotaLimited: flags.quotaLimited,
            error: error.message,
            startedAt,
            completedAt,
            metadata: {
              bucketKey: job.bucket_key,
              itemErrors: error.itemErrors || []
            }
          });
          const failed = failCollectionJob({
            jobId: job.id,
            error: error.message,
            durationMs,
            rateLimited: flags.rateLimited,
            quotaLimited: flags.quotaLimited,
            retry: isRetryableJobError(error),
            backoffMs: backoffForAttempt(job.attempts),
            metadata: {
              lastCode: error.code || '',
              lastHttpStatus: error.httpStatus || ''
            }
          });
          records.push({
            taskId: job.id,
            runId: job.run_id,
            objectType: job.object_type,
            objectId: (job.objectIds || []).join(','),
            label: `${job.objectIds?.length || 0} 个${job.object_type}`,
            attempts: job.attempts,
            durationMs,
            status: failed.status === 'retry' ? 'failed' : 'failed',
            code: error.code || error.httpStatus || '',
            bodySize: error.bodySize || 0,
            rows: 0,
            error: error.message,
            startedAt,
            completedAt,
            since: job.date_start,
            until: job.date_start,
            sourceTimeZone: job.account_timezone,
            bucketKey: job.bucket_key,
            queueStatus: failed.status,
            nextAttemptAt: failed.nextAttemptAt
          });
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, (_, index) => workerLoop(index)));
    const scopedRecords = runId ? records.filter((record) => record.runId === runId) : records;
    const scopedResults = runId ? results.filter((result) => result.runId === runId) : results;
    const finalStats = runId ? readCollectionRunFinalStats({ runId, queueName }) : null;
    const success = finalStats ? finalStats.completed : scopedRecords.filter((record) => record.status === 'success').length;
    const failed = finalStats ? finalStats.failed : scopedRecords.length - success;
    const pending = finalStats ? finalStats.pending : 0;
    const retries = finalStats
      ? finalStats.retries
      : scopedRecords.reduce((total, record) => total + Math.max(0, Number(record.attempts || 0) - 1), 0)
        + scopedRecords.filter((record) => record.queueStatus === 'retry').length;

    return {
      stats: {
        total: finalStats?.total || scopedRecords.length,
        success,
        failed,
        pending,
        retries,
        failureSummary: finalStats?.failureSummary || '',
        workerConcurrency: workerCount
      },
      taskRecords: scopedRecords,
      results: scopedResults
    };
  }

  async pullQueuedHourlyInsights(options = {}) {
    const {
      ids = [],
      resources = {},
      accounts = [],
      level = 'ads',
      since,
      until,
      resultAction = '',
      concurrency = 20,
      qps = 5,
      timeoutMs = 7000,
      maxAttempts = 8,
      source = '',
      outputName = '',
      tool = '',
      maxObjects
    } = options;
    const resourceType = resourceTypeForLevel(level);
    const objectLimit = Number.isFinite(maxObjects)
      ? maxObjects
      : Number.POSITIVE_INFINITY;
    const normalizedIds = normalizeObjectIds(ids, {
      min: 1,
      max: objectLimit,
      label: objectIdLabelForResourceType(resourceType)
    });
    const resourceRows = (resources[resourceType] || [])
      .map((row) => resourceIdentity(row, resourceType))
      .filter((row) => row.id);
    const resourceMap = new Map(resourceRows.map((row) => [String(row.id), row]));
    let sourceRows = normalizedIds.map((id) => resourceMap.get(String(id)) || resourceIdentity({ id, name: id }, resourceType));
    sourceRows = await this.enrichSourceRowsWithInfo(sourceRows, resourceType);
    const accountMap = mapById(accounts, 'account_id');
    const runId = randomUUID();
    const plan = this.planHourlyCollectionJobs({
      sourceRows,
      resourceType,
      accountMap,
      since,
      until,
      runId,
      resultAction,
      source,
      tool,
      outputName,
      maxAttempts
    });
    const enqueue = enqueueCollectionJobs({ jobs: plan.jobs });

    info(`持久化采集队列：${resourceType} ${sourceRows.length} 个对象，规划 ${plan.jobs.length} 个 Job，写入 ${enqueue.inserted} 个，跳过 ${enqueue.skipped} 个，并发 ${concurrency}，QPS ${qps}`);
    const queue = await this.runPersistentCollectionQueue({
      queueName: 'insights',
      runId,
      concurrency,
      qps,
      timeoutMs
    });
    queue.stats.total = Math.max(Number(queue.stats.total || 0), enqueue.inserted);
    const unsettled = queue.stats.total - queue.stats.success - queue.stats.failed - Number(queue.stats.pending || 0);
    if (unsettled > 0) {
      queue.stats.pending = Number(queue.stats.pending || 0) + unsettled;
    }

    const rawRows = queue.results.flatMap((item) => item.rawRows || []);
    const normalizedRows = queue.results.flatMap((item) => item.normalizedRows || []);
    await writeJson(rawFile(`${tool || resourceType}_persistent_queue`), {
      runId,
      plan,
      enqueue,
      tasks: queue.taskRecords,
      rawRows
    });
    const baseOutputName = outputName || `facebook_ads_${resourceType}_hourly`;
    const jsonPath = await writeJson(outputJsonFile(baseOutputName), normalizedRows);
    const csvPath = await writeCsv(outputFile(baseOutputName), normalizedRows, insightColumns);
    writeApiTaskRuns({
      runId,
      tool: tool || `queue:${resourceType}`,
      taskRecords: queue.taskRecords,
      metadata: {
        since: since || '',
        until: until || '',
        hourly: true,
        persistentQueue: true
      }
    });

    return {
      runId,
      queue,
      csvPath,
      jsonPath,
      db: {
        databaseFile: config.databaseFile,
        batchId: runId,
        rowCount: normalizedRows.length,
        completedAt: new Date().toISOString()
      },
      rawRows,
      normalizedRows,
      tasks: plan.jobs,
      batchTasks: plan.jobs,
      slices: plan.plannedSlices,
      enqueue
    };
  }

  async pullQueuedInsights({
    ids = [],
    resources = {},
    accounts = [],
    level = 'ads',
    datePreset,
    since,
    until,
    resultAction = '',
    hourly = true,
    concurrency = 20,
    qps = 5,
    timeoutMs = 7000,
    maxAttempts = 8,
    source = '',
    outputName = '',
    tool = '',
    maxObjects
  } = {}) {
    if (hourly && !datePreset) {
      return this.pullQueuedHourlyInsights({
        ids,
        resources,
        accounts,
        level,
        since,
        until,
        resultAction,
        concurrency,
        qps,
        timeoutMs,
        maxAttempts,
        source,
        outputName,
        tool,
        maxObjects
      });
    }

    const resourceType = resourceTypeForLevel(level);
    const objectLimit = Number.isFinite(maxObjects)
      ? maxObjects
      : Number.POSITIVE_INFINITY;
    const normalizedIds = normalizeObjectIds(ids, {
      min: 1,
      max: objectLimit,
      label: objectIdLabelForResourceType(resourceType)
    });
    const resourceRows = (resources[resourceType] || [])
      .map((row) => resourceIdentity(row, resourceType))
      .filter((row) => row.id);
    const resourceMap = new Map(resourceRows.map((row) => [String(row.id), row]));
    let sourceRows = normalizedIds.map((id) => resourceMap.get(String(id)) || resourceIdentity({ id, name: id }, resourceType));
    sourceRows = await this.enrichSourceRowsWithInfo(sourceRows, resourceType);
    const accountMap = mapById(accounts, 'account_id');
    const runId = randomUUID();
    const resolvedSlices = [];
    const tasks = sourceRows.flatMap((resource) => {
      const slices = this.resolveDateSlices({
        level: resourceType,
        ids: [resource.id],
        since,
        until,
        datePreset,
        hourly,
        sourceTimeZone: sourceTimeZoneFor(resource, accountMap)
      });

      resolvedSlices.push(...slices.map((slice) => ({
        objectId: resource.id,
        ...slice
      })));

      return slices.map((slice) => ({
        taskId: `${resourceType}:${resource.id}:${slice.datePreset || `${slice.since}_${slice.until}`}`,
        objectId: resource.id,
        objectType: resourceType,
        label: resource.name || resource.id,
        ...slice
      }));
    });

    const batchTasks = batchInsightTasks(tasks, META_BATCH_ID_LIMIT);

    info(`Insights 队列：${resourceType} ${sourceRows.length} 个对象，${tasks.length} 个对象窗口，${batchTasks.length} 个批任务，并发 ${concurrency}，QPS ${qps}`);

    const queue = await runTaskQueue({
      tasks: batchTasks,
      concurrency,
      qps,
      maxAttempts,
      worker: async (task) => {
        const objectIds = task.objectIds || [task.objectId];
        const stats = await this.client.getAllInsightsWithStats({
          id: objectIds,
          fields: INSIGHT_FIELDS,
          datePreset: task.datePreset,
          since: task.since,
          until: task.until,
          breakdowns: hourly ? HOURLY_BREAKDOWN : '',
          timeoutMs
        });
        return {
          code: stats.code,
          bodySize: stats.bodySize,
          rows: stats.rows.length,
          rawRows: stats.rows.map((row) => (objectIds.length === 1 ? { ...row, id: objectIds[0] } : row))
        };
      }
    });

    const rawRows = queue.results.flatMap((item) => item.result?.rawRows || []);
    const combinedResourceMap = new Map([
      ...(resources.campaigns || []).map((row) => resourceIdentity(row, 'campaigns')).map((row) => [String(row.id), row]),
      ...(resources.adsets || []).map((row) => resourceIdentity(row, 'adsets')).map((row) => [String(row.id), row]),
      ...(resources.ads || []).map((row) => resourceIdentity(row, 'ads')).map((row) => [String(row.id), row]),
      ...sourceRows.map((row) => [String(row.id), row])
    ]);
    const normalizedRows = rawRows.map((row) => normalizeInsight(row, {
      accountsById: accountMap,
      resourcesById: combinedResourceMap,
      resultAction
    }));

    await writeJson(rawFile(`${tool || resourceType}_queue`), {
      runId,
      tasks: queue.taskRecords,
      rawRows
    });
    const baseOutputName = outputName || `facebook_ads_${resourceType}_hourly`;
    const jsonPath = await writeJson(outputJsonFile(baseOutputName), normalizedRows);
    const csvPath = await writeCsv(outputFile(baseOutputName), normalizedRows, insightColumns);
    const db = writeInsightBatch({
      source: source || tool || `queue:${resourceType}`,
      level: resourceType,
      accountIds: accounts.map((account) => account.account_id).filter(Boolean),
      rows: normalizedRows,
      metadata: {
        runId,
        datePreset: datePreset || '',
        since: since || '',
        until: until || '',
        resolvedSlices,
        resultAction,
        hourly,
        requestedObjectCount: sourceRows.length,
        objectWindowCount: tasks.length,
        taskCount: batchTasks.length,
        batchMaxSize: META_BATCH_ID_LIMIT,
        queue: queue.stats,
        jsonPath,
        csvPath,
        rawRowCount: rawRows.length
      }
    });
    writeApiTaskRuns({
      runId,
      tool: tool || `queue:${resourceType}`,
      taskRecords: queue.taskRecords,
      metadata: {
        datePreset: datePreset || '',
        since: since || '',
        until: until || '',
        hourly
      }
    });

    return {
      runId,
      queue,
      csvPath,
      jsonPath,
      db,
      rawRows,
      normalizedRows,
      tasks,
      batchTasks,
      slices: resolvedSlices
    };
  }

  async pullAdInsightsTool({
    ids = [],
    accounts: accountIds = [],
    resources = [],
    datePreset,
    since,
    until,
    resultAction = '',
    hourly = true,
    concurrency = 20,
    qps = 5,
    timeoutMs = 7000,
    maxAttempts = 8
  } = {}) {
    const normalizedIds = normalizeObjectIds(ids, { min: 1, max: Number.POSITIVE_INFINITY, label: 'ad_id' });
    const accountsResult = accountIds.length
      ? await this.syncAccounts({ accountIds })
      : { ids: [], accounts: [] };
    const adResources = resources.length
      ? resources
      : accountIds.length
        ? await this.syncResourceType({ accountIds: accountsResult.ids, getType: 'ads', activeOnly: true })
        : normalizedIds.map((id) => ({ id, ad_id: id, name: id }));

    return this.pullQueuedInsights({
      ids: normalizedIds,
      resources: { ads: adResources },
      accounts: accountsResult.accounts,
      level: 'ads',
      datePreset,
      since,
      until,
      resultAction,
      hourly,
      concurrency,
      qps,
      timeoutMs,
      maxAttempts,
      source: 'tool1:ad-insights',
      outputName: 'facebook_ads_tool1_ad_hourly',
      tool: 'tool1-ad-insights'
    });
  }

  async pullCampaignInsightsTool({
    ids = [],
    accounts: accountIds = [],
    resources = [],
    datePreset,
    since,
    until,
    resultAction = '',
    hourly = true,
    concurrency = 20,
    qps = 5,
    timeoutMs = 7000,
    maxAttempts = 8
  } = {}) {
    const normalizedIds = normalizeObjectIds(ids, { min: 1, max: Number.POSITIVE_INFINITY, label: 'campaign_id' });
    const accountsResult = accountIds.length
      ? await this.syncAccounts({ accountIds })
      : { ids: [], accounts: [] };
    const campaignResources = resources.length
      ? resources
      : accountIds.length
        ? await this.syncResourceType({ accountIds: accountsResult.ids, getType: 'campaigns', activeOnly: true })
        : normalizedIds.map((id) => ({ id, campaign_id: id, name: id }));

    return this.pullQueuedInsights({
      ids: normalizedIds,
      resources: { campaigns: campaignResources },
      accounts: accountsResult.accounts,
      level: 'campaigns',
      datePreset,
      since,
      until,
      resultAction,
      hourly,
      concurrency,
      qps,
      timeoutMs,
      maxAttempts,
      source: 'tool3:campaign-insights',
      outputName: 'facebook_ads_tool3_campaign_hourly',
      tool: 'tool3-campaign-insights'
    });
  }

  async pullResourceList({
    accounts: accountIds = [],
    getType = 'all',
    activeOnly = false,
    limit = 0
  } = {}) {
    const accountsResult = await this.syncAccounts({ accountIds });
    const types = getType === 'all' ? ['campaigns', 'adsets', 'ads'] : [getType];
    const resources = {};

    for (const type of types) {
      resources[type] = await this.syncResourceType({
        accountIds: accountsResult.ids,
        getType: type,
        limitPerAccount: limit,
        activeOnly
      });
    }

    return {
      accounts: accountsResult.accounts,
      accountIds: accountsResult.ids,
      resources
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
          effectiveStatus: ['ACTIVE'],
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
    datePreset,
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
    let resolvedTargetResources = targets;
    if (accountsResult.ids.length > 1) {
      const accountResources = await this.syncResourceType({
        accountIds: accountsResult.ids,
        getType: resourceType
      });
      const resourcesById = new Map(accountResources
        .map((row) => resourceIdentity(row, resourceType))
        .map((row) => [String(row.id), row]));
      resolvedTargetResources = targets.map((target) => resourcesById.get(String(target.id)) || target);
    }

    const insights = await this.pullQueuedInsights({
      ids,
      resources: resourcesForLevel(resourceType, resolvedTargetResources),
      accounts: accountsResult.accounts,
      level: resourceType,
      datePreset: datePreset || undefined,
      since,
      until,
      resultAction,
      hourly,
      maxObjects: Number.MAX_SAFE_INTEGER,
      source: hourly ? `targeted-${resourceType}-hourly` : `targeted-${resourceType}`,
      outputName: hourly ? `facebook_ads_targeted_${resourceType}_hourly` : `facebook_ads_targeted_${resourceType}`,
      tool: hourly ? `targeted-${resourceType}-hourly` : `targeted-${resourceType}`
    });

    return {
      accounts: accountsResult.accounts,
      targets,
      insights
    };
  }

  async pullActiveCampaigns({
    accounts: accountIds = [],
    datePreset,
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
      limitPerAccount: resourceLimit,
      activeOnly: true
    });
    const activeCampaigns = campaigns
      .filter(isActive)
      .map((row) => resourceIdentity(row, 'campaigns'));
    const selectedCampaigns = activeCampaigns.slice(0, limit || undefined);

    info(`ACTIVE 广告系列：${activeCampaigns.length}`);
    info(`本次拉取广告系列：${selectedCampaigns.length}`);

    const insights = selectedCampaigns.length
      ? await this.pullQueuedInsights({
        ids: selectedCampaigns.map((row) => String(row.id || row.campaign_id)),
        resources: resourcesForLevel('campaigns', selectedCampaigns),
        accounts: accountsResult.accounts,
        level: 'campaigns',
        datePreset: datePreset || undefined,
        since,
        until,
        resultAction,
        hourly,
        maxObjects: Number.MAX_SAFE_INTEGER,
        source: hourly ? 'active-campaigns-hourly' : 'active-campaigns',
        outputName: hourly ? 'facebook_ads_active_campaigns_hourly' : 'facebook_ads_active_campaigns',
        tool: hourly ? 'active-campaigns-hourly' : 'active-campaigns'
      })
      : await this.syncInsights({
        resources: resourcesForLevel('campaigns', selectedCampaigns),
        accounts: accountsResult.accounts,
        level: 'campaigns',
        datePreset: datePreset || '',
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
