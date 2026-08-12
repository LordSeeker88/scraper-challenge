import { createWriteStream } from 'node:fs';
import { existsSync, renameSync, rmSync } from 'node:fs';
import { open, stat, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { AxiosResponse } from 'axios';
import { HttpError, retryAfterMsFromHeader, type HttpClient } from '../core/http-client.js';

export interface PdfDownloadResult {
  path: string;
  bytes: number;
  skipped: boolean;
}

/** The response did not look like a PDF (content-type or magic bytes). */
export class PdfValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfValidationError';
  }
}

export interface PdfRequestOptions {
  /** Referer header (JSF apps often check session affinity). */
  referer?: string;
  /**
   * POST candidates replay a JSF/Mojarra form submission (see PdfCandidate);
   * `form` holds the command params merged over the live form fields.
   */
  method?: 'GET' | 'POST';
  form?: Record<string, string>;
}

const PDF_MAGIC = '%PDF-';

/**
 * Baixa um PDF reaproveitando o cookie jar da sessão. GET para URLs comuns,
 * POST (submissão de formulário) para links de comando JSF/Mojarra. Escreve
 * num arquivo temporário `.part`, valida os magic bytes `%PDF-` e só então
 * renomeia para o nome final. Arquivos que já existem são pulados, então
 * execuções interrompidas podem ser retomadas.
 */
export async function downloadPdf(
  http: HttpClient,
  url: string,
  destPath: string,
  opts: PdfRequestOptions = {},
): Promise<PdfDownloadResult> {
  if (existsSync(destPath)) {
    const st = await stat(destPath);
    return { path: destPath, bytes: st.size, skipped: true };
  }
  await mkdir(dirname(destPath), { recursive: true });

  const isPost = opts.method === 'POST';
  const config = http.jar.apply({
    method: isPost ? 'POST' : 'GET',
    url,
    responseType: 'stream',
    data: isPost ? new URLSearchParams(opts.form ?? {}).toString() : undefined,
    headers: {
      Accept: 'application/pdf,application/octet-stream,*/*',
      ...(isPost ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {}),
      ...(opts.referer ? { Referer: opts.referer } : {}),
    },
  });
  const res: AxiosResponse = await http.axios.request(config).catch((err) => {
    // Transient network errors (DNS, timeout, reset) deserve a backoff retry.
    throw new HttpError(err?.message ?? 'Network error while downloading PDF', { retryable: true });
  });

  if (res.status === 429 || res.status === 503 || (res.status === 403 && res.headers['retry-after'])) {
    throw new HttpError(`HTTP ${res.status} ${res.statusText}`, {
      status: res.status,
      statusText: res.statusText,
      retryAfter: retryAfterMsFromHeader(res.headers['retry-after'] as string | undefined),
    });
  }
  if (res.status !== 200) {
    (res.data as NodeJS.ReadableStream)?.resume?.();
    throw new HttpError(`HTTP ${res.status} ${res.statusText}`, { status: res.status });
  }

  const contentType = String(res.headers['content-type'] ?? '').toLowerCase();
  const tmp = `${destPath}.part`;
  try {
    await pipeline(res.data as NodeJS.ReadableStream, createWriteStream(tmp));
  } catch (err) {
    // Mid-stream failures (connection reset on large files) are transient:
    // clean up the temp file and let the retry layer back off and retry.
    rmSync(tmp, { force: true });
    throw new HttpError(
      `PDF stream failed: ${err instanceof Error ? err.message : String(err)}`,
      { retryable: true },
    );
  }

  // Lê os primeiros bytes e confere o magic "PDF" antes de renomear.
  const buf = Buffer.alloc(PDF_MAGIC.length);
  const fh = await open(tmp, 'r');
  try {
    await fh.read(buf, 0, PDF_MAGIC.length, 0);
  } finally {
    await fh.close();
  }
  if (buf.toString('latin1') !== PDF_MAGIC) {
    rmSync(tmp, { force: true });
    throw new PdfValidationError(`Not a PDF (magic bytes mismatch); content-type: ${contentType || 'unknown'}`);
  }

  renameSync(tmp, destPath);
  const st = await stat(destPath);
  return { path: destPath, bytes: st.size, skipped: false };
}
