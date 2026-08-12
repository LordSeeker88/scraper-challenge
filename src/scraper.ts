import * as cheerio from 'cheerio';
import { join } from 'node:path';
import { JsfSession, type JsfPage } from './core/jsf-client.js';
import { type HttpClient } from './core/http-client.js';
import { withRetry, RetryExhaustedError, type RetryOptions } from './core/retry.js';
import type { Logger } from './core/logger.js';
import type { DocumentRecord, SearchQuery, SiteAdapter } from './extractors/types.js';
import { downloadPdf } from './pdf/downloader.js';
import { buildPdfName } from './pdf/naming.js';
import { appendJsonl, truncateFile } from './storage/json-writer.js';
import {
  readCheckpoint,
  writeCheckpoint,
  type Checkpoint,
  type FailedPdf,
} from './storage/checkpoint.js';
import { rm } from 'node:fs/promises';

/** The AJAX response did not contain the expected results block. */
export class JsfStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsfStructureError';
  }
}

export interface ScrapeOptions {
  site: SiteAdapter;
  http: HttpClient;
  logger: Logger;
  query: SearchQuery;
  /** Stop after this many documents. */
  limit?: number;
  /** Stop after this many result pages. */
  maxPages?: number;
  /** Download PDFs (false = metadata only). */
  pdfs: boolean;
  pdfsDir: string;
  resultsPath: string;
  checkpointPath: string;
  failedPath: string;
  resume: boolean;
  maxAttempts: number;
  /** Override the retry backoff floor (ms); defaults to the retry module's. */
  retryInitialDelayMs?: number;
  /** Override the retry backoff ceiling (ms); defaults to the retry module's. */
  retryMaxDelayMs?: number;
  referer: string;
}

export interface RunStats {
  docs: number;
  pdfsOk: number;
  pdfsFailed: number;
}

