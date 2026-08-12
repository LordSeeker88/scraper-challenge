import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { CookieJar } from './cookie-jar.js';

export interface HttpErrorOptions {
  status?: number;
  statusText?: string;
  retryAfter?: number; // ms
  body?: string;
  /** True for transient network errors (DNS/timeout/reset) that deserve a retry. */
  retryable?: boolean;
}

/** Typed HTTP error carrying rate-limit metadata (status, Retry-After). */
export class HttpError extends Error {
  readonly status?: number;
  readonly statusText?: string;
  readonly retryAfter?: number;
  readonly body?: string;
  readonly retryable: boolean;

  constructor(message: string, opts: HttpErrorOptions = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = opts.status;
    this.statusText = opts.statusText;
    this.retryAfter = opts.retryAfter;
    this.body = opts.body;
    this.retryable = opts.retryable ?? false;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse a `Retry-After` header (seconds or HTTP-date) into milliseconds. */
const HTTP_DATE = /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

export function retryAfterMsFromHeader(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  if (HTTP_DATE.test(trimmed)) {
    const date = Date.parse(trimmed);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return undefined;
}

export interface HttpClientOptions {
  userAgent?: string;
  timeoutMs?: number;
  proxy?: string; // e.g. "http://127.0.0.1:3128"
  delayMs?: number;
}

function parseProxy(proxy: string): { protocol: string; host: string; port: number } {
  try {
    const u = new URL(proxy);
    const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
    return { protocol: u.protocol, host: u.hostname, port };
  } catch {
    throw new Error(`Invalid SCRAPER_PROXY: ${proxy}`);
  }
}

/**
 * Wrapper do axios: cookie jar próprio, UA realista, atraso de polidez e erros tipados.
 * `validateStatus: () => true` deixa a gente inspecionar cada status manualmente.
 */
export class HttpClient {
  readonly jar = new CookieJar();
  readonly axios: AxiosInstance;
  readonly delayMs: number;

  constructor(opts: HttpClientOptions = {}) {
    this.delayMs = opts.delayMs ?? 0;
    this.axios = axios.create({
      timeout: opts.timeoutMs ?? 60_000,
      maxRedirects: 5,
      headers: {
        'User-Agent':
          opts.userAgent ??
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      },
      ...(opts.proxy ? { proxy: parseProxy(opts.proxy) } : {}),
      validateStatus: () => true,
    });
    this.axios.interceptors.response.use((res) => {
      this.jar.capture(res);
      return res;
    });
  }

  /** Politeness delay before the next request. */
  async waitDelay(): Promise<void> {
    if (this.delayMs > 0) await sleep(this.delayMs);
  }

  /** Converte a resposta em HttpError tipado; guarda o Retry-After (em ms) para o retry. */
  private toError(res: AxiosResponse | undefined, message: string): HttpError {
    if (!res) return new HttpError(message);
    return new HttpError(`HTTP ${res.status} ${res.statusText}`, {
      status: res.status,
      statusText: res.statusText,
      retryAfter: retryAfterMsFromHeader(res.headers['retry-after'] as string | undefined),
      body: typeof res.data === 'string' ? res.data.slice(0, 2000) : undefined,
    });
  }

  async request(config: AxiosRequestConfig): Promise<AxiosResponse> {
    this.jar.apply(config);
    let res: AxiosResponse;
    try {
      res = await this.axios.request(config);
    } catch (err) {
      const ax = err as AxiosError;
      if (ax.response) throw this.toError(ax.response, `HTTP ${ax.response.status} ${ax.response.statusText}`);
      // Transient network errors (DNS, timeout, reset) deserve a backoff retry.
      throw new HttpError(ax.message ?? 'Network error', { retryable: true });
    }
    if (res.status >= 400) {
      throw this.toError(res, `HTTP ${res.status} ${res.statusText}`);
    }
    return res;
  }

  async getText(url: string, extra?: AxiosRequestConfig): Promise<string> {
    const res = await this.request({ method: 'GET', url, ...extra, responseType: 'text' });
    return String(res.data);
  }

  async postForm(
    url: string,
    params: Record<string, string>,
    extra?: AxiosRequestConfig,
  ): Promise<string> {
    const body = new URLSearchParams(params).toString();
    const res = await this.request({
      method: 'POST',
      url,
      data: body,
      ...extra,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        ...(extra?.headers ?? {}),
      },
    });
    return String(res.data);
  }
}
