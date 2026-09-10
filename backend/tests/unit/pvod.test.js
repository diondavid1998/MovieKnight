'use strict';

/**
 * PVOD — rentals and purchases as a service you pick.
 *
 * The rule under test throughout: nothing changes for a user who has not
 * selected it. Rentals were deliberately excluded for years on the grounds that
 * this app answers "what can I already watch", and that answer still stands for
 * everyone who has not asked for the other one.
 */

process.env.TMDB_API_KEY = process.env.TMDB_API_KEY || 'test-key';

const {
  extractAvailability,
  buildProviderLookupMap,
  buildScopeKey,
  readCachedCatalog,
} = require('../../catalogCache');
const { createTestDb, closeDb } = require('../testHelpers');
const { syncScope } = require('../../catalogCache');

const {
  PLATFORM_CONFIG,
  PVOD_KEY,
  buildProviderSelection,
  selectionIncludesPurchase,
  monetizationFor,
  includedProviders,
  normalizeProviders,
} = require('../../movieService');

/** One title: on Netflix, and rentable or buyable in three stores. */
const DETAILS = {
  'watch/providers': {
    results: {
      US: {
        flatrate: [{ provider_id: 8, provider_name: 'Netflix' }],
        rent: [
          { provider_id: 2, provider_name: 'Apple TV' },
          { provider_id: 10, provider_name: 'Amazon Video' },
        ],
        buy: [
          // The same store lists a film to rent and again to buy. One place.
          { provider_id: 2, provider_name: 'Apple TV' },
          { provider_id: 7, provider_name: 'Fandango At Home' },
        ],
      },
    },
  },
};

describe('a user who has not picked PVOD', () => {
  const selection = buildProviderSelection(['netflix']);

  it('is not asking for rentals', () => {
    expect(selectionIncludesPurchase(selection.providerMapById)).toBe(false);
  });

  it('gets the same discover query as before', () => {
    expect(monetizationFor(selection.providerMapById)).toEqual(['flatrate', 'free', 'ads']);
  });

  it('sees no storefronts on a title, even one that is rentable', () => {
    const providers = normalizeProviders(DETAILS, selection.providerMapById);
    expect(providers.names).toEqual(['Netflix']);
    expect(providers.keys).toEqual(['netflix']);
    expect(providers.purchaseNames).toEqual([]);
  });

  it('reads only the three included tiers', () => {
    const offers = includedProviders(DETAILS['watch/providers'], 'US');
    expect(offers.map((o) => o.tier)).toEqual(['flatrate']);
  });
});

describe('a user who picked PVOD', () => {
  const selection = buildProviderSelection(['netflix', 'pvod']);

  it('widens the discover query to rent and buy', () => {
    expect(monetizationFor(selection.providerMapById))
      .toEqual(['flatrate', 'free', 'ads', 'rent', 'buy']);
  });

  it('names the storefronts, and keeps them out of the subscription list', () => {
    const providers = normalizeProviders(DETAILS, selection.providerMapById);
    // What a subscription covers is unchanged…
    expect(providers.names).toEqual(['Netflix']);
    // …and where to buy it is its own answer, each store once.
    expect(providers.purchaseNames).toEqual(['Apple TV', 'Amazon Video', 'Fandango At Home']);
  });

  it('files every store under one key, so the filter chip is one chip', () => {
    const providers = normalizeProviders(DETAILS, selection.providerMapById);
    expect(providers.keys).toEqual(['netflix', PVOD_KEY]);
  });

  it('names a storefront the id list has never heard of', () => {
    // The ids scope the discover query; availability comes from TMDB's own
    // rent/buy buckets. A store nobody listed costs breadth, never correctness.
    const obscure = {
      'watch/providers': {
        results: { US: { rent: [{ provider_id: 999999, provider_name: 'Some New Store' }] } },
      },
    };
    const providers = normalizeProviders(obscure, selection.providerMapById);
    expect(providers.purchaseNames).toEqual(['Some New Store']);
    expect(providers.keys).toEqual([PVOD_KEY]);
  });

  it('says nothing about a title nobody sells', () => {
    const subscriptionOnly = {
      'watch/providers': {
        results: { US: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] } },
      },
    };
    const providers = normalizeProviders(subscriptionOnly, selection.providerMapById);
    expect(providers.purchaseNames).toEqual([]);
    expect(providers.keys).toEqual(['netflix']);
  });
});

