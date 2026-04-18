'use strict';

/**
 * Integration tests for the StreamScore REST API.
 *
 * Each describe block uses a fresh in-memory SQLite database
 * and a supertest agent so no real files or ports are needed.
 */

process.env.JWT_SECRET = 'integration-test-secret';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const { createApp } = require('../../app');
const { createTestDb, closeDb } = require('../testHelpers');

// ── Helpers ──────────────────────────────────────────────────────────────────

async function registerUser(agent, username = 'testuser', password = 'password123') {
  const res = await agent.post('/register').send({ username, password });
  return res;
}

async function loginUser(agent, username = 'testuser', password = 'password123') {
  const res = await agent.post('/login').send({ username, password });
  return res;
}

async function registerAndLogin(agent, username = 'testuser', password = 'password123') {
  await registerUser(agent, username, password);
  const res = await loginUser(agent, username, password);
  return res.body.token;
}

// ── Health check ─────────────────────────────────────────────────────────────

describe('GET /', () => {
  let db, app;

  beforeAll(async () => {
    db = await createTestDb();
    app = createApp(db, { disableRateLimit: true });
  });

  afterAll(() => closeDb(db));

  it('returns 200 with health message', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Backend is running');
  });
});

// ── POST /register ────────────────────────────────────────────────────────────

