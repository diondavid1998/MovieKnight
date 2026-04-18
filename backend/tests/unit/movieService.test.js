'use strict';

/**
 * Unit tests for pure functions in movieService.js
 * No network calls, no database — all deterministic.
 */

const { buildRatingsPayload, toSortableRating } = require('../../movieService');

describe('buildRatingsPayload', () => {
  it('returns null fields when OMDB data has no Ratings array', () => {
    const result = buildRatingsPayload({});
    expect(result.imdb).toBeNull();
    expect(result.rottenTomatoes).toBeNull();
    expect(result.metacritic).toBeNull();
    expect(result.letterboxd).toBeNull();
  });

  it('extracts IMDb rating from Ratings array', () => {
    const result = buildRatingsPayload({
      Ratings: [{ Source: 'Internet Movie Database', Value: '8.2/10' }],
    });
    expect(result.imdb).toBe('8.2/10');
    expect(result.rottenTomatoes).toBeNull();
    expect(result.metacritic).toBeNull();
  });

  it('extracts Rotten Tomatoes rating', () => {
    const result = buildRatingsPayload({
      Ratings: [{ Source: 'Rotten Tomatoes', Value: '94%' }],
    });
    expect(result.rottenTomatoes).toBe('94%');
  });

  it('extracts Metacritic rating', () => {
    const result = buildRatingsPayload({
      Ratings: [{ Source: 'Metacritic', Value: '88/100' }],
    });
    expect(result.metacritic).toBe('88/100');
  });

  it('extracts all three ratings together', () => {
    const result = buildRatingsPayload({
      Ratings: [
        { Source: 'Internet Movie Database', Value: '7.6/10' },
        { Source: 'Rotten Tomatoes', Value: '82%' },
        { Source: 'Metacritic', Value: '71/100' },
      ],
      imdbVotes: '1,234,567',
      imdbID: 'tt1234567',
    });
    expect(result.imdb).toBe('7.6/10');
    expect(result.rottenTomatoes).toBe('82%');
    expect(result.metacritic).toBe('71/100');
    expect(result.omdbVotes).toBe('1,234,567');
    expect(result.imdbId).toBe('tt1234567');
  });

  it('handles non-array Ratings gracefully', () => {
    const result = buildRatingsPayload({ Ratings: null });
    expect(result.imdb).toBeNull();
  });

  it('letterboxd is always null (not yet implemented)', () => {
    const result = buildRatingsPayload({ Ratings: [] });
    expect(result.letterboxd).toBeNull();
  });
});

describe('toSortableRating', () => {
  it('converts percentage string to number', () => {
    expect(toSortableRating('94%')).toBe(94);
    expect(toSortableRating('0%')).toBe(0);
    expect(toSortableRating('100%')).toBe(100);
  });

  it('converts x/10 string to number', () => {
    expect(toSortableRating('8.2/10')).toBe(8.2);
    expect(toSortableRating('10/10')).toBe(10);
  });

  it('converts x/100 string to number', () => {
    expect(toSortableRating('88/100')).toBe(88);
    expect(toSortableRating('71/100')).toBe(71);
  });

  it('returns null for null/undefined', () => {
    expect(toSortableRating(null)).toBeNull();
    expect(toSortableRating(undefined)).toBeNull();
  });

  it('returns null for non-string values', () => {
    expect(toSortableRating(42)).toBeNull();
  });

  it('returns null for unrecognized format', () => {
    expect(toSortableRating('N/A')).toBeNull();
    expect(toSortableRating('')).toBeNull();
  });
});
