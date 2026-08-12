import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runScrape, pickResultsHtml, syncHidden, JsfStructureError } from '../src/scraper.js';
import { HttpError } from '../src/core/http-client.js';
import type { SiteAdapter, ParsedPage, DocumentRecord, PdfCandidate, SearchQuery } from '../src/extractors/types.js';
import type { PageToken } from '../src/core/paginator.js';
import { Logger } from '../src/core/logger.js';

vi.mock('../src/pdf/downloader.js', () => ({
  downloadPdf: vi.fn(),
}));
import { downloadPdf } from '../src/pdf/downloader.js';
const mockDownload = vi.mocked(downloadPdf);

// --- fakes ---------------------------------------------------------------

const PAGE1_HTML =
  '<span id="f:pgLista"><div id="f:dt"><tbody id="f:dt_data">' +
  '<tr class="ui-widget-content"><td>1</td><td>EXP-1</td><td><a href="/pdf/1.pdf">PDF</a></td></tr>' +
  '<tr class="ui-widget-content"><td>2</td><td>EXP-2</td><td><a href="/pdf/2.pdf">PDF</a></td></tr>' +
  '</tbody></div><span class="ui-paginator-current">Página 1 de 2 (12 registros)</span></span>';

const PAGE2_HTML =
  '<span id="f:pgLista"><div id="f:dt"><tbody id="f:dt_data">' +
  '<tr class="ui-widget-content"><td>3</td><td>EXP-3</td><td><a href="/pdf/3.pdf">PDF</a></td></tr>' +
  '</tbody></div><span class="ui-paginator-current">Página 2 de 2 (12 registros)</span></span>';

function xmlWith(panelHtml: string): string {
  return (
    "<?xml version='1.0'?><partial-response><changes>" +
    `<update id="f:pgLista"><![CDATA[${panelHtml}]]></update>` +
    '<update id="j_id1:javax.faces.ViewState:0"><![CDATA[VS_NEXT]]></update>' +
    '</changes></partial-response>'
  );
}

class FakeHttp {
  jar = { apply: (c: any) => c, capture: () => {}, get: () => undefined };
  axios: any = { request: vi.fn() };
  delayMs = 0;
  getText = vi.fn(async () => '<form id="f" action="/search.xhtml"><input type="hidden" name="javax.faces.ViewState" value="VS1"/></form>');
  postForm = vi.fn(async () => xmlWith(PAGE1_HTML));
  waitDelay = vi.fn(async () => {});
}

class MockSite implements SiteAdapter {
  id = 'mock';
  baseUrl = 'https://mock.example';
  searchPagePath = '/search.xhtml';
  dataTableId = 'dt';
  resultsPanelId = 'pgLista';
  requiresVpn = false;

  buildSearchPayload(formId: string, q: SearchQuery, viewState: string): Record<string, string> {
    return { search: '1' };
  }
  buildPaginationPayload(formId: string, token: PageToken, viewState: string): Record<string, string> {
    return { paginate: String(token.first) };
  }
  searchFormValues(formId: string, q: SearchQuery): Record<string, string> {
    return { field: q.expediente ?? '' };
  }
  parseResults = vi.fn((html: string): ParsedPage => {
    if (html.includes('Página 1 de 2')) {
      return {
        documents: makeDocs(2, 'EXP-'),
        nextToken: { first: 10, rows: 10 },
        totalRecords: 12,
      };
    }
    return { documents: makeDocs(1, 'EXP-'), totalRecords: 12 };
  });
  extractPdfUrls = vi.fn(async (doc: DocumentRecord): Promise<PdfCandidate[]> => []);
}

