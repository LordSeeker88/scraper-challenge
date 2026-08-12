import { describe, expect, it } from 'vitest';
import { csvEscape, recordsToCsv, exportCsv } from '../src/export-csv.js';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DocumentRecord } from '../src/extractors/types.js';

function doc(over: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: 'EXP-1_0',
    source: 'oefa',
    expediente: 'EXP-1',
    title: 'Company, Inc.',
    raw: {
      'Número de expediente': 'EXP-1',
      Administrado: 'Company, "Inc."',
    },
    pdfs: [{ url: 'https://x.example/a.pdf' }],
    crawledAt: '2026-01-01T00:00:00.000Z',
    rowHtml: '<tr><td>x</td></tr>',
    ...over,
  };
}

describe('csvEscape', () => {
  it('quotes fields with commas, quotes or newlines (RFC 4180)', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });
});

describe('recordsToCsv', () => {
  it('emits a header with raw columns and escaped rows', () => {
    const csv = recordsToCsv([doc()]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toContain('id,source,expediente,title,organo,crawledAt,');
    expect(lines[0]).toContain('Administrado');
    // Title contains a comma -> quoted; raw field contains a quote -> doubled.
    expect(lines[1]).toContain('"Company, Inc."');
    expect(lines[1]).toContain('"Company, ""Inc."""');
    expect(lines[1]).toContain('https://x.example/a.pdf');
  });
});

describe('exportCsv', () => {
  it('converts results.jsonl into results.csv', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'csv-'));
    const jsonl = join(dir, 'results.jsonl');
    writeFileSync(jsonl, JSON.stringify(doc()) + '\n', 'utf8');
    const out = join(dir, 'results.csv');
    const { rows } = await exportCsv(jsonl, out);
    expect(rows).toBe(1);
    const csv = readFileSync(out, 'utf8');
    expect(csv.split('\n')[0]).toContain('expediente');
    expect(csv).toContain('EXP-1');
    rmSync(dir, { recursive: true, force: true });
  });
});
