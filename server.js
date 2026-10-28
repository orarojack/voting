import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { ROOT, config, uploadsDir } from './config.js';
import { db, getSettings, setSetting, transaction } from './db.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const EMAIL_RE = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]{2,}$/;
const normEmail = (e) => String(e ?? '').trim().toLowerCase();
const clean = (s, max = 200) => String(s ?? '').trim().slice(0, max);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};

function safeEqual(a, b) {
  const ha = Buffer.from(sha256(a));
  const hb = Buffer.from(sha256(b));
  return crypto.timingSafeEqual(ha, hb);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Tiny in-memory fixed-window rate limiter keyed by IP.
function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, res, next) => {
    const key = req.ip;
    const n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    if (n > max) return res.status(429).json({ error: message });
    next();
  };
}

// ---------------------------------------------------------------------------
// Sessions (separate cookies so an admin can also test as a voter)
// ---------------------------------------------------------------------------

const COOKIE = { admin: 'admin_sid', voter: 'voter_sid' };
const SESSION_TTL = 12 * 60 * 60 * 1000;

function startSession(res, role, voterId = null) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, role, voter_id, expires_at) VALUES (?, ?, ?, ?)').run(
    sha256(token),
    role,
    voterId,
    Date.now() + SESSION_TTL,
  );
  res.cookie(COOKIE[role], token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    maxAge: SESSION_TTL,
    path: '/',
  });
}

function endSession(req, res, role) {
  const token = parseCookies(req.headers.cookie)[COOKIE[role]];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(COOKIE[role], { path: '/' });
}

function readSession(req, role) {
  const token = parseCookies(req.headers.cookie)[COOKIE[role]];
  if (!token) return null;
  return (
    db
      .prepare('SELECT * FROM sessions WHERE token_hash = ? AND role = ? AND expires_at > ?')
      .get(sha256(token), role, Date.now()) || null
  );
}

function requireAdmin(req, res, next) {
  if (!readSession(req, 'admin')) return res.status(401).json({ error: 'Admin sign-in required.' });
  next();
}

function requireVoter(req, res, next) {
  const session = readSession(req, 'voter');
  const voter = session && db.prepare('SELECT * FROM voters WHERE id = ?').get(session.voter_id);
  if (!voter) return res.status(401).json({ error: 'Please sign in to vote.' });
  req.voter = voter;
  next();
}

// ---------------------------------------------------------------------------
// Data shaping
// ---------------------------------------------------------------------------

const photoUrl = (photo) => (photo ? `/uploads/${photo}` : null);

function publicAspirant(a) {
  return { id: a.id, positionId: a.position_id, name: a.name, tagline: a.tagline, photo: photoUrl(a.photo) };
}

function listPositions() {
  const positions = db.prepare('SELECT * FROM positions ORDER BY sort_order, id').all();
  const aspirants = db.prepare('SELECT * FROM aspirants ORDER BY id').all();
  return positions.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    sortOrder: p.sort_order,
    aspirants: aspirants.filter((a) => a.position_id === p.id).map(publicAspirant),
  }));
}

function turnout() {
  const row = db.prepare('SELECT COUNT(*) AS registered, COALESCE(SUM(has_voted), 0) AS voted FROM voters').get();
  return { registered: row.registered, voted: row.voted };
}

function buildResults() {
  const counts = new Map(
    db.prepare('SELECT aspirant_id, COUNT(*) AS n FROM votes GROUP BY aspirant_id').all().map((r) => [r.aspirant_id, r.n]),
  );
  const positions = listPositions().map((p) => {
    const aspirants = p.aspirants
      .map((a) => ({ ...a, votes: counts.get(a.id) || 0 }))
      .sort((x, y) => y.votes - x.votes || x.name.localeCompare(y.name));
    return { ...p, aspirants, totalVotes: aspirants.reduce((s, a) => s + a.votes, 0) };
  });
  return { positions, turnout: turnout() };
}

function resultsVisibleToPublic(settings) {
  if (settings.results_visibility === 'live') return true;
  if (settings.results_visibility === 'after_close') return settings.status === 'closed';
  return false;
}

