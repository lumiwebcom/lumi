// Automatic safety checks for lumi.
// Every uploaded image is checked on this server (nothing is sent anywhere) with a small
// nudity-detection model. Server names and descriptions are checked for sexual words.
const path = require('path');

let tf, model, loading, failed = false;
const MODEL_DIR = path.join(__dirname, '.nsfw-model');
// `node moderation.js extract` (run by npm install): unpack the small MobileNetV2 model from the
// nsfwjs package into plain files. This needs lots of memory once, so it happens at build time.
if (require.main === module && process.argv[2] === 'extract') {
  (async () => {
    const fs = require('fs');
    const mod = require(path.join(path.dirname(require.resolve('nsfwjs')), 'model_imports', 'mobilenet_v2.js'));
    let json = await (typeof mod.modelJson === 'function' ? mod.modelJson() : mod.modelJson); json = json.default || json;
    let w = await (typeof mod.weightBundles[0] === 'function' ? mod.weightBundles[0]() : mod.weightBundles[0]); w = w.default || w;
    fs.mkdirSync(MODEL_DIR, { recursive: true });
    fs.writeFileSync(path.join(MODEL_DIR, 'model.json'), JSON.stringify(json));
    fs.writeFileSync(path.join(MODEL_DIR, 'weights.bin'), Buffer.from(w, 'base64'));
    console.log('Image safety model unpacked');
  })().catch((e) => { console.error('Could not unpack the image safety model:', e.message); });
}
const CLASSES = ['drawing', 'hentai', 'neutral', 'porn', 'sexy'];
// The model files (MobileNetV2 from nsfwjs, ~2.7 MB) are stored as plain files in nsfw-model/,
// which loads in a fraction of the memory the npm package's bundled copy needs.
function getModel() {
  if (model) return Promise.resolve(model);
  if (failed) return Promise.resolve(null);
  if (!loading) loading = (async () => {
    try {
      tf = require('@tensorflow/tfjs');
      tf.enableProdMode();
      const fs = require('fs'), dir = MODEL_DIR;
      if (!fs.existsSync(path.join(dir, 'weights.bin'))) throw new Error('model files missing (they are unpacked by npm install)');
      const json = JSON.parse(fs.readFileSync(path.join(dir, 'model.json'), 'utf8'));
      const bin = fs.readFileSync(path.join(dir, 'weights.bin'));
      model = await tf.loadLayersModel(tf.io.fromMemory({
        modelTopology: json.modelTopology, weightSpecs: json.weightsManifest[0].weights,
        weightData: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) }));
      console.log('  Image safety check: ready');
      return model;
    } catch (e) {
      failed = true;
      console.error('  Image safety check could not start:', e.message);
      return null;
    }
  })();
  return loading;
}

// one image at a time, so a burst of uploads can't run the server out of memory
let queue = Promise.resolve();
function scanImage(file) {
  const run = queue.then(async () => {
    const m = await getModel();
    if (!m) return null;
    const sharp = require('sharp');
    const { data } = await sharp(file, { animated: false, limitInputPixels: 60e6 })
      .rotate().flatten({ background: '#ffffff' }).resize(224, 224, { fit: 'fill' }).removeAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    const probs = tf.tidy(() => m.predict(tf.tensor3d(new Uint8Array(data), [224, 224, 3]).toFloat().div(255).reshape([1, 224, 224, 3])));
    try {
      const vals = await probs.data(), out = {};
      CLASSES.forEach((c, i) => (out[c] = vals[i]));
      return out; // { porn, hentai, sexy, drawing, neutral }
    } finally { probs.dispose(); }
  });
  queue = run.catch(() => {});
  return run;
}
// how sure the model is that an image shows nudity or sex (0 to 1)
const nsfwScore = (s) => (s ? (s.porn || 0) + (s.hentai || 0) : 0);

const NSFW_TEXT = /\b(porn\w*|p0rn\w*|nsfw|nudes?|nudity|naked|hentai|xxx+|onlyfans|only\s*fans|r34|rule\s*34|sex|sexy|sexting|horny|boobs?|tits|titties|dick\s*pics?|cum|nsfl|erotic\w*|fetish\w*|lewd)\b|(^|\W)18\s*\+/i;
const isNsfwText = (...parts) => parts.some((p) => typeof p === 'string' && NSFW_TEXT.test(p));

