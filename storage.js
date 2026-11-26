// Optional permanent storage for lumi in Cloudflare Workers KV.
// Render's free plan wipes its disk whenever the site sleeps or updates, so lumi
// keeps a compressed copy of its database (and every uploaded file) in KV and
// restores it on startup. Set CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID and CF_API_TOKEN to turn it on.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ACC = process.env.CF_ACCOUNT_ID, NS = process.env.CF_KV_NAMESPACE_ID, TOKEN = process.env.CF_API_TOKEN;
const enabled = !!(ACC && NS && TOKEN);
const API = process.env.CF_API_BASE || 'https://api.cloudflare.com/client/v4';
const url = (key) => `${API}/accounts/${ACC}/storage/kv/namespaces/${NS}/values/${encodeURIComponent(key)}`;

async function get(key) {
  const r = await fetch(url(key), { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`KV read failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  return Buffer.from(await r.arrayBuffer());
}
async function put(key, buf) {
  const r = await fetch(url(key), { method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/octet-stream' }, body: buf });
  if (!r.ok) throw new Error(`KV write failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
}
module.exports = { enabled, get, put };

// `node storage.js restore <dbfile>` — run (blocking) by server.js before the database opens.
if (require.main === module && process.argv[2] === 'restore') {
  (async () => {
    const file = process.argv[3];
    // if an older version is still running (an update), have it save its latest data first
    const site = process.env.RENDER_EXTERNAL_URL;
    if (site) {
      const key = require('crypto').createHash('sha256').update('lumi-flush:' + TOKEN).digest('hex');
      try {
        const r = await fetch(site + '/api/internal/flush', { method: 'POST', headers: { 'x-flush-key': key }, signal: AbortSignal.timeout(12_000) });
        console.log(r.ok ? '  Storage: previous version saved its latest data' : `  Storage: no previous version to hand over from (${r.status})`);
      } catch { console.log('  Storage: no previous version answered'); }
    }
    const buf = await get('lumi-db');
    if (!buf) return console.log('  Storage: connected, no saved data yet');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(file + s); } catch {} }
    fs.writeFileSync(file, zlib.gunzipSync(buf));
    console.log(`  Storage: restored saved data (${Math.round(buf.length / 1024)} KB)`);
  })().catch((e) => { console.error('  Storage: restore failed —', e.message); process.exit(2); });
}
