import { describe, expect, it, vi } from 'vitest';
import { JsfSession } from '../src/core/jsf-client.js';
import { HttpClient, HttpError } from '../src/core/http-client.js';
import { fixture } from './helpers.js';

describe('JsfSession', () => {
  it('parses a real OEFA page: form id, action URL and ViewState', async () => {
    const http = new HttpClient();
    const session = new JsfSession(http, 'https://publico.oefa.gob.pe');
    const html = await fixture('oefa-get.html');
    const page = session.parsePage(html, 'https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml');

    expect(page.formId).toBe('listarDetalleInfraccionRAAForm');
    expect(page.viewState.length).toBeGreaterThan(100);
    expect(page.actionUrl).toContain('/repdig/consulta/consultaTfa.xhtml');
    expect(page.hidden['javax.faces.ViewState']).toBe(page.viewState);
    expect(page.hidden['listarDetalleInfraccionRAAForm:dt_scrollState']).toBeDefined();
  });

  it('open() GETs the page and captures the session', async () => {
    const http = new HttpClient();
    const spy = vi.spyOn(http, 'getText').mockResolvedValue(await fixture('oefa-get.html'));
    const session = new JsfSession(http, 'https://publico.oefa.gob.pe');
    const page = await session.open('/repdig/consulta/consultaTfa.xhtml');
    expect(spy).toHaveBeenCalledWith('https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml');
    expect(page.formId).toBe('listarDetalleInfraccionRAAForm');
  });

  it('postPartial sends hidden fields + body with partial AJAX headers', async () => {
    const http = new HttpClient();
    vi.spyOn(http, 'getText').mockResolvedValue(await fixture('oefa-get.html'));
    const postSpy = vi.spyOn(http, 'postForm').mockResolvedValue(
      "<?xml version='1.0'?><partial-response><changes>" +
        '<update id="listarDetalleInfraccionRAAForm:pgLista"><![CDATA[<div>x</div>]]></update>' +
        '<update id="j_id1:javax.faces.ViewState:0"><![CDATA[NEW_VIEWSTATE]]></update>' +
        '</changes></partial-response>',
    );

    const session = new JsfSession(http, 'https://publico.oefa.gob.pe');
    const page = await session.open('/repdig/consulta/consultaTfa.xhtml');
    const originalViewState = page.viewState;
    const { partial, page: updated } = await session.postPartial(page, {
      'javax.faces.partial.ajax': 'true',
      'listarDetalleInfraccionRAAForm:txtNroexp': 'ABC',
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [url, body, extra] = postSpy.mock.calls[0] as [string, Record<string, string>, any];
    expect(url).toContain('/repdig/consulta/consultaTfa.xhtml');
    expect(body['javax.faces.ViewState']).toBe(originalViewState);
    expect(body['listarDetalleInfraccionRAAForm:txtNroexp']).toBe('ABC');
    expect(extra.headers['Faces-Request']).toBe('partial/ajax');
    expect(extra.headers['X-Requested-With']).toBe('XMLHttpRequest');

    expect(partial.updates.get('listarDetalleInfraccionRAAForm:pgLista')).toContain('<div>x</div>');
    // Plain-text ViewState update is applied to the page state.
    expect(updated.viewState).toBe('NEW_VIEWSTATE');
    expect(updated.hidden['javax.faces.ViewState']).toBe('NEW_VIEWSTATE');
  });

  it('applies ViewState updates wrapped in an <input> as well', async () => {
    const http = new HttpClient();
    vi.spyOn(http, 'postForm').mockResolvedValue(
      "<partial-response><changes><update id=\"javax.faces.ViewState\">" +
        '<![CDATA[<input type="hidden" name="javax.faces.ViewState" value="INPUT_VS"/>]]>' +
        '</update></changes></partial-response>',
    );
    const session = new JsfSession(http, 'https://x.example');
    const page = session.parsePage(
      '<form id="f" action="/a.xhtml"><input type="hidden" name="javax.faces.ViewState" value="OLD"/></form>',
      'https://x.example/a.xhtml',
    );
    const xml =
      "<partial-response><changes><update id=\"javax.faces.ViewState\">" +
      '<![CDATA[<input type="hidden" name="javax.faces.ViewState" value="INPUT_VS"/>]]>' +
      '</update></changes></partial-response>';
    const { partial } = await session.postPartial(page, {});
    expect(partial.updates.has('javax.faces.ViewState')).toBe(true);
    expect(page.viewState).toBe('INPUT_VS');
  });

  it('propagates HTTP errors as HttpError with status', async () => {
    const http = new HttpClient();
    vi.spyOn(http, 'getText').mockRejectedValue(new HttpError('HTTP 403 Forbidden', { status: 403 }));
    const session = new JsfSession(http, 'https://jurisprudencia.pj.gob.pe');
    await expect(session.open('/jurisprudenciaweb/faces/page/resultado.xhtml')).rejects.toMatchObject({
      name: 'HttpError',
      status: 403,
    });
  });

  it('fullPost merges hidden fields and submits the form (non-AJAX)', async () => {
    const http = new HttpClient();
    const postSpy = vi.spyOn(http, 'postForm').mockResolvedValue('<html>ok</html>');
    const session = new JsfSession(http, 'https://x.example');
    const page = session.parsePage(
      '<form id="f" action="/a.xhtml"><input type="hidden" name="javax.faces.ViewState" value="VS"/></form>',
      'https://x.example/a.xhtml',
    );
    const html = await session.fullPost(page, { 'f:btn': 'go' });
    expect(html).toBe('<html>ok</html>');
    expect(postSpy).toHaveBeenCalledWith('https://x.example/a.xhtml', {
      'javax.faces.ViewState': 'VS',
      'f:btn': 'go',
    });
  });
});
