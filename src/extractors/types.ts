import type { PageToken } from '../core/paginator.js';

/** A candidate PDF file associated with a document. */
export interface PdfCandidate {
  /** Absolute URL for GET downloads; ignored ("" ) for POST candidates. */
  url: string;
  /** Hint used to build a descriptive filename (e.g. resolution number). */
  nameHint?: string;
  /**
   * POST candidates represent JSF/Mojarra command links (e.g. the OEFA
   * "Archivo" column): the file is only reachable by submitting the form.
   * `form` carries the command-button params, merged over the live form
   * fields (ViewState, search inputs) at request time.
   */
  method?: 'GET' | 'POST';
  form?: Record<string, string>;
}

/** One extracted document record (schema-agnostic; every column kept in `raw`). */
export interface DocumentRecord {
  /** Stable unique key for the document (expediente + index when duplicated). */
  id: string;
  source: 'pj' | 'oefa';
  expediente?: string;
  title?: string;
  fecha?: string;
  materia?: string;
  distrito?: string;
  organo?: string;
  /** All columns exactly as presented by the site. */
  raw: Record<string, string>;
  /** Row HTML, kept transiently so PDF links can be re-parsed later. */
  rowHtml?: string;
  pdfs: PdfCandidate[];
  crawledAt: string;
}

/** Result of parsing one results page (or partial AJAX update). */
export interface ParsedPage {
  documents: DocumentRecord[];
  /** Token for the next page; undefined on the last page. */
  nextToken?: PageToken;
  totalRecords?: number;
  currentPage?: number;
  totalPages?: number;
}

export interface SearchQuery {
  expediente?: string;
  administrado?: string;
  unidadFiscalizable?: string;
  sector?: string;
  resolucion?: string;
  materia?: string;
  pageSize?: number;
}

/**
 * Per-site adapter. The JSF engine in `core/` is site-agnostic; everything
 * site-specific (payloads, selectors, PDF discovery) lives here.
 */
export interface SiteAdapter {
  readonly id: 'pj' | 'oefa';
  readonly baseUrl: string;
  readonly searchPagePath: string;
  /** The datatable id used for pagination (without form prefix). */
  readonly dataTableId: string;
  /** Panel id rendered by the search AJAX call (without form prefix). */
  readonly resultsPanelId: string;
  /** Whether the site requires a Peru VPN (geo-block). */
  readonly requiresVpn: boolean;

  /** Build the search POST params for the given form id and query. */
  buildSearchPayload(formId: string, q: SearchQuery, viewState: string): Record<string, string>;

  /** Build the pagination POST params. */
  buildPaginationPayload(
    formId: string,
    token: PageToken,
    viewState: string,
  ): Record<string, string>;

  /** Parse a results document (full page or AJAX update) into records. */
  parseResults(html: string): ParsedPage;

  /** Discover PDF/download candidates for a document (row-level parsing). */
  extractPdfUrls(doc: DocumentRecord): Promise<PdfCandidate[]>;

  /**
   * Plain form-field values for the search form (full JSF names, no
   * ViewState/AJAX keys). Used to replay the form for POST-based PDFs.
   */
  searchFormValues(formId: string, q: SearchQuery): Record<string, string>;
}
