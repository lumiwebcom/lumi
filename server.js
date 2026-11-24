// Lumi — a Discord-style community app with an Instagram look.
// Express (REST) + Socket.IO (realtime + WebRTC signaling) + SQLite (storage).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --- tiny .env loader (no dependency) ---
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const cookie = {
  parse(str) {
    const out = {};
    for (const part of String(str || '').split(';')) {
      const i = part.indexOf('='); if (i < 0) continue;
      const k = part.slice(0, i).trim(); if (!(k in out)) { try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch {} }
    }
    return out;
  },
  serialize(name, val, o = {}) {
    let s = `${name}=${encodeURIComponent(val)}`;
    if (o.maxAge != null) s += `; Max-Age=${Math.floor(o.maxAge)}`;
    if (o.path) s += `; Path=${o.path}`;
    if (o.httpOnly) s += '; HttpOnly';
    if (o.secure) s += '; Secure';
    if (o.sameSite) s += `; SameSite=${o.sameSite[0].toUpperCase()}${o.sameSite.slice(1)}`;
    return s;
  },
};
const { OAuth2Client } = require('google-auth-library');

const PORT = process.env.PORT || 3000;
let GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------------------------------------------------------------- database
const db = new DatabaseSync(path.join(DATA_DIR, 'lumi.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE, username TEXT UNIQUE NOT NULL, display_name TEXT,
  password_hash TEXT, google_id TEXT UNIQUE, avatar TEXT, banner TEXT, bio TEXT DEFAULT '',
  custom_status TEXT DEFAULT '', accent TEXT DEFAULT '#d62976', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS friendships (
  requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (requester_id, addressee_id));
CREATE TABLE IF NOT EXISTS blocks (user_id TEXT NOT NULL, blocked_id TEXT NOT NULL, PRIMARY KEY (user_id, blocked_id));
CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, banner TEXT, description TEXT DEFAULT '',
  owner_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY, server_id TEXT REFERENCES servers(id) ON DELETE CASCADE, type TEXT NOT NULL,
  name TEXT, topic TEXT DEFAULT '', position INTEGER DEFAULT 0, owner_id TEXT, icon TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS channel_members (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY (channel_id, user_id));
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, content TEXT DEFAULT '',
  attachment_url TEXT, attachment_type TEXT, attachment_name TEXT, reply_to TEXT, pinned INTEGER DEFAULT 0,
  edited_at INTEGER, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at);
CREATE TABLE IF NOT EXISTS reactions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, emoji TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji));
CREATE TABLE IF NOT EXISTS members (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, nickname TEXT, joined_at INTEGER NOT NULL,
  PRIMARY KEY (server_id, user_id));
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY, server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE, name TEXT NOT NULL,
  color TEXT DEFAULT '#8e8e8e', permissions INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0,
  hoist INTEGER DEFAULT 1, is_default INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS member_roles (
  server_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (server_id, user_id, role_id));
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY, server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL, uses INTEGER DEFAULT 0, max_uses INTEGER DEFAULT 0, expires_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bans (server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE, user_id TEXT NOT NULL, reason TEXT, created_at INTEGER, PRIMARY KEY (server_id, user_id));
CREATE TABLE IF NOT EXISTS read_states (user_id TEXT NOT NULL, channel_id TEXT NOT NULL, last_read_at INTEGER NOT NULL, PRIMARY KEY (user_id, channel_id));
CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, text TEXT, bg TEXT, image TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS story_views (story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE, user_id TEXT NOT NULL, PRIMARY KEY (story_id, user_id));
`);

const id = () => crypto.randomBytes(9).toString('base64url');
const now = () => Date.now();

// ---------------------------------------------------------------- permissions
const P = {
  ADMINISTRATOR: 1, MANAGE_SERVER: 2, MANAGE_CHANNELS: 4, MANAGE_ROLES: 8, KICK_MEMBERS: 16,
  BAN_MEMBERS: 32, MANAGE_MESSAGES: 64, CREATE_INVITE: 128, SEND_MESSAGES: 256, CONNECT: 512,
  ATTACH_FILES: 1024, MANAGE_NICKNAMES: 2048,
};
const ALL_PERMS = Object.values(P).reduce((a, b) => a | b, 0);
const DEFAULT_PERMS = P.SEND_MESSAGES | P.CONNECT | P.CREATE_INVITE | P.ATTACH_FILES;

function memberPerms(serverId, userId) {
  const server = db.prepare('SELECT owner_id FROM servers WHERE id=?').get(serverId);
  if (!server) return 0;
  if (!db.prepare('SELECT 1 FROM members WHERE server_id=? AND user_id=?').get(serverId, userId)) return 0;
  if (server.owner_id === userId) return ALL_PERMS;
  const rows = db.prepare(`SELECT r.permissions FROM roles r WHERE r.server_id=? AND (r.is_default=1 OR r.id IN
    (SELECT role_id FROM member_roles WHERE server_id=? AND user_id=?))`).all(serverId, serverId, userId);
  let p = rows.reduce((a, r) => a | r.permissions, 0);
  if (p & P.ADMINISTRATOR) p = ALL_PERMS;
  return p;
}
function topRolePosition(serverId, userId) {
  const s = db.prepare('SELECT owner_id FROM servers WHERE id=?').get(serverId);
  if (s && s.owner_id === userId) return Infinity;
  const r = db.prepare(`SELECT MAX(r.position) p FROM roles r JOIN member_roles mr ON mr.role_id=r.id
    WHERE mr.server_id=? AND mr.user_id=?`).get(serverId, userId);
  return r && r.p != null ? r.p : 0;
}
const has = (perms, flag) => (perms & flag) === flag;

// ---------------------------------------------------------------- helpers
function publicUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, displayName: u.display_name || u.username, avatar: u.avatar,
    banner: u.banner, bio: u.bio, customStatus: u.custom_status, accent: u.accent, online: isOnline(u.id) };
}
const getUser = (uid) => db.prepare('SELECT * FROM users WHERE id=?').get(uid);

function canAccessChannel(userId, channel) {
  if (!channel) return false;
  if (channel.server_id) return memberPerms(channel.server_id, userId) > 0;
  return !!db.prepare('SELECT 1 FROM channel_members WHERE channel_id=? AND user_id=?').get(channel.id, userId);
}
function channelAudience(channel) {
  // returns socket.io room names that should receive events about this channel
  if (channel.server_id) return [`server:${channel.server_id}`];
  return db.prepare('SELECT user_id FROM channel_members WHERE channel_id=?').all(channel.id).map(r => `user:${r.user_id}`);
}
function serializeMessage(m) {
  const author = getUser(m.author_id);
  const reacts = db.prepare('SELECT emoji, user_id FROM reactions WHERE message_id=?').all(m.id);
  const grouped = {};
  for (const r of reacts) (grouped[r.emoji] ||= []).push(r.user_id);
  let reply = null;
  if (m.reply_to) {
    const r = db.prepare('SELECT * FROM messages WHERE id=?').get(m.reply_to);
    if (r) reply = { id: r.id, content: r.content, author: publicUser(getUser(r.author_id)), attachmentType: r.attachment_type };
  }
  return { id: m.id, channelId: m.channel_id, author: publicUser(author), content: m.content,
    attachment: m.attachment_url ? { url: m.attachment_url, type: m.attachment_type, name: m.attachment_name } : null,
    reply, pinned: !!m.pinned, editedAt: m.edited_at, createdAt: m.created_at,
    reactions: Object.entries(grouped).map(([emoji, users]) => ({ emoji, users })) };
}
function areFriends(a, b) {
  return !!db.prepare(`SELECT 1 FROM friendships WHERE status='accepted' AND
    ((requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?))`).get(a, b, b, a);
}
function isBlocked(a, b) {
  return !!db.prepare('SELECT 1 FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)').get(a, b, b, a);
}
function sanitizeName(s, max = 100) { return String(s || '').trim().slice(0, max); }
function slugChannel(s) {
  return sanitizeName(s, 100).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_À-￿]/g, '') || 'channel';
}

// ---------------------------------------------------------------- app
const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });
app.use(express.json({ limit: '1mb' }));
// Front-end files live in ./public (and ./public/js). If they were uploaded flat into the
// project root instead, serve just those known files from the root, and never anything else.
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'public', 'index.html')) ? path.join(__dirname, 'public') : null;
const FLAT_FILES = { '/index.html': 'index.html', '/styles.css': 'styles.css', '/favicon.svg': 'favicon.svg' };
for (const f of ['core', 'auth', 'views', 'modals', 'call', 'main']) FLAT_FILES[`/js/${f}.js`] = `${f}.js`;
const INDEX_FILE = PUBLIC_DIR ? path.join(PUBLIC_DIR, 'index.html') : path.join(__dirname, 'index.html');
if (PUBLIC_DIR) app.use(express.static(PUBLIC_DIR));
else app.get(Object.keys(FLAT_FILES), (req, res) => res.sendFile(path.join(__dirname, FLAT_FILES[req.path])));
app.use('/fonts', express.static(path.join(__dirname, 'node_modules', '@fontsource-variable', 'outfit', 'files'), { maxAge: '30d' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)').run(token, userId, now());
  res.setHeader('Set-Cookie', cookie.serialize('lumi_session', token, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === 'production' }));
}
function userFromCookieHeader(header) {
  const token = cookie.parse(header || '').lumi_session;
  if (!token) return null;
  const s = db.prepare('SELECT user_id FROM sessions WHERE token=?').get(token);
  return s ? getUser(s.user_id) : null;
}
function auth(req, res, next) {
  const u = userFromCookieHeader(req.headers.cookie);
  if (!u) return res.status(401).json({ error: 'Not signed in' });
  req.user = u; next();
}
const wrap = (fn) => (req, res) => {
  try { const out = fn(req, res); if (out !== undefined && !res.headersSent) res.json(out); }
  catch (e) { if (!e.status) console.error(e); if (!res.headersSent) res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' }); }
};
const fail = (status, message) => Object.assign(new Error(message), { status });

// rate-limit auth attempts (simple in-memory)
const attempts = new Map();
function rateLimit(key, max = 10, windowMs = 60_000) {
  const t = now(); const a = (attempts.get(key) || []).filter(x => t - x < windowMs);
  a.push(t); attempts.set(key, a);
  if (a.length > max) throw fail(429, 'Too many attempts. Try again in a minute.');
}

// ---------------------------------------------------------------- auth
const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
if (process.env.TURN_URL) ICE_SERVERS.push({ urls: process.env.TURN_URL.split(','), username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
const isLocalRequest = (req) => /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress || '') && !req.headers['x-forwarded-for'];
app.get('/api/config', (req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID || null, iceServers: ICE_SERVERS, canSetup: isLocalRequest(req) }));
// One-click Google setup: only from the computer running Lumi.
app.post('/api/setup/google', (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ error: 'Google sign-in can only be set up on the computer running Lumi.' });
  const clientId = String(req.body.clientId || '').trim();
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) return res.status(400).json({ error: 'That doesn\u2019t look like a Client ID. It should end in .apps.googleusercontent.com' });
  const envPath = path.join(__dirname, '.env');
  let env = ''; try { env = fs.readFileSync(envPath, 'utf8'); } catch {}
  env = /^GOOGLE_CLIENT_ID=.*$/m.test(env) ? env.replace(/^GOOGLE_CLIENT_ID=.*$/m, `GOOGLE_CLIENT_ID=${clientId}`) : (env && !env.endsWith('\n') ? env + '\n' : env) + `GOOGLE_CLIENT_ID=${clientId}\n`;
  fs.writeFileSync(envPath, env);
  GOOGLE_CLIENT_ID = clientId; googleClient = new OAuth2Client(clientId);
  console.log('  Google sign-in: enabled');
  res.json({ ok: true });
});

function uniqueUsername(base) {
  base = (base || 'user').toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 24) || 'user';
  let name = base, n = 0;
  while (db.prepare('SELECT 1 FROM users WHERE username=?').get(name)) name = `${base}${++n}`;
  return name;
}

app.post('/api/auth/signup', wrap((req, res) => {
  rateLimit('signup:' + req.ip);
  const email = String(req.body.email || '').trim().toLowerCase();
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const displayName = sanitizeName(req.body.displayName, 32) || username;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'Enter a valid email address.');
  if (!/^[a-z0-9_.]{2,24}$/.test(username)) throw fail(400, 'Username must be 2–24 characters: letters, numbers, _ or .');
  if (password.length < 8) throw fail(400, 'Password must be at least 8 characters.');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw fail(409, 'That email is already registered.');
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) throw fail(409, 'That username is taken.');
  const uid = id();
  db.prepare(`INSERT INTO users (id,email,username,display_name,password_hash,created_at) VALUES (?,?,?,?,?,?)`)
    .run(uid, email, username, displayName, bcrypt.hashSync(password, 10), now());
  createSession(res, uid);
  return { user: publicUser(getUser(uid)) };
}));

app.post('/api/auth/login', wrap((req, res) => {
  rateLimit('login:' + req.ip);
  const login = String(req.body.login || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email=? OR username=?').get(login, login);
  if (!u || !u.password_hash || !bcrypt.compareSync(String(req.body.password || ''), u.password_hash))
    throw fail(401, u && !u.password_hash ? 'This account uses Google sign-in.' : 'Incorrect email/username or password.');
  createSession(res, u.id);
  return { user: publicUser(u) };
}));

let googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
app.post('/api/auth/google', async (req, res) => {
  try {
    if (!googleClient) return res.status(400).json({ error: 'Google sign-in is not configured on this server.' });
    const ticket = await googleClient.verifyIdToken({ idToken: String(req.body.credential || ''), audience: GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p.email_verified) return res.status(400).json({ error: 'Google email is not verified.' });
    let u = db.prepare('SELECT * FROM users WHERE google_id=?').get(p.sub)
         || db.prepare('SELECT * FROM users WHERE email=?').get(p.email.toLowerCase());
    if (u && !u.google_id) db.prepare('UPDATE users SET google_id=? WHERE id=?').run(p.sub, u.id);
    if (!u) {
      const uid = id();
      db.prepare(`INSERT INTO users (id,email,username,display_name,google_id,avatar,created_at) VALUES (?,?,?,?,?,?,?)`)
        .run(uid, p.email.toLowerCase(), uniqueUsername(p.email.split('@')[0]), p.name || p.email, p.sub, p.picture || null, now());
      u = getUser(uid);
    }
    createSession(res, u.id);
    res.json({ user: publicUser(getUser(u.id)) });
  } catch (e) { console.error(e); res.status(401).json({ error: 'Google sign-in failed.' }); }
});

app.post('/api/auth/logout', (req, res) => {
  const token = cookie.parse(req.headers.cookie || '').lumi_session;
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  res.setHeader('Set-Cookie', cookie.serialize('lumi_session', '', { path: '/', maxAge: 0 }));
  res.json({ ok: true });
});

// ---------------------------------------------------------------- uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, id() + path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10)),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});
app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const mt = req.file.mimetype || '';
  const type = mt.startsWith('image/') ? 'image' : mt.startsWith('video/') ? 'video' : mt.startsWith('audio/') ? 'audio' : 'file';
  res.json({ url: '/uploads/' + req.file.filename, type, name: req.file.originalname.slice(0, 200) });
});

// ---------------------------------------------------------------- me / users
app.get('/api/me', auth, wrap(req => ({ user: { ...publicUser(req.user), email: req.user.email, hasPassword: !!req.user.password_hash } })));

app.patch('/api/me', auth, wrap(req => {
  const b = req.body, u = req.user;
  const fields = {
    display_name: b.displayName !== undefined ? sanitizeName(b.displayName, 32) || u.username : u.display_name,
    bio: b.bio !== undefined ? String(b.bio).slice(0, 190) : u.bio,
    custom_status: b.customStatus !== undefined ? String(b.customStatus).slice(0, 80) : u.custom_status,
    avatar: b.avatar !== undefined ? b.avatar : u.avatar,
    banner: b.banner !== undefined ? b.banner : u.banner,
    accent: b.accent !== undefined && /^#[0-9a-f]{6}$/i.test(b.accent) ? b.accent : u.accent,
    username: u.username,
  };
  if (b.username !== undefined && b.username !== u.username) {
    const un = String(b.username).trim().toLowerCase();
    if (!/^[a-z0-9_.]{2,24}$/.test(un)) throw fail(400, 'Username must be 2–24 characters: letters, numbers, _ or .');
    if (db.prepare('SELECT 1 FROM users WHERE username=? AND id<>?').get(un, u.id)) throw fail(409, 'That username is taken.');
    fields.username = un;
  }
  db.prepare(`UPDATE users SET display_name=@display_name, bio=@bio, custom_status=@custom_status, avatar=@avatar,
    banner=@banner, accent=@accent, username=@username WHERE id=@id`).run({ ...fields, id: u.id });
  const pub = publicUser(getUser(u.id));
  broadcastUserUpdate(u.id, pub);
  return { user: pub };
}));

app.post('/api/me/password', auth, wrap(req => {
  const { current, next } = req.body;
  if (req.user.password_hash && !bcrypt.compareSync(String(current || ''), req.user.password_hash)) throw fail(401, 'Current password is incorrect.');
  if (String(next || '').length < 8) throw fail(400, 'New password must be at least 8 characters.');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(String(next), 10), req.user.id);
  return { ok: true };
}));

app.get('/api/users/:id', auth, wrap(req => {
  const u = getUser(req.params.id);
  if (!u) throw fail(404, 'User not found');
  const mutualServers = db.prepare(`SELECT s.id, s.name, s.icon FROM servers s JOIN members a ON a.server_id=s.id AND a.user_id=?
    JOIN members b ON b.server_id=s.id AND b.user_id=?`).all(req.user.id, u.id);
  const f = db.prepare(`SELECT * FROM friendships WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)`)
    .get(req.user.id, u.id, u.id, req.user.id);
  let relationship = 'none';
  if (f) relationship = f.status === 'accepted' ? 'friend' : (f.requester_id === req.user.id ? 'outgoing' : 'incoming');
  if (db.prepare('SELECT 1 FROM blocks WHERE user_id=? AND blocked_id=?').get(req.user.id, u.id)) relationship = 'blocked';
  return { user: publicUser(u), mutualServers, relationship, memberSince: u.created_at };
}));

// ---------------------------------------------------------------- friends
function friendList(uid) {
  const rows = db.prepare(`SELECT * FROM friendships WHERE requester_id=? OR addressee_id=?`).all(uid, uid);
  const out = rows.map(f => {
    const other = f.requester_id === uid ? f.addressee_id : f.requester_id;
    return { user: publicUser(getUser(other)),
      type: f.status === 'accepted' ? 'friend' : (f.requester_id === uid ? 'outgoing' : 'incoming'), since: f.created_at };
  });
  const blocked = db.prepare('SELECT blocked_id FROM blocks WHERE user_id=?').all(uid)
    .map(b => ({ user: publicUser(getUser(b.blocked_id)), type: 'blocked' }));
  return out.concat(blocked).filter(x => x.user);
}
app.get('/api/friends', auth, wrap(req => ({ friends: friendList(req.user.id) })));

app.post('/api/friends/request', auth, wrap(req => {
  const un = String(req.body.username || '').trim().toLowerCase().replace(/^@/, '');
  const target = db.prepare('SELECT * FROM users WHERE username=?').get(un);
  if (!target) throw fail(404, `No one goes by @${un}. Double-check the username.`);
  if (target.id === req.user.id) throw fail(400, "You can't add yourself.");
  if (isBlocked(req.user.id, target.id)) throw fail(403, "You can't send a request to this user.");
  const existing = db.prepare(`SELECT * FROM friendships WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)`)
    .get(req.user.id, target.id, target.id, req.user.id);
  if (existing) {
    if (existing.status === 'accepted') throw fail(409, `You're already friends with @${un}.`);
    if (existing.requester_id === req.user.id) throw fail(409, 'Request already sent.');
    db.prepare(`UPDATE friendships SET status='accepted' WHERE requester_id=? AND addressee_id=?`).run(target.id, req.user.id);
  } else {
    db.prepare('INSERT INTO friendships VALUES (?,?,?,?)').run(req.user.id, target.id, 'pending', now());
  }
  io.to(`user:${target.id}`).to(`user:${req.user.id}`).emit('friends:update', { from: publicUser(req.user) , kind: existing ? 'accepted' : 'request', to: target.id });
  return { ok: true };
}));
app.post('/api/friends/:id/accept', auth, wrap(req => {
  const r = db.prepare(`UPDATE friendships SET status='accepted' WHERE requester_id=? AND addressee_id=? AND status='pending'`).run(req.params.id, req.user.id);
  if (!r.changes) throw fail(404, 'No pending request');
  io.to(`user:${req.params.id}`).to(`user:${req.user.id}`).emit('friends:update', { kind: 'accepted', from: publicUser(req.user), to: req.params.id });
  return { ok: true };
}));
app.delete('/api/friends/:id', auth, wrap(req => {
  db.prepare(`DELETE FROM friendships WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)`)
    .run(req.user.id, req.params.id, req.params.id, req.user.id);
  io.to(`user:${req.params.id}`).to(`user:${req.user.id}`).emit('friends:update', { kind: 'removed' });
  return { ok: true };
}));
app.post('/api/friends/:id/block', auth, wrap(req => {
  if (req.params.id === req.user.id) throw fail(400, "You can't block yourself.");
  db.prepare(`DELETE FROM friendships WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)`)
    .run(req.user.id, req.params.id, req.params.id, req.user.id);
  db.prepare('INSERT OR IGNORE INTO blocks VALUES (?,?)').run(req.user.id, req.params.id);
  io.to(`user:${req.params.id}`).to(`user:${req.user.id}`).emit('friends:update', { kind: 'removed' });
  return { ok: true };
}));
app.delete('/api/friends/:id/block', auth, wrap(req => {
  db.prepare('DELETE FROM blocks WHERE user_id=? AND blocked_id=?').run(req.user.id, req.params.id);
  io.to(`user:${req.user.id}`).emit('friends:update', { kind: 'removed' });
  return { ok: true };
}));

