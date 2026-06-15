export const API_FALLBACK_TIME_ZONE = 'UTC';
export const DISPLAY_TIME_ZONE = 'Asia/Shanghai';

const formatterCache = new Map();

function getFormatter(timeZone) {
  const normalized = normalizeTimeZone(timeZone);
  const key = normalized;
  if (!formatterCache.has(key)) {
    formatterCache.set(key, new Intl.DateTimeFormat('en-US-u-nu-latn', {
      timeZone: normalized,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }));
  }
  return formatterCache.get(key);
}

export function normalizeTimeZone(timeZone, fallback = API_FALLBACK_TIME_ZONE) {
  const candidate = String(timeZone || '').trim();
  if (candidate) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(0);
      return candidate;
    } catch {
      // Fall through to the configured fallback.
    }
  }

  if (!fallback) return '';
  if (fallback === candidate) return API_FALLBACK_TIME_ZONE;
  return normalizeTimeZone(fallback, API_FALLBACK_TIME_ZONE);
}

function datePartsInTimeZone(date, timeZone) {
  const parts = Object.fromEntries(
    getFormatter(timeZone)
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
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
  return String(value).padStart(2, '0');
}

function offsetMinutesFor(date, timeZone) {
  const parts = datePartsInTimeZone(date, timeZone);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((localAsUtc - date.getTime()) / 60_000);
}

function formatOffset(date, timeZone) {
  const offsetMinutes = offsetMinutesFor(date, timeZone);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

export function formatDateInTimeZone(date = new Date(), timeZone = API_FALLBACK_TIME_ZONE) {
  const parts = datePartsInTimeZone(date, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function formatDateTimeInTimeZone(date, timeZone = DISPLAY_TIME_ZONE, { withOffset = false } = {}) {
  const normalized = normalizeTimeZone(timeZone);
  const parts = datePartsInTimeZone(date, normalized);
  const text = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
  return withOffset ? `${text}${formatOffset(date, normalized)}` : text;
}

export function zonedDateTimeToUtc({
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
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

export function parseDateOnlyParts(value) {
  return parseDateOnly(value);
}

export function addDaysToDateString(dateString, amount) {
  const parts = parseDateOnly(dateString);
  if (!parts) {
    throw new Error('日期区间无效，请使用 YYYY-MM-DD');
  }

  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + amount);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function recentDays(timeZone = API_FALLBACK_TIME_ZONE, days = 7, now = new Date()) {
  const normalized = normalizeTimeZone(timeZone);
  const dayCount = Math.max(1, Number.parseInt(days, 10) || 7);
  const until = formatDateInTimeZone(now, normalized);
  return {
    since: addDaysToDateString(until, -(dayCount - 1)),
    until,
    sourceTimeZone: normalized
  };
}

export function recentSevenDays(timeZone = API_FALLBACK_TIME_ZONE, now = new Date()) {
  return recentDays(timeZone, 7, now);
}

export function dateRangeDays(since, until) {
  const start = parseDateOnly(since);
  const end = parseDateOnly(until);
  if (!start || !end) {
    throw new Error('日期区间无效，请使用 YYYY-MM-DD');
  }

  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const endMs = Date.UTC(end.year, end.month - 1, end.day);
  if (startMs > endMs) {
    throw new Error('日期区间无效，请使用 YYYY-MM-DD');
  }

  const days = [];
  for (let cursor = new Date(startMs); cursor.getTime() <= endMs; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = `${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(cursor.getUTCDate())}`;
    days.push({
      since: date,
      until: date
    });
  }
  return days;
}

function hourFromRange(hourlyRange) {
  const match = String(hourlyRange || '').match(/^(\d{1,2}):/);
  if (!match) return null;
  const hour = Number(match[1]);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

export function hourFromHourlyRange(hourlyRange) {
  return hourFromRange(hourlyRange);
}

export function hourlyRangeForHour(hour) {
  const value = Number.parseInt(hour, 10);
  if (!Number.isInteger(value) || value < 0 || value > 23) {
    throw new Error('小时桶必须是 0-23 的整数');
  }
  return `${pad(value)}:00:00 - ${pad(value)}:59:59`;
}

export function hourBucketKey(dateStart, hour) {
  const parts = parseDateOnly(dateStart);
  const value = Number.parseInt(hour, 10);
  if (!parts || !Number.isInteger(value) || value < 0 || value > 23) {
    return '';
  }
  return `${dateStart}T${pad(value)}:00:00`;
}

function bucketFromLocalParts(parts, timeZone) {
  const normalized = normalizeTimeZone(timeZone);
  const dateStart = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  const hour = Number(parts.hour || 0);
  const bucketStartUtc = zonedDateTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour
  }, normalized);
  return {
    dateStart,
    hour,
    hourlyRange: hourlyRangeForHour(hour),
    bucketKey: hourBucketKey(dateStart, hour),
    bucketStartUtc: bucketStartUtc.toISOString(),
    bucketEndUtc: new Date(bucketStartUtc.getTime() + 60 * 60 * 1000).toISOString(),
    sourceTimeZone: normalized
  };
}

export function latestSettledHourBucket(timeZone = API_FALLBACK_TIME_ZONE, now = new Date()) {
  const normalized = normalizeTimeZone(timeZone);
  const localNow = datePartsInTimeZone(now, normalized);
  const currentHourUtc = zonedDateTimeToUtc({
    year: localNow.year,
    month: localNow.month,
    day: localNow.day,
    hour: localNow.hour
  }, normalized);
  const settledInstant = new Date(currentHourUtc.getTime() - 60 * 60 * 1000);
  return bucketFromLocalParts(datePartsInTimeZone(settledInstant, normalized), normalized);
}

export function enumerateSettledHourBuckets({
  since,
  until,
  timeZone = API_FALLBACK_TIME_ZONE,
  now = new Date()
} = {}) {
  const normalized = normalizeTimeZone(timeZone);
  const days = dateRangeDays(since, until);
  const latest = latestSettledHourBucket(normalized, now);
  const latestUtc = new Date(latest.bucketStartUtc).getTime();
  const buckets = [];

  for (const day of days) {
    const parts = parseDateOnly(day.since);
    if (!parts) continue;
    for (let hour = 0; hour < 24; hour += 1) {
      const bucket = bucketFromLocalParts({ ...parts, hour }, normalized);
      if (new Date(bucket.bucketStartUtc).getTime() <= latestUtc) {
        buckets.push(bucket);
      }
    }
  }

  return buckets;
}

export function dateStartInDisplayTimeZone(dateStart, sourceTimeZone = API_FALLBACK_TIME_ZONE) {
  const parts = parseDateOnly(dateStart);
  if (!parts) return '';
  const instant = zonedDateTimeToUtc(parts, sourceTimeZone);
  return formatDateTimeInTimeZone(instant, DISPLAY_TIME_ZONE, { withOffset: true });
}

export function hourStartInDisplayTimeZone({ dateStart, hourlyRange, sourceTimeZone = API_FALLBACK_TIME_ZONE } = {}) {
  const parts = parseDateOnly(dateStart);
  const hour = hourFromRange(hourlyRange);
  if (!parts || hour === null) return '';
  const instant = zonedDateTimeToUtc({ ...parts, hour }, sourceTimeZone);
  return formatDateTimeInTimeZone(instant, DISPLAY_TIME_ZONE, { withOffset: true });
}
