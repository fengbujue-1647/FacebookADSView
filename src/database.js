const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

const insightDbColumns = [
  "date_start",
  "date_start_beijing",
  "date_stop",
  "hourly_range",
  "hour_start",
  "hour_start_beijing",
  "account_id",
  "account_name",
  "account_timezone",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "effective_status",
  "spend",
  "cpc",
  "result_count",
  "cost_per_result",
  "add_to_cart_count",
  "initiate_checkout_count",
  "purchase_count",
  "purchase_value",
  "roas",
  "ctr",
  "clicks",
  "reach",
  "impressions",
  "frequency",
  "result_type"
];

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

function selectableColumns(db, tableName, columns) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name));
  return columns.map((column) => (existing.has(column) ? column : `'' AS ${column}`));
}

function readLatestInsightData({ databaseFile, limit = 50_000 } = {}) {
  if (!databaseFile || !fs.existsSync(databaseFile)) {
    return null;
  }

  const db = new DatabaseSync(databaseFile);
  try {
    const batch = db.prepare(`
      SELECT id, source, level, account_ids, row_count, started_at, completed_at, metadata_json
      FROM sync_batches
      WHERE completed_at IS NOT NULL AND row_count > 0
      ORDER BY completed_at DESC
      LIMIT 1
    `).get();

    if (!batch) {
      return null;
    }

    const latestFact = db.prepare(`
      SELECT
        MAX(date_start) AS max_date,
        MAX(updated_at) AS max_updated_at
      FROM insight_rows
      WHERE date_start <> ''
    `).get();

    if (!latestFact?.max_date) {
      return null;
    }

    const rows = db.prepare(`
      SELECT ${selectableColumns(db, "insight_rows", insightDbColumns).join(", ")}
      FROM insight_rows
      WHERE date_start >= date(?, '-13 day')
      ORDER BY COALESCE(NULLIF(hour_start, ''), date_start), campaign_name, adset_name, ad_name
      LIMIT ?
    `).all(latestFact.max_date, limit);

    const metadata = parseJson(batch.metadata_json, {});

    return {
      batch: {
        ...batch,
        row_count: rows.length,
        completed_at: latestFact.max_updated_at || batch.completed_at,
        account_ids: parseJson(batch.account_ids, []),
        metadata: {
          ...metadata,
          latest_fact_date: latestFact.max_date,
          source_batch_id: batch.id,
          source_batch_row_count: batch.row_count,
          read_mode: "recent_fact_rows"
        }
      },
      rows
    };
  } finally {
    db.close();
  }
}

function readMonitorOverview({ databaseFile, runLimit = 8 } = {}) {
  if (!databaseFile || !fs.existsSync(databaseFile)) {
    return {
      state: [],
      recentRuns: [],
      taskSummary: [],
      resourceCounts: {
        campaigns: { total: 0, active: 0 },
        adsets: { total: 0, active: 0 },
        ads: { total: 0, active: 0 }
      },
      activeCampaigns: []
    };
  }

  const db = new DatabaseSync(databaseFile);
  try {
    const tableExists = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = 'monitor_state'
    `).get();

    if (!tableExists) {
      return {
        state: [],
        recentRuns: [],
        taskSummary: [],
        resourceCounts: {
          campaigns: { total: 0, active: 0 },
          adsets: { total: 0, active: 0 },
          ads: { total: 0, active: 0 }
        },
        activeCampaigns: []
      };
    }

    const state = db.prepare(`
      SELECT *
      FROM monitor_state
      ORDER BY list_type
    `).all().map((row) => ({
      ...row,
      metadata: parseJson(row.metadata_json, {})
    }));
    const recentRuns = db.prepare(`
      SELECT *
      FROM monitor_runs
      ORDER BY started_at DESC
      LIMIT ?
    `).all(runLimit).map((row) => ({
      ...row,
      metadata: parseJson(row.metadata_json, {})
    }));
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
      campaigns: db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN UPPER(effective_status) = 'ACTIVE' THEN 1 ELSE 0 END) AS active FROM resource_campaigns").get(),
      adsets: db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN UPPER(effective_status) = 'ACTIVE' THEN 1 ELSE 0 END) AS active FROM resource_adsets").get(),
      ads: db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN UPPER(effective_status) = 'ACTIVE' THEN 1 ELSE 0 END) AS active FROM resource_ads").get()
    };
    const activeCampaigns = db.prepare(`
      SELECT campaign_id, account_id, name, effective_status, synced_at
      FROM resource_campaigns
      WHERE UPPER(effective_status) = 'ACTIVE'
      ORDER BY synced_at DESC, name
      LIMIT 50
    `).all();

    return {
      state,
      recentRuns,
      taskSummary,
      resourceCounts,
      activeCampaigns
    };
  } catch (error) {
    return {
      state: [],
      recentRuns: [],
      taskSummary: [],
      resourceCounts: {
        campaigns: { total: 0, active: 0 },
        adsets: { total: 0, active: 0 },
        ads: { total: 0, active: 0 }
      },
      activeCampaigns: [],
      error: error.message
    };
  } finally {
    db.close();
  }
}

module.exports = {
  readLatestInsightData,
  readMonitorOverview
};