function retryOpts(opts: ScrapeOptions): RetryOptions {
  return {
    maxAttempts: opts.maxAttempts,
    ...(opts.retryInitialDelayMs !== undefined ? { initialDelayMs: opts.retryInitialDelayMs } : {}),
    ...(opts.retryMaxDelayMs !== undefined ? { maxDelayMs: opts.retryMaxDelayMs } : {}),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function resolveUrl(base: string, url: string): string {
  try {
    return new URL(url, base.endsWith('/') ? base : base + '/').toString();
  } catch {
    return url;
  }
}

/** Pick the results HTML block from a partial response (panel or datatable). */
export function pickResultsHtml(partial: { updates: Map<string, string> }, page: JsfPage, site: SiteAdapter): string {
  const candidates = [
    `${page.formId}:${site.resultsPanelId}`,
    `${page.formId}:${site.dataTableId}`,
  ];
  for (const key of candidates) {
    const html = partial.updates.get(key);
    if (html) return html;
  }
  const ids = [...partial.updates.keys()].join(', ');
  throw new JsfStructureError(`No results block in AJAX response (looked for ${candidates.join(' / ')}); got: ${ids || '(empty)'}`);
}

/** Refresh hidden form fields (scroll state, ViewState) from returned HTML. */
export function syncHidden(page: JsfPage, html: string): JsfPage {
  const $ = cheerio.load(html);
  $('input[type="hidden"]').each((_, el) => {
    const name = $(el).attr('name');
    const value = $(el).attr('value') ?? '';
    if (name) page.hidden[name] = value;
  });
  const vs = page.hidden['javax.faces.ViewState'];
  if (vs) page.viewState = vs;
  return page;
}

/**
 * Full scraping pipeline: open session -> search -> paginate -> persist each
 * document -> download PDFs with 429 retry -> checkpoint/failure logging.
 */
export async function runScrape(opts: ScrapeOptions): Promise<RunStats> {
  const { site, http, logger } = opts;
  const session = new JsfSession(http, site.baseUrl);
  const stats: RunStats = { docs: 0, pdfsOk: 0, pdfsFailed: 0 };

  let page = await session.open(site.searchPagePath);
  const formValues = site.searchFormValues(page.formId, opts.query);
  let pageSize = opts.query.pageSize ?? 10;
  let currentFirst = 0;
  let pageNumber = 1;
  let resultsHtml: string;
  let lastPageKey: string | null = null;

  // Fresh runs start from clean output files; --resume appends to the
  // existing results/failures and continues from the checkpoint.
  if (!opts.resume) {
    await truncateFile(opts.resultsPath);
    await truncateFile(opts.failedPath);
    await rm(opts.checkpointPath, { force: true });
  }

  /**
   * Submit a JSF partial POST and return the results HTML, rebuilding the
   * request body from the CURRENT page state. If the server's JSF session
   * expired (no results block in the partial response), reopen the search
   * page once with a fresh ViewState and retry — then let the error surface.
   */
  const submit = async (buildBody: (p: JsfPage) => Record<string, string>): Promise<string> => {
    let recovery = 0;
    for (;;) {
      try {
        const body = buildBody(page);
        const { partial } = await withRetry(() => session.postPartial(page, body), retryOpts(opts));
        const html = pickResultsHtml(partial, page, site);
        page = syncHidden(page, html);
        return html;
      } catch (err) {
        if (!(err instanceof JsfStructureError) || recovery >= 1) throw err;
        recovery += 1;
        logger.warn('sessionExpired');
        await http.waitDelay();
        page = await session.open(site.searchPagePath);
      }
    }
  };

  const fetchPage = (first: number): Promise<string> =>
    submit((p) => site.buildPaginationPayload(p.formId, { first, rows: pageSize }, p.viewState));

  // Initial state: fresh runs search; resumed runs continue from the
  // checkpoint (falling back to a fresh search when none exists).
  if (opts.resume) {
    const cp = await readCheckpoint(opts.checkpointPath);
    if (cp && cp.site === site.id && cp.lastFirst + cp.rows > 0) {
      currentFirst = cp.lastFirst + cp.rows;
      pageSize = cp.rows;
      pageNumber = Math.floor(currentFirst / pageSize) + 1;
      // Seed the anti-loop guard so a resumed run that receives the SAME page
      // again (server ignoring pagination) stops instead of duplicating docs.
      lastPageKey = cp.lastPageKey ?? null;
      logger.info('resumeNotice', { first: currentFirst });
    }
  }

  if (currentFirst === 0) {
    await http.waitDelay();
    logger.info('searching');
    resultsHtml = await submit((p) => site.buildSearchPayload(p.formId, opts.query, p.viewState));
  } else {
    resultsHtml = await fetchPage(currentFirst);
  }

  for (;;) {
    const parsed = site.parseResults(resultsHtml);
    const pageKey = parsed.documents.map((d) => d.id).join('|');

    // Guarda contra servidor cuja paginação não tem efeito (caso real da OEFA:
    // toda "próxima página" devolve a página 1 de novo). Sem isso, uma execução
    // sem limite entraria em loop infinito — e uma retomada gravaria duplicatas.
    if (lastPageKey !== null && pageKey === lastPageKey && parsed.nextToken !== undefined) {
      logger.warn('paginateNoProgress');
      break;
    }
    lastPageKey = pageKey;

    const remaining = opts.limit !== undefined ? Math.max(0, opts.limit - stats.docs) : Infinity;
    const toProcess = parsed.documents.slice(0, remaining);

    for (const doc of toProcess) {
      await processDocument(doc, opts, stats, page, formValues);
      stats.docs += 1;
    }

    // Checkpoint AFTER the page is processed (covers the final page too), so
    // --resume always continues from a genuinely completed page.
    await writeCheckpoint(opts.checkpointPath, {
      site: site.id,
      lastFirst: currentFirst,
      rows: pageSize,
      totalDocs: stats.docs,
      lastPageKey: pageKey,
      updatedAt: new Date().toISOString(),
    });
    logger.info('checkpointSaved', { page: pageNumber, docs: stats.docs });

    const reachedLimit = opts.limit !== undefined && stats.docs >= opts.limit;
    const noNext = parsed.nextToken === undefined;
    const maxPagesReached = opts.maxPages !== undefined && pageNumber >= opts.maxPages;
    if (reachedLimit || noNext || maxPagesReached) break;

    const next = parsed.nextToken!;
    pageSize = next.rows;
    currentFirst = next.first;
    pageNumber += 1;
    await http.waitDelay();
    resultsHtml = await fetchPage(currentFirst);
  }

  return stats;
}

async function processDocument(
  doc: DocumentRecord,
  opts: ScrapeOptions,
  stats: RunStats,
  page: JsfPage,
  formValues: Record<string, string>,
): Promise<void> {
  opts.logger.info('docFound', { id: doc.id });
  await appendJsonl(opts.resultsPath, doc);

  if (!opts.pdfs) return;

  let pdfs = doc.pdfs;
  if (pdfs.length === 0) pdfs = await opts.site.extractPdfUrls(doc);
  if (pdfs.length === 0) return;

  for (let i = 0; i < pdfs.length; i += 1) {
    const pdf = pdfs[i];
    const name = buildPdfName(doc, i);
    const destPath = join(opts.pdfsDir, name);
    opts.logger.info('downloadingPdf', { n: i + 1, total: pdfs.length, name });

    // Candidatos POST reproduzem o formulário JSF (link de comando Mojarra):
    // os campos ocultos atuais (ViewState/scroll) + valores da busca + params
    // do botão, enviados para a URL de ação do formulário ao vivo.
    const isPost = pdf.method === 'POST';
    const url = isPost ? page.actionUrl : resolveUrl(opts.site.baseUrl, pdf.url);
    const form = isPost
      ? { ...page.hidden, ...formValues, ...(pdf.form ?? {}) }
      : undefined;

    await opts.http.waitDelay();
    try {
      const result = await withRetry(
        () => downloadPdf(opts.http, url, destPath, { referer: opts.referer, method: pdf.method, form }),
        retryOpts(opts),
      );
      if (result.skipped) {
        opts.logger.info('pdfSkipped', { name });
      } else {
        opts.logger.info('pdfOk', { name, bytes: result.bytes });
        stats.pdfsOk += 1;
      }
    } catch (err) {
      const attempts = err instanceof RetryExhaustedError ? err.attempts : 1;
      opts.logger.error('pdfFailed', { name, error: errorMessage(err) });
      opts.logger.warn('givingUpDoc', { id: doc.id, attempts });
      const failed: FailedPdf = {
        docId: doc.id,
        url: pdf.url || (pdf.form ? Object.keys(pdf.form)[0] ?? '' : ''),
        method: pdf.method,
        name,
        error: errorMessage(err),
        attempts,
        failedAt: new Date().toISOString(),
      };
      await appendJsonl(opts.failedPath, failed);
      stats.pdfsFailed += 1;
    }
  }
}

export type { Checkpoint };
