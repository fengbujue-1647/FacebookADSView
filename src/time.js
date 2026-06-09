const API_FALLBACK_TIME_ZONE = "UTC";
const DISPLAY_TIME_ZONE = "Asia/Shanghai";

const formatterCache = new Map();
const dateStartCache = new Map();
const hourStartCache = new Map();

function normalizeTimeZone(timeZone, fallback = API_FALLBACK_TIME_ZONE) {
  const candidate = String(timeZone || "").trim();
  if (candidate) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(0);
      return candidate;
    } catch {
      // Fall through to fallback.
    }
  }

  if (!fallback) return "";
  if (fallback === candidate) return API_FALLBACK_TIME_ZONE;
  return normalizeTimeZone(fallback, API_FALLBACK_TIME_ZONE);
}

function getFormatter(timeZone) {
  const normalized = normalizeTimeZone(timeZone);
  if (!formatterCache.has(normalized)) {
    formatterCache.set(normalized, new Intl.DateTimeFormat("en-US-u-nu-latn", {
      timeZone: normalized,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }));
  }
  return formatterCache.get(normalized);
}

function datePartsInTimeZone(date, timeZone) {
  const parts = Object.fromEntries(
    getFormatter(timeZone)
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second
  };
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function offsetMinutesFor(date, timeZone) {
  const parts = datePartsInTimeZone(date, timeZone);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((localAsUtc - date.getTime()) / 60_000);
}

function formatOffset(date, timeZone) {
  const offsetMinutes = offsetMinutesFor(date, timeZone);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

function formatDateTimeInTimeZone(date, timeZone = DISPLAY_TIME_ZONE, { withOffset = false } = {}) {
  const normalized = normalizeTimeZone(timeZone);
  const parts = datePartsInTimeZone(date, normalized);
  const text = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
  return withOffset ? `${text}${formatOffset(date, normalized)}` : text;
}

function zonedDateTimeToUtc({
  year,
  month,
  day,
  hour = 0,
  minute = 0,
  second = 0
}, timeZone = API_FALLBACK_TIME_ZONE) {
  const normalized = normalizeTimeZone(timeZone);
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let utcMs = localAsUtc;

  for (let index = 0; index < 3; index += 1) {
    const offsetMs = offsetMinutesFor(new Date(utcMs), normalized) * 60_000;
    const nextUtcMs = localAsUtc - offsetMs;
    if (Math.abs(nextUtcMs - utcMs) < 1000) {
      utcMs = nextUtcMs;
      break;
    }
    utcMs = nextUtcMs;
  }

  return new Date(utcMs);
}

function parseDateOnly(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function hourFromRange(hourlyRange) {
  const match = String(hourlyRange || "").match(/^(\d{1,2}):/);
  if (!match) return null;
  const hour = Number(match[1]);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

function hourFromHourStart(hourStart) {
  const match = String(hourStart || "").match(/T(\d{1,2}):/);
  if (!match) return null;
  const hour = Number(match[1]);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

function dateStartInDisplayTimeZone(dateStart, sourceTimeZone = API_FALLBACK_TIME_ZONE) {
  const cacheKey = `${sourceTimeZone}|${dateStart}`;
  if (dateStartCache.has(cacheKey)) {
    return dateStartCache.get(cacheKey);
  }

  const parts = parseDateOnly(dateStart);
  if (!parts) return "";
  const instant = zonedDateTimeToUtc(parts, sourceTimeZone);
  const value = formatDateTimeInTimeZone(instant, DISPLAY_TIME_ZONE, { withOffset: true });
  dateStartCache.set(cacheKey, value);
  return value;
}

function hourStartInDisplayTimeZone({ dateStart, hourlyRange, hourStart, sourceTimeZone = API_FALLBACK_TIME_ZONE } = {}) {
  const cacheKey = `${sourceTimeZone}|${dateStart}|${hourlyRange}|${hourStart}`;
  if (hourStartCache.has(cacheKey)) {
    return hourStartCache.get(cacheKey);
  }

  const parts = parseDateOnly(dateStart);
  const hour = hourFromRange(hourlyRange) ?? hourFromHourStart(hourStart);
  if (!parts || hour === null) return "";
  const instant = zonedDateTimeToUtc({ ...parts, hour }, sourceTimeZone);
  const value = formatDateTimeInTimeZone(instant, DISPLAY_TIME_ZONE, { withOffset: true });
  hourStartCache.set(cacheKey, value);
  return value;
}

function enrichInsightRowsWithTimeZone(rows = [], accountTimeZones = new Map()) {
  let enrichedCount = 0;
  const normalizedAccountTimeZones = new Map([...accountTimeZones.entries()]
    .map(([accountId, timeZone]) => [String(accountId), normalizeTimeZone(timeZone, "")])
    .filter(([, timeZone]) => timeZone));

  const outputRows = rows.map((row) => {
    const accountId = String(row.account_id || "");
    const sourceTimeZone = normalizeTimeZone(row.account_timezone || normalizedAccountTimeZones.get(accountId) || "", "");
    if (!sourceTimeZone) return row;

    const next = { ...row };
    if (!next.account_timezone) {
      next.account_timezone = sourceTimeZone;
      enrichedCount += 1;
    }
    if (!next.date_start_beijing && next.date_start) {
      next.date_start_beijing = dateStartInDisplayTimeZone(next.date_start, sourceTimeZone);
      enrichedCount += 1;
    }
    if (!next.hour_start_beijing && next.date_start && (next.hourly_range || next.hour_start)) {
      next.hour_start_beijing = hourStartInDisplayTimeZone({
        dateStart: next.date_start,
        hourlyRange: next.hourly_range,
        hourStart: next.hour_start,
        sourceTimeZone
      });
      enrichedCount += 1;
    }
    return next;
  });

  return {
    rows: outputRows,
    enrichedCount
  };
}

module.exports = {
  API_FALLBACK_TIME_ZONE,
  DISPLAY_TIME_ZONE,
  dateStartInDisplayTimeZone,
  enrichInsightRowsWithTimeZone,
  hourStartInDisplayTimeZone,
  normalizeTimeZone
};
