import * as cheerio from 'cheerio';
import { buildPaginationPayload, parsePaginator, type PageToken } from '../core/paginator.js';
import type { DocumentRecord, ParsedPage, PdfCandidate, SearchQuery, SiteAdapter } from './types.js';

/**
 * OEFA Repositorio Digital — Tribunal de Fiscalización Ambiental (TFA).
 * https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml
 *
 * JSF + PrimeFaces 6.0. Verified live (2026-08-12):
 * - form id: listarDetalleInfraccionRAAForm
 * - search button: listarDetalleInfraccionRAAForm:btnBuscar
 * - AJAX search via PrimeFaces.ab(...) partial request
 * - results table: listarDetalleInfraccionRAAForm:dt, rows in :dt_data
 * - columns: Nro., Número de expediente, Administrado, Unidad fiscalizable,
 *   Sector, Nro. Resolución de Apelación, Archivo
 * - paginator: :dt_paginator_bottom, label "Página X de Y (N registros)"
 */
export class OefaAdapter implements SiteAdapter {
  readonly id = 'oefa';
  readonly baseUrl = 'https://publico.oefa.gob.pe';
  readonly searchPagePath = '/repdig/consulta/consultaTfa.xhtml';
  readonly dataTableId = 'dt';
  readonly resultsPanelId = 'pgLista';
  readonly requiresVpn = false;

  private readonly btn = 'btnBuscar';
  private readonly cols = ['txtNroexp', 'j_idt21', 'j_idt25', 'idsector', 'j_idt34'] as const;

  buildSearchPayload(formId: string, q: SearchQuery, viewState: string): Record<string, string> {
    return {
      'javax.faces.partial.ajax': 'true',
      'javax.faces.source': `${formId}:${this.btn}`,
      'javax.faces.partial.execute': '@all',
      'javax.faces.partial.render': `${formId}:pgLista ${formId}:txtNroexp`,
      [`${formId}:${this.btn}`]: this.btn,
      [`${formId}:${this.cols[0]}`]: q.expediente ?? '',
      [`${formId}:${this.cols[1]}`]: q.administrado ?? '',
      [`${formId}:${this.cols[2]}`]: q.unidadFiscalizable ?? '',
      [`${formId}:${this.cols[3]}`]: q.sector ?? '',
      [`${formId}:${this.cols[4]}`]: q.resolucion ?? '',
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
    const $ = cheerio.load(html);
    const esc = (id: string) => id.replace(/:/g, '\\:');

    const headers: string[] = [];
    $(`#${esc(`${this.formId()}:dt_head`)} th`).each((_, el) => {
      headers.push($(el).text().replace(/\s+/g, ' ').trim());
    });

    const documents: DocumentRecord[] = [];
    $(`#${esc(`${this.formId()}:dt_data`)} tr`).each((i, tr) => {
      const $tr = $(tr);
      if ($tr.hasClass('ui-datatable-empty-message')) return;
      const cells = $tr.find('td');
      if (cells.length === 0) return;

      const raw: Record<string, string> = {};
      cells.each((ci, td) => {
        const label = headers[ci] ? headers[ci] : `col_${ci}`;
        raw[label] = $(td).text().replace(/\s+/g, ' ').trim();
      });

      const expediente = raw['Número de expediente'] || raw['N° Expediente'] || Object.values(raw)[0] || '';
      const resolucion =
        raw['Nro. Resolución de Apelación'] || raw['Nro. Resolución de Sanción'] || undefined;
      const administrado = raw['Administrado'];
      const doc: DocumentRecord = {
        id: expediente ? `${expediente}_${i}` : `oefa_row_${i}`,
        source: 'oefa',
        expediente: expediente || undefined,
        title: administrado || undefined,
        raw,
        rowHtml: $.html($tr),
        pdfs: [],
        crawledAt: new Date().toISOString(),
      };
      if (resolucion) doc.organo = resolucion;

      const pdfs = extractLinks($, $tr);
      if (pdfs.length > 0) doc.pdfs = pdfs;

      documents.push(doc);
    });

    const pag = parsePaginator(html, this.formId(), this.dataTableId);
    return {
      documents,
      nextToken: pag.nextFirst !== undefined ? { first: pag.nextFirst, rows: pag.rows } : undefined,
      totalRecords: pag.totalRecords,
      currentPage: pag.currentPage,
      totalPages: pag.totalPages,
    };
  }

  async extractPdfUrls(doc: DocumentRecord): Promise<PdfCandidate[]> {
    if (!doc.rowHtml) return [];
    // Wrap the bare <tr> in a table so htmlparser2 keeps it (cheerio drops
    // stray table rows otherwise).
    const $ = cheerio.load(`<table><tbody>${doc.rowHtml}</tbody></table>`);
    return extractLinks($, $('tr').first());
  }

  searchFormValues(_formId: string, q: SearchQuery): Record<string, string> {
    const formId = this.formId();
    return {
      [`${formId}:${this.cols[0]}`]: q.expediente ?? '',
      [`${formId}:${this.cols[1]}`]: q.administrado ?? '',
      [`${formId}:${this.cols[2]}`]: q.unidadFiscalizable ?? '',
      [`${formId}:${this.cols[3]}`]: q.sector ?? '',
      [`${formId}:${this.cols[4]}`]: q.resolucion ?? '',
    };
  }

  private formId(): string {
    return 'listarDetalleInfraccionRAAForm';
  }
}

/** Re-exported for tests: parse a Mojarra command link into form params. */
export function parseMojarraCommand(onclick: string): Record<string, string> | null {
  // Links reais da OEFA: mojarra.jsfcljs(document.getElementById('FORM'),
  // {'FORM:dt:0:j_idt63':'...','param_uuid':'...'},'');
  const m =
    /mojarra\.jsfcljs\(document\.getElementById\('([^']+)'\),\s*\{([^}]*)\}(?:,\s*'[^']*')?\)/.exec(
      onclick,
    );
  if (!m) return null;
  const form: Record<string, string> = {};
  for (const pair of m[2].matchAll(/'([^']+)':\s*'([^']*)'/g)) {
    form[pair[1]] = pair[2];
  }
  return form;
}

/**
 * Extrai candidatos de PDF de uma linha: links de comando Mojarra viram
 * candidatos POST; links diretos .pdf/documento/download viram GET.
 */
function extractLinks($: cheerio.CheerioAPI, $scope: cheerio.Cheerio<any>): PdfCandidate[] {
  const found: PdfCandidate[] = [];
  $scope.find('a[href]').each((_, a) => {
    const href = $(a).attr('href') ?? '';
    const label = $(a).text().replace(/\s+/g, ' ').trim();
    const onclick = $(a).attr('onclick') ?? '';
    const lower = href.toLowerCase();

    const mojarra = parseMojarraCommand(onclick);
    if (mojarra) {
      found.push({ url: '', method: 'POST', form: mojarra, nameHint: label || undefined });
      return;
    }
    if (
      lower.includes('.pdf') ||
      lower.includes('/documento') ||
      lower.includes('/descarga') ||
      lower.includes('download') ||
      lower.includes('archivo')
    ) {
      found.push({ url: href, nameHint: label || undefined });
    }
  });
  return found;
}