describe('POST /register', () => {
  let db, app;

  beforeAll(async () => {
    db = await createTestDb();
    app = createApp(db, { disableRateLimit: true });
  });

  afterAll(() => closeDb(db));

  it('registers a new user and returns a JWT token', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'alice', password: 'securepass' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(typeof res.body.token).toBe('string');
  });

  it('rejects duplicate usernames with 400', async () => {
    const agent = request(app);
    await agent.post('/register').send({ username: 'bob', password: 'password1' });
    const res = await agent.post('/register').send({ username: 'bob', password: 'different1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('rejects username shorter than 3 characters', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'ab', password: 'password1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/3/);
  });

  it('rejects password shorter than 6 characters', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'charlie', password: '123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/6/);
  });

  it('rejects missing username', async () => {
    const res = await request(app).post('/register').send({ password: 'password1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('rejects missing password', async () => {
    const res = await request(app).post('/register').send({ username: 'dave' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('trims leading/trailing whitespace from username', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: '  eve  ', password: 'password1' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
  });
});

// ── POST /login ───────────────────────────────────────────────────────────────

describe('POST /login', () => {
  let db, app;

  beforeAll(async () => {
    db = await createTestDb();
    app = createApp(db, { disableRateLimit: true });
    // seed a user
    await request(app).post('/register').send({ username: 'logintest', password: 'mypassword' });
  });

  afterAll(() => closeDb(db));

  it('logs in with correct credentials and returns a token', async () => {
    const res = await request(app)
      .post('/login')
      .send({ username: 'logintest', password: 'mypassword' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
  });

  it('rejects wrong password with 401', async () => {
    const res = await request(app)
      .post('/login')
      .send({ username: 'logintest', password: 'wrongpass' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  it('rejects unknown username with 401', async () => {
    const res = await request(app)
      .post('/login')
      .send({ username: 'ghost', password: 'password1' });

    expect(res.status).toBe(401);
  });

  it('rejects empty body with 400', async () => {
    const res = await request(app).post('/login').send({});
    expect(res.status).toBe(400);
  });
});

// ── Auth middleware ───────────────────────────────────────────────────────────

describe('Authentication middleware', () => {
  let db, app;

  beforeAll(async () => {
    db = await createTestDb();
    app = createApp(db, { disableRateLimit: true });
  });

  afterAll(() => closeDb(db));

  it('rejects requests with no Authorization header', async () => {
    const res = await request(app).get('/platforms');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/missing/i);
  });

  it('rejects requests with an invalid token', async () => {
    const res = await request(app)
      .get('/platforms')
      .set('Authorization', 'Bearer invalid.token.here');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/invalid or expired/i);
  });
});

// ── GET /platforms ────────────────────────────────────────────────────────────

describe('GET /platforms', () => {
  let db, app, token;

  beforeAll(async () => {
    db = await createTestDb();
    app = createApp(db, { disableRateLimit: true });
    token = await registerAndLogin(request(app), 'platuser', 'password123');
  });

  afterAll(() => closeDb(db));

  it('returns empty arrays for a fresh user', async () => {
    const res = await request(app)
      .get('/platforms')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.platforms).toEqual([]);
    expect(res.body.languages).toEqual([]);
  });
});

// ── PUT /platforms ────────────────────────────────────────────────────────────

describe('PUT /platforms', () => {
  let db, app, token;

  beforeAll(async () => {
    db = await createTestDb();
    app = createApp(db, { disableRateLimit: true });
    token = await registerAndLogin(request(app), 'putplatuser', 'password123');
  });

  afterAll(() => closeDb(db));

  it('saves platforms and languages for the authenticated user', async () => {
    const putRes = await request(app)
      .put('/platforms')
      .set('Authorization', `Bearer ${token}`)
      .send({ platforms: ['netflix', 'hulu'], languages: ['en'] });

    expect(putRes.status).toBe(200);
    expect(putRes.body.success).toBe(true);

    // Verify they are persisted
    const getRes = await request(app)
      .get('/platforms')
      .set('Authorization', `Bearer ${token}`);

    expect(getRes.body.platforms).toEqual(['netflix', 'hulu']);
    expect(getRes.body.languages).toEqual(['en']);
  });

  it('saves platforms with no languages (defaults to [])', async () => {
    const res = await request(app)
      .put('/platforms')
      .set('Authorization', `Bearer ${token}`)
      .send({ platforms: ['prime'] });

    expect(res.status).toBe(200);

    const getRes = await request(app)
      .get('/platforms')
      .set('Authorization', `Bearer ${token}`);

    expect(getRes.body.platforms).toEqual(['prime']);
    expect(getRes.body.languages).toEqual([]);
  });

  it('rejects non-array platforms with 400', async () => {
    const res = await request(app)
      .put('/platforms')
      .set('Authorization', `Bearer ${token}`)
      .send({ platforms: 'netflix' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/array/i);
  });

  it('rejects non-array languages with 400', async () => {
    const res = await request(app)
      .put('/platforms')
      .set('Authorization', `Bearer ${token}`)
      .send({ platforms: [], languages: 'en' });

    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app)
      .put('/platforms')
      .send({ platforms: ['netflix'] });

    expect(res.status).toBe(401);
  });
});

// ── PUT /account ──────────────────────────────────────────────────────────────

describe('PUT /account', () => {
  let db, app, token;

  beforeAll(async () => {
    db = await createTestDb();
    app = createApp(db, { disableRateLimit: true });
    token = await registerAndLogin(request(app), 'acctuser', 'oldpassword');
  });

  afterAll(() => closeDb(db));

  it('updates the password and allows login with new password', async () => {
    const updateRes = await request(app)
      .put('/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'newpassword1' });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.success).toBe(true);

    const loginRes = await request(app)
      .post('/login')
      .send({ username: 'acctuser', password: 'newpassword1' });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body).toHaveProperty('token');
  });

  it('rejects missing password field with 400', async () => {
    const res = await request(app)
      .put('/account')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('rejects password shorter than 6 chars', async () => {
    const res = await request(app)
      .put('/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: '123' });

    expect(res.status).toBe(400);
  });
});

// ── GET /movies ───────────────────────────────────────────────────────────────

describe('GET /movies', () => {
  let db, app, token;

  beforeAll(async () => {
    db = await createTestDb();
    app = createApp(db, { disableRateLimit: true });
    token = await registerAndLogin(request(app), 'moviesuser', 'password123');
  });

  afterAll(() => closeDb(db));

  it('requires authentication', async () => {
    const res = await request(app).get('/movies');
    expect(res.status).toBe(401);
  });

  it('returns catalog shape with items and meta for empty platform list', async () => {
    const res = await request(app)
      .get('/movies')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('meta');
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.meta).toHaveProperty('page');
    expect(res.body.meta).toHaveProperty('pageSize');
  });

  it('accepts mediaType and sortBy query params', async () => {
    const res = await request(app)
      .get('/movies?mediaType=movie&sortBy=popularity')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.mediaType).toBe('movie');
    expect(res.body.meta.sortBy).toBe('popularity');
  });

  it('accepts serviceFilters query param', async () => {
    const res = await request(app)
      .get('/movies?serviceFilters=netflix,hulu')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('accepts genreFilters query param', async () => {
    const res = await request(app)
      .get('/movies?genreFilters=Action,Drama')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('accepts page and limit query params', async () => {
    const res = await request(app)
      .get('/movies?page=1&limit=10')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.pageSize).toBe(10);
  });
});
