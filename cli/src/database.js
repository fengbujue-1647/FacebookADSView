import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

export const insightDbColumns = [
  'date_start',
  'date_stop',
  'hourly_range',
  'hour_start',
  'account_id',
  'account_name',
  'campaign_id',
  'campaign_name',
  'adset_id',
  'adset_name',
  'ad_id',
  'ad_name',
  'effective_status',
  'spend',
  'cpc',
  'result_count',
  'cost_per_result',
  'add_to_cart_count',
  'initiate_checkout_count',
  'purchase_count',
  'purchase_value',
  'roas',
  'ctr',
  'clicks',
  'reach',
  'impressions',
  'frequency',
  'result_type',
  'batch_id',
  'updated_at'
];

const numericColumns = new Set([
  'spend',
  'cpc',
  'result_count',
  'cost_per_result',
  'add_to_cart_count',
  'initiate_checkout_count',
  'purchase_count',
  'purchase_value',
  'roas',
  'ctr',
  'clicks',
  'reach',
  'impressions',
  'frequency'
]);

const uniqueColumns = [
  'account_id',
  'campaign_id',
  'adset_id',
  'ad_id',
  'date_start',
  'hour_start',
  'hourly_range'
];

function ensureDatabaseDir(databaseFile = config.databaseFile) {
  fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
}

function openDatabase(databaseFile = config.databaseFile) {
  ensureDatabaseDir(databaseFile);
  const db = new DatabaseSync(databaseFile);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
  `);
  return db;
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_batches (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      level TEXT NOT NULL,
      account_ids TEXT NOT NULL DEFAULT '[]',
      row_count INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS insight_rows (
      date_start TEXT NOT NULL DEFAULT '',
      date_stop TEXT NOT NULL DEFAULT '',
      hourly_range TEXT NOT NULL DEFAULT '',
      hour_start TEXT NOT NULL DEFAULT '',
      account_id TEXT NOT NULL DEFAULT '',
      account_name TEXT NOT NULL DEFAULT '',
      campaign_id TEXT NOT NULL DEFAULT '',
      campaign_name TEXT NOT NULL DEFAULT '',
      adset_id TEXT NOT NULL DEFAULT '',
      adset_name TEXT NOT NULL DEFAULT '',
      ad_id TEXT NOT NULL DEFAULT '',
      ad_name TEXT NOT NULL DEFAULT '',
      effective_status TEXT NOT NULL DEFAULT '',
      spend REAL NOT NULL DEFAULT 0,
      cpc REAL NOT NULL DEFAULT 0,
      result_count REAL NOT NULL DEFAULT 0,
      cost_per_result REAL NOT NULL DEFAULT 0,
      add_to_cart_count REAL NOT NULL DEFAULT 0,
      initiate_checkout_count REAL NOT NULL DEFAULT 0,
      purchase_count REAL NOT NULL DEFAULT 0,
      purchase_value REAL NOT NULL DEFAULT 0,
      roas REAL NOT NULL DEFAULT 0,
      ctr REAL NOT NULL DEFAULT 0,
      clicks REAL NOT NULL DEFAULT 0,
      reach REAL NOT NULL DEFAULT 0,
      impressions REAL NOT NULL DEFAULT 0,
      frequency REAL NOT NULL DEFAULT 0,
      result_type TEXT NOT NULL DEFAULT '',
      batch_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (${uniqueColumns.join(', ')}),
      FOREIGN KEY (batch_id) REFERENCES sync_batches(id)
    );

    CREATE INDEX IF NOT EXISTS idx_sync_batches_completed_at
      ON sync_batches(completed_at DESC);

    CREATE INDEX IF NOT EXISTS idx_insight_rows_batch
      ON insight_rows(batch_id);

    CREATE INDEX IF NOT EXISTS idx_insight_rows_campaign_time
      ON insight_rows(campaign_id, hour_start, date_start);
  `);
}

function withDatabase(callback, databaseFile = config.databaseFile) {
  const db = openDatabase(databaseFile);
  try {
    createSchema(db);
    return callback(db);
  } finally {
    db.close();
  }
}

function runInTransaction(db, callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function toText(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function valueForColumn(row, column, batchId, updatedAt) {
  if (column === 'batch_id') return batchId;
  if (column === 'updated_at') return updatedAt;
  if (numericColumns.has(column)) return toNumber(row[column]);
  return toText(row[column]);
}

function normalizeAccountIds(accountIds, rows) {
  const ids = accountIds?.length
    ? accountIds.map(String)
    : rows.map((row) => row.account_id).filter(Boolean).map(String);
  return [...new Set(ids)];
}

export function initDatabase(databaseFile = config.databaseFile) {
  return withDatabase(() => databaseFile, databaseFile);
}

export function writeInsightBatch({
  source = 'manual',
  level = 'ads',
  accountIds = [],
  rows = [],
  metadata = {},
  databaseFile = config.databaseFile
} = {}) {
  const startedAt = new Date().toISOString();
  const completedAt = startedAt;
  const batchId = randomUUID();
  const normalizedAccountIds = normalizeAccountIds(accountIds, rows);

  return withDatabase((db) => runInTransaction(db, () => {
    db.prepare(`
      INSERT INTO sync_batches (
        id,
        source,
        level,
        account_ids,
        row_count,
        started_at,
        completed_at,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      batchId,
      source,
      level,
      JSON.stringify(normalizedAccountIds),
      rows.length,
      startedAt,
      completedAt,
      JSON.stringify(metadata || {})
    );

    const placeholders = insightDbColumns.map(() => '?').join(', ');
    const updateColumns = insightDbColumns
      .filter((column) => !uniqueColumns.includes(column))
      .map((column) => `${column} = excluded.${column}`)
      .join(', ');
    const insertRow = db.prepare(`
      INSERT INTO insight_rows (${insightDbColumns.join(', ')})
      VALUES (${placeholders})
      ON CONFLICT (${uniqueColumns.join(', ')})
      DO UPDATE SET ${updateColumns}
    `);

    for (const row of rows) {
      insertRow.run(...insightDbColumns.map((column) => valueForColumn(row, column, batchId, completedAt)));
    }

    return {
      databaseFile,
      batchId,
      rowCount: rows.length,
      completedAt
    };
  }), databaseFile);
}

export function readLatestInsightBatch({ limit = 50_000, databaseFile = config.databaseFile } = {}) {
  return withDatabase((db) => {
    const batch = db.prepare(`
      SELECT id, source, level, account_ids, row_count, started_at, completed_at, metadata_json
      FROM sync_batches
      WHERE completed_at IS NOT NULL AND row_count > 0
      ORDER BY completed_at DESC
      LIMIT 1
    `).get();

    if (!batch) return null;

    const rows = db.prepare(`
      SELECT ${insightDbColumns.filter((column) => !['batch_id', 'updated_at'].includes(column)).join(', ')}
      FROM insight_rows
      WHERE batch_id = ?
      ORDER BY COALESCE(NULLIF(hour_start, ''), date_start), campaign_name, adset_name, ad_name
      LIMIT ?
    `).all(batch.id, limit);

    return {
      batch: {
        ...batch,
        account_ids: JSON.parse(batch.account_ids || '[]'),
        metadata: JSON.parse(batch.metadata_json || '{}')
      },
      rows
    };
  }, databaseFile);
}
