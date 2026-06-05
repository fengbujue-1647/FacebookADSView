import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

export const samplingSettingsFile = path.join(config.rootDir, 'config', 'sampling-plans.json');

const defaultSamplingSettings = {
  targeted: {
    enabled: false,
    level: 'ads',
    ids: [],
    intervalMinutes: 15,
    datePreset: 'today',
    resultAction: '',
    hourly: true
  },
  activeCampaigns: {
    enabled: true,
    intervalMinutes: 60,
    datePreset: 'today',
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

export function normalizeSamplingSettings(input = {}) {
  const targetedInput = input.targeted || {};
  const activeInput = input.activeCampaigns || {};
  const level = ['ads', 'adsets'].includes(targetedInput.level) ? targetedInput.level : 'ads';

  return {
    targeted: {
      enabled: targetedInput.enabled === true,
      level,
      ids: normalizeIds(targetedInput.ids),
      intervalMinutes: clampInteger(targetedInput.intervalMinutes, 15, 15, 30),
      datePreset: String(targetedInput.datePreset || 'today').trim() || 'today',
      resultAction: String(targetedInput.resultAction || '').trim(),
      hourly: targetedInput.hourly !== false
    },
    activeCampaigns: {
      enabled: activeInput.enabled !== false,
      intervalMinutes: clampInteger(activeInput.intervalMinutes, 60, 30, 60),
      datePreset: String(activeInput.datePreset || 'today').trim() || 'today',
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
