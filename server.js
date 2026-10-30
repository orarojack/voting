import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { ROOT, config, uploadsDir } from './config.js';
import { all, exec, get, getSettings, run, setSetting, transaction } from './db.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.VERCEL ? 1 : 'loopback');
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

const wrap = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

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

async function startSession(res, role, voterId = null) {
  const token = crypto.randomBytes(32).toString('base64url');
  await run('INSERT INTO sessions (token_hash, role, voter_id, expires_at) VALUES (?, ?, ?, ?)', sha256(token), role, voterId, Date.now() + SESSION_TTL);
  res.cookie(COOKIE[role], token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    maxAge: SESSION_TTL,
    path: '/',
  });
}

async function endSession(req, res, role) {
  const token = parseCookies(req.headers.cookie)[COOKIE[role]];
  if (token) await run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  res.clearCookie(COOKIE[role], { path: '/' });
}

function readSession(req, role) {
  const token = parseCookies(req.headers.cookie)[COOKIE[role]];
  if (!token) return null;
  return get('SELECT * FROM sessions WHERE token_hash = ? AND role = ? AND expires_at > ?', sha256(token), role, Date.now());
}

const requireAdmin = wrap(async (req, res, next) => {
  if (!(await readSession(req, 'admin'))) return res.status(401).json({ error: 'Admin sign-in required.' });
  next();
});

const requireVoter = wrap(async (req, res, next) => {
  const session = await readSession(req, 'voter');
  const voter = session && (await get('SELECT * FROM voters WHERE id = ?', session.voter_id));
  if (!voter) return res.status(401).json({ error: 'Please sign in to vote.' });
  req.voter = voter;
  next();
});

// ---------------------------------------------------------------------------
// Data shaping
// ---------------------------------------------------------------------------

const PHOTO_TYPES = { '.jpg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };

function photoUrl(photo) {
  if (!photo) return null;
  if (config.supabaseUrl) return `${config.supabaseUrl}/storage/v1/object/public/uploads/${encodeURIComponent(photo)}`;
  return `/uploads/${photo}`;
}

function publicAspirant(a) {
  return { id: a.id, positionId: a.position_id, name: a.name, tagline: a.tagline, photo: photoUrl(a.photo) };
}

async function listPositions() {
  const positions = await all('SELECT * FROM positions ORDER BY sort_order, id');
  const aspirants = await all('SELECT * FROM aspirants ORDER BY id');
  return positions.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    sortOrder: p.sort_order,
    aspirants: aspirants.filter((a) => a.position_id === p.id).map(publicAspirant),
  }));
}

async function turnout() {
  const row = await get('SELECT COUNT(*) AS registered, COALESCE(SUM(has_voted), 0) AS voted FROM voters');
  return { registered: Number(row.registered), voted: Number(row.voted) };
}

async function buildResults() {
  const counts = new Map(
    (await all('SELECT aspirant_id, COUNT(*) AS n FROM votes GROUP BY aspirant_id')).map((r) => [r.aspirant_id, Number(r.n)]),
  );
  const positions = (await listPositions()).map((p) => {
    const aspirants = p.aspirants
      .map((a) => ({ ...a, votes: counts.get(a.id) || 0 }))
      .sort((x, y) => y.votes - x.votes || x.name.localeCompare(y.name));
    return { ...p, aspirants, totalVotes: aspirants.reduce((s, a) => s + a.votes, 0) };
  });
  return { positions, turnout: await turnout() };
}

function resultsVisibleToPublic(settings) {
  if (settings.results_visibility === 'live') return true;
  if (settings.results_visibility === 'after_close') return settings.status === 'closed';
  return false;
}

async function publicElection() {
  const s = await getSettings();
  const counts = await get('SELECT (SELECT COUNT(*) FROM positions) AS positions, (SELECT COUNT(*) FROM aspirants) AS aspirants');
  return {
    title: s.election_title,
    description: s.election_description,
    status: s.status,
    resultsVisibility: s.results_visibility,
    resultsAvailable: resultsVisibleToPublic(s),
    positions: Number(counts.positions),
    aspirants: Number(counts.aspirants),
  };
}

// ---------------------------------------------------------------------------
// Public + voter API
// ---------------------------------------------------------------------------

app.get('/api/election', wrap(async (req, res) => {
  res.json(await publicElection());
}));

// Generous limit: many voters may share one IP (e.g. campus Wi-Fi), but it still slows email guessing.
const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 300, message: 'Too many sign-in attempts. Please try again in a few minutes.' });