describe('the PVOD entry itself', () => {
  it('is a tier, not a storefront', () => {
    expect(PLATFORM_CONFIG.pvod.purchase).toBe(true);
    expect(PLATFORM_CONFIG.pvod.ids.length).toBeGreaterThan(1);
  });

  it('does not collide with the subscription services it sits beside', () => {
    // Apple TV+ (350) and Apple TV the store (2) are different providers, as are
    // Prime Video (9) and Amazon Video (10). Filing a store under a
    // subscription's id would put rentals in "on your services".
    const subscriptionIds = new Set(
      Object.entries(PLATFORM_CONFIG)
        .filter(([key]) => key !== 'pvod')
        .flatMap(([, c]) => c.ids || [c.id])
    );
    for (const id of PLATFORM_CONFIG.pvod.ids) {
      expect(subscriptionIds.has(id)).toBe(false);
    }
  });

  it('is selectable like any other service', () => {
    const { providerIds } = buildProviderSelection(['pvod']);
    expect(providerIds).toEqual(PLATFORM_CONFIG.pvod.ids);
  });
});


// ── The watchlist view ────────────────────────────────────────────────────
//
// A second availability path, for titles the user saved rather than browsed.
// It reads the same TMDB response through its own map, so it can — and once
// did — disagree with the catalog about what a title costs.

describe('availability in the watchlist view', () => {
  it('shows no storefronts to someone who has not picked PVOD', () => {
    const map = buildProviderLookupMap(['netflix']);
    const available = extractAvailability(DETAILS['watch/providers'], map, 'US');
    expect(available.names).toEqual(['Netflix']);
    expect(available.purchaseNames).toEqual([]);
    expect(available.keys).toEqual(['netflix']);
  });

  it('names the storefronts once PVOD is picked', () => {
    const map = buildProviderLookupMap(['netflix', 'pvod']);
    const available = extractAvailability(DETAILS['watch/providers'], map, 'US');
    expect(available.names).toEqual(['Netflix']);
    expect(available.purchaseNames).toEqual(['Apple TV', 'Amazon Video', 'Fandango At Home']);
    expect(available.keys).toEqual(['netflix', PVOD_KEY]);
  });

  it('agrees with the catalog about the same title', () => {
    // Two code paths, one answer. They read the same response through different
    // maps, and the catalog is what the browse view shows while this is what the
    // Watchlist tab shows — a title that costs money in one and not the other is
    // the kind of disagreement a user reports as a bug and nobody can reproduce.
    const selection = buildProviderSelection(['netflix', 'pvod']);
    const fromCatalog = normalizeProviders(DETAILS, selection.providerMapById);
    const fromWatchlist = extractAvailability(
      DETAILS['watch/providers'], buildProviderLookupMap(['netflix', 'pvod']), 'US'
    );
    expect(fromWatchlist.names).toEqual(fromCatalog.names);
    expect(fromWatchlist.keys).toEqual(fromCatalog.keys);
    expect(fromWatchlist.purchaseNames).toEqual(fromCatalog.purchaseNames);
  });
});


// ── The round trip ────────────────────────────────────────────────────────
//
// The storefronts have to survive the database and come back out under the
// filter chip. A name that reaches SQLite and not the reader is the same
// failure as never fetching it.

