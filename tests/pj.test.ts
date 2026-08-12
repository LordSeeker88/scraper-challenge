import { describe, expect, it } from 'vitest';
import { PjAdapter } from '../src/extractors/pj.js';

const adapter = new PjAdapter();

// Synthetic results page following the PrimeFaces DataTable pattern verified
// on OEFA (the PJ adapter's generic parser keys off form:dtResultado_*).
const PAGINATOR = `
  <span class="ui-paginator-current">Página 1 de 4 (37 registros)</span>
  <a href="#" class="ui-paginator-first ui-state-default ui-corner-all ui-state-disabled"><span>p</span></a>
  <a href="#" class="ui-paginator-prev ui-state-default ui-corner-all ui-state-disabled"><span>p</span></a>
  <a href="#" class="ui-paginator-next ui-state-default ui-corner-all"><span>p</span></a>
  <a href="#" class="ui-paginator-last ui-state-default ui-corner-all"><span>p</span></a>`;

const RESULTS = `
<form id="f" action="/search.xhtml"><span id="f:pgLista"><div id="f:dtResultado">
  <table><thead id="f:dtResultado_head"><tr>
    <th>N° Expediente</th><th>Título</th><th>Materia</th><th>PDF</th>
  </tr></thead></table>
  <table><tbody id="f:dtResultado_data">
    <tr class="ui-widget-content"><td>00123-2020-PJ</td><td>Resolución Nº 5</td><td>Civil</td>
      <td><a href="/jurisprudenciaweb/documento/ver.pdf?id=5">Ver PDF</a></td></tr>
    <tr class="ui-widget-content"><td>00456-2019-PJ</td><td>Sentencia Nº 2</td><td>Penal</td>
      <td><a href="/jurisprudenciaweb/documento/ver.pdf?id=2">Ver PDF</a></td></tr>
  </tbody></table>
  ${PAGINATOR}
</div></span></form>`;

const EMPTY_RESULTS = `
<form id="f" action="/search.xhtml"><span id="f:pgLista"><div id="f:dtResultado">
  <table><thead id="f:dtResultado_head"><tr>
    <th>N° Expediente</th><th>Título</th><th>Materia</th><th>PDF</th>
  </tr></thead></table>
  <table><tbody id="f:dtResultado_data">
    <tr class="ui-widget-content ui-datatable-empty-message"><td colspan="4"></td></tr>
  </tbody></table>
  <span class="ui-paginator-current">Página 1 de 1 (0 registros)</span>
</div></span></form>`;

describe('PjAdapter (by specification — pending VPN recon)', () => {
  it('parses rows generically and exposes every column', () => {
    const parsed = adapter.parseResults(RESULTS);
    expect(parsed.documents).toHaveLength(2);

    const first = parsed.documents[0];
    expect(first.expediente).toBe('00123-2020-PJ');
    expect(first.title).toBe('Resolución Nº 5');
    expect(first.raw['Materia']).toBe('Civil');
    expect(first.raw['N° Expediente']).toBe('00123-2020-PJ');
    expect(first.source).toBe('pj');

    expect(parsed.totalRecords).toBe(37);
    expect(parsed.nextToken).toEqual({ first: 10, rows: 10 });
  });

  it('extracts PDF candidates from row links', async () => {
    const parsed = adapter.parseResults(RESULTS);
    const pdfs = await adapter.extractPdfUrls(parsed.documents[0]);
    expect(pdfs).toHaveLength(1);
    expect(pdfs[0].url).toBe('/jurisprudenciaweb/documento/ver.pdf?id=5');
  });

  it('skips the PrimeFaces empty-message row', () => {
    const parsed = adapter.parseResults(EMPTY_RESULTS);
    expect(parsed.documents).toHaveLength(0);
    expect(parsed.nextToken).toBeUndefined();
    expect(parsed.totalRecords).toBe(0);
  });

  it('builds search form values with the discovered form id', () => {
    const values = adapter.searchFormValues('formResultado', { expediente: 'EXP' });
    expect(values).toEqual({ 'formResultado:txtBusqueda': 'EXP' });
  });
});
