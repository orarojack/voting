import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { config, uploadsDir } from './config.js';

const DEFAULT_SETTINGS = {
  election_title: 'General Elections 2026',
  election_description: 'Every registered member gets one vote per position. Pick your preferred aspirant for each seat and submit your ballot.',
  status: 'draft',
  results_visibility: 'after_close',
};

const INT_KEYS = new Set([
  'id',
  'position_id',
  'aspirant_id',
  'voter_id',
  'sort_order',
  'has_voted',
  'expires_at',
  'registered',
  'voted',
  'n',
  'positions',
  'aspirants',
  'next',
  'attempts',
  'sent_at',
]);

function normalizeRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'bigint') out[key] = Number(value);
    else if (INT_KEYS.has(key) && typeof value === 'string' && /^-?\d+$/.test(value)) out[key] = Number(value);
    else out[key] = value;
  }
  return out;
}

// SQLite uses `?`. Postgres uses `$1`. INSERT OR IGNORE is SQLite-only.
function toPostgres(sql) {
  let text = sql.trim().replace(/;$/, '');
  const ignore = /^insert\s+or\s+ignore\s+/i.test(text);
  if (ignore) text = text.replace(/^insert\s+or\s+ignore\s+/i, 'INSERT ');
  let n = 0;
  text = text.replace(/'(?:[^']|'')*'|(\?)/g, (match, placeholder) => (placeholder ? `$${++n}` : match));
  if (ignore) text += ' ON CONFLICT DO NOTHING';
  return text;
}

async function createPostgres() {
  const { default: postgres } = await import('postgres');
  const sql = postgres(config.databaseUrl, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 20,
    ssl: 'require',
  });
  const als = new AsyncLocalStorage();

  // Each parameterized query uses an explicit transaction so the Supabase
  // pooler keeps one database connection for the whole extended-protocol exchange.
  const query = (text, params) => {
    const sqlText = toPostgres(text);
    const tx = als.getStore();
    if (tx) return tx.unsafe(sqlText, params);
    return sql.begin((inner) => inner.unsafe(sqlText, params));
  };

  const api = {
    async all(text, ...params) {
      const rows = await query(text, params);
      return [...rows].map(normalizeRow);
    },
    async get(text, ...params) {
      const rows = await api.all(text, ...params);
      return rows[0] ?? null;
    },
    async run(text, ...params) {
      const rows = await query(text, params);
      const first = rows[0] ? normalizeRow(rows[0]) : null;
      return { changes: Number(rows.count ?? 0), lastInsertRowid: first?.id ?? null };
    },
    async exec(text) {
      const tx = als.getStore();
      if (tx) return tx.unsafe(text);
      return sql.begin((inner) => inner.unsafe(text));
    },
    transaction(fn) {
      return sql.begin((tx) => als.run(tx, fn));
    },
    async getSettings() {
      const rows = await api.all('SELECT key, value FROM settings');
      return Object.fromEntries(rows.map((row) => [row.key, row.value]));
    },
    async setSetting(key, value) {
      await api.run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        key,
        value,
      );
    },
  };

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await api.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', key, value);
  }
  await api.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  return api;
}

async function createSqlite() {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(config.dataDir, 'voting.db'));
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

  let tail = Promise.resolve();
  let depth = 0;
  function enqueue(fn) {
    if (depth > 0) return fn();
    const job = tail.then(async () => {
      depth += 1;
      try {
        return await fn();
      } finally {
        depth -= 1;
      }
    });
    tail = job.then(
      () => {},
      () => {},
    );
    return job;
  }

  const api = {
    all(text, ...params) {
      return enqueue(() => db.prepare(text).all(...params));
    },
    get(text, ...params) {
      return enqueue(() => db.prepare(text).get(...params) ?? null);
    },
    run(text, ...params) {
      return enqueue(() => {
        const info = db.prepare(text).run(...params);
        return { changes: Number(info.changes), lastInsertRowid: Number(info.lastInsertRowid) };
      });
    },
    exec(text) {
      return enqueue(() => {
        db.exec(text);
      });
    },
    transaction(fn) {
      return enqueue(async () => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = await fn();
          db.exec('COMMIT');
          return result;
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
      });
    },
    async getSettings() {
      const rows = await api.all('SELECT key, value FROM settings');
      return Object.fromEntries(rows.map((row) => [row.key, row.value]));
    },
    async setSetting(key, value) {
      await api.run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        key,
        value,
      );
    },
  };

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await api.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', key, value);
  }

  const sweep = () => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  sweep();
  if (!process.env.VERCEL) setInterval(sweep, 60 * 60 * 1000).unref();
  return api;
}

if (process.env.VERCEL && !config.databaseUrl) {
  throw new Error('DATABASE_URL is required on Vercel. Point it at the Supabase Postgres pooler.');
}

const api = config.databaseUrl ? await createPostgres() : await createSqlite();

export const all = (...args) => api.all(...args);
export const get = (...args) => api.get(...args);
export const run = (...args) => api.run(...args);
export const exec = (...args) => api.exec(...args);
export const transaction = (...args) => api.transaction(...args);
export const getSettings = (...args) => api.getSettings(...args);
export const setSetting = (...args) => api.setSetting(...args);
