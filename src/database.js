const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const { enrichInsightRowsWithTimeZone } = require("./time");

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
  "result_type",
  "updated_at"
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

function tableColumnSet(db, tableName) {
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name));
}

function displayDateExpression(existingColumns) {
  const candidates = [];
  if (existingColumns.has("hour_start_beijing")) {
    candidates.push("substr(NULLIF(hour_start_beijing, ''), 1, 10)");
  }
  if (existingColumns.has("date_start_beijing")) {
    candidates.push("substr(NULLIF(date_start_beijing, ''), 1, 10)");
  }
  if (existingColumns.has("date_start")) {
    candidates.push("date_start");
  }
  return candidates.length ? `COALESCE(${candidates.join(", ")})` : "''";
}

function displayTimeOrderExpression(existingColumns) {
  const candidates = [];
  if (existingColumns.has("hour_start_beijing")) {
    candidates.push("NULLIF(hour_start_beijing, '')");
  }
  if (existingColumns.has("hour_start")) {
    candidates.push("NULLIF(hour_start, '')");
  }
  if (existingColumns.has("date_start_beijing")) {
    candidates.push("NULLIF(date_start_beijing, '')");
  }
  if (existingColumns.has("date_start")) {
    candidates.push("date_start");
  }
  return candidates.length ? `COALESCE(${candidates.join(", ")})` : "''";
}

