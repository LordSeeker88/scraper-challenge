import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Persistent run state: last completed page + total docs, for --resume. */
export interface Checkpoint {
  site: string;
  lastFirst: number;
  rows: number;
  totalDocs: number;
  /** Identity of the last completed page's documents (anti-duplicate on resume). */
  lastPageKey?: string;
  updatedAt: string;
}

/** A PDF that failed after all retries; re-run with `retry-failed`. */
export interface FailedPdf {
  docId: string;
  url: string;
  method?: 'GET' | 'POST';
  name?: string;
  error: string;
  attempts: number;
  failedAt: string;
}

export async function writeCheckpoint(path: string, cp: Checkpoint): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(cp, null, 2), 'utf8');
}

export async function readCheckpoint(path: string): Promise<Checkpoint | null> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as Checkpoint;
  } catch {
    return null;
  }
}
