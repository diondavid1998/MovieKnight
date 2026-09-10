'use strict';

/**
 * What happens to a Letterboxd watchlist between the CSV and the Watchlist tab,
 * and the rule that keeps the three lists from overlapping.
 *
 * Every test here is a regression: each one passed nothing and failed silently
 * before, which is the whole reason the file exists.
 */

jest.mock('../../movieService', () => {
  const actual = jest.requireActual('../../movieService');
  return {
    ...actual,
    fetchTitleWithCredits: jest.fn(),
    searchTitleOnTmdb: jest.fn(),
    fetchTitleDetails: jest.fn(),
    fetchOmdbRatings: jest.fn(),
    isOmdbRateLimited: jest.fn().mockReturnValue(false),
  };
});

const request = require('supertest');
const { createTestDb, closeDb } = require('../testHelpers');
const { createApp } = require('../../app');
const { searchTitleOnTmdb, fetchTitleWithCredits, resetTmdbBreaker } = require('../../movieService');
const { findListOverlaps, reconcileLists } = require('../../lists');

let db, app, token;
const auth = (req) => req.set('Authorization', `Bearer ${token}`);
const rows = (sql, params = []) =>
  new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r || []))));
const run = (sql, params = []) =>
  new Promise((res, rej) => db.run(sql, params, function (e) { e ? rej(e) : res(this); }));

/** A film TMDB knows about, keyed off the name so assertions can name titles. */
const KNOWN = {
  Stalker: 'movie-101',
  Solaris: 'movie-102',
  Heat: 'movie-103',
  Sinners: 'movie-104',
};
function tmdbKnowsEverything() {
  searchTitleOnTmdb.mockImplementation(async (name) => {
    const itemId = KNOWN[name];
    return itemId ? { itemId, mediaType: 'movie', title: name, posterUrl: null } : null;
  });
}

const WATCHLIST_CSV = [
  'Date,Name,Year,Letterboxd URI',
  '2026-02-01,Stalker,1979,https://boxd.it/g',
  '2026-02-02,Solaris,1972,https://boxd.it/h',
].join('\n');

beforeEach(async () => {
  jest.clearAllMocks();
  // The breaker is module state and outlives a suite. Another file's outage
  // test can leave it open, and a route that reaches TMDB then fails here for
  // a reason that has nothing to do with what is being tested.
  resetTmdbBreaker();
  db = await createTestDb();
  app = createApp(db, { disableRateLimit: true });
  token = (await request(app).post('/register').send({ username: 'cinephile', password: 'secret1' })).body.token;
  fetchTitleWithCredits.mockResolvedValue({
    id: 101, title: 'A Film', genres: [], runtime: 100,
    release_date: '1979-01-01', external_ids: { imdb_id: 'tt101' },
    credits: { cast: [], crew: [] },
  });
});
afterEach(async () => { await closeDb(db); });

// ── The whole-export import ───────────────────────────────────────────────

describe('a watchlist inside a whole-export upload', () => {
  test('reaches the real watchlist, not just the analytics stat', async () => {
    tmdbKnowsEverything();
    await auth(request(app).post('/letterboxd/diary'))
      .send({ files: [{ name: 'watchlist.csv', text: WATCHLIST_CSV }] });

    // The upload itself still touches no network — that is the whole point of
    // splitting the import from the lookup.
    expect(searchTitleOnTmdb).not.toHaveBeenCalled();

    // The analytics page has to offer the lookup, or nothing ever runs it.
    const before = await auth(request(app).get('/analytics'));
    expect(before.body.coverage.pendingWatchlist).toBe(2);

    await auth(request(app).post('/analytics/resolve')).send({ limit: 100 });

    const list = await auth(request(app).get('/watchlist'));
    expect(list.body.items.map((i) => i.itemId).sort()).toEqual(['movie-101', 'movie-102']);
    const after = await auth(request(app).get('/analytics'));
    expect(after.body.coverage.pendingWatchlist).toBe(0);
  });

  test('is hidden from For You once it is on the list', async () => {
    tmdbKnowsEverything();
    await auth(request(app).post('/letterboxd/diary'))
      .send({ files: [{ name: 'watchlist.csv', text: WATCHLIST_CSV }] });
    await auth(request(app).post('/analytics/resolve')).send({ limit: 100 });

    // Discovery excludes against watchlist_items. Before the fix nothing landed
    // there, so a saved film was suggested straight back to the user.
    const saved = await rows('SELECT item_id FROM watchlist_items');
    expect(saved.map((r) => r.item_id).sort()).toEqual(['movie-101', 'movie-102']);
  });

  test('skips a film already in the watched history rather than deleting it', async () => {
    tmdbKnowsEverything();
    await run(
      'INSERT INTO watched_items (user_id, item_id, media_type, title) VALUES (1, ?, ?, ?)',
      ['movie-101', 'movie', 'Stalker']
    );
    await auth(request(app).post('/letterboxd/diary'))
      .send({ files: [{ name: 'watchlist.csv', text: WATCHLIST_CSV }] });
    const res = await auth(request(app).post('/analytics/resolve')).send({ limit: 100 });

    expect(res.body.watchlist.skippedAlreadyWatched).toBe(1);
    // Solaris saved, Stalker skipped, and the watched row untouched.
    const list = await auth(request(app).get('/watchlist'));
    expect(list.body.items.map((i) => i.itemId)).toEqual(['movie-102']);
    expect(await rows('SELECT item_id FROM watched_items')).toHaveLength(1);
  });

  test('never puts a television programme on a film watchlist', async () => {
    // Letterboxd holds films only, so a tv- id here is a bad match, not a show.
    searchTitleOnTmdb.mockResolvedValue({
      itemId: 'tv-900', mediaType: 'tv', title: 'Stalker', posterUrl: null,
    });
    await auth(request(app).post('/letterboxd/diary'))
      .send({ files: [{ name: 'watchlist.csv', text: WATCHLIST_CSV }] });
    await auth(request(app).post('/analytics/resolve')).send({ limit: 100 });

    expect(await rows('SELECT item_id FROM watchlist_items')).toHaveLength(0);
  });
});

