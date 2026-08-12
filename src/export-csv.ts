import { readJsonl } from './storage/json-writer.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DocumentRecord } from './extractors/types.js';
import { loadSettings } from './config/settings.js';
import { getSite } from './config/sites.js';
import { Logger } from './core/logger.js';
import { normalizeLang } from './i18n/index.js';

/** Escape a field per RFC 4180: quote when needed, double inner quotes. */
export function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

/**
 * Achata os registros raspados em linhas de CSV.
 * Colunas: campos fixos do topo primeiro, depois cada coluna de `raw` (ordenada)
 * e a lista de PDFs como JSON compacto. `rowHtml` permanece só no JSONL.
 */
export function recordsToCsv(records: DocumentRecord[]): string {
  const rawKeys = new Set<string>();
  for (const r of records) {
    for (const k of Object.keys(r.raw ?? {})) rawKeys.add(k);
  }
  const rawCols = [...rawKeys].sort();
  const cols = ['id', 'source', 'expediente', 'title', 'organo', 'crawledAt', ...rawCols, 'pdfs'];

  const rows = records.map((r) => {
    const cells = [
      r.id,
      r.source,
      r.expediente ?? '',
      r.title ?? '',
      r.organo ?? '',
      r.crawledAt,
      ...rawCols.map((k) => (r.raw ?? {})[k] ?? ''),
      JSON.stringify(r.pdfs ?? []),
    ];
    return cells.map(csvEscape).join(',');
  });

  return [cols.map(csvEscape).join(','), ...rows].join('\n') + '\n';
}

/** Convert `results.jsonl` into `results.csv` next to it (or a custom path). */
export async function exportCsv(
  jsonlPath: string,
  csvPath: string,
): Promise<{ rows: number }> {
  const records = await readJsonl<DocumentRecord>(jsonlPath);
  const csv = recordsToCsv(records);
  await mkdir(dirname(csvPath), { recursive: true });
  await writeFile(csvPath, csv, 'utf8');
  return { rows: records.length };
}

// ---------------------------------------------------------------------------
// CLI entry: `npm run export-csv -- --site oefa [--out path]`
// ---------------------------------------------------------------------------
const isDirectRun = process.argv[1]
  ? /export-csv\.(ts|js)$/.test(process.argv[1].replace(/\\/g, '/'))
  : false;

if (isDirectRun) {
  const args = process.argv.slice(2);
  const valueOf = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  const settings = loadSettings();
  const logger = new Logger(normalizeLang(valueOf('--lang') ?? settings.lang));
  try {
    const site = getSite(valueOf('--site') ?? 'oefa');
    if (!site) {
      logger.error('siteUnknown', { site: valueOf('--site') ?? 'oefa' });
      process.exit(1);
    }
    const dir = join(settings.dataDir, site.id);
    const jsonlPath = join(dir, 'results.jsonl');
    const csvPath = valueOf('--out') ?? join(dir, 'results.csv');
    const { rows } = await exportCsv(jsonlPath, csvPath);
    logger.info('csvExported', { path: csvPath, rows });
  } catch (err) {
    logger.error('error', { message: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
}
