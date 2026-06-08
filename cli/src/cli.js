#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { config, assertCredentials } from './config.js';
import { info, warn } from './logger.js';
import { getToken, getTokenStatus } from './tokenManager.js';
import { SyncService } from './syncService.js';
import { readMonitoredAccountIds, readMonitoredAccounts, monitoredAccountsFile } from './accountSettings.js';
import { readSamplingSettings, writeSamplingSettings, samplingSettingsFile } from './samplingSettings.js';
import { initDatabase, writeInsightBatch, writeMonitorRun } from './database.js';
import { latestOutputJson } from './storage.js';

function parseAccounts(value) {
  if (!value) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000);
}

function parseIdList(value) {
  return parseAccounts(value);
}

function logQueuedInsightResult(result) {
  info(`队列任务：${result.queue.stats.total} 个`);
  info(`成功/失败：${result.queue.stats.success}/${result.queue.stats.failed}`);
  info(`重试次数：${result.queue.stats.retries}`);
  info(`返回行数：${result.normalizedRows.length}`);
  info(`JSON 输出：${result.jsonPath}`);
  info(`CSV 输出：${result.csvPath}`);
  logDbResult(result.db);
}

function summarizeErrors(taskRecords = []) {
  const failed = taskRecords.filter((record) => record.status === 'failed');
  if (!failed.length) return '';
  return failed.slice(0, 3).map((record) => `${record.objectId}:${record.code}:${record.error}`).join(' | ');
}

async function resolveAccountIds(options = {}) {
  if (options.allAccounts) return [];

  const explicit = parseAccounts(options.accounts);
  if (explicit.length) return explicit;

  const monitored = await readMonitoredAccountIds();
  if (monitored.length) {
    info(`使用设置中的监控账户：${monitored.length}`);
  }
  return monitored;
}

function logDbResult(db) {
  if (!db) return;
  info(`SQLite 批次：${db.batchId}`);
  info(`SQLite 写入：${db.rowCount} 行`);
  info(`SQLite 文件：${db.databaseFile}`);
}

function inferLevel(rows) {
  if (rows.some((row) => row.ad_id)) return 'ads';
  if (rows.some((row) => row.adset_id)) return 'adsets';
  if (rows.some((row) => row.campaign_id)) return 'campaigns';
  return 'unknown';
}

async function readOutputRows(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  const rows = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('导入文件必须是非空 JSON 数组');
  }
  return rows;
}

function assertDateRange(options = {}) {
  if ((options.since && !options.until) || (!options.since && options.until)) {
    throw new Error('--since 和 --until 必须同时提供');
  }
}

function assertLevel(level, allowed = ['campaigns', 'adsets', 'ads']) {
  if (!allowed.includes(level)) {
    throw new Error(`层级只能是：${allowed.join('、')}`);
  }
}

function parseTargetIds(value) {
  return parseAccounts(value);
}

function samplingModeEnabled(mode, target) {
  return mode === 'all' || mode === target;
}

async function runConfiguredTargeted({ service, settings, options = {} }) {
  const targeted = settings.targeted;
  const explicitIds = parseTargetIds(options.ids);
  if (!targeted.enabled && !options.force && explicitIds.length === 0) {
    info('定向伪实时监控未启用，跳过');
    return null;
  }

  const level = options.level || targeted.level;
  assertLevel(level, ['ads', 'adsets']);
  const ids = explicitIds.length ? explicitIds : targeted.ids;
  if (!ids.length) {
    throw new Error('定向伪实时监控缺少广告或广告组 ID，请在设置页或 --ids 中配置');
  }
  assertDateRange(options);

  const result = await service.pullTargets({
    accounts: await resolveAccountIds(options),
    level,
    ids,
    datePreset: options.datePreset || targeted.datePreset,
    since: options.since,
    until: options.until,
    resultAction: options.resultAction || targeted.resultAction,
    hourly: options.daily ? false : targeted.hourly
  });

  info(`定向对象：${result.targets.length}`);
  info(`Insights 原始行：${result.insights.rawRows.length}`);
  info(`JSON 输出：${result.insights.jsonPath}`);
  info(`CSV 输出：${result.insights.csvPath}`);
  logDbResult(result.insights.db);
  return result;
}

async function runConfiguredActiveCampaigns({ service, settings, options = {} }) {
  const activeCampaigns = settings.activeCampaigns;
  if (!activeCampaigns.enabled && !options.force) {
    info('ACTIVE 广告系列全量监控未启用，跳过');
    return null;
  }
  assertDateRange(options);

  const result = await service.pullActiveCampaigns({
    accounts: await resolveAccountIds(options),
    datePreset: options.datePreset || activeCampaigns.datePreset,
    since: options.since,
    until: options.until,
    limit: parseInteger(options.limit) || activeCampaigns.limit,
    resourceLimit: parseInteger(options.resourceLimit),
    resultAction: options.resultAction || activeCampaigns.resultAction,
    hourly: options.daily ? false : activeCampaigns.hourly
  });

  info(`ACTIVE 广告系列总数：${result.activeCampaigns.length}`);
  info(`本次拉取广告系列：${result.selectedCampaigns.length}`);
  info(`Insights 原始行：${result.insights.rawRows.length}`);
  info(`JSON 输出：${result.insights.jsonPath}`);
  info(`CSV 输出：${result.insights.csvPath}`);
  logDbResult(result.insights.db);
  return result;
}