function publicElection() {
  const s = getSettings();
  const counts = db.prepare('SELECT (SELECT COUNT(*) FROM positions) AS positions, (SELECT COUNT(*) FROM aspirants) AS aspirants').get();
  return {
    title: s.election_title,
    description: s.election_description,
    status: s.status,
    resultsVisibility: s.results_visibility,
    resultsAvailable: resultsVisibleToPublic(s),
    positions: counts.positions,
    aspirants: counts.aspirants,
  };
}

// ---------------------------------------------------------------------------
// Public + voter API
// ---------------------------------------------------------------------------

app.get('/api/election', (req, res) => {
  res.json(publicElection());
});

// Generous limit: many voters may share one IP (e.g. campus Wi-Fi), but it still slows email guessing.
const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 300, message: 'Too many sign-in attempts. Please try again in a few minutes.' });

// Voters sign in with their registered email alone; being on the register is the credential.
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const email = normEmail(req.body?.email);
  if (!EMAIL_RE.test(email)) fail(400, 'Please enter a valid email address.');

  const voter = db.prepare('SELECT id FROM voters WHERE email = ?').get(email);
  if (!voter) fail(403, "This email isn't on the voter register. Contact the election administrator if you think this is a mistake.");

  startSession(res, 'voter', voter.id);
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  endSession(req, res, 'voter');
  res.json({ ok: true });
});

app.get('/api/me', requireVoter, (req, res) => {
  const { email, name, has_voted, voted_at } = req.voter;
  res.json({ email, name, hasVoted: Boolean(has_voted), votedAt: voted_at });
});

app.get('/api/ballot', requireVoter, (req, res) => {
  res.json({ positions: listPositions().filter((p) => p.aspirants.length > 0) });
});

app.post('/api/vote', requireVoter, (req, res) => {
  const settings = getSettings();
  if (settings.status === 'draft') fail(403, "Voting hasn't opened yet.");
  if (settings.status === 'closed') fail(403, 'Voting has closed.');

  const selections = req.body?.selections ?? {};
  const positions = listPositions().filter((p) => p.aspirants.length > 0);
  if (positions.length === 0) fail(400, 'There is nothing to vote on yet.');

  const picks = positions.map((p) => {
    const aspirantId = Number(selections[p.id]);
    if (!p.aspirants.some((a) => a.id === aspirantId)) fail(400, `Please choose an aspirant for ${p.title}.`);
    return { positionId: p.id, aspirantId };
  });

  transaction(() => {
    const marked = db
      .prepare('UPDATE voters SET has_voted = 1, voted_at = ? WHERE id = ? AND has_voted = 0')
      .run(new Date().toISOString(), req.voter.id);
    if (marked.changes !== 1) fail(409, 'You have already voted. Each voter can only vote once.');

    const insert = db.prepare('INSERT INTO votes (id, position_id, aspirant_id) VALUES (?, ?, ?)');
    for (const pick of picks) insert.run(crypto.randomUUID(), pick.positionId, pick.aspirantId);
  });

  res.json({ ok: true });
});

app.get('/api/results', (req, res) => {
  const settings = getSettings();
  if (!resultsVisibleToPublic(settings) && !readSession(req, 'admin')) {
    fail(403, settings.results_visibility === 'hidden' ? 'Results are not public.' : 'Results will be published when voting closes.');
  }
  res.json(buildResults());
});

// ---------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------

const adminLoginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10, message: 'Too many sign-in attempts. Please wait a few minutes.' });

app.post('/api/admin/login', adminLoginLimiter, (req, res) => {
  const emailOk = safeEqual(normEmail(req.body?.email), config.adminEmail);
  const passOk = safeEqual(String(req.body?.password ?? ''), config.adminPassword);
  if (!emailOk || !passOk) fail(401, 'Incorrect email or password.');
  startSession(res, 'admin');
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  endSession(req, res, 'admin');
  res.json({ ok: true });
});

const admin = express.Router();
admin.use(requireAdmin);

admin.get('/me', (req, res) => res.json({ email: config.adminEmail }));

admin.get('/overview', (req, res) => {
  res.json({ election: publicElection(), turnout: turnout() });
});

