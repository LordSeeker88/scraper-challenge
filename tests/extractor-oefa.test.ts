import { describe, expect, it } from 'vitest';
import { OefaAdapter, parseMojarraCommand } from '../src/extractors/oefa.js';
import { fixture } from './helpers.js';

const adapter = new OefaAdapter();

describe('OefaAdapter.parseResults', () => {
  it('extracts all documents, columns and PDF links from the results fixture', async () => {
    const html = await fixture('oefa-results.html');
    const parsed = adapter.parseResults(html);

    expect(parsed.documents).toHaveLength(2);

    const first = parsed.documents[0];
    expect(first.expediente).toBe('00123-2019-OEFA/DFSAI');
    expect(first.raw['Número de expediente']).toBe('00123-2019-OEFA/DFSAI');
    expect(first.raw['Administrado']).toBe('MINERA SANTA ROSA S.A.C.');
    expect(first.raw['Sector']).toBe('MINERIA');
    expect(first.raw['Nro. Resolución de Apelación']).toBe('Nº 045-2022-OEFA/TFA');
    expect(first.source).toBe('oefa');

    // PDF discovered in the Archivo column as a Mojarra command link (POST).
    expect(first.pdfs).toHaveLength(1);
    expect(first.pdfs[0].method).toBe('POST');
    expect(first.pdfs[0].url).toBe('');
    expect(first.pdfs[0].form).toEqual({
      'listarDetalleInfraccionRAAForm:dt:0:j_idt63': 'listarDetalleInfraccionRAAForm:dt:0:j_idt63',
      param_uuid: '153a6d2a-cbed-40ef-b8ef-cd2272b19867',
    });

    // Pagination state.
    expect(parsed.totalRecords).toBe(47);
    expect(parsed.nextToken).toEqual({ first: 10, rows: 10 });
  });

  it('returns an empty result set for the real empty OEFA response', async () => {
    const xml = await fixture('oefa-search-empty.xml');
    const parsed = adapter.parseResults(xml);
    expect(parsed.documents).toHaveLength(0);
    expect(parsed.nextToken).toBeUndefined();
    expect(parsed.totalRecords).toBe(0);
  });

  it('skips the PrimeFaces empty-message row', async () => {
    const html = await fixture('oefa-search-empty.xml');
    const parsed = adapter.parseResults(html);
    expect(parsed.documents.every((d) => !d.raw['col_0']?.includes('empty-message'))).toBe(true);
  });
});

describe('OefaAdapter payloads', () => {
  it('builds the search payload with all filters and the ViewState', () => {
    const body = adapter.buildSearchPayload('listarDetalleInfraccionRAAForm', { expediente: 'ABC', sector: '1' }, 'VS1');
    expect(body['listarDetalleInfraccionRAAForm:btnBuscar']).toBe('btnBuscar');
    expect(body['listarDetalleInfraccionRAAForm:txtNroexp']).toBe('ABC');
    expect(body['listarDetalleInfraccionRAAForm:idsector']).toBe('1');
    expect(body['javax.faces.source']).toBe('listarDetalleInfraccionRAAForm:btnBuscar');
    expect(body['javax.faces.partial.render']).toBe(
      'listarDetalleInfraccionRAAForm:pgLista listarDetalleInfraccionRAAForm:txtNroexp',
    );
    expect(body['javax.faces.ViewState']).toBe('VS1');
  });

  it('exposes search form values without AJAX/ViewState keys', () => {
    const values = adapter.searchFormValues('listarDetalleInfraccionRAAForm', { expediente: 'ABC', sector: '2' });
    expect(values).toEqual({
      'listarDetalleInfraccionRAAForm:txtNroexp': 'ABC',
      'listarDetalleInfraccionRAAForm:j_idt21': '',
      'listarDetalleInfraccionRAAForm:j_idt25': '',
      'listarDetalleInfraccionRAAForm:idsector': '2',
      'listarDetalleInfraccionRAAForm:j_idt34': '',
    });
  });
});

describe('parseMojarraCommand', () => {
  it('extracts the command-button params from a real OEFA onclick', () => {
    const onclick =
      "mojarra.jsfcljs(document.getElementById('listarDetalleInfraccionRAAForm')," +
      "{'listarDetalleInfraccionRAAForm:dt:0:j_idt63':'listarDetalleInfraccionRAAForm:dt:0:j_idt63'});return false;";
    const form = parseMojarraCommand(onclick);
    expect(form).toEqual({
      'listarDetalleInfraccionRAAForm:dt:0:j_idt63': 'listarDetalleInfraccionRAAForm:dt:0:j_idt63',
    });
  });

  it('returns null for non-Mojarra links', () => {
    expect(parseMojarraCommand('alert(1)')).toBeNull();
  });

  it('extractPdfUrls falls back to plain GET links for href-based rows', async () => {
    const row =
      '<tr><td>1</td><td>EXP-1</td>' +
      '<td><a href="/repdig/documento/descargar.pdf?id=9">Ver documento</a></td></tr>';
    const doc = {
      id: 'EXP-1_0',
      source: 'oefa' as const,
      raw: {},
      rowHtml: row,
      pdfs: [] as { url: string; nameHint?: string; method?: string }[],
      crawledAt: new Date().toISOString(),
    };
    const pdfs = await adapter.extractPdfUrls(doc as any);
    expect(pdfs).toHaveLength(1);
    expect(pdfs[0].url).toBe('/repdig/documento/descargar.pdf?id=9');
    expect(pdfs[0].method).toBeUndefined();
  });
});
