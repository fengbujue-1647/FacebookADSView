#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { config, assertCredentials } from './config.js';
import { info } from './logger.js';
import { getToken, getTokenStatus } from './tokenManager.js';
import { SyncService } from './syncService.js';
import { readMonitoredAccountIds, readMonitoredAccounts, monitoredAccountsFile } from './accountSettings.js';
import { readSamplingSettings, writeSamplingSettings, samplingSettingsFile } from './samplingSettings.js';
import { initDatabase, writeInsightBatch } from './database.js';
import { latestOutputJson } from './storage.js';

function parseAccounts(value) {
  if (!value) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
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
