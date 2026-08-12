import { join } from 'node:path';
import { HttpClient } from './core/http-client.js';
import { Logger } from './core/logger.js';
import { normalizeLang } from './i18n/index.js';
import { loadSettings } from './config/settings.js';
import { getSite } from './config/sites.js';
import { withRetry } from './core/retry.js';
import { downloadPdf } from './pdf/downloader.js';
import { readJsonl } from './storage/json-writer.js';
import type { FailedPdf } from './storage/checkpoint.js';

export interface RetryFailedOptions {
  siteId: string;
  lang: string;
  dataDir: string;
  pdfsDir?: string;
  maxAttempts: number;
  delayMs: number;
  proxy?: string;
}

/**
 * Re-download every PDF recorded in failed.jsonl. Successful entries are
 * removed from the failures file so the next retry pass only sees the rest.
 */
export async function retryFailedPdfs(opts: RetryFailedOptions): Promise<void> {
  const lang = normalizeLang(opts.lang);
  const logger = new Logger(lang);
  const site = getSite(opts.siteId);
  if (!site) {
    logger.error('siteUnknown', { site: opts.siteId });
    return;
  }

  const dir = join(opts.dataDir, site.id);
  const failedPath = join(dir, 'failed.jsonl');
  const pdfsDir = opts.pdfsDir ?? join(dir, 'pdfs');
  const referer = site.baseUrl + site.searchPagePath;

  const failed = await readJsonl<FailedPdf>(failedPath);
  if (failed.length === 0) {
    logger.info('noFailedFile', { path: failedPath });
    return;
  }

  logger.info('retryFailedStart', { n: failed.length });
  const http = new HttpClient({ delayMs: opts.delayMs, proxy: opts.proxy });
  const remaining: FailedPdf[] = [];
  let ok = 0;
  let stillFailed = 0;
  let skippedPost = 0;

  for (const entry of failed) {
    // PDFs baseados em sessão (POST) não podem ser reproduzidos fora de uma
    // sessão JSF viva; eles são tentados de novo rodando o scrape (o downloader
    // pula arquivos que já existem).
    if (entry.method === 'POST') {
      skippedPost += 1;
      continue;
    }
    const destPath = join(pdfsDir, entry.name ?? buildFallbackName(entry));
    await http.waitDelay();
    try {
      const res = await withRetry(
        () => downloadPdf(http, resolve(site.baseUrl, entry.url), destPath, { referer }),
        { maxAttempts: opts.maxAttempts },
      );
      if (!res.skipped) {
        logger.info('pdfOk', { name: entry.name ?? destPath, bytes: res.bytes });
      }
      ok += 1;
    } catch (err) {
      const attempts = err instanceof Error && 'attempts' in err ? (err as { attempts: number }).attempts : 1;
      logger.error('pdfFailed', { name: entry.name ?? destPath, error: err instanceof Error ? err.message : String(err) });
      stillFailed += 1;
      remaining.push({ ...entry, error: err instanceof Error ? err.message : String(err), attempts, failedAt: new Date().toISOString() });
    }
  }

  // Persist only the still-failing entries (atomic-ish: rewrite the file).
  const { writeFile } = await import('node:fs/promises');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
  await writeFile(failedPath, remaining.map((r) => JSON.stringify(r)).join('\n') + (remaining.length ? '\n' : ''), 'utf8');

  logger.info('retryFailedEnd', { ok, failed: stillFailed });
  if (skippedPost > 0) {
    logger.info('postSkippedRetry', { n: skippedPost });
  }
}

function resolve(base: string, url: string): string {
  try {
    return new URL(url, base.endsWith('/') ? base : base + '/').toString();
  } catch {
    return url;
  }
}

function buildFallbackName(entry: FailedPdf): string {
  const safe = (entry.name ?? entry.docId).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
  return `${safe || 'documento'}.pdf`;
}

// ---------------------------------------------------------------------------
// CLI entry: `npm run retry-failed -- --site oefa [--lang pt] [--pdfs-dir ...]`
// ---------------------------------------------------------------------------
const isDirectRun = process.argv[1]
  ? /retry-failed\.(ts|js)$/.test(process.argv[1].replace(/\\/g, '/'))
  : false;

if (isDirectRun) {
  const args = process.argv.slice(2);
  const valueOf = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  const settings = loadSettings();
  const siteId = valueOf('--site') ?? 'oefa';
  const logger = new Logger(normalizeLang(valueOf('--lang') ?? settings.lang));
  const site = getSite(siteId);
  if (!site) {
    logger.error('siteUnknown', { site: siteId });
    process.exit(1);
  }
  retryFailedPdfs({
    siteId,
    lang: logger.lang,
    dataDir: settings.dataDir,
    pdfsDir: valueOf('--pdfs-dir'),
    maxAttempts: settings.maxAttempts,
    delayMs: settings.delayMs,
    proxy: settings.proxy,
  })
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error('error', { message: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    });
}
