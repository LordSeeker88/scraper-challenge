import { HttpError, sleep } from './http-client.js';

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  jitter?: number;
  onRetry?: (info: { attempt: number; maxAttempts: number; delayMs: number; error: unknown }) => void;
}

/** Thrown when a retryable request never succeeds within maxAttempts. */
export class RetryExhaustedError extends Error {
  readonly attempts: number;
  readonly lastError: unknown;

  constructor(attempts: number, lastError: unknown) {
    super(`Request failed after ${attempts} attempts: ${String(lastError)}`);
    this.name = 'RetryExhaustedError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

/** True for statuses that warrant a retry: 429, 503, 403 with Retry-After,
 * and transient network errors. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) {
    if (err.retryable) return true;
    if (err.status === 429) return true;
    if (err.status === 503) return true;
    if (err.status === 403 && err.retryAfter !== undefined) return true;
    return false;
  }
  return false;
}

export function retryAfterMs(err: unknown): number | undefined {
  return err instanceof HttpError ? err.retryAfter : undefined;
}

/**
 * Executa `fn` com backoff exponencial em erros reintentáveis:
 * delay(n) = min(initialDelayMs * 2^(n-1), maxDelayMs), com jitter,
 * a menos que o servidor envie Retry-After (que tem prioridade).
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const initialDelayMs = opts.initialDelayMs ?? 1000;
  const maxDelayMs = opts.maxDelayMs ?? 30_000;
  const jitter = opts.jitter ?? 0.25;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt >= maxAttempts || !isRetryable(err)) {
        throw new RetryExhaustedError(attempt, err);
      }
      const base = Math.min(initialDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const jittered = Math.round(base * (1 - jitter + Math.random() * jitter * 2));
      const delayMs = retryAfterMs(err) ?? jittered;
      opts.onRetry?.({ attempt, maxAttempts, delayMs, error: err });
      await sleep(delayMs);
    }
  }
}
