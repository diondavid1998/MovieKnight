'use strict';

/**
 * Unit tests for pure utility functions in catalogCache.js
 */

const { buildScopeKey, mapWithConcurrency, isRateLimitError } = require('../../catalogCache');

describe('buildScopeKey', () => {
  it('builds a deterministic key from platforms and region', () => {
    const key = buildScopeKey(['netflix', 'hulu'], 'US');
    expect(key).toBe('region:US|platforms:hulu,netflix');
  });

  it('sorts platforms so order does not matter', () => {
    const a = buildScopeKey(['hulu', 'netflix'], 'US');
    const b = buildScopeKey(['netflix', 'hulu'], 'US');
    expect(a).toBe(b);
  });

  it('deduplicates platforms', () => {
    const key = buildScopeKey(['netflix', 'netflix', 'hulu'], 'US');
    expect(key).toBe('region:US|platforms:hulu,netflix');
  });

  it('includes region in the key', () => {
    const us = buildScopeKey(['netflix'], 'US');
    const gb = buildScopeKey(['netflix'], 'GB');
    expect(us).not.toBe(gb);
    expect(us).toContain('region:US');
    expect(gb).toContain('region:GB');
  });

  it('defaults region to US when not supplied', () => {
    const key = buildScopeKey(['netflix']);
    expect(key).toContain('region:US');
  });
});

describe('mapWithConcurrency', () => {
  it('maps all items and returns results in order', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, async (x) => x * 2);
    expect(results).toEqual([2, 4, 6]);
  });

  it('runs with concurrency 1 (serial)', async () => {
    const order = [];
    await mapWithConcurrency([1, 2, 3], 1, async (x) => {
      order.push(x);
      return x;
    });
    expect(order).toEqual([1, 2, 3]);
  });

  it('handles empty array', async () => {
    const results = await mapWithConcurrency([], 4, async (x) => x);
    expect(results).toEqual([]);
  });

  it('respects concurrency limit', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (x) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 10));
      concurrent--;
      return x;
    });
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });
});

describe('isRateLimitError', () => {
  it('returns true for "too many requests" message', () => {
    expect(isRateLimitError(new Error('Too many requests'))).toBe(true);
  });

  it('returns true for "rate limit" message (case-insensitive)', () => {
    expect(isRateLimitError(new Error('Rate Limit exceeded'))).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isRateLimitError(new Error('Network timeout'))).toBe(false);
    expect(isRateLimitError(new Error('Not found'))).toBe(false);
  });

  it('handles non-Error objects gracefully', () => {
    expect(isRateLimitError('rate limit')).toBe(true);
    expect(isRateLimitError(null)).toBe(false);
    expect(isRateLimitError(undefined)).toBe(false);
  });
});