// Voters sign in with their registered email alone; being on the register is the credential.
app.post('/api/auth/login', loginLimiter, wrap(async (req, res) => {
  const email = normEmail(req.body?.email);
  if (!EMAIL_RE.test(email)) fail(400, 'Please enter a valid email address.');

  const voter = await get('SELECT id FROM voters WHERE email = ?', email);
  if (!voter) fail(403, "This email isn't on the voter register. Contact the election administrator if you think this is a mistake.");

  await startSession(res, 'voter', voter.id);
  res.json({ ok: true });
}));

app.post('/api/auth/logout', wrap(async (req, res) => {
  await endSession(req, res, 'voter');
  res.json({ ok: true });
}));

app.get('/api/me', requireVoter, wrap(async (req, res) => {
  const { email, name, has_voted, voted_at } = req.voter;
  res.json({ email, name, hasVoted: Boolean(has_voted), votedAt: voted_at });
}));

app.get('/api/ballot', requireVoter, wrap(async (req, res) => {
  res.json({ positions: (await listPositions()).filter((p) => p.aspirants.length > 0) });
}));

app.post('/api/vote', requireVoter, wrap(async (req, res) => {
  const settings = await getSettings();
  if (settings.status === 'draft') fail(403, "Voting hasn't opened yet.");
  if (settings.status === 'closed') fail(403, 'Voting has closed.');

  const selections = req.body?.selections ?? {};
  const positions = (await listPositions()).filter((p) => p.aspirants.length > 0);
  if (positions.length === 0) fail(400, 'There is nothing to vote on yet.');

  const picks = positions.map((p) => {
    const aspirantId = Number(selections[p.id]);
    if (!p.aspirants.some((a) => a.id === aspirantId)) fail(400, `Please choose an aspirant for ${p.title}.`);
    return { positionId: p.id, aspirantId };
  });

  await transaction(async () => {
    const marked = await run('UPDATE voters SET has_voted = 1, voted_at = ? WHERE id = ? AND has_voted = 0', new Date().toISOString(), req.voter.id);
    if (marked.changes !== 1) fail(409, 'You have already voted. Each voter can only vote once.');

    for (const pick of picks) {
      await run('INSERT INTO votes (id, position_id, aspirant_id) VALUES (?, ?, ?)', crypto.randomUUID(), pick.positionId, pick.aspirantId);
    }
  });

  res.json({ ok: true });
}));

app.get('/api/results', wrap(async (req, res) => {
  const settings = await getSettings();
  if (!resultsVisibleToPublic(settings)) {
    fail(403, settings.results_visibility === 'hidden' ? 'Results are not public.' : 'Results will be published when voting closes.');
  }
  res.json(await buildResults());
}));

// ---------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------

const adminLoginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10, message: 'Too many sign-in attempts. Please wait a few minutes.' });

app.post('/api/admin/login', adminLoginLimiter, wrap(async (req, res) => {
  const emailOk = safeEqual(normEmail(req.body?.email), config.adminEmail);
  const passOk = safeEqual(String(req.body?.password ?? ''), config.adminPassword);
  if (!emailOk || !passOk) fail(401, 'Incorrect email or password.');
  await startSession(res, 'admin');
  res.json({ ok: true });
}));

app.post('/api/admin/logout', wrap(async (req, res) => {
  await endSession(req, res, 'admin');
  res.json({ ok: true });
}));

const admin = express.Router();
admin.use(requireAdmin);

admin.get('/me', wrap(async (req, res) => res.json({ email: config.adminEmail })));

admin.get('/overview', wrap(async (req, res) => {
  res.json({ election: await publicElection(), turnout: await turnout() });
}));

admin.put('/settings', wrap(async (req, res) => {
  const body = req.body ?? {};
  if (body.title !== undefined) {
    const title = clean(body.title, 120);
    if (!title) fail(400, 'Election title is required.');
    await setSetting('election_title', title);
  }
  if (body.description !== undefined) await setSetting('election_description', clean(body.description, 600));
  if (body.status !== undefined) {
    if (!['draft', 'open', 'closed'].includes(body.status)) fail(400, 'Invalid status.');
    await setSetting('status', body.status);
  }
  if (body.resultsVisibility !== undefined) {
    if (!['live', 'after_close', 'hidden'].includes(body.resultsVisibility)) fail(400, 'Invalid results visibility.');
    await setSetting('results_visibility', body.resultsVisibility);
  }
  res.json(await publicElection());
}));

admin.get('/positions', wrap(async (req, res) => res.json({ positions: await listPositions() })));

admin.post('/positions', wrap(async (req, res) => {
  const title = clean(req.body?.title, 80);
  if (!title) fail(400, 'Position title is required.');
  const { next } = await get('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM positions');
  const created = await get(
    'INSERT INTO positions (title, description, sort_order) VALUES (?, ?, ?) RETURNING id',
    title,
    clean(req.body?.description, 300),
    next,
  );
  res.status(201).json({ id: Number(created.id) });
}));

