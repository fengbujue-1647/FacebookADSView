import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function intEnv(name, fallback) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  rootDir,
  baseUrl: process.env.YINO_BASE_URL || 'https://yl-open-api-lfnsrvbmgm.ap-northeast-1.fcapp.run',
  clientId: process.env.YINO_CLIENT_ID || '',
  clientSecret: process.env.YINO_CLIENT_SECRET || '',
  concurrency: intEnv('YINO_CONCURRENCY', 3),
  requestTimeoutMs: intEnv('YINO_REQUEST_TIMEOUT_MS', 30_000),
  tokenCacheFile: path.join(rootDir, '.cache', 'yino-token.json'),
  databaseFile: path.join(rootDir, 'data', 'fb-ads.sqlite'),
  rawDir: path.join(rootDir, 'data', 'raw'),
  outputDir: path.join(rootDir, 'data', 'output')
};

export function assertCredentials() {
  const missing = [];
  if (!config.clientId) missing.push('YINO_CLIENT_ID');
  if (!config.clientSecret) missing.push('YINO_CLIENT_SECRET');
  if (missing.length) {
    throw new Error(`缺少环境变量：${missing.join(', ')}。请复制 .env.example 为 .env 并填入 YinoCloud 应用 ID/API Key。`);
  }
}