async function runSamplingCycle(options = {}) {
  assertCredentials();
  const mode = options.mode || 'all';
  if (!['all', 'targeted', 'active-campaigns'].includes(mode)) {
    throw new Error('--mode 只能是 all、targeted 或 active-campaigns');
  }

  const settings = await readSamplingSettings();
  const service = new SyncService();
  const results = {};

  if (samplingModeEnabled(mode, 'targeted')) {
    results.targeted = await runConfiguredTargeted({ service, settings, options });
  }
  if (samplingModeEnabled(mode, 'active-campaigns')) {
    results.activeCampaigns = await runConfiguredActiveCampaigns({ service, settings, options });
  }

  return results;
}

async function runAdMonitorCycle({ service, settings, options = {} }) {
  const monitor = settings.adMonitor;
  if (!monitor.enabled && !options.force) {
    info('List 2 广告监控未启用，跳过');
    return null;
  }

  const started = new Date();
  const explicitIds = parseIdList(options.ids);
  let ids = explicitIds.length ? explicitIds : monitor.adIds;
  let resources = [];
  let status = 'success';
  let result = null;
  let errorSummary = '';

  try {
    if (!ids.length) {
      throw new Error('List 2 缺少 ad_id，请先运行 monitor-bootstrap 或在设置页保存广告 ID');
    }

    const accountIds = await resolveAccountIds(options);
    if (accountIds.length) {
      resources = await service.syncResourceType({
        accountIds,
        getType: 'ads',
        activeOnly: true
      });
      const activeIds = new Set(resources.map((row) => String(row.id || row.ad_id)));
      ids = ids.filter((id) => activeIds.has(String(id)));
      if (!ids.length) {
        throw new Error('List 2 中没有仍为 ACTIVE 的广告');
      }
    }

    result = await service.pullAdInsightsTool({
      ids,
      accounts: accountIds,
      resources,
      datePreset: options.datePreset || monitor.datePreset || undefined,
      since: options.since,
      until: options.until,
      resultAction: options.resultAction || monitor.resultAction,
      hourly: options.daily ? false : monitor.hourly,
      concurrency: parseInteger(options.concurrency) || monitor.concurrency,
      qps: parseInteger(options.qps) || monitor.qps,
      timeoutMs: parseInteger(options.timeoutMs) || monitor.requestTimeoutMs,
      maxAttempts: parseInteger(options.maxAttempts) || monitor.maxAttempts
    });
    if (result.queue.stats.failed > 0) {
      status = 'partial';
      errorSummary = summarizeErrors(result.queue.taskRecords);
    }
  } catch (error) {
    status = 'failed';
    errorSummary = error.message;
    throw error;
  } finally {
    const completed = new Date();
    const nextRunAt = addMinutes(completed, monitor.intervalMinutes);
    const stats = result?.queue?.stats || {};
    writeMonitorRun({
      listType: 'ads',
      status,
      startedAt: started.toISOString(),
      completedAt: completed.toISOString(),
      nextRunAt: nextRunAt.toISOString(),
      requestedCount: ids.length,
      successCount: stats.success || 0,
      failedCount: stats.failed || (status === 'failed' ? ids.length : 0),
      retryCount: stats.retries || 0,
      durationMs: completed.getTime() - started.getTime(),
      errorSummary,
      metadata: {
        runId: result?.runId || '',
        rowCount: result?.normalizedRows?.length || 0,
        slices: result?.slices || [],
        source: 'monitor-run:ads'
      }
    });
  }

  return result;
}

async function runCampaignMonitorCycle({ service, settings, options = {} }) {
  const monitor = settings.campaignMonitor;
  if (!monitor.enabled && !options.force) {
    info('List 1 广告系列监控未启用，跳过');
    return null;
  }

  const started = new Date();
  const explicitIds = parseIdList(options.ids);
  let campaignIds = explicitIds.length ? explicitIds : monitor.campaignIds;
  let activeCampaigns = [];
  let status = 'success';
  let result = null;
  let errorSummary = '';

  try {
    const resolvedAccounts = monitor.accountIds.length ? monitor.accountIds : await resolveAccountIds(options);
    if (!resolvedAccounts.length && monitor.autoActiveCampaigns) {
      throw new Error('List 1 启用自动解析 ACTIVE campaigns 时必须配置账户');
    }

    if (resolvedAccounts.length) {
      activeCampaigns = await service.syncResourceType({
        accountIds: resolvedAccounts,
        getType: 'campaigns',
        activeOnly: true
      });
      const activeIds = new Set(activeCampaigns.map((row) => String(row.id || row.campaign_id)));
      const manualActiveIds = campaignIds.filter((id) => activeIds.has(String(id)));
      campaignIds = monitor.autoActiveCampaigns
        ? [...new Set([...activeIds, ...manualActiveIds])]
        : manualActiveIds;
    }

    if (!campaignIds.length) {
      throw new Error('List 1 没有可运行的 ACTIVE campaign');
    }

    result = await service.pullCampaignInsightsTool({
      ids: campaignIds,
      accounts: resolvedAccounts,
      resources: activeCampaigns,
      datePreset: options.datePreset || monitor.datePreset || undefined,
      since: options.since,
      until: options.until,
      resultAction: options.resultAction || monitor.resultAction,
      hourly: options.daily ? false : monitor.hourly,
      concurrency: parseInteger(options.concurrency) || 20,
      qps: parseInteger(options.qps) || 5,
      timeoutMs: parseInteger(options.timeoutMs) || 7000,
      maxAttempts: parseInteger(options.maxAttempts) || 8
    });
    if (result.queue.stats.failed > 0) {
      status = 'partial';
      errorSummary = summarizeErrors(result.queue.taskRecords);
    }
  } catch (error) {
    status = 'failed';
    errorSummary = error.message;
    throw error;
  } finally {
    const completed = new Date();
    const nextRunAt = addMinutes(completed, monitor.intervalMinutes);
    const stats = result?.queue?.stats || {};
    writeMonitorRun({
      listType: 'campaigns',
      status,
      startedAt: started.toISOString(),
      completedAt: completed.toISOString(),
      nextRunAt: nextRunAt.toISOString(),
      requestedCount: campaignIds.length,
      successCount: stats.success || 0,
      failedCount: stats.failed || (status === 'failed' ? campaignIds.length : 0),
      retryCount: stats.retries || 0,
      durationMs: completed.getTime() - started.getTime(),
      errorSummary,
      metadata: {
        runId: result?.runId || '',
        rowCount: result?.normalizedRows?.length || 0,
        slices: result?.slices || [],
        autoActiveCampaigns: monitor.autoActiveCampaigns,
        source: 'monitor-run:campaigns'
      }
    });
  }

  return result;
}