admin.put('/positions/:id', wrap(async (req, res) => {
  const title = clean(req.body?.title, 80);
  if (!title) fail(400, 'Position title is required.');
  const result = await run('UPDATE positions SET title = ?, description = ? WHERE id = ?', title, clean(req.body?.description, 300), req.params.id);
  if (!result.changes) fail(404, 'Position not found.');
  res.json({ ok: true });
}));

admin.post('/positions/:id/move', wrap(async (req, res) => {
  const dir = req.body?.direction === 'up' ? -1 : 1;
  const list = (await all('SELECT id FROM positions ORDER BY sort_order, id')).map((p) => p.id);
  const i = list.indexOf(Number(req.params.id));
  if (i < 0) fail(404, 'Position not found.');
  const j = i + dir;
  if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
  await transaction(async () => {
    for (let idx = 0; idx < list.length; idx += 1) {
      await run('UPDATE positions SET sort_order = ? WHERE id = ?', idx + 1, list[idx]);
    }
  });
  res.json({ ok: true });
}));

admin.delete('/positions/:id', wrap(async (req, res) => {
  const photos = await all('SELECT photo FROM aspirants WHERE position_id = ?', req.params.id);
  const result = await run('DELETE FROM positions WHERE id = ?', req.params.id);
  if (!result.changes) fail(404, 'Position not found.');
  for (const photo of photos) await removePhoto(photo.photo);
  res.json({ ok: true });
}));

// Aspirant photos ------------------------------------------------------------

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const BAD_IMAGE = 'Photo must be a JPG, PNG, WEBP or GIF image.';