describe('storefronts through the catalog cache', () => {
  let db;
  const scopeKey = buildScopeKey(['netflix', 'pvod'], 'US');
  const insert = (row) => new Promise((res, rej) => db.run(
    `INSERT INTO catalog_cache_entries
       (scope_key, media_type, tmdb_id, title, available_on_json,
        available_on_keys_json, purchase_on_json, updated_at)
     VALUES (?, 'movie', ?, ?, ?, ?, ?, '2026-01-01')`,
    [scopeKey, row.id, row.title,
     JSON.stringify(row.on || []), JSON.stringify(row.keys || []),
     JSON.stringify(row.stores || [])],
    (e) => (e ? rej(e) : res())
  ));

  beforeEach(async () => {
    db = await createTestDb();
    await insert({ id: 1, title: 'On Netflix Only', on: ['Netflix'], keys: ['netflix'] });
    await insert({ id: 2, title: 'Rent Only', on: [], keys: ['pvod'], stores: ['Apple TV', 'Amazon Video'] });
    await insert({ id: 3, title: 'Both', on: ['Netflix'], keys: ['netflix', 'pvod'], stores: ['Apple TV'] });
  });
  afterEach(() => closeDb(db));

  it('reads the storefronts back out', async () => {
    const { items } = await readCachedCatalog(db, { scopeKey, pageSize: 50 });
    const rentOnly = items.find((i) => i.title === 'Rent Only');
    expect(rentOnly.purchaseOn).toEqual(['Apple TV', 'Amazon Video']);
    expect(rentOnly.availableOn).toEqual([]);
  });

  it('leaves a subscription title with no storefronts', async () => {
    const { items } = await readCachedCatalog(db, { scopeKey, pageSize: 50 });
    const netflixOnly = items.find((i) => i.title === 'On Netflix Only');
    expect(netflixOnly.purchaseOn).toEqual([]);
  });

  it('filters to rentable titles on the one PVOD key', async () => {
    // Every store files under `pvod`, so the picker is one chip rather than six.
    const { items } = await readCachedCatalog(db, {
      scopeKey, pageSize: 50, serviceFilters: ['pvod'],
    });
    expect(items.map((i) => i.title).sort()).toEqual(['Both', 'Rent Only']);
  });

  it('does not let a rentable title answer a Netflix filter', async () => {
    const { items } = await readCachedCatalog(db, {
      scopeKey, pageSize: 50, serviceFilters: ['netflix'],
    });
    expect(items.map((i) => i.title).sort()).toEqual(['Both', 'On Netflix Only']);
  });
});


// ── The write path ────────────────────────────────────────────────────────
//
// The round trip above inserts rows itself, which proves the column and the
// filter but not the sync that fills them. Mocked at the TMDB boundary so this
// exercises the real INSERT.

jest.mock('../../movieService', () => {
  const actual = jest.requireActual('../../movieService');
  return { ...actual, fetchCatalogByPlatforms: jest.fn() };
});
const { fetchCatalogByPlatforms } = require('../../movieService');

describe('a sync that found rentable titles', () => {
  let db;
  beforeEach(async () => {
    db = await createTestDb();
    fetchCatalogByPlatforms.mockResolvedValue({
      items: [{
        mediaType: 'movie', tmdbId: 42, title: 'Rentable', overview: '', year: 2026,
        genres: [], ratings: {}, sortableRatings: {},
        availableOn: [], availableOnKeys: [PVOD_KEY],
        purchaseOn: ['Apple TV', 'Amazon Video'],
      }],
      meta: {},
    });
  });
  afterEach(() => closeDb(db));

  it('writes the storefronts, not an empty list', async () => {
    await syncScope(db, { platforms: ['pvod'], languages: [], region: 'US' });
    const { items } = await readCachedCatalog(db, {
      scopeKey: buildScopeKey(['pvod'], 'US', []), pageSize: 10,
    });
    expect(items).toHaveLength(1);
    expect(items[0].purchaseOn).toEqual(['Apple TV', 'Amazon Video']);
  });
});
