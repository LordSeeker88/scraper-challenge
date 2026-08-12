import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../src/core/http-client.js';
import { withRetry, isRetryable, RetryExhaustedError } from '../src/core/retry.js';

const fast = { initialDelayMs: 1, maxDelayMs: 4, jitter: 0, maxAttempts: 5 };

describe('retry', () => {
  it('succeeds on the first attempt without retrying', async () => {
    const fn = vi.fn(async () => 'ok');
    const result = await withRetry(fn, fast);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 and eventually succeeds', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new HttpError('HTTP 429 Too Many Requests', { status: 429 }))
      .mockRejectedValueOnce(new HttpError('HTTP 429 Too Many Requests', { status: 429 }))
      .mockResolvedValueOnce('ok');
    const delays: number[] = [];
    const result = await withRetry(fn, { ...fast, onRetry: (i) => delays.push(i.delayMs) });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([1, 2]); // exponential: 1, 2
  });

  it('respects Retry-After over the backoff', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new HttpError('HTTP 429', { status: 429, retryAfter: 500 }))
      .mockResolvedValueOnce('ok');
    const delays: number[] = [];
    await withRetry(fn, { ...fast, onRetry: (i) => delays.push(i.delayMs) });
    expect(delays).toEqual([500]);
  });

  it('throws RetryExhaustedError after maxAttempts, reporting attempt count', async () => {
    const fn = vi.fn(async () => {
      throw new HttpError('HTTP 429', { status: 429 });
    });
    await expect(withRetry(fn, { ...fast, maxAttempts: 4 })).rejects.toMatchObject({
      name: 'RetryExhaustedError',
      attempts: 4,
    });
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('never lets the backoff exceed the cap', async () => {
    const fn = vi.fn(async () => {
      throw new HttpError('HTTP 429', { status: 429 });
    });
    const delays: number[] = [];
    await withRetry(fn, { initialDelayMs: 10, maxDelayMs: 25, jitter: 0, maxAttempts: 5, onRetry: (i) => delays.push(i.delayMs) }).catch(() => {});
    expect(delays).toEqual([10, 20, 25, 25]);
  });

  it('does not retry non-retryable errors (e.g. 404)', async () => {
    const fn = vi.fn(async () => {
      throw new HttpError('HTTP 404 Not Found', { status: 404 });
    });
    await expect(withRetry(fn, fast)).rejects.toBeInstanceOf(RetryExhaustedError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('classifies 429, 503 and 403+Retry-After as retryable', () => {
    expect(isRetryable(new HttpError('x', { status: 429 }))).toBe(true);
    expect(isRetryable(new HttpError('x', { status: 503 }))).toBe(true);
    expect(isRetryable(new HttpError('x', { status: 403, retryAfter: 100 }))).toBe(true);
    expect(isRetryable(new HttpError('x', { status: 403 }))).toBe(false);
    expect(isRetryable(new Error('boom'))).toBe(false);
  });

  it('retries transient network errors (retryable flag)', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new HttpError('getaddrinfo ENOTFOUND', { retryable: true }))
      .mockResolvedValueOnce('ok');
    const result = await withRetry(fn, { ...fast, maxAttempts: 3 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('still gives up on a persistent network error after maxAttempts', async () => {
    const fn = vi.fn(async () => {
      throw new HttpError('ETIMEDOUT', { retryable: true });
    });
    await expect(withRetry(fn, { ...fast, maxAttempts: 3 })).rejects.toMatchObject({
      name: 'RetryExhaustedError',
      attempts: 3,
    });
  });
});