const upload = multer({
  storage: config.databaseUrl
    ? multer.memoryStorage()
    : multer.diskStorage({
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

function imageExtension(head) {
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return '.jpg';
  if (head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return '.png';
  if (head.toString('ascii', 0, 4) === 'GIF8') return '.gif';
  if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  return null;
}

function photoBytes(file) {
  if (file.buffer) return file.buffer.subarray(0, 12);
  const head = Buffer.alloc(12);
  const fd = fs.openSync(file.path, 'r');
  try {
    fs.readSync(fd, head, 0, 12, 0);
  } finally {
    fs.closeSync(fd);
  }
  return head;
}

async function storePhoto(name, file, contentType) {
  if (!config.databaseUrl) {
    const dest = path.join(uploadsDir, name);
    if (file.buffer) fs.writeFileSync(dest, file.buffer);
    else fs.renameSync(file.path, dest);
    return;
  }
  if (!config.supabaseUrl || !config.supabaseServiceKey) fail(500, 'Photo storage is not configured.');
  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/uploads/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      apikey: config.supabaseServiceKey,
      Authorization: `Bearer ${config.supabaseServiceKey}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: file.buffer,
  });
  if (!response.ok) {
    console.error('Photo upload failed', response.status);
    fail(500, 'Could not store the photo.');
  }
}

// Identify the image from its magic bytes (never trust the client's MIME type),
// then give the stored file the matching extension so it is served correctly.
async function finalizePhoto(file) {
  if (!file) return null;
  const ext = imageExtension(photoBytes(file));
  if (!ext) {
    if (file.path) fs.rmSync(file.path, { force: true });
    fail(400, BAD_IMAGE);
  }
  const stem = file.filename ? path.basename(file.filename, '.upload') : crypto.randomBytes(16).toString('hex');
  const name = stem + ext;
  await storePhoto(name, file, PHOTO_TYPES[ext]);
  return name;
}

async function removePhoto(name) {
  if (!name || name !== path.basename(name)) return;
  if (config.databaseUrl) {
    if (!config.supabaseUrl || !config.supabaseServiceKey) return;
    await fetch(`${config.supabaseUrl}/storage/v1/object/uploads/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: {
        apikey: config.supabaseServiceKey,
        Authorization: `Bearer ${config.supabaseServiceKey}`,
      },
    });
    return;
  }
  fs.rm(path.join(uploadsDir, name), { force: true }, () => {});
}

admin.post('/aspirants', upload.single('photo'), wrap(async (req, res) => {
  const name = clean(req.body?.name, 80);
  const positionId = Number(req.body?.positionId);
  try {
    if (!name) fail(400, 'Aspirant name is required.');
    if (!(await get('SELECT id FROM positions WHERE id = ?', positionId))) fail(400, 'Choose a valid position.');
  } catch (err) {
    await removePhoto(req.file?.filename);
    throw err;
  }
  const photo = await finalizePhoto(req.file);
  try {
    const created = await get(
      'INSERT INTO aspirants (position_id, name, tagline, photo) VALUES (?, ?, ?, ?) RETURNING id',
      positionId,
      name,
      clean(req.body?.tagline, 200),
      photo,
    );
    res.status(201).json({ id: Number(created.id) });
  } catch (err) {
    await removePhoto(photo);
    throw err;
  }
}));

admin.put('/aspirants/:id', upload.single('photo'), wrap(async (req, res) => {
  const current = await get('SELECT * FROM aspirants WHERE id = ?', req.params.id);
  const name = clean(req.body?.name, 80);
  const positionId = Number(req.body?.positionId);
  try {
    if (!current) fail(404, 'Aspirant not found.');
    if (!name) fail(400, 'Aspirant name is required.');
    if (!(await get('SELECT id FROM positions WHERE id = ?', positionId))) fail(400, 'Choose a valid position.');
  } catch (err) {
    await removePhoto(req.file?.filename);
    throw err;
  }

  let photo = current.photo;
  if (req.file) photo = await finalizePhoto(req.file);
  else if (req.body?.removePhoto === 'true') photo = null;

  await run(
    'UPDATE aspirants SET position_id = ?, name = ?, tagline = ?, photo = ? WHERE id = ?',
    positionId,
    name,
    clean(req.body?.tagline, 200),
    photo,
    current.id,
  );
  if (photo !== current.photo) await removePhoto(current.photo);
  res.json({ ok: true });
}));

admin.delete('/aspirants/:id', wrap(async (req, res) => {
  const current = await get('SELECT photo FROM aspirants WHERE id = ?', req.params.id);
  if (!current) fail(404, 'Aspirant not found.');
  await run('DELETE FROM aspirants WHERE id = ?', req.params.id);
  await removePhoto(current.photo);
  res.json({ ok: true });
}));

// Voters ----------------------------------------------------------------------

admin.get('/voters', wrap(async (req, res) => {
  const voters = await all('SELECT id, email, name, has_voted, voted_at, created_at FROM voters ORDER BY created_at DESC, id DESC');
  res.json({
    voters: voters.map((v) => ({ id: v.id, email: v.email, name: v.name, hasVoted: Boolean(v.has_voted), votedAt: v.voted_at, addedAt: v.created_at })),
    turnout: await turnout(),
  });
}));

admin.post('/voters', wrap(async (req, res) => {
  // Accepts either { email, name } or { emails: "bulk text separated by commas/newlines" }.
  const name = clean(req.body?.name, 80);
  const raw = req.body?.emails ?? req.body?.email ?? '';
  const tokens = String(raw).split(/[\s,;]+/).map(normEmail).filter(Boolean);
  const unique = [...new Set(tokens)];
  const invalid = unique.filter((e) => !EMAIL_RE.test(e));
  const valid = unique.filter((e) => EMAIL_RE.test(e));
  if (valid.length === 0) fail(400, invalid.length ? `Not a valid email: ${invalid.slice(0, 3).join(', ')}` : 'Enter at least one email address.');

  let added = 0;
  await transaction(async () => {
    for (const email of valid) {
      const result = await run('INSERT OR IGNORE INTO voters (email, name) VALUES (?, ?)', email, valid.length === 1 ? name : '');
      added += result.changes;
    }
  });
  res.status(201).json({ added, duplicates: valid.length - added, invalid });
}));

admin.delete('/voters/:id', wrap(async (req, res) => {
  const result = await run('DELETE FROM voters WHERE id = ?', req.params.id);
  if (!result.changes) fail(404, 'Voter not found.');
  res.json({ ok: true });
}));

admin.get('/results', wrap(async (req, res) => res.json(await buildResults())));

admin.post('/reset-votes', wrap(async (req, res) => {
  if (req.body?.confirm !== 'RESET') fail(400, 'Type RESET to confirm.');
  await transaction(async () => {
    await exec('DELETE FROM votes');
    await exec('UPDATE voters SET has_voted = 0, voted_at = NULL');
  });
  res.json({ ok: true });
}));

app.use('/api/admin', admin);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------

if (!config.databaseUrl) app.use('/uploads', express.static(uploadsDir, { maxAge: '7d', immutable: true }));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Photo must be 5 MB or smaller.' : err.message });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request body.' });
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

export default app;

if (!process.env.VERCEL) {
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`Voting platform running at http://localhost:${config.port}`);
    console.log(`Admin dashboard:            http://localhost:${config.port}/admin`);
    if (config.databaseUrl) console.log('Database: Supabase Postgres');
    if (config.adminPassword === 'admin123') {
      console.warn('WARNING: using the default admin password. Set ADMIN_EMAIL and ADMIN_PASSWORD in .env before going live.');
    }
  });
}
