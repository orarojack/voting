import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config, uploadsDir } from './config.js';

fs.mkdirSync(uploadsDir, { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, 'voting.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS positions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS aspirants (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    tagline     TEXT NOT NULL DEFAULT '',
    photo       TEXT,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS voters (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name       TEXT NOT NULL DEFAULT '',
    has_voted  INTEGER NOT NULL DEFAULT 0,
    voted_at   TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- Ballots are stored without any link to the voter. Random ids in a
  -- WITHOUT ROWID table keep insertion order from revealing who voted what.
  CREATE TABLE IF NOT EXISTS votes (
    id          TEXT PRIMARY KEY,
    position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
    aspirant_id INTEGER NOT NULL REFERENCES aspirants(id) ON DELETE CASCADE
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS idx_votes_aspirant ON votes(aspirant_id);

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    role       TEXT NOT NULL CHECK (role IN ('admin', 'voter')),
    voter_id   INTEGER REFERENCES voters(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
`);

const DEFAULT_SETTINGS = {
  election_title: 'General Elections 2026',
  election_description: 'Every registered member gets one vote per position. Pick your preferred aspirant for each seat and submit your ballot.',
  status: 'draft', // draft | open | closed
  results_visibility: 'after_close', // live | after_close | hidden
};

const insertDefault = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insertDefault.run(key, value);

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Clear expired sessions on startup and hourly.
function sweep() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}
sweep();
setInterval(sweep, 60 * 60 * 1000).unref();
