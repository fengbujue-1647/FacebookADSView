import fs from 'node:fs/promises';
import path from 'node:path';
import { config, assertCredentials } from './config.js';
import { ensureDir, writeJson } from './storage.js';

const REFRESH_WINDOW_MS = 30 * 60 * 1000;

async function readCache() {
  try {
    const text = await fs.readFile(config.tokenCacheFile, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isUsable(cache) {
  if (!cache?.tenant_access_token || !cache?.expires_at) return false;
  return Number(cache.expires_at) - Date.now() > REFRESH_WINDOW_MS;
}

async function requestToken() {
  assertCredentials();

  const form = new FormData();
  form.append('client_id', config.clientId);
  form.append('client_secret', config.clientSecret);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}/api/v1/auth/tenant_access_token/internal`, {
      method: 'POST',
      body: form,
      signal: controller.signal
    });

    const payload = await response.json();
    if (!response.ok || payload.code !== 200) {
      throw new Error(`获取 token 失败：HTTP ${response.status}, code=${payload.code}, msg=${payload.msg}`);
    }

    const tokenData = payload.data;
    const cache = {
      tenant_access_token: tokenData.tenant_access_token,
      token_type: tokenData.token_type,
      scope: tokenData.scope,
      expires_in: tokenData.expires_in,
      expires_at: Date.now() + Number(tokenData.expires_in || 0) * 1000,
      fetched_at: new Date().toISOString()
    };

    await ensureDir(path.dirname(config.tokenCacheFile));
    await writeJson(config.tokenCacheFile, cache);
    return cache;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getToken({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cache = await readCache();
    if (isUsable(cache)) return cache.tenant_access_token;
  }

  const fresh = await requestToken();
  return fresh.tenant_access_token;
}

export async function getTokenStatus() {
  const cache = await readCache();
  if (!cache) return { cached: false };
  return {
    cached: true,
    expires_at: cache.expires_at,
    expires_at_iso: new Date(cache.expires_at).toISOString(),
    usable: isUsable(cache)
  };
}
