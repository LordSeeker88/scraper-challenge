import { describe, expect, it } from 'vitest';
import { retryAfterMsFromHeader } from '../src/core/http-client.js';

describe('retryAfterMsFromHeader', () => {
  it('parses a delay in seconds', () => {
    expect(retryAfterMsFromHeader('5')).toBe(5000);
    expect(retryAfterMsFromHeader('0')).toBe(0);
  });

  it('parses an HTTP-date into a positive delay', () => {
    const future = new Date(Date.now() + 60_000).toUTCString();
    const ms = retryAfterMsFromHeader(future);
    expect(ms).toBeDefined();
    expect(ms!).toBeGreaterThan(0);
    expect(ms!).toBeLessThanOrEqual(120_000);
  });

  it('returns undefined for missing or unparseable values', () => {
    expect(retryAfterMsFromHeader(undefined)).toBeUndefined();
    expect(retryAfterMsFromHeader('abc')).toBeUndefined();
    expect(retryAfterMsFromHeader('-3')).toBeUndefined();
  });
});
