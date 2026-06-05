import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export function timestampForFile(date = new Date()) {
  return date.toISOString().replaceAll(':', '').replaceAll('.', '').replace('T', '_').replace('Z', '');
}

export async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  return filePath;
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export async function writeCsv(filePath, rows, columns) {
  await ensureDir(path.dirname(filePath));
  const header = columns.map((column) => csvEscape(column.header)).join(',');
  const body = rows.map((row) => columns.map((column) => csvEscape(row[column.key])).join(','));
  await fs.writeFile(filePath, [header, ...body].join('\n'), 'utf8');
  return filePath;
}

export function rawFile(name) {
  return path.join(config.rawDir, `${name}_${timestampForFile()}.json`);
}

export function outputFile(name) {
  return path.join(config.outputDir, `${name}_${timestampForFile()}.csv`);
}

export function outputJsonFile(name) {
  return path.join(config.outputDir, `${name}_${timestampForFile()}.json`);
}

export async function latestOutputJson() {
  let entries = [];
  try {
    entries = await fs.readdir(config.outputDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const files = await Promise.all(entries
    .filter((entry) => entry.isFile() && /^facebook_ads_.*\.json$/.test(entry.name))
    .map(async (entry) => {
      const filePath = path.join(config.outputDir, entry.name);
      const stat = await fs.stat(filePath);
      return {
        file: entry.name,
        filePath,
        mtimeMs: stat.mtimeMs
      };
    }));

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const file of files) {
    try {
      const text = await fs.readFile(file.filePath, 'utf8');
      const rows = JSON.parse(text.replace(/^\uFEFF/, ''));
      if (Array.isArray(rows) && rows.length > 0) {
        return {
          ...file,
          rows
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}
