import * as cheerio from 'cheerio';

/** PrimeFaces paginator page token: first row index + page size. */
export interface PageToken {
  first: number;
  rows: number;
}

/**
 * Build the PrimeFaces DataTable pagination payload for a partial AJAX POST.
 * Matches PrimeFaces 6's own DataTable.paginate() wire format
 * (source: this.id, process: this.id, update: this.id + _pagination/_first/_rows).
 */
export function buildPaginationPayload(
  formId: string,
  dtId: string,
  token: PageToken,
  viewState: string,
): Record<string, string> {
  return {
    'javax.faces.partial.ajax': 'true',
    'javax.faces.source': `${formId}:${dtId}`,
    'javax.faces.partial.execute': `${formId}:${dtId}`,
    'javax.faces.partial.render': `${formId}:${dtId}`,
    [`${formId}:${dtId}_pagination`]: 'true',
    [`${formId}:${dtId}_first`]: String(token.first),
    [`${formId}:${dtId}_rows`]: String(token.rows),
    'javax.faces.ViewState': viewState,
  };
}

export interface PaginatorInfo {
  /** First row index of the next page, or undefined when on the last page. */
  nextFirst?: number;
  rows: number;
  totalRecords?: number;
  totalPages?: number;
  currentPage?: number;
}

/**
 * Read pagination state from a results document:
 * - total records from the "Página X de Y (N registros)" label;
 * - end-of-list from the disabled state of the next link.
 */
export function parsePaginator(
  html: string,
  _formId: string,
  _dtId: string,
  rows = 10,
): PaginatorInfo {
  const $ = cheerio.load(html);
  const text = $(`.ui-paginator-current`).first().text();
  const pageMatch = text.match(/P[áa]gina\s+(\d+)\s+de\s+(\d+)/i);
  const recMatch = text.match(/\(([\d.,]+)\s+registros?\)/i);
  const currentPage = pageMatch ? Number(pageMatch[1]) : undefined;
  const totalPages = pageMatch ? Number(pageMatch[2]) : undefined;
  const totalRecords = recMatch ? Number(recMatch[1].replace(/\./g, '')) : undefined;

  const next = $(`.ui-paginator-next`).first();
  const hasNext = next.length > 0 && !next.hasClass('ui-state-disabled');

  return {
    nextFirst: hasNext ? (currentPage ?? 0) * rows : undefined,
    rows,
    totalRecords,
    totalPages,
    currentPage,
  };
}