function addDaysToDateString(dateString, amount) {
  const match = String(dateString || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateString;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function analysisDisplayDate(row) {
  return String(row.hour_start_beijing || row.date_start_beijing || row.date_start || "").slice(0, 10);
}


function readLatestInsightData({ databaseFile, limit = 50_000, accountTimeZones = new Map() } = {}) {
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
    const enriched = enrichInsightRowsWithTimeZone(rows, accountTimeZones);

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
          read_mode: "recent_fact_rows",
          time_zone_enriched_fields: enriched.enrichedCount
        }
      },
      rows: enriched.rows
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

function emptyCollectionQueueOverview(queueName = "insights") {
  return {
    queueName,
    generatedAt: new Date().toISOString(),
    statusCounts: {
      waiting: 0,
      running: 0,
      completed: 0,
      failed: 0,
      retry: 0
    },
    activeWorkers: 0,
    progress: {
      total: 0,
      completed: 0,
      percent: 0
    },
    totals: {
      rows: 0,
      rawRows: 0,
      rateLimited: 0,
      quotaLimited: 0
    },
    recentWindow: {
      batchCount: 0,
      avgDurationMs: 0,
      rateLimited: 0,
      quotaLimited: 0
    },
    recentJobs: [],
    recentBatches: []
  };
}

function parseCollectionJob(row) {
  return {
    ...row,
    objectIds: parseJson(row.object_ids_json, []),
    metadata: parseJson(row.metadata_json, {}),
    rate_limited: Boolean(row.rate_limited),
    quota_limited: Boolean(row.quota_limited)
  };
}

function readCollectionQueueOverview({ databaseFile, queueName = "insights", limit = 80 } = {}) {
  if (!databaseFile || !fs.existsSync(databaseFile)) {
    return emptyCollectionQueueOverview(queueName);
  }

  const db = new DatabaseSync(databaseFile);
  try {
    if (!tableExists(db, "collection_jobs")) {
      return emptyCollectionQueueOverview(queueName);
    }

    const statusRows = db.prepare(`
      SELECT status, COUNT(*) AS count
      FROM collection_jobs
      WHERE queue_name = ?
      GROUP BY status
    `).all(queueName);
    const statusCounts = emptyCollectionQueueOverview(queueName).statusCounts;
    statusRows.forEach((row) => {
      statusCounts[row.status] = Number(row.count || 0);
    });
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
    const canReadBatches = tableExists(db, "collection_job_batches");
    const recentWindow = canReadBatches
      ? db.prepare(`
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
      `).get()
      : {};
    const recentJobs = db.prepare(`
      SELECT *
      FROM collection_jobs
      WHERE queue_name = ?
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ?
    `).all(queueName, Math.min(200, Math.max(1, Number.parseInt(limit, 10) || 80))).map(parseCollectionJob);
    const recentBatches = canReadBatches
      ? db.prepare(`
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
      }))
      : [];
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
        batchCount: Number(recentWindow?.total || 0),
        avgDurationMs: Math.round(Number(recentWindow?.avg_duration_ms || 0)),
        rateLimited: Number(recentWindow?.rate_limited || 0),
        quotaLimited: Number(recentWindow?.quota_limited || 0)
      },
      recentJobs,
      recentBatches
    };
  } catch (error) {
    return {
      ...emptyCollectionQueueOverview(queueName),
      error: error.message
    };
  } finally {
    db.close();
  }
}

function activeStatusSql(alias) {
  return `UPPER(COALESCE(NULLIF(${alias}.effective_status, ''), NULLIF(${alias}.status, ''), NULLIF(${alias}.configured_status, ''))) = 'ACTIVE'`;
}

function maxSyncedAt(db, tableName) {
  try {
    const row = db.prepare(`SELECT MAX(synced_at) AS synced_at FROM ${tableName}`).get();
    return row?.synced_at || "";
  } catch {
    return "";
  }
}

function resourceCountsForTable(db, tableName, alias = "r", accountId = "") {
  try {
    const params = [];
    const where = accountId ? `WHERE ${alias}.account_id = ?` : "";
    if (accountId) {
      params.push(accountId);
    }
    return db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN ${activeStatusSql(alias)} THEN 1 ELSE 0 END) AS active
      FROM ${tableName} ${alias}
      ${where}
    `).get(...params);
  } catch {
    return { total: 0, active: 0 };
  }
}

function insightSummaryByResource(db, { level = "campaigns", accountId = "" } = {}) {
  try {
    if (!tableExists(db, "insight_rows")) {
      return new Map();
    }
    const idColumn = level === "ads" ? "ad_id" : "campaign_id";
    const latestDateRows = db.prepare(`
      SELECT ${idColumn} AS id, MAX(date_start) AS latest_date
      FROM insight_rows
      WHERE ${idColumn} <> ''
        AND (? = '' OR account_id = ?)
      GROUP BY ${idColumn}
    `).all(accountId, accountId);
    const latestDates = new Map(latestDateRows.map((row) => [String(row.id), row.latest_date]));
    const summaries = db.prepare(`
      SELECT
        ${idColumn} AS id,
        date_start,
        SUM(spend) AS spend,
        SUM(impressions) AS impressions,
        SUM(clicks) AS clicks,
        MAX(updated_at) AS updated_at,
        COUNT(*) AS row_count
      FROM insight_rows
      WHERE ${idColumn} <> ''
        AND (? = '' OR account_id = ?)
      GROUP BY ${idColumn}, date_start
    `).all(accountId, accountId);
    const result = new Map();
    summaries.forEach((row) => {
      if (row.date_start !== latestDates.get(String(row.id))) return;
      result.set(String(row.id), {
        latest_data_date: row.date_start || "",
        latest_day_spend: Number(row.spend || 0),
        latest_updated_at: row.updated_at || "",
        latest_impressions: Number(row.impressions || 0),
        latest_clicks: Number(row.clicks || 0),
        insight_row_count: Number(row.row_count || 0)
      });
    });
    return result;
  } catch {
    return new Map();
  }
}

function attachInsightSummary(rows, summaries, idKey) {
  return rows.map((row) => ({
    ...row,
    ...(summaries.get(String(row[idKey] || row.id || "")) || {
      latest_data_date: "",
      latest_day_spend: 0,
      latest_updated_at: "",
      latest_impressions: 0,
      latest_clicks: 0,
      insight_row_count: 0
    })
  }));
}

function readActiveResourceCandidates({
  databaseFile,
  accountId = "8462513793771963",
  limit = 2000,
  refreshIntervalMs = 120 * 60 * 1000
} = {}) {
  const empty = {
    account_id: accountId,
    generated_at: new Date().toISOString(),
    refresh_interval_minutes: Math.round(refreshIntervalMs / 60_000),
    stale: true,
    last_synced_at: "",
    last_synced_at_by_type: {
      campaigns: "",
      adsets: "",
      ads: ""
    },
    counts: {
      campaigns: { total: 0, active: 0 },
      adsets: { total: 0, active: 0 },
      ads: { total: 0, active: 0, chain_active: 0 }
    },
    campaigns: [],
    adsets: [],
    ads: []
  };

  if (!databaseFile || !fs.existsSync(databaseFile)) {
    return empty;
  }

  const db = new DatabaseSync(databaseFile);
  try {
    const campaignSyncedAt = maxSyncedAt(db, "resource_campaigns");
    const adsetSyncedAt = maxSyncedAt(db, "resource_adsets");
    const adSyncedAt = maxSyncedAt(db, "resource_ads");
    const syncedTimes = [campaignSyncedAt, adsetSyncedAt, adSyncedAt].filter(Boolean).sort();
    const lastSyncedAt = syncedTimes.at(-1) || "";
    const oldestSyncedAt = syncedTimes[0] || "";
    const stale = !oldestSyncedAt || (Date.now() - new Date(oldestSyncedAt).getTime() > refreshIntervalMs);

    const campaigns = db.prepare(`
      SELECT
        campaign_id AS id,
        campaign_id,
        account_id,
        name,
        status,
        effective_status,
        configured_status,
        synced_at
      FROM resource_campaigns c
      WHERE c.account_id = ?
        AND ${activeStatusSql("c")}
      ORDER BY LOWER(COALESCE(NULLIF(name, ''), campaign_id)), campaign_id
      LIMIT ?
    `).all(accountId, limit);

    const adsets = db.prepare(`
      SELECT
        s.adset_id AS id,
        s.adset_id,
        s.campaign_id,
        s.account_id,
        s.name,
        s.status,
        s.effective_status,
        s.configured_status,
        s.synced_at,
        c.name AS campaign_name,
        c.effective_status AS campaign_effective_status
      FROM resource_adsets s
      INNER JOIN resource_campaigns c ON c.campaign_id = s.campaign_id
      WHERE s.account_id = ?
        AND c.account_id = ?
        AND ${activeStatusSql("s")}
        AND ${activeStatusSql("c")}
      ORDER BY LOWER(COALESCE(NULLIF(c.name, ''), c.campaign_id)),
        LOWER(COALESCE(NULLIF(s.name, ''), s.adset_id)),
        s.adset_id
      LIMIT ?
    `).all(accountId, accountId, limit);

    const ads = db.prepare(`
      SELECT
        a.ad_id AS id,
        a.ad_id,
        a.adset_id,
        a.campaign_id,
        a.account_id,
        a.name,
        a.status,
        a.effective_status,
        a.configured_status,
        a.synced_at,
        s.name AS adset_name,
        s.effective_status AS adset_effective_status,
        c.name AS campaign_name,
        c.effective_status AS campaign_effective_status
      FROM resource_ads a
      INNER JOIN resource_adsets s ON s.adset_id = a.adset_id
      INNER JOIN resource_campaigns c ON c.campaign_id = a.campaign_id
      WHERE a.account_id = ?
        AND s.account_id = ?
        AND c.account_id = ?
        AND ${activeStatusSql("a")}
        AND ${activeStatusSql("s")}
        AND ${activeStatusSql("c")}
      ORDER BY LOWER(COALESCE(NULLIF(c.name, ''), c.campaign_id)),
        LOWER(COALESCE(NULLIF(s.name, ''), s.adset_id)),
        LOWER(COALESCE(NULLIF(a.name, ''), a.ad_id)),
        a.ad_id
      LIMIT ?
    `).all(accountId, accountId, accountId, limit);

    const counts = {
      campaigns: resourceCountsForTable(db, "resource_campaigns", "r", accountId),
      adsets: resourceCountsForTable(db, "resource_adsets", "r", accountId),
      ads: {
        ...resourceCountsForTable(db, "resource_ads", "r", accountId),
        chain_active: ads.length
      }
    };

    const campaignInsightSummary = insightSummaryByResource(db, { level: "campaigns", accountId });
    const adInsightSummary = insightSummaryByResource(db, { level: "ads", accountId });

    return {
      ...empty,
      generated_at: new Date().toISOString(),
      stale,
      last_synced_at: lastSyncedAt,
      last_synced_at_by_type: {
        campaigns: campaignSyncedAt,
        adsets: adsetSyncedAt,
        ads: adSyncedAt
      },
      counts,
      campaigns: attachInsightSummary(campaigns, campaignInsightSummary, "campaign_id"),
      adsets,
      ads: attachInsightSummary(ads, adInsightSummary, "ad_id")
    };
  } catch (error) {
    return {
      ...empty,
      error: error.message
    };
  } finally {
    db.close();
  }
}

function tableExists(db, tableName) {
  try {
    return Boolean(db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
    `).get(tableName));
  } catch {
    return false;
  }
}

function placeholders(items) {
  return items.map(() => "?").join(", ");
}

const analysisLevelColumns = {
  account: "account_id",
  campaign: "campaign_id",
  adset: "adset_id",
  ad: "ad_id"
};

const analysisNameColumns = {
  account: "account_name",
  campaign: "campaign_name",
  adset: "adset_name",
  ad: "ad_name"
};

function readEntitiesFromInsightRows(db, { level = "campaign", search = "", limit = 80 } = {}) {
  if (!tableExists(db, "insight_rows")) {
    return [];
  }

  const idColumn = analysisLevelColumns[level] || analysisLevelColumns.campaign;
  const nameColumn = analysisNameColumns[level] || analysisNameColumns.campaign;
  const params = [];
  const clauses = [`${idColumn} <> ''`];
  const query = String(search || "").trim();
  if (query) {
    clauses.push(`(${idColumn} LIKE ? OR ${nameColumn} LIKE ?)`);
    params.push(`%${query}%`, `%${query}%`);
  }

  return db.prepare(`
    SELECT
      ${idColumn} AS id,
      COALESCE(NULLIF(MAX(${nameColumn}), ''), ${idColumn}) AS name,
      MAX(account_id) AS account_id,
      MAX(campaign_id) AS campaign_id,
      MAX(campaign_name) AS campaign_name,
      MAX(adset_id) AS adset_id,
      MAX(adset_name) AS adset_name,
      COUNT(*) AS row_count,
      MAX(date_start) AS last_date
    FROM insight_rows
    WHERE ${clauses.join(" AND ")}
    GROUP BY ${idColumn}
    ORDER BY MAX(date_start) DESC, LOWER(COALESCE(NULLIF(MAX(${nameColumn}), ''), ${idColumn}))
    LIMIT ?
  `).all(...params, limit);
}

function readAnalysisEntityOptions({
  databaseFile,
  level = "campaign",
  search = "",
  limit = 80
} = {}) {
  if (!databaseFile || !fs.existsSync(databaseFile)) {
    return [];
  }

  const normalizedLevel = analysisLevelColumns[level] ? level : "campaign";
  const normalizedLimit = Math.min(300, Math.max(1, Number.parseInt(limit, 10) || 80));
  const query = String(search || "").trim();
  const like = `%${query}%`;
  const db = new DatabaseSync(databaseFile);
  try {
    if (normalizedLevel === "account") {
      return readEntitiesFromInsightRows(db, { level: normalizedLevel, search: query, limit: normalizedLimit });
    }

    if (normalizedLevel === "campaign" && tableExists(db, "resource_campaigns")) {
      const rows = db.prepare(`
        SELECT
          campaign_id AS id,
          COALESCE(NULLIF(name, ''), campaign_id) AS name,
          account_id,
          campaign_id,
          name AS campaign_name,
          effective_status AS status,
          synced_at AS last_date
        FROM resource_campaigns
        WHERE campaign_id <> ''
          AND (? = '' OR campaign_id LIKE ? OR name LIKE ?)
        ORDER BY LOWER(COALESCE(NULLIF(name, ''), campaign_id)), campaign_id
        LIMIT ?
      `).all(query, like, like, normalizedLimit);
      if (rows.length) return rows;
    }

    if (normalizedLevel === "adset" && tableExists(db, "resource_adsets")) {
      const canJoinCampaigns = tableExists(db, "resource_campaigns");
      const rows = db.prepare(`
        SELECT
          s.adset_id AS id,
          COALESCE(NULLIF(s.name, ''), s.adset_id) AS name,
          s.account_id,
          s.campaign_id,
          ${canJoinCampaigns ? "c.name" : "''"} AS campaign_name,
          s.adset_id,
          s.name AS adset_name,
          s.effective_status AS status,
          s.synced_at AS last_date
        FROM resource_adsets s
        ${canJoinCampaigns ? "LEFT JOIN resource_campaigns c ON c.campaign_id = s.campaign_id" : ""}
        WHERE s.adset_id <> ''
          AND (? = '' OR s.adset_id LIKE ? OR s.name LIKE ? OR s.campaign_id LIKE ? ${canJoinCampaigns ? "OR c.name LIKE ?" : ""})
        ORDER BY LOWER(COALESCE(NULLIF(${canJoinCampaigns ? "c.name" : "s.campaign_id"}, ''), s.campaign_id)),
          LOWER(COALESCE(NULLIF(s.name, ''), s.adset_id)),
          s.adset_id
        LIMIT ?
      `).all(...(canJoinCampaigns
        ? [query, like, like, like, like, normalizedLimit]
        : [query, like, like, like, normalizedLimit]));
      if (rows.length) return rows;
    }

    if (normalizedLevel === "ad" && tableExists(db, "resource_ads")) {
      const canJoinAdsets = tableExists(db, "resource_adsets");
      const canJoinCampaigns = tableExists(db, "resource_campaigns");
      const rows = db.prepare(`
        SELECT
          a.ad_id AS id,
          COALESCE(NULLIF(a.name, ''), a.ad_id) AS name,
          a.account_id,
          a.campaign_id,
          ${canJoinCampaigns ? "c.name" : "''"} AS campaign_name,
          a.adset_id,
          ${canJoinAdsets ? "s.name" : "''"} AS adset_name,
          a.ad_id,
          a.name AS ad_name,
          a.effective_status AS status,
          a.synced_at AS last_date
        FROM resource_ads a
        ${canJoinAdsets ? "LEFT JOIN resource_adsets s ON s.adset_id = a.adset_id" : ""}
        ${canJoinCampaigns ? "LEFT JOIN resource_campaigns c ON c.campaign_id = a.campaign_id" : ""}
        WHERE a.ad_id <> ''
          AND (? = '' OR a.ad_id LIKE ? OR a.name LIKE ? OR a.adset_id LIKE ? OR a.campaign_id LIKE ?
            ${canJoinAdsets ? "OR s.name LIKE ?" : ""}
            ${canJoinCampaigns ? "OR c.name LIKE ?" : ""})
        ORDER BY LOWER(COALESCE(NULLIF(${canJoinCampaigns ? "c.name" : "a.campaign_id"}, ''), a.campaign_id)),
          LOWER(COALESCE(NULLIF(${canJoinAdsets ? "s.name" : "a.adset_id"}, ''), a.adset_id)),
          LOWER(COALESCE(NULLIF(a.name, ''), a.ad_id)),
          a.ad_id
        LIMIT ?
      `).all(...[
        query,
        like,
        like,
        like,
        like,
        ...(canJoinAdsets ? [like] : []),
        ...(canJoinCampaigns ? [like] : []),
        normalizedLimit
      ]);
      if (rows.length) return rows;
    }

    return readEntitiesFromInsightRows(db, {
      level: normalizedLevel,
      search: query,
      limit: normalizedLimit
    });
  } catch {
    return [];
  } finally {
    db.close();
  }
}

function readInsightRowsForAnalysis({
  databaseFile,
  since = "",
  until = "",
  level = "campaign",
  entityIds = [],
  limit = 120_000,
  accountTimeZones = new Map()
} = {}) {
  if (!databaseFile || !fs.existsSync(databaseFile)) {
    return [];
  }

  const normalizedLevel = analysisLevelColumns[level] ? level : "campaign";
  const idColumn = analysisLevelColumns[normalizedLevel];
  const ids = [...new Set((Array.isArray(entityIds) ? entityIds : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean))];
  const db = new DatabaseSync(databaseFile);
  try {
    if (!tableExists(db, "insight_rows")) {
      return [];
    }

    const existingColumns = tableColumnSet(db, "insight_rows");
    const displayDate = displayDateExpression(existingColumns);
    const displayTimeOrder = displayTimeOrderExpression(existingColumns);
    const useDisplayTimeZoneFilter = since || until;
    const params = [];
    const clauses = [`${displayDate} <> ''`];
    if (since) {
      clauses.push("date_start >= ?");
      params.push(addDaysToDateString(since, -1));
    }
    if (until) {
      clauses.push("date_start <= ?");
      params.push(addDaysToDateString(until, 1));
    }
    if (ids.length) {
      clauses.push(`${idColumn} IN (${placeholders(ids)})`);
      params.push(...ids);
    }

    const rows = db.prepare(`
      SELECT ${selectableColumns(db, "insight_rows", insightDbColumns).join(", ")}
      FROM insight_rows
      WHERE ${clauses.join(" AND ")}
      ORDER BY ${displayDate}, ${displayTimeOrder}, campaign_name, adset_name, ad_name
      LIMIT ?
    `).all(...params, Math.min(250_000, Math.max(1, Number.parseInt(limit, 10) || 120_000)));
    const enriched = enrichInsightRowsWithTimeZone(rows, accountTimeZones).rows.map((row) => ({
      ...row,
      __display_date: analysisDisplayDate(row)
    }));
    if (!useDisplayTimeZoneFilter) {
      return enriched;
    }
    return enriched.filter((row) => {
      const date = row.__display_date;
      return (!since || date >= since) && (!until || date <= until);
    });
  } catch {
    return [];
  } finally {
    db.close();
  }
}

module.exports = {
  readLatestInsightData,
  readMonitorOverview,
  readCollectionQueueOverview,
  readActiveResourceCandidates,
  readAnalysisEntityOptions,
  readInsightRowsForAnalysis
};