admin.put('/settings', (req, res) => {
  const body = req.body ?? {};
  if (body.title !== undefined) {
    const title = clean(body.title, 120);
    if (!title) fail(400, 'Election title is required.');
    setSetting('election_title', title);
  }
  if (body.description !== undefined) setSetting('election_description', clean(body.description, 600));
  if (body.status !== undefined) {
    if (!['draft', 'open', 'closed'].includes(body.status)) fail(400, 'Invalid status.');
    setSetting('status', body.status);
  }
  if (body.resultsVisibility !== undefined) {
    if (!['live', 'after_close', 'hidden'].includes(body.resultsVisibility)) fail(400, 'Invalid results visibility.');
    setSetting('results_visibility', body.resultsVisibility);
  }
  res.json(publicElection());
});

admin.get('/positions', (req, res) => res.json({ positions: listPositions() }));

admin.post('/positions', (req, res) => {
  const title = clean(req.body?.title, 80);
  if (!title) fail(400, 'Position title is required.');
  const { next } = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM positions').get();
  const r = db.prepare('INSERT INTO positions (title, description, sort_order) VALUES (?, ?, ?)').run(title, clean(req.body?.description, 300), next);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

admin.put('/positions/:id', (req, res) => {
  const title = clean(req.body?.title, 80);
  if (!title) fail(400, 'Position title is required.');
  const r = db.prepare('UPDATE positions SET title = ?, description = ? WHERE id = ?').run(title, clean(req.body?.description, 300), req.params.id);
  if (!r.changes) fail(404, 'Position not found.');
  res.json({ ok: true });
});

admin.post('/positions/:id/move', (req, res) => {
  const dir = req.body?.direction === 'up' ? -1 : 1;
  const list = db.prepare('SELECT id FROM positions ORDER BY sort_order, id').all().map((p) => p.id);
  const i = list.indexOf(Number(req.params.id));
  if (i < 0) fail(404, 'Position not found.');
  const j = i + dir;
  if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
  transaction(() => {
    const update = db.prepare('UPDATE positions SET sort_order = ? WHERE id = ?');
    list.forEach((id, idx) => update.run(idx + 1, id));
  });
  res.json({ ok: true });
});

admin.delete('/positions/:id', (req, res) => {
  const photos = db.prepare('SELECT photo FROM aspirants WHERE position_id = ?').all(req.params.id);
  const r = db.prepare('DELETE FROM positions WHERE id = ?').run(req.params.id);
  if (!r.changes) fail(404, 'Position not found.');
  photos.forEach((p) => removePhoto(p.photo));
  res.json({ ok: true });
});

// Aspirant photos ------------------------------------------------------------

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const BAD_IMAGE = 'Photo must be a JPG, PNG, WEBP or GIF image.';

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + '.upload'),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.mimetype.startsWith('image/') || IMAGE_EXTS.includes(ext)) cb(null, true);
    else cb(new HttpError(400, BAD_IMAGE));
  },
});

// Identify the image from its magic bytes (never trust the client's MIME type),
// then give the stored file the matching extension so it is served correctly.
function finalizePhoto(file) {
  if (!file) return null;
  const head = Buffer.alloc(12);
  const fd = fs.openSync(file.path, 'r');
  fs.readSync(fd, head, 0, 12, 0);
  fs.closeSync(fd);

  let ext = null;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) ext = '.jpg';
  else if (head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) ext = '.png';
  else if (head.toString('ascii', 0, 4) === 'GIF8') ext = '.gif';
  else if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') ext = '.webp';

  if (!ext) {
    fs.rmSync(file.path, { force: true });
    fail(400, BAD_IMAGE);
  }
  const name = path.basename(file.filename, '.upload') + ext;
  fs.renameSync(file.path, path.join(uploadsDir, name));
  return name;
}

function removePhoto(name) {
  if (!name || name !== path.basename(name)) return;
  fs.rm(path.join(uploadsDir, name), { force: true }, () => {});
}

