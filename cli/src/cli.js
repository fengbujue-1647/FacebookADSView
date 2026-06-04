#!/usr/bin/env node
import { Command } from 'commander';
import { config, assertCredentials } from './config.js';
import { info } from './logger.js';
import { getToken, getTokenStatus } from './tokenManager.js';
import { SyncService } from './syncService.js';

function parseAccounts(value) {
  if (!value) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
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
    const token = await getTokenStatus();
    console.log(`tokenCache: ${token.cached ? token.expires_at_iso : '无缓存'}`);
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
  .action(async (options) => {
    assertCredentials();
    const service = new SyncService();
    const result = await service.syncAccounts({ accountIds: parseAccounts(options.accounts) });
    info(`完成：${result.accounts.length} 个账户详情`);
  });

program
  .command('pull')
  .description('拉取账户、广告三层级资源和 Insights，并导出 CSV')
  .option('--accounts <ids>', '只拉指定账户，多个用英文逗号分隔')
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
      accounts: parseAccounts(options.accounts),
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
  });

program
  .command('active-ads')
  .description('只扫描并拉取前 N 个 ACTIVE 广告的 Insights')
  .option('--accounts <ids>', '只扫描指定账户，多个用英文逗号分隔')
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
      accounts: parseAccounts(options.accounts),
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
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(`[error] ${err.message}`);
  process.exitCode = 1;
});