// ---------------------------------------------------------------- DMs & group DMs
function lastReadAt(uid, cid) {
  const r = db.prepare('SELECT last_read_at FROM read_states WHERE user_id=? AND channel_id=?').get(uid, cid);
  return r ? r.last_read_at : 0;
}
function unreadCount(uid, cid) {
  return db.prepare('SELECT COUNT(*) c FROM messages WHERE channel_id=? AND created_at>? AND author_id<>?').get(cid, lastReadAt(uid, cid), uid).c;
}
function serializeDM(c, uid) {
  const members = db.prepare('SELECT user_id FROM channel_members WHERE channel_id=?').all(c.id).map(r => publicUser(getUser(r.user_id))).filter(Boolean);
  const last = db.prepare('SELECT * FROM messages WHERE channel_id=? ORDER BY created_at DESC LIMIT 1').get(c.id);
  return { id: c.id, type: c.type, name: c.name, icon: c.icon, ownerId: c.owner_id, members,
    recipients: members.filter(m => m.id !== uid),
    lastMessage: last ? { content: last.content, authorId: last.author_id, createdAt: last.created_at, attachmentType: last.attachment_type } : null,
    lastActivity: last ? last.created_at : c.created_at, unread: unreadCount(uid, c.id) };
}
app.get('/api/dms', auth, wrap(req => {
  const chans = db.prepare(`SELECT c.* FROM channels c JOIN channel_members m ON m.channel_id=c.id WHERE m.user_id=? AND c.type IN ('dm','group')`).all(req.user.id);
  return { dms: chans.map(c => serializeDM(c, req.user.id)).sort((a, b) => b.lastActivity - a.lastActivity) };
}));
app.post('/api/dms', auth, wrap(req => {
  const other = getUser(req.body.userId);
  if (!other || other.id === req.user.id) throw fail(404, 'User not found');
  if (isBlocked(req.user.id, other.id)) throw fail(403, 'You cannot message this user.');
  let c = db.prepare(`SELECT c.* FROM channels c WHERE c.type='dm' AND
    EXISTS (SELECT 1 FROM channel_members WHERE channel_id=c.id AND user_id=?) AND
    EXISTS (SELECT 1 FROM channel_members WHERE channel_id=c.id AND user_id=?)`).get(req.user.id, other.id);
  if (!c) {
    const cid = id();
    db.prepare(`INSERT INTO channels (id,type,created_at) VALUES (?,?,?)`).run(cid, 'dm', now());
    db.prepare('INSERT INTO channel_members VALUES (?,?)').run(cid, req.user.id);
    db.prepare('INSERT INTO channel_members VALUES (?,?)').run(cid, other.id);
    c = db.prepare('SELECT * FROM channels WHERE id=?').get(cid);
  }
  return { dm: serializeDM(c, req.user.id) };
}));
app.post('/api/dms/group', auth, wrap(req => {
  const ids = [...new Set((req.body.userIds || []).map(String))].filter(x => x !== req.user.id);
  if (ids.length < 1) throw fail(400, 'Pick at least one friend.');
  if (ids.length > 9) throw fail(400, 'Group DMs can have up to 10 people.');
  for (const u of ids) if (!areFriends(req.user.id, u)) throw fail(403, 'You can only add friends to a group.');
  const cid = id();
  db.prepare(`INSERT INTO channels (id,type,name,owner_id,created_at) VALUES (?,?,?,?,?)`)
    .run(cid, 'group', sanitizeName(req.body.name, 60) || null, req.user.id, now());
  for (const u of [req.user.id, ...ids]) db.prepare('INSERT INTO channel_members VALUES (?,?)').run(cid, u);
  const c = db.prepare('SELECT * FROM channels WHERE id=?').get(cid);
  for (const u of [req.user.id, ...ids]) io.to(`user:${u}`).emit('dms:update');
  return { dm: serializeDM(c, req.user.id) };
}));
app.patch('/api/dms/:id', auth, wrap(req => {
  const c = db.prepare(`SELECT * FROM channels WHERE id=? AND type='group'`).get(req.params.id);
  if (!c || !canAccessChannel(req.user.id, c)) throw fail(404, 'Not found');
  if (req.body.name !== undefined) db.prepare('UPDATE channels SET name=? WHERE id=?').run(sanitizeName(req.body.name, 60) || null, c.id);
  if (req.body.icon !== undefined) db.prepare('UPDATE channels SET icon=? WHERE id=?').run(req.body.icon, c.id);
  if (Array.isArray(req.body.addUserIds)) for (const u of req.body.addUserIds) {
    if (areFriends(req.user.id, u)) db.prepare('INSERT OR IGNORE INTO channel_members VALUES (?,?)').run(c.id, u);
  }
  for (const r of channelAudience(c)) io.to(r).emit('dms:update');
  return { ok: true };
}));
app.delete('/api/dms/:id', auth, wrap(req => { // leave group
  const c = db.prepare(`SELECT * FROM channels WHERE id=? AND type='group'`).get(req.params.id);
  if (!c) throw fail(404, 'Not found');
  const aud = channelAudience(c);
  db.prepare('DELETE FROM channel_members WHERE channel_id=? AND user_id=?').run(c.id, req.user.id);
  const left = db.prepare('SELECT COUNT(*) n FROM channel_members WHERE channel_id=?').get(c.id).n;
  if (!left) db.prepare('DELETE FROM channels WHERE id=?').run(c.id);
  else if (c.owner_id === req.user.id) {
    const next = db.prepare('SELECT user_id FROM channel_members WHERE channel_id=? LIMIT 1').get(c.id);
    db.prepare('UPDATE channels SET owner_id=? WHERE id=?').run(next.user_id, c.id);
  }
  for (const r of aud) io.to(r).emit('dms:update');
  return { ok: true };
}));

