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
