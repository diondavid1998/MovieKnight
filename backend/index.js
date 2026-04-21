// Entry point — creates the real database, wires up the app, and starts listening.
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const { ensureCatalogTables, startDailyCatalogRefresh } = require('./catalogCache');
const { createApp } = require('./app');

const PORT = process.env.PORT || 4000;

const db = new sqlite3.Database(process.env.DB_PATH || './db.sqlite', (err) => {
  if (err) {
    console.error('Could not connect to database', err);
  } else {
    console.log('Connected to SQLite database');
  }
});

// Bootstrap schema
db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  platforms TEXT DEFAULT '[]',
  languages TEXT DEFAULT '[]'
)`);

db.all('PRAGMA table_info(users)', [], (err, columns) => {
  if (err || !Array.isArray(columns)) return;
  if (!columns.some((col) => col.name === 'languages')) {
    db.run("ALTER TABLE users ADD COLUMN languages TEXT DEFAULT '[]'");
  }
  if (!columns.some((col) => col.name === 'email')) {
    db.run('ALTER TABLE users ADD COLUMN email TEXT');
  }
  if (!columns.some((col) => col.name === 'profile_pic')) {
    db.run('ALTER TABLE users ADD COLUMN profile_pic TEXT');
  }
});

db.run(`CREATE TABLE IF NOT EXISTS watched_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  media_type TEXT,
  title TEXT,
  poster_url TEXT,
  watched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, item_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
)`);

db.run(`CREATE TABLE IF NOT EXISTS reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  email TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  used INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
)`);

ensureCatalogTables(db).catch((error) => {
  console.error('Failed to initialize catalog cache tables:', error);
});
startDailyCatalogRefresh(db);

const app = createApp(db);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