// GIF searches get a much stricter check: leetspeak is undone (p0rn, s3x, $exy), and spaced-out or
// glued-together words (p o r n, hotporn) are caught too.
const SEARCH_WORDS = /\b(porn\w*|nsfw|nsfl|nudes?|nudity|nude\w*|naked|hentai|ecchi|ahegao|yaoi|yuri|futa\w*|xxx+|onlyfans?|fansly|r34|rule ?34|sex|sexy|sexi\w*|sexx\w*|sexting|sexual\w*|sexually|horny|boob\w*|tits?|titt(y|ies)|dick\w*|cocks?|penis\w*|vagina\w*|puss(y|ies)|cum\w*|erotic\w*|fetish\w*|lewd\w*|ass|asses|arse|booty|butts?|buttocks|thong\w*|bikini\w*|lingerie|underwear|panties|bra|bras|twerk\w*|strip(per|pers|ping|tease)?|milf\w*|dilf|thots?|bdsm|kink\w*|orgasm\w*|masturbat\w*|jerk ?off|blow ?jobs?|bj|anal|nipples?|breasts?|topless|bottomless|thicc|playboy|brazzers|pornhub|xvideos|xhamster|camgirls?|seduc\w*|balls|ballsack|ball ?sack|nut ?sack|testicles?|scrotum|boners?|erections?|sluts?|slutty|whores?|hoes|hooker\w*|escorts?|dildo\w*|vibrator\w*|condoms?|moan\w*|spank\w*|gore|gory|hot (girls?|women|chicks?)|make ?out|grind\w*|naughty|smut\w*|hump\w*|horni)\b/i;
const SEARCH_GLUED = /(porn|xxx|rule34|r34|sexy|ballsack|nutsack|dildo|hentai|nsfw|xxx|onlyfan|rule34|nude|naked|boob|titty|titties|pussy|blowjob|milf|ahegao|sexy|sexx|bdsm|orgasm|masturb|brazzers|xvideo|xhamster)/;
function normalizeSearch(q) {
  return String(q || '').toLowerCase()
    .replace(/[0]/g, 'o').replace(/[1!|]/g, 'i').replace(/[3]/g, 'e').replace(/[4@]/g, 'a').replace(/[5$]/g, 's').replace(/[7]/g, 't').replace(/[8]/g, 'b')
    .replace(/(.)\1{2,}/g, '$1$1'); // "seeeexy" -> "seexy"
}
// words people try to sneak past with symbols, like p*ssy, c*m, b@lls, d!ck
const MASKABLE = ['porn', 'pussy', 'pussies', 'cum', 'cock', 'cocks', 'dick', 'dicks', 'balls', 'tits', 'titty', 'titties', 'boobs', 'boob', 'sex', 'sexy',
  'nude', 'nudes', 'naked', 'ass', 'booty', 'butt', 'penis', 'vagina', 'nipple', 'nipples', 'hentai', 'milf', 'thot', 'slut', 'whore', 'horny', 'nsfw', 'xxx', 'anal', 'boner', 'dildo'];
function maskedWord(q) {
  return String(q || '').toLowerCase().split(/\s+/).some((tok) => {
    if (!/[*#_.\-~^%?]/.test(tok)) return false;
    const pat = tok.replace(/[^a-z0-9*#_.\-~^%?@$!]/g, '').replace(/[@4]/g, 'a').replace(/[$5]/g, 's').replace(/[!1]/g, 'i').replace(/0/g, 'o').replace(/3/g, 'e');
    if ((pat.match(/[a-z]/g) || []).length < 2) return false; // need some real letters, so "..." or "?!" are fine
    const re = new RegExp('^' + pat.split('').map((ch) => (/[*#_.\-~^%?]/.test(ch) ? '[a-z]?' : ch)).join('') + '$');
    return MASKABLE.some((w) => re.test(w));
  });
}
function isNsfwSearch(q) {
  if (maskedWord(q)) return true;
  const raw = String(q || '').toLowerCase(), n = normalizeSearch(q);
  if ([raw, n].some((t) => SEARCH_WORDS.test(t) || isNsfwText(t))) return true;
  const glued = n.replace(/[^a-z]/g, ''), squashed = glued.replace(/(.)\1+/g, '$1'); // "s e e e x y" -> "sexy"
  return [glued, squashed].some((t) => SEARCH_GLUED.test(t)) || /(^|[^a-z])(s\s*e\s*x)([^a-z]|$)/.test(n);
}

// ---- The model runs in its own small process. If it ever runs out of memory or crashes,
// only that process dies: the main lumi server keeps running.
if (require.main === module && process.argv[2] === 'worker') {
  getModel().then((m) => process.send({ ready: !!m }));
  process.on('message', async ({ id, file }) => {
    try { process.send({ id, scores: await scanImage(file) }); } catch (e) { process.send({ id, error: e.message }); }
  });
  process.on('disconnect', () => process.exit(0));
}
const { fork } = require('child_process');
let child = null, seq = 0, crashes = 0, pausedUntil = 0;
const waiting = new Map();
const ENABLED = process.env.NSFW_IMAGE_CHECK !== '0';
function worker() {
  if (!ENABLED) return null;
  if (child) return child;
  if (Date.now() < pausedUntil) return null;
  child = fork(__filename, ['worker'], { execArgv: ['--no-warnings', '--max-old-space-size=160'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  child.on('message', (m) => {
    if ('ready' in m) { if (m.ready) crashes = 0; return; }
    const w = waiting.get(m.id); if (!w) return;
    waiting.delete(m.id); clearTimeout(w.timer);
    m.error ? w.reject(new Error(m.error)) : w.resolve(m.scores);
  });
  child.on('exit', (code) => {
    child = null;
    for (const w of waiting.values()) { clearTimeout(w.timer); w.reject(new Error('image check stopped')); }
    waiting.clear();
    if (code) {
      crashes++;
      console.error(`  Image safety check stopped (code ${code}); lumi is fine.`);
      if (crashes >= 3) { pausedUntil = Date.now() + 30 * 60_000; crashes = 0; console.error('  Image safety check paused for 30 minutes after repeated crashes.'); }
    }
  });
  return child;
}
// scan an image in the worker; resolves null if the check isn't available right now
function checkImage(file) {
  const w = worker();
  if (!w) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error('image check timed out')); }, 45_000);
    waiting.set(id, { resolve, reject, timer });
    w.send({ id, file });
  });
}
const warmUp = () => worker();

module.exports = { checkImage, warmUp, nsfwScore, isNsfwText, isNsfwSearch };