async function runMonitorCycle(options = {}) {
  assertCredentials();
  assertDateRange(options);
  const mode = options.mode || 'all';
  if (!['all', 'campaigns', 'ads'].includes(mode)) {
    throw new Error('--mode 只能是 all、campaigns 或 ads');
  }

  const settings = await readSamplingSettings();
  const service = new SyncService();
  const results = {};
  const errors = [];

  if (mode === 'all' || mode === 'campaigns') {
    try {
      results.campaigns = await runCampaignMonitorCycle({ service, settings, options });
    } catch (error) {
      errors.push(`campaigns: ${error.message}`);
      warn(`List 1 运行失败：${error.message}`);
    }
  }
  if (mode === 'all' || mode === 'ads') {
    try {
      results.ads = await runAdMonitorCycle({ service, settings, options });
    } catch (error) {
      errors.push(`ads: ${error.message}`);
      warn(`List 2 运行失败：${error.message}`);
    }
  }

  if (errors.length) {
    throw new Error(errors.join('；'));
  }

  return results;
}

async function bootstrapMonitorSettings(options = {}) {
  assertCredentials();
  const service = new SyncService();
  const accountIds = await resolveAccountIds(options);
  if (!accountIds.length) {
    throw new Error('初始化监控列表需要至少一个监控账户');
  }

  const resourceResult = await service.pullResourceList({
    accounts: accountIds,
    getType: 'all',
    activeOnly: true
  });
  const activeAds = resourceResult.resources.ads || [];
  const activeCampaigns = resourceResult.resources.campaigns || [];
  let selectedAds = activeAds.slice(0, 50).map((row) => String(row.id || row.ad_id));
  let selectedCampaigns = activeCampaigns.slice(0, 5).map((row) => String(row.id || row.campaign_id));

  if (selectedAds.length) {
    const adRanking = await service.pullAdInsightsTool({
      ids: selectedAds,
      accounts: accountIds,
      resources: activeAds,
      datePreset: options.datePreset || 'yesterday',
      hourly: false,
      concurrency: parseInteger(options.concurrency) || 20,
      qps: parseInteger(options.qps) || 5,
      timeoutMs: parseInteger(options.timeoutMs) || 7000,
      maxAttempts: parseInteger(options.maxAttempts) || 8
    });
    const spendByAd = new Map();
    for (const row of adRanking.normalizedRows) {
      const id = String(row.ad_id || '');
      spendByAd.set(id, (spendByAd.get(id) || 0) + Number(row.spend || 0));
    }
    selectedAds = selectedAds
      .sort((a, b) => (spendByAd.get(b) || 0) - (spendByAd.get(a) || 0))
      .slice(0, 50);
  }

  if (activeCampaigns.length) {
    const campaignRanking = await service.pullCampaignInsightsTool({
      ids: activeCampaigns.map((row) => String(row.id || row.campaign_id)).slice(0, 100),
      accounts: accountIds,
      resources: activeCampaigns,
      datePreset: options.datePreset || 'yesterday',
      hourly: false,
      concurrency: parseInteger(options.concurrency) || 20,
      qps: parseInteger(options.qps) || 5,
      timeoutMs: parseInteger(options.timeoutMs) || 7000,
      maxAttempts: parseInteger(options.maxAttempts) || 8
    });
    const spendByCampaign = new Map();
    for (const row of campaignRanking.normalizedRows) {
      const id = String(row.campaign_id || '');
      spendByCampaign.set(id, (spendByCampaign.get(id) || 0) + Number(row.spend || 0));
    }
    selectedCampaigns = activeCampaigns
      .map((row) => String(row.id || row.campaign_id))
      .sort((a, b) => (spendByCampaign.get(b) || 0) - (spendByCampaign.get(a) || 0))
      .slice(0, 5);
  }

  const settings = await readSamplingSettings();
  settings.campaignMonitor = {
    ...settings.campaignMonitor,
    enabled: true,
    intervalMinutes: 180,
    accountIds,
    autoActiveCampaigns: false,
    campaignIds: selectedCampaigns,
    datePreset: '',
    hourly: true
  };
  settings.adMonitor = {
    ...settings.adMonitor,
    enabled: true,
    intervalMinutes: 60,
    adIds: selectedAds,
    datePreset: '',
    hourly: true,
    concurrency: 20,
    qps: 5,
    requestTimeoutMs: 7000,
    maxAttempts: 8
  };
  settings.targeted = {
    ...settings.targeted,
    enabled: true,
    level: 'ads',
    ids: selectedAds,
    intervalMinutes: 15,
    datePreset: 'today',
    hourly: true
  };
  settings.activeCampaigns = {
    ...settings.activeCampaigns,
    enabled: true,
    intervalMinutes: 180,
    limit: selectedCampaigns.length,
    datePreset: 'today',
    hourly: true
  };

  const written = await writeSamplingSettings(settings);
  info(`List 2 已写入广告：${selectedAds.length}`);
  info(`List 1 已写入广告系列：${selectedCampaigns.length}`);
  info(`配置文件：${samplingSettingsFile}`);
  return {
    settings: written,
    selectedAds,
    selectedCampaigns,
    activeAds,
    activeCampaigns
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const program = new Command();

program
  .name('fb-ads')
  .description('YinoCloud Facebook ads data sync CLI')
  .version('0.1.0');

program
  .command('doctor')
  .description('检查 CLI 环境和配置')
  .action(async () => {
    console.log(`baseUrl: ${config.baseUrl}`);
    console.log(`clientId: ${config.clientId ? '已配置' : '未配置'}`);
    console.log(`clientSecret: ${config.clientSecret ? '已配置' : '未配置'}`);
    console.log(`concurrency: ${config.concurrency}`);
    console.log(`rawDir: ${config.rawDir}`);
    console.log(`outputDir: ${config.outputDir}`);
    console.log(`databaseFile: ${config.databaseFile}`);
    const monitored = await readMonitoredAccounts();
    console.log(`monitoredAccounts: ${monitored.length}`);
    console.log(`monitoredAccountsFile: ${monitoredAccountsFile}`);
    const samplingSettings = await readSamplingSettings();
    console.log(`samplingSettingsFile: ${samplingSettingsFile}`);
    console.log(`campaignMonitorIds: ${samplingSettings.campaignMonitor.campaignIds.length}`);
    console.log(`campaignMonitorAccounts: ${samplingSettings.campaignMonitor.accountIds.length}`);
    console.log(`campaignMonitorInterval: ${samplingSettings.campaignMonitor.intervalMinutes}m`);
    console.log(`adMonitorIds: ${samplingSettings.adMonitor.adIds.length}`);
    console.log(`adMonitorInterval: ${samplingSettings.adMonitor.intervalMinutes}m`);
    console.log(`targetedMonitorIds: ${samplingSettings.targeted.ids.length}`);
    console.log(`activeCampaignInterval: ${samplingSettings.activeCampaigns.intervalMinutes}m`);
    const token = await getTokenStatus();
    console.log(`tokenCache: ${token.cached ? token.expires_at_iso : '无缓存'}`);
  });

program
  .command('db-init')
  .description('初始化本地 SQLite 数据库')
  .action(() => {
    const databaseFile = initDatabase();
    info(`SQLite 已初始化：${databaseFile}`);
  });

program
  .command('db-import-output')
  .description('把最新或指定 output JSON 导入本地 SQLite 数据库')
  .option('--file <path>', '指定要导入的 facebook_ads_*.json；不传则导入最新非空 output JSON')
  .action(async (options) => {
    let filePath = '';
    let file = '';
    let rows = [];

    if (options.file) {
      filePath = path.resolve(process.cwd(), options.file);
      file = path.basename(filePath);
      rows = await readOutputRows(filePath);
    } else {
      const latest = await latestOutputJson();
      if (!latest) {
        throw new Error('没有找到可导入的非空 output JSON');
      }
      filePath = latest.filePath;
      file = latest.file;
      rows = latest.rows;
    }

    const db = writeInsightBatch({
      source: `import:${file}`,
      level: inferLevel(rows),
      rows,
      metadata: {
        filePath,
        importedAt: new Date().toISOString()
      }
    });

    info(`导入文件：${filePath}`);
    logDbResult(db);
  });

program
  .command('sampling-config')
  .description('查看或标准化取样监控配置')
  .option('--write', '把当前配置标准化写回 config/sampling-plans.json')
  .action(async (options) => {
    const settings = await readSamplingSettings();
    if (options.write) {
      await writeSamplingSettings(settings);
    }
    console.log(`samplingSettingsFile: ${samplingSettingsFile}`);
    console.log(JSON.stringify(settings, null, 2));
  });

program
  .command('token')
  .description('获取并缓存 tenant_access_token')
  .option('--force', '强制刷新 token')
  .action(async (options) => {
    assertCredentials();
    await getToken({ forceRefresh: Boolean(options.force) });
    const status = await getTokenStatus();
    info(`token 已缓存，有效期至 ${status.expires_at_iso}`);
  });

program
  .command('accounts')
  .description('拉取账户列表和账户详情')
  .option('--accounts <ids>', '只拉指定账户，多个用英文逗号分隔')
  .option('--all-accounts', '忽略监控账户设置，拉取全部账户')
  .action(async (options) => {
    assertCredentials();
    const service = new SyncService();
    const result = await service.syncAccounts({ accountIds: await resolveAccountIds(options) });
    info(`完成：${result.accounts.length} 个账户详情`);
  });

program
  .command('resource-list')
  .description('Tool 2：列出账户下 campaigns/adsets/ads 资源并写入 SQLite 维表')
  .option('--accounts <ids>', '只扫描指定账户，多个用英文逗号分隔')
  .option('--all-accounts', '忽略监控账户设置，扫描全部账户')
  .option('--type <type>', '资源类型：campaigns/adsets/ads/all', 'all')
  .option('--active', '只取 ACTIVE，并做本地二次过滤')
  .option('--limit <number>', '限制每个账户每类资源数量，验证时可用')
  .action(async (options) => {
    assertCredentials();
    if (!['campaigns', 'adsets', 'ads', 'all'].includes(options.type)) {
      throw new Error('--type 只能是 campaigns、adsets、ads 或 all');
    }
    const service = new SyncService();
    const result = await service.pullResourceList({
      accounts: await resolveAccountIds(options),
      getType: options.type,
      activeOnly: Boolean(options.active),
      limit: parseInteger(options.limit)
    });
    info(`账户：${result.accountIds.length}`);
    for (const [type, rows] of Object.entries(result.resources)) {
      info(`${type}：${rows.length}`);
    }
  });

program
  .command('ad-insights')
  .description('Tool 1：按 1-50 个 ad_id 拉广告级 hourly insights，队列重试并写入 SQLite/JSON/CSV')
  .requiredOption('--ids <ids>', 'ad_id 列表，多个用英文逗号/换行分隔')
  .option('--accounts <ids>', '用于补充 ACTIVE 维表和账户名，多个用英文逗号分隔')
  .option('--date-preset <preset>', 'Meta 预设日期；不传则按 SQLite 自动增量/补近 7 天')
  .option('--since <date>', '自定义开始日期 YYYY-MM-DD')
  .option('--until <date>', '自定义结束日期 YYYY-MM-DD')
  .option('--result-action <actionType>', '指定“成效”使用的 action_type')
  .option('--daily', '拉日级 Insights，不使用小时 breakdown')
  .option('--concurrency <number>', '队列并发，默认 20')
  .option('--qps <number>', '请求启动速率，默认 5/s')
  .option('--timeout-ms <number>', '单请求 Abort 超时，默认 7000')
  .option('--max-attempts <number>', '429/Abort 最大尝试次数，默认 8')
  .action(async (options) => {
    assertCredentials();
    assertDateRange(options);
    const service = new SyncService();
    const result = await service.pullAdInsightsTool({
      ids: parseIdList(options.ids),
      accounts: parseAccounts(options.accounts),
      datePreset: options.datePreset,
      since: options.since,
      until: options.until,
      resultAction: options.resultAction || '',
      hourly: !options.daily,
      concurrency: parseInteger(options.concurrency) || 20,
      qps: parseInteger(options.qps) || 5,
      timeoutMs: parseInteger(options.timeoutMs) || 7000,
      maxAttempts: parseInteger(options.maxAttempts) || 8
    });
    logQueuedInsightResult(result);
  });

program
  .command('campaign-insights')
  .description('Tool 3：按 campaign_id 列表拉 campaign 级聚合 hourly insights 并覆盖写入 SQLite')
  .requiredOption('--ids <ids>', 'campaign_id 列表，多个用英文逗号/换行分隔')
  .option('--accounts <ids>', '用于补充 ACTIVE 维表和账户名，多个用英文逗号分隔')
  .option('--date-preset <preset>', 'Meta 预设日期；不传则按 SQLite 自动增量/补近 7 天')
  .option('--since <date>', '自定义开始日期 YYYY-MM-DD')
  .option('--until <date>', '自定义结束日期 YYYY-MM-DD')
  .option('--result-action <actionType>', '指定“成效”使用的 action_type')
  .option('--daily', '拉日级 Insights，不使用小时 breakdown')
  .option('--concurrency <number>', '队列并发，默认 20')
  .option('--qps <number>', '请求启动速率，默认 5/s')
  .option('--timeout-ms <number>', '单请求 Abort 超时，默认 7000')
  .option('--max-attempts <number>', '429/Abort 最大尝试次数，默认 8')
  .action(async (options) => {
    assertCredentials();
    assertDateRange(options);
    const service = new SyncService();
    const result = await service.pullCampaignInsightsTool({
      ids: parseIdList(options.ids),
      accounts: parseAccounts(options.accounts),
      datePreset: options.datePreset,
      since: options.since,
      until: options.until,
      resultAction: options.resultAction || '',
      hourly: !options.daily,
      concurrency: parseInteger(options.concurrency) || 20,
      qps: parseInteger(options.qps) || 5,
      timeoutMs: parseInteger(options.timeoutMs) || 7000,
      maxAttempts: parseInteger(options.maxAttempts) || 8
    });
    logQueuedInsightResult(result);
  });

program
  .command('monitor-bootstrap')
  .description('初始化 List 1/List 2：从监控账户挑选 ACTIVE ads/campaigns 写入本地配置')
  .option('--accounts <ids>', '覆盖监控账户，多个用英文逗号分隔')
  .option('--all-accounts', '忽略监控账户设置，扫描全部账户')
  .option('--date-preset <preset>', '用于 spend 排名的日期，默认 yesterday')
  .option('--concurrency <number>', '队列并发，默认 20')
  .option('--qps <number>', '请求启动速率，默认 5/s')
  .option('--timeout-ms <number>', '单请求 Abort 超时，默认 7000')
  .option('--max-attempts <number>', '429/Abort 最大尝试次数，默认 8')
  .action(async (options) => {
    const result = await bootstrapMonitorSettings(options);
    info(`ACTIVE 广告候选：${result.activeAds.length}`);
    info(`ACTIVE 广告系列候选：${result.activeCampaigns.length}`);
  });

program
  .command('monitor-run')
  .description('按 List 1/List 2 监控配置执行一次')
  .option('--mode <mode>', 'all/campaigns/ads', 'all')
  .option('--accounts <ids>', '覆盖账户，多个用英文逗号分隔')
  .option('--all-accounts', '忽略监控账户设置，扫描全部账户')
  .option('--ids <ids>', '覆盖当前 mode 的对象 ID')
  .option('--date-preset <preset>', '覆盖日期预设；不传则自动增量/缺口补近 7 天')
  .option('--since <date>', '自定义开始日期 YYYY-MM-DD')
  .option('--until <date>', '自定义结束日期 YYYY-MM-DD')
  .option('--result-action <actionType>', '覆盖成效 action_type')
  .option('--daily', '拉日级 Insights，不使用小时 breakdown')
  .option('--concurrency <number>', '队列并发')
  .option('--qps <number>', '请求启动速率')
  .option('--timeout-ms <number>', '单请求 Abort 超时')
  .option('--max-attempts <number>', '最大尝试次数')
  .option('--force', '即使配置未启用也执行')
  .action(async (options) => {
    const result = await runMonitorCycle(options);
    if (result.campaigns) {
      info('List 1 广告系列监控完成');
      logQueuedInsightResult(result.campaigns);
    }
    if (result.ads) {
      info('List 2 广告监控完成');
      logQueuedInsightResult(result.ads);
    }
  });

program
  .command('monitor-loop')
  .description('按 List 1/List 2 的 180/60 分钟频率循环运行')
  .option('--mode <mode>', 'all/campaigns/ads', 'all')
  .option('--accounts <ids>', '覆盖账户，多个用英文逗号分隔')
  .option('--all-accounts', '忽略监控账户设置，扫描全部账户')
  .option('--max-cycles <number>', '最多执行多少个循环；0 表示一直运行', '0')
  .option('--force', '即使配置未启用也执行')
  .action(async (options) => {
    assertCredentials();
    const maxCycles = parseInteger(options.maxCycles);
    let cycles = 0;
    let nextCampaignAt = 0;
    let nextAdsAt = 0;

    while (!maxCycles || cycles < maxCycles) {
      const settings = await readSamplingSettings();
      const now = Date.now();
      let ran = false;

      if ((options.mode === 'all' || options.mode === 'campaigns') && now >= nextCampaignAt) {
        await runMonitorCycle({ ...options, mode: 'campaigns' });
        nextCampaignAt = Date.now() + settings.campaignMonitor.intervalMinutes * 60_000;
        ran = true;
      }

      if ((options.mode === 'all' || options.mode === 'ads') && now >= nextAdsAt) {
        await runMonitorCycle({ ...options, mode: 'ads' });
        nextAdsAt = Date.now() + settings.adMonitor.intervalMinutes * 60_000;
        ran = true;
      }

      if (ran) {
        cycles += 1;
      }
      if (maxCycles && cycles >= maxCycles) {
        break;
      }

      const waitUntil = Math.min(
        (options.mode === 'all' || options.mode === 'campaigns') ? nextCampaignAt : Number.POSITIVE_INFINITY,
        (options.mode === 'all' || options.mode === 'ads') ? nextAdsAt : Number.POSITIVE_INFINITY
      );
      const waitMs = Math.max(5_000, waitUntil - Date.now());
      info(`等待 ${Math.round(waitMs / 1000)} 秒后继续`);
      await sleep(waitMs);
    }
  });

program
  .command('pull')
  .description('拉取账户、广告三层级资源和 Insights，并导出 CSV')
  .option('--accounts <ids>', '只拉指定账户，多个用英文逗号分隔')
  .option('--all-accounts', '忽略监控账户设置，拉取全部账户')
  .option('--date-preset <preset>', 'Meta 预设日期，如 today/yesterday/last_7d', 'yesterday')
  .option('--since <date>', '自定义开始日期 YYYY-MM-DD')
  .option('--until <date>', '自定义结束日期 YYYY-MM-DD')
  .option('--level <level>', 'Insights 层级：campaigns/adsets/ads', 'ads')
  .option('--limit <number>', '限制 Insights 对象数量，联调时建议 10')
  .option('--resource-limit <number>', '限制每个账户每个资源类型的拉取数量')
  .option('--result-action <actionType>', '指定“成效”使用的 action_type，如 omni_purchase')
  .action(async (options) => {
    assertCredentials();
    const level = options.level;
    if (!['campaigns', 'adsets', 'ads'].includes(level)) {
      throw new Error('--level 只能是 campaigns、adsets 或 ads');
    }
    if ((options.since && !options.until) || (!options.since && options.until)) {
      throw new Error('--since 和 --until 必须同时提供');
    }

    const service = new SyncService();
    const result = await service.pull({
      accounts: await resolveAccountIds(options),
      datePreset: options.datePreset,
      since: options.since,
      until: options.until,
      level,
      limit: parseInteger(options.limit),
      resourceLimit: parseInteger(options.resourceLimit),
      resultAction: options.resultAction || ''
    });

    info(`账户：${result.accounts.length}`);
    info(`广告系列：${result.resources.campaigns.length}`);
    info(`广告组：${result.resources.adsets.length}`);
    info(`广告：${result.resources.ads.length}`);
    info(`Insights 原始行：${result.insights.rawRows.length}`);
    info(`JSON 输出：${result.insights.jsonPath}`);
    info(`CSV 输出：${result.insights.csvPath}`);
    logDbResult(result.insights.db);
  });

program
  .command('active-ads')
  .description('只扫描并拉取前 N 个 ACTIVE 广告的 Insights')
  .option('--accounts <ids>', '只扫描指定账户，多个用英文逗号分隔')
  .option('--all-accounts', '忽略监控账户设置，扫描全部账户')
  .option('--date-preset <preset>', 'Meta 预设日期，如 today/yesterday/last_7d', 'yesterday')
  .option('--since <date>', '自定义开始日期 YYYY-MM-DD')
  .option('--until <date>', '自定义结束日期 YYYY-MM-DD')
  .option('--limit <number>', 'ACTIVE 广告数量', '5')
  .option('--result-action <actionType>', '指定“成效”使用的 action_type，如 omni_purchase')
  .action(async (options) => {
    assertCredentials();
    if ((options.since && !options.until) || (!options.since && options.until)) {
      throw new Error('--since 和 --until 必须同时提供');
    }

    const service = new SyncService();
    const result = await service.pullActiveAds({
      accounts: await resolveAccountIds(options),
      datePreset: options.datePreset,
      since: options.since,
      until: options.until,
      limit: parseInteger(options.limit) || 5,
      resultAction: options.resultAction || ''
    });

    info(`账户：${result.accounts.length}`);
    info(`ACTIVE 广告：${result.activeAds.length}`);
    info(`Insights 原始行：${result.insights.rawRows.length}`);
    info(`JSON 输出：${result.insights.jsonPath}`);
    info(`CSV 输出：${result.insights.csvPath}`);
    logDbResult(result.insights.db);
  });

program
  .command('active-ads-hourly')
  .description('只扫描并拉取前 N 个 ACTIVE 广告的小时级 Insights')
  .option('--accounts <ids>', '只扫描指定账户，多个用英文逗号分隔')
  .option('--all-accounts', '忽略监控账户设置，扫描全部账户')
  .option('--date-preset <preset>', 'Meta 预设日期，如 today/yesterday/last_7d', 'yesterday')
  .option('--since <date>', '自定义开始日期 YYYY-MM-DD')
  .option('--until <date>', '自定义结束日期 YYYY-MM-DD')
  .option('--limit <number>', 'ACTIVE 广告数量', '30')
  .option('--result-action <actionType>', '指定“成效”使用的 action_type，如 omni_purchase')
  .action(async (options) => {
    assertCredentials();
    if ((options.since && !options.until) || (!options.since && options.until)) {
      throw new Error('--since 和 --until 必须同时提供');
    }

    const service = new SyncService();
    const result = await service.pullActiveAds({
      accounts: await resolveAccountIds(options),
      datePreset: options.datePreset,
      since: options.since,
      until: options.until,
      limit: parseInteger(options.limit) || 30,
      resultAction: options.resultAction || '',
      hourly: true
    });

    info(`账户：${result.accounts.length}`);
    info(`ACTIVE 广告：${result.activeAds.length}`);
    info(`小时级 Insights 原始行：${result.insights.rawRows.length}`);
    info(`JSON 输出：${result.insights.jsonPath}`);
    info(`CSV 输出：${result.insights.csvPath}`);
    logDbResult(result.insights.db);
  });

program
  .command('sampling-evaluate')
  .description('评估定向伪实时监控和 ACTIVE 广告系列全量监控的数据量与可行性')
  .option('--accounts <ids>', '只扫描指定账户，多个用英文逗号分隔')
  .option('--all-accounts', '忽略监控账户设置，扫描全部账户')
  .option('--resource-limit <number>', '限制每个账户每个资源类型的拉取数量；0 为不限制')
  .option('--probe-level <level>', '抽样验证层级：campaigns/adsets/ads', 'ads')
  .option('--probe-limit <number>', '抽样验证 ACTIVE 对象数量；0 为只统计资源量', '0')
  .option('--date-preset <preset>', '抽样验证 Insights 日期，如 yesterday/last_7d', 'yesterday')
  .option('--since <date>', '自定义开始日期 YYYY-MM-DD')
  .option('--until <date>', '自定义结束日期 YYYY-MM-DD')
  .option('--result-action <actionType>', '指定“成效”使用的 action_type')
  .action(async (options) => {
    assertCredentials();
    assertDateRange(options);
    assertLevel(options.probeLevel, ['campaigns', 'adsets', 'ads']);

    const service = new SyncService();
    const report = await service.evaluateMonitoringPlans({
      accounts: await resolveAccountIds(options),
      resourceLimit: parseInteger(options.resourceLimit),
      probeLevel: options.probeLevel,
      probeLimit: parseInteger(options.probeLimit),
      datePreset: options.datePreset,
      since: options.since,
      until: options.until,
      resultAction: options.resultAction || ''
    });

    info(`账户：${report.accounts.count}`);
    info(`campaigns：${report.counts.campaigns.total}，ACTIVE ${report.counts.campaigns.active}`);
    info(`adsets：${report.counts.adsets.total}，ACTIVE ${report.counts.adsets.active}`);
    info(`ads：${report.counts.ads.total}，ACTIVE ${report.counts.ads.active}`);
    if (report.probe.recommendedTarget) {
      info(`推荐验证对象：${report.probe.recommendedTarget.id}，impressions=${report.probe.recommendedTarget.impressions}`);
    }
    info(`评估报告：${report.jsonPath}`);
  });

program
  .command('targeted-monitor')
  .description('拉取配置中或命令行指定的广告/广告组伪实时监控数据')
  .option('--accounts <ids>', '只补充指定账户详情，多个用英文逗号分隔')
  .option('--all-accounts', '忽略监控账户设置；定向对象仍按 --ids 或配置执行')
  .option('--level <level>', '监控层级：ads/adsets')
  .option('--ids <ids>', '广告或广告组 ID，多个用英文逗号分隔')
  .option('--date-preset <preset>', 'Meta 预设日期，如 today/yesterday/last_7d')
  .option('--since <date>', '自定义开始日期 YYYY-MM-DD')
  .option('--until <date>', '自定义结束日期 YYYY-MM-DD')
  .option('--result-action <actionType>', '指定“成效”使用的 action_type')
  .option('--daily', '拉日级 Insights，不使用小时 breakdown')
  .option('--force', '即使配置未启用也执行')
  .action(async (options) => {
    assertCredentials();
    const settings = await readSamplingSettings();
    const service = new SyncService();
    await runConfiguredTargeted({ service, settings, options });
  });

program
  .command('active-campaigns')
  .description('扫描 ACTIVE 广告系列并拉取全量 campaign 层级监控数据')
  .option('--accounts <ids>', '只扫描指定账户，多个用英文逗号分隔')
  .option('--all-accounts', '忽略监控账户设置，扫描全部账户')
  .option('--date-preset <preset>', 'Meta 预设日期，如 today/yesterday/last_7d')
  .option('--since <date>', '自定义开始日期 YYYY-MM-DD')
  .option('--until <date>', '自定义结束日期 YYYY-MM-DD')
  .option('--limit <number>', '限制本次拉取的 ACTIVE campaign 数量，验证时可用')
  .option('--resource-limit <number>', '限制每个账户扫描的 campaign 数量，验证时可用')
  .option('--result-action <actionType>', '指定“成效”使用的 action_type')
  .option('--daily', '拉日级 Insights，不使用小时 breakdown')
  .option('--force', '即使配置未启用也执行')
  .action(async (options) => {
    assertCredentials();
    const settings = await readSamplingSettings();
    const service = new SyncService();
    await runConfiguredActiveCampaigns({ service, settings, options });
  });

program
  .command('sampling-run')
  .description('按配置执行一次取样监控')
  .option('--mode <mode>', 'all/targeted/active-campaigns', 'all')
  .option('--accounts <ids>', '覆盖监控账户，多个用英文逗号分隔')
  .option('--all-accounts', '忽略监控账户设置，扫描全部账户')
  .option('--level <level>', '覆盖定向监控层级：ads/adsets')
  .option('--ids <ids>', '覆盖定向监控 ID，多个用英文逗号分隔')
  .option('--date-preset <preset>', '覆盖日期预设')
  .option('--since <date>', '自定义开始日期 YYYY-MM-DD')
  .option('--until <date>', '自定义结束日期 YYYY-MM-DD')
  .option('--limit <number>', '覆盖 ACTIVE campaign 拉取数量')
  .option('--resource-limit <number>', '限制每个账户扫描的资源数量，验证时可用')
  .option('--result-action <actionType>', '覆盖成效 action_type')
  .option('--daily', '拉日级 Insights，不使用小时 breakdown')
  .option('--force', '即使配置未启用也执行')
  .action(async (options) => {
    await runSamplingCycle(options);
  });

program
  .command('sampling-loop')
  .description('按配置频率循环执行取样监控')
  .option('--mode <mode>', 'all/targeted/active-campaigns', 'all')
  .option('--accounts <ids>', '覆盖监控账户，多个用英文逗号分隔')
  .option('--all-accounts', '忽略监控账户设置，扫描全部账户')
  .option('--max-cycles <number>', '最多执行多少个循环；0 表示一直运行', '0')
  .option('--force', '即使配置未启用也执行')
  .action(async (options) => {
    assertCredentials();
    const maxCycles = parseInteger(options.maxCycles);
    let cycles = 0;
    let nextTargetedAt = 0;
    let nextActiveAt = 0;

    while (!maxCycles || cycles < maxCycles) {
      const settings = await readSamplingSettings();
      const service = new SyncService();
      const now = Date.now();
      let ran = false;

      if (samplingModeEnabled(options.mode, 'targeted') && now >= nextTargetedAt) {
        await runConfiguredTargeted({ service, settings, options });
        nextTargetedAt = Date.now() + settings.targeted.intervalMinutes * 60_000;
        ran = true;
      }

      if (samplingModeEnabled(options.mode, 'active-campaigns') && now >= nextActiveAt) {
        await runConfiguredActiveCampaigns({ service, settings, options });
        nextActiveAt = Date.now() + settings.activeCampaigns.intervalMinutes * 60_000;
        ran = true;
      }

      if (ran) {
        cycles += 1;
      }
      if (maxCycles && cycles >= maxCycles) {
        break;
      }

      const waitUntil = Math.min(
        samplingModeEnabled(options.mode, 'targeted') ? nextTargetedAt : Number.POSITIVE_INFINITY,
        samplingModeEnabled(options.mode, 'active-campaigns') ? nextActiveAt : Number.POSITIVE_INFINITY
      );
      const waitMs = Math.max(5_000, waitUntil - Date.now());
      info(`等待 ${Math.round(waitMs / 1000)} 秒后继续`);
      await sleep(waitMs);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(`[error] ${err.message}`);
  process.exitCode = 1;
});