admin.post('/aspirants', upload.single('photo'), (req, res) => {
  const name = clean(req.body?.name, 80);
  const positionId = Number(req.body?.positionId);
  try {
    if (!name) fail(400, 'Aspirant name is required.');
    if (!db.prepare('SELECT id FROM positions WHERE id = ?').get(positionId)) fail(400, 'Choose a valid position.');
  } catch (err) {
    removePhoto(req.file?.filename);
    throw err;
  }
  const photo = finalizePhoto(req.file);
  const r = db
    .prepare('INSERT INTO aspirants (position_id, name, tagline, photo) VALUES (?, ?, ?, ?)')
    .run(positionId, name, clean(req.body?.tagline, 200), photo);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

admin.put('/aspirants/:id', upload.single('photo'), (req, res) => {
  const current = db.prepare('SELECT * FROM aspirants WHERE id = ?').get(req.params.id);
  const name = clean(req.body?.name, 80);
  const positionId = Number(req.body?.positionId);
  try {
    if (!current) fail(404, 'Aspirant not found.');
    if (!name) fail(400, 'Aspirant name is required.');
    if (!db.prepare('SELECT id FROM positions WHERE id = ?').get(positionId)) fail(400, 'Choose a valid position.');
  } catch (err) {
    removePhoto(req.file?.filename);
    throw err;
  }

  let photo = current.photo;
  if (req.file) photo = finalizePhoto(req.file);
  else if (req.body?.removePhoto === 'true') photo = null;

  db.prepare('UPDATE aspirants SET position_id = ?, name = ?, tagline = ?, photo = ? WHERE id = ?').run(
    positionId,
    name,
    clean(req.body?.tagline, 200),
    photo,
    current.id,
  );
  if (photo !== current.photo) removePhoto(current.photo);
  res.json({ ok: true });
});

admin.delete('/aspirants/:id', (req, res) => {
  const current = db.prepare('SELECT photo FROM aspirants WHERE id = ?').get(req.params.id);
  if (!current) fail(404, 'Aspirant not found.');
  db.prepare('DELETE FROM aspirants WHERE id = ?').run(req.params.id);
  removePhoto(current.photo);
  res.json({ ok: true });
});

// Voters ----------------------------------------------------------------------

admin.get('/voters', (req, res) => {
  const voters = db.prepare('SELECT id, email, name, has_voted, voted_at, created_at FROM voters ORDER BY created_at DESC, id DESC').all();
  res.json({
    voters: voters.map((v) => ({ id: v.id, email: v.email, name: v.name, hasVoted: Boolean(v.has_voted), votedAt: v.voted_at, addedAt: v.created_at })),
    turnout: turnout(),
  });
});

admin.post('/voters', (req, res) => {
  // Accepts either { email, name } or { emails: "bulk text separated by commas/newlines" }.
  const name = clean(req.body?.name, 80);
  const raw = req.body?.emails ?? req.body?.email ?? '';
  const tokens = String(raw).split(/[\s,;]+/).map(normEmail).filter(Boolean);
  const unique = [...new Set(tokens)];
  const invalid = unique.filter((e) => !EMAIL_RE.test(e));
  const valid = unique.filter((e) => EMAIL_RE.test(e));
  if (valid.length === 0) fail(400, invalid.length ? `Not a valid email: ${invalid.slice(0, 3).join(', ')}` : 'Enter at least one email address.');

  let added = 0;
  transaction(() => {
    const insert = db.prepare('INSERT OR IGNORE INTO voters (email, name) VALUES (?, ?)');
    for (const email of valid) added += insert.run(email, valid.length === 1 ? name : '').changes;
  });
  res.status(201).json({ added, duplicates: valid.length - added, invalid });
});

admin.delete('/voters/:id', (req, res) => {
  const r = db.prepare('DELETE FROM voters WHERE id = ?').run(req.params.id);
  if (!r.changes) fail(404, 'Voter not found.');
  res.json({ ok: true });
});

admin.get('/results', (req, res) => res.json(buildResults()));

admin.post('/reset-votes', (req, res) => {
  if (req.body?.confirm !== 'RESET') fail(400, 'Type RESET to confirm.');
  transaction(() => {
    db.exec('DELETE FROM votes');
    db.exec('UPDATE voters SET has_voted = 0, voted_at = NULL');
  });
  res.json({ ok: true });
});

app.use('/api/admin', admin);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------

app.use('/uploads', express.static(uploadsDir, { maxAge: '7d', immutable: true }));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Photo must be 5 MB or smaller.' : err.message });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request body.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

app.listen(config.port, () => {
  console.log(`Voting platform running at http://localhost:${config.port}`);
  console.log(`Admin dashboard:            http://localhost:${config.port}/admin`);
  if (config.adminPassword === 'admin123') {
    console.warn('WARNING: using the default admin password. Set ADMIN_EMAIL and ADMIN_PASSWORD in .env before going live.');
  }
});
