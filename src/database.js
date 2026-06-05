const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

const insightDbColumns = [
  "date_start",
  "date_stop",
  "hourly_range",
  "hour_start",
  "account_id",
  "account_name",
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

    const rows = db.prepare(`
      SELECT ${insightDbColumns.join(", ")}
      FROM insight_rows
      WHERE batch_id = ?
      ORDER BY COALESCE(NULLIF(hour_start, ''), date_start), campaign_name, adset_name, ad_name
      LIMIT ?
    `).all(batch.id, limit);

    return {
      batch: {
        ...batch,
        account_ids: parseJson(batch.account_ids, []),
        metadata: parseJson(batch.metadata_json, {})
      },
      rows
    };
  } finally {
    db.close();
  }
}

module.exports = {
  readLatestInsightData
};
