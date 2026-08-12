import { describe, expect, it } from 'vitest';
import { parsePartialResponse } from '../src/core/partial-response.js';
import { fixture } from './helpers.js';

describe('parsePartialResponse', () => {
  it('parses a real OEFA search response (CDATA updates)', async () => {
    const xml = await fixture('oefa-search-empty.xml');
    const parsed = parsePartialResponse(xml);
    expect(parsed.updates.has('listarDetalleInfraccionRAAForm:pgLista')).toBe(true);
    expect(parsed.updates.has('listarDetalleInfraccionRAAForm:txtNroexp')).toBe(true);
    expect(parsed.updates.has('j_id1:javax.faces.ViewState:0')).toBe(true);
  });

  it('strips CDATA wrappers and keeps the inner HTML intact', async () => {
    const xml = await fixture('oefa-search-empty.xml');
    const parsed = parsePartialResponse(xml);
    const panel = parsed.updates.get('listarDetalleInfraccionRAAForm:pgLista') ?? '';
    expect(panel).toContain('ui-datatable');
    expect(panel).toContain('listarDetalleInfraccionRAAForm:dt_data');
    expect(panel).not.toContain('<![CDATA[');
  });

  it('extracts eval blocks when present', () => {
    const xml =
      "<?xml version='1.0'?><partial-response><changes><update id=\"a\"><![CDATA[x]]></update>" +
      '<eval><![CDATA[PrimeFaces.cw("DataTable",{id:"t"});]]></eval></changes></partial-response>';
    const parsed = parsePartialResponse(xml);
    expect(parsed.evalBlocks).toHaveLength(1);
    expect(parsed.evalBlocks[0]).toContain('PrimeFaces.cw');
  });

  it('handles non-CDATA update bodies', () => {
    const xml =
      "<partial-response><changes><update id=\"plain\">just text</update></changes></partial-response>";
    const parsed = parsePartialResponse(xml);
    expect(parsed.updates.get('plain')).toBe('just text');
  });
});
