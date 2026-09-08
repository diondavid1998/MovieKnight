'use strict';

/**
 * Unit tests for pure utility functions in catalogCache.js
 */

const { createTestDb, closeDb } = require('../testHelpers');
const { buildScopeKey, mapWithConcurrency, isRateLimitError, readCachedCatalog } = require('../../catalogCache');

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

describe('buildScopeKey', () => {
  it('builds a deterministic key from platforms and region', () => {
    const key = buildScopeKey(['netflix', 'hulu'], 'US');
    expect(key).toBe('region:US|platforms:hulu,netflix|languages:');
  });

  it('sorts platforms so order does not matter', () => {
    const a = buildScopeKey(['hulu', 'netflix'], 'US');
    const b = buildScopeKey(['netflix', 'hulu'], 'US');
    expect(a).toBe(b);
  });

  it('deduplicates platforms', () => {
    const key = buildScopeKey(['netflix', 'netflix', 'hulu'], 'US');
    expect(key).toBe('region:US|platforms:hulu,netflix|languages:');
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

  it('includes languages in the key', () => {
    const key = buildScopeKey(['netflix'], 'US', ['ta', 'hi']);
    expect(key).toBe('region:US|platforms:netflix|languages:hi,ta');
  });

  it('sorts languages so order does not matter', () => {
    const a = buildScopeKey(['netflix'], 'US', ['ta', 'hi']);
    const b = buildScopeKey(['netflix'], 'US', ['hi', 'ta']);
    expect(a).toBe(b);
  });

  it('deduplicates languages', () => {
    const key = buildScopeKey(['netflix'], 'US', ['ta', 'hi', 'ta']);
    expect(key).toBe('region:US|platforms:netflix|languages:hi,ta');
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

describe('readCachedCatalog language filters', () => {
  let db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await closeDb(db);
  });

  it('returns Tamil/Hindi rows when those language filters are applied', async () => {
    const scopeKey = buildScopeKey(['netflix'], 'US', ['ta', 'hi']);
    const now = new Date().toISOString();

    await run(
      db,
      `INSERT INTO catalog_cache_entries (scope_key, media_type, tmdb_id, title, original_language, popularity, imdb_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [scopeKey, 'movie', 101, 'Tamil Title', 'ta', 10, 'tt0000101', now]
    );
    await run(
      db,
      `INSERT INTO catalog_cache_entries (scope_key, media_type, tmdb_id, title, original_language, popularity, imdb_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [scopeKey, 'movie', 102, 'Hindi Title', 'hi', 9, 'tt0000102', now]
    );
    await run(
      db,
      `INSERT INTO catalog_cache_entries (scope_key, media_type, tmdb_id, title, original_language, popularity, imdb_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [scopeKey, 'movie', 103, 'English Title', 'en', 11, 'tt0000103', now]
    );

    const result = await readCachedCatalog(db, {
      scopeKey,
      languageFilters: ['ta', 'hi'],
      page: 1,
      pageSize: 24,
    });

    expect(result.items.map((item) => item.title).sort()).toEqual(['Hindi Title', 'Tamil Title']);
  });
});

describe('every ordering is total', () => {
  const { buildSortExpression } = require('../../catalogCache');

  // Paging is LIMIT/OFFSET, so each page re-runs the query. An ORDER BY that
  // leaves rows tied lets the engine break that tie however it likes, and a row
  // that lands on a different side of a page boundary between two requests is
  // shown twice or not at all — a film in the catalog the reader never sees.
  //
  // This is an invariant test rather than a behavioural one on purpose. SQLite
  // happens to scan in rowid order today, so the fault does not reproduce from
  // the outside; it appears when the query plan changes — an index gets used,
  // or rows are written while someone is paging. The guarantee is the fix, and
  // the guarantee is what is asserted.
  const SORTS = [
    'title', 'release_date', 'release_date_asc', 'recently_added',
    'tmdb', 'imdb', 'rotten_tomatoes', 'metacritic', 'popularity',
    'anything-unrecognised',
  ];

  test.each(SORTS)('%s ends in the row identity', (sortBy) => {
    const expression = buildSortExpression(sortBy);
    const tail = expression.split(',').slice(-2).map((p) => p.trim()).join(', ');
    expect(tail).toBe('media_type ASC, tmdb_id ASC');
  });

  test('those columns really do identify a row', async () => {
    // The tail only breaks ties if it cannot itself repeat inside one scope.
    // A query is already scoped to a single scope_key, so what is left of the
    // primary key must be exactly what the ordering ends with — tmdb_id alone
    // is not enough, because a film and a series can share a TMDB id.
    const db = await createTestDb();
    try {
      const [{ sql }] = await new Promise((resolve, reject) =>
        db.all("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'catalog_cache_entries'",
          (e, rows) => (e ? reject(e) : resolve(rows))));
      expect(sql.replace(/\s+/g, ' '))
        .toContain('PRIMARY KEY (scope_key, media_type, tmdb_id)');
    } finally {
      await closeDb(db);
    }
  });
});