// ── The three-list rule ───────────────────────────────────────────────────

describe('the three lists stay exclusive', () => {
  const item = { itemId: 'movie-500', mediaType: 'movie', title: 'A Film' };

  test('marking watched takes it off the watchlist', async () => {
    await auth(request(app).post('/watchlist')).send(item);
    const res = await auth(request(app).post('/watched')).send(item);

    expect(res.body.movedFrom).toContain('watchlist');
    expect(await rows('SELECT * FROM watchlist_items')).toHaveLength(0);
    expect(await findListOverlaps(db)).toEqual([]);
  });

  test('saving something watched takes it out of the history', async () => {
    // Queueing a rewatch. The alternative — refusing, or accepting and leaving
    // the watched row — is a button that appears to do nothing.
    await auth(request(app).post('/watched')).send(item);
    const res = await auth(request(app).post('/watchlist')).send(item);

    expect(res.body.movedFrom).toContain('watched');
    expect(await rows('SELECT * FROM watched_items')).toHaveLength(0);
    expect(await findListOverlaps(db)).toEqual([]);
  });

  test('starting to watch clears both of the others', async () => {
    await auth(request(app).post('/watched')).send({ itemId: 'tv-700', title: 'A Show' });
    await auth(request(app).post('/currently-watching')).send({ itemId: 'tv-700', title: 'A Show' });

    expect(await rows('SELECT * FROM watched_items')).toHaveLength(0);
    expect(await findListOverlaps(db)).toEqual([]);
  });

  test('a right swipe claims the title like any other save', async () => {
    await auth(request(app).post('/watched')).send(item);
    const sw = await auth(request(app).post('/discovery/swipe'))
      .send({ itemId: 'movie-500', direction: 'right', title: 'A Film', mediaType: 'movie' });

    expect(sw.status).toBe(200);
    expect(await rows('SELECT * FROM watchlist_items')).toHaveLength(1);
    expect(await findListOverlaps(db)).toEqual([]);
  });

  test('a watched import clears the watchlist, and a watchlist import spares the history', async () => {
    tmdbKnowsEverything();
    await auth(request(app).post('/watchlist')).send({ itemId: 'movie-103', title: 'Heat' });

    await auth(request(app).post('/import/letterboxd'))
      .send({ items: [{ name: 'Heat', year: 1995 }], importType: 'watched' });
    expect(await rows('SELECT * FROM watchlist_items')).toHaveLength(0);
    expect(await findListOverlaps(db)).toEqual([]);

    // Now the other direction: the history stays, and the import says so.
    const res = await auth(request(app).post('/import/letterboxd'))
      .send({ items: [{ name: 'Heat', year: 1995 }], importType: 'watchlist' });
    expect(await rows('SELECT * FROM watched_items')).toHaveLength(1);
    expect(res.body.skippedAlreadyWatched).toBe(1);
    expect(await findListOverlaps(db)).toEqual([]);
  });

  test('the one-off repair cleans up overlaps that predate the rule', async () => {
    // Written straight to the tables, the way the old write paths did.
    await run('INSERT INTO watched_items (user_id, item_id, title) VALUES (1, ?, ?)', ['movie-1', 'A']);
    await run('INSERT INTO watchlist_items (user_id, item_id, title) VALUES (1, ?, ?)', ['movie-1', 'A']);
    await run(
      'INSERT INTO currently_watching (user_id, item_id, title, caught_up_on) VALUES (1, ?, ?, ?)',
      ['tv-2', 'B', '2026-01-01']
    );
    await run('INSERT INTO watched_items (user_id, item_id, title) VALUES (1, ?, ?)', ['tv-2', 'B']);
    expect(await findListOverlaps(db)).toHaveLength(2);

    const repaired = await reconcileLists(db);
    expect(repaired).toEqual({ watchlist: 1, watching: 1 });
    // History is what survives: it is the half that cannot be reconstructed.
    expect((await rows('SELECT item_id FROM watched_items')).map((r) => r.item_id).sort())
      .toEqual(['movie-1', 'tv-2']);
    expect(await findListOverlaps(db)).toEqual([]);

    // One-off means one-off: a second call must not re-run a destructive query.
    expect(await reconcileLists(db)).toBeNull();
  });
});
