import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

export const insightDbColumns = [
  'date_start',
  'date_start_beijing',
  'date_stop',
  'hourly_range',
  'hour_start',
  'hour_start_beijing',
  'account_id',
  'account_name',
  'account_timezone',
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

const insightColumnMigrations = {
  date_start_beijing: "TEXT NOT NULL DEFAULT ''",
  hour_start_beijing: "TEXT NOT NULL DEFAULT ''",
  account_timezone: "TEXT NOT NULL DEFAULT ''"
};

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
      date_start_beijing TEXT NOT NULL DEFAULT '',
      date_stop TEXT NOT NULL DEFAULT '',
      hourly_range TEXT NOT NULL DEFAULT '',
      hour_start TEXT NOT NULL DEFAULT '',
      hour_start_beijing TEXT NOT NULL DEFAULT '',
      account_id TEXT NOT NULL DEFAULT '',
      account_name TEXT NOT NULL DEFAULT '',
      account_timezone TEXT NOT NULL DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS resource_campaigns (
      campaign_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      effective_status TEXT NOT NULL DEFAULT '',
      configured_status TEXT NOT NULL DEFAULT '',
      raw_json TEXT NOT NULL DEFAULT '{}',
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS resource_adsets (
      adset_id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL DEFAULT '',
      account_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      effective_status TEXT NOT NULL DEFAULT '',
      configured_status TEXT NOT NULL DEFAULT '',
      raw_json TEXT NOT NULL DEFAULT '{}',
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS resource_ads (
      ad_id TEXT PRIMARY KEY,
      adset_id TEXT NOT NULL DEFAULT '',
      campaign_id TEXT NOT NULL DEFAULT '',
      account_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      effective_status TEXT NOT NULL DEFAULT '',
      configured_status TEXT NOT NULL DEFAULT '',
      raw_json TEXT NOT NULL DEFAULT '{}',
      synced_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_resource_campaigns_account_status
      ON resource_campaigns(account_id, effective_status);

    CREATE INDEX IF NOT EXISTS idx_resource_adsets_campaign_status
      ON resource_adsets(campaign_id, effective_status);

    CREATE INDEX IF NOT EXISTS idx_resource_ads_campaign_status
      ON resource_ads(campaign_id, effective_status);

    CREATE INDEX IF NOT EXISTS idx_resource_ads_account_status
      ON resource_ads(account_id, effective_status);

    CREATE TABLE IF NOT EXISTS api_task_runs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      object_type TEXT NOT NULL DEFAULT '',
      object_id TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL DEFAULT '',
      attempts INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT '',
      code TEXT NOT NULL DEFAULT '',
      body_size INTEGER NOT NULL DEFAULT 0,
      rows INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL DEFAULT '',
      completed_at TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_api_task_runs_run
      ON api_task_runs(run_id, status);

    CREATE INDEX IF NOT EXISTS idx_api_task_runs_object
      ON api_task_runs(object_type, object_id, completed_at DESC);

    CREATE TABLE IF NOT EXISTS monitor_runs (
      id TEXT PRIMARY KEY,
      list_type TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT '',
      next_run_at TEXT NOT NULL DEFAULT '',
      requested_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      retry_count INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error_summary TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_monitor_runs_type_completed
      ON monitor_runs(list_type, completed_at DESC);

    CREATE TABLE IF NOT EXISTS monitor_state (
      list_type TEXT PRIMARY KEY,
      last_run_at TEXT NOT NULL DEFAULT '',
      next_run_at TEXT NOT NULL DEFAULT '',
      last_status TEXT NOT NULL DEFAULT '',
      success_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      retry_count INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error_summary TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS collection_jobs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL DEFAULT '',
      queue_name TEXT NOT NULL DEFAULT 'insights',
      trigger_source TEXT NOT NULL DEFAULT '',
      level TEXT NOT NULL DEFAULT '',
      object_type TEXT NOT NULL DEFAULT '',
      account_id TEXT NOT NULL DEFAULT '',
      account_timezone TEXT NOT NULL DEFAULT '',
      object_ids_json TEXT NOT NULL DEFAULT '[]',
      id_count INTEGER NOT NULL DEFAULT 0,
      date_start TEXT NOT NULL DEFAULT '',
      hourly_range TEXT NOT NULL DEFAULT '',
      bucket_key TEXT NOT NULL DEFAULT '',
      bucket_start_utc TEXT NOT NULL DEFAULT '',
      bucket_end_utc TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'waiting',
      priority INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 8,
      next_attempt_at TEXT NOT NULL DEFAULT '',
      locked_at TEXT NOT NULL DEFAULT '',
      locked_by TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL DEFAULT '',
      completed_at TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      row_count INTEGER NOT NULL DEFAULT 0,
      raw_row_count INTEGER NOT NULL DEFAULT 0,
      rate_limited INTEGER NOT NULL DEFAULT 0,
      quota_limited INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT '',
      dedupe_key TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_collection_jobs_status
      ON collection_jobs(queue_name, status, next_attempt_at, priority, created_at);

    CREATE INDEX IF NOT EXISTS idx_collection_jobs_run
      ON collection_jobs(run_id, status, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_collection_jobs_bucket
      ON collection_jobs(object_type, account_id, bucket_key);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_jobs_open_dedupe
      ON collection_jobs(dedupe_key)
      WHERE dedupe_key <> '' AND status IN ('waiting', 'retry', 'running');

    CREATE TABLE IF NOT EXISTS collection_job_batches (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      run_id TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'insights',
      status TEXT NOT NULL DEFAULT '',
      request_ids_json TEXT NOT NULL DEFAULT '[]',
      id_count INTEGER NOT NULL DEFAULT 0,
      item_success_count INTEGER NOT NULL DEFAULT 0,
      item_failed_count INTEGER NOT NULL DEFAULT 0,
      row_count INTEGER NOT NULL DEFAULT 0,
      raw_row_count INTEGER NOT NULL DEFAULT 0,
      pages INTEGER NOT NULL DEFAULT 0,
      http_status TEXT NOT NULL DEFAULT '',
      api_code TEXT NOT NULL DEFAULT '',
      body_size INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      rate_limited INTEGER NOT NULL DEFAULT 0,
      quota_limited INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL DEFAULT '',
      completed_at TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (job_id) REFERENCES collection_jobs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_collection_job_batches_job
      ON collection_job_batches(job_id, completed_at DESC);

    CREATE INDEX IF NOT EXISTS idx_collection_job_batches_status
      ON collection_job_batches(status, completed_at DESC);

    CREATE TABLE IF NOT EXISTS collection_completed_buckets (
      object_type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      account_id TEXT NOT NULL DEFAULT '',
      account_timezone TEXT NOT NULL DEFAULT '',
      bucket_key TEXT NOT NULL,
      date_start TEXT NOT NULL DEFAULT '',
      hourly_range TEXT NOT NULL DEFAULT '',
      completed_at TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      job_id TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (object_type, object_id, bucket_key)
    );

    CREATE INDEX IF NOT EXISTS idx_collection_completed_buckets_object
      ON collection_completed_buckets(object_type, object_id, bucket_key);

    CREATE TABLE IF NOT EXISTS collection_watermarks (
      object_type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      account_id TEXT NOT NULL DEFAULT '',
      account_timezone TEXT NOT NULL DEFAULT '',
      last_completed_bucket TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (object_type, object_id)
    );
  `);
  migrateInsightColumns(db);
}

function tableColumnNames(db, tableName) {
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name));
}

function migrateInsightColumns(db) {
  const columns = tableColumnNames(db, 'insight_rows');
  for (const [column, definition] of Object.entries(insightColumnMigrations)) {
    if (!columns.has(column)) {
      db.exec(`ALTER TABLE insight_rows ADD COLUMN ${column} ${definition}`);
    }
  }
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

function resourceSpec(getType) {
  if (getType === 'campaigns') {
    return {
      table: 'resource_campaigns',
      idColumn: 'campaign_id',
      columns: ['campaign_id', 'account_id', 'name', 'status', 'effective_status', 'configured_status', 'raw_json', 'synced_at']
    };
  }
  if (getType === 'adsets') {
    return {
      table: 'resource_adsets',
      idColumn: 'adset_id',
      columns: ['adset_id', 'campaign_id', 'account_id', 'name', 'status', 'effective_status', 'configured_status', 'raw_json', 'synced_at']
    };
  }
  if (getType === 'ads') {
    return {
      table: 'resource_ads',
      idColumn: 'ad_id',
      columns: ['ad_id', 'adset_id', 'campaign_id', 'account_id', 'name', 'status', 'effective_status', 'configured_status', 'raw_json', 'synced_at']
    };
  }
  throw new Error(`未知资源类型：${getType}`);
}

function resourceValue(row, column, getType, syncedAt) {
  if (column === 'synced_at') return syncedAt;
  if (column === 'raw_json') return JSON.stringify(row || {});
  if (column === 'campaign_id' && getType === 'campaigns') return toText(row.campaign_id || row.id);
  if (column === 'adset_id' && getType === 'adsets') return toText(row.adset_id || row.id);
  if (column === 'ad_id' && getType === 'ads') return toText(row.ad_id || row.id);
  return toText(row[column]);
}

export function writeResources({
  getType,
  rows = [],
  databaseFile = config.databaseFile
} = {}) {
  const spec = resourceSpec(getType);
  const syncedAt = new Date().toISOString();
  return withDatabase((db) => runInTransaction(db, () => {
    const placeholders = spec.columns.map(() => '?').join(', ');
    const updateColumns = spec.columns
      .filter((column) => column !== spec.idColumn)
      .map((column) => `${column} = excluded.${column}`)
      .join(', ');
    const statement = db.prepare(`
      INSERT INTO ${spec.table} (${spec.columns.join(', ')})
      VALUES (${placeholders})
      ON CONFLICT (${spec.idColumn})
      DO UPDATE SET ${updateColumns}
    `);

    let written = 0;
    for (const row of rows) {
      const id = row?.id || row?.[spec.idColumn];
      if (!id) continue;
      statement.run(...spec.columns.map((column) => resourceValue(row, column, getType, syncedAt)));
      written += 1;
    }

    return {
      getType,
      rowCount: written,
      syncedAt,
      databaseFile
    };
  }), databaseFile);
}

function placeholders(items) {
  return items.map(() => '?').join(', ');
}

function chunkItems(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}

export function readResources({
  getType,
  ids = [],
  accountIds = [],
  activeOnly = false,
  limit = 500,
  databaseFile = config.databaseFile
} = {}) {
  const spec = resourceSpec(getType);
  const clauses = [];
  const params = [];

  if (ids.length) {
    clauses.push(`${spec.idColumn} IN (${placeholders(ids)})`);
    params.push(...ids.map(String));
  }
  if (accountIds.length) {
    clauses.push(`account_id IN (${placeholders(accountIds)})`);
    params.push(...accountIds.map(String));
  }
  if (activeOnly) {
    clauses.push(`UPPER(COALESCE(NULLIF(effective_status, ''), status)) = 'ACTIVE'`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return withDatabase((db) => db.prepare(`
    SELECT *
    FROM ${spec.table}
    ${where}
    ORDER BY synced_at DESC, name, ${spec.idColumn}
    LIMIT ?
  `).all(...params, limit), databaseFile);
}

export function getInsightCoverage({
  level = 'ads',
  ids = [],
  since = '',
  hourlyOnly = false,
  databaseFile = config.databaseFile
} = {}) {
  if (!ids.length) return new Map();
  const idColumn = level === 'campaigns' ? 'campaign_id' : level === 'adsets' ? 'adset_id' : 'ad_id';
  const params = ids.map(String);
  const clauses = [`${idColumn} IN (${placeholders(params)})`];
  if (since) {
    clauses.push('date_start >= ?');
    params.push(since);
  }
  if (hourlyOnly) {
    clauses.push("hour_start <> ''");
  }

  return withDatabase((db) => {
    const rows = db.prepare(`
      SELECT
        ${idColumn} AS id,
        COUNT(*) AS row_count,
        COUNT(DISTINCT date_start) AS date_count,
        GROUP_CONCAT(DISTINCT date_start) AS covered_dates,
        MIN(date_start) AS first_date,
        MAX(date_start) AS last_date,
        MAX(COALESCE(NULLIF(hour_start, ''), date_start || 'T00:00:00')) AS latest_hour
      FROM insight_rows
      WHERE ${clauses.join(' AND ')}
      GROUP BY ${idColumn}
    `).all(...params);
    const coverage = new Map(rows.map((row) => {
      const dates = new Set(String(row.covered_dates || '').split(',').filter(Boolean));
      return [String(row.id), {
        ...row,
        _dates: dates
      }];
    }));

    if (hourlyOnly) {
      const taskRows = db.prepare(`
        SELECT object_id, metadata_json
        FROM api_task_runs
        WHERE object_type = ?
          AND status = 'success'
          AND object_id IN (${placeholders(ids)})
      `).all(level, ...ids.map(String));

      for (const task of taskRows) {
        const metadata = parseJson(task.metadata_json, {});
        const date = metadata.since && metadata.since === metadata.until ? metadata.since : '';
        if (!date || (since && date < since)) continue;
        const id = String(task.object_id);
        const row = coverage.get(id) || {
          id,
          row_count: 0,
          date_count: 0,
          first_date: '',
          last_date: '',
          latest_hour: '',
          _dates: new Set()
        };
        row._dates.add(date);
        row.date_count = row._dates.size;
        row.row_count = Math.max(Number(row.row_count || 0), row._dates.size);
        row.first_date = row.first_date ? [row.first_date, date].sort()[0] : date;
        row.last_date = row.last_date ? [row.last_date, date].sort().at(-1) : date;
        coverage.set(id, row);
      }
    }

    return new Map([...coverage.entries()].map(([id, row]) => {
      const { _dates, ...publicRow } = row;
      return [id, {
        ...publicRow,
        date_count: _dates?.size || publicRow.date_count || 0
      }];
    }));
  }, databaseFile);
}

export function writeApiTaskRuns({
  runId,
  tool,
  taskRecords = [],
  metadata = {},
  databaseFile = config.databaseFile
} = {}) {
  if (!taskRecords.length) return { rowCount: 0 };

  return withDatabase((db) => runInTransaction(db, () => {
    const statement = db.prepare(`
      INSERT INTO api_task_runs (
        id,
        run_id,
        tool,
        object_type,
        object_id,
        label,
        attempts,
        duration_ms,
        status,
        code,
        body_size,
        rows,
        error,
        started_at,
        completed_at,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const record of taskRecords) {
      statement.run(
        randomUUID(),
        runId,
        tool,
        toText(record.objectType),
        toText(record.objectId),
        toText(record.label),
        toNumber(record.attempts),
        toNumber(record.durationMs),
        toText(record.status),
        toText(record.code),
        toNumber(record.bodySize),
        toNumber(record.rows),
        toText(record.error),
        toText(record.startedAt),
        toText(record.completedAt),
        JSON.stringify({
          ...(metadata || {}),
          datePreset: record.datePreset || '',
          since: record.since || '',
          until: record.until || '',
          sourceTimeZone: record.sourceTimeZone || ''
        })
      );
    }

    return {
      rowCount: taskRecords.length,
      databaseFile
    };
  }), databaseFile);
}

export function writeMonitorRun({
  id = randomUUID(),
  listType,
  status,
  startedAt,
  completedAt = '',
  nextRunAt = '',
  requestedCount = 0,
  successCount = 0,
  failedCount = 0,
  retryCount = 0,
  durationMs = 0,
  errorSummary = '',
  metadata = {},
  databaseFile = config.databaseFile
} = {}) {
  const updatedAt = new Date().toISOString();
  return withDatabase((db) => runInTransaction(db, () => {
    db.prepare(`
      INSERT INTO monitor_runs (
        id,
        list_type,
        status,
        started_at,
        completed_at,
        next_run_at,
        requested_count,
        success_count,
        failed_count,
        retry_count,
        duration_ms,
        error_summary,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      listType,
      status,
      startedAt,
      completedAt,
      nextRunAt,
      requestedCount,
      successCount,
      failedCount,
      retryCount,
      durationMs,
      errorSummary,
      JSON.stringify(metadata || {})
    );

    db.prepare(`
      INSERT INTO monitor_state (
        list_type,
        last_run_at,
        next_run_at,
        last_status,
        success_count,
        failed_count,
        retry_count,
        duration_ms,
        error_summary,
        updated_at,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (list_type)
      DO UPDATE SET
        last_run_at = excluded.last_run_at,
        next_run_at = excluded.next_run_at,
        last_status = excluded.last_status,
        success_count = excluded.success_count,
        failed_count = excluded.failed_count,
        retry_count = excluded.retry_count,
        duration_ms = excluded.duration_ms,
        error_summary = excluded.error_summary,
        updated_at = excluded.updated_at,
        metadata_json = excluded.metadata_json
    `).run(
      listType,
      completedAt || startedAt,
      nextRunAt,
      status,
      successCount,
      failedCount,
      retryCount,
      durationMs,
      errorSummary,
      updatedAt,
      JSON.stringify(metadata || {})
    );

    return {
      id,
      listType,
      status,
      databaseFile
    };
  }), databaseFile);
}

export function readMonitorOverview({
  databaseFile = config.databaseFile,
  runLimit = 8
} = {}) {
  return withDatabase((db) => {
    const stateRows = db.prepare(`
      SELECT *
      FROM monitor_state
      ORDER BY list_type
    `).all();
    const recentRuns = db.prepare(`
      SELECT *
      FROM monitor_runs
      ORDER BY started_at DESC
      LIMIT ?
    `).all(runLimit);
    const taskSummary = db.prepare(`
      SELECT
        run_id,
        tool,
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN attempts > 1 THEN attempts - 1 ELSE 0 END) AS retries,
        SUM(rows) AS rows,
        SUM(body_size) AS body_size
      FROM api_task_runs
      GROUP BY run_id, tool
      ORDER BY MAX(completed_at) DESC
      LIMIT ?
    `).all(runLimit);
    const resourceCounts = {
      campaigns: db.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN UPPER(effective_status) = \'ACTIVE\' THEN 1 ELSE 0 END) AS active FROM resource_campaigns').get(),
      adsets: db.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN UPPER(effective_status) = \'ACTIVE\' THEN 1 ELSE 0 END) AS active FROM resource_adsets').get(),
      ads: db.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN UPPER(effective_status) = \'ACTIVE\' THEN 1 ELSE 0 END) AS active FROM resource_ads').get()
    };
    const activeCampaigns = db.prepare(`
      SELECT campaign_id, account_id, name, effective_status, synced_at
      FROM resource_campaigns
      WHERE UPPER(effective_status) = 'ACTIVE'
      ORDER BY synced_at DESC, name
      LIMIT 50
    `).all();

    return {
      state: stateRows.map((row) => ({
        ...row,
        metadata: parseJson(row.metadata_json, {})
      })),
      recentRuns: recentRuns.map((row) => ({
        ...row,
        metadata: parseJson(row.metadata_json, {})
      })),
      taskSummary,
      resourceCounts,
      activeCampaigns
    };
  }, databaseFile);
}

function collectionJobFromRow(row) {
  if (!row) return null;
  return {
    ...row,
    objectIds: parseJson(row.object_ids_json, []),
    metadata: parseJson(row.metadata_json, {}),
    rate_limited: Boolean(row.rate_limited),
    quota_limited: Boolean(row.quota_limited)
  };
}

function normalizeJobStatus(status) {
  return ['waiting', 'running', 'completed', 'failed', 'retry'].includes(status) ? status : 'waiting';
}

function jobObjectIds(job) {
  return Array.isArray(job?.objectIds)
    ? job.objectIds.map(String).filter(Boolean)
    : parseJson(job?.object_ids_json, []).map(String).filter(Boolean);
}

function collectionIdColumn(objectType) {
  if (objectType === 'campaigns') return 'campaign_id';
  if (objectType === 'adsets') return 'adset_id';
  return 'ad_id';
}

export function enqueueCollectionJobs({
  jobs = [],
  databaseFile = config.databaseFile
} = {}) {
  if (!jobs.length) {
    return { inserted: 0, skipped: 0, total: 0 };
  }

  const now = new Date().toISOString();
  return withDatabase((db) => runInTransaction(db, () => {
    const statement = db.prepare(`
      INSERT OR IGNORE INTO collection_jobs (
        id,
        run_id,
        queue_name,
        trigger_source,
        level,
        object_type,
        account_id,
        account_timezone,
        object_ids_json,
        id_count,
        date_start,
        hourly_range,
        bucket_key,
        bucket_start_utc,
        bucket_end_utc,
        status,
        priority,
        attempts,
        max_attempts,
        next_attempt_at,
        locked_at,
        locked_by,
        started_at,
        completed_at,
        duration_ms,
        row_count,
        raw_row_count,
        rate_limited,
        quota_limited,
        error,
        dedupe_key,
        metadata_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0;
    for (const job of jobs) {
      const objectIds = [...new Set((job.objectIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
      const result = statement.run(
        job.id || randomUUID(),
        toText(job.runId),
        toText(job.queueName || 'insights'),
        toText(job.triggerSource || job.source),
        toText(job.level || job.objectType),
        toText(job.objectType || job.level),
        toText(job.accountId),
        toText(job.accountTimeZone),
        JSON.stringify(objectIds),
        objectIds.length,
        toText(job.dateStart),
        toText(job.hourlyRange),
        toText(job.bucketKey),
        toText(job.bucketStartUtc),
        toText(job.bucketEndUtc),
        normalizeJobStatus(job.status),
        toNumber(job.priority),
        0,
        toNumber(job.maxAttempts || 8),
        toText(job.nextAttemptAt),
        '',
        '',
        '',
        '',
        0,
        0,
        0,
        0,
        0,
        '',
        toText(job.dedupeKey),
        JSON.stringify(job.metadata || {}),
        now,
        now
      );
      inserted += Number(result.changes || 0);
    }

    return {
      inserted,
      skipped: jobs.length - inserted,
      total: jobs.length,
      databaseFile
    };
  }), databaseFile);
}

export function recoverStaleCollectionJobs({
  queueName = 'insights',
  staleAfterMs = 30 * 60 * 1000,
  databaseFile = config.databaseFile
} = {}) {
  const threshold = new Date(Date.now() - staleAfterMs).toISOString();
  const now = new Date().toISOString();
  return withDatabase((db) => {
    const result = db.prepare(`
      UPDATE collection_jobs
      SET status = 'retry',
        next_attempt_at = ?,
        locked_at = '',
        locked_by = '',
        error = CASE WHEN error = '' THEN '进程重启或 worker 超时，已恢复为重试' ELSE error END,
        updated_at = ?
      WHERE queue_name = ?
        AND status = 'running'
        AND locked_at <> ''
        AND locked_at < ?
    `).run(now, now, queueName, threshold);
    return { recovered: Number(result.changes || 0), databaseFile };
  }, databaseFile);
}

export function claimCollectionJob({
  queueName = 'insights',
  workerId = '',
  databaseFile = config.databaseFile
} = {}) {
  const now = new Date().toISOString();
  return withDatabase((db) => runInTransaction(db, () => {
    const row = db.prepare(`
      SELECT *
      FROM collection_jobs
      WHERE queue_name = ?
        AND status IN ('waiting', 'retry')
        AND (next_attempt_at = '' OR next_attempt_at <= ?)
      ORDER BY priority DESC, bucket_start_utc, created_at
      LIMIT 1
    `).get(queueName, now);

    if (!row) return null;

    db.prepare(`
      UPDATE collection_jobs
      SET status = 'running',
        attempts = attempts + 1,
        started_at = CASE WHEN started_at = '' THEN ? ELSE started_at END,
        locked_at = ?,
        locked_by = ?,
        updated_at = ?,
        error = ''
      WHERE id = ?
    `).run(now, now, workerId, now, row.id);

    return collectionJobFromRow({
      ...row,
      status: 'running',
      attempts: Number(row.attempts || 0) + 1,
      started_at: row.started_at || now,
      locked_at: now,
      locked_by: workerId,
      updated_at: now,
      error: ''
    });
  }), databaseFile);
}

export function writeCollectionJobBatch({
  jobId,
  runId = '',
  kind = 'insights',
  status = '',
  requestIds = [],
  idCount = 0,
  itemSuccessCount = 0,
  itemFailedCount = 0,
  rowCount = 0,
  rawRowCount = 0,
  pages = 0,
  httpStatus = '',
  apiCode = '',
  bodySize = 0,
  durationMs = 0,
  rateLimited = false,
  quotaLimited = false,
  error = '',
  startedAt = '',
  completedAt = '',
  metadata = {},
  databaseFile = config.databaseFile
} = {}) {
  if (!jobId) {
    throw new Error('写入批处理指标缺少 jobId');
  }
  return withDatabase((db) => {
    db.prepare(`
      INSERT INTO collection_job_batches (
        id,
        job_id,
        run_id,
        kind,
        status,
        request_ids_json,
        id_count,
        item_success_count,
        item_failed_count,
        row_count,
        raw_row_count,
        pages,
        http_status,
        api_code,
        body_size,
        duration_ms,
        rate_limited,
        quota_limited,
        error,
        started_at,
        completed_at,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      jobId,
      toText(runId),
      toText(kind),
      toText(status),
      JSON.stringify(requestIds || []),
      toNumber(idCount),
      toNumber(itemSuccessCount),
      toNumber(itemFailedCount),
      toNumber(rowCount),
      toNumber(rawRowCount),
      toNumber(pages),
      toText(httpStatus),
      toText(apiCode),
      toNumber(bodySize),
      toNumber(durationMs),
      rateLimited ? 1 : 0,
      quotaLimited ? 1 : 0,
      toText(error),
      toText(startedAt),
      toText(completedAt),
      JSON.stringify(metadata || {})
    );
    return { databaseFile };
  }, databaseFile);
}

export function completeCollectionJob({
  jobId,
  rowCount = 0,
  rawRowCount = 0,
  durationMs = 0,
  rowCountByObject = {},
  metadata = {},
  databaseFile = config.databaseFile
} = {}) {
  const completedAt = new Date().toISOString();
  return withDatabase((db) => runInTransaction(db, () => {
    const job = collectionJobFromRow(db.prepare('SELECT * FROM collection_jobs WHERE id = ?').get(jobId));
    if (!job) {
      throw new Error(`未找到采集 Job：${jobId}`);
    }

    db.prepare(`
      UPDATE collection_jobs
      SET status = 'completed',
        completed_at = ?,
        duration_ms = ?,
        row_count = ?,
        raw_row_count = ?,
        rate_limited = 0,
        quota_limited = 0,
        locked_at = '',
        locked_by = '',
        next_attempt_at = '',
        error = '',
        metadata_json = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      completedAt,
      toNumber(durationMs),
      toNumber(rowCount),
      toNumber(rawRowCount),
      JSON.stringify({ ...(job.metadata || {}), ...(metadata || {}) }),
      completedAt,
      jobId
    );

    const completedBucket = db.prepare(`
      INSERT INTO collection_completed_buckets (
        object_type,
        object_id,
        account_id,
        account_timezone,
        bucket_key,
        date_start,
        hourly_range,
        completed_at,
        row_count,
        job_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (object_type, object_id, bucket_key)
      DO UPDATE SET
        account_id = excluded.account_id,
        account_timezone = excluded.account_timezone,
        date_start = excluded.date_start,
        hourly_range = excluded.hourly_range,
        completed_at = excluded.completed_at,
        row_count = excluded.row_count,
        job_id = excluded.job_id
    `);
    const watermark = db.prepare(`
      INSERT INTO collection_watermarks (
        object_type,
        object_id,
        account_id,
        account_timezone,
        last_completed_bucket,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (object_type, object_id)
      DO UPDATE SET
        account_id = excluded.account_id,
        account_timezone = excluded.account_timezone,
        last_completed_bucket = CASE
          WHEN excluded.last_completed_bucket > collection_watermarks.last_completed_bucket
          THEN excluded.last_completed_bucket
          ELSE collection_watermarks.last_completed_bucket
        END,
        updated_at = excluded.updated_at
    `);

    for (const objectId of jobObjectIds(job)) {
      const objectRowCount = Number(rowCountByObject[String(objectId)] || 0);
      completedBucket.run(
        job.object_type,
        objectId,
        job.account_id,
        job.account_timezone,
        job.bucket_key,
        job.date_start,
        job.hourly_range,
        completedAt,
        objectRowCount,
        jobId
      );
      watermark.run(
        job.object_type,
        objectId,
        job.account_id,
        job.account_timezone,
        job.bucket_key,
        completedAt
      );
    }

    return {
      jobId,
      status: 'completed',
      rowCount,
      completedAt,
      databaseFile
    };
  }), databaseFile);
}

export function failCollectionJob({
  jobId,
  error = '',
  durationMs = 0,
  rateLimited = false,
  quotaLimited = false,
  retry = true,
  backoffMs = 0,
  metadata = {},
  databaseFile = config.databaseFile
} = {}) {
  const updatedAt = new Date().toISOString();
  return withDatabase((db) => runInTransaction(db, () => {
    const job = collectionJobFromRow(db.prepare('SELECT * FROM collection_jobs WHERE id = ?').get(jobId));
    if (!job) {
      throw new Error(`未找到采集 Job：${jobId}`);
    }
    const shouldRetry = retry && Number(job.attempts || 0) < Number(job.max_attempts || 1);
    const status = shouldRetry ? 'retry' : 'failed';
    const nextAttemptAt = shouldRetry
      ? new Date(Date.now() + Math.max(1000, Number(backoffMs || 0))).toISOString()
      : '';

    db.prepare(`
      UPDATE collection_jobs
      SET status = ?,
        duration_ms = ?,
        rate_limited = ?,
        quota_limited = ?,
        locked_at = '',
        locked_by = '',
        next_attempt_at = ?,
        completed_at = CASE WHEN ? = 'failed' THEN ? ELSE completed_at END,
        error = ?,
        metadata_json = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      status,
      toNumber(durationMs),
      rateLimited ? 1 : 0,
      quotaLimited ? 1 : 0,
      nextAttemptAt,
      status,
      updatedAt,
      toText(error),
      JSON.stringify({ ...(job.metadata || {}), ...(metadata || {}) }),
      updatedAt,
      jobId
    );

    return {
      jobId,
      status,
      nextAttemptAt,
      databaseFile
    };
  }), databaseFile);
}

export function readCollectionWatermarks({
  objectType = 'ads',
  ids = [],
  databaseFile = config.databaseFile
} = {}) {
  const normalizedIds = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!normalizedIds.length) return new Map();

  return withDatabase((db) => {
    const rows = db.prepare(`
      SELECT *
      FROM collection_watermarks
      WHERE object_type = ?
        AND object_id IN (${placeholders(normalizedIds)})
    `).all(objectType, ...normalizedIds);
    return new Map(rows.map((row) => [String(row.object_id), row]));
  }, databaseFile);
}

export function readCompletedBucketCoverage({
  objectType = 'ads',
  ids = [],
  bucketKeys = [],
  databaseFile = config.databaseFile
} = {}) {
  const normalizedIds = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
  const normalizedBuckets = [...new Set(bucketKeys.map((key) => String(key || '').trim()).filter(Boolean))];
  const coverage = new Map(normalizedIds.map((id) => [id, new Set()]));
  if (!normalizedIds.length || !normalizedBuckets.length) return coverage;

  return withDatabase((db) => {
    const idColumn = collectionIdColumn(objectType);
    for (const bucketChunk of chunkItems(normalizedBuckets, 700)) {
      const completedRows = db.prepare(`
        SELECT object_id, bucket_key
        FROM collection_completed_buckets
        WHERE object_type = ?
          AND object_id IN (${placeholders(normalizedIds)})
          AND bucket_key IN (${placeholders(bucketChunk)})
      `).all(objectType, ...normalizedIds, ...bucketChunk);

      for (const row of completedRows) {
        coverage.get(String(row.object_id))?.add(String(row.bucket_key));
      }

      const insightRows = db.prepare(`
        SELECT ${idColumn} AS object_id, hour_start AS bucket_key
        FROM insight_rows
        WHERE ${idColumn} IN (${placeholders(normalizedIds)})
          AND hour_start IN (${placeholders(bucketChunk)})
          AND hour_start <> ''
        GROUP BY ${idColumn}, hour_start
      `).all(...normalizedIds, ...bucketChunk);

      for (const row of insightRows) {
        coverage.get(String(row.object_id))?.add(String(row.bucket_key));
      }
    }

    return coverage;
  }, databaseFile);
}

export function readCollectionJobs({
  runId = '',
  status = '',
  limit = 100,
  databaseFile = config.databaseFile
} = {}) {
  const clauses = [];
  const params = [];
  if (runId) {
    clauses.push('run_id = ?');
    params.push(runId);
  }
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return withDatabase((db) => db.prepare(`
    SELECT *
    FROM collection_jobs
    ${where}
    ORDER BY updated_at DESC, created_at DESC
    LIMIT ?
  `).all(...params, Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 100))).map(collectionJobFromRow), databaseFile);
}

export function readCollectionQueueOverview({
  queueName = 'insights',
  limit = 80,
  databaseFile = config.databaseFile
} = {}) {
  return withDatabase((db) => {
    const statusRows = db.prepare(`
      SELECT status, COUNT(*) AS count
      FROM collection_jobs
      WHERE queue_name = ?
      GROUP BY status
    `).all(queueName);
    const statusCounts = Object.fromEntries(['waiting', 'running', 'completed', 'failed', 'retry'].map((key) => [key, 0]));
    for (const row of statusRows) {
      statusCounts[row.status] = Number(row.count || 0);
    }

    const totals = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(row_count) AS rows,
        SUM(raw_row_count) AS raw_rows,
        SUM(CASE WHEN rate_limited = 1 THEN 1 ELSE 0 END) AS rate_limited,
        SUM(CASE WHEN quota_limited = 1 THEN 1 ELSE 0 END) AS quota_limited
      FROM collection_jobs
      WHERE queue_name = ?
    `).get(queueName);
    const activeWorkers = db.prepare(`
      SELECT COUNT(DISTINCT locked_by) AS count
      FROM collection_jobs
      WHERE queue_name = ?
        AND status = 'running'
        AND locked_by <> ''
    `).get(queueName);
    const recentBatch = db.prepare(`
      SELECT
        AVG(duration_ms) AS avg_duration_ms,
        COUNT(*) AS total,
        SUM(CASE WHEN rate_limited = 1 THEN 1 ELSE 0 END) AS rate_limited,
        SUM(CASE WHEN quota_limited = 1 THEN 1 ELSE 0 END) AS quota_limited
      FROM (
        SELECT duration_ms, rate_limited, quota_limited
        FROM collection_job_batches
        WHERE kind = 'insights'
          AND completed_at <> ''
        ORDER BY completed_at DESC
        LIMIT 50
      )
    `).get();
    const recentJobs = db.prepare(`
      SELECT *
      FROM collection_jobs
      WHERE queue_name = ?
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ?
    `).all(queueName, Math.min(200, Math.max(1, Number.parseInt(limit, 10) || 80))).map(collectionJobFromRow);
    const recentBatches = db.prepare(`
      SELECT *
      FROM collection_job_batches
      ORDER BY completed_at DESC, started_at DESC
      LIMIT ?
    `).all(Math.min(200, Math.max(1, Number.parseInt(limit, 10) || 80))).map((row) => ({
      ...row,
      requestIds: parseJson(row.request_ids_json, []),
      metadata: parseJson(row.metadata_json, {}),
      rate_limited: Boolean(row.rate_limited),
      quota_limited: Boolean(row.quota_limited)
    }));

    const total = Number(totals?.total || 0);
    const completed = Number(totals?.completed || 0);
    return {
      queueName,
      generatedAt: new Date().toISOString(),
      statusCounts,
      activeWorkers: Number(activeWorkers?.count || 0),
      progress: {
        total,
        completed,
        percent: total ? Math.round((completed / total) * 1000) / 10 : 0
      },
      totals: {
        rows: Number(totals?.rows || 0),
        rawRows: Number(totals?.raw_rows || 0),
        rateLimited: Number(totals?.rate_limited || 0),
        quotaLimited: Number(totals?.quota_limited || 0)
      },
      recentWindow: {
        batchCount: Number(recentBatch?.total || 0),
        avgDurationMs: Math.round(Number(recentBatch?.avg_duration_ms || 0)),
        rateLimited: Number(recentBatch?.rate_limited || 0),
        quotaLimited: Number(recentBatch?.quota_limited || 0)
      },
      recentJobs,
      recentBatches
    };
  }, databaseFile);
}