function makeDocs(n: number, prefix: string): DocumentRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i + 1}`,
    source: 'oefa' as const,
    expediente: `${prefix}${i + 1}`,
    raw: {},
    rowHtml: '<tr></tr>',
    pdfs: [{ url: `/pdf/${i + 1}.pdf` }],
    crawledAt: new Date().toISOString(),
  }));
}

function makeOptions(overrides: Partial<Parameters<typeof runScrape>[0]> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'scraper-run-'));
  const base: Parameters<typeof runScrape>[0] = {
    site: new MockSite(),
    http: new FakeHttp() as any,
    logger: new Logger('en'),
    query: {},
    pdfs: true,
    pdfsDir: join(dir, 'pdfs'),
    resultsPath: join(dir, 'results.jsonl'),
    checkpointPath: join(dir, 'checkpoint.json'),
    failedPath: join(dir, 'failed.jsonl'),
    resume: false,
    maxAttempts: 2,
    retryInitialDelayMs: 1,
    retryMaxDelayMs: 4,
    referer: 'https://mock.example/search.xhtml',
    ...overrides,
  };
  return { base, dir };
}

beforeEach(() => {
  mockDownload.mockReset();
  mockDownload.mockResolvedValue({ path: 'x', bytes: 10, skipped: false });
});

describe('runScrape pipeline', () => {
  it('searches, paginates and persists every document', async () => {
    const { base, dir } = makeOptions();
    const http = base.http as any;
    http.postForm
      .mockResolvedValueOnce(xmlWith(PAGE1_HTML))
      .mockResolvedValueOnce(xmlWith(PAGE2_HTML));

    const stats = await runScrape(base);
    expect(stats.docs).toBe(3);
    expect(stats.pdfsOk).toBe(3);

    // 1 search POST + 1 pagination POST.
    expect(http.postForm).toHaveBeenCalledTimes(2);
    const searchBody = http.postForm.mock.calls[0][1];
    expect(searchBody).toMatchObject({ search: '1', 'javax.faces.ViewState': 'VS1' });
    const pageBody = http.postForm.mock.calls[1][1];
    expect(pageBody).toMatchObject({ paginate: '10' });
    const searchHeaders = http.postForm.mock.calls[0][2];
    expect(searchHeaders.headers['Faces-Request']).toBe('partial/ajax');

    // Results persisted as JSONL.
    const lines = readFileSync(join(dir, 'results.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(3);

    // Final checkpoint reflects the last completed page.
    const cp = JSON.parse(readFileSync(join(dir, 'checkpoint.json'), 'utf8'));
    expect(cp.lastFirst).toBe(10);
    expect(cp.totalDocs).toBe(3);
    rmSync(dir, { recursive: true, force: true });
  });

  it('stops at --limit and downloads only the limited PDFs', async () => {
    const { base, dir } = makeOptions({ limit: 1 });
    const stats = await runScrape(base);
    expect(stats.docs).toBe(1);
    expect(mockDownload).toHaveBeenCalledTimes(1);
    const [, url] = mockDownload.mock.calls[0] as [any, string];
    expect(url).toBe('https://mock.example/pdf/1.pdf');
    expect(readFileSync(join(dir, 'results.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps going when a PDF fails with 429, recording it in failed.jsonl', async () => {
    mockDownload.mockRejectedValue(new HttpError('HTTP 429 Too Many Requests', { status: 429 }));
    const { base, dir } = makeOptions({ maxAttempts: 2 });
    const http = base.http as any;
    http.postForm
      .mockResolvedValueOnce(xmlWith(PAGE1_HTML))
      .mockResolvedValueOnce(xmlWith(PAGE2_HTML));

    const stats = await runScrape(base);
    expect(stats.pdfsFailed).toBe(3);
    expect(stats.pdfsOk).toBe(0);
    const failed = readFileSync(join(dir, 'failed.jsonl'), 'utf8').trim().split('\n');
    expect(failed).toHaveLength(3);
    const first = JSON.parse(failed[0]);
    expect(first.url).toContain('/pdf/1.pdf');
    expect(first.attempts).toBe(2);
    rmSync(dir, { recursive: true, force: true });
  });

  it('supports metadata-only mode (--no-pdfs)', async () => {
    const { base, dir } = makeOptions({ pdfs: false });
    const http = base.http as any;
    http.postForm
      .mockResolvedValueOnce(xmlWith(PAGE1_HTML))
      .mockResolvedValueOnce(xmlWith(PAGE2_HTML));

    const stats = await runScrape(base);
    expect(stats.docs).toBe(3);
    expect(mockDownload).not.toHaveBeenCalled();
    expect(existsSync(join(dir, 'pdfs'))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('resumes from a checkpoint without re-running the search', async () => {
    const { base, dir } = makeOptions({ resume: true });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      join(dir, 'checkpoint.json'),
      JSON.stringify({ site: 'mock', lastFirst: 10, rows: 10, totalDocs: 3, updatedAt: 'now' }),
    );
    const http = base.http as any;
    http.postForm.mockReset();
    http.postForm.mockResolvedValue(xmlWith(PAGE2_HTML));

    const stats = await runScrape(base);
    // Only the pagination POST at first=20 (10 + 10) happens; no search POST.
    expect(http.postForm).toHaveBeenCalledTimes(1);
    const body = http.postForm.mock.calls[0][1];
    expect(body).toMatchObject({ paginate: '20' });
    expect(stats.docs).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws JsfStructureError when the AJAX response lacks the results block', async () => {
    const { base, dir } = makeOptions();
    const http = base.http as any;
    http.postForm.mockReset();
    http.postForm.mockResolvedValue(
      "<?xml version='1.0'?><partial-response><changes><update id=\"other\"><![CDATA[x]]></update></changes></partial-response>",
    );
    await expect(runScrape(base)).rejects.toBeInstanceOf(JsfStructureError);
    rmSync(dir, { recursive: true, force: true });
  });

  it('recovers from an expired JSF session by reopening the page once', async () => {
    const { base, dir } = makeOptions({ limit: 2, pdfs: false });
    const http = base.http as any;
    // First search POST returns a partial response WITHOUT the results block
    // (expired session); the retried search returns a valid page.
    http.postForm
      .mockResolvedValueOnce(
        "<?xml version='1.0'?><partial-response><changes><update id=\"other\"><![CDATA[x]]></update></changes></partial-response>",
      )
      .mockResolvedValueOnce(xmlWith(PAGE1_HTML));
    // The reopened page issues a FRESH ViewState.
    http.getText
      .mockResolvedValueOnce('<form id="f" action="/search.xhtml"><input type="hidden" name="javax.faces.ViewState" value="VS1"/></form>')
      .mockResolvedValueOnce('<form id="f" action="/search.xhtml"><input type="hidden" name="javax.faces.ViewState" value="VS_FRESH"/></form>');
    const site = base.site as MockSite;
    site.parseResults.mockReturnValue({ documents: makeDocs(2, 'REC-') });

    const stats = await runScrape(base);
    expect(stats.docs).toBe(2);
    // Reopened the page (2nd GET) and retried the search (2nd POST).
    expect(http.getText).toHaveBeenCalledTimes(2);
    expect(http.postForm).toHaveBeenCalledTimes(2);
    // The retried search used the FRESH ViewState.
    const bodies = http.postForm.mock.calls.map((c: any[]) => c[1]);
    expect(bodies[1]['javax.faces.ViewState']).toBe('VS_FRESH');
    rmSync(dir, { recursive: true, force: true });
  });

  it('stops instead of looping when pagination has no effect (server returns page 1 again)', async () => {
    const { base, dir } = makeOptions({ pdfs: false });
    const http = base.http as any;
    // Search and every pagination POST return the SAME first page.
    http.postForm.mockResolvedValue(xmlWith(PAGE1_HTML));
    const site = base.site as MockSite;
    site.parseResults.mockImplementation(() => ({
      documents: makeDocs(2, 'STUCK-'),
      nextToken: { first: 10, rows: 10 }, // claims there is a next page...
      totalRecords: 12,
    }));

    const stats = await runScrape(base);
    // Search + one pagination attempt, then the guard stops the loop.
    expect(http.postForm).toHaveBeenCalledTimes(2);
    expect(stats.docs).toBe(2);
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not duplicate documents when a resumed run receives the same page again', async () => {
    const { base, dir } = makeOptions({ resume: true, pdfs: false });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      join(dir, 'checkpoint.json'),
      JSON.stringify({
        site: 'mock',
        lastFirst: 0,
        rows: 10,
        totalDocs: 2,
        lastPageKey: 'STUCK-1|STUCK-2',
        updatedAt: 'now',
      }),
    );
    const http = base.http as any;
    http.postForm.mockReset();
    http.postForm.mockResolvedValue(xmlWith(PAGE1_HTML));
    const site = base.site as MockSite;
    site.parseResults.mockImplementation(() => ({
      documents: makeDocs(2, 'STUCK-'),
      nextToken: { first: 10, rows: 10 },
      totalRecords: 12,
    }));

    const stats = await runScrape(base);
    // Only the resumed pagination fetch happens; the guard stops it before
    // any document is re-written.
    expect(http.postForm).toHaveBeenCalledTimes(1);
    expect(stats.docs).toBe(0);
    expect(existsSync(join(dir, 'results.jsonl'))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('a fresh run starts from clean output (no duplicates across runs)', async () => {
    const { base, dir } = makeOptions({ pdfs: false });
    const http = base.http as any;
    http.postForm
      .mockResolvedValueOnce(xmlWith(PAGE1_HTML))
      .mockResolvedValueOnce(xmlWith(PAGE2_HTML));
    const first = await runScrape(base);
    expect(first.docs).toBe(3);

    // Second FRESH run with the same paths must not append duplicates.
    http.postForm.mockReset();
    http.postForm
      .mockResolvedValueOnce(xmlWith(PAGE1_HTML))
      .mockResolvedValueOnce(xmlWith(PAGE2_HTML));
    const second = await runScrape(base);
    expect(second.docs).toBe(3);
    const lines = readFileSync(join(dir, 'results.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(3); // not 6
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('pickResultsHtml / syncHidden', () => {
  it('prefers the results panel update', () => {
    const updates = new Map([
      ['f:pgLista', '<div>panel</div>'],
      ['f:dt', '<div>dt</div>'],
    ]);
    const html = pickResultsHtml({ updates }, { formId: 'f' } as any, new MockSite());
    expect(html).toBe('<div>panel</div>');
  });

  it('falls back to the datatable update', () => {
    const updates = new Map([['f:dt', '<div>dt</div>']]);
    const html = pickResultsHtml({ updates }, { formId: 'f' } as any, new MockSite());
    expect(html).toBe('<div>dt</div>');
  });

  it('syncHidden refreshes hidden inputs (scroll state) from returned HTML', () => {
    const page = {
      formId: 'f',
      hidden: { 'f:dt_scrollState': '0,0', 'javax.faces.ViewState': 'OLD' },
      viewState: 'OLD',
    } as any;
    syncHidden(page, '<span><input type="hidden" name="f:dt_scrollState" value="0,10"/></span>');
    expect(page.hidden['f:dt_scrollState']).toBe('0,10');
    expect(page.hidden['javax.faces.ViewState']).toBe('OLD');
  });
});
