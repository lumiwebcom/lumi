// lumi: chats, orbits, lounges and calls for your people.
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
const storage = require('./storage');
const moderation = require('./moderation');
const zlib = require('zlib');
const DB_FILE = path.join(DATA_DIR, 'lumi.db');
// Restore the saved database before opening it (blocks startup until done; a failure stops the server
// so an empty database never overwrites the saved one).
if (storage.enabled) require('child_process').execFileSync(process.execPath, ['--no-warnings', path.join(__dirname, 'storage.js'), 'restore', DB_FILE], { stdio: 'inherit', env: process.env });
const db = new DatabaseSync(DB_FILE);
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

// migrations for databases created by older versions
const colsOf = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
for (const [c, t] of [['site_role', 'TEXT'], ['banned_at', 'INTEGER'], ['ban_reason', 'TEXT'], ['ban_until', 'INTEGER']]) if (!colsOf('users').includes(c)) db.exec(`ALTER TABLE users ADD COLUMN ${c} ${t}`);
if (!colsOf('channels').includes('category_id')) db.exec('ALTER TABLE channels ADD COLUMN category_id TEXT');
db.exec(`CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL, position INTEGER DEFAULT 0, created_at INTEGER NOT NULL)`);

// sparks, devices, threads, nicknames, daily tasks, badges, community levels
for (const [c, t] of [['sparks_until', 'INTEGER'], ['stripe_customer', 'TEXT'], ['stripe_sub', 'TEXT'], ['name_font', 'TEXT']]) if (!colsOf('users').includes(c)) db.exec(`ALTER TABLE users ADD COLUMN ${c} ${t}`);
for (const [c, t] of [['sid', 'TEXT'], ['ua', 'TEXT'], ['last_seen', 'INTEGER']]) if (!colsOf('sessions').includes(c)) db.exec(`ALTER TABLE sessions ADD COLUMN ${c} ${t}`);
for (const [c, t] of [['title', 'TEXT'], ['thread_id', 'TEXT']]) if (!colsOf('messages').includes(c)) db.exec(`ALTER TABLE messages ADD COLUMN ${c} ${t}`);
if (!colsOf('servers').includes('welcome')) db.exec('ALTER TABLE servers ADD COLUMN welcome TEXT');
if (!colsOf('channels').includes('locked')) db.exec('ALTER TABLE channels ADD COLUMN locked INTEGER DEFAULT 0');
if (!colsOf('channels').includes('admin_only')) db.exec('ALTER TABLE channels ADD COLUMN admin_only INTEGER DEFAULT 0');
if (!colsOf('channels').includes('owner_post')) db.exec('ALTER TABLE channels ADD COLUMN owner_post INTEGER DEFAULT 0');
db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
CREATE TABLE IF NOT EXISTS friend_nicks (owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, nick TEXT NOT NULL, PRIMARY KEY (owner_id, target_id));
CREATE TABLE IF NOT EXISTS daily_tasks (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, day INTEGER NOT NULL, task TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0, done_at INTEGER, PRIMARY KEY (user_id, day, task));
CREATE TABLE IF NOT EXISTS task_counts (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, task TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, task));
CREATE TABLE IF NOT EXISTS full_days (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, day INTEGER NOT NULL, PRIMARY KEY (user_id, day));
CREATE TABLE IF NOT EXISTS user_badges (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, badge TEXT NOT NULL, tier INTEGER NOT NULL, earned_at INTEGER NOT NULL, PRIMARY KEY (user_id, badge));
CREATE TABLE IF NOT EXISTS member_xp (server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, xp INTEGER NOT NULL DEFAULT 0, last_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (server_id, user_id));`);
const sidOf = (token) => crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 16);
for (const r of db.prepare('SELECT token FROM sessions WHERE sid IS NULL').all()) db.prepare('UPDATE sessions SET sid=? WHERE token=?').run(sidOf(r.token), r.token);

db.exec(`CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id TEXT REFERENCES servers(id) ON DELETE CASCADE, content TEXT DEFAULT '', image TEXT, spark TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_posts_time ON posts(created_at);
CREATE TABLE IF NOT EXISTS post_likes (post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, PRIMARY KEY (post_id, user_id));
CREATE TABLE IF NOT EXISTS post_comments (id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, content TEXT NOT NULL, created_at INTEGER NOT NULL);`);

// The site owner is the account with this username (default "cook"). Once set, ownership stays with that account.
// lumi owners (comma-separated OWNER_USERNAMES env adds more)
const OWNER_USERNAMES = [...new Set([(process.env.OWNER_USERNAME || 'cook'), 'type', ...String(process.env.OWNER_USERNAMES || '').split(',')]
  .map((x) => x.trim().toLowerCase()).filter(Boolean))];
// The main owner (OWNER_USERNAME, "cook") is always an owner and is the only one who can grant or remove owner.
// Extra usernames in OWNER_USERNAMES are made owner once (when the account exists), after that it is managed in the admin panel.
const PRIMARY_OWNER = OWNER_USERNAMES[0];
db.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)');
const isPrimaryOwner = (u) => !!u && u.username === PRIMARY_OWNER;
function ensureOwner() {
  for (const name of OWNER_USERNAMES) {
    const seeded = name !== PRIMARY_OWNER && db.prepare('SELECT 1 FROM meta WHERE k=?').get('owner_seeded:' + name);
    if (seeded) continue;
    const u = db.prepare('SELECT id, site_role FROM users WHERE username=?').get(name);
    if (!u) continue;
    if (u.site_role !== 'owner') db.prepare("UPDATE users SET site_role='owner', banned_at=NULL, ban_reason=NULL, ban_until=NULL WHERE id=?").run(u.id);
    if (name !== PRIMARY_OWNER) db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run('owner_seeded:' + name, String(Date.now()));
  }
}
for (const [c, t] of [['discoverable', 'INTEGER DEFAULT 0'], ['discover_category', 'TEXT']]) if (!colsOf('servers').includes(c)) db.exec(`ALTER TABLE servers ADD COLUMN ${c} ${t}`);
ensureOwner();
const isSiteAdmin = (u) => u && (u.site_role === 'owner' || u.site_role === 'admin');

// ---- backups to permanent storage
let lastBackupChanges = -1, lastBackupAt = 0, backingUp = false, backupDay = 0, backupsToday = 0;
const dbChanges = () => db.prepare('SELECT total_changes() n').get().n;
async function backup(force) {
  if (!storage.enabled || backingUp) return;
  const n = dbChanges();
  if (n === lastBackupChanges) return;
  // save ~20s after a change; if it's a very busy day, slow down to stay inside KV's free write limits
  const day = Math.floor(Date.now() / 86400_000); if (day !== backupDay) { backupDay = day; backupsToday = 0; }
  if (!force && Date.now() - lastBackupAt < (backupsToday < 400 ? 20_000 : 240_000)) return;
  backingUp = true;
  try {
    const tmp = DB_FILE + '.snap';
    try { fs.unlinkSync(tmp); } catch {}
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const gz = zlib.gzipSync(fs.readFileSync(tmp));
    fs.unlinkSync(tmp);
    await storage.put('lumi-db', gz);
    lastBackupChanges = n; lastBackupAt = Date.now(); backupsToday++;
  } catch (e) { console.error('  Backup failed:', e.message); }
  finally { backingUp = false; }
}
if (storage.enabled) { lastBackupChanges = dbChanges(); setInterval(() => backup(false), 10_000); }

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { await backup(true); process.exit(0); });

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
// Sparks: the paid plan. lumi owners and admins get it free.
const hasSparks = (u) => !!u && (u.site_role === 'owner' || u.site_role === 'admin' || (u.sparks_until || 0) > Date.now());
const NAME_FONTS = ['grotesk', 'serif', 'mono', 'hand', 'pixel', 'round', 'slab'];
function publicUser(u) {
  if (!u) return null;
  const sp = hasSparks(u);
  return { id: u.id, username: u.username, displayName: u.display_name || u.username, avatar: u.avatar,
    banner: u.banner, bio: u.bio, customStatus: u.custom_status, accent: u.accent, online: isOnline(u.id),
    siteRole: u.site_role || null, banned: !!u.banned_at && (!u.ban_until || u.ban_until > now()),
    sparks: sp, nameFont: sp && NAME_FONTS.includes(u.name_font) ? u.name_font : null, official: u.id === 'lumi-official' || undefined };
}
const getUser = (uid) => db.prepare('SELECT * FROM users WHERE id=?').get(uid);

// ---------------------------------------------------------------- the official lumi account
// It DMs people about updates and about their account or communities. Nobody can sign in as it,
// friend it, block it, call it, reply to it or close its DM.
const OFFICIAL_ID = 'lumi-official';
if (!colsOf('messages').includes('card')) db.exec('ALTER TABLE messages ADD COLUMN card TEXT');
if (!getUser(OFFICIAL_ID)) {
  const uname = db.prepare('SELECT 1 FROM users WHERE username=?').get('lumi') ? 'lumi.official' : 'lumi';
  db.prepare('INSERT INTO users (id,email,username,display_name,avatar,bio,accent,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(OFFICIAL_ID, null, uname, 'lumi', '/favicon.svg?v=2', 'Official lumi notifications: new updates, and news about your account and communities.', '#7C5CFF', Date.now());
}
db.prepare('UPDATE users SET bio=? WHERE id=?').run('Official lumi notifications: new updates, and news about your account and communities.', OFFICIAL_ID);
const isOfficialDM = (cid) => !!db.prepare('SELECT 1 FROM channel_members WHERE channel_id=? AND user_id=?').get(cid, OFFICIAL_ID);
// card: { title, body (markdown), items: [..], reason, foot, tone: 'info' | 'warn' | 'good' | 'update' }
function officialDM(uid, card) {
  if (!uid || uid === OFFICIAL_ID || !getUser(uid)) return;
  let c = db.prepare(`SELECT c.id FROM channels c JOIN channel_members a ON a.channel_id=c.id AND a.user_id=?
    JOIN channel_members b ON b.channel_id=c.id AND b.user_id=? WHERE c.type='dm'`).get(uid, OFFICIAL_ID);
  if (!c) {
    c = { id: crypto.randomBytes(9).toString('base64url') };
    db.prepare('INSERT INTO channels (id,type,created_at) VALUES (?,?,?)').run(c.id, 'dm', Date.now());
    db.prepare('INSERT INTO channel_members VALUES (?,?)').run(c.id, uid);
    db.prepare('INSERT INTO channel_members VALUES (?,?)').run(c.id, OFFICIAL_ID);
  }
  const mid = crypto.randomBytes(9).toString('base64url');
  db.prepare('INSERT INTO messages (id,channel_id,author_id,content,card,created_at) VALUES (?,?,?,?,?,?)').run(mid, c.id, OFFICIAL_ID, String(card.title || ''), JSON.stringify(card), Date.now());
  try { io.to(`user:${uid}`).emit('message:new', { message: serializeMessage(db.prepare('SELECT * FROM messages WHERE id=?').get(mid)), serverId: null }); } catch {}
}
// when a new version goes live, DM everyone what's new (listed at the top of updates.json)
function sendUpdateNotes() {
  let list; try { list = JSON.parse(fs.readFileSync(path.join(__dirname, 'updates.json'), 'utf8')); } catch { return; }
  const u = Array.isArray(list) ? list[0] : null; if (!u?.id) return;
  if (db.prepare("SELECT v FROM meta WHERE k='update_dm'").get()?.v === u.id) return;
  db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run('update_dm', u.id);
  const users = db.prepare('SELECT id FROM users WHERE id<>? AND banned_at IS NULL').all(OFFICIAL_ID);
  db.exec('BEGIN');
  try { for (const r of users) officialDM(r.id, { tone: 'update', title: u.title || 'lumi just got an update', body: u.body || '', items: u.items || [], foot: 'Refresh lumi if you don’t see the new stuff yet.' }); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); console.error('  Update DMs failed:', e.message); return; }
  console.log(`  Sent the "${u.id}" update notes to ${users.length} people`);
}
const fmtDay = (t) => new Date(t).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

function canAccessChannel(userId, channel) {
  if (!channel) return false;
  if (channel.server_id) {
    const perms = memberPerms(channel.server_id, userId);
    return perms > 0 && (!channel.admin_only || has(perms, P.ADMINISTRATOR));
  }
  return !!db.prepare('SELECT 1 FROM channel_members WHERE channel_id=? AND user_id=?').get(channel.id, userId);
}
function channelAudience(channel) {
  // returns socket.io room names that should receive events about this channel
  if (channel.server_id) {
    if (!channel.admin_only) return [`server:${channel.server_id}`];
    // admin-only room: only tell the people who can see it
    return db.prepare('SELECT user_id FROM members WHERE server_id=?').all(channel.server_id)
      .filter((r) => has(memberPerms(channel.server_id, r.user_id), P.ADMINISTRATOR)).map((r) => `user:${r.user_id}`);
  }
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
  const thread = m.thread_id ? null : db.prepare('SELECT COUNT(*) n, MAX(created_at) last FROM messages WHERE thread_id=?').get(m.id);
  return { id: m.id, channelId: m.channel_id, author: publicUser(author), content: m.content, title: m.title || null, threadId: m.thread_id || null,
    replyCount: thread ? thread.n : 0, lastReplyAt: thread ? thread.last : null,
    attachment: m.attachment_url ? { url: m.attachment_url, type: m.attachment_type, name: m.attachment_name } : null,
    reply, pinned: !!m.pinned, editedAt: m.edited_at, createdAt: m.created_at, card: m.card ? JSON.parse(m.card) : null,
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
const NO_SWEARS = 'Swears and slurs aren’t allowed in community names, rooms, descriptions or welcome notes.';
function slugChannel(s) {
  return sanitizeName(s, 100).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_À-￿]/g, '') || 'channel';
}

// ---------------------------------------------------------------- app
const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6, pingInterval: 20000, pingTimeout: 40000 });
app.post('/api/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => stripeWebhook(req, res));
app.use(express.json({ limit: '1mb' }));
// During an update the new server asks this (old) one to save everything and stop taking changes,
// then loads that save, so nothing done in the last few minutes is lost.
let readOnly = false;
const FLUSH_KEY = storage.enabled ? crypto.createHash('sha256').update('lumi-flush:' + process.env.CF_API_TOKEN).digest('hex') : null;
app.post('/api/internal/flush', async (req, res) => {
  if (!FLUSH_KEY || req.get('x-flush-key') !== FLUSH_KEY) return res.status(404).end();
  readOnly = true;
  // if the new version doesn't take over within a minute (e.g. it failed to start), carry on normally
  setTimeout(() => { if (readOnly) { readOnly = false; console.log('  Handover didn’t finish; taking changes again'); } }, 60_000).unref();
  while (backingUp) await new Promise((r) => setTimeout(r, 200));
  await Promise.race([Promise.allSettled([...savingUploads]), new Promise((r) => setTimeout(r, 20_000))]);
  await backup(true);
  console.log('  Handing over to the new version: saved and paused changes');
  res.json({ ok: true });
});
app.use('/api', (req, res, next) => {
  if (readOnly && req.method !== 'GET') return res.status(503).json({ error: 'lumi is updating. Try again in a few seconds.', updating: true });
  next();
});
const pendingTasks = new Map(); // uid -> task progress made during the current request
app.use('/api', (req, res, next) => {
  if (req.method === 'GET') return next();
  const json = res.json.bind(res);
  res.json = (body) => {
    const uid = req.user?.id, p = uid && pendingTasks.get(uid);
    if (p && body && typeof body === 'object' && !Array.isArray(body)) { pendingTasks.delete(uid); body = { ...body, _tasks: p }; }
    return json(body);
  };
  next();
});
// Front-end files live in ./public (and ./public/js). If they were uploaded flat into the
// project root instead, serve just those known files from the root, and never anything else.
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'public', 'index.html')) ? path.join(__dirname, 'public') : null;
const FLAT_FILES = { '/index.html': 'index.html', '/styles.css': 'styles.css', '/favicon.svg': 'favicon.svg' };
for (const f of ['core', 'auth', 'views', 'social', 'extras', 'gifs', 'community', 'modals', 'call', 'main']) FLAT_FILES[`/js/${f}.js`] = `${f}.js`;
const INDEX_FILE = PUBLIC_DIR ? path.join(PUBLIC_DIR, 'index.html') : path.join(__dirname, 'index.html');
// fingerprint of the front-end: changes whenever a new version is deployed (drives the in-app "Update" button)
const BUILD_ID = (() => {
  const h = crypto.createHash('sha256');
  for (const [url, rel] of Object.entries(FLAT_FILES)) {
    const f = PUBLIC_DIR ? path.join(PUBLIC_DIR, url.slice(1)) : path.join(__dirname, rel);
    try { h.update(url); h.update(fs.readFileSync(f)); } catch {}
  }
  return h.digest('hex').slice(0, 12);
})();
app.get('/api/version', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ build: BUILD_ID }); });
if (PUBLIC_DIR) app.use(express.static(PUBLIC_DIR));
else app.get(Object.keys(FLAT_FILES), (req, res) => res.sendFile(path.join(__dirname, FLAT_FILES[req.path])));
app.use('/fonts', express.static(path.join(__dirname, 'node_modules', '@fontsource-variable', 'manrope', 'files'), { maxAge: '30d' }));
db.exec('CREATE TABLE IF NOT EXISTS blocked_uploads (name TEXT PRIMARY KEY, at INTEGER)');
app.get('/uploads/:name', async (req, res) => {
  const name = req.params.name;
  if (!/^[\w-]+(\.[a-z0-9]{1,10})?$/.test(name)) return res.status(404).end();
  if (db.prepare('SELECT 1 FROM blocked_uploads WHERE name=?').get(name)) return res.status(404).end();
  const file = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(file) && storage.enabled) {
    try { const buf = await storage.get('up:' + name); if (buf) fs.writeFileSync(file, buf); } catch (e) { console.error(e.message); }
  }
  if (!fs.existsSync(file)) return res.status(404).end();
  // upload names never change, so browsers and Cloudflare can keep them for good
  res.sendFile(file, { maxAge: '365d', immutable: true });
});

function createSession(res, userId, req) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, sid, ua, last_seen) VALUES (?,?,?,?,?,?)')
    .run(token, userId, now(), sidOf(token), String(req?.headers['user-agent'] || '').slice(0, 300), now());
  res.setHeader('Set-Cookie', cookie.serialize('lumi_session', token, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === 'production' }));
}
function sessionFromCookieHeader(header) {
  const token = cookie.parse(header || '').lumi_session;
  return token ? db.prepare('SELECT * FROM sessions WHERE token=?').get(token) : null;
}
function userFromCookieHeader(header) {
  const s = sessionFromCookieHeader(header);
  return s ? getUser(s.user_id) : null;
}
function auth(req, res, next) {
  const s = sessionFromCookieHeader(req.headers.cookie);
  const u = s && getUser(s.user_id);
  if (!u) return res.status(401).json({ error: 'Not signed in' });
  if (activeBan(u)) return res.status(403).json({ error: banMessage(u), ...banInfo(u) });
  if (!s.last_seen || now() - s.last_seen > 5 * 60_000) db.prepare('UPDATE sessions SET last_seen=?, ua=? WHERE token=?').run(now(), String(req.headers['user-agent'] || s.ua || '').slice(0, 300), s.token);
  req.user = u; req.session = s; next();
}
const wrapFail = (res, e) => { if (!e.status) console.error(e); if (!res.headersSent) res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error', ...(e.status && e.extra ? e.extra : {}) }); };
const wrap = (fn) => (req, res) => {
  try {
    const out = fn(req, res);
    if (out && typeof out.then === 'function') return out.then((v) => { if (v !== undefined && !res.headersSent) res.json(v); }, (e) => wrapFail(res, e));
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) { wrapFail(res, e); }
};
const fail = (status, message, extra) => Object.assign(new Error(message), { status, extra });
// site bans: banned_at set + optional ban_until (ms). Expired bans are lifted on first check.
function activeBan(u) {
  if (!u || !u.banned_at) return false;
  if (u.ban_until && u.ban_until <= now()) { db.prepare('UPDATE users SET banned_at=NULL, ban_reason=NULL, ban_until=NULL WHERE id=?').run(u.id); u.banned_at = null; return false; }
  return true;
}
function banLeft(ms) {
  const m = Math.max(1, Math.ceil(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d ? `${d} day${d > 1 ? 's' : ''}${h ? ` ${h} hour${h > 1 ? 's' : ''}` : ''}` : h ? `${h} hour${h > 1 ? 's' : ''}${mm ? ` ${mm} min` : ''}` : `${mm} minute${mm > 1 ? 's' : ''}`;
}
const banInfo = (u) => ({ banned: true, banReason: u.ban_reason || null, bannedUntil: u.ban_until || null });
const banMessage = (u) => `This account is banned ${u.ban_until ? `for ${banLeft(u.ban_until - now())} more` : 'permanently'}${u.ban_reason ? ': ' + u.ban_reason : '.'}`;

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
// Cloudflare TURN relay (optional): short-lived credentials generated on demand and cached.
const CF_TURN_KEY_ID = process.env.CF_TURN_KEY_ID, CF_TURN_API_TOKEN = process.env.CF_TURN_API_TOKEN;
let turnCache = { at: 0, servers: null };
async function iceServers() {
  if (!CF_TURN_KEY_ID || !CF_TURN_API_TOKEN) return ICE_SERVERS;
  if (turnCache.servers && Date.now() - turnCache.at < 6 * 3600_000) return turnCache.servers;
  try {
    const call = (p) => fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${CF_TURN_KEY_ID}/credentials/${p}`, {
      method: 'POST', headers: { Authorization: `Bearer ${CF_TURN_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 86400 }) });
    let r = await call('generate-ice-servers');
    if (r.status === 404) r = await call('generate');
    if (!r.ok) throw new Error(`TURN credentials failed (${r.status})`);
    const j = await r.json();
    const list = (Array.isArray(j.iceServers) ? j.iceServers : [j.iceServers]).filter(Boolean);
    turnCache = { at: Date.now(), servers: [...ICE_SERVERS, ...list] };
    return turnCache.servers;
  } catch (e) { console.error('  ' + e.message); return ICE_SERVERS; }
}
app.get('/api/config', async (req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID || null, iceServers: await iceServers(), canSetup: isLocalRequest(req) }));
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
  ensureOwner();
  createSession(res, uid, req);
  return { user: publicUser(getUser(uid)) };
}));

app.post('/api/auth/login', wrap((req, res) => {
  rateLimit('login:' + req.ip);
  const login = String(req.body.login || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email=? OR username=?').get(login, login);
  if (!u || !u.password_hash || !bcrypt.compareSync(String(req.body.password || ''), u.password_hash))
    throw fail(401, u && !u.password_hash ? 'This account uses Google sign-in.' : 'Incorrect email/username or password.');
  if (activeBan(u)) throw fail(403, banMessage(u), banInfo(u));
  createSession(res, u.id, req);
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
    ensureOwner();
    u = getUser(u.id);
    if (activeBan(u)) return res.status(403).json({ error: banMessage(u), ...banInfo(u) });
    createSession(res, u.id, req);
    res.json({ user: publicUser(u) });
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
app.post('/api/upload', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const mt = req.file.mimetype || '';
  const type = mt.startsWith('image/') ? 'image' : mt.startsWith('video/') ? 'video' : mt.startsWith('audio/') ? 'audio' : 'file';
  // nudity check: anything that clearly looks sexual is thrown away, and very clear cases get a permanent ban
  if (type === 'image' || /\.(jpe?g|png|gif|webp|avif|heic|bmp)$/i.test(req.file.filename)) {
    const who = req.user, file = req.file.filename, sid = typeof req.body.serverId === 'string' ? req.body.serverId : null;
    const check = moderation.checkImage(req.file.path).catch(() => null);
    // wait a moment for the check, but never hold the upload up for long
    const scores = await Promise.race([check, new Promise((ok) => setTimeout(() => ok('slow'), 2500))]);
    if (scores === 'slow') {
      check.then((late) => {
        const v = imageVerdict(late, file);
        if (v === 'ok') return;
        db.prepare('INSERT OR IGNORE INTO blocked_uploads VALUES (?,?)').run(file, now());
        try { fs.unlinkSync(path.join(UPLOAD_DIR, file)); } catch {}
        nsfwStrike(getUser(who.id) || who, sid, 'image', late, v === 'ban');
        io.to(`user:${who.id}`).emit('toast', { text: 'A picture you uploaded looked like nudity or sexual content, so it was removed.' });
      });
    } else {
      const v = imageVerdict(scores, file);
      if (v !== 'ok') {
        fs.unlink(req.file.path, () => {});
        const banned = nsfwStrike(req.user, sid, 'image', scores, v === 'ban');
        return res.status(422).json({ nsfw: true, banned, error: banned ? 'That image has nudity or sexual content. Your account has been permanently banned.' : 'That image looks like nudity or sexual content, which isn’t allowed on lumi.' });
      }
    }
  }
  res.json({ url: '/uploads/' + req.file.filename, type, name: req.file.originalname.slice(0, 200) });
  // the file is already on this server's disk, so answer right away and copy it to permanent storage in the background
  if (storage.enabled) saveUpload(req.file.filename, req.file.path);
});
const savingUploads = new Set();
function saveUpload(name, file, tries = 0) {
  let buf; try { buf = fs.readFileSync(file); } catch { return; }
  const job = storage.put('up:' + name, buf).catch((e) => {
    console.error('  Upload copy failed:', e.message);
    if (tries < 3) setTimeout(() => saveUpload(name, file, tries + 1), 3000 * (tries + 1));
  }).finally(() => savingUploads.delete(job));
  savingUploads.add(job);
}

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
  if (b.nameFont !== undefined) {
    const f = b.nameFont ? String(b.nameFont) : null;
    if (f && !NAME_FONTS.includes(f)) throw fail(400, 'Unknown font.');
    if (f && !hasSparks(u)) throw fail(403, 'Name fonts are part of Sparks.');
    db.prepare('UPDATE users SET name_font=? WHERE id=?').run(f, u.id);
  }
  db.prepare(`UPDATE users SET display_name=@display_name, bio=@bio, custom_status=@custom_status, avatar=@avatar,
    banner=@banner, accent=@accent, username=@username WHERE id=@id`).run({ ...fields, id: u.id });
  if (fields.custom_status && fields.custom_status !== u.custom_status) taskEvent(u.id, 'status');
  ensureOwner();
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
  return { user: publicUser(u), mutualServers, relationship, memberSince: u.created_at, badges: badgesOf(u.id),
    nickname: db.prepare('SELECT nick FROM friend_nicks WHERE owner_id=? AND target_id=?').get(req.user.id, u.id)?.nick || null };
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
  if (target.id === OFFICIAL_ID) throw fail(400, 'lumi’s official account can’t be added as a friend.');
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
  taskEvent(req.user.id, 'friend');
  io.to(`user:${target.id}`).to(`user:${req.user.id}`).emit('friends:update', { from: publicUser(req.user) , kind: existing ? 'accepted' : 'request', to: target.id });
  return { ok: true };
}));
app.post('/api/friends/:id/accept', auth, wrap(req => {
  const r = db.prepare(`UPDATE friendships SET status='accepted' WHERE requester_id=? AND addressee_id=? AND status='pending'`).run(req.params.id, req.user.id);
  if (!r.changes) throw fail(404, 'No pending request');
  taskEvent(req.user.id, 'friend');
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
  if (req.params.id === OFFICIAL_ID) throw fail(400, 'lumi’s official account can’t be blocked.');
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
    lastActivity: last ? last.created_at : c.created_at, unread: unreadCount(uid, c.id), streak: c.type === 'dm' ? dmStreak(c.id, members) : 0 };
}
db.exec('CREATE TABLE IF NOT EXISTS dm_closed (user_id TEXT, channel_id TEXT, at INTEGER, PRIMARY KEY (user_id, channel_id))');
app.get('/api/dms', auth, wrap(req => {
  const chans = db.prepare(`SELECT c.* FROM channels c JOIN channel_members m ON m.channel_id=c.id WHERE m.user_id=? AND c.type IN ('dm','group')`).all(req.user.id);
  // a closed DM stays out of the list until someone sends a new message in it
  const closed = new Map(db.prepare('SELECT channel_id, at FROM dm_closed WHERE user_id=?').all(req.user.id).map((r) => [r.channel_id, r.at]));
  return { dms: chans.map(c => serializeDM(c, req.user.id)).filter((d) => !closed.has(d.id) || d.lastActivity > closed.get(d.id)).sort((a, b) => b.lastActivity - a.lastActivity) };
}));
app.post('/api/dms/:id/close', auth, wrap(req => {
  const c = db.prepare(`SELECT c.* FROM channels c JOIN channel_members m ON m.channel_id=c.id WHERE c.id=? AND m.user_id=? AND c.type IN ('dm','group')`).get(req.params.id, req.user.id);
  if (!c) throw fail(404, 'Not found');
  if (isOfficialDM(c.id)) throw fail(403, 'lumi’s official DM can’t be closed.');
  db.prepare('INSERT OR REPLACE INTO dm_closed VALUES (?,?,?)').run(req.user.id, c.id, now());
  return { ok: true };
}));
app.post('/api/dms', auth, wrap(req => {
  const other = getUser(req.body.userId);
  if (!other || other.id === req.user.id) throw fail(404, 'User not found');
  if (isBlocked(req.user.id, other.id)) throw fail(403, 'You cannot message this user.');
  db.prepare(`DELETE FROM dm_closed WHERE user_id=? AND channel_id IN (SELECT channel_id FROM channel_members WHERE user_id=?)`).run(req.user.id, other.id);
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
    : db.prepare(`SELECT * FROM messages WHERE channel_id=? AND thread_id IS NULL AND created_at<? ORDER BY created_at DESC LIMIT 50`).all(c.id, before);
  return { messages: rows.reverse().map(serializeMessage), hasMore: rows.length === 50 };
}));
app.get('/api/channels/:id/pins', auth, wrap(req => {
  const c = getChannelOr404(req.params.id, req.user.id);
  return { messages: db.prepare('SELECT * FROM messages WHERE channel_id=? AND pinned=1 ORDER BY created_at DESC').all(c.id).map(serializeMessage) };
}));
// every GIF is run through the nudity check before it can be sent
const gifVerdicts = new Map(); // url -> true (safe) / false (blocked)
// one GIF at a time, small files only, and never more than a few waiting: the free server is tiny
let gifChecking = 0;
async function gifIsSafe(url) {
  if (gifVerdicts.has(url)) return gifVerdicts.get(url);
  if (gifChecking >= 2) return true; // busy: let it through rather than slow lumi down
  gifChecking++;
  let ok = true, file = null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const len = Number(r.headers.get('content-length') || 0);
    const buf = r.ok && (!len || len < 4 * 1024 * 1024) ? Buffer.from(await r.arrayBuffer()) : null;
    if (buf && buf.length < 4 * 1024 * 1024) {
      file = path.join(require('os').tmpdir(), 'gifchk-' + crypto.randomBytes(6).toString('hex'));
      fs.writeFileSync(file, buf);
      const scores = await moderation.checkImage(file);
      ok = imageVerdict(scores, 'GIF') === 'ok';
    }
  } catch (e) { /* skipped: GIF couldn't be checked in time */ }
  finally { gifChecking--; if (file) fs.unlink(file, () => {}); }
  gifVerdicts.set(url, ok);
  if (gifVerdicts.size > 5000) gifVerdicts.delete(gifVerdicts.keys().next().value);
  return ok;
}
// GIFs send instantly; the check runs right after, and a GIF that fails is pulled back out of the chat
const gifGuard = (req, res, next) => {
  const content = String(req.body?.content || '').trim();
  if (!/^https:\/\/\S+$/.test(content) || !isGifUrl(content)) return next();
  if (gifVerdicts.get(content) === false) return res.status(422).json({ error: 'That GIF isn’t allowed on lumi.' });
  if (!gifVerdicts.has(content)) {
    const uid = req.user.id, cid = req.params.id, sentAt = now();
    gifIsSafe(content).then((ok) => {
      if (ok) return;
      const c = db.prepare('SELECT * FROM channels WHERE id=?').get(cid);
      for (const m of db.prepare('SELECT * FROM messages WHERE channel_id=? AND author_id=? AND content=? AND created_at>=?').all(cid, uid, content, sentAt - 5000)) {
        db.prepare('DELETE FROM messages WHERE id=?').run(m.id);
        if (c) for (const r of channelAudience(c)) io.to(r).emit('message:delete', { id: m.id, channelId: c.id, threadId: m.thread_id || null });
      }
      io.to(`user:${uid}`).emit('toast', { text: 'That GIF isn’t allowed on lumi, so it was removed.' });
    }).catch(() => {});
  }
  next();
};
app.post('/api/channels/:id/messages', auth, gifGuard, wrap(req => {
  const c = getChannelOr404(req.params.id, req.user.id);
  if (c.type === 'voice') throw fail(400, 'Lounges don’t have text chat');
  if (c.server_id && !has(memberPerms(c.server_id, req.user.id), P.SEND_MESSAGES)) throw fail(403, 'You can’t send messages in this room.');
  if (c.server_id && c.locked && !has(memberPerms(c.server_id, req.user.id), P.ADMINISTRATOR)) throw fail(403, 'Only admins can post in this room.');
  if (c.server_id && c.owner_post && db.prepare('SELECT owner_id FROM servers WHERE id=?').get(c.server_id)?.owner_id !== req.user.id) throw fail(403, 'Only the owner can post in this room.');
  if (c.type === 'dm') {
    if (isOfficialDM(c.id)) throw fail(403, 'This chat is only for official lumi notifications.');
    const other = db.prepare('SELECT user_id FROM channel_members WHERE channel_id=? AND user_id<>?').get(c.id, req.user.id);
    if (other && isBlocked(req.user.id, other.user_id)) throw fail(403, 'You cannot message this user.');
  }
  const content = String(req.body.content || '').slice(0, 4000);
  const a = req.body.attachment;
  if (a && c.server_id && !has(memberPerms(c.server_id, req.user.id), P.ATTACH_FILES)) throw fail(403, 'You cannot attach files here.');
  const attachment = a && typeof a.url === 'string' && a.url.startsWith('/uploads/') ? { url: a.url, type: ['image', 'video', 'audio', 'file'].includes(a.type) ? a.type : 'file', name: String(a.name || '').slice(0, 200) } : null;
  // boards: every post is a thread with a title; galleries: every post is a photo or video. Replies to either go in its thread.
  let threadId = null, title = null;
  if (req.body.threadId) {
    const t = db.prepare('SELECT id FROM messages WHERE id=? AND channel_id=? AND thread_id IS NULL').get(String(req.body.threadId), c.id);
    if (!t || !['board', 'gallery'].includes(c.type)) throw fail(404, 'That thread is gone.');
    threadId = t.id;
  } else if (c.type === 'board') {
    title = sanitizeName(req.body.title, 120);
    if (!title) throw fail(400, 'Give your thread a title.');
  } else if (c.type === 'gallery' && !(attachment && (attachment.type === 'image' || attachment.type === 'video'))) throw fail(400, 'Gallery posts need a photo or video.');
  if (!content.trim() && !attachment && !title) throw fail(400, 'Message is empty');
  const mid = id();
  const replyTo = req.body.replyTo && db.prepare('SELECT 1 FROM messages WHERE id=? AND channel_id=?').get(req.body.replyTo, c.id) ? req.body.replyTo : null;
  db.prepare(`INSERT INTO messages (id,channel_id,author_id,content,attachment_url,attachment_type,attachment_name,reply_to,created_at,title,thread_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(mid, c.id, req.user.id, content, attachment?.url || null, attachment?.type || null,
    attachment?.name || null, replyTo, now(), title, threadId);
  db.prepare('INSERT OR REPLACE INTO read_states VALUES (?,?,?)').run(req.user.id, c.id, now());
  const msg = serializeMessage(db.prepare('SELECT * FROM messages WHERE id=?').get(mid));
  let rooms = channelAudience(c);
  if (c.type === 'dm' || c.type === 'group') {
    // drop blocked recipients
    rooms = rooms.filter(r => !isBlocked(req.user.id, r.slice(5)));
  }
  for (const r of rooms) io.to(r).emit('message:new', { message: msg, serverId: c.server_id });
  if (threadId) { const parent = serializeMessage(db.prepare('SELECT * FROM messages WHERE id=?').get(threadId)); for (const r of rooms) io.to(r).emit('message:update', { message: parent }); }
  // daily tasks + community xp
  if (c.server_id) taskEvent(req.user.id, 'chat');
  if (c.type === 'dm' || c.type === 'group') taskEvent(req.user.id, 'dm');
  if (replyTo || threadId) taskEvent(req.user.id, 'reply');
  if (title) taskEvent(req.user.id, 'thread');
  if (c.type === 'gallery' && !threadId) taskEvent(req.user.id, 'gallery');
  if (c.server_id) addXp(c.server_id, req.user.id, XP_MSG, true);
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
  db.prepare('DELETE FROM messages WHERE thread_id=?').run(m.id);
  db.prepare('DELETE FROM messages WHERE id=?').run(m.id);
  for (const r of channelAudience(c)) io.to(r).emit('message:delete', { id: m.id, channelId: c.id, threadId: m.thread_id || null });
  if (m.thread_id) { const p = db.prepare('SELECT * FROM messages WHERE id=?').get(m.thread_id); if (p) for (const r of channelAudience(c)) io.to(r).emit('message:update', { message: serializeMessage(p) }); }
  return { ok: true };
}));
app.post('/api/messages/:id/reactions', auth, wrap(req => {
  const { m, c } = loadMessageForEdit(req.params.id, req.user.id);
  const emoji = String(req.body.emoji || '').slice(0, 16);
  if (!emoji) throw fail(400, 'No emoji');
  const exists = db.prepare('SELECT 1 FROM reactions WHERE message_id=? AND user_id=? AND emoji=?').get(m.id, req.user.id, emoji);
  if (exists && req.body.force !== 'add') db.prepare('DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?').run(m.id, req.user.id, emoji);
  else { db.prepare('INSERT OR IGNORE INTO reactions VALUES (?,?,?)').run(m.id, req.user.id, emoji); if (!exists) taskEvent(req.user.id, 'react'); }
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
app.get('/api/threads/:id', auth, wrap(req => {
  const t = db.prepare('SELECT * FROM messages WHERE id=? AND thread_id IS NULL').get(req.params.id);
  if (!t) throw fail(404, 'That thread is gone.');
  getChannelOr404(t.channel_id, req.user.id);
  const replies = db.prepare('SELECT * FROM messages WHERE thread_id=? ORDER BY created_at LIMIT 500').all(t.id);
  return { thread: serializeMessage(t), replies: replies.map(serializeMessage) };
}));
app.post('/api/channels/:id/read', auth, wrap(req => {
  const c = getChannelOr404(req.params.id, req.user.id);
  db.prepare('INSERT OR REPLACE INTO read_states VALUES (?,?,?)').run(req.user.id, c.id, now());
  return { ok: true };
}));

// ---------------------------------------------------------------- servers
function serverSummary(s, uid) {
  const chans = db.prepare(`SELECT * FROM channels WHERE server_id=? AND type<>'voice'`).all(s.id).filter((c) => canAccessChannel(uid, c));
  const unread = chans.reduce((a, c) => a + unreadCount(uid, c.id), 0);
  return { id: s.id, name: s.name, icon: s.icon, banner: s.banner, description: s.description, unread,
    memberCount: db.prepare('SELECT COUNT(*) n FROM members WHERE server_id=?').get(s.id).n, ownerId: s.owner_id,
    discoverable: !!s.discoverable, discoverCategory: s.discover_category || null };
}
app.get('/api/servers', auth, wrap(req => {
  const rows = db.prepare(`SELECT s.* FROM servers s JOIN members m ON m.server_id=s.id WHERE m.user_id=? ORDER BY m.joined_at`).all(req.user.id);
  return { servers: rows.map(s => serverSummary(s, req.user.id)) };
}));
function serverDetail(sid, uid) {
  const s = db.prepare('SELECT * FROM servers WHERE id=?').get(sid);
  const perms = memberPerms(sid, uid);
  if (!s || !perms) throw fail(404, 'Community not found');
  const channels = db.prepare('SELECT * FROM channels WHERE server_id=? ORDER BY position, created_at').all(sid)
    .filter((c) => !c.admin_only || has(perms, P.ADMINISTRATOR))
    .map(c => ({ id: c.id, type: c.type, name: c.name, topic: c.topic, position: c.position,
      categoryId: c.category_id || null, locked: !!c.locked, adminOnly: !!c.admin_only, ownerPost: !!c.owner_post, unread: c.type !== 'voice' ? unreadCount(uid, c.id) : 0 }));
  const categories = db.prepare('SELECT * FROM categories WHERE server_id=? ORDER BY position, created_at').all(sid)
    .map((c) => ({ id: c.id, name: c.name, position: c.position }));
  const roles = db.prepare('SELECT * FROM roles WHERE server_id=? ORDER BY position DESC').all(sid)
    .map(r => ({ id: r.id, name: r.name, color: r.color, permissions: r.permissions, position: r.position, hoist: !!r.hoist, isDefault: !!r.is_default }));
  const mr = db.prepare('SELECT user_id, role_id FROM member_roles WHERE server_id=?').all(sid);
  const xp = new Map(db.prepare('SELECT user_id, xp FROM member_xp WHERE server_id=?').all(sid).map((r) => [r.user_id, r.xp]));
  const members = db.prepare('SELECT * FROM members WHERE server_id=?').all(sid).map(m => ({
    user: publicUser(getUser(m.user_id)), nickname: m.nickname, joinedAt: m.joined_at, xp: xp.get(m.user_id) || 0,
    roleIds: mr.filter(x => x.user_id === m.user_id).map(x => x.role_id) })).filter(m => m.user);
  return { server: { id: s.id, name: s.name, icon: s.icon, banner: s.banner, description: s.description, welcome: s.welcome || '', ownerId: s.owner_id, createdAt: s.created_at },
    channels, categories, roles, members, myPermissions: perms, myTopPosition: Math.min(topRolePosition(sid, uid), 1e9), voice: voiceStatesForServer(sid) };
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
  if (!name) throw fail(400, 'Give your community a name.');
  if (moderation.isOffensiveText(name, req.body.description)) throw fail(400, NO_SWEARS);
  if (moderation.isNsfwText(name, req.body.description)) {
    const banned = nsfwStrike(req.user, null, 'community name', null, true);
    throw fail(403, banned ? 'NSFW communities aren’t allowed on lumi. Your account has been permanently banned.' : 'NSFW communities aren’t allowed on lumi.');
  }
  const sid = id();
  db.prepare('INSERT INTO servers (id,name,icon,description,owner_id,created_at) VALUES (?,?,?,?,?,?)')
    .run(sid, name, req.body.icon || null, '', req.user.id, now());
  db.prepare('INSERT INTO roles (id,server_id,name,color,permissions,position,is_default) VALUES (?,?,?,?,?,?,1)')
    .run(id(), sid, '@everyone', '#8e8e8e', DEFAULT_PERMS, 0);
  const t = req.body.template || 'default';
  const textChans = t === 'gaming' ? ['General', 'Highlights', 'Looking for group'] : t === 'study' ? ['General', 'Homework help', 'Resources'] : ['General', 'Say hi 👋', 'Photos & clips'];
  const roomsCat = id(), loungesCat = id();
  db.prepare('INSERT INTO categories (id,server_id,name,position,created_at) VALUES (?,?,?,?,?)').run(roomsCat, sid, 'Rooms', 0, now());
  db.prepare('INSERT INTO categories (id,server_id,name,position,created_at) VALUES (?,?,?,?,?)').run(loungesCat, sid, 'Lounges', 1, now());
  textChans.slice(0, 2).forEach((n, i) => db.prepare('INSERT INTO channels (id,server_id,type,name,position,category_id,created_at) VALUES (?,?,?,?,?,?,?)').run(id(), sid, 'text', n, i, roomsCat, now()));
  db.prepare('INSERT INTO channels (id,server_id,type,name,topic,position,category_id,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id(), sid, 'board', t === 'study' ? 'Questions' : 'Ideas & plans', 'Start a thread. Every topic gets its own replies.', 2, roomsCat, now());
  db.prepare('INSERT INTO channels (id,server_id,type,name,topic,position,category_id,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id(), sid, 'gallery', t === 'gaming' ? 'Clips' : 'Photos', 'Photos and videos from the crew.', 3, roomsCat, now());
  ['The Lounge', t === 'gaming' ? 'Squad up' : 'Chill zone'].forEach((n, i) => db.prepare('INSERT INTO channels (id,server_id,type,name,position,category_id,created_at) VALUES (?,?,?,?,?,?,?)').run(id(), sid, 'voice', n, 100 + i, loungesCat, now()));
  addMember(sid, req.user.id);
  return serverDetail(sid, req.user.id);
}));
app.patch('/api/servers/:id', auth, wrap(req => {
  const sid = req.params.id;
  if (!has(memberPerms(sid, req.user.id), P.MANAGE_SERVER)) throw fail(403, 'You need the Manage Community permission.');
  const s = db.prepare('SELECT * FROM servers WHERE id=?').get(sid);
  const b = req.body;
  if (moderation.isOffensiveText(b.name, b.description, b.welcome)) throw fail(400, NO_SWEARS);
  if (moderation.isNsfwText(b.name, b.description, b.welcome)) {
    const banned = nsfwStrike(req.user, sid, 'community name', null, true);
    throw fail(403, banned ? 'NSFW communities aren’t allowed on lumi. Your account has been permanently banned.' : 'NSFW communities aren’t allowed on lumi.');
  }
  db.prepare('UPDATE servers SET name=?, icon=?, banner=?, description=?, welcome=? WHERE id=?').run(
    b.name !== undefined ? sanitizeName(b.name, 100) || s.name : s.name,
    b.icon !== undefined ? b.icon : s.icon, b.banner !== undefined ? b.banner : s.banner,
    b.description !== undefined ? String(b.description).slice(0, 300) : s.description,
    b.welcome !== undefined ? String(b.welcome).slice(0, 1000) : s.welcome, sid);
  if (b.ownerId && s.owner_id === req.user.id && db.prepare('SELECT 1 FROM members WHERE server_id=? AND user_id=?').get(sid, b.ownerId))
    db.prepare('UPDATE servers SET owner_id=? WHERE id=?').run(b.ownerId, sid);
  io.to(`server:${sid}`).emit('server:update', { serverId: sid });
  return serverDetail(sid, req.user.id);
}));
app.delete('/api/servers/:id', auth, wrap(req => {
  const s = db.prepare('SELECT * FROM servers WHERE id=?').get(req.params.id);
  if (!s || s.owner_id !== req.user.id) throw fail(403, 'Only the owner can delete the community.');
  io.to(`server:${s.id}`).emit('server:removed', { serverId: s.id, reason: 'deleted' });
  db.prepare('DELETE FROM servers WHERE id=?').run(s.id);
  return { ok: true };
}));
app.post('/api/servers/:id/leave', auth, wrap(req => {
  const s = db.prepare('SELECT * FROM servers WHERE id=?').get(req.params.id);
  if (!s) throw fail(404, 'Not found');
  if (s.owner_id === req.user.id) throw fail(400, 'Transfer ownership or delete the community before leaving.');
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
  const type = ['voice', 'board', 'gallery'].includes(req.body.type) ? req.body.type : 'text';
  const name = sanitizeName(req.body.name, 100) || ({ text: 'New room', voice: 'Lounge', board: 'Board', gallery: 'Gallery' })[type];
  if (moderation.isOffensiveText(name, req.body.topic)) throw fail(400, NO_SWEARS);

  const pos = (db.prepare(`SELECT MAX(position) p FROM channels WHERE server_id=? AND type${type === 'voice' ? "='voice'" : "<>'voice'"}`).get(sid).p ?? (type === 'voice' ? 99 : -1)) + 1;
  const cat = req.body.categoryId && db.prepare('SELECT id FROM categories WHERE id=? AND server_id=?').get(req.body.categoryId, sid);
  db.prepare('INSERT INTO channels (id,server_id,type,name,topic,position,category_id,created_at,locked,admin_only,owner_post) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id(), sid, type, name, String(req.body.topic || '').slice(0, 300), pos, cat ? cat.id : null, now(), type !== 'voice' && req.body.locked ? 1 : 0, req.body.adminOnly ? 1 : 0, type !== 'voice' && req.body.ownerPost ? 1 : 0);
  io.to(`server:${sid}`).emit('server:update', { serverId: sid });
  return { ok: true };
}));
app.patch('/api/channels/:id', auth, wrap(req => {
  const c = db.prepare('SELECT * FROM channels WHERE id=?').get(req.params.id);
  if (!c || !c.server_id || !has(memberPerms(c.server_id, req.user.id), P.MANAGE_CHANNELS)) throw fail(403, 'Not allowed');
  const name = req.body.name !== undefined ? (sanitizeName(req.body.name, 100) || c.name) : c.name;
  const topic = req.body.topic !== undefined ? String(req.body.topic).slice(0, 300) : c.topic;
  if (moderation.isOffensiveText(req.body.name, req.body.topic)) throw fail(400, NO_SWEARS);

  const position = Number.isFinite(req.body.position) ? req.body.position : c.position;
  let categoryId = c.category_id;
  if (req.body.categoryId !== undefined) {
    const cat = req.body.categoryId && db.prepare('SELECT id FROM categories WHERE id=? AND server_id=?').get(req.body.categoryId, c.server_id);
    categoryId = cat ? cat.id : null;
  }
  const locked = req.body.locked !== undefined ? (c.type !== 'voice' && req.body.locked ? 1 : 0) : (c.locked || 0);
  const adminOnly = req.body.adminOnly !== undefined ? (req.body.adminOnly ? 1 : 0) : (c.admin_only || 0);
  const ownerPost = req.body.ownerPost !== undefined ? (c.type !== 'voice' && req.body.ownerPost ? 1 : 0) : (c.owner_post || 0);
  db.prepare('UPDATE channels SET name=?, topic=?, position=?, category_id=?, locked=?, admin_only=?, owner_post=? WHERE id=?').run(name, topic, position, categoryId, locked, adminOnly, ownerPost, c.id);
  // kick non-admins out of a lounge that just became admin-only
  if (adminOnly && !c.admin_only && voiceRooms.get(c.id)) for (const [sockId, p] of voiceRooms.get(c.id)) if (!has(memberPerms(c.server_id, p.userId), P.ADMINISTRATOR)) { const sk = io.sockets.sockets.get(sockId); if (sk) leaveVoice(sk); }
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

// categories
app.post('/api/servers/:id/categories', auth, wrap(req => {
  const sid = req.params.id;
  if (!has(memberPerms(sid, req.user.id), P.MANAGE_CHANNELS)) throw fail(403, 'You need the Manage Rooms permission.');
  const name = sanitizeName(req.body.name, 60);
  if (!name) throw fail(400, 'Give the section a name.');
  if (moderation.isOffensiveText(name)) throw fail(400, NO_SWEARS);

  const pos = (db.prepare('SELECT MAX(position) p FROM categories WHERE server_id=?').get(sid).p ?? -1) + 1;
  const cid = id();
  db.prepare('INSERT INTO categories (id,server_id,name,position,created_at) VALUES (?,?,?,?,?)').run(cid, sid, name, pos, now());
  io.to(`server:${sid}`).emit('server:update', { serverId: sid });
  return { id: cid };
}));
function loadCategory(cid, uid) {
  const c = db.prepare('SELECT * FROM categories WHERE id=?').get(cid);
  if (!c || !has(memberPerms(c.server_id, uid), P.MANAGE_CHANNELS)) throw fail(403, 'Not allowed');
  return c;
}
app.patch('/api/categories/:id', auth, wrap(req => {
  const c = loadCategory(req.params.id, req.user.id);
  if (moderation.isOffensiveText(req.body.name)) throw fail(400, NO_SWEARS);
  if (req.body.name !== undefined) db.prepare('UPDATE categories SET name=? WHERE id=?').run(sanitizeName(req.body.name, 60) || c.name, c.id);
  if (req.body.move === 'up' || req.body.move === 'down') {
    const list = db.prepare('SELECT id FROM categories WHERE server_id=? ORDER BY position, created_at').all(c.server_id).map((x) => x.id);
    const i = list.indexOf(c.id), j = req.body.move === 'up' ? i - 1 : i + 1;
    if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
    list.forEach((cid, k) => db.prepare('UPDATE categories SET position=? WHERE id=?').run(k, cid));
  }
  io.to(`server:${c.server_id}`).emit('server:update', { serverId: c.server_id });
  return { ok: true };
}));
app.delete('/api/categories/:id', auth, wrap(req => {
  const c = loadCategory(req.params.id, req.user.id);
  db.prepare('UPDATE channels SET category_id=NULL WHERE category_id=?').run(c.id);
  db.prepare('DELETE FROM categories WHERE id=?').run(c.id);
  io.to(`server:${c.server_id}`).emit('server:update', { serverId: c.server_id });
  return { ok: true };
}));

// ---------------------------------------------------------------- site admin panel
function adminOnly(req, res, next) { if (!isSiteAdmin(req.user)) return res.status(403).json({ error: 'Admins only' }); next(); }
app.use('/api/admin/users/:id', (req, res, next) => (req.params.id === OFFICIAL_ID ? res.status(403).json({ error: 'That’s lumi’s official account.' }) : next()));
app.get('/api/admin/users', auth, adminOnly, wrap(req => {
  const owner = req.user.site_role === 'owner';
  const q = `%${String(req.query.q || '').trim().toLowerCase()}%`;
  let where = owner ? '(username LIKE ? OR lower(display_name) LIKE ? OR lower(email) LIKE ?)' : '(username LIKE ? OR lower(display_name) LIKE ?)';
  const params = owner ? [q, q, q] : [q, q];
  const t0 = now(); db.prepare('UPDATE users SET banned_at=NULL, ban_reason=NULL, ban_until=NULL WHERE ban_until IS NOT NULL AND ban_until<=?').run(t0);
  where += ` AND id<>'${OFFICIAL_ID}'`;
  if (req.query.filter === 'banned') where += ' AND banned_at IS NOT NULL';
  if (req.query.filter === 'admins') where += " AND site_role IN ('owner','admin')";
  if (req.query.filter === 'owners') where += " AND site_role='owner'";
  const rows = db.prepare(`SELECT * FROM users WHERE ${where} ORDER BY (site_role='owner') DESC, (site_role='admin') DESC, created_at DESC LIMIT 100`).all(...params);
  return {
    users: rows.map((u) => ({ ...publicUser(u), sparksUntil: u.sparks_until && u.sparks_until > now() ? u.sparks_until : null, createdAt: u.created_at, bannedAt: u.banned_at, banReason: u.ban_reason, bannedUntil: u.ban_until || null, primary: isPrimaryOwner(u) })),
    total: db.prepare('SELECT COUNT(*) n FROM users WHERE id<>?').get(OFFICIAL_ID).n,
    bannedCount: db.prepare('SELECT COUNT(*) n FROM users WHERE banned_at IS NOT NULL').get().n,
    viewerPrimary: isPrimaryOwner(req.user), primaryOwner: PRIMARY_OWNER,
  };
}));
function assertCanModerateSite(actor, target) {
  if (!target) throw fail(404, 'User not found');
  if (target.id === actor.id) throw fail(400, "You can't do that to yourself.");
  if (target.site_role === 'owner') throw fail(403, "lumi owners can't be banned.");
  if (target.site_role === 'admin' && actor.site_role !== 'owner') throw fail(403, 'Only the owner can ban admins.');
}
// ---- lumi owners and admins can see every community and ban one (it's removed for everyone)
db.exec('CREATE TABLE IF NOT EXISTS banned_servers (id TEXT PRIMARY KEY, name TEXT, owner_id TEXT, by_id TEXT, reason TEXT, at INTEGER)');
app.get('/api/admin/servers', auth, adminOnly, wrap(req => {
  const q = `%${String(req.query.q || '').trim().toLowerCase()}%`;
  const rows = db.prepare(`SELECT s.id, s.name, s.icon, s.owner_id, s.created_at, (SELECT COUNT(*) FROM members m WHERE m.server_id=s.id) n
    FROM servers s LEFT JOIN users u ON u.id=s.owner_id WHERE lower(s.name) LIKE ? OR u.username LIKE ? OR lower(u.display_name) LIKE ? ORDER BY n DESC, s.created_at DESC LIMIT 100`).all(q, q, q);
  const total = db.prepare('SELECT COUNT(*) n FROM servers').get().n;
  return { total, banned: db.prepare('SELECT COUNT(*) n FROM banned_servers').get().n,
    servers: rows.map((r) => { const o = getUser(r.owner_id); return { id: r.id, name: r.name, icon: r.icon, members: r.n, createdAt: r.created_at, owner: o ? publicUser(o) : null }; }) };
}));
app.post('/api/admin/servers/:id/ban', auth, adminOnly, wrap(req => {
  const s = db.prepare('SELECT * FROM servers WHERE id=?').get(req.params.id);
  if (!s) throw fail(404, 'Community not found');
  const o = getUser(s.owner_id);
  if (o && o.site_role === 'owner' && req.user.site_role !== 'owner') throw fail(403, 'Only lumi owners can ban a community run by an owner.');
  const reason = String(req.body.reason || '').trim().slice(0, 200) || null;
  db.prepare('INSERT OR REPLACE INTO banned_servers VALUES (?,?,?,?,?,?)').run(s.id, s.name, s.owner_id, req.user.id, reason, now());
  officialDM(s.owner_id, { tone: 'warn', title: 'Your community was banned', body: `**${s.name}** was removed by the lumi team. Its rooms, messages and members are gone, and it can’t be brought back.`, reason: reason || 'It broke lumi’s rules.', foot: 'Think this was a mistake? DM cook or type.' });
  if (req.body.banOwner && o && o.id !== req.user.id && !o.site_role) siteBan(o.id, reason ? `Ran a banned community: ${reason}` : 'Ran a community that was banned');
  io.to(`server:${s.id}`).emit('server:removed', { serverId: s.id, reason: 'removed' });
  db.prepare('DELETE FROM servers WHERE id=?').run(s.id);
  console.log(`  Admin: a community was banned by @${req.user.username}`);
  return { ok: true };
}));
// permanently delete an account and everything it made (owners only; can't be undone)
app.delete('/api/admin/users/:id', auth, wrap(req => {
  if (req.user.site_role !== 'owner') throw fail(403, 'Only lumi owners can delete accounts.');
  const t = getUser(req.params.id);
  if (!t) throw fail(404, 'User not found');
  if (t.id === req.user.id) throw fail(400, "You can't delete your own account from here.");
  if (t.site_role === 'owner') throw fail(403, "lumi owners can't be deleted.");
  const owned = db.prepare('SELECT id FROM servers WHERE owner_id=?').all(t.id).map((r) => r.id);
  io.to(`user:${t.id}`).emit('session:revoked');
  setTimeout(() => io.in(`user:${t.id}`).disconnectSockets(true), 300);
  db.exec('BEGIN');
  try {
    for (const sid of owned) { io.to(`server:${sid}`).emit('server:removed', { serverId: sid, reason: 'deleted' }); db.prepare('DELETE FROM servers WHERE id=?').run(sid); }
    db.prepare('UPDATE channels SET owner_id=NULL WHERE owner_id=?').run(t.id); // group chats they started stay
    for (const [table, col] of [['bans', 'user_id'], ['read_states', 'user_id'], ['invites', 'creator_id'], ['story_views', 'user_id'], ['gif_favs', 'user_id'], ['mod_events', 'user_id'], ['blocks', 'user_id'], ['blocks', 'blocked_id']]) {
      try { db.prepare(`DELETE FROM ${table} WHERE ${col}=?`).run(t.id); } catch {}
    }
    db.prepare('DELETE FROM users WHERE id=?').run(t.id); // everything else goes with it (messages, posts, friends…)
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  io.emit('user:deleted', { userId: t.id });
  console.log('  An owner deleted an account');
  return { ok: true, communities: owned.length };
}));
app.post('/api/admin/users/:id/ban', auth, adminOnly, wrap(req => {
  const t = getUser(req.params.id);
  assertCanModerateSite(req.user, t);
  const reason = String(req.body.reason || '').trim().slice(0, 200) || null;
  const mins = Number(req.body.minutes); // empty / 0 = permanent
  if (req.body.minutes != null && req.body.minutes !== '' && (!Number.isFinite(mins) || mins < 0 || mins > 60 * 24 * 3650)) throw fail(400, 'Pick a ban length between 1 minute and 10 years.');
  const until = mins > 0 ? now() + Math.round(mins * 60000) : null;
  db.prepare('UPDATE users SET banned_at=?, ban_reason=?, ban_until=?, site_role=NULL WHERE id=?').run(now(), reason, until, t.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(t.id);
  io.to(`user:${t.id}`).emit('account:banned', { reason, until });
  setTimeout(() => io.in(`user:${t.id}`).disconnectSockets(true), 300);
  broadcastUserUpdate(t.id, publicUser(getUser(t.id)));
  return { ok: true };
}));
// ---------------------------------------------------------------- GIFs
// Search goes through lumi's server so the API key stays secret. Uses KLIPY (KLIPY_API_KEY),
// or GIPHY (GIPHY_API_KEY) if that's what's set. Only family-friendly results are asked for.
db.exec(`CREATE TABLE IF NOT EXISTS gif_favs (user_id TEXT NOT NULL, url TEXT NOT NULL, preview TEXT, w INTEGER, h INTEGER, at INTEGER, PRIMARY KEY (user_id, url))`);
const GIF_HOSTS = /(^|\.)(klipy\.com|klipy\.co|giphy\.com)$/i;
const isGifUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && GIF_HOSTS.test(x.hostname); } catch { return false; } };
const gifProvider = () => (process.env.KLIPY_API_KEY ? 'klipy' : process.env.GIPHY_API_KEY ? 'giphy' : null);
const GIF_TERMS = ['hello', 'lol', 'love', 'happy birthday', 'yes', 'no', 'sad', 'wow', 'dance', 'thank you', 'facepalm', 'good night'];
const gifCache = new Map();
function mediaLeaves(o, p = '', out = []) {
  if (!o || typeof o !== 'object') return out;
  if (typeof o.url === 'string' && o.url.startsWith('https://')) {
    const ext = (o.url.split('?')[0].match(/\.(gif|webp|mp4|webm|jpe?g|png)$/i) || [])[1]?.toLowerCase();
    const w = Number(o.width || o.dims?.[0]) || 0, h = Number(o.height || o.dims?.[1]) || 0;
    out.push({ url: o.url, w, h, ext, path: p.toLowerCase() });
    // GIPHY lists a smaller WebP copy right next to each GIF
    if (typeof o.webp === 'string' && o.webp.startsWith('https://')) out.push({ url: o.webp, w, h, ext: 'webp', path: p.toLowerCase() });
  }
  for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object') mediaLeaves(v, p + '/' + k, out);
  return out;
}
function pickGif(item) {
  const all = mediaLeaves(item).filter((m) => isGifUrl(m.url) && ['gif', 'webp'].includes(m.ext));
  if (!all.length) return null;
  const sizeOf = (m) => m.w || (/\/(xs|tiny|nano)/.test(m.path) ? 120 : /\/(sm|small|fixed_width)/.test(m.path) ? 220 : /\/(md|medium|downsized)/.test(m.path) ? 400 : 700);
  const near = (target) => [...all].sort((a, b) => Math.abs(sizeOf(a) - target) - Math.abs(sizeOf(b) - target) || (a.ext === 'webp' ? -1 : 1))[0];
  const prev = near(220), full = near(420);
  return { id: String(item.id ?? item.slug ?? full.url), title: String(item.title || item.content_description || '').slice(0, 100),
    preview: prev.url, url: full.url, w: full.w || prev.w || 1, h: full.h || prev.h || 1 };
}
async function gifQuery(kind, q, page, uid, ttl = 15 * 60_000) {
  const prov = gifProvider(); if (!prov) throw fail(503, 'GIFs aren’t switched on yet.');
  const per = 24; let url;
  if (prov === 'klipy') {
    const qs = new URLSearchParams({ page: String(page), per_page: String(per), customer_id: crypto.createHash('sha256').update('lumi:' + uid).digest('hex').slice(0, 32), locale: 'en_US', rating: 'g', content_filter: 'high' });
    if (q) qs.set('q', q);
    url = `${process.env.KLIPY_API_BASE || 'https://api.klipy.com'}/api/v1/${encodeURIComponent(process.env.KLIPY_API_KEY)}/gifs/${kind}?${qs}`;
  } else {
    const qs = new URLSearchParams({ api_key: process.env.GIPHY_API_KEY, limit: String(per), offset: String((page - 1) * per), rating: 'g', lang: 'en' });
    if (q) qs.set('q', q);
    url = `${process.env.GIPHY_API_BASE || 'https://api.giphy.com'}/v1/gifs/${kind}?${qs}`;
  }
  const key = `${kind}|${q}|${page}`, hit = gifCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r || !r.ok) throw fail(502, 'Couldn’t load GIFs right now. Try again in a moment.');
  const body = await r.json().catch(() => ({}));
  const list = Array.isArray(body.data) ? body.data : Array.isArray(body.data?.data) ? body.data.data : Array.isArray(body.results) ? body.results : [];
  const items = list.filter((x) => (!x.type || /gif/i.test(x.type)) && (!x.rating || /^(g|y)$/i.test(x.rating)) && !moderation.isNsfwSearch(`${x.title || ''} ${x.slug || ''} ${x.content_description || ''} ${x.alt_text || ''} ${x.username || ''} ${(x.tags || []).join(' ')}`))
    .map(pickGif).filter(Boolean);
  const data = { items, more: items.length >= per / 2 && page < 20 };
  gifCache.set(key, { at: Date.now(), data });
  if (gifCache.size > 500) gifCache.delete(gifCache.keys().next().value);
  return data;
}
let gifHomeJob = null;
function refreshGifHome(uid) {
  if (gifHomeJob) return gifHomeJob;
  gifHomeJob = (async () => {
    const first = async (kind, q) => { try { return (await gifQuery(kind, q, 1, uid, 6 * 3600_000)).items[0]?.preview || null; } catch { return null; } };
    const [trending, ...cats] = await Promise.all([first('trending', ''), ...GIF_TERMS.map((t) => first('search', t))]);
    if (trending || cats.some(Boolean)) db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run('gif_home', JSON.stringify({ at: Date.now(), trending, categories: GIF_TERMS.map((term, i) => ({ term, preview: cats[i] })) }));
  })().finally(() => { gifHomeJob = null; });
  return gifHomeJob;
}
app.get('/api/gifs/home', auth, wrap(async (req) => {
  const favs = db.prepare('SELECT preview FROM gif_favs WHERE user_id=? ORDER BY at DESC LIMIT 1').get(req.user.id);
  if (!gifProvider()) return { enabled: false, favPreview: favs?.preview || null, categories: [] };
  // category pictures barely change: they're saved (so updates don't wipe them) and refreshed every 6 hours in the background
  const saved = JSON.parse(db.prepare("SELECT v FROM meta WHERE k='gif_home'").get()?.v || 'null');
  if (!saved || Date.now() - saved.at > 6 * 3600_000) {
    const job = refreshGifHome(req.user.id);
    if (!saved) await job; // only the very first time do we wait
  }
  const home = JSON.parse(db.prepare("SELECT v FROM meta WHERE k='gif_home'").get()?.v || 'null') || { trending: null, categories: [] };
  return { enabled: true, favPreview: favs?.preview || null, trending: home.trending, categories: home.categories };
}));
app.get('/api/gifs/search', auth, wrap(async (req) => {
  rateLimit('gif:' + req.user.id, 120, 60_000);
  const q = String(req.query.q || '').trim().slice(0, 60), page = Math.max(1, Math.min(20, Number(req.query.page) || 1));
  if (moderation.isNsfwSearch(q)) throw fail(400, 'That search isn’t allowed on lumi.');
  // 2+ letters is fine (gg, ok, hi); a few short starts of bad words are refused outright
  if (q && (q.match(/[a-z0-9]/gi) || []).length < 2) return { items: [], more: false, short: true };
  if (/^(se|sx|s3|po|p0|nu|bo|b0|ti|t1|di|d1|pu|cu|xx|ho|ns|tw|nk|as|pp|pe)$/i.test(q.replace(/[^a-z0-9]/gi, ''))) return { items: [], more: false, short: true };
  const r = await gifQuery(q ? 'search' : 'trending', q, page, req.user.id);
  return { ...r, items: r.items.filter((g) => gifVerdicts.get(g.url) !== false) };
}));
app.get('/api/gifs/favorites', auth, wrap((req) => ({ items: db.prepare('SELECT url, preview, w, h FROM gif_favs WHERE user_id=? ORDER BY at DESC LIMIT 300').all(req.user.id) })));
app.put('/api/gifs/favorites', auth, wrap((req) => {
  const { url, preview, w, h } = req.body || {};
  if (!isGifUrl(url) || (preview && !isGifUrl(preview))) throw fail(400, 'That isn’t a GIF.');
  if (gifVerdicts.get(url) === false) throw fail(422, 'That GIF isn’t allowed on lumi.');
  db.prepare('INSERT OR REPLACE INTO gif_favs VALUES (?,?,?,?,?,?)').run(req.user.id, url, preview || url, Number(w) || 1, Number(h) || 1, now());
  return { ok: true };
}));
app.delete('/api/gifs/favorites', auth, wrap((req) => { db.prepare('DELETE FROM gif_favs WHERE user_id=? AND url=?').run(req.user.id, String(req.query.url || '')); return { ok: true }; }));

// ---- automatic NSFW moderation
// 'ok', 'block' (thrown away) or 'ban' (thrown away + permanent ban). The model's "drawn explicit" score
// misfires on normal anime and cartoon art, so it needs far more certainty than the photo score.
function imageVerdict(s, name = '') {
  if (!s) return 'ok';
  if (process.env.NSFW_TEST === 'ban') return 'ban';
  const porn = s.porn || 0, drawn = s.hentai || 0;
  const v = porn >= 0.85 || drawn >= 0.97 ? 'ban' : porn >= 0.6 || drawn >= 0.88 || porn + drawn >= 0.92 ? 'block' : 'ok';
  if (v !== 'ok') console.log(`  Moderation: ${v === 'ban' ? 'banned' : 'blocked'} an image ${name} (photo ${porn.toFixed(2)}, drawn ${drawn.toFixed(2)})`);
  return v;
}
db.exec(`CREATE TABLE IF NOT EXISTS mod_events (id TEXT PRIMARY KEY, user_id TEXT, server_id TEXT, kind TEXT, score REAL, action TEXT, at INTEGER)`);
const NSFW_BLOCK = Number(process.env.NSFW_BLOCK || 0.5), NSFW_BAN = Number(process.env.NSFW_BAN || 0.7), NSFW_SERVER_FLAGS = 3;
function siteBan(uid, reason, until = null) {
  db.prepare('UPDATE users SET banned_at=?, ban_reason=?, ban_until=?, site_role=NULL WHERE id=?').run(now(), reason, until, uid);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(uid);
  io.to(`user:${uid}`).emit('account:banned', { reason, until });
  setTimeout(() => io.in(`user:${uid}`).disconnectSockets(true), 300);
  broadcastUserUpdate(uid, publicUser(getUser(uid)));
}
function takeDownServer(sid, why) {
  const s = db.prepare('SELECT * FROM servers WHERE id=?').get(sid); if (!s) return;
  io.to(`server:${sid}`).emit('server:removed', { serverId: sid, reason: 'removed' });
  db.prepare('DELETE FROM servers WHERE id=?').run(sid);
  officialDM(s.owner_id, { tone: 'warn', title: 'Your community was taken down', body: `**${s.name}** was removed automatically.`, reason: 'NSFW content. Communities with nudity or sexual content aren’t allowed on lumi.', foot: 'Think this was a mistake? DM cook or type.' });
  console.log(`  Moderation: took down a community (${why})`);
}
// returns true if the person was banned
function nsfwStrike(user, sid, kind, scores, ban) {
  const staff = user.site_role === 'owner' || user.site_role === 'admin';
  const s = sid ? db.prepare('SELECT * FROM servers WHERE id=?').get(sid) : null;
  const doBan = ban && !staff;
  db.prepare('INSERT INTO mod_events VALUES (?,?,?,?,?,?,?)').run(id(), user.id, s?.id || null, kind, scores ? moderation.nsfwScore(scores) : null, doBan ? 'banned' : 'blocked', now());
  if (doBan) { siteBan(user.id, 'Posting nudity or sexual content (automatic)'); console.log(`  Moderation: banned a user for NSFW ${kind}`); }
  else officialDM(user.id, { tone: 'warn', title: 'We removed something you posted', body: `A ${kind === 'image' ? 'picture' : kind} you posted looked like nudity or sexual content, so it was removed.`, foot: 'Posting things like this again can get your account permanently banned.' });
  if (s && !staff) {
    // the owner putting NSFW in their own community, or several people doing it, means it's an NSFW community
    const flagged = db.prepare('SELECT COUNT(DISTINCT user_id) n FROM mod_events WHERE server_id=?').get(s.id).n;
    if ((s.owner_id === user.id && doBan) || flagged >= NSFW_SERVER_FLAGS) {
      takeDownServer(s.id, 'NSFW content');
      if (s.owner_id !== user.id) { const o = getUser(s.owner_id); if (o && o.site_role !== 'owner' && o.site_role !== 'admin' && flagged >= NSFW_SERVER_FLAGS) siteBan(o.id, 'Running an NSFW community (automatic)'); }
    }
  }
  return doBan;
}

app.delete('/api/admin/users/:id/ban', auth, adminOnly, wrap(req => {
  const t = getUser(req.params.id);
  if (!t) throw fail(404, 'User not found');
  db.prepare('UPDATE users SET banned_at=NULL, ban_reason=NULL, ban_until=NULL WHERE id=?').run(t.id);
  return { ok: true };
}));
// set someone's lumi role: 'member' | 'admin' | 'owner'
function setSiteRole(actor, t, role) {
  if (!['member', 'admin', 'owner'].includes(role)) throw fail(400, 'Unknown role.');
  if (actor.site_role !== 'owner') throw fail(403, 'Only lumi owners can change roles.');
  if (!t) throw fail(404, 'User not found');
  if (t.id === actor.id) throw fail(400, "You can't change your own role.");
  if (isPrimaryOwner(t)) throw fail(403, "The main owner's role can't be changed.");
  const primary = isPrimaryOwner(actor);
  if (t.site_role === 'owner' && !primary) throw fail(403, `Only @${PRIMARY_OWNER} can change another owner's role.`);
  if (role === 'owner' && !primary) throw fail(403, `Only @${PRIMARY_OWNER} can make someone an owner.`);
  if (role !== 'member' && activeBan(t)) throw fail(400, 'Unban them first.');
  db.prepare('UPDATE users SET site_role=? WHERE id=?').run(role === 'member' ? null : role, t.id);
  broadcastUserUpdate(t.id, publicUser(getUser(t.id)));
  return { ok: true, role };
}
app.post('/api/admin/users/:id/role', auth, wrap(req => setSiteRole(req.user, getUser(req.params.id), String(req.body.role || ''))));
// older buttons: never touch owners
app.post('/api/admin/users/:id/admin', auth, wrap(req => {
  const t = getUser(req.params.id);
  if (t?.site_role === 'owner') throw fail(400, 'Owners already have every admin power.');
  return setSiteRole(req.user, t, 'admin');
}));
app.delete('/api/admin/users/:id/admin', auth, wrap(req => {
  const t = getUser(req.params.id);
  if (!t || t.site_role !== 'admin') throw fail(400, 'That person is not an admin.');
  return setSiteRole(req.user, t, 'member');
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
  taskEvent(req.user.id, 'invite');
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
  if (db.prepare('SELECT 1 FROM bans WHERE server_id=? AND user_id=?').get(inv.server_id, req.user.id)) throw fail(403, 'You are banned from this community.');
  if (!db.prepare('SELECT 1 FROM members WHERE server_id=? AND user_id=?').get(inv.server_id, req.user.id)) {
    addMember(inv.server_id, req.user.id);
    taskEvent(req.user.id, 'join');
    db.prepare('UPDATE invites SET uses=uses+1 WHERE code=?').run(inv.code);
    io.to(`server:${inv.server_id}`).emit('server:update', { serverId: inv.server_id, joined: publicUser(req.user) });
  }
  return serverDetail(inv.server_id, req.user.id);
}));

// ---- Stargaze (server discovery)
const DISCOVER_MIN = 1000;
const memberCountOf = (sid) => db.prepare('SELECT COUNT(*) n FROM members WHERE server_id=?').get(sid).n;
// a lumi owner's servers skip the member minimum
const discoverExempt = (s) => { const o = getUser(s.owner_id); return o?.site_role === 'owner' || hasSparks(o); };
const featuredServer = (s) => getUser(s.owner_id)?.site_role === 'owner';
function discoverStatus(s) {
  const count = memberCountOf(s.id), exempt = discoverExempt(s);
  return { enabled: !!s.discoverable, eligible: exempt || count >= DISCOVER_MIN, exempt, viaSparks: exempt && !featuredServer(s), memberCount: count, minimum: DISCOVER_MIN, category: s.discover_category || null };
}
app.get('/api/servers/:id/discovery', auth, wrap(req => {
  const s = db.prepare('SELECT * FROM servers WHERE id=?').get(req.params.id);
  if (!s || !memberPerms(s.id, req.user.id)) throw fail(404, 'Community not found');
  return discoverStatus(s);
}));
app.put('/api/servers/:id/discovery', auth, wrap(req => {
  const sid = req.params.id;
  if (!has(memberPerms(sid, req.user.id), P.MANAGE_SERVER)) throw fail(403, 'You need the Manage Community permission.');
  const s = db.prepare('SELECT * FROM servers WHERE id=?').get(sid);
  const on = req.body.enabled === undefined ? !!s.discoverable : !!req.body.enabled, st = discoverStatus(s);
  if (on && !st.eligible) throw fail(403, `Communities need at least ${DISCOVER_MIN.toLocaleString('en-US')} members to be listed on Stargaze.`);
  // owners write their own genre (short free text)
  const cat = req.body.category !== undefined ? (String(req.body.category || '').replace(/\s+/g, ' ').trim().slice(0, 24) || null) : s.discover_category;
  if (on && !String(s.description || '').trim()) throw fail(400, 'Add a description in Overview first, so people know what your community is about.');
  db.prepare('UPDATE servers SET discoverable=?, discover_category=? WHERE id=?').run(on ? 1 : 0, cat, sid);
  io.to(`server:${sid}`).emit('server:update', { serverId: sid });
  return discoverStatus(db.prepare('SELECT * FROM servers WHERE id=?').get(sid));
}));
app.get('/api/discover', auth, wrap(req => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const rows = db.prepare('SELECT * FROM servers WHERE discoverable=1').all();
  const out = [];
  for (const s of rows) {
    const st = discoverStatus(s);
    if (!st.eligible) continue; // dropped under the minimum: hidden until it grows back
    if (q && !(s.name.toLowerCase().includes(q) || String(s.description || '').toLowerCase().includes(q) || String(s.discover_category || '').toLowerCase().includes(q))) continue;
    const online = db.prepare('SELECT user_id FROM members WHERE server_id=?').all(s.id).filter((m) => isOnline(m.user_id)).length;
    out.push({ id: s.id, name: s.name, icon: s.icon, banner: s.banner, description: s.description, category: s.discover_category || null,
      memberCount: st.memberCount, onlineCount: online, featured: featuredServer(s), joined: !!db.prepare('SELECT 1 FROM members WHERE server_id=? AND user_id=?').get(s.id, req.user.id) });
  }
  out.sort((a, b) => (b.featured - a.featured) || (b.onlineCount - a.onlineCount) || (b.memberCount - a.memberCount));
  return { servers: out.slice(0, 120) };
}));
app.post('/api/discover/:id/join', auth, wrap(req => {
  const s = db.prepare('SELECT * FROM servers WHERE id=?').get(req.params.id);
  if (!s || !s.discoverable || !discoverStatus(s).eligible) throw fail(404, 'This community is not on Stargaze.');
  if (db.prepare('SELECT 1 FROM bans WHERE server_id=? AND user_id=?').get(s.id, req.user.id)) throw fail(403, 'You are banned from this community.');
  if (!db.prepare('SELECT 1 FROM members WHERE server_id=? AND user_id=?').get(s.id, req.user.id)) {
    addMember(s.id, req.user.id);
    taskEvent(req.user.id, 'join');
    io.to(`server:${s.id}`).emit('server:update', { serverId: s.id, joined: publicUser(req.user) });
  }
  return serverDetail(s.id, req.user.id);
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
  taskEvent(req.user.id, 'moment');
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

// ---------------------------------------------------------------- streaks, posts, sparks, pulse
const DAY = 86400_000;
const dayNum = (t) => Math.floor(t / DAY);
function dmStreak(cid, members) {
  if (members.length !== 2) return 0;
  const rows = db.prepare('SELECT DISTINCT author_id a, created_at / 86400000 d FROM messages WHERE channel_id=? AND created_at>?').all(cid, now() - 120 * DAY);
  const by = new Map(); for (const r of rows) { const d = Math.floor(r.d); (by.get(d) || by.set(d, new Set()).get(d)).add(r.a); }
  const both = (d) => (by.get(d)?.size || 0) >= 2;
  let d = dayNum(now()); if (!both(d)) d -= 1;
  let n = 0; while (both(d)) { n++; d--; }
  return n;
}
const SPARKS = [
  'What made you smile today?', 'What are you listening to on repeat?', 'Share something you are proud of this week.',
  'What is the best thing you ate recently?', 'Recommend a show, game, or book to your friends.', 'What is one goal for this week?',
  'Describe your perfect weekend in one sentence.', 'What is a small thing that made your day better?', 'What are you learning right now?',
  'Post the last photo you took (if you dare).', 'What song would be the soundtrack of your day?', 'What is something you are looking forward to?',
  'What is your current comfort food?', 'Name a place you would love to visit.', 'What is a hot take you will defend?',
  'Who deserves a shout-out today, and why?', 'What is on your desk right now?', 'Describe today in three words.',
];
const todaySpark = () => { const d = dayNum(now()); return { id: 's' + d, text: SPARKS[d % SPARKS.length], endsAt: (d + 1) * DAY }; };
const friendIdsOf = (uid) => friendList(uid).filter(f => f.type === 'friend').map(f => f.user.id);
const serverIdsOf = (uid) => db.prepare('SELECT server_id FROM members WHERE user_id=?').all(uid).map(r => r.server_id);
function canSeePost(uid, p) {
  if (!p) return false;
  if (p.server_id) return memberPerms(p.server_id, uid) > 0;
  return p.user_id === uid || areFriends(uid, p.user_id);
}
function serializePost(p, uid) {
  const likes = db.prepare('SELECT COUNT(*) n FROM post_likes WHERE post_id=?').get(p.id).n;
  const comments = db.prepare('SELECT * FROM post_comments WHERE post_id=? ORDER BY created_at DESC LIMIT 2').all(p.id).reverse();
  const s = p.server_id ? db.prepare('SELECT id, name, icon FROM servers WHERE id=?').get(p.server_id) : null;
  const likers = db.prepare('SELECT user_id FROM post_likes WHERE post_id=? ORDER BY created_at DESC LIMIT 3').all(p.id).map(r => publicUser(getUser(r.user_id))).filter(Boolean);
  return { id: p.id, author: publicUser(getUser(p.user_id)), content: p.content, image: p.image, spark: p.spark ? { id: p.spark, text: SPARKS[Number(p.spark.slice(1)) % SPARKS.length] } : null,
    server: s ? { id: s.id, name: s.name, icon: s.icon } : null, createdAt: p.created_at, likes, liked: !!db.prepare('SELECT 1 FROM post_likes WHERE post_id=? AND user_id=?').get(p.id, uid),
    likers, commentCount: db.prepare('SELECT COUNT(*) n FROM post_comments WHERE post_id=?').get(p.id).n,
    comments: comments.map(c => ({ id: c.id, author: publicUser(getUser(c.user_id)), content: c.content, createdAt: c.created_at })),
    canDelete: p.user_id === uid || isSiteAdmin(getUser(uid)) || (p.server_id ? has(memberPerms(p.server_id, uid), P.MANAGE_MESSAGES) : false) };
}
function postAudience(p) {
  if (p.server_id) return [`server:${p.server_id}`];
  return [p.user_id, ...friendIdsOf(p.user_id)].map(u => `user:${u}`);
}
const emitPost = (p, ev, data) => { let r = io; for (const room of postAudience(p)) r = r.to(room); r.emit(ev, data); };
app.get('/api/feed', auth, wrap(req => {
  const uid = req.user.id; const before = Number(req.query.before) || now() + 1; const scope = String(req.query.scope || 'all');
  let rows;
  if (scope.startsWith('server:')) {
    const sid = scope.slice(7); if (!memberPerms(sid, uid)) throw fail(404, 'Community not found');
    rows = db.prepare('SELECT * FROM posts WHERE server_id=? AND created_at<? ORDER BY created_at DESC LIMIT 20').all(sid, before);
  } else if (scope.startsWith('user:')) {
    const tid = scope.slice(5); if (tid !== uid && !areFriends(uid, tid)) return { posts: [] };
    const sids = serverIdsOf(uid);
    rows = db.prepare(`SELECT * FROM posts WHERE user_id=? AND created_at<? AND (server_id IS NULL OR server_id IN (${sids.map(() => '?').join(',') || "''"})) ORDER BY created_at DESC LIMIT 20`).all(tid, before, ...sids);
  } else {
    const fids = scope === 'orbits' ? [] : [uid, ...friendIdsOf(uid)]; const sids = scope === 'friends' ? [] : serverIdsOf(uid);
    const q = (a) => a.map(() => '?').join(',') || "''";
    rows = db.prepare(`SELECT * FROM posts WHERE created_at<? AND ((server_id IS NULL AND user_id IN (${q(fids)})) OR server_id IN (${q(sids)})) ORDER BY created_at DESC LIMIT 20`).all(before, ...fids, ...sids);
  }
  return { posts: rows.map(p => serializePost(p, uid)) };
}));
app.post('/api/posts', auth, wrap(req => {
  const content = String(req.body.content || '').trim().slice(0, 1000);
  const image = typeof req.body.image === 'string' && req.body.image.startsWith('/uploads/') ? req.body.image : null;
  if (!content && !image) throw fail(400, 'Write something or add a photo.');
  const sid = req.body.serverId || null;
  if (sid && !has(memberPerms(sid, req.user.id), P.SEND_MESSAGES)) throw fail(403, 'You can’t post in this community.');
  const spark = req.body.spark ? todaySpark().id : null;
  rateLimit('post:' + req.user.id, 30, 3600_000);
  const p = { id: id(), user_id: req.user.id, server_id: sid, content, image, spark, created_at: now() };
  db.prepare('INSERT INTO posts (id, user_id, server_id, content, image, spark, created_at) VALUES (?,?,?,?,?,?,?)').run(p.id, p.user_id, p.server_id, p.content, p.image, p.spark, p.created_at);
  emitPost(p, 'post:new', { id: p.id, serverId: sid });
  taskEvent(req.user.id, 'post');
  return { post: serializePost(p, req.user.id) };
}));
const loadPost = (pid, uid) => { const p = db.prepare('SELECT * FROM posts WHERE id=?').get(pid); if (!canSeePost(uid, p)) throw fail(404, 'Post not found'); return p; };
app.get('/api/posts/:id', auth, wrap(req => ({ post: serializePost(loadPost(req.params.id, req.user.id), req.user.id) })));
app.delete('/api/posts/:id', auth, wrap(req => {
  const p = loadPost(req.params.id, req.user.id);
  if (!serializePost(p, req.user.id).canDelete) throw fail(403, 'You can’t delete this post.');
  db.prepare('DELETE FROM posts WHERE id=?').run(p.id); emitPost(p, 'post:delete', { id: p.id });
  return { ok: true };
}));
app.post('/api/posts/:id/like', auth, wrap(req => {
  const p = loadPost(req.params.id, req.user.id);
  const on = !db.prepare('SELECT 1 FROM post_likes WHERE post_id=? AND user_id=?').get(p.id, req.user.id);
  if (on) db.prepare('INSERT INTO post_likes VALUES (?,?,?)').run(p.id, req.user.id, now()); else db.prepare('DELETE FROM post_likes WHERE post_id=? AND user_id=?').run(p.id, req.user.id);
  emitPost(p, 'post:update', { id: p.id });
  if (on && p.user_id !== req.user.id) io.to(`user:${p.user_id}`).emit('activity:new', { kind: 'glow', from: publicUser(req.user) });
  if (on) taskEvent(req.user.id, 'glow');
  return { post: serializePost(p, req.user.id) };
}));
app.get('/api/posts/:id/comments', auth, wrap(req => {
  const p = loadPost(req.params.id, req.user.id);
  return { comments: db.prepare('SELECT * FROM post_comments WHERE post_id=? ORDER BY created_at').all(p.id).map(c => ({ id: c.id, author: publicUser(getUser(c.user_id)), content: c.content, createdAt: c.created_at, canDelete: c.user_id === req.user.id || p.user_id === req.user.id })) };
}));
app.post('/api/posts/:id/comments', auth, wrap(req => {
  const p = loadPost(req.params.id, req.user.id);
  const content = String(req.body.content || '').trim().slice(0, 500); if (!content) throw fail(400, 'Write a reply.');
  rateLimit('cmt:' + req.user.id, 90, 3600_000);
  db.prepare('INSERT INTO post_comments VALUES (?,?,?,?,?)').run(id(), p.id, req.user.id, content, now());
  emitPost(p, 'post:update', { id: p.id });
  if (p.user_id !== req.user.id) io.to(`user:${p.user_id}`).emit('activity:new', { kind: 'reply', from: publicUser(req.user) });
  taskEvent(req.user.id, 'comment');
  return { post: serializePost(p, req.user.id) };
}));
app.delete('/api/comments/:id', auth, wrap(req => {
  const c = db.prepare('SELECT * FROM post_comments WHERE id=?').get(req.params.id); if (!c) throw fail(404, 'Not found');
  const p = loadPost(c.post_id, req.user.id);
  if (c.user_id !== req.user.id && p.user_id !== req.user.id) throw fail(403, 'Not allowed');
  db.prepare('DELETE FROM post_comments WHERE id=?').run(c.id); emitPost(p, 'post:update', { id: p.id });
  return { ok: true };
}));
app.get('/api/spark', auth, wrap(req => {
  const sp = todaySpark(); const fids = [req.user.id, ...friendIdsOf(req.user.id)];
  const rows = db.prepare(`SELECT DISTINCT user_id FROM posts WHERE spark=? AND server_id IS NULL AND user_id IN (${fids.map(() => '?').join(',')})`).all(sp.id, ...fids);
  return { spark: sp, answered: rows.some(r => r.user_id === req.user.id), friends: rows.filter(r => r.user_id !== req.user.id).map(r => publicUser(getUser(r.user_id))) };
}));
app.get('/api/activity', auth, wrap(req => {
  const uid = req.user.id; const since = now() - 14 * DAY;
  const likes = db.prepare(`SELECT l.user_id, l.created_at, p.id pid, p.content FROM post_likes l JOIN posts p ON p.id=l.post_id WHERE p.user_id=? AND l.user_id<>? AND l.created_at>? ORDER BY l.created_at DESC LIMIT 30`).all(uid, uid, since)
    .map(r => ({ kind: 'glow', from: publicUser(getUser(r.user_id)), postId: r.pid, snippet: r.content.slice(0, 80), createdAt: r.created_at }));
  const cmts = db.prepare(`SELECT c.user_id, c.created_at, c.content, p.id pid FROM post_comments c JOIN posts p ON p.id=c.post_id WHERE p.user_id=? AND c.user_id<>? AND c.created_at>? ORDER BY c.created_at DESC LIMIT 30`).all(uid, uid, since)
    .map(r => ({ kind: 'reply', from: publicUser(getUser(r.user_id)), postId: r.pid, snippet: r.content.slice(0, 80), createdAt: r.created_at }));
  const joins = db.prepare(`SELECT m.user_id, m.joined_at, s.id sid, s.name FROM members m JOIN servers s ON s.id=m.server_id WHERE s.owner_id=? AND m.user_id<>? AND m.joined_at>? ORDER BY m.joined_at DESC LIMIT 20`).all(uid, uid, since)
    .map(r => ({ kind: 'join', from: publicUser(getUser(r.user_id)), serverId: r.sid, snippet: r.name, createdAt: r.joined_at }));
  return { items: [...likes, ...cmts, ...joins].filter(i => i.from).sort((a, b) => b.createdAt - a.createdAt).slice(0, 40) };
}));
app.get('/api/servers/:id/pulse', auth, wrap(req => {
  const sid = req.params.id; if (!memberPerms(sid, req.user.id)) throw fail(404, 'Community not found');
  const hide = has(memberPerms(sid, req.user.id), P.ADMINISTRATOR) ? '' : ' AND COALESCE(c.admin_only,0)=0';
  const t = now();
  const msgsToday = db.prepare(`SELECT COUNT(*) n FROM messages m JOIN channels c ON c.id=m.channel_id WHERE c.server_id=?${hide} AND m.created_at>?`).get(sid, t - DAY).n;
  const msgsWeek = db.prepare(`SELECT COUNT(*) n FROM messages m JOIN channels c ON c.id=m.channel_id WHERE c.server_id=?${hide} AND m.created_at>?`).get(sid, t - 7 * DAY).n;
  const active = db.prepare(`SELECT m.author_id u, COUNT(*) n FROM messages m JOIN channels c ON c.id=m.channel_id WHERE c.server_id=?${hide} AND m.created_at>? GROUP BY m.author_id ORDER BY n DESC LIMIT 5`).all(sid, t - 7 * DAY)
    .map(r => ({ user: publicUser(getUser(r.u)), count: r.n })).filter(r => r.user);
  const rooms = db.prepare(`SELECT c.id, c.name, COUNT(m.id) n, MAX(m.created_at) last FROM channels c LEFT JOIN messages m ON m.channel_id=c.id AND m.created_at>? WHERE c.server_id=?${hide} AND c.type<>'voice' AND m.thread_id IS NULL GROUP BY c.id ORDER BY n DESC, c.position LIMIT 5`).all(t - 7 * DAY, sid)
    .map(r => ({ id: r.id, name: r.name, count: r.n, last: r.last }));
  const newest = db.prepare('SELECT user_id, joined_at FROM members WHERE server_id=? ORDER BY joined_at DESC LIMIT 6').all(sid).map(r => ({ user: publicUser(getUser(r.user_id)), joinedAt: r.joined_at })).filter(r => r.user);
  const threads = db.prepare(`SELECT m.* FROM messages m JOIN channels c ON c.id=m.channel_id WHERE c.server_id=?${hide} AND c.type='board' AND m.thread_id IS NULL ORDER BY m.created_at DESC LIMIT 4`).all(sid).map(serializeMessage);
  const photos = db.prepare(`SELECT m.* FROM messages m JOIN channels c ON c.id=m.channel_id WHERE c.server_id=?${hide} AND c.type='gallery' AND m.thread_id IS NULL AND m.attachment_type='image' ORDER BY m.created_at DESC LIMIT 6`).all(sid).map(serializeMessage);
  const newMembers = db.prepare('SELECT COUNT(*) n FROM members WHERE server_id=? AND joined_at>?').get(sid, t - 7 * DAY).n;
  const days = []; for (let i = 6; i >= 0; i--) { const a = (dayNum(t) - i) * DAY; days.push(db.prepare(`SELECT COUNT(*) n FROM messages m JOIN channels c ON c.id=m.channel_id WHERE c.server_id=?${hide} AND m.created_at>=? AND m.created_at<?`).get(sid, a, a + DAY).n); }
  return { msgsToday, msgsWeek, active, rooms, newMembers, days, newest, threads, photos };
}));

// ---------------------------------------------------------------- daily tasks + badges
// Every day each person gets 3 tasks picked at random from this list. Finishing a task counts toward
// that task's badge (Bronze after 1, Silver after 5, Gold after 15). Finishing all 3 in a day counts
// toward Daily devotee (1, 7, 30 days).
const TASKS = {
  chat:     { label: 'Send 10 messages in a community', goal: 10, emoji: '💬', badge: 'Chatterbox' },
  react:    { label: 'React to 5 messages', goal: 5, emoji: '😄', badge: 'Reactor' },
  voice:    { label: 'Hang out in a call with someone for 10 minutes', goal: 10, emoji: '🎧', badge: 'Lounge regular' },
  post:     { label: 'Share a post on your feed', goal: 1, emoji: '📝', badge: 'Storyteller' },
  comment:  { label: 'Comment on a post', goal: 1, emoji: '💭', badge: 'Commentator' },
  glow:     { label: 'Glow 3 posts', goal: 3, emoji: '⭐', badge: 'Hype squad' },
  moment:   { label: 'Share a moment', goal: 1, emoji: '📸', badge: 'Moment maker' },
  dm:       { label: 'Send 5 DMs', goal: 5, emoji: '✉️', badge: 'Pen pal' },
  reply:    { label: 'Use Reply on 3 messages', goal: 3, emoji: '↩️', badge: 'Good listener' },
  thread:   { label: 'Start a thread on a board', goal: 1, emoji: '🧵', badge: 'Thread starter' },
  gallery:  { label: 'Post a photo in a gallery', goal: 1, emoji: '🖼️', badge: 'Shutterbug' },
  stargaze: { label: 'Look around Stargaze', goal: 1, emoji: '🔭', badge: 'Stargazer' },
  friend:   { label: 'Add a friend', goal: 1, emoji: '🤝', badge: 'Social butterfly' },
  status:   { label: 'Set a new status', goal: 1, emoji: '🎨', badge: 'Mood setter' },
  invite:   { label: 'Make an invite to a community', goal: 1, emoji: '🔗', badge: 'Recruiter' },
  join:     { label: 'Join a community', goal: 1, emoji: '🚪', badge: 'Wanderer' },
  level:    { label: 'Level up in a community', goal: 1, emoji: '📈', badge: 'Climber' },
  nickname: { label: 'Give a friend a nickname', goal: 1, emoji: '🏷️', badge: 'Name tag' },
};
// tasks in the same group come from the same kind of action, so a day never gets two from one group
const TASK_GROUPS = { chat: 'talk', dm: 'talk', reply: 'talk', thread: 'rooms', gallery: 'rooms', post: 'feed', comment: 'feed',
  glow: 'feed', moment: 'moments', friend: 'people', nickname: 'people', status: 'me', react: 'react', voice: 'voice',
  stargaze: 'explore', join: 'explore', invite: 'grow', level: 'grow' };
const DEVOTEE = { label: 'Finish all of a day’s tasks', emoji: '🗓️', badge: 'Daily devotee' };
// Regular badges: finish that task once. Gold and Diamond badges are their own milestones.
const RARITY = { normal: 1, gold: 3, diamond: 4 }, RARITY_NAMES = { 1: 'Bronze', 3: 'Gold', 4: 'Diamond' };
const SPECIAL = {
  week:          { badge: 'Week warrior', label: 'Finish all your daily tasks on 7 days', rarity: 'gold', goal: 7, metric: 'fullDays' },
  collector:     { badge: 'Collector', label: 'Earn 10 bronze badges', rarity: 'gold', goal: 10, metric: 'regular' },
  hustler:       { badge: 'Hustler', label: 'Complete 50 daily tasks', rarity: 'gold', goal: 50, metric: 'total' },
  unstoppable:   { badge: 'Unstoppable', label: 'Finish all your daily tasks on 30 days', rarity: 'diamond', goal: 30, metric: 'fullDays' },
  completionist: { badge: 'Completionist', label: 'Earn every bronze badge', rarity: 'diamond', goal: 0, metric: 'regular' },
  mythic:        { badge: 'Mythic', label: 'Complete 200 daily tasks', rarity: 'diamond', goal: 200, metric: 'total' },
};
const REGULAR_KEYS = () => [...Object.keys(TASKS), 'devotee'];
SPECIAL.completionist.goal = REGULAR_KEYS().length;
const ALL_BADGE_KEYS = () => [...REGULAR_KEYS(), ...Object.keys(SPECIAL)];
const badgeDef = (k) => (k === 'devotee' ? { ...DEVOTEE, rarity: 'normal', goal: 1 } : TASKS[k] ? { ...TASKS[k], rarity: 'normal', goal: 1 } : SPECIAL[k]);
// lumi owners have every badge
const ownsAllBadges = (uid) => getUser(uid)?.site_role === 'owner';
const TASKS_PER_DAY = 3;
const taskDay = () => Math.floor(Date.now() / 86400_000);

// bumping the round gives everyone a fresh set of tasks right away (owners can do this from the admin panel)
const taskRound = () => Number(db.prepare("SELECT v FROM meta WHERE k='task_round'").get()?.v || 0);
function resetAllTasks() {
  db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run('task_round', String(taskRound() + 1));
  db.prepare('DELETE FROM daily_tasks WHERE day=?').run(taskDay());
  io.emit('tasks:refresh');
}
setTimeout(() => { // one-time: new tasks for everyone
  if (db.prepare("SELECT 1 FROM meta WHERE k='tasks_reset_1'").get()) return;
  db.prepare('INSERT INTO meta VALUES (?,?)').run('tasks_reset_1', String(Date.now()));
  // the Stargaze task didn't count for people who opened Stargaze earlier in the same session: credit it
  for (const r of db.prepare("SELECT user_id FROM daily_tasks WHERE day=? AND task='stargaze' AND done_at IS NULL").all(taskDay())) {
    db.prepare('INSERT INTO task_counts (user_id, task, n) VALUES (?,?,1) ON CONFLICT(user_id, task) DO UPDATE SET n=n+1').run(r.user_id, 'stargaze');
    awardTier(r.user_id, 'stargaze', countFor(r.user_id, 'stargaze'));
  }
  resetAllTasks();
}, 1000);
function pickTasks(uid, day) {
  // stable shuffle seeded by user + day (+ reset round), so everyone gets a different mix each day
  let seed = 0; for (const ch of uid + ':' + day + (taskRound() ? ':' + taskRound() : '')) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  // skip anything from the last 2 days and badges already at Diamond; lower badges are more likely to come up
  const recent = new Set(db.prepare('SELECT task FROM daily_tasks WHERE user_id=? AND day>=? AND day<?').all(uid, day - 2, day).map((r) => r.task));
  const has = (k) => !!db.prepare('SELECT 1 FROM user_badges WHERE user_id=? AND badge=?').get(uid, k);
  const pool = (strict) => Object.keys(TASKS).filter((k) => !strict || !recent.has(k));
  let keys = pool(true); if (keys.length < 8) keys = pool(false);
  // badges you don't have yet come up more often
  const scored = keys.map((k) => ({ k, s: rnd() * (has(k) ? 1 : 3) })).sort((a, b) => b.s - a.s);
  const out = [], used = new Set();
  for (const { k } of scored) { if (out.length >= TASKS_PER_DAY) break; if (used.has(TASK_GROUPS[k])) continue; used.add(TASK_GROUPS[k]); out.push(k); }
  return out;
}
function todaysTasks(uid) {
  const day = taskDay();
  let rows = db.prepare('SELECT * FROM daily_tasks WHERE user_id=? AND day=?').all(uid, day);
  if (!rows.length) {
    for (const k of pickTasks(uid, day)) db.prepare('INSERT OR IGNORE INTO daily_tasks (user_id, day, task) VALUES (?,?,?)').run(uid, day, k);
    rows = db.prepare('SELECT * FROM daily_tasks WHERE user_id=? AND day=?').all(uid, day);
  }
  return rows.filter((r) => TASKS[r.task]);
}
function tasksState(uid) {
  return todaysTasks(uid).map((r) => ({ id: r.task, label: TASKS[r.task].label, goal: TASKS[r.task].goal, emoji: TASKS[r.task].emoji,
    badge: TASKS[r.task].badge, progress: r.progress, done: !!r.done_at }));
}
// tier: 0 = not earned yet, otherwise the badge's color (1 regular, 3 gold, 4 diamond)
function badgeInfo(key, earned, earnedAt, count) {
  const def = badgeDef(key);
  if (!def) return null;
  const r = RARITY[def.rarity];
  return { id: key, name: def.badge, emoji: def.emoji || '', how: def.label, rarity: def.rarity, tier: earned ? r : 0, tierName: RARITY_NAMES[r],
    earnedAt: earnedAt || null, count: Math.min(count || 0, def.goal), goal: def.goal };
}
function countFor(uid, key) {
  if (SPECIAL[key]) {
    const m = SPECIAL[key].metric;
    if (m === 'fullDays') return countFor(uid, 'devotee');
    if (m === 'total') return db.prepare('SELECT COALESCE(SUM(n),0) n FROM task_counts WHERE user_id=?').get(uid).n;
    const keys = REGULAR_KEYS();
    return db.prepare(`SELECT COUNT(*) n FROM user_badges WHERE user_id=? AND badge IN (${keys.map(() => '?').join(',')})`).get(uid, ...keys).n;
  }
  return key === 'devotee' ? db.prepare('SELECT COUNT(*) n FROM full_days WHERE user_id=?').get(uid).n
    : db.prepare('SELECT n FROM task_counts WHERE user_id=? AND task=?').get(uid, key)?.n || 0;
}
function badgesOf(uid) {
  const order = (b) => -b.tier;
  if (ownsAllBadges(uid)) return ALL_BADGE_KEYS().map((k) => badgeInfo(k, true, null, countFor(uid, k))).sort((a, b) => order(a) - order(b));
  return db.prepare('SELECT * FROM user_badges WHERE user_id=? ORDER BY earned_at').all(uid)
    .map((b) => badgeInfo(b.badge, true, b.earned_at, countFor(uid, b.badge))).filter(Boolean).sort((a, b) => order(a) - order(b));
}
// gives the badge if it's earned and not owned yet; returns it if newly given
function awardTier(uid, key, count) {
  const def = badgeDef(key); if (!def || count < def.goal) return null;
  if (db.prepare('SELECT 1 FROM user_badges WHERE user_id=? AND badge=?').get(uid, key)) return null;
  db.prepare('INSERT INTO user_badges VALUES (?,?,?,?)').run(uid, key, RARITY[def.rarity], Date.now());
  return badgeInfo(key, true, Date.now(), count);
}
function awardSpecials(uid) {
  const out = [];
  // collector/completionist depend on other badges, so check twice in case one unlocks the next
  for (let pass = 0; pass < 2; pass++) for (const k of Object.keys(SPECIAL)) { const b = awardTier(uid, k, countFor(uid, k)); if (b) out.push(b); }
  return out;
}
setTimeout(() => { // one-time: badges no longer have levels; hand out the new Gold/Diamond milestones people already reached
  if (db.prepare("SELECT 1 FROM meta WHERE k='badges_v2'").get()) return;
  db.prepare('INSERT INTO meta VALUES (?,?)').run('badges_v2', String(Date.now()));
  db.prepare('UPDATE user_badges SET tier=1').run();
  for (const r of db.prepare('SELECT DISTINCT user_id FROM task_counts').all()) awardSpecials(r.user_id);
}, 1500);
function taskEvent(uid, key, n = 1) {
  try {
    const row = todaysTasks(uid).find((r) => r.task === key);
    if (!row || row.done_at) return;
    const def = TASKS[key], day = taskDay();
    const progress = Math.min(def.goal, row.progress + n), done = progress >= def.goal;
    db.prepare('UPDATE daily_tasks SET progress=?, done_at=? WHERE user_id=? AND day=? AND task=?').run(progress, done ? Date.now() : null, uid, day, key);
    const earned = [];
    if (done) {
      db.prepare('INSERT INTO task_counts (user_id, task, n) VALUES (?,?,1) ON CONFLICT(user_id, task) DO UPDATE SET n=n+1').run(uid, key);
      const b = awardTier(uid, key, countFor(uid, key)); if (b) earned.push(b);
      if (todaysTasks(uid).every((r) => r.done_at)) {
        db.prepare('INSERT OR IGNORE INTO full_days VALUES (?,?)').run(uid, day);
        const d = awardTier(uid, 'devotee', countFor(uid, 'devotee')); if (d) earned.push(d);
      }
      earned.push(...awardSpecials(uid));
      if (earned.length) broadcastUserUpdate(uid, publicUser(getUser(uid)));
    }
    const payload = { tasks: tasksState(uid), completed: done ? key : null, earned };
    const p = pendingTasks.get(uid) || { completedAll: [], earned: [] };
    p.tasks = payload.tasks; if (done) p.completedAll.push(key); p.earned.push(...earned); pendingTasks.set(uid, p);
    setTimeout(() => pendingTasks.delete(uid), 5000).unref?.();
    io.to(`user:${uid}`).emit('tasks:update', payload);
  } catch (e) { console.error('task event failed:', e.message); }
}
app.get('/api/tasks', auth, wrap(req => {
  const day = taskDay();
  const owner = ownsAllBadges(req.user.id);
  const collection = ALL_BADGE_KEYS().map((k) => {
    const b = db.prepare('SELECT * FROM user_badges WHERE user_id=? AND badge=?').get(req.user.id, k);
    return badgeInfo(k, owner || !!b, b?.earned_at, countFor(req.user.id, k));
  });
  return { tasks: tasksState(req.user.id), resetsAt: (day + 1) * 86400_000, badges: collection };
}));
// a few tasks happen only in the browser (opening Stargaze)
app.post('/api/tasks/ping', auth, wrap(req => { if (req.body.event === 'stargaze') taskEvent(req.user.id, 'stargaze'); return { ok: true }; }));

// ---------------------------------------------------------------- community levels
// Members earn xp by chatting (once per 45s, so spam doesn't count) and by hanging out in lounges.
const XP_MSG = 15, XP_COOLDOWN = 45_000, XP_VOICE = 5;
const levelOf = (xp) => Math.floor((Math.sqrt(1 + (4 * xp) / 25) - 1) / 2); // level L needs 25·L·(L+1) xp
const RANKS = [[15, 'Legend'], [8, 'Veteran'], [3, 'Regular'], [0, 'Newcomer']];
const rankOf = (lvl) => RANKS.find(([min]) => lvl >= min)[1];
function addXp(sid, uid, amount, cooldown) {
  try {
    const row = db.prepare('SELECT * FROM member_xp WHERE server_id=? AND user_id=?').get(sid, uid);
    if (cooldown && row && Date.now() - row.last_at < XP_COOLDOWN) return;
    const before = row?.xp || 0, xp = before + amount;
    db.prepare('INSERT INTO member_xp (server_id, user_id, xp, last_at) VALUES (?,?,?,?) ON CONFLICT(server_id, user_id) DO UPDATE SET xp=excluded.xp, last_at=excluded.last_at')
      .run(sid, uid, xp, cooldown ? Date.now() : (row?.last_at || 0));
    io.to(`server:${sid}`).emit('member:xp', { serverId: sid, userId: uid, xp });
    const lvl = levelOf(xp);
    if (lvl > levelOf(before)) { io.to(`user:${uid}`).emit('level:up', { serverId: sid, level: lvl, rank: rankOf(lvl) }); taskEvent(uid, 'level'); }
  } catch (e) { console.error('xp failed:', e.message); }
}
// once a minute: people in a call with someone else get voice-task minutes, and xp in community lounges
setInterval(() => {
  const credited = new Set();
  for (const [cid, room] of voiceRooms) {
    if (room.size < 2) continue;
    const c = db.prepare('SELECT server_id FROM channels WHERE id=?').get(cid);
    for (const p of room.values()) {
      if (p.deafened || credited.has(p.userId)) continue;
      credited.add(p.userId);
      taskEvent(p.userId, 'voice');
      if (c?.server_id) addXp(c.server_id, p.userId, XP_VOICE, false);
    }
  }
}, 60_000);

// ---------------------------------------------------------------- personal nicknames for friends (only you see them)
app.get('/api/nicknames', auth, wrap(req => ({
  nicknames: Object.fromEntries(db.prepare('SELECT target_id, nick FROM friend_nicks WHERE owner_id=?').all(req.user.id).map((r) => [r.target_id, r.nick])) })));
app.put('/api/nicknames/:id', auth, wrap(req => {
  const t = getUser(req.params.id);
  if (!t || t.id === req.user.id) throw fail(404, 'User not found');
  const nick = sanitizeName(req.body.nickname, 32);
  if (nick && !areFriends(req.user.id, t.id)) throw fail(403, 'You can only give nicknames to friends.');
  if (nick) { db.prepare('INSERT OR REPLACE INTO friend_nicks VALUES (?,?,?)').run(req.user.id, t.id, nick); taskEvent(req.user.id, 'nickname'); }
  else db.prepare('DELETE FROM friend_nicks WHERE owner_id=? AND target_id=?').run(req.user.id, t.id);
  io.to(`user:${req.user.id}`).emit('nicknames:update', { userId: t.id, nickname: nick || null });
  return { nickname: nick || null };
}));

// ---------------------------------------------------------------- device manager
function kickSessions(uid, sids) {
  const set = new Set(sids);
  for (const sock of io.sockets.sockets.values()) if (sock.data.userId === uid && set.has(sock.data.sid)) { sock.emit('session:revoked'); sock.disconnect(true); }
}
app.get('/api/devices', auth, wrap(req => {
  const live = new Set([...io.sockets.sockets.values()].filter((x) => x.data.userId === req.user.id).map((x) => x.data.sid));
  return { devices: db.prepare('SELECT sid, ua, created_at, last_seen FROM sessions WHERE user_id=? ORDER BY COALESCE(last_seen, created_at) DESC').all(req.user.id)
    .map((x) => ({ id: x.sid, ua: x.ua || '', signedInAt: x.created_at, lastActive: x.last_seen || x.created_at, current: x.sid === req.session.sid, online: live.has(x.sid) })) };
}));
app.delete('/api/devices/:id', auth, wrap(req => {
  if (req.params.id === req.session.sid) throw fail(400, 'To sign out of this device, use Log out.');
  const r = db.prepare('DELETE FROM sessions WHERE user_id=? AND sid=?').run(req.user.id, req.params.id);
  if (!r.changes) throw fail(404, 'That device is already signed out.');
  kickSessions(req.user.id, [req.params.id]);
  return { ok: true };
}));
app.post('/api/devices/sign-out-others', auth, wrap(req => {
  const others = db.prepare('SELECT sid FROM sessions WHERE user_id=? AND sid<>?').all(req.user.id, req.session.sid).map((x) => x.sid);
  db.prepare('DELETE FROM sessions WHERE user_id=? AND sid<>?').run(req.user.id, req.session.sid);
  kickSessions(req.user.id, others);
  return { ok: true, count: others.length };
}));

// ---------------------------------------------------------------- Sparks ($5.99/month through Stripe)
// Set on Render: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (and optionally STRIPE_PRICE_ID, PUBLIC_URL).
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY, STRIPE_WH = process.env.STRIPE_WEBHOOK_SECRET, STRIPE_PRICE = process.env.STRIPE_PRICE_ID;
const SPARKS_PRICE = '$5.99';
async function stripeApi(method, p, params) {
  const r = await fetch('https://api.stripe.com/v1/' + p, { method, headers: { Authorization: 'Bearer ' + STRIPE_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error?.message || 'Stripe request failed');
  return d;
}
function publicOrigin(req) {
  const o = String(req.headers.origin || '');
  if (/^https:\/\/(lumichat\.pages\.dev|[\w-]+\.onrender\.com)$/.test(o) || /^http:\/\/localhost(:\d+)?$/.test(o)) return o;
  return (process.env.PUBLIC_URL || 'https://lumichat.pages.dev').replace(/\/$/, '');
}
function sparksState(u) {
  const free = u.site_role === 'owner' || u.site_role === 'admin';
  return { active: hasSparks(u), free, until: free ? null : u.sparks_until || null, subscribed: !!u.stripe_sub, manageable: !!u.stripe_customer && !!STRIPE_KEY,
    canBuy: !!STRIPE_KEY, price: SPARKS_PRICE, venmo: venmoHandle(), venmoAuto: venmoBotOn, pending: !!pendingSparks(u.id) };
}
const sparksChanged = (uid) => { const u = getUser(uid); if (!u) return; broadcastUserUpdate(uid, publicUser(u)); io.to(`user:${uid}`).emit('sparks:update', sparksState(u)); };
app.get('/api/sparks', auth, wrap(req => sparksState(req.user)));
app.post('/api/sparks/checkout', auth, async (req, res) => {
  try {
    const u = req.user, st = sparksState(u);
    if (!STRIPE_KEY) return res.status(503).json({ error: 'Sparks checkout isn’t switched on yet. Check back soon!' });
    if (st.free) return res.status(400).json({ error: 'You already get Sparks free as part of the lumi team.' });
    if (st.active && st.subscribed) return res.status(400).json({ error: 'You already have Sparks.' });
    const origin = publicOrigin(req);
    const p = { mode: 'subscription', client_reference_id: u.id, 'metadata[user_id]': u.id, 'subscription_data[metadata][user_id]': u.id,
      success_url: origin + '/sparks?checkout=done', cancel_url: origin + '/sparks?checkout=cancel', 'line_items[0][quantity]': 1 };
    if (STRIPE_PRICE) p['line_items[0][price]'] = STRIPE_PRICE;
    else Object.assign(p, { 'line_items[0][price_data][currency]': 'usd', 'line_items[0][price_data][unit_amount]': 599,
      'line_items[0][price_data][recurring][interval]': 'month', 'line_items[0][price_data][product_data][name]': 'lumi Sparks' });
    if (u.stripe_customer) p.customer = u.stripe_customer; else if (u.email) p.customer_email = u.email;
    const s = await stripeApi('POST', 'checkout/sessions', p);
    res.json({ url: s.url });
  } catch (e) { console.error('checkout:', e.message); res.status(502).json({ error: 'Couldn’t open checkout. Try again in a minute.' }); }
});
app.post('/api/sparks/manage', auth, async (req, res) => {
  try {
    if (!STRIPE_KEY || !req.user.stripe_customer) return res.status(400).json({ error: 'There’s no subscription to manage.' });
    const s = await stripeApi('POST', 'billing_portal/sessions', { customer: req.user.stripe_customer, return_url: publicOrigin(req) + '/sparks' });
    res.json({ url: s.url });
  } catch (e) { console.error('portal:', e.message); res.status(502).json({ error: 'Couldn’t open billing. Try again in a minute.' }); }
});
const periodEnd = (sub) => (sub?.current_period_end || sub?.items?.data?.[0]?.current_period_end || 0) * 1000;
async function onStripeEvent(ev) {
  const o = ev.data?.object || {};
  const byCustomer = (c) => c && db.prepare('SELECT * FROM users WHERE stripe_customer=?').get(c);
  if (ev.type === 'checkout.session.completed' && o.mode === 'subscription') {
    const u = getUser(o.client_reference_id || o.metadata?.user_id); if (!u) return;
    let until = Date.now() + 31 * 86400_000;
    try { const end = periodEnd(await stripeApi('GET', 'subscriptions/' + o.subscription)); if (end) until = end + 86400_000; } catch {}
    db.prepare('UPDATE users SET stripe_customer=?, stripe_sub=?, sparks_until=? WHERE id=?').run(o.customer, o.subscription, Math.max(until, u.sparks_until || 0), u.id);
    return sparksChanged(u.id);
  }
  if (ev.type === 'invoice.paid' || ev.type === 'invoice.payment_succeeded') {
    const u = byCustomer(o.customer); const end = (o.lines?.data?.[0]?.period?.end || 0) * 1000;
    if (!u || !end) return;
    db.prepare('UPDATE users SET sparks_until=? WHERE id=?').run(Math.max(end + 86400_000, u.sparks_until || 0), u.id);
    return sparksChanged(u.id);
  }
  if (ev.type === 'customer.subscription.updated' || ev.type === 'customer.subscription.deleted') {
    const u = byCustomer(o.customer) || db.prepare('SELECT * FROM users WHERE stripe_sub=?').get(o.id); if (!u) return;
    if (ev.type === 'customer.subscription.deleted' || ['canceled', 'unpaid', 'incomplete_expired'].includes(o.status)) {
      db.prepare('UPDATE users SET sparks_until=?, stripe_sub=NULL WHERE id=?').run(Math.min(u.sparks_until || 0, Date.now()), u.id);
    } else if (['active', 'trialing'].includes(o.status) && periodEnd(o)) {
      db.prepare('UPDATE users SET sparks_until=?, stripe_sub=? WHERE id=?').run(periodEnd(o) + 86400_000, o.id, u.id);
    }
    return sparksChanged(u.id);
  }
}
function stripeWebhook(req, res) {
  if (!STRIPE_WH || !Buffer.isBuffer(req.body)) return res.status(503).end();
  const parts = String(req.headers['stripe-signature'] || '').split(',').map((x) => x.split('='));
  const t = parts.find(([k]) => k === 't')?.[1], sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  const payload = req.body.toString('utf8');
  const expected = crypto.createHmac('sha256', STRIPE_WH).update(`${t}.${payload}`).digest('hex');
  const ok = t && Math.abs(Date.now() / 1000 - Number(t)) < 600 && sigs.some((v) => v.length === expected.length && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(expected)));
  if (!ok) return res.status(400).json({ error: 'Bad signature' });
  let ev; try { ev = JSON.parse(payload); } catch { return res.status(400).end(); }
  onStripeEvent(ev).then(() => res.json({ received: true }), (e) => { console.error('stripe webhook:', e.message); res.status(500).end(); });
}


// ---------------------------------------------------------------- Sparks through Venmo (checked by hand)
// People pay the main owner on Venmo, tap "I sent it", and an owner approves it in the admin panel.
// The Venmo username is set in the admin panel (stored in the database, not in the code).
db.exec(`CREATE TABLE IF NOT EXISTS sparks_requests (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', decided_at INTEGER, decided_by TEXT)`);
// one-time cleanup: Sparks handed out by the old auto-approve is removed (card subscribers keep theirs)
if (!db.prepare("SELECT 1 FROM meta WHERE k='sparks_reset_1'").get()) {
  db.prepare('UPDATE users SET sparks_until=NULL WHERE stripe_sub IS NULL').run();
  db.prepare("UPDATE sparks_requests SET status='denied', decided_at=? WHERE status='auto'").run(Date.now());
  db.prepare('INSERT INTO meta VALUES (?,?)').run('sparks_reset_1', String(Date.now()));
}
const venmoHandle = () => db.prepare("SELECT v FROM meta WHERE k='venmo_handle'").get()?.v || null;
const pendingSparks = (uid) => db.prepare("SELECT * FROM sparks_requests WHERE user_id=? AND status='pending'").get(uid);
function ownerOnly(req, res, next) { if (req.user.site_role !== 'owner') return res.status(403).json({ error: 'Owners only' }); next(); }
function grantSparks(uid, days) {
  const u = getUser(uid); if (!u) throw fail(404, 'User not found');
  const until = days > 0 ? Math.max(Date.now(), u.sparks_until || 0) + days * 86400_000 : Date.now();
  db.prepare('UPDATE users SET sparks_until=? WHERE id=?').run(until, uid);
  sparksChanged(uid);
  if (days > 0) officialDM(uid, { tone: 'good', title: 'Sparks is on ✨', body: `Thanks for supporting lumi! Your Sparks perks are active until **${fmtDay(until)}**: custom name fonts, themes, a golden nameplate and more.` });
  return until;
}
const tellOwners = (quiet) => { for (const o of db.prepare("SELECT id FROM users WHERE site_role='owner'").all()) io.to(`user:${o.id}`).emit('sparks:requests', { quiet: !!quiet }); };
app.post('/api/sparks/venmo-sent', auth, wrap(req => {
  if (!venmoHandle()) throw fail(400, 'Venmo payments aren’t set up yet.');
  if (pendingSparks(req.user.id)) return { pending: true };
  if ((req.user.sparks_until || 0) > now() + 5 * 86400_000) throw fail(400, 'You already have Sparks. You can renew in the last few days before it runs out.');
  rateLimit('venmo:' + req.user.id, 5, 24 * 3600_000);
  // the Venmo bot (below) approves it when Venmo's payment email arrives; owners can still approve by hand
  db.prepare('INSERT INTO sparks_requests (id, user_id, created_at) VALUES (?,?,?)').run(id(), req.user.id, now());
  if (venmoBotOn) setTimeout(() => venmoBotRun().catch(() => {}), 1500); else tellOwners();
  matchVenmoPayments();
  return { pending: !pendingSparks(req.user.id) ? false : true, active: !pendingSparks(req.user.id) };
}));
// ---- Venmo bot: reads Venmo's "paid you" emails from the owner's inbox (IMAP) and approves/denies by itself.
// Set on Render: VENMO_EMAIL (the email Venmo notifies) and VENMO_EMAIL_PASSWORD (a Gmail app password).
// Optional: VENMO_IMAP_HOST (default imap.gmail.com).
db.exec(`CREATE TABLE IF NOT EXISTS venmo_payments (msg_id TEXT PRIMARY KEY, username TEXT, amount REAL, payer TEXT, received_at INTEGER, used_by TEXT)`);
const VENMO_IMAP = { host: process.env.VENMO_IMAP_HOST || 'imap.gmail.com', user: process.env.VENMO_EMAIL, pass: process.env.VENMO_EMAIL_PASSWORD };
const venmoBotOn = !!(VENMO_IMAP.user && VENMO_IMAP.pass);
const SPARKS_CENTS = 599;
let venmoBotStatus = { on: venmoBotOn, lastCheck: null, lastError: null };
// Pull what we need out of one Venmo email. Only trusts mail that the inbox confirms really came from venmo.com.
function parseVenmoMail(mail, rawHeaders) {
  const from = String(mail.from?.value?.[0]?.address || '').toLowerCase();
  if (!/@(venmo\.com|email\.venmo\.com)$/.test(from)) return null;
  const auth = String(rawHeaders || '').toLowerCase();
  if (!/dkim=pass[^;]*header\.(d|i)=@?(email\.)?venmo\.com/.test(auth)) return null; // forged "from venmo" mail fails this
  const subject = String(mail.subject || '');
  const text = (subject + '\n' + (mail.text || String(mail.html || '').replace(/<[^>]+>/g, ' '))).replace(/\s+/g, ' ');
  if (!/paid you/i.test(subject)) return null;
  const amt = subject.match(/\$\s?([\d,]+(?:\.\d{2})?)/) || text.match(/\+?\s?\$\s?([\d,]+\.\d{2})/);
  const user = text.match(/lumi\s+sparks\s+for\s+@?([a-z0-9_.]{2,24})/i);
  return { amount: amt ? Number(amt[1].replace(/,/g, '')) : 0, username: user ? user[1].toLowerCase().replace(/\.$/, '') : null, payer: subject.replace(/\s*paid you.*$/i, '').slice(0, 60) };
}
// match stored payments to people: approve anyone who paid enough with their username in the note
function matchVenmoPayments() {
  let changed = false;
  for (const p of db.prepare('SELECT * FROM venmo_payments WHERE used_by IS NULL AND username IS NOT NULL').all()) {
    if (Math.round(p.amount * 100) < SPARKS_CENTS) continue;
    const u = db.prepare('SELECT * FROM users WHERE username=?').get(p.username); if (!u) continue;
    db.prepare('UPDATE venmo_payments SET used_by=? WHERE msg_id=?').run(u.id, p.msg_id);
    const months = Math.max(1, Math.floor(Math.round(p.amount * 100) / SPARKS_CENTS));
    grantSparks(u.id, 31 * months); changed = true;
    db.prepare("UPDATE sparks_requests SET status='approved', decided_at=?, decided_by='venmo-bot' WHERE user_id=? AND status='pending'").run(now(), u.id);
    console.log(`  Venmo bot: Sparks on for @${u.username} (${months} month${months > 1 ? 's' : ''})`);
  }
  // nothing arrived within a day of "I sent it": deny so they can try again
  for (const r of db.prepare("SELECT * FROM sparks_requests WHERE status='pending' AND created_at<?").all(now() - 24 * 3600_000)) {
    if (!venmoBotOn) break;
    db.prepare("UPDATE sparks_requests SET status='denied', decided_at=?, decided_by='venmo-bot' WHERE id=?").run(now(), r.id); changed = true;
    io.to(`user:${r.user_id}`).emit('sparks:update', { ...sparksState(getUser(r.user_id)), denied: true });
  }
  if (changed) tellOwners(true);
}
let venmoBotBusy = false;
async function venmoBotRun() {
  if (!venmoBotOn || venmoBotBusy) return;
  venmoBotBusy = true;
  const { ImapFlow } = require('imapflow'); const { simpleParser } = require('mailparser');
  const client = new ImapFlow({ host: VENMO_IMAP.host, port: 993, secure: true, auth: { user: VENMO_IMAP.user, pass: VENMO_IMAP.pass }, logger: false });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ since: new Date(Date.now() - 3 * 86400_000), or: [{ from: 'venmo.com' }, { subject: 'paid you' }] }, { uid: true });
      if (uids && uids.length) for await (const msg of client.fetch(uids, { source: true, uid: true }, { uid: true })) {
        const raw = msg.source.toString('utf8'); const headerEnd = raw.indexOf('\r\n\r\n');
        const mail = await simpleParser(msg.source);
        const key = mail.messageId || `uid-${msg.uid}`;
        if (db.prepare('SELECT 1 FROM venmo_payments WHERE msg_id=?').get(key)) continue;
        const p = parseVenmoMail(mail, (headerEnd > 0 ? raw.slice(0, headerEnd) : raw).match(/^(arc-)?authentication-results:.*(\r\n[ \t].*)*/gim)?.join('\n'));
        if (!p) continue;
        db.prepare('INSERT OR IGNORE INTO venmo_payments (msg_id, username, amount, payer, received_at) VALUES (?,?,?,?,?)').run(key, p.username, p.amount, p.payer, now());
      }
    } finally { lock.release(); }
    await client.logout();
    venmoBotStatus = { on: true, lastCheck: now(), lastError: null };
  } catch (e) {
    venmoBotStatus = { on: true, lastCheck: now(), lastError: e.authenticationFailed ? 'Email sign-in failed. Check VENMO_EMAIL and VENMO_EMAIL_PASSWORD on Render.' : e.message };
    console.log('  Venmo bot:', venmoBotStatus.lastError);
    try { client.close(); } catch {}
  } finally { venmoBotBusy = false; }
  matchVenmoPayments();
}
if (venmoBotOn) { console.log('  Venmo bot: watching ' + VENMO_IMAP.user.replace(/^(.).*(@.*)$/, '$1•••$2')); setTimeout(() => venmoBotRun().catch(() => {}), 20_000); setInterval(() => venmoBotRun().catch(() => {}), 60_000); }

app.get('/api/admin/sparks', auth, ownerOnly, wrap(req => ({
  venmo: venmoHandle(), canEditVenmo: isPrimaryOwner(req.user), bot: venmoBotStatus,
  unmatched: db.prepare('SELECT * FROM venmo_payments WHERE used_by IS NULL ORDER BY received_at DESC LIMIT 20').all()
    .map((p) => ({ id: p.msg_id, payer: p.payer, amount: p.amount, username: p.username, at: p.received_at })),
  recent: db.prepare("SELECT * FROM sparks_requests WHERE status='auto' AND created_at>? ORDER BY created_at DESC").all(now() - 40 * 86400_000)
    .map((r) => ({ id: r.id, createdAt: r.created_at, user: publicUser(getUser(r.user_id)) })).filter((r) => r.user),
  requests: db.prepare("SELECT * FROM sparks_requests WHERE status='pending' ORDER BY created_at").all()
    .map((r) => ({ id: r.id, createdAt: r.created_at, user: publicUser(getUser(r.user_id)) })).filter((r) => r.user),
  members: db.prepare('SELECT * FROM users WHERE sparks_until>? ORDER BY sparks_until DESC LIMIT 200').all(now())
    .map((u) => ({ user: publicUser(u), until: u.sparks_until, paid: !!u.stripe_sub })),
})));
app.put('/api/admin/venmo', auth, wrap(req => {
  if (!isPrimaryOwner(req.user)) throw fail(403, 'Only the main owner can change this.');
  const h = String(req.body.handle || '').trim().replace(/^@/, '');
  if (h && !/^[A-Za-z0-9_-]{5,30}$/.test(h)) throw fail(400, 'That doesn’t look like a Venmo username.');
  if (h) db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run('venmo_handle', h); else db.prepare("DELETE FROM meta WHERE k='venmo_handle'").run();
  return { venmo: h || null };
}));
app.post('/api/admin/reset-tasks', auth, ownerOnly, wrap(() => { resetAllTasks(); return { ok: true }; }));
app.post('/api/admin/sparks-requests/:id', auth, ownerOnly, wrap(req => {
  const r = db.prepare("SELECT * FROM sparks_requests WHERE id=? AND status IN ('pending','auto')").get(req.params.id);
  if (!r) throw fail(404, 'That request was already handled.');
  if (r.status === 'auto' && req.body.action === 'deny') { // took Sparks without paying
    db.prepare("UPDATE sparks_requests SET status='denied', decided_at=?, decided_by=? WHERE id=?").run(now(), req.user.id, r.id);
    grantSparks(r.user_id, 0);
    io.to(`user:${r.user_id}`).emit('sparks:update', { ...sparksState(getUser(r.user_id)), denied: true });
    tellOwners();
    return { ok: true };
  }
  if (r.status === 'auto') { db.prepare("UPDATE sparks_requests SET status='approved', decided_at=?, decided_by=? WHERE id=?").run(now(), req.user.id, r.id); tellOwners(); return { ok: true }; }
  const ok = req.body.action === 'approve';
  db.prepare('UPDATE sparks_requests SET status=?, decided_at=?, decided_by=? WHERE id=?').run(ok ? 'approved' : 'denied', now(), req.user.id, r.id);
  if (ok) grantSparks(r.user_id, 31);
  else io.to(`user:${r.user_id}`).emit('sparks:update', { ...sparksState(getUser(r.user_id)), denied: true });
  tellOwners();
  return { ok: true };
}));
app.post('/api/admin/users/:id/sparks', auth, ownerOnly, wrap(req => {
  const days = Number(req.body.days);
  if (![0, 7, 31, 365, 36500].includes(days)) throw fail(400, 'Pick how long.');
  return { until: grantSparks(req.params.id, days) };
}));

// Simple privacy + terms pages (linked from Google's sign-in screen)
const legalPage = (title, body) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · lumi</title>
<style>body{font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#17151C;background:#F7F5F1}h1{letter-spacing:-.03em}a{color:#0E9F8E}</style></head>
<body><p><a href="/">← back to lumi</a></p><h1>${title}</h1>${body}<p style="color:#6E6977">Last updated ${new Date().getFullYear()}.</p></body></html>`;
app.get('/privacy', (req, res) => res.send(legalPage('Privacy policy', `
<p>lumi stores only what it needs to run: your account (email, username, display name, a hashed password or your Google account ID, and profile details you choose to add), your friends list, the communities you join, and the messages, photos and files you send.</p>
<p>If you sign in with Google, lumi receives your name, email address and profile photo from Google. It does not access anything else in your Google account.</p>
<p>Voice and video calls go directly between participants (or through a relay server when a direct connection is not possible) and are not recorded or stored.</p>
<p>Your data is never sold or shared with advertisers. You can ask the owner of this lumi site to delete your account and data at any time.</p>`)));
app.get('/terms', (req, res) => res.send(legalPage('Terms of service', `
<p>lumi is provided as-is, without warranties. Be kind: don't use lumi to harass people, share illegal content, or spam.</p>
<p>Community owners and moderators can remove content and members from their communities. The site owner can suspend accounts that break these terms.</p>
<p>You keep ownership of what you post, and you give lumi permission to store and show it to the people you share it with.</p>`)));

// SPA fallback (for /invite/CODE links etc.)
app.get(/^\/(?!api|uploads|socket\.io|fonts|privacy|terms).*/, (req, res) => res.sendFile(INDEX_FILE));

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
    if (room && room.size) out[c.id] = [...room.entries()].map(([socketId, p]) => ({ socketId, ...p, user: publicUser(getUser(p.userId)) }));
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
  const sess = sessionFromCookieHeader(socket.handshake.headers.cookie);
  const u = sess && getUser(sess.user_id);
  if (!u || activeBan(u)) return next(new Error('unauthorized'));
  socket.data.userId = u.id; socket.data.sid = sess.sid; next();
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

  socket.on('voice:join', ({ channelId, rejoin } = {}, ack) => {
    const c = db.prepare('SELECT * FROM channels WHERE id=?').get(channelId);
    if (!c || !canAccessChannel(uid, c)) return ack?.({ error: 'No access' });
    if (c.type === 'dm' && isOfficialDM(c.id)) return ack?.({ error: 'You can’t call lumi’s official account.' });
    if (c.server_id && !has(memberPerms(c.server_id, uid), P.CONNECT)) return ack?.({ error: 'You can’t join this lounge.' });
    if ((c.server_id === null && c.type === 'text') || (c.server_id && c.type !== 'voice')) return ack?.({ error: 'Not a call channel' });
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
    if (!c.server_id && wasEmpty && !rejoin) {
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
// ---- stay awake: Render's free plan puts the server to sleep after ~15 minutes with no visitors,
// and the next visitor gets "Bad Gateway" while it boots. Visiting our own public address every
// 4 minutes counts as traffic, so the server never falls asleep.
const SELF_URL = process.env.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  let firstPing = true;
  console.log('  Keep-awake: pinging ' + SELF_URL + ' every 4 minutes');
  const ping = () => fetch(SELF_URL.replace(/\/$/, '') + '/api/version', { headers: { 'User-Agent': 'lumi-keepalive' } })
    .then((r) => { if (!r.ok) console.log('keepalive: got', r.status); else if (firstPing) { firstPing = false; console.log('  Keep-awake: working'); } })
    .catch((e) => console.log('keepalive failed:', e.message));
  setInterval(ping, 4 * 60 * 1000);
  setTimeout(ping, 30 * 1000);
}
server.listen(PORT, () => {
  console.log(`\n  ✨ Lumi is running at http://localhost:${PORT}`);
  setTimeout(sendUpdateNotes, Number(process.env.UPDATE_DM_DELAY || 30_000)).unref?.();
  if (process.env.LUMI_OPEN === '1') {
    const url = `http://localhost:${PORT}`;
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    require('child_process').exec(cmd, () => {});
  }
  console.log(GOOGLE_CLIENT_ID ? '  Google sign-in: enabled' : '  Google sign-in: disabled (set GOOGLE_CLIENT_ID in .env to enable)');
  console.log(storage.enabled ? '  Permanent storage: Cloudflare KV' : '  Permanent storage: off (data lives on this disk only)');
  console.log(CF_TURN_KEY_ID ? '  Call relay: Cloudflare TURN' : '  Call relay: off (STUN only)');
});
