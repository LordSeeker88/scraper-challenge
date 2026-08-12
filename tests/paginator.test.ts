import { describe, expect, it } from 'vitest';
import { buildPaginationPayload, parsePaginator } from '../src/core/paginator.js';
import { fixture } from './helpers.js';

const FORM = 'listarDetalleInfraccionRAAForm';
const DT = 'dt';

describe('buildPaginationPayload', () => {
  it('builds the PrimeFaces pagination body for a partial AJAX POST', () => {
    const body = buildPaginationPayload(FORM, DT, { first: 10, rows: 10 }, 'VS');
    expect(body).toEqual({
      'javax.faces.partial.ajax': 'true',
      'javax.faces.source': 'listarDetalleInfraccionRAAForm:dt',
      'javax.faces.partial.execute': 'listarDetalleInfraccionRAAForm:dt',
      'javax.faces.partial.render': 'listarDetalleInfraccionRAAForm:dt',
      'listarDetalleInfraccionRAAForm:dt_pagination': 'true',
      'listarDetalleInfraccionRAAForm:dt_first': '10',
      'listarDetalleInfraccionRAAForm:dt_rows': '10',
      'javax.faces.ViewState': 'VS',
    });
  });
});

describe('parsePaginator', () => {
  it('reads total records and detects a next page from the results fixture', async () => {
    const html = await fixture('oefa-results.html');
    const info = parsePaginator(html, FORM, DT);
    expect(info.totalRecords).toBe(47);
    expect(info.totalPages).toBe(5);
    expect(info.currentPage).toBe(1);
    expect(info.nextFirst).toBe(10);
  });

  it('reads page 2 of 5 and continues to row 20', async () => {
    const html = await fixture('oefa-page2.html');
    const info = parsePaginator(html, FORM, DT);
    expect(info.currentPage).toBe(2);
    expect(info.nextFirst).toBe(20);
    expect(info.totalRecords).toBe(47);
  });

  it('reports no next page for the empty real OEFA response', async () => {
    const html = await fixture('oefa-search-empty.xml');
    const info = parsePaginator(html, FORM, DT);
    expect(info.totalRecords).toBe(0);
    expect(info.nextFirst).toBeUndefined();
  });

  it('handles a missing paginator gracefully', () => {
    const info = parsePaginator('<div>no table here</div>', FORM, DT);
    expect(info.nextFirst).toBeUndefined();
    expect(info.totalRecords).toBeUndefined();
  });
});
