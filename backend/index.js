// Entry point for the backend server
require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const {
  ensureCatalogTables,
  ensureScopeSynced,
  readCachedCatalog,
  startDailyCatalogRefresh,
} = require('./catalogCache');
const app = express();
const PORT = process.env.PORT || 4000;

const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';
app.use(cors({ origin: allowedOrigin, credentials: true }));
app.use(express.json({ limit: '64kb' }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

// Initialize SQLite DB
const db = new sqlite3.Database('./db.sqlite', (err) => {
  if (err) {
    console.error('Could not connect to database', err);
  } else {
    console.log('Connected to SQLite database');
  }
});

// Create users table if not exists
const userTableSql = `CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  platforms TEXT DEFAULT '[]',
  languages TEXT DEFAULT '[]'
)`;
db.run(userTableSql);
// Safe migration: add languages column only if it doesn't exist
db.all("PRAGMA table_info(users)", [], (err, columns) => {
  if (err || !Array.isArray(columns)) return;
  const hasLanguages = columns.some((col) => col.name === 'languages');
  if (!hasLanguages) {
    db.run("ALTER TABLE users ADD COLUMN languages TEXT DEFAULT '[]'");
  }
});
ensureCatalogTables(db).catch((error) => {
  console.error('Failed to initialize catalog cache tables:', error);
});
startDailyCatalogRefresh(db);

// Health check
app.get('/', (req, res) => {
  res.send('Backend is running');
});

// Register endpoint
app.post('/register', authLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 32) {
    return res.status(400).json({ error: 'Username must be 3–32 characters' });
  }
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
    return res.status(400).json({ error: 'Password must be 6–128 characters' });
  }
  const cleanUsername = username.trim();
  const hash = await bcrypt.hash(password, 10);
  db.run('INSERT INTO users (username, password) VALUES (?, ?)', [cleanUsername, hash], function(err) {
    if (err) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    const token = jwt.sign({ id: this.lastID, username: cleanUsername }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token });
  });
});

// Login endpoint
app.post('/login', authLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Invalid credentials' });
  }
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err || !user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user.id, username }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token });
  });
});

// Middleware to verify JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Missing authentication token' });
  }
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired authentication token' });
    }
    req.user = user;
    next();
  });
}

// Account update endpoint
app.put('/account', authenticateToken, (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  bcrypt.hash(password, 10).then(hash => {
    db.run('UPDATE users SET password = ? WHERE id = ?', [hash, req.user.id], function(err) {
      if (err) return res.status(500).json({ error: 'Update failed' });
      res.json({ success: true });
    });
  });
});

// Update user content preferences
app.put('/platforms', authenticateToken, (req, res) => {
  const { platforms, languages } = req.body;
  if (!Array.isArray(platforms)) {
    return res.status(400).json({ error: 'Platforms must be an array' });
  }
  if (languages !== undefined && !Array.isArray(languages)) {
    return res.status(400).json({ error: 'Languages must be an array' });
  }

  db.run(
    'UPDATE users SET platforms = ?, languages = ? WHERE id = ?',
    [JSON.stringify(platforms), JSON.stringify(Array.isArray(languages) ? languages : []), req.user.id],
    function(err) {
    if (err) return res.status(500).json({ error: 'Update failed' });
    res.json({ success: true });
    }
  );
});

// Get user content preferences
app.get('/platforms', authenticateToken, (req, res) => {
  db.get('SELECT platforms, languages FROM users WHERE id = ?', [req.user.id], (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'User not found' });
    let platforms = [];
    let languages = [];
    try {
      platforms = JSON.parse(row.platforms);
    } catch {
      platforms = [];
    }
    try {
      languages = JSON.parse(row.languages || '[]');
    } catch {
      languages = [];
    }
    res.json({ platforms, languages });
  });
});

// Get catalog items for user's selected platforms
app.get('/movies', authenticateToken, async (req, res) => {
  db.get('SELECT platforms, languages FROM users WHERE id = ?', [req.user.id], async (err, row) => {
    if (err || !row) {
      console.error('User not found:', err);
      return res.status(404).json({ error: 'User not found' });
    }
    
    let platforms = [];
    let languages = [];
    try {
      platforms = JSON.parse(row.platforms || '[]');
    } catch (e) {
      console.error('Error parsing platforms:', e);
      platforms = [];
    }
    try {
      languages = JSON.parse(row.languages || '[]');
    } catch (e) {
      console.error('Error parsing languages:', e);
      languages = [];
    }
    
    const mediaType = req.query.mediaType || 'all';
    const sortBy = req.query.sortBy || 'popularity';
    const limit = req.query.limit || 24;
    const region = req.query.region || 'US';
    const page = req.query.page || 1;
    const serviceFilters = String(req.query.serviceFilters || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const languageFilters = String(req.query.languageFilters || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    console.log(`Reading cached catalog for user ${req.user.id}, platforms:`, platforms, {
      mediaType,
      sortBy,
      limit,
      region,
      page,
      languages,
      serviceFilters,
      languageFilters,
    });
    
    try {
      const scopeKey = await ensureScopeSynced(db, {
        platforms,
        languages,
        region,
      });
      const catalog = await readCachedCatalog(db, {
        scopeKey,
        mediaType,
        sortBy,
        page: Number(page),
        pageSize: Number(limit),
        serviceFilters,
        languageFilters,
      });
      console.log(`Returning ${catalog.items.length} catalog items to user ${req.user.id}`);
      res.json(catalog);
    } catch (e) {
      console.error('Error reading cached catalog:', e);
      res.status(500).json({ error: 'Failed to load cached catalog', details: e.message });
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
