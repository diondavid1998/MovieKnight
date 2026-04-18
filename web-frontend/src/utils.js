/**
 * Pure utility functions extracted from App.js.
 * No React imports — fully testable without a DOM.
 */

/** Extract the leading integer or float from a string (e.g. "94%" → 94, "8.2/10" → 8.2). */
export function parsePercent(value) {
  if (!value) return null;
  const match = String(value).match(/(\d+\.?\d*)/);
  return match ? Number(match[1]) : null;
}

/**
 * Returns an array of rating badge descriptors for a catalog item.
 * Empty strings and "N/A" values are filtered out.
 */
export function ratingEntriesForItem(item) {
  const ratings = item?.ratings || {};
  const clean = (v) => (v && v !== 'N/A' ? v : null);
  return [
    {
      key: 'tmdb',
      label: 'TMDb',
      value: ratings.tmdb ? String(Number(ratings.tmdb).toFixed(1)) : null,
    },
    { key: 'imdb', label: 'IMDb', value: clean(ratings.imdb) },
    { key: 'rottenTomatoes', label: 'Critics', value: clean(ratings.rottenTomatoes) },
    { key: 'metacritic', label: 'Metacritic', value: clean(ratings.metacritic) },
  ].filter((entry) => entry.value);
}

/**
 * Builds a human-readable error message from a JSON API error response.
 */
export function buildApiErrorMessage(data, fallbackMessage) {
  if (data?.error && data?.details) {
    return `${data.error}: ${data.details}`;
  }
  return data?.error || fallbackMessage;
}

/**
 * Returns a Rotten Tomatoes logo identifier based on the critics score.
 */
export function getRottenTomatoesType(score, mediaType) {
  if (score === null || score === undefined) return null;
  if (score < 60) return 'rotten';
  if (mediaType === 'movie') return score >= 90 ? 'certified' : 'fresh-movie';
  return 'fresh-tv';
}
