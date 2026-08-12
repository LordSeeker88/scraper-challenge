import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpClient, HttpError } from '../src/core/http-client.js';
import { downloadPdf, PdfValidationError } from '../src/pdf/downloader.js';

function mockResponse(status: number, headers: Record<string, string>, body?: Buffer) {
  return {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers,
    data: Readable.from(body ?? Buffer.from('')),
    config: {},
  } as any;
}

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'scraper-dl-'));
}

describe('downloadPdf', () => {
  it('downloads, verifies %PDF magic bytes and writes the file', async () => {
    const http = new HttpClient();
    vi.spyOn(http.axios, 'request').mockResolvedValue(
      mockResponse(200, { 'content-type': 'application/pdf' }, Buffer.from('%PDF-1.7\n%fake pdf content')),
    );
    const dir = freshDir();
    const dest = join(dir, 'doc.pdf');
    const result = await downloadPdf(http, 'https://x.example/file.pdf', dest, 'https://x.example/');

    expect(result.skipped).toBe(false);
    expect(result.bytes).toBeGreaterThan(0);
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('skips already-downloaded files (resume)', async () => {
    const dir = freshDir();
    const dest = join(dir, 'doc.pdf');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(dest, '%PDF-1.7 existing');
    const http = new HttpClient();
    const request = vi.spyOn(http.axios, 'request');
    const result = await downloadPdf(http, 'https://x.example/file.pdf', dest);
    expect(result.skipped).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it('throws HttpError(429) so the retry layer can back off', async () => {
    const http = new HttpClient();
    vi.spyOn(http.axios, 'request').mockResolvedValue(
      mockResponse(429, { 'content-type': 'text/html' }),
    );
    const dest = join(freshDir(), 'doc.pdf');
    await expect(downloadPdf(http, 'https://x.example/file.pdf', dest)).rejects.toMatchObject({
      name: 'HttpError',
      status: 429,
    });
  });

  it('supports POST (JSF/Mojarra) downloads with form data', async () => {
    const http = new HttpClient();
    const request = vi.spyOn(http.axios, 'request').mockResolvedValue(
      mockResponse(200, { 'content-type': 'application/pdf' }, Buffer.from('%PDF-1.7\npost pdf')),
    );
    const dest = join(freshDir(), 'doc.pdf');
    const result = await downloadPdf(http, 'https://x.example/form.xhtml', dest, {
      method: 'POST',
      form: { 'javax.faces.ViewState': 'VS', 'form:btn': 'form:btn' },
      referer: 'https://x.example/',
    });
    expect(result.skipped).toBe(false);
    const config = request.mock.calls[0][0] as any;
    expect(config.method).toBe('POST');
    expect(config.data).toContain('javax.faces.ViewState=VS');
    expect(config.data).toContain('form%3Abtn=form%3Abtn');
    expect(config.headers['Content-Type']).toBe('application/x-www-form-urlencoded; charset=UTF-8');
  });

  it('throws PdfValidationError when the body is not a PDF', async () => {
    const http = new HttpClient();
    vi.spyOn(http.axios, 'request').mockResolvedValue(
      mockResponse(200, { 'content-type': 'text/html' }, Buffer.from('<html>error page</html>')),
    );
    const dest = join(freshDir(), 'doc.pdf');
    await expect(downloadPdf(http, 'https://x.example/file.pdf', dest)).rejects.toBeInstanceOf(
      PdfValidationError,
    );
  });

  it('throws HttpError on non-200 statuses', async () => {
    const http = new HttpClient();
    vi.spyOn(http.axios, 'request').mockResolvedValue(mockResponse(404, {}));
    const dest = join(freshDir(), 'doc.pdf');
    await expect(downloadPdf(http, 'https://x.example/file.pdf', dest)).rejects.toMatchObject({
      name: 'HttpError',
      status: 404,
    });
  });

  it('cleans up and marks mid-stream failures as retryable', async () => {
    const http = new HttpClient();
    const failing = new Readable({
      read() {
        this.destroy(new Error('ECONNRESET'));
      },
    });
    const res = mockResponse(200, { 'content-type': 'application/pdf' }, Buffer.from('%PDF-1.7'));
    res.data = failing;
    vi.spyOn(http.axios, 'request').mockResolvedValue(res);
    const dir = freshDir();
    const dest = join(dir, 'doc.pdf');
    await expect(downloadPdf(http, 'https://x.example/file.pdf', dest)).rejects.toMatchObject({
      name: 'HttpError',
      retryable: true,
    });
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(dest + '.part')).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('cleans up the .part temp file when validation fails', async () => {
    const http = new HttpClient();
    vi.spyOn(http.axios, 'request').mockResolvedValue(
      mockResponse(200, { 'content-type': 'application/pdf' }, Buffer.from('not a pdf at all')),
    );
    const dir = freshDir();
    const dest = join(dir, 'doc.pdf');
    await expect(downloadPdf(http, 'https://x.example/file.pdf', dest)).rejects.toBeInstanceOf(
      PdfValidationError,
    );
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(dest + '.part')).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