// ---------------------------------------------------------------- messages
function getChannelOr404(cid, uid) {
  const c = db.prepare('SELECT * FROM channels WHERE id=?').get(cid);
  if (!c || !canAccessChannel(uid, c)) throw fail(404, 'Room not found');
  return c;
}
app.get('/api/channels/:id/messages', auth, wrap(req => {
  const c = getChannelOr404(req.params.id, req.user.id);
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
  const q = String(req.query.q || '').trim();
  const rows = q
    ? db.prepare(`SELECT * FROM messages WHERE channel_id=? AND content LIKE ? ORDER BY created_at DESC LIMIT 50`).all(c.id, `%${q}%`)
    : db.prepare(`SELECT * FROM messages WHERE channel_id=? AND created_at<? ORDER BY created_at DESC LIMIT 50`).all(c.id, before);
  return { messages: rows.reverse().map(serializeMessage), hasMore: rows.length === 50 };
}));
app.get('/api/channels/:id/pins', auth, wrap(req => {
  const c = getChannelOr404(req.params.id, req.user.id);
  return { messages: db.prepare('SELECT * FROM messages WHERE channel_id=? AND pinned=1 ORDER BY created_at DESC').all(c.id).map(serializeMessage) };
}));
app.post('/api/channels/:id/messages', auth, wrap(req => {
  const c = getChannelOr404(req.params.id, req.user.id);
  if (c.type === 'voice') throw fail(400, 'Lounges don’t have text chat');
  if (c.server_id && !has(memberPerms(c.server_id, req.user.id), P.SEND_MESSAGES)) throw fail(403, 'You can’t send messages in this room.');
  if (c.type === 'dm') {
    const other = db.prepare('SELECT user_id FROM channel_members WHERE channel_id=? AND user_id<>?').get(c.id, req.user.id);
    if (other && isBlocked(req.user.id, other.user_id)) throw fail(403, 'You cannot message this user.');
  }
  const content = String(req.body.content || '').slice(0, 4000);
  const a = req.body.attachment;
  if (a && c.server_id && !has(memberPerms(c.server_id, req.user.id), P.ATTACH_FILES)) throw fail(403, 'You cannot attach files here.');
  if (!content.trim() && !a) throw fail(400, 'Message is empty');
  const attachment = a && typeof a.url === 'string' && a.url.startsWith('/uploads/') ? a : null;
  const mid = id();
  const replyTo = req.body.replyTo && db.prepare('SELECT 1 FROM messages WHERE id=? AND channel_id=?').get(req.body.replyTo, c.id) ? req.body.replyTo : null;
  db.prepare(`INSERT INTO messages (id,channel_id,author_id,content,attachment_url,attachment_type,attachment_name,reply_to,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(mid, c.id, req.user.id, content, attachment?.url || null, attachment?.type || null,
    attachment?.name || null, replyTo, now());
  db.prepare('INSERT OR REPLACE INTO read_states VALUES (?,?,?)').run(req.user.id, c.id, now());
  const msg = serializeMessage(db.prepare('SELECT * FROM messages WHERE id=?').get(mid));
  let rooms = channelAudience(c);
  if (c.type === 'dm' || c.type === 'group') {
    // drop blocked recipients
    rooms = rooms.filter(r => !isBlocked(req.user.id, r.slice(5)));
  }
  for (const r of rooms) io.to(r).emit('message:new', { message: msg, serverId: c.server_id });
  return { message: msg };
}));
function loadMessageForEdit(mid, uid) {
  const m = db.prepare('SELECT * FROM messages WHERE id=?').get(mid);
  if (!m) throw fail(404, 'Message not found');
  const c = getChannelOr404(m.channel_id, uid);
  return { m, c };
}
app.patch('/api/messages/:id', auth, wrap(req => {
  const { m, c } = loadMessageForEdit(req.params.id, req.user.id);
  if (m.author_id !== req.user.id) throw fail(403, 'You can only edit your own messages.');
  const content = String(req.body.content || '').slice(0, 4000);
  if (!content.trim() && !m.attachment_url) throw fail(400, 'Message is empty');
  db.prepare('UPDATE messages SET content=?, edited_at=? WHERE id=?').run(content, now(), m.id);
  const msg = serializeMessage(db.prepare('SELECT * FROM messages WHERE id=?').get(m.id));
  for (const r of channelAudience(c)) io.to(r).emit('message:update', { message: msg });
  return { message: msg };
}));
app.delete('/api/messages/:id', auth, wrap(req => {
  const { m, c } = loadMessageForEdit(req.params.id, req.user.id);
  const canManage = c.server_id && has(memberPerms(c.server_id, req.user.id), P.MANAGE_MESSAGES);
  if (m.author_id !== req.user.id && !canManage) throw fail(403, 'You cannot delete this message.');
  db.prepare('DELETE FROM messages WHERE id=?').run(m.id);
  for (const r of channelAudience(c)) io.to(r).emit('message:delete', { id: m.id, channelId: c.id });
  return { ok: true };
}));
app.post('/api/messages/:id/reactions', auth, wrap(req => {
  const { m, c } = loadMessageForEdit(req.params.id, req.user.id);
  const emoji = String(req.body.emoji || '').slice(0, 16);
  if (!emoji) throw fail(400, 'No emoji');
  const exists = db.prepare('SELECT 1 FROM reactions WHERE message_id=? AND user_id=? AND emoji=?').get(m.id, req.user.id, emoji);
  if (exists && req.body.force !== 'add') db.prepare('DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?').run(m.id, req.user.id, emoji);
  else db.prepare('INSERT OR IGNORE INTO reactions VALUES (?,?,?)').run(m.id, req.user.id, emoji);
  const msg = serializeMessage(m);
  for (const r of channelAudience(c)) io.to(r).emit('message:update', { message: msg });
  return { message: msg };
}));
app.post('/api/messages/:id/pin', auth, wrap(req => {
  const { m, c } = loadMessageForEdit(req.params.id, req.user.id);
  if (c.server_id && !has(memberPerms(c.server_id, req.user.id), P.MANAGE_MESSAGES)) throw fail(403, 'You need Manage Messages to pin.');
  db.prepare('UPDATE messages SET pinned=? WHERE id=?').run(m.pinned ? 0 : 1, m.id);
  const msg = serializeMessage(db.prepare('SELECT * FROM messages WHERE id=?').get(m.id));
  for (const r of channelAudience(c)) io.to(r).emit('message:update', { message: msg });
  return { message: msg };
}));
app.post('/api/channels/:id/read', auth, wrap(req => {
  const c = getChannelOr404(req.params.id, req.user.id);
  db.prepare('INSERT OR REPLACE INTO read_states VALUES (?,?,?)').run(req.user.id, c.id, now());
  return { ok: true };
}));

// ---------------------------------------------------------------- servers
function serverSummary(s, uid) {
  const chans = db.prepare(`SELECT id FROM channels WHERE server_id=? AND type='text'`).all(s.id);
  const unread = chans.reduce((a, c) => a + unreadCount(uid, c.id), 0);
  return { id: s.id, name: s.name, icon: s.icon, unread };
}
app.get('/api/servers', auth, wrap(req => {
  const rows = db.prepare(`SELECT s.* FROM servers s JOIN members m ON m.server_id=s.id WHERE m.user_id=? ORDER BY m.joined_at`).all(req.user.id);
  return { servers: rows.map(s => serverSummary(s, req.user.id)) };
}));
function serverDetail(sid, uid) {
  const s = db.prepare('SELECT * FROM servers WHERE id=?').get(sid);
  const perms = memberPerms(sid, uid);
  if (!s || !perms) throw fail(404, 'Space not found');
  const channels = db.prepare('SELECT * FROM channels WHERE server_id=? ORDER BY position, created_at').all(sid)
    .map(c => ({ id: c.id, type: c.type, name: c.name, topic: c.topic, position: c.position,
      unread: c.type === 'text' ? unreadCount(uid, c.id) : 0 }));
  const roles = db.prepare('SELECT * FROM roles WHERE server_id=? ORDER BY position DESC').all(sid)
    .map(r => ({ id: r.id, name: r.name, color: r.color, permissions: r.permissions, position: r.position, hoist: !!r.hoist, isDefault: !!r.is_default }));
  const mr = db.prepare('SELECT user_id, role_id FROM member_roles WHERE server_id=?').all(sid);
  const members = db.prepare('SELECT * FROM members WHERE server_id=?').all(sid).map(m => ({
    user: publicUser(getUser(m.user_id)), nickname: m.nickname, joinedAt: m.joined_at,
    roleIds: mr.filter(x => x.user_id === m.user_id).map(x => x.role_id) })).filter(m => m.user);
  return { server: { id: s.id, name: s.name, icon: s.icon, banner: s.banner, description: s.description, ownerId: s.owner_id, createdAt: s.created_at },
    channels, roles, members, myPermissions: perms, myTopPosition: Math.min(topRolePosition(sid, uid), 1e9), voice: voiceStatesForServer(sid) };
}
app.get('/api/servers/:id', auth, wrap(req => serverDetail(req.params.id, req.user.id)));

function addMember(sid, uid) {
  db.prepare('INSERT OR IGNORE INTO members (server_id,user_id,joined_at) VALUES (?,?,?)').run(sid, uid, now());
  for (const s of io.sockets.adapter.rooms.get(`user:${uid}`) || []) io.sockets.sockets.get(s)?.join(`server:${sid}`);
}
function removeFromServerRooms(sid, uid) {
  for (const s of io.sockets.adapter.rooms.get(`user:${uid}`) || []) {
    const sock = io.sockets.sockets.get(s);
    if (sock) { sock.leave(`server:${sid}`); leaveVoice(sock, { serverId: sid }); }
  }
}
app.post('/api/servers', auth, wrap(req => {
  const name = sanitizeName(req.body.name, 100);
  if (!name) throw fail(400, 'Give your space a name.');
  const sid = id();
  db.prepare('INSERT INTO servers (id,name,icon,description,owner_id,created_at) VALUES (?,?,?,?,?,?)')
    .run(sid, name, req.body.icon || null, '', req.user.id, now());
  db.prepare('INSERT INTO roles (id,server_id,name,color,permissions,position,is_default) VALUES (?,?,?,?,?,?,1)')
    .run(id(), sid, '@everyone', '#8e8e8e', DEFAULT_PERMS, 0);
  const t = req.body.template || 'default';
  const textChans = t === 'gaming' ? ['General', 'Highlights', 'Looking for group'] : t === 'study' ? ['General', 'Homework help', 'Resources'] : ['General', 'Say hi 👋', 'Photos & clips'];
  textChans.forEach((n, i) => db.prepare('INSERT INTO channels (id,server_id,type,name,position,created_at) VALUES (?,?,?,?,?,?)').run(id(), sid, 'text', n, i, now()));
  ['The Lounge', t === 'gaming' ? 'Squad up' : 'Chill zone'].forEach((n, i) => db.prepare('INSERT INTO channels (id,server_id,type,name,position,created_at) VALUES (?,?,?,?,?,?)').run(id(), sid, 'voice', n, 100 + i, now()));
  addMember(sid, req.user.id);
  return serverDetail(sid, req.user.id);
}));
app.patch('/api/servers/:id', auth, wrap(req => {
  const sid = req.params.id;
  if (!has(memberPerms(sid, req.user.id), P.MANAGE_SERVER)) throw fail(403, 'You need the Manage Space permission.');
  const s = db.prepare('SELECT * FROM servers WHERE id=?').get(sid);
  const b = req.body;
  db.prepare('UPDATE servers SET name=?, icon=?, banner=?, description=? WHERE id=?').run(
    b.name !== undefined ? sanitizeName(b.name, 100) || s.name : s.name,
    b.icon !== undefined ? b.icon : s.icon, b.banner !== undefined ? b.banner : s.banner,
    b.description !== undefined ? String(b.description).slice(0, 300) : s.description, sid);
  if (b.ownerId && s.owner_id === req.user.id && db.prepare('SELECT 1 FROM members WHERE server_id=? AND user_id=?').get(sid, b.ownerId))
    db.prepare('UPDATE servers SET owner_id=? WHERE id=?').run(b.ownerId, sid);
  io.to(`server:${sid}`).emit('server:update', { serverId: sid });
  return serverDetail(sid, req.user.id);
}));
app.delete('/api/servers/:id', auth, wrap(req => {
  const s = db.prepare('SELECT * FROM servers WHERE id=?').get(req.params.id);
  if (!s || s.owner_id !== req.user.id) throw fail(403, 'Only the owner can delete the space.');
  io.to(`server:${s.id}`).emit('server:removed', { serverId: s.id, reason: 'deleted' });
  db.prepare('DELETE FROM servers WHERE id=?').run(s.id);
  return { ok: true };
}));
app.post('/api/servers/:id/leave', auth, wrap(req => {
  const s = db.prepare('SELECT * FROM servers WHERE id=?').get(req.params.id);
  if (!s) throw fail(404, 'Not found');
  if (s.owner_id === req.user.id) throw fail(400, 'Transfer ownership or delete the space before leaving.');
  db.prepare('DELETE FROM members WHERE server_id=? AND user_id=?').run(s.id, req.user.id);
  db.prepare('DELETE FROM member_roles WHERE server_id=? AND user_id=?').run(s.id, req.user.id);
  removeFromServerRooms(s.id, req.user.id);
  io.to(`server:${s.id}`).emit('server:update', { serverId: s.id });
  return { ok: true };
}));

// channels
app.post('/api/servers/:id/channels', auth, wrap(req => {
  const sid = req.params.id;
  if (!has(memberPerms(sid, req.user.id), P.MANAGE_CHANNELS)) throw fail(403, 'You need the Manage Rooms permission.');
  const type = req.body.type === 'voice' ? 'voice' : 'text';
  const name = sanitizeName(req.body.name, 100) || (type === 'text' ? 'New room' : 'Lounge');
  const pos = (db.prepare('SELECT MAX(position) p FROM channels WHERE server_id=? AND type=?').get(sid, type).p ?? (type === 'voice' ? 99 : -1)) + 1;
  db.prepare('INSERT INTO channels (id,server_id,type,name,topic,position,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(id(), sid, type, name, String(req.body.topic || '').slice(0, 300), pos, now());
  io.to(`server:${sid}`).emit('server:update', { serverId: sid });
  return { ok: true };
}));
app.patch('/api/channels/:id', auth, wrap(req => {
  const c = db.prepare('SELECT * FROM channels WHERE id=?').get(req.params.id);
  if (!c || !c.server_id || !has(memberPerms(c.server_id, req.user.id), P.MANAGE_CHANNELS)) throw fail(403, 'Not allowed');
  const name = req.body.name !== undefined ? (sanitizeName(req.body.name, 100) || c.name) : c.name;
  const topic = req.body.topic !== undefined ? String(req.body.topic).slice(0, 300) : c.topic;
  const position = Number.isFinite(req.body.position) ? req.body.position : c.position;
  db.prepare('UPDATE channels SET name=?, topic=?, position=? WHERE id=?').run(name, topic, position, c.id);
  io.to(`server:${c.server_id}`).emit('server:update', { serverId: c.server_id });
  return { ok: true };
}));
app.delete('/api/channels/:id', auth, wrap(req => {
  const c = db.prepare('SELECT * FROM channels WHERE id=?').get(req.params.id);
  if (!c || !c.server_id || !has(memberPerms(c.server_id, req.user.id), P.MANAGE_CHANNELS)) throw fail(403, 'Not allowed');
  db.prepare('DELETE FROM channels WHERE id=?').run(c.id);
  io.to(`server:${c.server_id}`).emit('server:update', { serverId: c.server_id, deletedChannel: c.id });
  return { ok: true };
}));

// invites
app.get('/api/servers/:id/invites', auth, wrap(req => {
  if (!has(memberPerms(req.params.id, req.user.id), P.MANAGE_SERVER)) throw fail(403, 'Not allowed');
  return { invites: db.prepare('SELECT * FROM invites WHERE server_id=? ORDER BY created_at DESC').all(req.params.id)
    .map(i => ({ ...i, creator: publicUser(getUser(i.creator_id)) })) };
}));
app.post('/api/servers/:id/invites', auth, wrap(req => {
  const sid = req.params.id;
  if (!has(memberPerms(sid, req.user.id), P.CREATE_INVITE)) throw fail(403, 'You cannot create invites here.');
  const hours = Number(req.body.expiresInHours ?? 168);
  const maxUses = Math.max(0, Number(req.body.maxUses) || 0);
  const code = crypto.randomBytes(5).toString('base64url');
  db.prepare('INSERT INTO invites VALUES (?,?,?,?,?,?,?)').run(code, sid, req.user.id, 0, maxUses, hours > 0 ? now() + hours * 3600_000 : null, now());
  return { code };
}));
app.delete('/api/invites/:code', auth, wrap(req => {
  const inv = db.prepare('SELECT * FROM invites WHERE code=?').get(req.params.code);
  if (!inv || !has(memberPerms(inv.server_id, req.user.id), P.MANAGE_SERVER)) throw fail(403, 'Not allowed');
  db.prepare('DELETE FROM invites WHERE code=?').run(inv.code);
  return { ok: true };
}));
function validInvite(code) {
  const inv = db.prepare('SELECT * FROM invites WHERE code=?').get(code);
  if (!inv || (inv.expires_at && inv.expires_at < now()) || (inv.max_uses && inv.uses >= inv.max_uses)) return null;
  return inv;
}
app.get('/api/invites/:code', auth, wrap(req => {
  const inv = validInvite(req.params.code);
  if (!inv) throw fail(404, 'This invite is invalid or has expired.');
  const s = db.prepare('SELECT * FROM servers WHERE id=?').get(inv.server_id);
  const count = db.prepare('SELECT COUNT(*) n FROM members WHERE server_id=?').get(s.id).n;
  const online = db.prepare('SELECT user_id FROM members WHERE server_id=?').all(s.id).filter(m => isOnline(m.user_id)).length;
  return { server: { id: s.id, name: s.name, icon: s.icon, banner: s.banner, description: s.description, memberCount: count, onlineCount: online },
    inviter: publicUser(getUser(inv.creator_id)),
    alreadyMember: !!db.prepare('SELECT 1 FROM members WHERE server_id=? AND user_id=?').get(s.id, req.user.id) };
}));
app.post('/api/invites/:code', auth, wrap(req => {
  const inv = validInvite(req.params.code);
  if (!inv) throw fail(404, 'This invite is invalid or has expired.');
  if (db.prepare('SELECT 1 FROM bans WHERE server_id=? AND user_id=?').get(inv.server_id, req.user.id)) throw fail(403, 'You are banned from this space.');
  if (!db.prepare('SELECT 1 FROM members WHERE server_id=? AND user_id=?').get(inv.server_id, req.user.id)) {
    addMember(inv.server_id, req.user.id);
    db.prepare('UPDATE invites SET uses=uses+1 WHERE code=?').run(inv.code);
    io.to(`server:${inv.server_id}`).emit('server:update', { serverId: inv.server_id, joined: publicUser(req.user) });
  }
  return serverDetail(inv.server_id, req.user.id);
}));

// members: kick / ban / nickname / roles
function assertCanModerate(sid, actorId, targetId, flag) {
  if (!has(memberPerms(sid, actorId), flag)) throw fail(403, 'Missing permission.');
  const s = db.prepare('SELECT owner_id FROM servers WHERE id=?').get(sid);
  if (targetId === s.owner_id) throw fail(403, "You can't do that to the server owner.");
  if (targetId !== actorId && topRolePosition(sid, targetId) >= topRolePosition(sid, actorId)) throw fail(403, 'That member has an equal or higher role than you.');
}
app.delete('/api/servers/:id/members/:uid', auth, wrap(req => {
  const { id: sid, uid } = req.params;
  assertCanModerate(sid, req.user.id, uid, P.KICK_MEMBERS);
  db.prepare('DELETE FROM members WHERE server_id=? AND user_id=?').run(sid, uid);
  db.prepare('DELETE FROM member_roles WHERE server_id=? AND user_id=?').run(sid, uid);
  io.to(`user:${uid}`).emit('server:removed', { serverId: sid, reason: 'kicked' });
  removeFromServerRooms(sid, uid);
  io.to(`server:${sid}`).emit('server:update', { serverId: sid });
  return { ok: true };
}));
app.post('/api/servers/:id/bans/:uid', auth, wrap(req => {
  const { id: sid, uid } = req.params;
  assertCanModerate(sid, req.user.id, uid, P.BAN_MEMBERS);
  db.prepare('INSERT OR REPLACE INTO bans VALUES (?,?,?,?)').run(sid, uid, String(req.body.reason || '').slice(0, 200), now());
  db.prepare('DELETE FROM members WHERE server_id=? AND user_id=?').run(sid, uid);
  db.prepare('DELETE FROM member_roles WHERE server_id=? AND user_id=?').run(sid, uid);
  io.to(`user:${uid}`).emit('server:removed', { serverId: sid, reason: 'banned' });
  removeFromServerRooms(sid, uid);
  io.to(`server:${sid}`).emit('server:update', { serverId: sid });
  return { ok: true };
}));
app.get('/api/servers/:id/bans', auth, wrap(req => {
  if (!has(memberPerms(req.params.id, req.user.id), P.BAN_MEMBERS)) throw fail(403, 'Not allowed');
  return { bans: db.prepare('SELECT * FROM bans WHERE server_id=?').all(req.params.id).map(b => ({ user: publicUser(getUser(b.user_id)), reason: b.reason })) };
}));
app.delete('/api/servers/:id/bans/:uid', auth, wrap(req => {
  if (!has(memberPerms(req.params.id, req.user.id), P.BAN_MEMBERS)) throw fail(403, 'Not allowed');
  db.prepare('DELETE FROM bans WHERE server_id=? AND user_id=?').run(req.params.id, req.params.uid);
  return { ok: true };
}));
app.patch('/api/servers/:id/members/:uid', auth, wrap(req => {
  const { id: sid } = req.params;
  const uid = req.params.uid === '@me' ? req.user.id : req.params.uid;
  if (!db.prepare('SELECT 1 FROM members WHERE server_id=? AND user_id=?').get(sid, uid)) throw fail(404, 'Member not found');
  const perms = memberPerms(sid, req.user.id);
  if (req.body.nickname !== undefined) {
    if (uid !== req.user.id) assertCanModerate(sid, req.user.id, uid, P.MANAGE_NICKNAMES);
    else if (!perms) throw fail(403, 'Not allowed');
    db.prepare('UPDATE members SET nickname=? WHERE server_id=? AND user_id=?').run(sanitizeName(req.body.nickname, 32) || null, sid, uid);
  }
  if (Array.isArray(req.body.roleIds)) {
    if (!has(perms, P.MANAGE_ROLES)) throw fail(403, 'You need Manage Roles permission.');
    const myTop = topRolePosition(sid, req.user.id);
    const roles = db.prepare('SELECT * FROM roles WHERE server_id=? AND is_default=0').all(sid);
    const current = new Set(db.prepare('SELECT role_id FROM member_roles WHERE server_id=? AND user_id=?').all(sid, uid).map(r => r.role_id));
    const wanted = new Set(req.body.roleIds);
    for (const r of roles) {
      if (current.has(r.id) === wanted.has(r.id)) continue;
      if (r.position >= myTop) throw fail(403, `You can't assign or remove "${r.name}" — it's at or above your highest role.`);
      if (wanted.has(r.id)) db.prepare('INSERT OR IGNORE INTO member_roles VALUES (?,?,?)').run(sid, uid, r.id);
      else db.prepare('DELETE FROM member_roles WHERE server_id=? AND user_id=? AND role_id=?').run(sid, uid, r.id);
    }
  }
  io.to(`server:${sid}`).emit('server:update', { serverId: sid });
  return { ok: true };
}));

// roles
app.post('/api/servers/:id/roles', auth, wrap(req => {
  const sid = req.params.id;
  if (!has(memberPerms(sid, req.user.id), P.MANAGE_ROLES)) throw fail(403, 'You need Manage Roles permission.');
  const myTop = topRolePosition(sid, req.user.id);
  const maxPos = db.prepare('SELECT MAX(position) p FROM roles WHERE server_id=?').get(sid).p || 0;
  let pos = maxPos + 1;
  if (myTop !== Infinity) {
    // new role goes just below the creator's top role
    db.prepare('UPDATE roles SET position=position+1 WHERE server_id=? AND position>=?').run(sid, myTop);
    pos = myTop;
  }
  const color = /^#[0-9a-f]{6}$/i.test(req.body.color || '') ? req.body.color : '#d62976';
  const perms = (Number(req.body.permissions) || 0) & memberPerms(sid, req.user.id);
  db.prepare('INSERT INTO roles (id,server_id,name,color,permissions,position) VALUES (?,?,?,?,?,?)')
    .run(id(), sid, sanitizeName(req.body.name, 50) || 'new role', color, perms, pos);
  io.to(`server:${sid}`).emit('server:update', { serverId: sid });
  return serverDetail(sid, req.user.id);
}));
app.patch('/api/roles/:id', auth, wrap(req => {
  const r = db.prepare('SELECT * FROM roles WHERE id=?').get(req.params.id);
  if (!r) throw fail(404, 'Role not found');
  const myPerms = memberPerms(r.server_id, req.user.id);
  if (!has(myPerms, P.MANAGE_ROLES)) throw fail(403, 'You need Manage Roles permission.');
  const myTop = topRolePosition(r.server_id, req.user.id);
  if (!r.is_default && r.position >= myTop) throw fail(403, "You can't edit a role at or above your highest role.");
  const b = req.body;
  let perms = r.permissions;
  if (b.permissions !== undefined) {
    // can only toggle permissions you yourself have
    const requested = Number(b.permissions) || 0;
    perms = (r.permissions & ~myPerms) | (requested & myPerms);
  }
  db.prepare('UPDATE roles SET name=?, color=?, permissions=?, hoist=? WHERE id=?').run(
    r.is_default ? '@everyone' : (b.name !== undefined ? sanitizeName(b.name, 50) || r.name : r.name),
    /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : r.color, perms,
    b.hoist !== undefined ? (b.hoist ? 1 : 0) : r.hoist, r.id);
  if (Number.isFinite(b.position) && !r.is_default) {
    const target = Math.max(1, Math.min(b.position, myTop === Infinity ? 1e9 : myTop - 1));
    const ordered = db.prepare('SELECT id FROM roles WHERE server_id=? AND is_default=0 AND id<>? ORDER BY position').all(r.server_id, r.id).map(x => x.id);
    ordered.splice(Math.min(target - 1, ordered.length), 0, r.id);
    ordered.forEach((rid, i) => db.prepare('UPDATE roles SET position=? WHERE id=?').run(i + 1, rid));
  }
  io.to(`server:${r.server_id}`).emit('server:update', { serverId: r.server_id });
  return serverDetail(r.server_id, req.user.id);
}));
app.delete('/api/roles/:id', auth, wrap(req => {
  const r = db.prepare('SELECT * FROM roles WHERE id=?').get(req.params.id);
  if (!r || r.is_default) throw fail(400, 'Cannot delete this role');
  if (!has(memberPerms(r.server_id, req.user.id), P.MANAGE_ROLES) || r.position >= topRolePosition(r.server_id, req.user.id)) throw fail(403, 'Not allowed');
  db.prepare('DELETE FROM roles WHERE id=?').run(r.id);
  io.to(`server:${r.server_id}`).emit('server:update', { serverId: r.server_id });
  return serverDetail(r.server_id, req.user.id);
}));

// ---------------------------------------------------------------- stories (24h)
app.get('/api/stories', auth, wrap(req => {
  const since = now() - 24 * 3600_000;
  const friendIds = friendList(req.user.id).filter(f => f.type === 'friend').map(f => f.user.id);
  const ids = [req.user.id, ...friendIds];
  const rows = db.prepare(`SELECT * FROM stories WHERE created_at>? AND user_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at`).all(since, ...ids);
  const byUser = {};
  for (const s of rows) {
    const seen = !!db.prepare('SELECT 1 FROM story_views WHERE story_id=? AND user_id=?').get(s.id, req.user.id);
    (byUser[s.user_id] ||= []).push({ id: s.id, text: s.text, bg: s.bg, image: s.image, createdAt: s.created_at, seen,
      views: s.user_id === req.user.id ? db.prepare('SELECT COUNT(*) n FROM story_views WHERE story_id=?').get(s.id).n : undefined });
  }
  const list = Object.entries(byUser).map(([uid, items]) => ({ user: publicUser(getUser(uid)), items, allSeen: items.every(i => i.seen) }));
  list.sort((a, b) => (a.user.id === req.user.id ? -1 : b.user.id === req.user.id ? 1 : a.allSeen - b.allSeen));
  return { stories: list };
}));
app.post('/api/stories', auth, wrap(req => {
  const text = String(req.body.text || '').slice(0, 280);
  const image = typeof req.body.image === 'string' && req.body.image.startsWith('/uploads/') ? req.body.image : null;
  if (!text.trim() && !image) throw fail(400, 'Add some text or a photo.');
  db.prepare('INSERT INTO stories VALUES (?,?,?,?,?,?)').run(id(), req.user.id, text, String(req.body.bg || 'sunset').slice(0, 20), image, now());
  const friendIds = friendList(req.user.id).filter(f => f.type === 'friend').map(f => f.user.id);
  for (const f of [req.user.id, ...friendIds]) io.to(`user:${f}`).emit('stories:update');
  return { ok: true };
}));
app.post('/api/stories/:id/view', auth, wrap(req => {
  db.prepare('INSERT OR IGNORE INTO story_views VALUES (?,?)').run(req.params.id, req.user.id);
  return { ok: true };
}));
app.delete('/api/stories/:id', auth, wrap(req => {
  db.prepare('DELETE FROM stories WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  io.to(`user:${req.user.id}`).emit('stories:update');
  return { ok: true };
}));

// SPA fallback (for /invite/CODE links etc.)
app.get(/^\/(?!api|uploads|socket\.io|fonts).*/, (req, res) => res.sendFile(INDEX_FILE));

// ---------------------------------------------------------------- realtime
const onlineCounts = new Map(); // userId -> number of sockets
function isOnline(uid) { return (onlineCounts.get(uid) || 0) > 0; }
function presenceAudience(uid) {
  const rooms = new Set();
  for (const f of db.prepare(`SELECT requester_id a, addressee_id b FROM friendships WHERE (requester_id=? OR addressee_id=?)`).all(uid, uid))
    rooms.add(`user:${f.a === uid ? f.b : f.a}`);
  for (const s of db.prepare('SELECT server_id FROM members WHERE user_id=?').all(uid)) rooms.add(`server:${s.server_id}`);
  for (const c of db.prepare(`SELECT cm2.user_id FROM channel_members cm1 JOIN channel_members cm2 ON cm1.channel_id=cm2.channel_id WHERE cm1.user_id=?`).all(uid))
    rooms.add(`user:${c.user_id}`);
  return [...rooms];
}
function broadcastUserUpdate(uid, pub) {
  let target = io;
  for (const r of presenceAudience(uid)) target = target.to(r);
  target.to(`user:${uid}`).emit('user:update', { user: pub });
}

// Voice / video rooms. roomId === channel id (server voice channel, DM, or group DM).
const voiceRooms = new Map(); // channelId -> Map(socketId -> {userId, muted, deafened, video, screen})
function voiceStatesForServer(sid) {
  const out = {};
  for (const c of db.prepare(`SELECT id FROM channels WHERE server_id=? AND type='voice'`).all(sid)) {
    const room = voiceRooms.get(c.id);
    if (room && room.size) out[c.id] = [...room.values()].map(p => ({ ...p, user: publicUser(getUser(p.userId)) }));
  }
  return out;
}
function emitVoiceState(channelId) {
  const c = db.prepare('SELECT * FROM channels WHERE id=?').get(channelId);
  if (!c) return;
  const room = voiceRooms.get(channelId);
  const participants = room ? [...room.entries()].map(([sid, p]) => ({ socketId: sid, ...p, user: publicUser(getUser(p.userId)) })) : [];
  for (const r of channelAudience(c)) io.to(r).emit('voice:state', { channelId, serverId: c.server_id, participants });
}
function leaveVoice(socket, opts = {}) {
  const cur = socket.data.voiceChannel;
  if (!cur) return;
  if (opts.serverId) {
    const c = db.prepare('SELECT server_id FROM channels WHERE id=?').get(cur);
    if (!c || c.server_id !== opts.serverId) return;
  }
  const room = voiceRooms.get(cur);
  if (room) {
    room.delete(socket.id);
    for (const sid of room.keys()) io.to(sid).emit('rtc:peer-left', { socketId: socket.id });
    if (!room.size) {
      voiceRooms.delete(cur);
      const c = db.prepare('SELECT * FROM channels WHERE id=?').get(cur);
      if (c && !c.server_id) for (const r of channelAudience(c)) io.to(r).emit('call:ended', { channelId: cur });
    }
  }
  socket.leave(`voice:${cur}`);
  socket.data.voiceChannel = null;
  emitVoiceState(cur);
}

io.use((socket, next) => {
  const u = userFromCookieHeader(socket.handshake.headers.cookie);
  if (!u) return next(new Error('unauthorized'));
  socket.data.userId = u.id; next();
});

io.on('connection', (socket) => {
  const uid = socket.data.userId;
  socket.join(`user:${uid}`);
  for (const s of db.prepare('SELECT server_id FROM members WHERE user_id=?').all(uid)) socket.join(`server:${s.server_id}`);
  const wasOnline = isOnline(uid);
  onlineCounts.set(uid, (onlineCounts.get(uid) || 0) + 1);
  if (!wasOnline) { let t = io; for (const r of presenceAudience(uid)) t = t.to(r); t.emit('presence', { userId: uid, online: true }); }

  // send current DM call states so a reconnecting client sees ongoing calls
  for (const c of db.prepare(`SELECT channel_id FROM channel_members WHERE user_id=?`).all(uid)) {
    const room = voiceRooms.get(c.channel_id);
    if (room && room.size) emitVoiceState(c.channel_id);
  }

  socket.on('typing', ({ channelId } = {}) => {
    const c = db.prepare('SELECT * FROM channels WHERE id=?').get(channelId);
    if (!c || !canAccessChannel(uid, c)) return;
    for (const r of channelAudience(c)) socket.to(r).emit('typing', { channelId, userId: uid, serverId: c.server_id });
  });

  socket.on('voice:join', ({ channelId } = {}, ack) => {
    const c = db.prepare('SELECT * FROM channels WHERE id=?').get(channelId);
    if (!c || !canAccessChannel(uid, c)) return ack?.({ error: 'No access' });
    if (c.server_id && !has(memberPerms(c.server_id, uid), P.CONNECT)) return ack?.({ error: 'You can’t join this lounge.' });
    if (c.server_id === null && c.type === 'text') return ack?.({ error: 'Not a call channel' });
    if (socket.data.voiceChannel) leaveVoice(socket);
    // only one active voice connection per user: kick other sockets of same user
    for (const [cid, room] of voiceRooms) for (const [sid, p] of room) if (p.userId === uid && sid !== socket.id) {
      const other = io.sockets.sockets.get(sid); if (other) { leaveVoice(other); other.emit('voice:force-leave', {}); }
    }
    let room = voiceRooms.get(c.id);
    const wasEmpty = !room || room.size === 0;
    if (!room) voiceRooms.set(c.id, room = new Map());
    const peers = [...room.keys()];
    room.set(socket.id, { userId: uid, muted: false, deafened: false, video: false, screen: false });
    socket.data.voiceChannel = c.id;
    socket.join(`voice:${c.id}`);
    ack?.({ ok: true, peers: peers.map(sid => ({ socketId: sid, ...room.get(sid), user: publicUser(getUser(room.get(sid).userId)) })) });
    emitVoiceState(c.id);
    // ring the other members when a DM/group call starts
    if (!c.server_id && wasEmpty) {
      const caller = publicUser(getUser(uid));
      for (const m of db.prepare('SELECT user_id FROM channel_members WHERE channel_id=? AND user_id<>?').all(c.id, uid)) {
        if (isBlocked(uid, m.user_id)) continue;
        io.to(`user:${m.user_id}`).emit('call:ring', { channelId: c.id, caller, type: c.type });
      }
    }
  });
  socket.on('voice:leave', () => leaveVoice(socket));
  socket.on('voice:update', (patch = {}) => {
    const cid = socket.data.voiceChannel; const room = cid && voiceRooms.get(cid);
    if (!room || !room.has(socket.id)) return;
    const p = room.get(socket.id);
    for (const k of ['muted', 'deafened', 'video', 'screen', 'speaking']) if (k in patch) p[k] = !!patch[k];
    if ('speaking' in patch && Object.keys(patch).length === 1) {
      io.to(`voice:${cid}`).emit('voice:speaking', { socketId: socket.id, userId: uid, speaking: p.speaking });
      return;
    }
    emitVoiceState(cid);
  });
  socket.on('call:decline', ({ channelId } = {}) => {
    const c = db.prepare('SELECT * FROM channels WHERE id=?').get(channelId);
    if (!c || !canAccessChannel(uid, c)) return;
    io.to(`voice:${c.id}`).emit('call:declined', { channelId, user: publicUser(getUser(uid)) });
    // tell this user's other devices to stop ringing
    io.to(`user:${uid}`).emit('call:stop-ring', { channelId });
  });
  // relay WebRTC signaling between peers in the same voice room
  socket.on('rtc:signal', ({ to, data } = {}) => {
    const cid = socket.data.voiceChannel;
    const room = cid && voiceRooms.get(cid);
    if (!room || !room.has(to)) return;
    io.to(to).emit('rtc:signal', { from: socket.id, userId: uid, data });
  });

  socket.on('disconnect', () => {
    leaveVoice(socket);
    const n = (onlineCounts.get(uid) || 1) - 1;
    if (n <= 0) {
      onlineCounts.delete(uid);
      let t = io; for (const r of presenceAudience(uid)) t = t.to(r); t.emit('presence', { userId: uid, online: false });
    } else onlineCounts.set(uid, n);
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n  Port ${PORT} is already in use — Lumi may already be running. Open http://localhost:${PORT}\n`);
  else console.error(e);
  process.exit(1);
});
server.listen(PORT, () => {
  console.log(`\n  ✨ Lumi is running at http://localhost:${PORT}`);
  if (process.env.LUMI_OPEN === '1') {
    const url = `http://localhost:${PORT}`;
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    require('child_process').exec(cmd, () => {});
  }
  console.log(GOOGLE_CLIENT_ID ? '  Google sign-in: enabled' : '  Google sign-in: disabled (set GOOGLE_CLIENT_ID in .env to enable)');
});
