import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendJsonl, readJsonl, truncateFile } from '../src/storage/json-writer.js';
import { writeCheckpoint, readCheckpoint } from '../src/storage/checkpoint.js';

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'scraper-store-'));
}

describe('storage', () => {
  it('appends JSONL records and reads them back', async () => {
    const dir = freshDir();
    const path = join(dir, 'results.jsonl');
    await appendJsonl(path, { id: 'a', n: 1 });
    await appendJsonl(path, { id: 'b', n: 2 });
    const rows = await readJsonl<{ id: string; n: number }>(path);
    expect(rows).toEqual([
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
    ]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips checkpoints', async () => {
    const dir = freshDir();
    const path = join(dir, 'checkpoint.json');
    await writeCheckpoint(path, { site: 'oefa', lastFirst: 10, rows: 10, totalDocs: 12, updatedAt: 'now' });
    const cp = await readCheckpoint(path);
    expect(cp).toEqual({ site: 'oefa', lastFirst: 10, rows: 10, totalDocs: 12, updatedAt: 'now' });
    expect(readFileSync(path, 'utf8')).toContain('"site": "oefa"');
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null for a missing checkpoint and [] for a missing JSONL', async () => {
    const dir = freshDir();
    expect(await readCheckpoint(join(dir, 'nope.json'))).toBeNull();
    expect(await readJsonl(join(dir, 'nope.jsonl'))).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('truncateFile creates or empties a file (fresh-run semantics)', async () => {
    const dir = freshDir();
    const path = join(dir, 'results.jsonl');
    await appendJsonl(path, { a: 1 });
    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(1);
    await truncateFile(path);
    expect(readFileSync(path, 'utf8')).toBe('');
    // Also creates parent dirs on first use.
    const nested = join(dir, 'a', 'b', 'results.jsonl');
    await truncateFile(nested);
    expect(readFileSync(nested, 'utf8')).toBe('');
    rmSync(dir, { recursive: true, force: true });
  });
});
