import * as cheerio from 'cheerio';
import { buildPaginationPayload, parsePaginator, type PageToken } from '../core/paginator.js';
import type { DocumentRecord, ParsedPage, PdfCandidate, SearchQuery, SiteAdapter } from './types.js';

/**
 * Poder Judicial del Perú — Jurisprudencia portal.
 * https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/resultado.xhtml
 *
 * IMPORTANT: this site is geo-blocked outside Peru (verified HTTP 403 from
 * non-Peruvian IPs) and requires a VPN to Peru. The JSF mechanics below follow
 * the PrimeFaces pattern verified against the OEFA portal and are therefore
 * *hypotheses* until a recon pass with VPN is completed (see docs/SITE_RECON.md).
 *
 * The engine auto-discovers the JSF form id from the page HTML; only the
 * search button id and the result-table selectors are site-specific. They are
 * centralized here so the recon pass can fix them in one place.
 */
export class PjAdapter implements SiteAdapter {
  readonly id = 'pj';
  readonly baseUrl = 'https://jurisprudencia.pj.gob.pe';
  readonly searchPagePath = '/jurisprudenciaweb/faces/page/resultado.xhtml';
  readonly dataTableId = 'dtResultado'; // HYPOTHESIS — confirm with VPN
  readonly resultsPanelId = 'pgLista'; // HYPOTHESIS — confirm with VPN
  readonly requiresVpn = true;

  // HYPOTHESES to confirm in recon (docs/SITE_RECON.md):
  private readonly btn = 'btnBuscar'; // search button (without form prefix)
  private readonly resultsPanel = 'pgLista'; // AJAX render target
  private readonly searchField = 'txtBusqueda'; // query input (without form prefix)

  buildSearchPayload(formId: string, q: SearchQuery, viewState: string): Record<string, string> {
    return {
      'javax.faces.partial.ajax': 'true',
      'javax.faces.source': `${formId}:${this.btn}`,
      'javax.faces.partial.execute': '@all',
      'javax.faces.partial.render': `${formId}:${this.resultsPanel}`,
      [`${formId}:${this.btn}`]: this.btn,
      [`${formId}:${this.searchField}`]: q.expediente ?? q.administrado ?? q.materia ?? '',
      'javax.faces.ViewState': viewState,
    };
  }

  buildPaginationPayload(
    formId: string,
    token: PageToken,
    viewState: string,
  ): Record<string, string> {
    return buildPaginationPayload(formId, this.dataTableId, token, viewState);
  }

  parseResults(html: string): ParsedPage {
    // Generic PrimeFaces DataTable parsing: maps cells to column headers and
    // exposes every column in `raw`. Once the real column layout is known,
    // refine here (see SITE_RECON.md).
    const docs = this.genericRows(html, 'pj');
    const pag = parsePaginator(html, this.formIdOf(html), this.dataTableId);
    return {
      documents: docs,
      nextToken: pag.nextFirst !== undefined ? { first: pag.nextFirst, rows: pag.rows } : undefined,
      totalRecords: pag.totalRecords,
      currentPage: pag.currentPage,
      totalPages: pag.totalPages,
    };
  }

  async extractPdfUrls(doc: DocumentRecord): Promise<PdfCandidate[]> {
    if (!doc.rowHtml) return [];
    const $ = cheerio.load(doc.rowHtml);
    const found: PdfCandidate[] = [];
    $('a[href]').each((_, a) => {
      const href = $(a).attr('href') ?? '';
      const lower = href.toLowerCase();
      if (lower.includes('.pdf') || lower.includes('download') || lower.includes('ver')) {
        found.push({ url: href, nameHint: $(a).text().trim() || undefined });
      }
    });
    return found;
  }

  searchFormValues(formId: string, q: SearchQuery): Record<string, string> {
    return {
      [`${formId}:${this.searchField}`]: q.expediente ?? q.administrado ?? q.materia ?? '',
    };
  }

  private genericRows(html: string, source: 'pj' | 'oefa'): DocumentRecord[] {
    const $ = cheerio.load(html);
    const formId = this.formIdOf(html);
    const esc = (id: string) => id.replace(/:/g, '\\:');

    const headers: string[] = [];
    $(`#${esc(`${formId}:${this.dataTableId}_head`)} th`).each((_, el) => {
      headers.push($(el).text().replace(/\s+/g, ' ').trim());
    });

    const docs: DocumentRecord[] = [];
    $(`#${esc(`${formId}:${this.dataTableId}_data`)} tr`).each((i, tr) => {
      const $tr = $(tr);
      if ($tr.hasClass('ui-datatable-empty-message')) return;
      const cells = $tr.find('td');
      if (cells.length === 0) return;
      const raw: Record<string, string> = {};
      cells.each((ci, td) => {
        const label = headers[ci] ? headers[ci] : `col_${ci}`;
        raw[label] = $(td).text().replace(/\s+/g, ' ').trim();
      });
      const expediente =
        raw['Expediente'] ||
        raw['N° Expediente'] ||
        raw['Número de expediente'] ||
        Object.values(raw)[0] ||
        '';
      docs.push({
        id: expediente ? `${expediente}_${i}` : `${source}_row_${i}`,
        source,
        expediente: expediente || undefined,
        title: raw['Título'] || raw['Materia'] || undefined,
        raw,
        rowHtml: $.html($tr),
        pdfs: [],
        crawledAt: new Date().toISOString(),
      });
    });
    return docs;
  }

  private formIdOf(html: string): string {
    const m = /<form[^>]*id="([^"]+)"/.exec(html);
    return m ? m[1] : '';
  }
}
