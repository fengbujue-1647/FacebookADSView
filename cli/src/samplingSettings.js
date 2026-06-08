import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

export const samplingSettingsFile = path.join(config.rootDir, 'config', 'sampling-plans.json');

const defaultSamplingSettings = {
  campaignMonitor: {
    enabled: true,
    intervalMinutes: 180,
    accountIds: [],
    autoActiveCampaigns: true,
    campaignIds: [],
    datePreset: '',
    resultAction: '',
    hourly: true
  },
  adMonitor: {
    enabled: true,
    intervalMinutes: 60,
    adIds: [],
    datePreset: '',
    resultAction: '',
    hourly: true,
    concurrency: 20,
    qps: 5,
    requestTimeoutMs: 7000,
    maxAttempts: 8
  },
  targeted: {
    enabled: false,
    level: 'ads',
    ids: [],
    intervalMinutes: 15,
    datePreset: '',
    resultAction: '',
    hourly: true
  },
  activeCampaigns: {
    enabled: true,
    intervalMinutes: 60,
    datePreset: '',
    resultAction: '',
    limit: 0,
    hourly: true
  }
};

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeIds(ids = []) {
  const items = Array.isArray(ids)
    ? ids
    : String(ids || '').split(/[\s,;，；]+/);
  const seen = new Set();
  const normalized = [];

  for (const item of items) {
    const id = String(item || '').trim();
    if (!/^\d{3,32}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }

  return normalized;
}

function normalizeStoredDatePreset(value) {
  const text = String(value ?? '').trim();
  return text === 'today' ? '' : text;
}

export function normalizeSamplingSettings(input = {}) {
  const targetedInput = input.targeted || {};
  const activeInput = input.activeCampaigns || {};
  const campaignInput = input.campaignMonitor || {};
  const adInput = input.adMonitor || {};
  const level = ['ads', 'adsets'].includes(targetedInput.level) ? targetedInput.level : 'ads';
  const legacyTargetedIds = level === 'ads' ? normalizeIds(targetedInput.ids) : [];
  const legacyActiveInterval = clampInteger(activeInput.intervalMinutes, 60, 30, 180);
  const campaignMonitor = {
    enabled: campaignInput.enabled ?? activeInput.enabled ?? defaultSamplingSettings.campaignMonitor.enabled,
    intervalMinutes: clampInteger(campaignInput.intervalMinutes ?? legacyActiveInterval, 180, 60, 360),
    accountIds: normalizeIds(campaignInput.accountIds),
    autoActiveCampaigns: campaignInput.autoActiveCampaigns !== false,
    campaignIds: normalizeIds(campaignInput.campaignIds),
    datePreset: String(campaignInput.datePreset ?? '').trim(),
    resultAction: String(campaignInput.resultAction || activeInput.resultAction || '').trim(),
    hourly: campaignInput.hourly !== false
  };
  const adMonitor = {
    enabled: adInput.enabled ?? targetedInput.enabled ?? defaultSamplingSettings.adMonitor.enabled,
    intervalMinutes: clampInteger(adInput.intervalMinutes ?? targetedInput.intervalMinutes, 60, 30, 180),
    adIds: normalizeIds(adInput.adIds || legacyTargetedIds),
    datePreset: String(adInput.datePreset ?? '').trim(),
    resultAction: String(adInput.resultAction || targetedInput.resultAction || '').trim(),
    hourly: adInput.hourly !== false,
    concurrency: clampInteger(adInput.concurrency, 20, 1, 20),
    qps: clampInteger(adInput.qps, 5, 1, 20),
    requestTimeoutMs: clampInteger(adInput.requestTimeoutMs, 7000, 1000, 60_000),
    maxAttempts: clampInteger(adInput.maxAttempts, 8, 1, 20)
  };

  return {
    campaignMonitor,
    adMonitor,
    targeted: {
      enabled: targetedInput.enabled === true,
      level,
      ids: normalizeIds(targetedInput.ids),
      intervalMinutes: clampInteger(targetedInput.intervalMinutes, 15, 15, 30),
      datePreset: normalizeStoredDatePreset(targetedInput.datePreset),
      resultAction: String(targetedInput.resultAction || '').trim(),
      hourly: targetedInput.hourly !== false
    },
    activeCampaigns: {
      enabled: activeInput.enabled !== false,
      intervalMinutes: clampInteger(activeInput.intervalMinutes, 60, 30, 180),
      datePreset: normalizeStoredDatePreset(activeInput.datePreset),
      resultAction: String(activeInput.resultAction || '').trim(),
      limit: Math.max(0, Number.parseInt(activeInput.limit, 10) || 0),
      hourly: activeInput.hourly !== false
    }
  };
}

export async function readSamplingSettings() {
  try {
    const text = await fs.readFile(samplingSettingsFile, 'utf8');
    return normalizeSamplingSettings(JSON.parse(text.replace(/^\uFEFF/, '')));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return normalizeSamplingSettings(defaultSamplingSettings);
    }
    throw error;
  }
}

export async function writeSamplingSettings(settings) {
  const normalized = normalizeSamplingSettings(settings);
  await fs.mkdir(path.dirname(samplingSettingsFile), { recursive: true });
  await fs.writeFile(samplingSettingsFile, `${JSON.stringify({
    ...normalized,
    updated_at: new Date().toISOString()
  }, null, 2)}\n`, 'utf8');
  return normalized;
}
