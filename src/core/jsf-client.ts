import * as cheerio from 'cheerio';
import { HttpClient } from './http-client.js';
import { parsePartialResponse, type PartialResponse } from './partial-response.js';

/** Parsed state of a JSF page: the form, its hidden fields and the ViewState. */
export interface JsfPage {
  html: string;
  url: string;
  formId: string;
  actionUrl: string;
  viewState: string;
  /** All hidden inputs of the form (ViewState, scroll state, ...). */
  hidden: Record<string, string>;
}

/**
 * Sessão JSF com estado por cima de um cliente HTTP puro.
 * Cobre: GET da página -> captura do ViewState, POSTs completos e
 * POSTs AJAX parciais do PrimeFaces, e refresh do ViewState após cada resposta.
 */
export class JsfSession {
  constructor(
    private readonly http: HttpClient,
    private readonly baseUrl: string,
  ) {}

  private resolve(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    const base = this.baseUrl.replace(/\/+$/, '');
    return path.startsWith('/') ? base + path : base + '/' + path;
  }

  /** Parse a JSF page document into its form state. */
  parsePage(html: string, url: string): JsfPage {
    const $ = cheerio.load(html);
    const form = $('form').first();
    const formId = form.attr('id') ?? '';
    const hidden: Record<string, string> = {};
    form.find('input[type="hidden"]').each((_, el) => {
      const name = $(el).attr('name');
      const value = $(el).attr('value') ?? '';
      if (name) hidden[name] = value;
    });
    return {
      html,
      url,
      formId,
      actionUrl: this.resolve(form.attr('action') ?? url),
      viewState: hidden['javax.faces.ViewState'] ?? '',
      hidden,
    };
  }

  /** GET a JSF page (or its action URL) and capture its form state. */
  async open(path: string): Promise<JsfPage> {
    const url = this.resolve(path);
    const html = await this.http.getText(url);
    return this.parsePage(html, url);
  }

  /** Full (non-AJAX) POST with all form params merged over the hidden fields. */
  async fullPost(page: JsfPage, params: Record<string, string>): Promise<string> {
    const body: Record<string, string> = { ...page.hidden, ...params };
    return this.http.postForm(page.actionUrl, body);
  }

  /**
   * PrimeFaces partial AJAX POST with a complete request body (the adapters
   * build site-specific bodies, e.g. via `buildSearchPayload`). Hidden form
   * fields (ViewState, scroll state) are merged underneath, then the new
   * ViewState from the response is applied to `page`.
   */
  async postPartial(
    page: JsfPage,
    body: Record<string, string>,
  ): Promise<{ partial: PartialResponse; page: JsfPage }> {
    const merged: Record<string, string> = { ...page.hidden, ...body };
    const xml = await this.http.postForm(page.actionUrl, merged, {
      headers: { 'Faces-Request': 'partial/ajax', 'X-Requested-With': 'XMLHttpRequest' },
    });
    const partial = parsePartialResponse(xml);
    this.applyViewStateUpdate(page, partial);
    return { partial, page };
  }

  /**
   * Atualiza o ViewState da página a partir da resposta parcial.
   * O PrimeFaces manda o ViewState novo como texto puro (observado na OEFA)
   * ou dentro de um <input> oculto; os dois casos são tratados.
   */
  private applyViewStateUpdate(page: JsfPage, partial: PartialResponse): void {
    for (const [id, content] of partial.updates) {
      // Real-world ids: "javax.faces.ViewState" or "j_id1:javax.faces.ViewState:0".
      if (!id.includes('javax.faces.ViewState')) continue;
      let value = '';
      if (/<input/i.test(content)) {
        const $ = cheerio.load(content);
        value =
          $('input[name="javax.faces.ViewState"]').attr('value') ??
          $('input').first().attr('value') ??
          '';
      } else {
        value = content.trim();
      }
      if (value) {
        page.viewState = value;
        page.hidden['javax.faces.ViewState'] = value;
      }
    }
  }
}
