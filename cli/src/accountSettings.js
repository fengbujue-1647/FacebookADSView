import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

export const monitoredAccountsFile = path.join(config.rootDir, 'config', 'monitored-accounts.json');

export function normalizeAccounts(accounts = []) {
  const seen = new Set();
  const normalized = [];

  for (const account of accounts) {
    const rawId = typeof account === 'string' ? account : account?.id;
    const id = String(rawId || '').trim();
    if (!/^\d{3,32}$/.test(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalized.push({
      id,
      name: String(account?.name || '').trim()
    });
  }

  return normalized;
}

export async function readMonitoredAccounts() {
  try {
    const text = await fs.readFile(monitoredAccountsFile, 'utf8');
    const payload = JSON.parse(text);
    return normalizeAccounts(payload.accounts || []);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function readMonitoredAccountIds() {
  const accounts = await readMonitoredAccounts();
  return accounts.map((account) => account.id);
}

export async function writeMonitoredAccounts(accounts) {
  const normalized = normalizeAccounts(accounts);
  await fs.mkdir(path.dirname(monitoredAccountsFile), { recursive: true });
  await fs.writeFile(monitoredAccountsFile, `${JSON.stringify({
    accounts: normalized,
    updated_at: new Date().toISOString()
  }, null, 2)}\n`, 'utf8');
  return normalized;
}
