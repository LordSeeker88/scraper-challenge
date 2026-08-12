/**
 * Automated recon for the PJ jurisprudence portal.
 *
 * When run WITH a VPN to Peru (or through a local proxy via SCRAPER_PROXY),
 * this script performs the docs/SITE_RECON.md checklist in one shot:
 * reachability, form ids, hidden fields, AJAX wiring and datatable ids —
 * then compares everything against the HYPOTHESIS values in pj.ts.
 *
 * Usage: npm run recon-pj -- [--lang pt] [--term "expediente"]
 */
import * as cheerio from 'cheerio';
import { HttpClient } from '../src/core/http-client.js';
import { JsfSession } from '../src/core/jsf-client.js';
import { PjAdapter } from '../src/extractors/pj.js';
import { loadSettings } from '../src/config/settings.js';
import { Logger } from '../src/core/logger.js';
import { normalizeLang } from '../src/i18n/index.js';

const PJ_URL = 'https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/resultado.xhtml';
const EXPECTED: Record<string, string | undefined> = {
  formId: 'formResultado', // HYPOTHESIS — actual form id
  dataTableId: 'dtResultado', // HYPOTHESIS — actual datatable id
  resultsPanelId: 'pgLista', // HYPOTHESIS — AJAX render target
};

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const valueOf = (f: string) => {
    const i = args.indexOf(f);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const settings = loadSettings();
  const logger = new Logger(normalizeLang(valueOf('--lang') ?? settings.lang));
  const http = new HttpClient({ delayMs: 0, proxy: settings.proxy });

  logger.raw('=== PJ recon (precisa de VPN para o Peru) ===');
  try {
    const session = new JsfSession(http, 'https://jurisprudencia.pj.gob.pe');
    const page = await session.open('/jurisprudenciaweb/faces/page/resultado.xhtml');
    logger.raw(`[OK] GET ${PJ_URL}`);
    logger.raw(`[OK] formId real: "${page.formId}" (hipótese: "${EXPECTED.formId}") ${page.formId === EXPECTED.formId ? 'PASS' : 'CHECAR pj.ts'}`);
    logger.raw(`[OK] action: ${page.actionUrl}`);
    logger.raw(`[OK] ViewState presente: ${page.viewState ? 'sim (' + page.viewState.length + ' chars)' : 'NAO'}`);
    logger.raw(`[OK] hidden fields (${Object.keys(page.hidden).length}): ${Object.keys(page.hidden).slice(0, 12).join(', ')}`);

    const $ = cheerio.load(page.html);
    const ajax = $('[onclick*="PrimeFaces.ab"], [onclick*="mojarra.jsfcljs"]');
    logger.raw(`[OK] links/buttons AJAX: ${ajax.length}`);
    ajax.slice(0, 3).each((_, el) => {
      const onclick = $(el).attr('onclick') ?? '';
      const m = onclick.match(/PrimeFaces\.ab\(\{s:"([^"]+)"/);
      logger.raw(`  - ${m ? 'source: ' + m[1] : onclick.slice(0, 110)}`);
    });

    // Candidate ids present in the page (vs hypothesis).
    for (const [name, hyp] of Object.entries(EXPECTED)) {
      if (!hyp) continue;
      const found = page.html.includes(hyp);
      logger.raw(`[${found ? 'OK' : '--'}] id "${hyp}" (${name}) ${found ? 'encontrado' : 'NAO encontrado no HTML'}`);
    }

    // Optional live search probe to confirm AJAX + results panel.
    const term = valueOf('--term') ?? 'amparo';
    logger.raw(`--- probe de busca (termo: "${term}") ---`);
    const adapter = new PjAdapter();
    const body = adapter.buildSearchPayload(page.formId, { materia: term }, page.viewState);
    try {
      const { partial, page: after } = await session.postPartial(page, body);
      logger.raw(`[OK] update ids: ${[...partial.updates.keys()].join(' | ')}`);
      const panel = partial.updates.get(`${after.formId}:${adapter.resultsPanelId}`);
      const parsed = panel ? adapter.parseResults(panel) : undefined;
      logger.raw(`[OK] resultados: ${parsed ? parsed.documents.length + ' docs, total=' + (parsed.totalRecords ?? '?') : 'painel ausente'}`);
      logger.raw(`[OK] ViewState renovado: ${after.viewState.length > 0 ? 'sim' : 'nao'}`);
    } catch (err) {
      logger.raw(`[!!] probe de busca falhou: ${err instanceof Error ? err.message : String(err)}`);
    }

    logger.raw('=== fim do recon ===');
    return 0;
  } catch (err) {
    logger.raw(`[!!] NAO foi possivel acessar o PJ: ${err instanceof Error ? err.message : String(err)}`);
    logger.raw('     Causa provavel: sem VPN para o Peru (HTTP 403). Ative a VPN ou aponte');
    logger.raw('     SCRAPER_PROXY=http://127.0.0.1:<porta> e rode novamente.');
    return 1;
  }
}

const isDirectRun = process.argv[1] ? /recon-pj\.(ts|js)$/.test(process.argv[1].replace(/\\/g, '/')) : false;
if (isDirectRun) {
  main().then((code) => process.exit(code));
}
