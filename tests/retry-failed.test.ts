import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpError } from '../src/core/http-client.js';

vi.mock('../src/pdf/downloader.js', () => ({
  downloadPdf: vi.fn(),
}));
import { downloadPdf } from '../src/pdf/downloader.js';
const mockDownload = vi.mocked(downloadPdf);

import { retryFailedPdfs } from '../src/retry-failed.js';

beforeEach(() => {
  mockDownload.mockReset();
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'scraper-retry-'));
  const dataDir = join(dir, 'data');
  const siteDir = join(dataDir, 'oefa');
  mkdirSync(siteDir, { recursive: true });
  writeFileSync(
    join(siteDir, 'failed.jsonl'),
    [
      JSON.stringify({ docId: 'A_0', url: 'https://x.example/a.pdf', name: 'a.pdf', error: '429', attempts: 5, failedAt: 't1' }),
      JSON.stringify({ docId: 'B_0', url: '', method: 'POST', name: 'b.pdf', error: 'no', attempts: 5, failedAt: 't2' }),
    ].join('\n') + '\n',
    'utf8',
  );
  return { dir, dataDir, siteDir };
}

describe('retryFailedPdfs', () => {
  it('retries GET failures, skips session-based POST entries, and rewrites the failures file', async () => {
    const { dir, dataDir, siteDir } = setup();
    mockDownload.mockRejectedValue(new HttpError('HTTP 429', { status: 429 }));

    await retryFailedPdfs({
      siteId: 'oefa',
      lang: 'en',
      dataDir,
      maxAttempts: 2,
      delayMs: 0,
    });

    // Only the GET entry was attempted (twice: 1 attempt + 1 retry with
    // maxAttempts=2); the session-based POST entry was skipped entirely.
    expect(mockDownload).toHaveBeenCalledTimes(2);
    for (const call of mockDownload.mock.calls) {
      const url = call[1] as string;
      expect(url).toBe('https://x.example/a.pdf');
    }

    // The still-failing GET entry remains in failed.jsonl.
    const remaining = readFileSync(join(siteDir, 'failed.jsonl'), 'utf8').trim().split('\n');
    expect(remaining).toHaveLength(1);
    expect(JSON.parse(remaining[0]).docId).toBe('A_0');
    rmSync(dir, { recursive: true, force: true });
  });

  it('removes entries that succeed on retry', async () => {
    const { dir, dataDir, siteDir } = setup();
    mockDownload.mockResolvedValue({ path: 'x', bytes: 10, skipped: false });

    await retryFailedPdfs({ siteId: 'oefa', lang: 'en', dataDir, maxAttempts: 2, delayMs: 0 });

    const remaining = readFileSync(join(siteDir, 'failed.jsonl'), 'utf8').trim();
    expect(remaining).toBe(''); // nothing left to retry
    rmSync(dir, { recursive: true, force: true });
  });
});
