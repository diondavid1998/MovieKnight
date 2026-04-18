'use strict';

/**
 * Shared test helpers for backend integration tests.
 * Creates an in-memory SQLite database and bootstraps the schema.
 */

const sqlite3 = require('sqlite3').verbose();

/**
 * Returns a promise that resolves once the in-memory database is ready
 * with the users table and catalog cache tables created.
 */
async function createTestDb() {
  const { ensureCatalogTables } = require('../catalogCache');

  const db = new sqlite3.Database(':memory:');

  // Create users table
  await new Promise((resolve, reject) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        platforms TEXT DEFAULT '[]',
        languages TEXT DEFAULT '[]'
      )`,
      (err) => (err ? reject(err) : resolve())
    );
  });

  // Create catalog cache tables
  await ensureCatalogTables(db);

  return db;
}

/**
 * Closes the database connection.
 */
function closeDb(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve()));
  });
}

module.exports = { createTestDb, closeDb };
